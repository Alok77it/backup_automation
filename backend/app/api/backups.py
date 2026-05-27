import os
import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.dependencies import DbSession, require_permission, verify_csrf
from app.core.security import encrypt_secret
from app.models.entities import OrganizationMember
from app.models.entities import Backup, BackupRun, JobStatus
from app.schemas.resources import BackupCreate, BackupResponse, BackupRunResponse, DatabaseBackupRequest
from app.services.audit import log_audit
from app.services.logging_service import create_log
from app.workers.backup_tasks import execute_backup_run

router = APIRouter(prefix="/backups", tags=["backups"])
settings = get_settings()


def _slugify_path(value: str | None, fallback: str = "item") -> str:
    text = (value or fallback).strip().lower()
    text = re.sub(r"[^a-z0-9._-]+", "-", text).strip("-._")
    return text[:80] or fallback


async def _default_backup_target(db, server_id: uuid.UUID | None, backup_name: str) -> str:
    server_part = "local-server"
    if server_id:
        from app.models.entities import Server

        server = await db.get(Server, server_id)
        if server:
            server_part = _slugify_path(server.name or server.hostname or str(server.id), "server")
    return os.path.join(settings.BACKUP_STORAGE_PATH, server_part, _slugify_path(backup_name, "backup"))


async def _backup_response(db, backup: Backup) -> BackupResponse:
    run_result = await db.execute(
        select(BackupRun).where(BackupRun.backup_id == backup.id).order_by(BackupRun.started_at.desc()).limit(1)
    )
    last_run = run_result.scalar_one_or_none()
    server_name = None
    if backup.server_id:
        from app.models.entities import Server

        s = await db.get(Server, backup.server_id)
        server_name = s.name if s else None
    return BackupResponse(
        id=backup.id,
        name=backup.name,
        backup_type=backup.backup_type.value,
        engine=backup.engine.value,
        source_paths=backup.source_paths,
        target_path=backup.target_path,
        schedule_cron=backup.schedule_cron,
        is_active=backup.is_active,
        health_score=backup.health_score,
        restore_confidence=backup.restore_confidence,
        risk_level=backup.risk_level,
        corruption_probability=backup.corruption_probability,
        server_id=backup.server_id,
        server_name=server_name,
        created_at=backup.created_at,
        last_run_status=last_run.status.value if last_run else None,
        last_run_at=last_run.started_at if last_run else None,
    )


@router.get("/database/jobs")
async def list_database_backup_jobs(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:read"))],
    limit: int = 50,
):
    """List all database backup jobs for this organization."""
    from app.models.entities import BackupType
    result = await db.execute(
        select(BackupRun, Backup)
        .join(Backup, BackupRun.backup_id == Backup.id)
        .where(
            Backup.organization_id == membership.organization_id,
            Backup.backup_type == BackupType.DATABASE,
            Backup.is_active == True,
            Backup.server_id.is_not(None),
        )
        .order_by(BackupRun.started_at.desc())
        .limit(limit)
    )
    rows = result.all()
    items = []
    for run, backup in rows:
        r = BackupRunResponse.model_validate(run)
        cfg = backup.config_json or {}
        if r.metadata_json is None:
            r.metadata_json = {}
        r.metadata_json.update({
            "backup_name": backup.name,
            "db_type": cfg.get("db_type", ""),
            "db_name": cfg.get("db_name", ""),
            "db_host": cfg.get("db_host", ""),
            "target_path": backup.target_path,
            "storage_dir": (run.metadata_json or {}).get("storage_dir"),
            "dump_file": (run.metadata_json or {}).get("dump_file"),
        })
        items.append(r)
    return items


