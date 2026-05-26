"""
DevOps Control Plane — New Entity Models
=========================================
ADDITIVE ONLY — this file introduces new tables.
entities.py is NOT modified.

Tables added:
  server_groups, server_group_members, server_tags, server_tag_assignments,
  agent_tokens, devops_jobs, job_logs,
  devops_plugins, plugin_installations,
  container_snapshots,
  approval_requests,
  devops_audit_logs,
  ssl_certificates, reverse_proxy_configs
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base  # reuse existing Base — no change to Base itself


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _make_enum(enum_cls, name: str):
    return Enum(
        enum_cls,
        name=name,
        values_callable=lambda cls: [m.value for m in cls],
        native_enum=True,
    )


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class JobStatus(str, enum.Enum):
    PENDING    = "pending"
    QUEUED     = "queued"
    EXECUTING  = "executing"
    COMPLETED  = "completed"
    FAILED     = "failed"
    CANCELLED  = "cancelled"
    TIMEOUT    = "timeout"


class RiskLevel(str, enum.Enum):
    LOW    = "low"     # read-only
    MEDIUM = "medium"  # restart / container ops
    HIGH   = "high"    # install / delete / deploy


class ApprovalStatus(str, enum.Enum):
    PENDING   = "pending"
    APPROVED  = "approved"
    REJECTED  = "rejected"
    EXPIRED   = "expired"


class PluginStatus(str, enum.Enum):
    AVAILABLE   = "available"
    INSTALLING  = "installing"
    INSTALLED   = "installed"
    FAILED      = "failed"
    UNINSTALLING = "uninstalling"
    UNINSTALLED = "uninstalled"


class SSLStatus(str, enum.Enum):
    PENDING  = "pending"
    ACTIVE   = "active"
    RENEWING = "renewing"
    EXPIRED  = "expired"
    FAILED   = "failed"


_job_status_e    = _make_enum(JobStatus,      "devops_jobstatus")
_risk_level_e    = _make_enum(RiskLevel,      "devops_risklevel")
_approval_e      = _make_enum(ApprovalStatus, "devops_approvalstatus")
_plugin_status_e = _make_enum(PluginStatus,   "devops_pluginstatus")
_ssl_status_e    = _make_enum(SSLStatus,      "devops_sslstatus")


# ---------------------------------------------------------------------------
# Server Groups — logical grouping (prod / staging / region, etc.)
# ---------------------------------------------------------------------------

class ServerGroup(Base):
    __tablename__ = "server_groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(20))  # UI label colour
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_servergroup_org_name"),
    )

    members: Mapped[list["ServerGroupMember"]] = relationship(back_populates="group", cascade="all, delete-orphan")


class ServerGroupMember(Base):
    """Join table: server_groups ↔ servers (references existing servers table)."""
    __tablename__ = "server_group_members"
    __table_args__ = (UniqueConstraint("group_id", "server_id", name="uq_sgm_group_server"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("server_groups.id", ondelete="CASCADE"), nullable=False
    )
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped["ServerGroup"] = relationship(back_populates="members")


# ---------------------------------------------------------------------------
# Server Tags — key/value labels
# ---------------------------------------------------------------------------

class ServerTag(Base):
    __tablename__ = "server_tag_assignments"
    __table_args__ = (
        UniqueConstraint("server_id", "key", name="uq_servertag_server_key"),
        Index("ix_servertag_org", "organization_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False
    )
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# Agent Tokens — secure signed tokens for server agents (mTLS fallback)
# ---------------------------------------------------------------------------

class AgentToken(Base):
    """One token per server. Rotatable. Used by the server agent daemon."""
    __tablename__ = "agent_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    # SHA-256 hash of the raw token — never store plaintext
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    label: Mapped[str | None] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_ip: Mapped[str | None] = mapped_column(String(45))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_agent_token_hash", "token_hash"),)


# ---------------------------------------------------------------------------
# DevOps Jobs — every action goes through the job queue
# ---------------------------------------------------------------------------

class DevOpsJob(Base):
    """
    Central job record for the Execution Engine.
    Flow: PENDING → QUEUED → EXECUTING → COMPLETED | FAILED | TIMEOUT
    HIGH-risk jobs additionally require an ApprovalRequest before QUEUED.
    """
    __tablename__ = "devops_jobs"
    __table_args__ = (
        Index("ix_devopsjob_org_created", "organization_id", "created_at"),
        Index("ix_devopsjob_server", "server_id"),
        Index("ix_devopsjob_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    server_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("servers.id", ondelete="SET NULL")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # What this job does
    job_type: Mapped[str] = mapped_column(String(80), nullable=False)   # e.g. "install_plugin", "run_script"
    command: Mapped[str | None] = mapped_column(Text)                    # sanitised command/script
    payload: Mapped[dict | None] = mapped_column(JSON)                   # structured params
    plugin_id: Mapped[str | None] = mapped_column(String(80))            # if plugin job

    # Risk & approval
    risk_level: Mapped[RiskLevel] = mapped_column(_risk_level_e, default=RiskLevel.LOW)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("approval_requests.id", ondelete="SET NULL", use_alter=True, name="fk_job_approval")
    )

    # Celery task reference
    celery_task_id: Mapped[str | None] = mapped_column(String(255))

    # Lifecycle
    status: Mapped[JobStatus] = mapped_column(_job_status_e, default=JobStatus.PENDING, nullable=False)
    result: Mapped[dict | None] = mapped_column(JSON)
    error_message: Mapped[str | None] = mapped_column(Text)
    exit_code: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=300)

    logs: Mapped[list["JobLog"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class JobLog(Base):
    """Streaming log lines for a DevOpsJob."""
    __tablename__ = "job_logs"
    __table_args__ = (Index("ix_joblog_job_seq", "job_id", "sequence"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("devops_jobs.id", ondelete="CASCADE"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    level: Mapped[str] = mapped_column(String(10), default="info")   # info | warn | error | debug
    message: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    stream: Mapped[str] = mapped_column(String(10), default="stdout")  # stdout | stderr

    job: Mapped["DevOpsJob"] = relationship(back_populates="logs")


# ---------------------------------------------------------------------------
# Approval Requests — safety gate for HIGH-risk operations
# ---------------------------------------------------------------------------

class ApprovalRequest(Base):
    """
    State machine: PENDING → APPROVED | REJECTED | EXPIRED
    Once APPROVED the linked DevOpsJob transitions to QUEUED.
    """
    __tablename__ = "approval_requests"
    __table_args__ = (
        Index("ix_approval_org_status", "organization_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    action_type: Mapped[str] = mapped_column(String(80), nullable=False)   # "install_plugin", "deploy", etc.
    action_payload: Mapped[dict | None] = mapped_column(JSON)
    risk_level: Mapped[RiskLevel] = mapped_column(_risk_level_e, default=RiskLevel.HIGH)
    server_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    status: Mapped[ApprovalStatus] = mapped_column(_approval_e, default=ApprovalStatus.PENDING)
    review_note: Mapped[str | None] = mapped_column(Text)

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# DevOps Plugins — registry of installable tools
# ---------------------------------------------------------------------------

class DevOpsPlugin(Base):
    """
    Catalog of available plugins (Docker, k8s, n8n, Jenkins, etc.).
    Populated at startup from backend/app/plugins/ manifests.
    """
    __tablename__ = "devops_plugins"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)  # slug: "docker", "n8n", "jenkins"
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    version: Mapped[str] = mapped_column(String(30), nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="tool")  # tool | monitoring | ci_cd | workflow
    icon_url: Mapped[str | None] = mapped_column(String(500))
    docs_url: Mapped[str | None] = mapped_column(String(500))
    manifest: Mapped[dict | None] = mapped_column(JSON)     # full plugin.json
    requires_docker: Mapped[bool] = mapped_column(Boolean, default=True)
    min_memory_mb: Mapped[int] = mapped_column(Integer, default=512)
    supported_os: Mapped[list | None] = mapped_column(JSON)  # ["ubuntu", "debian", "centos"]
    risk_level: Mapped[RiskLevel] = mapped_column(_risk_level_e, default=RiskLevel.HIGH)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    installations: Mapped[list["PluginInstallation"]] = relationship(
        back_populates="plugin", cascade="all, delete-orphan"
    )


class PluginInstallation(Base):
    """Records the installation state of a plugin on a specific server."""
    __tablename__ = "plugin_installations"
    __table_args__ = (
        UniqueConstraint("server_id", "plugin_id", name="uq_plugininstall_server_plugin"),
        Index("ix_plugininstall_org", "organization_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False
    )
    plugin_id: Mapped[str] = mapped_column(
        ForeignKey("devops_plugins.id", ondelete="CASCADE"), nullable=False
    )
    installed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    install_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    status: Mapped[PluginStatus] = mapped_column(_plugin_status_e, default=PluginStatus.INSTALLING)
    config: Mapped[dict | None] = mapped_column(JSON)       # user-provided config values
    env_overrides: Mapped[dict | None] = mapped_column(JSON) # encrypted env vars
    install_path: Mapped[str | None] = mapped_column(String(500))
    access_url: Mapped[str | None] = mapped_column(String(500))  # e.g. https://n8n.example.com
    health_status: Mapped[str | None] = mapped_column(String(30))
    last_health_check: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)

    installed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    uninstalled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    plugin: Mapped["DevOpsPlugin"] = relationship(back_populates="installations")


# ---------------------------------------------------------------------------
# Container Snapshots — read-only Docker container state cache
# ---------------------------------------------------------------------------

class ContainerSnapshot(Base):
    """
    Point-in-time snapshot of Docker containers on a server.
    Written by the read-only container agent — never modifies runtime.
    """
    __tablename__ = "container_snapshots"
    __table_args__ = (
        Index("ix_container_snap_server_ts", "server_id", "captured_at"),
        Index("ix_container_snap_org", "organization_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False
    )

    container_id: Mapped[str] = mapped_column(String(128), nullable=False)  # Docker short ID
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    image: Mapped[str] = mapped_column(String(500), nullable=False)
    image_tag: Mapped[str | None] = mapped_column(String(200))
    state: Mapped[str] = mapped_column(String(30), nullable=False)  # running|stopped|exited|dead
    status: Mapped[str | None] = mapped_column(String(100))         # Docker status string
    exit_code: Mapped[int | None] = mapped_column(Integer)
    ports: Mapped[dict | None] = mapped_column(JSON)
    labels: Mapped[dict | None] = mapped_column(JSON)
    networks: Mapped[list | None] = mapped_column(JSON)
    mounts: Mapped[list | None] = mapped_column(JSON)

    # Runtime metrics at capture time
    cpu_percent: Mapped[float | None] = mapped_column()
    memory_mb: Mapped[float | None] = mapped_column()
    memory_limit_mb: Mapped[float | None] = mapped_column()

    created_in_docker: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# DevOps Audit Logs — immutable, append-only
# ---------------------------------------------------------------------------

class DevOpsAuditLog(Base):
    """
    Immutable audit trail for all Control Plane actions.
    Never updated — only inserted. Extends existing audit.py service
    via event hooks (no modification to existing audit.py).
    """
    __tablename__ = "devops_audit_logs"
    __table_args__ = (
        Index("ix_devopsaudit_org_ts", "organization_id", "created_at"),
        Index("ix_devopsaudit_user", "user_id"),
        Index("ix_devopsaudit_resource", "resource_type", "resource_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # if action by agent
    server_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    action: Mapped[str] = mapped_column(String(100), nullable=False)   # e.g. "job.created"
    resource_type: Mapped[str | None] = mapped_column(String(80))      # "job" | "plugin" | "approval"
    resource_id: Mapped[str | None] = mapped_column(String(100))
    details: Mapped[dict | None] = mapped_column(JSON)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    outcome: Mapped[str] = mapped_column(String(20), default="success")  # success | failure
    risk_level: Mapped[str | None] = mapped_column(String(10))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# SSL Certificates — Let's Encrypt managed certs
# ---------------------------------------------------------------------------

class SSLCertificate(Base):
    __tablename__ = "ssl_certificates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False
    )

    domain: Mapped[str] = mapped_column(String(255), nullable=False)
    san_domains: Mapped[list | None] = mapped_column(JSON)    # Subject Alt Names
    provider: Mapped[str] = mapped_column(String(30), default="letsencrypt")
    acme_email: Mapped[str | None] = mapped_column(String(255))

    status: Mapped[SSLStatus] = mapped_column(_ssl_status_e, default=SSLStatus.PENDING)
    cert_pem_path: Mapped[str | None] = mapped_column(String(500))   # path on server
    chain_pem_path: Mapped[str | None] = mapped_column(String(500))
    key_path: Mapped[str | None] = mapped_column(String(500))

    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_renewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=True)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("server_id", "domain", name="uq_sslcert_server_domain"),
    )

    proxy_configs: Mapped[list["ReverseProxyConfig"]] = relationship(back_populates="ssl_cert")


# ---------------------------------------------------------------------------
# Reverse Proxy Configs — Nginx / Traefik virtual hosts
# ---------------------------------------------------------------------------

class ReverseProxyConfig(Base):
    __tablename__ = "reverse_proxy_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), nullable=False
    )
    ssl_cert_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ssl_certificates.id", ondelete="SET NULL")
    )

    proxy_type: Mapped[str] = mapped_column(String(20), default="nginx")  # nginx | traefik
    domain: Mapped[str] = mapped_column(String(255), nullable=False)
    upstream_host: Mapped[str] = mapped_column(String(255), nullable=False)
    upstream_port: Mapped[int] = mapped_column(Integer, nullable=False)
    upstream_path: Mapped[str] = mapped_column(String(255), default="/")
    ssl_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    http_redirect: Mapped[bool] = mapped_column(Boolean, default=True)
    extra_config: Mapped[dict | None] = mapped_column(JSON)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    linked_plugin_id: Mapped[str | None] = mapped_column(String(80))  # which plugin this serves

    deployed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    ssl_cert: Mapped["SSLCertificate | None"] = relationship(back_populates="proxy_configs")
