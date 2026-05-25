import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from croniter import croniter
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decrypt_secret
from app.models.entities import (
    AlertSeverity,
    Backup,
    BackupEngine,
    BackupRun,
    BackupType,
    JobStatus,
    Server,
)
from app.services.backup_engines import (
    run_database_backup,
    run_docker_backup,
    run_rclone_backup,
    run_rsync_backup,
    restore_rsync,
)
from app.services.health_engine import calculate_backup_health
from app.services.ssh_service import run_ssh_command_sync
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


def _apply_retention(session: Session, backup: "Backup") -> None:
    """Delete old BackupRun records (and their on-disk snapshot dirs) according
    to the backup's linked policy (retention_days + retention_count).
    Runs that are still RUNNING or PENDING are never removed.
    """
    from app.models.entities import BackupPolicy

    if not backup.policy_id:
        return

    policy: BackupPolicy | None = session.get(BackupPolicy, backup.policy_id)
    if not policy or not policy.cleanup_enabled:
        return

    # Fetch all finished runs sorted newest-first
    all_runs = (
        session.execute(
            select(BackupRun)
            .where(
                BackupRun.backup_id == backup.id,
                BackupRun.status.in_([JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]),
            )
            .order_by(BackupRun.started_at.desc())
        )
        .scalars()
        .all()
    )

    to_delete: list[BackupRun] = []

    # retention_count: keep only the N most recent runs
    if policy.retention_count and policy.retention_count > 0:
        excess = all_runs[policy.retention_count:]
        to_delete.extend(excess)

    # retention_days: also delete runs older than N days (may overlap with above)
    if policy.retention_days and policy.retention_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=policy.retention_days)
        for run in all_runs:
            started = run.started_at
            if started and started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            if started and started < cutoff and run not in to_delete:
                to_delete.append(run)

    if not to_delete:
        return

    deleted_ids = []
    for run in to_delete:
        # Best-effort: remove per-run snapshot directory if it exists
        if run.snapshot_id:
            snap_dir = os.path.join(
                settings.BACKUP_STORAGE_PATH,
                str(backup.organization_id),
                str(backup.id),
                str(run.snapshot_id),
            )
            if os.path.isdir(snap_dir):
                import shutil
                try:
                    shutil.rmtree(snap_dir)
                except Exception as exc:
                    logger.warning("Could not remove snapshot dir %s: %s", snap_dir, exc)
        session.delete(run)
        deleted_ids.append(str(run.id))

    session.commit()
    logger.info(
        "Retention applied for backup %s: removed %d run(s) [policy: %d days / %d max]",
        backup.id,
        len(deleted_ids),
        policy.retention_days,
        policy.retention_count,
    )


def _sync_session() -> Session:
    sync_url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://").replace(
        "postgresql://", "postgresql+psycopg2://"
    )
    if "psycopg2" not in sync_url and sync_url.startswith("postgresql://"):
        sync_url = sync_url.replace("postgresql://", "postgresql+psycopg2://")
    engine = create_engine(sync_url)
    return Session(engine)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=300)
