"""
Execution Engine API Router
=============================
Endpoints for submitting, monitoring, and cancelling DevOps jobs.
HIGH-risk jobs are routed through the approval system automatically.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.dependencies import DbSession, OrgMembership, require_permission, verify_csrf
from app.models.entities import OrganizationMember
from app.models.entities import Server
from app.models.devops_entities import DevOpsJob, JobLog, JobStatus, RiskLevel
from app.services.execution_engine import ExecutionEngine, ExecutionError, execution_engine

router = APIRouter(prefix="/execution", tags=["Execution Engine"])


class JobSubmitRequest(BaseModel):
    server_id: uuid.UUID
    job_type: str = Field(..., examples=["agent_command", "container_poll", "health_check"])
    command: str | None = None
    payload: dict | None = None
    plugin_id: str | None = None
    risk_level: RiskLevel = RiskLevel.LOW
    timeout_seconds: int = Field(300, ge=10, le=3600)


class JobOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    server_id: uuid.UUID | None
    job_type: str
    risk_level: str
    status: str
    requires_approval: bool
    approval_id: uuid.UUID | None
    celery_task_id: str | None
    result: dict | None
    error_message: str | None
    exit_code: int | None
    duration_ms: int | None
    queued_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class JobLogOut(BaseModel):
    sequence: int
    level: str
    message: str
    stream: str
    timestamp: datetime

    model_config = {"from_attributes": True}


@router.post("/jobs", response_model=JobOut, status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(verify_csrf)])
async def submit_job(
    body: JobSubmitRequest,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    """Submit a new DevOps job. HIGH-risk jobs create an approval request."""
    try:
        payload = body.payload or {}
        command = payload.get("command") or body.command
        if body.job_type == "agent_command" and command in {"package_install", "script_run_approved"}:
            has_agent_token = bool(payload.get("_agent_token_raw") or payload.get("agent_credential_id"))
            server = await db.get(Server, body.server_id)
            has_ssh_fallback = bool(server and (server.encrypted_password or server.encrypted_private_key))
            if not has_agent_token and not has_ssh_fallback:
                raise HTTPException(
                    status_code=400,
                    detail="No agent token or SSH credential configured. Select an agent credential, provide agent_token_raw, or add SSH credentials for this server.",
                )
        job = await execution_engine.submit_job(
            db,
            organization_id=membership.organization_id,
            server_id=body.server_id,
            created_by=membership.user_id,
            job_type=body.job_type,
            command=body.command,
            payload=body.payload,
            plugin_id=body.plugin_id,
            risk_level=body.risk_level,
            timeout_seconds=body.timeout_seconds,
            ip_address=request.client.host if request.client else None,
        )
        return job
    except ExecutionError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/jobs", response_model=list[JobOut])
async def list_jobs(
    db: DbSession,
    membership: OrgMembership,
    server_id: uuid.UUID | None = None,
    status_filter: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    await execution_engine.recover_stuck_jobs(
        db,
        organization_id=membership.organization_id,
    )
    stmt = select(DevOpsJob).where(DevOpsJob.organization_id == membership.organization_id)
    if server_id:
        stmt = stmt.where(DevOpsJob.server_id == server_id)
    else:
        stmt = stmt.where(DevOpsJob.server_id.is_not(None))
    if status_filter:
        try:
            stmt = stmt.where(DevOpsJob.status == JobStatus(status_filter))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status_filter}")
    stmt = stmt.order_by(DevOpsJob.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/jobs/{job_id}", response_model=JobOut)
async def get_job(
    job_id: uuid.UUID,
    db: DbSession,
    membership: OrgMembership,
):
    result = await db.execute(
        select(DevOpsJob).where(
            DevOpsJob.id == job_id,
            DevOpsJob.organization_id == membership.organization_id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/jobs/{job_id}/logs", response_model=list[JobLogOut])
async def get_job_logs(
    job_id: uuid.UUID,
    db: DbSession,
    membership: OrgMembership,
    limit: int = 500,
):
    job_result = await db.execute(
        select(DevOpsJob).where(
            DevOpsJob.id == job_id,
            DevOpsJob.organization_id == membership.organization_id,
        )
    )
    if not job_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Job not found")

    logs_result = await db.execute(
        select(JobLog)
        .where(JobLog.job_id == job_id)
        .order_by(JobLog.sequence)
        .limit(limit)
    )
    return list(logs_result.scalars().all())


@router.post("/jobs/{job_id}/cancel", response_model=JobOut, dependencies=[Depends(verify_csrf)])
async def cancel_job(
    job_id: uuid.UUID,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    try:
        job = await execution_engine.cancel_job(
            db,
            job_id=job_id,
            cancelled_by=membership.user_id,
            organization_id=membership.organization_id,
        )
        return job
    except ExecutionError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def delete_job(
    job_id: uuid.UUID,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    try:
        await execution_engine.delete_job(
            db,
            job_id=job_id,
            deleted_by=membership.user_id,
            organization_id=membership.organization_id,
            ip_address=request.client.host if request.client else None,
        )
    except ExecutionError as e:
        raise HTTPException(status_code=400, detail=str(e))


class AgentTokenCreate(BaseModel):
    server_id: uuid.UUID
    label: str | None = None
    expires_days: int = Field(365, ge=1, le=3650)


class AgentTokenOut(BaseModel):
    id: uuid.UUID
    server_id: uuid.UUID
    label: str | None
    is_active: bool
    last_seen_at: datetime | None
    last_seen_ip: str | None
    created_at: datetime
    expires_at: datetime | None
    raw_token: str | None = None

    model_config = {"from_attributes": True}


@router.post("/agent-tokens", response_model=AgentTokenOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
async def create_agent_token(
    body: AgentTokenCreate,
    db: DbSession,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    """Generate a new agent token. The raw_token is returned ONCE."""
    from app.services.agent_comm import agent_comm
    raw_token, token = await agent_comm.create_agent_token(
        db,
        organization_id=membership.organization_id,
        server_id=body.server_id,
        created_by=membership.user_id,
        label=body.label,
        expires_days=body.expires_days,
    )
    return AgentTokenOut(
        id=token.id,
        server_id=token.server_id,
        label=token.label,
        is_active=token.is_active,
        last_seen_at=token.last_seen_at,
        last_seen_ip=token.last_seen_ip,
        created_at=token.created_at,
        expires_at=token.expires_at,
        raw_token=raw_token,
    )
