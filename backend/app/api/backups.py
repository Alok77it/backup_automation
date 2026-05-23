import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.dependencies import DbSession, OrgMembership, require_permission, verify_csrf
from app.models.entities import Backup, BackupRun, JobStatus
from app.schemas.resources import BackupCreate, BackupResponse, BackupRunResponse
from app.services.audit import log_audit
from app.services.logging_service import create_log
from app.workers.backup_tasks import execute_backup_run

router = APIRouter(prefix="/backups", tags=["backups"])
settings = get_settings()


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


@router.get("", response_model=list[BackupResponse])
async def list_backups(
    db: DbSession,
    membership: OrgMembership = Depends(require_permission("backup:read")),
):
    result = await db.execute(
        select(Backup).where(Backup.organization_id == membership.organization_id).order_by(Backup.created_at.desc())
    )
    backups = result.scalars().all()
    return [await _backup_response(db, b) for b in backups]


@router.post("", response_model=BackupResponse, dependencies=[Depends(verify_csrf)])
async def create_backup(
    request: Request,
    data: BackupCreate,
    db: DbSession,
    membership: OrgMembership = Depends(require_permission("backup:write")),
):
    from app.models.entities import BackupEngine, BackupType

    org_path = os.path.join(settings.BACKUP_STORAGE_PATH, str(membership.organization_id))
    target = data.target_path or os.path.join(org_path, data.name.replace(" ", "-").lower())

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


@router.post("/{backup_id}/run", response_model=BackupRunResponse, dependencies=[Depends(verify_csrf)])
async def run_backup(
    backup_id: uuid.UUID,
    db: DbSession,
    membership: OrgMembership = Depends(require_permission("backup:run")),
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
    membership: OrgMembership = Depends(require_permission("backup:read")),
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
    membership: OrgMembership = Depends(require_permission("backup:delete")),
):
    result = await db.execute(
        select(Backup).where(Backup.id == backup_id, Backup.organization_id == membership.organization_id)
    )
    backup = result.scalar_one_or_none()
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")
    await db.delete(backup)
    return {"message": "Backup deleted"}
