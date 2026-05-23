import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.core.dependencies import DbSession, require_permission
from app.models.entities import OrganizationMember
from app.models.entities import BackupRun, MetricSnapshot
from app.schemas.resources import MetricResponse

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


@router.get("/metrics")
async def get_metrics(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:read"))],
    server_id: uuid.UUID | None = None,
    hours: int = 24,
):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    query = select(MetricSnapshot).where(
        MetricSnapshot.organization_id == membership.organization_id,
        MetricSnapshot.recorded_at >= since,
    )
    if server_id:
        query = query.where(MetricSnapshot.server_id == server_id)
    result = await db.execute(query.order_by(MetricSnapshot.recorded_at.asc()).limit(500))
    return [MetricResponse.model_validate(m) for m in result.scalars().all()]


@router.get("/throughput")
async def get_throughput(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("backup:read"))],
    hours: int = 24,
):
    from app.models.entities import Backup

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(BackupRun)
        .join(Backup)
        .where(Backup.organization_id == membership.organization_id, BackupRun.started_at >= since)
        .order_by(BackupRun.started_at.asc())
    )
    runs = result.scalars().all()
    return [
        {
            "timestamp": r.started_at.isoformat() if r.started_at else None,
            "bytes_added": r.bytes_added,
            "duration_seconds": r.duration_seconds,
            "throughput_mb_s": (r.bytes_added / 1024 / 1024 / r.duration_seconds) if r.duration_seconds else 0,
            "type": "backup",
        }
        for r in runs
    ]


@router.get("/aggregated")
async def get_aggregated_metrics(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:read"))],
):
    result = await db.execute(
        select(MetricSnapshot)
        .where(MetricSnapshot.organization_id == membership.organization_id)
        .order_by(MetricSnapshot.recorded_at.desc())
        .limit(100)
    )
    snapshots = result.scalars().all()
    if not snapshots:
        return {"cpu": 0, "memory": 0, "disk": 0, "network_in": 0, "network_out": 0, "io_read": 0, "io_write": 0}

    return {
        "cpu": sum(s.cpu_percent or 0 for s in snapshots) / len(snapshots),
        "memory": sum(s.memory_percent or 0 for s in snapshots) / len(snapshots),
        "disk": sum(s.disk_percent or 0 for s in snapshots) / len(snapshots),
        "network_in": sum(s.network_in_mb_s or 0 for s in snapshots) / len(snapshots),
        "network_out": sum(s.network_out_mb_s or 0 for s in snapshots) / len(snapshots),
        "io_read": sum(s.disk_read_mb_s or 0 for s in snapshots) / len(snapshots),
        "io_write": sum(s.disk_write_mb_s or 0 for s in snapshots) / len(snapshots),
        "backup_throughput": sum(s.backup_throughput_mb_s or 0 for s in snapshots) / len(snapshots),
        "restore_throughput": sum(s.restore_throughput_mb_s or 0 for s in snapshots) / len(snapshots),
    }
