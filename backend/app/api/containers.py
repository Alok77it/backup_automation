"""
Container Management API
========================
Lists cached container state and submits remote Docker actions through the
server agent. Runtime changes are queued as DevOps jobs.
"""

from __future__ import annotations

import uuid
import json
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.dependencies import DbSession, OrgMembership, require_permission, verify_csrf
from app.core.security import decrypt_secret
from app.models.devops_entities import RiskLevel, StoredCredential
from app.models.entities import OrganizationMember, Server
from app.services.agent_comm import agent_comm
from app.services.container_service import container_service
from app.services.execution_engine import execution_engine
from app.services.ssh_service import run_ssh_command_sync

router = APIRouter(prefix="/containers", tags=["Container Management"])


class ContainerSnapshotOut(BaseModel):
    id: uuid.UUID
    server_id: uuid.UUID
    container_id: str
    name: str
    image: str
    image_tag: str | None
    state: str
    status: str | None
    exit_code: int | None
    ports: dict | None
    labels: dict | None
    cpu_percent: float | None
    memory_mb: float | None
    memory_limit_mb: float | None
    started_at: datetime | None
    finished_at: datetime | None
    captured_at: datetime

    model_config = {"from_attributes": True}


class ContainerSummaryOut(BaseModel):
    total: int
    running: int = 0
    stopped: int = 0
    exited: int = 0
    dead: int = 0
    paused: int = 0
    restarting: int = 0


class AgentActionRequest(BaseModel):
    agent_token_raw: str | None = None
    agent_credential_id: uuid.UUID | None = None
    agent_port: int = 9977


class ContainerCreateRequest(AgentActionRequest):
    server_id: uuid.UUID
    name: str
    image: str
    ports: list[str] = []
    env: list[str] = []
    volumes: list[str] = []
    restart_policy: str = "unless-stopped"
    docker_username: str | None = None
    docker_token: str | None = None
    docker_registry: str | None = None
    docker_credential_id: uuid.UUID | None = None


class ComposeDeployRequest(AgentActionRequest):
    server_id: uuid.UUID
    project_name: str = "managed-compose"
    compose_content: str


class ContainerActionRequest(AgentActionRequest):
    server_id: uuid.UUID
    container_name: str
    force: bool = True


class ContainerReadRequest(AgentActionRequest):
    server_id: uuid.UUID
    container_name: str


class ContainerExecRequest(ContainerReadRequest):
    command: str
    shell: str = "/bin/sh"
    timeout_seconds: int = 60


async def _credential_secret(
    db: DbSession,
    *,
    organization_id: uuid.UUID,
    credential_id: uuid.UUID,
    provider: str,
) -> tuple[StoredCredential, str]:
    result = await db.execute(
        select(StoredCredential).where(
            StoredCredential.id == credential_id,
            StoredCredential.organization_id == organization_id,
            StoredCredential.provider == provider,
            StoredCredential.is_active == True,
        )
    )
    cred = result.scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=404, detail=f"{provider} credential not found")
    return cred, decrypt_secret(cred.encrypted_secret)


async def _resolve_agent_token(db: DbSession, membership: OrganizationMember, body: AgentActionRequest) -> str:
    if body.agent_token_raw:
        return body.agent_token_raw
    if body.agent_credential_id:
        _, token = await _credential_secret(
            db,
            organization_id=membership.organization_id,
            credential_id=body.agent_credential_id,
            provider="agent",
        )
        return token
    raise HTTPException(status_code=400, detail="agent_token_raw or agent_credential_id is required")


