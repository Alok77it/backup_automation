import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import MetricSnapshot, Server, ServerStatus
from app.services.ssh_service import collect_remote_metrics
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


def _sync_session() -> Session:
    sync_url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    if not sync_url.startswith("postgresql+psycopg2"):
        sync_url = sync_url.replace("postgresql://", "postgresql+psycopg2://")
    engine = create_engine(sync_url)
    return Session(engine)


@celery_app.task
def collect_server_metrics(server_id: str) -> dict:
    session = _sync_session()
    try:
        server = session.get(Server, uuid.UUID(server_id))
        if not server:
            return {"error": "not found"}

        metrics = asyncio.run(
            collect_remote_metrics(
                server.hostname,
                server.port,
                server.username,
                server.encrypted_password,
                server.encrypted_private_key,
                server.auth_method,
            )
        )

        if metrics:
            snapshot = MetricSnapshot(
                organization_id=server.organization_id,
                server_id=server.id,
                cpu_percent=metrics.cpu_percent,
                memory_percent=metrics.memory_percent,
                disk_percent=metrics.disk_percent,
                disk_read_mb_s=metrics.disk_read_mb_s,
                disk_write_mb_s=metrics.disk_write_mb_s,
                network_in_mb_s=metrics.network_in_mb_s,
                network_out_mb_s=metrics.network_out_mb_s,
                uptime_seconds=metrics.uptime_seconds,
            )
            server.status = ServerStatus.ONLINE
            server.last_seen_at = datetime.now(timezone.utc)
            server.os_info = metrics.os_info
            session.add(snapshot)
        else:
            server.status = ServerStatus.OFFLINE

        session.commit()
        return {"server_id": server_id, "status": server.status.value}
    finally:
        session.close()


@celery_app.task
def collect_all_metrics() -> dict:
    session = _sync_session()
    count = 0
    try:
        servers = session.execute(select(Server)).scalars().all()
        for server in servers:
            collect_server_metrics.delay(str(server.id))
            count += 1
        return {"queued": count}
    finally:
        session.close()
