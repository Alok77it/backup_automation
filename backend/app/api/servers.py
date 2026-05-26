import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import DbSession, require_permission, verify_csrf
from app.models.entities import OrganizationMember
from app.core.security import encrypt_secret
from app.models.entities import Backup, MetricSnapshot, Server, ServerStatus
from app.models.devops_entities import DevOpsJob
from app.schemas.resources import ServerConnectionTest, ServerCreate, ServerResponse, ServerUpdate
from app.services.audit import log_audit
from app.services.logging_service import create_log
from app.services.ssh_service import test_ssh_connection
from app.workers.monitor_tasks import collect_server_metrics

router = APIRouter(prefix="/servers", tags=["servers"])


async def _server_to_response(db: AsyncSession, server: Server) -> ServerResponse:
    metric_result = await db.execute(
        select(MetricSnapshot)
        .where(MetricSnapshot.server_id == server.id)
        .order_by(MetricSnapshot.recorded_at.desc())
        .limit(1)
    )
    metric = metric_result.scalar_one_or_none()
    return ServerResponse(
        id=server.id,
        name=server.name,
        hostname=server.hostname,
        port=server.port,
        username=server.username,
        auth_method=server.auth_method,
        status=server.status.value,
        os_info=server.os_info,
        last_seen_at=server.last_seen_at,
        created_at=server.created_at,
        cpu_percent=metric.cpu_percent if metric else None,
        memory_percent=metric.memory_percent if metric else None,
        disk_percent=metric.disk_percent if metric else None,
    )


@router.get("", response_model=list[ServerResponse])
async def list_servers(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:read"))],
):
    result = await db.execute(
        select(Server).where(Server.organization_id == membership.organization_id).order_by(Server.created_at.desc())
    )
    servers = result.scalars().all()
    return [await _server_to_response(db, s) for s in servers]


@router.post("", response_model=ServerResponse, dependencies=[Depends(verify_csrf)])
async def create_server(
    request: Request,
    data: ServerCreate,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:write"))],
):
    server = Server(
        organization_id=membership.organization_id,
        name=data.name,
        hostname=data.hostname,
        port=data.port,
        username=data.username,
        auth_method=data.auth_method,
        encrypted_password=encrypt_secret(data.password) if data.password else None,
        encrypted_private_key=encrypt_secret(data.private_key) if data.private_key else None,
        status=ServerStatus.UNKNOWN,
    )
    db.add(server)
    await db.flush()
    await log_audit(
        db,
        membership.organization_id,
        "server.create",
        "server",
        membership.user_id,
        str(server.id),
        ip_address=request.client.host if request.client else None,
    )
    await create_log(db, membership.organization_id, "infrastructure", f"Server {server.name} added", server_id=server.id)
    return await _server_to_response(db, server)


@router.post("/{server_id}/test", response_model=ServerConnectionTest, dependencies=[Depends(verify_csrf)])
async def test_connection(
    server_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:write"))],
):
    result = await db.execute(
        select(Server).where(Server.id == server_id, Server.organization_id == membership.organization_id)
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    success, message, os_info, latency = await test_ssh_connection(
        server.hostname,
        server.port,
        server.username,
        server.encrypted_password,
        server.encrypted_private_key,
        server.auth_method,
    )
    if success:
        server.status = ServerStatus.ONLINE
        server.os_info = os_info
    else:
        server.status = ServerStatus.ERROR
    await db.flush()
    return ServerConnectionTest(success=success, message=message, os_info=os_info, latency_ms=latency)


@router.post("/{server_id}/collect-metrics", dependencies=[Depends(verify_csrf)])
async def trigger_metrics(
    server_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:read"))],
):
    result = await db.execute(
        select(Server).where(Server.id == server_id, Server.organization_id == membership.organization_id)
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    collect_server_metrics.delay(str(server.id))
    return {"message": "Metrics collection queued"}


@router.delete("/{server_id}", dependencies=[Depends(verify_csrf)])
async def delete_server(
    server_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:delete"))],
):
    result = await db.execute(
        select(Server).where(Server.id == server_id, Server.organization_id == membership.organization_id)
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    await db.execute(
        update(Backup)
        .where(
            Backup.organization_id == membership.organization_id,
            (Backup.server_id == server_id) | (Backup.destination_server_id == server_id),
        )
        .values(is_active=False)
    )
    job_result = await db.execute(
        select(DevOpsJob).where(
            DevOpsJob.organization_id == membership.organization_id,
            DevOpsJob.server_id == server_id,
        )
    )
    for job in job_result.scalars().all():
        if job.celery_task_id:
            try:
                from app.workers.celery_app import celery_app
                celery_app.control.revoke(job.celery_task_id, terminate=True)
            except Exception:
                pass
        await db.delete(job)
    await db.delete(server)
    return {"message": "Server deleted"}
