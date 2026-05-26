"""
DevOps Tools API — Tool Installation & SSL Management
=======================================================
Unified endpoint for:
  - Listing tool availability per server
  - Triggering installs (routes through plugin system + execution engine)
  - SSL certificate management
  - Reverse proxy config management
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.core.dependencies import DbSession, OrgMembership, require_permission, verify_csrf
from app.models.entities import OrganizationMember
from app.models.devops_entities import RiskLevel, SSLStatus
from app.services.execution_engine import execution_engine
from app.services.ssl_service import ssl_service

router = APIRouter(prefix="/devops-tools", tags=["DevOps Tools"])


# ---------------------------------------------------------------------------
# SSL Schemas
# ---------------------------------------------------------------------------

class SSLCertRequest(BaseModel):
    server_id: uuid.UUID
    domain: str = Field(..., min_length=3)
    acme_email: str
    san_domains: list[str] | None = None
    auto_renew: bool = True
    staging: bool = False


class SSLCertOut(BaseModel):
    id: uuid.UUID
    server_id: uuid.UUID
    domain: str
    san_domains: list | None
    provider: str
    acme_email: str | None
    status: str
    issued_at: datetime | None
    expires_at: datetime | None
    last_renewed_at: datetime | None
    auto_renew: bool
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ProxyConfigRequest(BaseModel):
    server_id: uuid.UUID
    domain: str
    upstream_host: str
    upstream_port: int = Field(..., ge=1, le=65535)
    upstream_path: str = "/"
    ssl_enabled: bool = True
    http_redirect: bool = True
    proxy_type: str = "nginx"
    ssl_cert_id: uuid.UUID | None = None
    linked_plugin_id: str | None = None


class ProxyConfigOut(BaseModel):
    id: uuid.UUID
    server_id: uuid.UUID
    domain: str
    upstream_host: str
    upstream_port: int
    upstream_path: str
    ssl_enabled: bool
    http_redirect: bool
    proxy_type: str
    ssl_cert_id: uuid.UUID | None
    linked_plugin_id: str | None
    is_active: bool
    deployed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# SSL Certificate endpoints
# ---------------------------------------------------------------------------

@router.get("/ssl/certificates", response_model=list[SSLCertOut])
async def list_certificates(
    db: DbSession,
    membership: OrgMembership,
    server_id: uuid.UUID | None = None,
    expiring_within_days: int | None = None,
):
    return await ssl_service.get_certificates(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
        expiring_within_days=expiring_within_days,
    )


@router.post(
    "/ssl/certificates",
    response_model=SSLCertOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(verify_csrf)],
)
async def issue_certificate(
    body: SSLCertRequest,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    """
    Request a Let's Encrypt certificate for a domain.
    Creates a cert record + submits a HIGH-risk SSL_issue job (-> approval required).
    """
    cert = await ssl_service.create_certificate_record(
        db,
        organization_id=membership.organization_id,
        server_id=body.server_id,
        domain=body.domain,
        acme_email=body.acme_email,
        san_domains=body.san_domains,
        auto_renew=body.auto_renew,
    )

    certbot_cmd = ssl_service.get_certbot_issue_command(
        domain=body.domain,
        email=body.acme_email,
        staging=body.staging,
    )

    job = await execution_engine.submit_job(
        db,
        organization_id=membership.organization_id,
        server_id=body.server_id,
        created_by=membership.user_id,
        job_type="ssl_issue",
        payload={
            "cert_id": str(cert.id),
            "domain": body.domain,
            "acme_email": body.acme_email,
            "command": "ssl_certbot_issue",
            "args": {"command_string": certbot_cmd},
        },
        risk_level=RiskLevel.HIGH,
        timeout_seconds=300,
        ip_address=request.client.host if request.client else None,
    )

    return cert


@router.post("/ssl/certificates/{cert_id}/renew", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(verify_csrf)])
async def renew_certificate(
    cert_id: uuid.UUID,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    from sqlalchemy import select
    from app.models.devops_entities import SSLCertificate
    result = await db.execute(
        select(SSLCertificate).where(
            SSLCertificate.id == cert_id,
            SSLCertificate.organization_id == membership.organization_id,
        )
    )
    cert = result.scalar_one_or_none()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")

    job = await execution_engine.submit_job(
        db,
        organization_id=membership.organization_id,
        server_id=cert.server_id,
        created_by=membership.user_id,
        job_type="ssl_renew",
        payload={
            "cert_id": str(cert_id),
            "command": "ssl_certbot_renew",
            "args": {},
        },
        risk_level=RiskLevel.MEDIUM,
        timeout_seconds=300,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "Renewal job submitted", "job_id": str(job.id)}


# ---------------------------------------------------------------------------
# Reverse Proxy endpoints
# ---------------------------------------------------------------------------

@router.get("/proxy/configs", response_model=list[ProxyConfigOut])
async def list_proxy_configs(
    db: DbSession,
    membership: OrgMembership,
    server_id: uuid.UUID | None = None,
):
    return await ssl_service.get_proxy_configs(
        db,
        organization_id=membership.organization_id,
        server_id=server_id,
    )


@router.post(
    "/proxy/configs",
    response_model=ProxyConfigOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def create_proxy_config(
    body: ProxyConfigRequest,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    """
    Create a reverse proxy config record. To deploy it, use /proxy/configs/{id}/deploy.
    """
    proxy = await ssl_service.create_proxy_config(
        db,
        organization_id=membership.organization_id,
        server_id=body.server_id,
        domain=body.domain,
        upstream_host=body.upstream_host,
        upstream_port=body.upstream_port,
        upstream_path=body.upstream_path,
        ssl_enabled=body.ssl_enabled,
        http_redirect=body.http_redirect,
        ssl_cert_id=body.ssl_cert_id,
        proxy_type=body.proxy_type,
        linked_plugin_id=body.linked_plugin_id,
    )
    return proxy


@router.post("/proxy/configs/{proxy_id}/deploy", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(verify_csrf)])
async def deploy_proxy_config(
    proxy_id: uuid.UUID,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("server:write"))
    ],
):
    """
    Generate the Nginx config and deploy it via the agent (HIGH-risk -> approval required).
    """
    from sqlalchemy import select
    from app.models.devops_entities import ReverseProxyConfig, SSLCertificate

    result = await db.execute(
        select(ReverseProxyConfig).where(
            ReverseProxyConfig.id == proxy_id,
            ReverseProxyConfig.organization_id == membership.organization_id,
        )
    )
    proxy = result.scalar_one_or_none()
    if not proxy:
        raise HTTPException(status_code=404, detail="Proxy config not found")

    cert = None
    if proxy.ssl_cert_id:
        cert = await db.get(SSLCertificate, proxy.ssl_cert_id)

    nginx_config = ssl_service.get_nginx_config(proxy, cert)

    job = await execution_engine.submit_job(
        db,
        organization_id=membership.organization_id,
        server_id=proxy.server_id,
        created_by=membership.user_id,
        job_type="agent_command",
        payload={
            "command": "nginx_reload",
            "args": {
                "config_content": nginx_config,
                "domain": proxy.domain,
                "proxy_id": str(proxy_id),
            },
        },
        risk_level=RiskLevel.HIGH,
        timeout_seconds=120,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "Nginx deploy job submitted", "job_id": str(job.id), "approval_required": True}


# ---------------------------------------------------------------------------
# Nginx config preview (safe -- no deployment)
# ---------------------------------------------------------------------------

@router.get("/proxy/configs/{proxy_id}/preview")
async def preview_nginx_config(
    proxy_id: uuid.UUID,
    db: DbSession,
    membership: OrgMembership,
):
    """Returns the rendered Nginx config without deploying it."""
    from sqlalchemy import select
    from app.models.devops_entities import ReverseProxyConfig, SSLCertificate

    result = await db.execute(
        select(ReverseProxyConfig).where(
            ReverseProxyConfig.id == proxy_id,
            ReverseProxyConfig.organization_id == membership.organization_id,
        )
    )
    proxy = result.scalar_one_or_none()
    if not proxy:
        raise HTTPException(status_code=404, detail="Proxy config not found")

    cert = None
    if proxy.ssl_cert_id:
        cert = await db.get(SSLCertificate, proxy.ssl_cert_id)

    config = ssl_service.get_nginx_config(proxy, cert)
    return {"domain": proxy.domain, "proxy_type": proxy.proxy_type, "config": config}
