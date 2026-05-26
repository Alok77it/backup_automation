"""
Container Management API -- READ-ONLY
======================================
Exposes container visibility data. Never modifies Docker runtime.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.core.dependencies import DbSession, OrgMembership, require_permission, verify_csrf
from app.models.devops_entities import RiskLevel
from app.models.entities import OrganizationMember
from app.services.container_service import container_service
from app.services.execution_engine import execution_engine

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