@router.get("/runs/all", response_model=list[BackupRunResponse])
async def list_all_runs(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:read"))],
    server_id: str | None = None,
    limit: int = 100,
):
    """List all recent backup runs across the org, optionally filtered by server."""
    q = (
        select(BackupRun)
        .join(Backup, BackupRun.backup_id == Backup.id)
        .where(
            Backup.organization_id == membership.organization_id,
            Backup.is_active == True,
            Backup.server_id.is_not(None),
        )
        .order_by(BackupRun.started_at.desc())
    )
    if server_id:
        try:
            from uuid import UUID as _UUID
            sid = _UUID(server_id)
            q = q.where(Backup.server_id == sid)
        except Exception:
            pass
    q = q.limit(limit)
    result = await db.execute(q)
    runs = result.scalars().all()
    
    # Attach backup name to metadata_json for display
    responses = []
    for run in runs:
        r = BackupRunResponse.model_validate(run)
        # Fetch backup name
        backup_obj = await db.get(Backup, run.backup_id)
        if backup_obj:
            if r.metadata_json is None:
                r.metadata_json = {}
            r.metadata_json["backup_name"] = backup_obj.name
            if backup_obj.server_id:
                from app.models.entities import Server

                server = await db.get(Server, backup_obj.server_id)
                r.metadata_json["server_name"] = server.name if server else str(backup_obj.server_id)
        responses.append(r)
    return responses


@router.post("/database", response_model=BackupRunResponse, dependencies=[Depends(verify_csrf)])
async def run_database_backup_direct(
    data: "DatabaseBackupRequest",
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:write"))],
):
    """Create a one-off database backup: connects via SSH to the server and runs pg_dump/mysqldump."""
    from app.workers.backup_tasks import execute_backup_run as _exec
    from app.models.entities import BackupType, BackupEngine

    # Create a transient Backup record for this DB backup
    import json as _json
    from datetime import timezone as _tz, datetime as _dt

    backup_name = data.name or f"{data.db_type}-{data.db_name}-{_dt.now(_tz.utc).strftime('%Y%m%d-%H%M')}"

    # Encrypt password before persisting — never store plaintext credentials
    encrypted_pw = encrypt_secret(data.db_password) if data.db_password else ""

    default_target = await _default_backup_target(db, data.server_id, backup_name)
    backup = Backup(
        organization_id=membership.organization_id,
        server_id=data.server_id,
        name=backup_name,
        backup_type=BackupType.DATABASE,
        engine=BackupEngine.RSYNC,
        source_paths=[],
        target_path=data.target_path or default_target,
        compression=data.compression,
        encryption=False,
        config_json={
            "db_type": data.db_type,
            "db_host": data.db_host,
            "db_port": data.db_port,
            "db_user": data.db_user,
            "db_password_enc": encrypted_pw,  # Fernet-encrypted, never plaintext
            "db_name": data.db_name,
        },
    )
    db.add(backup)
    await db.flush()

    run = BackupRun(
        backup_id=backup.id,
        status=JobStatus.PENDING,
        started_at=_dt.now(_tz.utc),
    )
    db.add(run)
    await db.flush()

    _exec.delay(str(run.id))
    await create_log(
        db, membership.organization_id, "backup",
        f"Database backup started: {data.db_type}/{data.db_name} on server",
        backup_id=backup.id,
    )
    return BackupRunResponse.model_validate(run)



@router.get("", response_model=list[BackupResponse])
async def list_backups(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:read"))],
):
    result = await db.execute(
        select(Backup)
        .where(
            Backup.organization_id == membership.organization_id,
            Backup.is_active == True,
            Backup.server_id.is_not(None),
        )
        .order_by(Backup.created_at.desc())
    )
    backups = result.scalars().all()
    return [await _backup_response(db, b) for b in backups]


