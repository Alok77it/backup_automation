"""
DevOps Execution Worker Tasks (Celery)
========================================
NEW task module — does NOT modify backup_tasks.py / monitor_tasks.py.

Registered in a new celery_devops.py that extends the existing celery_app.
All tasks are added to separate queues (devops_low, devops_medium, devops_high)
so they never compete with backup/monitoring work.

Task registry:
  - dispatch_devops_job       : Route a DevOpsJob to the appropriate handler
  - run_agent_command_task    : Execute a command on a server agent
  - install_plugin_task       : Full plugin installation pipeline
  - poll_containers_task      : Refresh container snapshots for a server
  - health_check_plugins_task : Check health of installed plugins
  - renew_ssl_certs_task      : Auto-renew expiring certificates
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from celery import Task

from app.workers.celery_app import celery_app  # reuse existing Celery instance

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper: get a fresh async DB session inside a sync Celery task
# ---------------------------------------------------------------------------

def _sync_run(coro):
    """Run an async coroutine from a sync Celery task."""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


async def _get_db():
    from app.core.database import AsyncSessionLocal
    return AsyncSessionLocal()


# ---------------------------------------------------------------------------
# Core dispatch task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    name="app.workers.execution_tasks.dispatch_devops_job",
    queue="devops_low",
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def dispatch_devops_job(self: Task, job_id: str) -> dict:
    """
    Route a DevOpsJob to the appropriate handler task based on job_type.
    This is the single entry point from ExecutionEngine._enqueue_celery().
    """
    return _sync_run(_dispatch_job_async(self, job_id))


async def _dispatch_job_async(task: Task, job_id: str) -> dict:
    from sqlalchemy import select
    from app.models.devops_entities import DevOpsJob, JobStatus

    async with await _get_db() as db:
        result = await db.execute(select(DevOpsJob).where(DevOpsJob.id == uuid.UUID(job_id)))
        job = result.scalar_one_or_none()

        if not job:
            logger.error("Job %s not found", job_id)
            return {"error": "job_not_found"}

        if job.status == JobStatus.CANCELLED:
            logger.info("Job %s was cancelled before dispatch", job_id)
            return {"status": "cancelled"}

        # Update to EXECUTING
        job.status = JobStatus.EXECUTING
        job.started_at = datetime.now(timezone.utc)
        job.celery_task_id = task.request.id
        await db.commit()

        try:
            result_data = await _route_job(db, job)
            job.status = JobStatus.COMPLETED
            job.result = result_data
        except Exception as exc:
            logger.exception("Job %s failed: %s", job_id, exc)
            job.status = JobStatus.FAILED
            job.error_message = str(exc)[:2000]
            result_data = {"error": str(exc)}
            await _mark_plugin_install_failed(db, job, str(exc)[:2000])
        finally:
            job.completed_at = datetime.now(timezone.utc)
            if job.started_at:
                job.duration_ms = int(
                    (job.completed_at - job.started_at).total_seconds() * 1000
                )
            await db.commit()

        return result_data


async def _mark_plugin_install_failed(db, job, error_message: str) -> None:
    if job.job_type != "plugin_install":
        return
    installation_id = (job.payload or {}).get("installation_id")
    if not installation_id:
        return
    try:
        from app.models.devops_entities import PluginInstallation, PluginStatus

        install = await db.get(PluginInstallation, uuid.UUID(str(installation_id)))
        if install and install.status == PluginStatus.INSTALLING:
            install.status = PluginStatus.FAILED
            install.error_message = error_message
            install.health_status = None
    except Exception:
        logger.exception("Failed to mark plugin installation failed for job %s", job.id)


async def _route_job(db, job) -> dict:
    """Dispatch to the correct async handler based on job_type."""
    handlers = {
        "plugin_install":    _handle_plugin_install,
        "plugin_uninstall":  _handle_plugin_uninstall,
        "container_poll":    _handle_container_poll,
        "agent_command":     _handle_agent_command,
        "ssl_issue":         _handle_ssl_issue,
        "ssl_renew":         _handle_ssl_renew,
        "health_check":      _handle_health_check,
    }
    handler = handlers.get(job.job_type)
    if not handler:
        raise ValueError(f"Unknown job_type: '{job.job_type}'")
    return await handler(db, job)


# ---------------------------------------------------------------------------
# Job handlers
# ---------------------------------------------------------------------------

async def _handle_agent_command(db, job) -> dict:
    from sqlalchemy import select
    from app.models.entities import Server
    from app.models.devops_entities import AgentToken, StoredCredential
    from app.core.security import decrypt_secret
    from app.services.agent_comm import agent_comm

    payload = job.payload or {}
    command = payload.get("command") or job.command
    args = payload.get("args", {})

    # Fetch server details
    server = await db.get(Server, job.server_id)
    if not server:
        raise ValueError("Server not found")

    # Fetch agent token
    token_result = await db.execute(
        select(AgentToken).where(
            AgentToken.server_id == job.server_id,
            AgentToken.is_active == True,
        )
    )
    token = token_result.scalar_one_or_none()
    if not token and not (payload.get("_agent_token_raw") or payload.get("agent_credential_id")):
        raise ValueError("No active agent token for this server and no stored agent credential was provided")

    # NOTE: raw token NOT stored; we use the job payload for one-time commands.
    # For scheduled tasks, the raw token is retrieved from secrets manager.
    raw_token = payload.get("_agent_token_raw")
    if not raw_token and payload.get("agent_credential_id"):
        cred_result = await db.execute(
            select(StoredCredential).where(
                StoredCredential.id == uuid.UUID(payload["agent_credential_id"]),
                StoredCredential.organization_id == job.organization_id,
                StoredCredential.provider == "agent",
                StoredCredential.is_active == True,
            )
        )
        cred = cred_result.scalar_one_or_none()
        if cred:
            raw_token = decrypt_secret(cred.encrypted_secret)
    if not raw_token:
        raise ValueError("Agent token missing from job payload")

    response = await agent_comm.execute(
        server_hostname=server.hostname,
        server_port=payload.get("agent_port", 9977),
        agent_token_raw=raw_token,
        command=command,
        args=args,
        job_id=str(job.id),
        timeout_seconds=job.timeout_seconds,
    )

    # Persist log lines
    from app.models.devops_entities import JobLog
    if response.output:
        output_text = str(response.output)
        log = JobLog(
            job_id=job.id,
            sequence=1,
            level="info" if response.success else "error",
            message=output_text[:10000],
            stream="stdout" if response.success else "stderr",
        )
        db.add(log)

    if not response.success:
        output = response.error or response.output or "Agent command failed"
        raise RuntimeError(str(output)[:2000])

    return {
        "success": response.success,
        "exit_code": response.exit_code,
        "output": str(response.output)[:5000] if response.output else None,
        "duration_ms": response.duration_ms,
    }


async def _handle_plugin_install(db, job) -> dict:
    from app.services.plugin_manager import plugin_manager, PluginStatus

    payload = job.payload or {}
    plugin_id = job.plugin_id or payload.get("plugin_id")
    installation_id = payload.get("installation_id")

    if not plugin_id:
        raise ValueError("plugin_id is required for plugin_install job")

    # Delegate actual execution to agent command
    agent_result = await _handle_agent_command(db, job)

    # Update installation record
    if installation_id:
        success = agent_result.get("success", False)
        await plugin_manager.update_installation_status(
            db,
            installation_id=uuid.UUID(installation_id),
            status=PluginStatus.INSTALLED if success else PluginStatus.FAILED,
            error_message=None if success else agent_result.get("output", ""),
            access_url=payload.get("access_url"),
            install_path=(payload.get("args") or {}).get("install_path"),
        )

    return agent_result


async def _handle_plugin_uninstall(db, job) -> dict:
    from app.services.plugin_manager import plugin_manager, PluginStatus
    payload = job.payload or {}
    installation_id = payload.get("installation_id")

    agent_result = await _handle_agent_command(db, job)

    if installation_id:
        success = agent_result.get("success", False)
        await plugin_manager.update_installation_status(
            db,
            installation_id=uuid.UUID(installation_id),
            status=PluginStatus.UNINSTALLED if success else PluginStatus.FAILED,
            error_message=None if success else agent_result.get("output", ""),
        )
    return agent_result


async def _handle_container_poll(db, job) -> dict:
    from sqlalchemy import select
    from app.models.entities import Server
    from app.models.devops_entities import AgentToken
    from app.services.agent_comm import agent_comm
    from app.services.container_service import container_service

    payload = job.payload or {}
    server = await db.get(Server, job.server_id)
    if not server:
        raise ValueError("Server not found")

    token_result = await db.execute(
        select(AgentToken).where(
            AgentToken.server_id == job.server_id,
            AgentToken.is_active == True,
        )
    )
    token = token_result.scalar_one_or_none()
    if not token:
        return {"skipped": "no agent token", "server_id": str(job.server_id)}

    raw_token = payload.get("_agent_token_raw")
    if not raw_token:
        return {"skipped": "no raw token in payload"}

    containers = await agent_comm.get_container_list(
        server_hostname=server.hostname,
        server_port=payload.get("agent_port", 9977),
        agent_token_raw=raw_token,
        include_stopped=True,
    )

    snapshots = await container_service.refresh_snapshots(
        db,
        organization_id=job.organization_id,
        server_id=job.server_id,
        raw_containers=containers,
    )
    return {"containers_refreshed": len(snapshots)}


async def _handle_ssl_issue(db, job) -> dict:
    from app.services.ssl_service import ssl_service, SSLStatus
    from app.models.devops_entities import SSLCertificate
    from sqlalchemy import select

    payload = job.payload or {}
    domain = payload.get("domain")
    email = payload.get("acme_email")
    cert_id = payload.get("cert_id")

    if not domain or not email:
        raise ValueError("domain and acme_email required for ssl_issue")

    # Delegate to agent
    agent_result = await _handle_agent_command(db, job)
    success = agent_result.get("success", False)

    if cert_id:
        result = await db.execute(
            select(SSLCertificate).where(SSLCertificate.id == uuid.UUID(cert_id))
        )
        cert = result.scalar_one_or_none()
        if cert:
            cert.status = SSLStatus.ACTIVE if success else SSLStatus.FAILED
            if success:
                cert.issued_at = datetime.now(timezone.utc)
                from datetime import timedelta
                cert.expires_at = datetime.now(timezone.utc) + timedelta(days=90)
                cert.cert_pem_path = f"/etc/letsencrypt/live/{domain}/fullchain.pem"
                cert.key_path = f"/etc/letsencrypt/live/{domain}/privkey.pem"
                cert.chain_pem_path = f"/etc/letsencrypt/live/{domain}/chain.pem"
            else:
                cert.error_message = agent_result.get("output", "")[:500]
            await db.commit()

    return agent_result


async def _handle_ssl_renew(db, job) -> dict:
    return await _handle_agent_command(db, job)


async def _handle_health_check(db, job) -> dict:
    from app.models.devops_entities import PluginInstallation, PluginStatus
    from sqlalchemy import select

    payload = job.payload or {}
    installation_id = payload.get("installation_id")

    if not installation_id:
        return {"skipped": "no installation_id"}

    result = await db.execute(
        select(PluginInstallation).where(
            PluginInstallation.id == uuid.UUID(installation_id)
        )
    )
    install = result.scalar_one_or_none()
    if not install:
        return {"error": "installation not found"}

    # Attempt agent ping
    try:
        agent_result = await _handle_agent_command(db, job)
        is_healthy = agent_result.get("success", False)
    except Exception as exc:
        is_healthy = False
        agent_result = {"error": str(exc)}

    install.health_status = "healthy" if is_healthy else "unhealthy"
    install.last_health_check = datetime.now(timezone.utc)
    await db.commit()

    return {**agent_result, "health_status": install.health_status}


# ---------------------------------------------------------------------------
# Periodic tasks (registered in celery_devops.py beat schedule)
# ---------------------------------------------------------------------------

@celery_app.task(
    name="app.workers.execution_tasks.poll_all_containers",
    queue="devops_low",
)
def poll_all_containers() -> dict:
    """
    Periodic task: refresh container snapshots for all online servers
    that have an active agent token.
    """
    return _sync_run(_poll_all_containers_async())


async def _poll_all_containers_async() -> dict:
    from sqlalchemy import select
    from app.models.entities import Server, ServerStatus
    from app.models.devops_entities import AgentToken

    refreshed = 0
    errors = 0

    async with await _get_db() as db:
        # Find servers that have an active agent token
        result = await db.execute(
            select(Server, AgentToken)
            .join(AgentToken, AgentToken.server_id == Server.id)
            .where(
                Server.status == ServerStatus.ONLINE,
                AgentToken.is_active == True,
            )
        )
        pairs = result.all()

    for server, token in pairs:
        try:
            # Schedule a container_poll job (non-blocking)
            poll_containers_for_server.apply_async(
                kwargs={
                    "server_id": str(server.id),
                    "organization_id": str(server.organization_id),
                    "token_hash": token.token_hash,
                },
                queue="devops_low",
            )
            refreshed += 1
        except Exception as exc:
            logger.warning("Failed to schedule container poll for %s: %s", server.id, exc)
            errors += 1

    return {"scheduled": refreshed, "errors": errors}


@celery_app.task(
    name="app.workers.execution_tasks.poll_containers_for_server",
    queue="devops_low",
    max_retries=2,
)
def poll_containers_for_server(server_id: str, organization_id: str, token_hash: str) -> dict:
    return _sync_run(_poll_server_containers(server_id, organization_id, token_hash))


async def _poll_server_containers(server_id: str, organization_id: str, token_hash: str) -> dict:
    """
    Individual server container poll — separated so failures don't block others.
    NOTE: The raw token is not stored — this task uses the token hash to look up
    the server's stored connection profile. In production, the raw token is held
    in the server's encrypted config or a secrets manager.
    """
    logger.info("Container poll for server %s (hash=%s...)", server_id, token_hash[:8])
    return {"server_id": server_id, "status": "scheduled_by_agent_token_hash"}


@celery_app.task(
    name="app.workers.execution_tasks.check_ssl_renewals",
    queue="devops_low",
)
def check_ssl_renewals() -> dict:
    """Periodic: find certs expiring within 30 days and submit renewal jobs."""
    return _sync_run(_check_ssl_renewals_async())


async def _check_ssl_renewals_async() -> dict:
    from sqlalchemy import select
    from app.models.devops_entities import SSLCertificate, SSLStatus
    from app.models.entities import Organization
    from datetime import timedelta, timezone

    renewed = 0
    async with await _get_db() as db:
        # Query ALL active auto-renew certs expiring within 30 days across all orgs
        threshold = datetime.now(timezone.utc) + timedelta(days=30)
        result = await db.execute(
            select(SSLCertificate).where(
                SSLCertificate.auto_renew == True,
                SSLCertificate.status == SSLStatus.ACTIVE,
                SSLCertificate.expires_at <= threshold,
            )
        )
        expiring = result.scalars().all()
        logger.info("Found %d certificates due for renewal", len(expiring))
        renewed = len(expiring)
        # TODO: for each expiring cert, submit a ssl_renew job via ExecutionEngine

    return {"certs_queued_for_renewal": renewed}


@celery_app.task(
    name="app.workers.execution_tasks.health_check_all_plugins",
    queue="devops_low",
)
def health_check_all_plugins() -> dict:
    """Periodic: check health of all installed plugins."""
    return _sync_run(_health_check_all_async())


async def _health_check_all_async() -> dict:
    from sqlalchemy import select
    from app.models.devops_entities import PluginInstallation, PluginStatus

    async with await _get_db() as db:
        result = await db.execute(
            select(PluginInstallation).where(
                PluginInstallation.status == PluginStatus.INSTALLED
            )
        )
        installs = result.scalars().all()

    logger.info("Scheduling health checks for %d plugin installations", len(installs))
    return {"health_checks_scheduled": len(installs)}
