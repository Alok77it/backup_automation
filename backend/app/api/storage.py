import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.dependencies import DbSession, OrgMembership, require_permission
from app.models.entities import Backup, StorageUsage
from app.schemas.resources import StorageAnalytics

router = APIRouter(prefix="/storage", tags=["storage"])
settings = get_settings()


@router.get("/analytics", response_model=StorageAnalytics)
async def get_storage_analytics(
    db: DbSession,
    membership: OrgMembership = Depends(require_permission("backup:read")),
):
    org_id = membership.organization_id
    latest = await db.execute(
        select(StorageUsage).where(StorageUsage.organization_id == org_id).order_by(StorageUsage.recorded_at.desc()).limit(1)
    )
    storage = latest.scalar_one_or_none()

    org_path = os.path.join(settings.BACKUP_STORAGE_PATH, str(org_id))
    used = storage.used_bytes if storage else 0
    if not used and os.path.exists(org_path):
        used = sum(
            os.path.getsize(os.path.join(r, f))
            for r, _, files in os.walk(org_path)
            for f in files
            if os.path.exists(os.path.join(r, f))
        )

    quota = int(membership.organization.storage_quota_gb * 1024**3)
    backup_count = await db.scalar(select(func.count(Backup.id)).where(Backup.organization_id == org_id)) or 0

    since = datetime.now(timezone.utc) - timedelta(days=30)
    trend_result = await db.execute(
        select(StorageUsage)
        .where(StorageUsage.organization_id == org_id, StorageUsage.recorded_at >= since)
        .order_by(StorageUsage.recorded_at.asc())
    )
    trend = [
        {"date": s.recorded_at.isoformat(), "used_bytes": s.used_bytes, "compression_ratio": s.compression_ratio}
        for s in trend_result.scalars().all()
    ]

    return StorageAnalytics(
        total_bytes=quota,
        used_bytes=used,
        quota_bytes=quota,
        compression_ratio=storage.compression_ratio if storage else 1.0,
        redundant_bytes=storage.redundant_bytes if storage else 0,
        backup_count=backup_count,
        growth_trend=trend,
    )