@router.post("", response_model=BackupResponse, dependencies=[Depends(verify_csrf)])
async def create_backup(
    request: Request,
    data: BackupCreate,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:write"))],
):
    from app.models.entities import BackupEngine, BackupType

    target = data.target_path or await _default_backup_target(db, data.server_id, data.name)

    backup = Backup(
        organization_id=membership.organization_id,
        server_id=data.server_id,
        policy_id=data.policy_id,
        name=data.name,
        backup_type=BackupType(data.backup_type),
        engine=BackupEngine(data.engine),
        source_paths=data.source_paths,
        target_path=target,
        schedule_cron=data.schedule_cron,
        compression=data.compression,
        encryption=data.encryption,
        config_json=data.config_json,
    )
    db.add(backup)
    await db.flush()
    await log_audit(db, membership.organization_id, "backup.create", "backup", membership.user_id, str(backup.id))
    await create_log(db, membership.organization_id, "backup", f"Backup job '{backup.name}' created", backup_id=backup.id)
    return await _backup_response(db, backup)


@router.get("/{backup_id}/runs/{run_id}/progress")
async def get_run_progress(
    backup_id: uuid.UUID,
    run_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:read"))],
):
    """Return live progress info for a backup run."""
    result = await db.execute(
        select(BackupRun)
        .join(Backup, BackupRun.backup_id == Backup.id)
        .where(
            BackupRun.id == run_id,
            Backup.id == backup_id,
            Backup.organization_id == membership.organization_id,
        )
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    import time
    from datetime import timezone as _tz
    elapsed = 0
    if run.started_at:
        started = run.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=_tz.utc)
        if run.completed_at:
            completed = run.completed_at
            if completed.tzinfo is None:
                completed = completed.replace(tzinfo=_tz.utc)
            elapsed = (completed - started).total_seconds()
        elif run.status.value == "running":
            from datetime import datetime
            elapsed = (datetime.now(_tz.utc) - started).total_seconds()

    # Estimate progress from log output (rsync reports percentages)
    progress_pct = None
    if run.log_output:
        import re
        matches = re.findall(r"(\d{1,3})%", run.log_output)
        if matches:
            progress_pct = int(matches[-1])

    if run.status.value == "completed":
        progress_pct = 100
    elif run.status.value == "failed":
        progress_pct = None
    elif run.status.value == "pending":
        progress_pct = 0

    return {
        "run_id": str(run.id),
        "backup_id": str(backup_id),
        "status": run.status.value,
        "progress_pct": progress_pct,
        "elapsed_seconds": round(elapsed, 1),
        "bytes_processed": run.bytes_processed,
        "bytes_added": run.bytes_added,
        "duration_seconds": run.duration_seconds,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "error_message": run.error_message,
        "failed_chunks": run.failed_chunks,
        "log_tail": run.log_output[-1000:] if run.log_output else None,
    }


@router.post("/{backup_id}/run", response_model=BackupRunResponse, dependencies=[Depends(verify_csrf)])
async def run_backup(
    backup_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:run"))],
):
    result = await db.execute(
        select(Backup).where(Backup.id == backup_id, Backup.organization_id == membership.organization_id)
    )
    backup = result.scalar_one_or_none()
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")

    run = BackupRun(backup_id=backup.id, status=JobStatus.PENDING)
    db.add(run)
    await db.flush()
    execute_backup_run.delay(str(run.id))
    await create_log(db, membership.organization_id, "backup", f"Backup run started for '{backup.name}'", backup_id=backup.id)
    return BackupRunResponse.model_validate(run)


@router.get("/{backup_id}/runs", response_model=list[BackupRunResponse])
async def list_runs(
    backup_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:read"))],
):
    result = await db.execute(
        select(BackupRun)
        .join(Backup)
        .where(Backup.id == backup_id, Backup.organization_id == membership.organization_id)
        .order_by(BackupRun.started_at.desc())
        .limit(50)
    )
    return [BackupRunResponse.model_validate(r) for r in result.scalars().all()]


@router.delete("/{backup_id}", dependencies=[Depends(verify_csrf)])
async def delete_backup(
    backup_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:delete"))],
):
    result = await db.execute(
        select(Backup).where(Backup.id == backup_id, Backup.organization_id == membership.organization_id)
    )
    backup = result.scalar_one_or_none()
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")
    await db.delete(backup)
    return {"message": "Backup deleted"}
