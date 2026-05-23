import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import (
    AlertSeverity,
    Backup,
    BackupRun,
    JobStatus,
    Organization,
    Server,
    ServerStatus,
    StorageUsage,
)
from app.services.health_engine import calculate_backup_health
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


def _sync_session() -> Session:
    sync_url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    if "psycopg2" not in sync_url:
        sync_url = sync_url.replace("postgresql://", "postgresql+psycopg2://")
    engine = create_engine(sync_url)
    return Session(engine)


def _dir_size(path: str) -> int:
    total = 0
    if not os.path.exists(path):
        return 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


@celery_app.task
def update_all_health_scores() -> dict:
    session = _sync_session()
    updated = 0
    try:
        backups = session.execute(select(Backup)).scalars().all()
        for backup in backups:
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
            updated += 1
        session.commit()
        return {"updated": updated}
    finally:
        session.close()


@celery_app.task
def record_storage_usage() -> dict:
    session = _sync_session()
    recorded = 0
    try:
        orgs = session.execute(select(Organization)).scalars().all()
        for org in orgs:
            org_path = os.path.join(settings.BACKUP_STORAGE_PATH, str(org.id))
            used = _dir_size(org_path)
            backup_count = session.execute(
                select(func.count(Backup.id)).where(Backup.organization_id == org.id)
            ).scalar() or 0
            compressed = int(used * 0.7)
            entry = StorageUsage(
                organization_id=org.id,
                total_bytes=int(org.storage_quota_gb * 1024**3),
                used_bytes=used,
                compressed_bytes=compressed,
                redundant_bytes=max(0, used - compressed),
                backup_count=backup_count,
                compression_ratio=used / compressed if compressed else 1.0,
            )
            session.add(entry)
            recorded += 1
        session.commit()
        return {"recorded": recorded}
    finally:
        session.close()


@celery_app.task
def check_system_alerts() -> dict:
    session = _sync_session()
    from app.models.entities import Alert

    alerts_created = 0
    try:
        orgs = session.execute(select(Organization)).scalars().all()
        for org in orgs:
            org_path = os.path.join(settings.BACKUP_STORAGE_PATH, str(org.id))
            used = _dir_size(org_path)
            quota = int(org.storage_quota_gb * 1024**3)
            if quota > 0 and used / quota > 0.85:
                existing = session.execute(
                    select(Alert).where(
                        Alert.organization_id == org.id,
                        Alert.alert_type == "low_storage",
                        Alert.is_resolved == False,
                        Alert.created_at > datetime.now(timezone.utc) - timedelta(hours=24),
                    )
                ).scalar_one_or_none()
                if not existing:
                    alert = Alert(
                        organization_id=org.id,
                        title="Low Storage Warning",
                        message=f"Storage usage at {used/quota*100:.1f}% of quota",
                        alert_type="low_storage",
                        severity=AlertSeverity.WARNING,
                    )
                    session.add(alert)
                    alerts_created += 1

            failed = session.execute(
                select(func.count(BackupRun.id))
                .join(Backup)
                .where(
                    Backup.organization_id == org.id,
                    BackupRun.status == JobStatus.FAILED,
                    BackupRun.started_at > datetime.now(timezone.utc) - timedelta(hours=24),
                )
            ).scalar() or 0
            if failed > 0:
                existing = session.execute(
                    select(Alert).where(
                        Alert.organization_id == org.id,
                        Alert.alert_type == "failed_backup",
                        Alert.is_resolved == False,
                        Alert.created_at > datetime.now(timezone.utc) - timedelta(hours=6),
                    )
                ).scalar_one_or_none()
                if not existing:
                    alert = Alert(
                        organization_id=org.id,
                        title="Backup Failures Detected",
                        message=f"{failed} backup job(s) failed in the last 24 hours",
                        alert_type="failed_backup",
                        severity=AlertSeverity.ERROR,
                    )
                    session.add(alert)
                    alerts_created += 1

            offline = session.execute(
                select(func.count(Server.id)).where(
                    Server.organization_id == org.id,
                    Server.status == ServerStatus.OFFLINE,
                )
            ).scalar() or 0
            if offline > 0:
                existing = session.execute(
                    select(Alert).where(
                        Alert.organization_id == org.id,
                        Alert.alert_type == "disconnected_server",
                        Alert.is_resolved == False,
                        Alert.created_at > datetime.now(timezone.utc) - timedelta(hours=12),
                    )
                ).scalar_one_or_none()
                if not existing:
                    alert = Alert(
                        organization_id=org.id,
                        title="Servers Disconnected",
                        message=f"{offline} server(s) are offline",
                        alert_type="disconnected_server",
                        severity=AlertSeverity.WARNING,
                    )
                    session.add(alert)
                    alerts_created += 1

            high_risk = session.execute(
                select(func.count(Backup.id)).where(
                    Backup.organization_id == org.id,
                    Backup.corruption_probability > 0.4,
                )
            ).scalar() or 0
            if high_risk > 0:
                existing = session.execute(
                    select(Alert).where(
                        Alert.organization_id == org.id,
                        Alert.alert_type == "corruption_risk",
                        Alert.is_resolved == False,
                        Alert.created_at > datetime.now(timezone.utc) - timedelta(hours=24),
                    )
                ).scalar_one_or_none()
                if not existing:
                    alert = Alert(
                        organization_id=org.id,
                        title="Corruption Risk Detected",
                        message=f"{high_risk} backup(s) have elevated corruption probability",
                        alert_type="corruption_risk",
                        severity=AlertSeverity.CRITICAL,
                    )
                    session.add(alert)
                    alerts_created += 1

        session.commit()
        return {"alerts_created": alerts_created}
    finally:
        session.close()