async def _refresh_snapshots_via_ssh(db: DbSession, membership: OrganizationMember, server_id: uuid.UUID) -> None:
    server = await db.get(Server, server_id)
    if not server or server.organization_id != membership.organization_id:
        return
    password = decrypt_secret(server.encrypted_password) if server.encrypted_password else None
    private_key = decrypt_secret(server.encrypted_private_key) if server.encrypted_private_key else None
    if not password and not private_key:
        return

    import asyncio

    command = "docker ps -a --format '{{json .}}'"
    try:
        exit_code, stdout, _stderr = await asyncio.to_thread(
            run_ssh_command_sync,
            server.hostname,
            server.port,
            server.username,
            command,
            password,
            private_key,
            server.auth_method,
            60,
        )
    except Exception:
        return
    if exit_code != 0:
        return

    containers = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            containers.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    await container_service.refresh_snapshots(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
        raw_containers=containers,
    )


@router.get("", response_model=list[ContainerSnapshotOut])
async def list_containers(
    db: DbSession,
    membership: OrgMembership,
    server_id: uuid.UUID | None = None,
    state: str | None = None,
    limit: int = 200,
    offset: int = 0,
):
    """List cached container snapshots."""
    if server_id:
        await _refresh_snapshots_via_ssh(db, membership, server_id)
    return await container_service.get_snapshots(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
        state_filter=state,
        limit=limit,
        offset=offset,
    )


@router.get("/summary", response_model=ContainerSummaryOut)
async def container_summary(
    db: DbSession,
    membership: OrgMembership,
    server_id: uuid.UUID | None = None,
):
    """Dashboard summary: container counts by state."""
    if server_id:
        await _refresh_snapshots_via_ssh(db, membership, server_id)
    summary = await container_service.get_summary(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
    )
    return ContainerSummaryOut(**summary)


@router.post("/refresh/{server_id}", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(verify_csrf)])
async def trigger_container_refresh(
    server_id: uuid.UUID,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:read"))
    ],
):
    """Submit a LOW-risk container_poll job to immediately refresh container state."""
    job = await execution_engine.submit_job(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
        created_by=membership.user_id,
        job_type="container_poll",
        risk_level=RiskLevel.LOW,
        timeout_seconds=60,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "Container refresh scheduled", "job_id": str(job.id)}


@router.post("/restart/{server_id}/{container_name}", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(verify_csrf)])
async def restart_container(
    server_id: uuid.UUID,
    container_name: str,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    """Submit a MEDIUM-risk job to restart a container."""
    job = await execution_engine.submit_job(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
        created_by=membership.user_id,
        job_type="agent_command",
        payload={
            "command": "container_restart",
            "args": {"container_name": container_name},
        },
        risk_level=RiskLevel.MEDIUM,
        timeout_seconds=120,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "Restart job submitted", "job_id": str(job.id)}


async def _submit_container_command(
    *,
    db: DbSession,
    request: Request,
    membership: OrganizationMember,
    server_id: uuid.UUID,
    command: str,
    args: dict,
    risk_level: RiskLevel = RiskLevel.MEDIUM,
    timeout_seconds: int = 300,
):
    job = await execution_engine.submit_job(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
        created_by=membership.user_id,
        job_type="agent_command",
        payload={
            "command": command,
            "args": args,
            "_agent_token_raw": args.pop("_agent_token_raw"),
            "agent_port": args.pop("agent_port", 9977),
        },
        risk_level=risk_level,
        timeout_seconds=timeout_seconds,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": f"{command} job submitted", "job_id": str(job.id), "approval_id": str(job.approval_id) if job.approval_id else None}


@router.post("/create", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(verify_csrf)])
async def create_container(
    body: ContainerCreateRequest,
    db: DbSession,
    request: Request,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:write"))],
):
    args = body.model_dump()
    token = await _resolve_agent_token(db, membership, body)
    args.pop("agent_token_raw", None)
    args.pop("agent_credential_id", None)
    port = args.pop("agent_port")
    server_id = args.pop("server_id")
    docker_credential_id = args.pop("docker_credential_id", None)
    if docker_credential_id:
        docker_cred, docker_secret = await _credential_secret(
            db,
            organization_id=membership.organization_id,
            credential_id=docker_credential_id,
            provider="docker",
        )
        args["docker_username"] = docker_cred.username
        args["docker_token"] = docker_secret
        args["docker_registry"] = docker_cred.registry_url or args.get("docker_registry")
    args["_agent_token_raw"] = token
    args["agent_port"] = port
    return await _submit_container_command(
        db=db,
        request=request,
        membership=membership,
        server_id=server_id,
        command="container_create",
        args=args,
        risk_level=RiskLevel.MEDIUM,
        timeout_seconds=600,
    )


@router.post("/compose/up", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(verify_csrf)])
async def compose_up(
    body: ComposeDeployRequest,
    db: DbSession,
    request: Request,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:write"))],
):
    token = await _resolve_agent_token(db, membership, body)
    return await _submit_container_command(
        db=db,
        request=request,
        membership=membership,
        server_id=body.server_id,
        command="docker_compose_up",
        args={
            "install_path": f"/opt/managed-compose/{body.project_name}",
            "compose_content": body.compose_content,
            "_agent_token_raw": token,
            "agent_port": body.agent_port,
        },
        risk_level=RiskLevel.MEDIUM,
        timeout_seconds=900,
    )


