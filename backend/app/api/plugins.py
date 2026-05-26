"""
Plugin System API Router
=========================
Browse the plugin catalog, install/uninstall tools on servers.
All install operations create HIGH-risk DevOpsJobs (→ approval required).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.core.dependencies import DbSession, OrgMembership, require_permission
from app.models.devops_entities import DevOpsPlugin, PluginInstallation, PluginStatus, RiskLevel
from app.services.execution_engine import execution_engine
from app.services.plugin_manager import (
    PluginAlreadyInstalledError,
    PluginNotFoundError,
    plugin_manager,
)

router = APIRouter(prefix="/plugins", tags=["Plugin System"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PluginOut(BaseModel):
    id: str
    name: str
    description: str | None
    version: str
    category: str
    icon_url: str | None
    docs_url: str | None
    requires_docker: bool
    min_memory_mb: int
    supported_os: list | None
    risk_level: str
    is_active: bool

    model_config = {"from_attributes": True}


class PluginInstallRequest(BaseModel):
    server_id: uuid.UUID
    config: dict[str, Any] | None = None


class PluginInstallOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    server_id: uuid.UUID
    plugin_id: str
    status: str
    access_url: str | None
    health_status: str | None
    last_health_check: datetime | None
    error_message: str | None
    installed_at: datetime | None
    created_at: datetime
    job_id: uuid.UUID | None = None   # approval/job created for this install

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/catalog", response_model=list[PluginOut])
async def get_plugin_catalog(
    db: DbSession,
    membership: OrgMembership,
    category: str | None = None,
):
    """List all available plugins. No side effects."""
    return await plugin_manager.get_catalog(db, category=category)


@router.post("/catalog/sync", status_code=status.HTTP_200_OK)
async def sync_plugin_catalog(
    db: DbSession,
    membership: Annotated[
        OrgMembership.__class__,
        Depends(require_permission("settings:write"))
    ],
):
    """Re-scan the plugins directory and refresh the catalog. Admin only."""
    plugins = await plugin_manager.sync_catalog(db)
    return {"synced": len(plugins)}


@router.get("/installations", response_model=list[PluginInstallOut])
async def list_installations(
    db: DbSession,
    membership: OrgMembership,
    server_id: uuid.UUID | None = None,
    plugin_id: str | None = None,
):
    from sqlalchemy import select
    stmt = (
        select(PluginInstallation)
        .where(PluginInstallation.organization_id == membership.organization_id)
    )
    if server_id:
        stmt = stmt.where(PluginInstallation.server_id == server_id)
    if plugin_id:
        stmt = stmt.where(PluginInstallation.plugin_id == plugin_id)
    result = await db.execute(stmt.order_by(PluginInstallation.created_at.desc()))
    return list(result.scalars().all())


@router.post(
    "/{plugin_id}/install",
    response_model=PluginInstallOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def install_plugin(
    plugin_id: str,
    body: PluginInstallRequest,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrgMembership.__class__,
        Depends(require_permission("server:write"))
    ],
):
    """
    Request plugin installation on a server.
    Creates a PluginInstallation record + a HIGH-risk DevOpsJob.
    Job requires approval before execution starts.
    Returns the installation record with the linked job_id.
    """
    try:
        install = await plugin_manager.request_install(
            db,
            organization_id=membership.organization_id,
            server_id=body.server_id,
            plugin_id=plugin_id,
            config=body.config,
            installed_by=membership.user_id,
            ip_address=request.client.host if request.client else None,
        )

        # Submit the execution job (HIGH risk → auto-creates approval)
        job = await execution_engine.submit_job(
            db,
            organization_id=membership.organization_id,
            server_id=body.server_id,
            created_by=membership.user_id,
            job_type="plugin_install",
            plugin_id=plugin_id,
            payload={
                "installation_id": str(install.id),
                "plugin_id": plugin_id,
                "config": body.config or {},
                "command": "plugin_install",
                "args": {"plugin_id": plugin_id, "config": body.config or {}},
            },
            risk_level=RiskLevel.HIGH,
            timeout_seconds=600,
            ip_address=request.client.host if request.client else None,
        )

        # Link job to install
        install.install_job_id = job.id
        await db.commit()
        await db.refresh(install)

        # Build response with job_id included
        out = PluginInstallOut.model_validate(install)
        out.job_id = job.id
        return out

    except PluginNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PluginAlreadyInstalledError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post(
    "/{plugin_id}/uninstall/{server_id}",
    status_code=status.HTTP_202_ACCEPTED,
)
async def uninstall_plugin(
    plugin_id: str,
    server_id: uuid.UUID,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrgMembership.__class__,
        Depends(require_permission("server:write"))
    ],
):
    from sqlalchemy import select
    result = await db.execute(
        select(PluginInstallation).where(
            PluginInstallation.plugin_id == plugin_id,
            PluginInstallation.server_id == server_id,
            PluginInstallation.organization_id == membership.organization_id,
            PluginInstallation.status == PluginStatus.INSTALLED,
        )
    )
    install = result.scalar_one_or_none()
    if not install:
        raise HTTPException(status_code=404, detail="Installed plugin not found on this server")

    install.status = PluginStatus.UNINSTALLING
    await db.commit()

    job = await execution_engine.submit_job(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
        created_by=membership.user_id,
        job_type="plugin_uninstall",
        plugin_id=plugin_id,
        payload={
            "installation_id": str(install.id),
            "plugin_id": plugin_id,
            "command": "plugin_uninstall",
            "args": {"plugin_id": plugin_id},
        },
        risk_level=RiskLevel.HIGH,
        timeout_seconds=300,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "Uninstall job submitted", "job_id": str(job.id), "approval_id": str(job.approval_id)}


@router.get("/{plugin_id}/installations/{server_id}", response_model=PluginInstallOut)
async def get_installation_details(
    plugin_id: str,
    server_id: uuid.UUID,
    db: DbSession,
    membership: OrgMembership,
):
    from sqlalchemy import select
    result = await db.execute(
        select(PluginInstallation).where(
            PluginInstallation.plugin_id == plugin_id,
            PluginInstallation.server_id == server_id,
            PluginInstallation.organization_id == membership.organization_id,
        )
    )
    install = result.scalar_one_or_none()
    if not install:
        raise HTTPException(status_code=404, detail="Installation not found")
    return install