def execute_backup_run(self, run_id: str) -> dict:
    session = _sync_session()
    try:
        run = session.get(BackupRun, uuid.UUID(run_id))
        if not run:
            return {"error": "Run not found"}
        backup = session.get(Backup, run.backup_id)
        if not backup:
            return {"error": "Backup not found"}

        run.status = JobStatus.RUNNING
        run.started_at = datetime.now(timezone.utc)
        run.celery_task_id = self.request.id
        session.commit()

        org_path = os.path.join(settings.BACKUP_STORAGE_PATH, str(backup.organization_id))
        target = backup.target_path or os.path.join(org_path, str(backup.id))
        os.makedirs(target, exist_ok=True)

        config = backup.config_json or {}
        sources = backup.source_paths or ["/tmp"]
        passphrase = config.get("encryption_password", settings.ENCRYPTION_KEY[:32])

        server = session.get(Server, backup.server_id) if backup.server_id else None
        remote = None
        password = None
        private_key = None
        if server:
            password = decrypt_secret(server.encrypted_password) if server.encrypted_password else None
            private_key = (
                decrypt_secret(server.encrypted_private_key) if server.encrypted_private_key else None
            )
            remote = f"{server.username}@{server.hostname}"

        result = None
        engine = backup.engine
        btype = backup.backup_type

        # Write the SSH private key to a temp file if available (rsync needs a file path)
        ssh_key_path = None
        if private_key:
            import tempfile
            kf = tempfile.NamedTemporaryFile(mode="w", suffix=".pem", delete=False)
            kf.write(private_key)
            kf.close()
            os.chmod(kf.name, 0o600)
            ssh_key_path = kf.name

        try:
            if btype == BackupType.DATABASE:
                result = run_database_backup(
                    config.get("db_type", "postgresql"),
                    config.get("connection_string", ""),
                    os.path.join(target, f"db-{run.id}.dump"),
                )
            elif btype == BackupType.DOCKER:
                result = run_docker_backup(
                    config.get("container_ids", []),
                    target,
                    config.get("include_volumes", True),
                )
            elif engine == BackupEngine.RCLONE:
                result = run_rclone_backup(
                    sources[0] if sources else "/",
                    target,
                    config.get("rclone", {}),
                )
            else:
                # Default: rsync (handles both local and remote via SSH)
                result = run_rsync_backup(
                    sources,
                    target,
                    backup.backup_type.value,
                    backup.compression,
                    remote,
                    ssh_key_path,
                    password,  # used by sshpass when no key is set
                )
        finally:
            if ssh_key_path and os.path.exists(ssh_key_path):
                os.unlink(ssh_key_path)

        # ── Push to destination server if configured ──────────────────────────
        if result and result.success and backup.destination_server_id:
            dest_server = session.get(Server, backup.destination_server_id)
            if dest_server:
                dest_password = decrypt_secret(dest_server.encrypted_password) if dest_server.encrypted_password else None
                dest_private_key = decrypt_secret(dest_server.encrypted_private_key) if dest_server.encrypted_private_key else None
                dest_remote = f"{dest_server.username}@{dest_server.hostname}"
                dest_key_path = None
                if dest_private_key:
                    import tempfile as _tf
                    dkf = _tf.NamedTemporaryFile(mode="w", suffix=".pem", delete=False)
                    dkf.write(dest_private_key)
                    dkf.close()
                    os.chmod(dkf.name, 0o600)
                    dest_key_path = dkf.name
                try:
                    push_result = restore_rsync(
                        target,
                        backup.target_path or target,
                        compression=backup.compression,
                        remote=dest_remote,
                        ssh_key_path=dest_key_path,
                        ssh_password=dest_password,
                    )
                    if not push_result.success:
                        logger.warning("Destination push failed: %s", push_result.error_message)
                        result = push_result  # mark overall as failed if push failed
                finally:
                    if dest_key_path and os.path.exists(dest_key_path):
                        os.unlink(dest_key_path)

        run.status = JobStatus.COMPLETED if result.success else JobStatus.FAILED
        run.completed_at = datetime.now(timezone.utc)
        run.bytes_processed = result.bytes_processed
        run.bytes_added = result.bytes_added
        run.duration_seconds = result.duration_seconds
        run.checksum_valid = result.checksum_valid
        run.failed_chunks = result.failed_chunks
        run.snapshot_id = result.snapshot_id
        run.log_output = result.log_output
        run.error_message = result.error_message
        session.commit()

        runs = (
            session.execute(
                select(BackupRun).where(BackupRun.backup_id == backup.id).order_by(BackupRun.started_at.desc()).limit(50)
            )
            .scalars()
            .all()
        )
        health = calculate_backup_health(runs)
        backup.health_score = health.health_score
        backup.restore_confidence = health.restore_confidence
        backup.risk_level = health.risk_level
        backup.corruption_probability = health.corruption_probability
        session.commit()

        # Apply retention policy — prune old runs after every successful backup
        try:
            _apply_retention(session, backup)
        except Exception as retention_err:
            logger.warning("Retention cleanup failed (non-fatal): %s", retention_err)

        return {"status": run.status.value, "run_id": str(run.id)}
    except Exception as e:
        logger.exception("Backup task failed: %s", e)
        try:
            run = session.get(BackupRun, uuid.UUID(run_id))
            if run:
                run.status = JobStatus.FAILED
                run.error_message = str(e)
                run.completed_at = datetime.now(timezone.utc)
                session.commit()
        except Exception:
            pass
        raise self.retry(exc=e)
    finally:
        session.close()


