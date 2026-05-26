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
from sqlalchemy import select

from app.core.dependencies import DbSession, OrgMembership, require_permission, verify_csrf
from app.core.security import decrypt_secret, encrypt_secret
from app.models.entities import OrganizationMember
from app.models.devops_entities import RiskLevel, SSLStatus, StoredCredential
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


class CredentialCreate(BaseModel):
    # provider: agent | docker | github | jenkins | database | kubernetes
    provider: str = Field(..., pattern="^(agent|docker|github|jenkins|database|kubernetes)$")
    label: str = Field(..., min_length=1, max_length=120)
    server_id: uuid.UUID | None = None
    # username is required for all providers except agent (where it's optional)
    username: str | None = None
    secret: str = Field(..., min_length=1)
    registry_url: str | None = None
    # extra fields stored in metadata_json (e.g. database host/port/dbname, jenkins_url)
    metadata_json: dict | None = None


class CredentialOut(BaseModel):
    id: uuid.UUID
    provider: str
    label: str
    server_id: uuid.UUID | None
    username: str | None
    registry_url: str | None
    metadata_json: dict | None
    is_active: bool
    created_at: datetime
    secret_preview: str | None = None
    # display_name combines label + username for easy UI rendering
    display_name: str | None = None

    model_config = {"from_attributes": True}


class GithubRunRequest(BaseModel):
    server_id: uuid.UUID
    agent_credential_id: uuid.UUID
    github_credential_id: uuid.UUID
    repo_url: str
    run_script: str
    install_path: str | None = None
    timeout_seconds: int = Field(1800, ge=60, le=7200)


async def _get_credential(
    db: DbSession,
    *,
    organization_id: uuid.UUID,
    credential_id: uuid.UUID,
    provider: str,
) -> StoredCredential:
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
    return cred


def _credential_out(cred: StoredCredential) -> CredentialOut:
    preview = None
    try:
        secret = decrypt_secret(cred.encrypted_secret)
        preview = f"...{secret[-4:]}" if len(secret) >= 4 else "***"
    except Exception:
        preview = "***"
    # Build a human-readable display name
    if cred.username:
        display_name = f"{cred.label} ({cred.username})"
    else:
        display_name = cred.label
    return CredentialOut(
        id=cred.id,
        provider=cred.provider,
        label=cred.label,
        server_id=cred.server_id,
        username=cred.username,
        registry_url=cred.registry_url,
        metadata_json=cred.metadata_json,
        is_active=cred.is_active,
        created_at=cred.created_at,
        secret_preview=preview,
        display_name=display_name,
    )


@router.get("/credentials", response_model=list[CredentialOut])
async def list_credentials(
    db: DbSession,
    membership: OrgMembership,
    provider: str | None = None,
    server_id: uuid.UUID | None = None,
):
    stmt = select(StoredCredential).where(
        StoredCredential.organization_id == membership.organization_id,
        StoredCredential.is_active == True,
    )
    if provider:
        stmt = stmt.where(StoredCredential.provider == provider)
    if server_id:
        stmt = stmt.where(StoredCredential.server_id == server_id)
    result = await db.execute(stmt.order_by(StoredCredential.provider, StoredCredential.label))
    return [_credential_out(c) for c in result.scalars().all()]


@router.post("/credentials", response_model=CredentialOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
async def create_credential(
    body: CredentialCreate,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:write"))],
):
    cred = StoredCredential(
        organization_id=membership.organization_id,
        server_id=body.server_id,
        provider=body.provider,
        label=body.label,
        username=body.username,
        encrypted_secret=encrypt_secret(body.secret),
        registry_url=body.registry_url,
        metadata_json=body.metadata_json or {},
        created_by=membership.user_id,
        is_active=True,
    )
    db.add(cred)
    await db.commit()
    await db.refresh(cred)
    return _credential_out(cred)


@router.delete("/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def delete_credential(
    credential_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:write"))],
):
    result = await db.execute(
        select(StoredCredential).where(
            StoredCredential.id == credential_id,
            StoredCredential.organization_id == membership.organization_id,
            StoredCredential.is_active == True,
        )
    )
    cred = result.scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    cred.is_active = False
    await db.commit()


@router.post("/github/run", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(verify_csrf)])
async def run_github_repo(
    body: GithubRunRequest,
    db: DbSession,
    request: Request,
    membership: Annotated[OrganizationMember, Depends(require_permission("server:write"))],
):
    agent = await _get_credential(
        db,
        organization_id=membership.organization_id,
        credential_id=body.agent_credential_id,
        provider="agent",
    )
    github = await _get_credential(
        db,
        organization_id=membership.organization_id,
        credential_id=body.github_credential_id,
        provider="github",
    )
    job = await execution_engine.submit_job(
        db,
        organization_id=membership.organization_id,
        server_id=body.server_id,
        created_by=membership.user_id,
        job_type="agent_command",
        payload={
            "command": "github_repo_run",
            "_agent_token_raw": decrypt_secret(agent.encrypted_secret),
            "args": {
                "repo_url": body.repo_url,
                "run_script": body.run_script,
                "install_path": body.install_path,
                "github_user": github.username,
                "github_token": decrypt_secret(github.encrypted_secret),
            },
        },
        risk_level=RiskLevel.HIGH,
        timeout_seconds=body.timeout_seconds,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "GitHub repo run submitted", "job_id": str(job.id), "approval_id": str(job.approval_id) if job.approval_id else None}


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
