"""
Plugin System API Router
=========================
Browse the plugin catalog, install/uninstall tools on servers.
Install operations are queued directly; unrelated destructive operations can still use approvals.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from app.core.dependencies import DbSession, OrgMembership, require_permission, verify_csrf
from app.core.security import decrypt_secret
from app.models.entities import OrganizationMember, Server
from app.models.devops_entities import DevOpsPlugin, PluginInstallation, PluginStatus, RiskLevel, StoredCredential
from app.services.execution_engine import execution_engine
from app.services.plugin_manager import (
    PluginAlreadyInstalledError,
    PluginNotFoundError,
    plugin_manager,
)

router = APIRouter(prefix="/plugins", tags=["Plugin System"])


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
    agent_token_raw: str | None = None
    agent_credential_id: uuid.UUID | None = None
    docker_credential_id: uuid.UUID | None = None
    github_credential_id: uuid.UUID | None = None
    agent_port: int = 9977


class PluginManageRequest(BaseModel):
    action: str
    agent_token_raw: str | None = None
    agent_credential_id: uuid.UUID | None = None
    agent_port: int = 9977


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
    job_id: uuid.UUID | None = None
    approval_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


async def _resolve_agent_token(
    db: DbSession,
    *,
    organization_id: uuid.UUID,
    server_id: uuid.UUID,
    raw_token: str | None = None,
    credential_id: uuid.UUID | None = None,
) -> str | None:
    if raw_token:
        return raw_token
    if credential_id:
        _, token = await _credential_secret(
            db,
            organization_id=organization_id,
            credential_id=credential_id,
            provider="agent",
        )
        return token
    result = await db.execute(
        select(StoredCredential).where(
            StoredCredential.organization_id == organization_id,
            StoredCredential.provider == "agent",
            StoredCredential.is_active == True,
            or_(StoredCredential.server_id == server_id, StoredCredential.server_id == None),
        )
    )
    cred = result.scalars().first()
    return decrypt_secret(cred.encrypted_secret) if cred else None


def _render_compose(plugin_id: str, config: dict[str, Any]) -> str | None:
    template = plugin_manager.get_compose_template(plugin_id)
    if not template:
        return None
    from jinja2 import Template

    return Template(template).render(**config)


def _int_config(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


@router.get("/catalog", response_model=list[PluginOut])
async def get_plugin_catalog(
    db: DbSession,
    membership: OrgMembership,
    category: str | None = None,
):
    """List all available plugins. No side effects."""
    return await plugin_manager.get_catalog(db, category=category)


@router.post("/catalog/sync", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_csrf)])
async def sync_plugin_catalog(
    db: DbSession,
    membership: Annotated[
        OrganizationMember,
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
    dependencies=[Depends(verify_csrf)],
)
async def install_plugin(
    plugin_id: str,
    body: PluginInstallRequest,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    """Request plugin installation."""
    try:
        config = dict(body.config or {})
        server = await db.get(Server, body.server_id)
        server_host = server.hostname if server else None
        config.setdefault("public_ip", config.get("public_ip") or server_host)
        config.setdefault("server_hostname", config.get("server_hostname") or server_host)
        if plugin_id == "n8n":
            config.setdefault("n8n_host", config.get("public_ip") or server_host)
            config.setdefault("ssl_enabled", False)
            config.setdefault("n8n_basic_auth_active", bool(config.get("n8n_basic_auth_password")))
        if plugin_id == "jenkins":
            config.setdefault("jenkins_port", 18080)
            config.setdefault("jenkins_agent_port", 50000)
            config.setdefault("jenkins_home", "/opt/jenkins/data")
        install = await plugin_manager.request_install(
            db,
            organization_id=membership.organization_id,
            server_id=body.server_id,
            plugin_id=plugin_id,
            config=config,
            installed_by=membership.user_id,
            ip_address=request.client.host if request.client else None,
        )

        agent_token = await _resolve_agent_token(
            db,
            organization_id=membership.organization_id,
            server_id=body.server_id,
            raw_token=body.agent_token_raw,
            credential_id=body.agent_credential_id,
        )
        if body.docker_credential_id:
            docker_cred, docker_token = await _credential_secret(
                db,
                organization_id=membership.organization_id,
                credential_id=body.docker_credential_id,
                provider="docker",
            )
            config.setdefault("docker_username", docker_cred.username)
            config.setdefault("docker_token", docker_token)
            config.setdefault("docker_registry", docker_cred.registry_url or "docker.io")
        if body.github_credential_id:
            github_cred, github_token = await _credential_secret(
                db,
                organization_id=membership.organization_id,
                credential_id=body.github_credential_id,
                provider="github",
            )
            config.setdefault("github_user", github_cred.username)
            config.setdefault("github_token", github_token)
        compose_content = None
        command = "plugin_install"
        args: dict[str, Any] = {
            "plugin_id": plugin_id,
            "config": config,
            "install_path": config.get("install_path") or f"/opt/{plugin_id}",
        }
        template = plugin_manager.get_compose_template(plugin_id)
        if template:
            from jinja2 import Template
            compose_content = Template(template).render(**config)
            args["compose_content"] = compose_content
        else:
            install_script = plugin_manager.get_plugin_script_path(plugin_id, "install.sh")
            if install_script:
                command = "script_run_approved"
                args = {"script_content": install_script.read_text()}

        access_url = None
        if plugin_id == "n8n":
            host = config.get("n8n_host") or config.get("public_ip") or server_host
            port = config.get("n8n_port", 5678)
            access_url = f"http://{host}:{port}" if host else None
        elif plugin_id == "jenkins":
            host = config.get("public_ip") or server_host
            port = config.get("jenkins_port", 8080)
            access_url = f"http://{host}:{port}" if host else None

        if access_url:
            install.access_url = access_url

        payload = {
            "installation_id": str(install.id),
            "plugin_id": plugin_id,
            "config": config,
            "command": command,
            "args": args,
            "access_url": access_url,
            "agent_port": body.agent_port,
        }
        if agent_token:
            payload["_agent_token_raw"] = agent_token

        job = await execution_engine.submit_job(
            db,
            organization_id=membership.organization_id,
            server_id=body.server_id,
            created_by=membership.user_id,
            job_type="plugin_install",
            plugin_id=plugin_id,
            payload=payload,
            risk_level=RiskLevel.HIGH if plugin_id == "docker" else RiskLevel.MEDIUM,
            timeout_seconds=1800,
            ip_address=request.client.host if request.client else None,
        )

        install.install_job_id = job.id
        await db.commit()
        await db.refresh(install)

        out = PluginInstallOut.model_validate(install)
        out.job_id = job.id
        out.approval_id = job.approval_id
        return out

    except PluginNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PluginAlreadyInstalledError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post(
    "/{plugin_id}/uninstall/{server_id}",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(verify_csrf)],
)
async def uninstall_plugin(
    plugin_id: str,
    server_id: uuid.UUID,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
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
    agent_token = await _resolve_agent_token(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
    )
    payload = {
        "installation_id": str(install.id),
        "plugin_id": plugin_id,
        "command": "plugin_uninstall",
        "args": {"plugin_id": plugin_id, "install_path": install.install_path or f"/opt/{plugin_id}"},
    }
    if agent_token:
        payload["_agent_token_raw"] = agent_token

    job = await execution_engine.submit_job(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
        created_by=membership.user_id,
        job_type="plugin_uninstall",
        plugin_id=plugin_id,
        payload=payload,
        risk_level=RiskLevel.MEDIUM,
        timeout_seconds=300,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "Uninstall job submitted", "job_id": str(job.id), "approval_id": str(job.approval_id)}


@router.post(
    "/{plugin_id}/manage/{server_id}",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(verify_csrf)],
)
async def manage_plugin(
    plugin_id: str,
    server_id: uuid.UUID,
    body: PluginManageRequest,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    action = body.action.strip().lower()
    if action not in {"start", "redeploy", "restart", "stop", "logs"}:
        raise HTTPException(status_code=400, detail="Unsupported plugin action")

    result = await db.execute(
        select(PluginInstallation).where(
            PluginInstallation.plugin_id == plugin_id,
            PluginInstallation.server_id == server_id,
            PluginInstallation.organization_id == membership.organization_id,
        )
    )
    install = result.scalar_one_or_none()
    if not install:
        raise HTTPException(status_code=404, detail="Plugin installation not found")

    config = dict(install.config or {})
    server = await db.get(Server, server_id)
    if server:
        config.setdefault("public_ip", config.get("public_ip") or server.hostname)
        config.setdefault("server_hostname", config.get("server_hostname") or server.hostname)
    if plugin_id == "jenkins" and _int_config(config.get("jenkins_port"), 8080) == 8080:
        config["jenkins_port"] = 18080
        host = config.get("public_ip") or (server.hostname if server else None)
        if host:
            install.access_url = f"http://{host}:18080"
        install.config = config
        await db.commit()
    install_path = install.install_path or config.get("install_path") or f"/opt/{plugin_id}"
    compose_content = _render_compose(plugin_id, config)
    if not compose_content and action in {"start", "redeploy", "restart", "stop", "logs"}:
        raise HTTPException(status_code=400, detail="This plugin does not expose Docker Compose management actions")
    command = {
        "start": "docker_compose_up",
        "redeploy": "docker_compose_up",
        "restart": "docker_compose_restart",
        "stop": "docker_compose_down",
        "logs": "docker_compose_logs",
    }[action]
    args: dict[str, Any] = {
        "plugin_id": plugin_id,
        "config": config,
        "install_path": install_path,
    }
    if compose_content and action in {"start", "redeploy"}:
        args["compose_content"] = compose_content

    agent_token = await _resolve_agent_token(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
        raw_token=body.agent_token_raw,
        credential_id=body.agent_credential_id,
    )
    payload = {
        "installation_id": str(install.id),
        "plugin_id": plugin_id,
        "command": command,
        "args": args,
        "agent_port": body.agent_port,
    }
    if agent_token:
        payload["_agent_token_raw"] = agent_token

    job = await execution_engine.submit_job(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
        created_by=membership.user_id,
        job_type="agent_command",
        plugin_id=plugin_id,
        payload=payload,
        risk_level=RiskLevel.MEDIUM,
        timeout_seconds=900 if action in {"start", "redeploy"} else 180,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": f"{action} job submitted", "job_id": str(job.id)}


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
