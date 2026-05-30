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
from app.workers.backup_tasks import execute_restore_job, execute_db_restore_job

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
    await create_log(db, membership.organization_id, "restore", f"Restore job created for '{backup.name}'", backup_id=backup.id)
    await db.commit()
    task = execute_restore_job.delay(str(job.id))
    job.celery_task_id = task.id
    await db.commit()
    await db.refresh(job)
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


@router.get("/jobs/{job_id}/progress")
async def get_restore_progress(
    job_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:read"))],
):
    """Live progress for a restore job."""
    from app.models.entities import RestoreJob
    from datetime import timezone as _tz, datetime as _dt

    job = await db.get(RestoreJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Verify org
    backup = await db.get(Backup, job.backup_id)
    if not backup or backup.organization_id != membership.organization_id:
        raise HTTPException(status_code=404, detail="Job not found")

    elapsed = 0.0
    if job.started_at:
        started = job.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=_tz.utc)
        if job.completed_at:
            completed = job.completed_at
            if completed.tzinfo is None:
                completed = completed.replace(tzinfo=_tz.utc)
            elapsed = (completed - started).total_seconds()
        elif job.status.value == "running":
            elapsed = (_dt.now(_tz.utc) - started).total_seconds()

    progress_pct = None
    if job.log_output:
        import re
        matches = re.findall(r"(\d{1,3})%", job.log_output)
        if matches:
            progress_pct = int(matches[-1])
    if job.status.value == "completed":
        progress_pct = 100
    elif job.status.value == "pending":
        progress_pct = 0

    return {
        "job_id": str(job.id),
        "status": job.status.value,
        "progress_pct": progress_pct,
        "elapsed_seconds": round(elapsed, 1),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "error_message": job.error_message,
        "log_tail": job.log_output[-1000:] if job.log_output else None,
        "stage": (job.ai_analysis_json or {}).get("stage"),
        "last_message": (job.ai_analysis_json or {}).get("last_message"),
    }


# ── Database restore ──────────────────────────────────────────────────────────

from pydantic import BaseModel as _BM


class DatabaseRestoreRequest(_BM):
    backup_run_id: uuid.UUID          # which DB backup run to restore from
    db_type: str = "postgresql"
    db_host: str = "localhost"
    db_port: int | None = None
    db_user: str
    db_password: str
    db_name: str
    dest_server_id: uuid.UUID | None = None   # SSH to this server for remote restore


@router.post("/database", response_model=RestoreJobResponse, dependencies=[Depends(verify_csrf)])
async def create_db_restore(
    data: DatabaseRestoreRequest,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("restore:execute"))],
):
    """Restore a database dump to the destination database.

    Finds the dump file from the completed DB backup run, then calls
    pg_restore / mysql / mongorestore — either locally or via SSH.
    """
    from app.core.security import encrypt_secret
    from app.models.entities import BackupType

    # Validate the backup run belongs to this org and is a completed DB backup
    run_result = await db.execute(
        select(BackupRun)
        .join(Backup, BackupRun.backup_id == Backup.id)
        .where(
            BackupRun.id == data.backup_run_id,
            Backup.organization_id == membership.organization_id,
            Backup.backup_type == BackupType.DATABASE,
        )
    )
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="DB backup run not found")
    if run.status.value != "completed":
        raise HTTPException(status_code=400, detail=f"Backup run is {run.status.value}, not completed")

    # Locate the dump file. Newer runs store the exact path in metadata_json;
    # older runs only have snapshot_id under backup.target_path.
    backup = await db.get(Backup, run.backup_id)
    if not backup or not backup.target_path:
        raise HTTPException(status_code=404, detail="Backup record missing target path")

    dump_file = (run.metadata_json or {}).get("dump_file") if run.metadata_json else None
    if not dump_file and run.snapshot_id:
        dump_file = os.path.join(backup.target_path, run.snapshot_id)
    if not dump_file:
        raise HTTPException(status_code=400, detail="Dump file path could not be determined")

    # Encrypt destination password before storing in RestoreJob metadata
    encrypted_pw = encrypt_secret(data.db_password) if data.db_password else ""

    job = RestoreJob(
        backup_id=backup.id,
        backup_run_id=run.id,
        initiated_by_id=membership.user_id,
        status=JobStatus.PENDING,
        target_path=dump_file,        # informational — actual target is the DB
        overwrite_protection=False,
        restore_confidence=80,
        estimated_duration_seconds=60,
        dependency_warnings=[],
        corruption_risks=[],
        ai_analysis_json={
            "restore_type": "database",
            "dump_file": dump_file,
            "db_type": data.db_type,
            "db_host": data.db_host,
            "db_port": data.db_port,
            "db_user": data.db_user,
            "db_password_enc": encrypted_pw,
            "db_name": data.db_name,
            "dest_server_id": str(data.dest_server_id) if data.dest_server_id else None,
        },
    )
    db.add(job)
    await db.flush()
    await create_log(
        db, membership.organization_id, "restore",
        f"DB restore job created: {data.db_type}/{data.db_name}",
        backup_id=backup.id,
    )
    await db.commit()
    task = execute_db_restore_job.delay(str(job.id))
    job.celery_task_id = task.id
    await db.commit()
    await db.refresh(job)
    return RestoreJobResponse.model_validate(job)
