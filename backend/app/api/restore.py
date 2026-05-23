import os
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.core.dependencies import DbSession, require_permission, verify_csrf
from app.models.entities import OrganizationMember
from app.models.entities import Backup, BackupRun, JobStatus, RestoreJob
from app.schemas.resources import RestoreAnalysis, RestoreCreate, RestoreJobResponse
from app.services.ai_service import get_ai_response
from app.services.health_engine import analyze_restore_readiness, calculate_backup_health
from app.services.logging_service import create_log
from app.workers.backup_tasks import execute_restore_job

router = APIRouter(prefix="/restore", tags=["restore"])


@router.post("/analyze", response_model=RestoreAnalysis)
async def analyze_restore(
    data: RestoreCreate,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("restore:read"))],
):
    result = await db.execute(
        select(Backup).where(Backup.id == data.backup_id, Backup.organization_id == membership.organization_id)
    )
    backup = result.scalar_one_or_none()
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")

    runs_result = await db.execute(
        select(BackupRun).where(BackupRun.backup_id == backup.id).order_by(BackupRun.started_at.desc()).limit(50)
    )
    runs = runs_result.scalars().all()
    health = calculate_backup_health(runs)

    size = 0
    if data.backup_run_id:
        run = await db.get(BackupRun, data.backup_run_id)
        size = run.bytes_added if run else 0

    analysis = analyze_restore_readiness(
        health,
        size,
        os.path.exists(data.target_path),
        data.overwrite_protection,
    )

    ai_summary = await get_ai_response(
        f"Is it safe to restore backup '{backup.name}' to {data.target_path}?",
        {
            "backup_name": backup.name,
            "health_score": health.health_score,
            "restore_confidence": analysis["restore_confidence"],
            "risk_level": health.risk_level,
            "warnings": analysis["dependency_warnings"],
            "risks": analysis["corruption_risks"],
        },
    )

    return RestoreAnalysis(
        restore_confidence=analysis["restore_confidence"],
        estimated_duration_seconds=analysis["estimated_duration_seconds"],
        dependency_warnings=analysis["dependency_warnings"],
        corruption_risks=analysis["corruption_risks"],
        health_score=analysis["health_score"],
        risk_level=analysis["risk_level"],
        ai_summary=ai_summary,
    )


@router.post("", response_model=RestoreJobResponse, dependencies=[Depends(verify_csrf)])
async def create_restore(
    data: RestoreCreate,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("restore:execute"))],
):
    result = await db.execute(
        select(Backup).where(Backup.id == data.backup_id, Backup.organization_id == membership.organization_id)
    )
    backup = result.scalar_one_or_none()
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")

    runs_result = await db.execute(
        select(BackupRun).where(BackupRun.backup_id == backup.id).order_by(BackupRun.started_at.desc()).limit(50)
    )
    health = calculate_backup_health(runs_result.scalars().all())
    analysis = analyze_restore_readiness(health, 0, os.path.exists(data.target_path), data.overwrite_protection)

    job = RestoreJob(
        backup_id=backup.id,
        backup_run_id=data.backup_run_id,
        initiated_by_id=membership.user_id,
        status=JobStatus.PENDING,
        target_path=data.target_path,
        overwrite_protection=data.overwrite_protection,
        restore_confidence=analysis["restore_confidence"],
        estimated_duration_seconds=analysis["estimated_duration_seconds"],
        dependency_warnings=analysis["dependency_warnings"],
        corruption_risks=analysis["corruption_risks"],
        ai_analysis_json={
            **analysis,
            "target_server_id": str(data.target_server_id) if data.target_server_id else None,
        },
    )
    db.add(job)
    await db.flush()
    execute_restore_job.delay(str(job.id))
    await create_log(db, membership.organization_id, "restore", f"Restore job created for '{backup.name}'", backup_id=backup.id)
    return RestoreJobResponse.model_validate(job)


@router.get("/jobs", response_model=list[RestoreJobResponse])
async def list_restore_jobs(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("restore:read"))],
):
    result = await db.execute(
        select(RestoreJob)
        .join(Backup)
        .where(Backup.organization_id == membership.organization_id)
        .order_by(RestoreJob.created_at.desc())
        .limit(50)
    )
    return [RestoreJobResponse.model_validate(j) for j in result.scalars().all()]
