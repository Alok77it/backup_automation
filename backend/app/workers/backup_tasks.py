import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone

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
    run_borg_backup,
    run_database_backup,
    run_docker_backup,
    run_restic_backup,
    run_rclone_backup,
    run_rsync_backup,
    restore_restic,
)
from app.services.health_engine import calculate_backup_health
from app.services.ssh_service import run_ssh_command_sync
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


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
        elif engine == BackupEngine.RESTIC:
            local_sources = sources
            if server:
                for src in sources:
                    run_ssh_command_sync(
                        server.hostname,
                        server.port,
                        server.username,
                        f"test -e {src}",
                        password,
                        private_key,
                        server.auth_method,
                    )
            result = run_restic_backup(target, local_sources, passphrase, backup.backup_type.value)
        elif engine == BackupEngine.RSYNC:
            result = run_rsync_backup(sources, target, backup.backup_type.value, backup.compression, remote)
        elif engine == BackupEngine.RCLONE:
            result = run_rclone_backup(sources[0] if sources else "/", target, config.get("rclone", {}))
        elif engine == BackupEngine.BORG:
            result = run_borg_backup(target, sources, passphrase)
        else:
            result = run_restic_backup(target, sources, passphrase)

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
        passphrase = config.get("encryption_password", settings.ENCRYPTION_KEY[:32])
        run = None
        if backup.engine == BackupEngine.RESTIC and job.backup_run_id:
            br = session.get(BackupRun, job.backup_run_id)
            snapshot = br.snapshot_id if br else "latest"
            result = restore_restic(backup.target_path, snapshot or "latest", job.target_path, passphrase)
            job.status = JobStatus.COMPLETED if result.success else JobStatus.FAILED
            job.log_output = result.log_output
            job.error_message = result.error_message
        else:
            import shutil

            if os.path.exists(backup.target_path):
                if os.path.isdir(backup.target_path):
                    shutil.copytree(backup.target_path, job.target_path, dirs_exist_ok=not job.overwrite_protection)
                else:
                    os.makedirs(job.target_path, exist_ok=True)
                    shutil.copy2(backup.target_path, job.target_path)
                job.status = JobStatus.COMPLETED
            else:
                job.status = JobStatus.FAILED
                job.error_message = "Backup source path not found"

        job.completed_at = datetime.now(timezone.utc)
        session.commit()
        return {"status": job.status.value, "job_id": str(job.id)}
    except Exception as e:
        logger.exception("Restore failed: %s", e)
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