@router.post("/action/{action}", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(verify_csrf)])
async def container_action(
    action: str,
    body: ContainerActionRequest,
    db: DbSession,
    request: Request,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:write"))],
):
    command_map = {
        "start": "container_start",
        "stop": "container_stop",
        "restart": "container_restart",
        "delete": "container_remove",
    }
    command = command_map.get(action)
    if not command:
        raise HTTPException(status_code=400, detail="Invalid container action")
    token = await _resolve_agent_token(db, membership, body)
    return await _submit_container_command(
        db=db,
        request=request,
        membership=membership,
        server_id=body.server_id,
        command=command,
        args={
            "container_name": body.container_name,
            "force": body.force,
            "_agent_token_raw": token,
            "agent_port": body.agent_port,
        },
        risk_level=RiskLevel.MEDIUM,
        timeout_seconds=300,
    )


async def _run_container_command_now(
    *,
    db: DbSession,
    membership: OrganizationMember,
    body: AgentActionRequest,
    server_id: uuid.UUID,
    command: str,
    args: dict,
    timeout_seconds: int = 60,
):
    server = await db.get(Server, server_id)
    if not server or server.organization_id != membership.organization_id:
        raise HTTPException(status_code=404, detail="Server not found")
    token = await _resolve_agent_token(db, membership, body)
    response = await agent_comm.execute(
        server_hostname=server.hostname,
        server_port=body.agent_port,
        agent_token_raw=token,
        command=command,
        args=args,
        timeout_seconds=timeout_seconds,
    )
    return {
        "success": response.success,
        "exit_code": response.exit_code,
        "output": response.output,
        "duration_ms": response.duration_ms,
    }


@router.post("/inspect", dependencies=[Depends(verify_csrf)])
async def inspect_container(
    body: ContainerReadRequest,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:read"))],
):
    return await _run_container_command_now(
        db=db,
        membership=membership,
        body=body,
        server_id=body.server_id,
        command="container_inspect",
        args={"container_name": body.container_name},
        timeout_seconds=60,
    )


@router.post("/logs", dependencies=[Depends(verify_csrf)])
async def container_logs(
    body: ContainerReadRequest,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:read"))],
):
    return await _run_container_command_now(
        db=db,
        membership=membership,
        body=body,
        server_id=body.server_id,
        command="container_logs",
        args={"container_name": body.container_name},
        timeout_seconds=60,
    )


@router.post("/exec", dependencies=[Depends(verify_csrf)])
async def exec_container(
    body: ContainerExecRequest,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:write"))],
):
    return await _run_container_command_now(
        db=db,
        membership=membership,
        body=body,
        server_id=body.server_id,
        command="container_exec",
        args={
            "container_name": body.container_name,
            "command": body.command,
            "shell": body.shell,
        },
        timeout_seconds=body.timeout_seconds,
    )