@celery_app.task(bind=True, max_retries=2)
def execute_restore_job(self, job_id: str) -> dict:
    session = _sync_session()
    try:
        from app.models.entities import RestoreJob

        job = session.get(RestoreJob, uuid.UUID(job_id))
        if not job:
            return {"error": "Job not found"}
        backup = session.get(Backup, job.backup_id)
        if not backup:
            return {"error": "Backup not found"}

        job.status = JobStatus.RUNNING
        job.started_at = datetime.now(timezone.utc)
        job.celery_task_id = self.request.id
        session.commit()

        if job.overwrite_protection and os.path.exists(job.target_path) and os.listdir(job.target_path):
            job.status = JobStatus.FAILED
            job.error_message = "Target path not empty and overwrite protection enabled"
            job.completed_at = datetime.now(timezone.utc)
            session.commit()
            return {"status": "failed", "reason": "overwrite_protection"}

        config = backup.config_json or {}

        # Resolve server credentials for remote restore (push back to source server)
        server = session.get(Server, backup.server_id) if backup.server_id else None
        remote = None
        ssh_key_path = None
        restore_password = None
        if server:
            private_key = decrypt_secret(server.encrypted_private_key) if server.encrypted_private_key else None
            restore_password = decrypt_secret(server.encrypted_password) if server.encrypted_password else None
            if private_key:
                import tempfile
                kf = tempfile.NamedTemporaryFile(mode="w", suffix=".pem", delete=False)
                kf.write(private_key)
                kf.close()
                os.chmod(kf.name, 0o600)
                ssh_key_path = kf.name
            remote = f"{server.username}@{server.hostname}"

        backup_source = backup.target_path
        if not backup_source or not os.path.exists(backup_source):
            job.status = JobStatus.FAILED
            job.error_message = "Backup source path not found"
            job.completed_at = datetime.now(timezone.utc)
            session.commit()
            return {"status": "failed", "reason": "backup_path_missing"}

        try:
            result = restore_rsync(
                backup_source,
                job.target_path,
                compression=backup.compression,
                remote=remote,
                ssh_key_path=ssh_key_path,
                ssh_password=restore_password,
            )
        finally:
            if ssh_key_path and os.path.exists(ssh_key_path):
                os.unlink(ssh_key_path)

        job.status = JobStatus.COMPLETED if result.success else JobStatus.FAILED
        job.log_output = result.log_output
        job.error_message = result.error_message

        job.completed_at = datetime.now(timezone.utc)
        session.commit()
        return {"status": job.status.value, "job_id": str(job.id)}
    except Exception as e:
        logger.exception("Restore failed: %s", e)
        raise self.retry(exc=e)
    finally:
        session.close()


@celery_app.task(bind=True, max_retries=1, default_retry_delay=10)
def execute_ai_action(self, action_id: str) -> dict:
    """Execute an AI-proposed SSH command on the target server after human approval."""
    session = _sync_session()
    try:
        from app.models.entities import AIAction, AIActionStatus

        action = session.get(AIAction, uuid.UUID(action_id))
        if not action:
            return {"error": "Action not found"}
        if action.status not in (AIActionStatus.APPROVED, AIActionStatus.EXECUTING):
            return {"error": f"Action is {action.status.value}, expected approved"}

        action.status = AIActionStatus.EXECUTING
        session.commit()

        server = session.get(Server, action.server_id) if action.server_id else None
        if not server:
            action.status = AIActionStatus.FAILED
            action.error_message = "Target server not found in database"
            action.executed_at = datetime.now(timezone.utc)
            session.commit()
            return {"error": "Server not found"}

        password = decrypt_secret(server.encrypted_password) if server.encrypted_password else None
        private_key = decrypt_secret(server.encrypted_private_key) if server.encrypted_private_key else None
        auth_method = server.auth_method or "password"

        try:
            exit_code, stdout, stderr = run_ssh_command_sync(
                hostname=server.hostname,
                port=server.port,
                username=server.username,
                command=action.command,
                password=password,
                private_key=private_key,
                auth_method=auth_method,
                timeout=120,
            )
        except Exception as ssh_err:
            action.status = AIActionStatus.FAILED
            action.error_message = f"SSH error: {ssh_err}"
            action.executed_at = datetime.now(timezone.utc)
            session.commit()
            return {"error": str(ssh_err)}

        output = (stdout or "").strip()
        errors = (stderr or "").strip()

        action.status = AIActionStatus.EXECUTED if exit_code == 0 else AIActionStatus.FAILED
        action.result_output = output[:8000] if output else None
        action.error_message = f"exit {exit_code}: {errors[:2000]}" if exit_code != 0 else None
        action.executed_at = datetime.now(timezone.utc)
        session.commit()

        return {
            "status": action.status.value,
            "exit_code": exit_code,
            "output": output[:1000],
        }
    except Exception as e:
        logger.exception("AI action execution failed: %s", e)
        try:
            from app.models.entities import AIAction, AIActionStatus
            action = session.get(AIAction, uuid.UUID(action_id))
            if action:
                action.status = AIActionStatus.FAILED
                action.error_message = str(e)
                action.executed_at = datetime.now(timezone.utc)
                session.commit()
        except Exception:
            pass
        raise self.retry(exc=e)
    finally:
        session.close()


@celery_app.task
def run_scheduled_backups() -> dict:
    session = _sync_session()
    triggered = 0
    try:
        backups = session.execute(select(Backup).where(Backup.is_active == True, Backup.schedule_cron != None)).scalars().all()
        now = datetime.now(timezone.utc)
        for backup in backups:
            if not backup.schedule_cron:
                continue
            try:
                cron = croniter(backup.schedule_cron, now)
                prev = cron.get_prev(datetime)
                if (now - prev).total_seconds() > 900:
                    continue
            except Exception:
                continue

            run = BackupRun(backup_id=backup.id, status=JobStatus.PENDING)
            session.add(run)
            session.commit()
            execute_backup_run.delay(str(run.id))
            triggered += 1
        return {"triggered": triggered}
    finally:
        session.close()
