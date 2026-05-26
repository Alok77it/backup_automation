import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from app.core.dependencies import CurrentUser, DbSession, OrgMembership
from app.models.entities import Alert, AlertSeverity, Backup, BackupRun, JobStatus, MetricSnapshot, Server, StorageUsage
from app.schemas.common import DashboardStats, TimeSeriesPoint

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    db: DbSession,
    membership: OrgMembership,
):
    org_id = membership.organization_id
    since = datetime.now(timezone.utc) - timedelta(hours=24)

    servers = await db.scalar(select(func.count(Server.id)).where(Server.organization_id == org_id)) or 0
    active_backups = await db.scalar(
        select(func.count(Backup.id)).where(
            Backup.organization_id == org_id,
            Backup.is_active == True,
            Backup.server_id.is_not(None),
        )
    ) or 0
    failed_jobs = await db.scalar(
        select(func.count(BackupRun.id))
        .join(Backup)
        .where(
            Backup.organization_id == org_id,
            Backup.is_active == True,
            Backup.server_id.is_not(None),
            BackupRun.status == JobStatus.FAILED,
            BackupRun.started_at >= since,
        )
    ) or 0

    latest_storage = await db.execute(
        select(StorageUsage)
        .where(StorageUsage.organization_id == org_id)
        .order_by(StorageUsage.recorded_at.desc())
        .limit(1)
    )
    storage = latest_storage.scalar_one_or_none()
    used = storage.used_bytes if storage else 0
    quota = int(membership.organization.storage_quota_gb * 1024**3)

    restore_avg = await db.scalar(
        select(func.avg(Backup.restore_confidence)).where(
            Backup.organization_id == org_id,
            Backup.is_active == True,
            Backup.server_id.is_not(None),
        )
    ) or 0

    ai_alerts = await db.scalar(
        select(func.count(Alert.id)).where(
            Alert.organization_id == org_id,
            Alert.is_resolved == False,
            Alert.severity.in_([AlertSeverity.WARNING, AlertSeverity.ERROR, AlertSeverity.CRITICAL]),
        )
    ) or 0

    health_avg = await db.scalar(
        select(func.avg(Backup.health_score)).where(
            Backup.organization_id == org_id,
            Backup.is_active == True,
            Backup.server_id.is_not(None),
        )
    ) or 0

    return DashboardStats(
        total_servers=servers,
        active_backups=active_backups,
        failed_jobs_24h=failed_jobs,
        storage_used_bytes=used,
        storage_quota_bytes=quota,
        restore_readiness_avg=float(restore_avg),
        ai_risk_alerts=ai_alerts,
        backup_health_avg=float(health_avg),
    )


@router.get("/backup-trends")
async def get_backup_trends(db: DbSession, membership: OrgMembership, days: int = 30):
    org_id = membership.organization_id
    since = datetime.now(timezone.utc) - timedelta(days=days)
    result = await db.execute(
        select(
            func.date_trunc("day", BackupRun.started_at).label("day"),
            func.count(BackupRun.id).label("total"),
            func.count(BackupRun.id).filter(BackupRun.status == JobStatus.COMPLETED).label("success"),
            func.count(BackupRun.id).filter(BackupRun.status == JobStatus.FAILED).label("failed"),
        )
        .join(Backup)
        .where(
            Backup.organization_id == org_id,
            Backup.is_active == True,
            Backup.server_id.is_not(None),
            BackupRun.started_at >= since,
        )
        .group_by("day")
        .order_by("day")
    )
    rows = result.all()
    return [
        {
            "date": r.day.isoformat() if r.day else None,
            "total": r.total,
            "success": r.success,
            "failed": r.failed,
        }
        for r in rows
    ]


@router.get("/recent-events")
async def get_recent_events(db: DbSession, membership: OrgMembership, limit: int = 20):
    from app.models.entities import LogEntry

    org_id = membership.organization_id
    result = await db.execute(
        select(LogEntry).where(LogEntry.organization_id == org_id).order_by(LogEntry.created_at.desc()).limit(limit)
    )
    logs = result.scalars().all()
    return [
        {
            "id": str(l.id),
            "source": l.source,
            "level": l.level,
            "message": l.message,
            "created_at": l.created_at.isoformat(),
        }
        for l in logs
    ]


@router.get("/metrics/live")
async def get_live_metrics(db: DbSession, membership: OrgMembership):
    org_id = membership.organization_id
    result = await db.execute(
        select(MetricSnapshot)
        .where(MetricSnapshot.organization_id == org_id)
        .order_by(MetricSnapshot.recorded_at.desc())
        .limit(50)
    )
    snapshots = result.scalars().all()
    return [
        TimeSeriesPoint(
            timestamp=s.recorded_at,
            value=s.cpu_percent or 0,
            label="cpu",
        )
        for s in snapshots[:20]
    ]
