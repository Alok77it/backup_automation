"""DevOps Control Plane — new tables

Revision ID: 005
Revises: 004
Create Date: 2026-05-26

ADDITIVE ONLY — no existing tables or columns modified.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "005"
down_revision: str = "004"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Helpers — PostgreSQL CREATE TYPE … IF NOT EXISTS workaround
# ---------------------------------------------------------------------------

def _create_enum_if_not_exists(name: str, *values: str) -> None:
    vals = ", ".join(f"'{v}'" for v in values)
    op.execute(
        f"DO $$ BEGIN "
        f"IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{name}') THEN "
        f"CREATE TYPE {name} AS ENUM ({vals}); "
        f"END IF; "
        f"END $$;"
    )


def _drop_enum_if_exists(name: str) -> None:
    op.execute(f"DROP TYPE IF EXISTS {name};")


def upgrade() -> None:
    # ── Enum types ────────────────────────────────────────────────────
    _create_enum_if_not_exists("devops_jobstatus",      "pending", "queued", "executing", "completed", "failed", "cancelled", "timeout")
    _create_enum_if_not_exists("devops_risklevel",      "low", "medium", "high")
    _create_enum_if_not_exists("devops_approvalstatus", "pending", "approved", "rejected", "expired")
    _create_enum_if_not_exists("devops_pluginstatus",   "available", "installing", "installed", "failed", "uninstalling", "uninstalled")
    _create_enum_if_not_exists("devops_sslstatus",      "pending", "active", "renewing", "expired", "failed")

    # ── server_groups ─────────────────────────────────────────────────
    op.create_table(
        "server_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("color", sa.String(20)),
        sa.Column("created_by", postgresql.UUID(as_uuid=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("organization_id", "name", name="uq_servergroup_org_name"),
    )
    op.create_index("ix_servergroup_org", "server_groups", ["organization_id"])

    # ── server_group_members ──────────────────────────────────────────
    op.create_table(
        "server_group_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("group_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("server_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("group_id", "server_id", name="uq_sgm_group_server"),
    )

    # ── server_tag_assignments ────────────────────────────────────────
    op.create_table(
        "server_tag_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("value", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("server_id", "key", name="uq_servertag_server_key"),
    )
    op.create_index("ix_servertag_org", "server_tag_assignments", ["organization_id"])

    # ── agent_tokens ──────────────────────────────────────────────────
    op.create_table(
        "agent_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("label", sa.String(100)),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("last_seen_ip", sa.String(45)),
        sa.Column("created_by", postgresql.UUID(as_uuid=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_agent_token_hash", "agent_tokens", ["token_hash"])
    op.create_index("ix_agent_token_org",  "agent_tokens", ["organization_id"])

    # ── approval_requests (created before devops_jobs due to FK) ──────
    op.create_table(
        "approval_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True)),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("action_type", sa.String(80), nullable=False),
        sa.Column("action_payload", sa.JSON()),
        sa.Column("risk_level",
                  sa.Enum("low", "medium", "high", name="devops_risklevel", create_type=False),
                  nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True)),
        sa.Column("status",
                  sa.Enum("pending", "approved", "rejected", "expired",
                          name="devops_approvalstatus", create_type=False),
                  nullable=False),
        sa.Column("review_note", sa.Text()),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_approval_org_status", "approval_requests", ["organization_id", "status"])

    # ── devops_jobs ───────────────────────────────────────────────────
    op.create_table(
        "devops_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("servers.id", ondelete="SET NULL")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_type", sa.String(80), nullable=False),
        sa.Column("command", sa.Text()),
        sa.Column("payload", sa.JSON()),
        sa.Column("plugin_id", sa.String(80)),
        sa.Column("risk_level",
                  sa.Enum("low", "medium", "high", name="devops_risklevel", create_type=False),
                  nullable=False),
        sa.Column("requires_approval", sa.Boolean(), server_default=sa.text("false")),
        # FK added as ALTER TABLE below to break the circular reference
        sa.Column("approval_id", postgresql.UUID(as_uuid=True)),
        sa.Column("celery_task_id", sa.String(255)),
        sa.Column("status",
                  sa.Enum("pending", "queued", "executing", "completed", "failed",
                          "cancelled", "timeout", name="devops_jobstatus", create_type=False),
                  nullable=False),
        sa.Column("result", sa.JSON()),
        sa.Column("error_message", sa.Text()),
        sa.Column("exit_code", sa.Integer()),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("queued_at", sa.DateTime(timezone=True)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("timeout_seconds", sa.Integer(), server_default=sa.text("300")),
    )
    op.create_index("ix_devopsjob_org_created", "devops_jobs", ["organization_id", "created_at"])
    op.create_index("ix_devopsjob_server",      "devops_jobs", ["server_id"])
    op.create_index("ix_devopsjob_status",       "devops_jobs", ["status"])

    # Add circular FK now that both tables exist
    op.create_foreign_key(
        "fk_job_approval",
        "devops_jobs", "approval_requests",
        ["approval_id"], ["id"],
        ondelete="SET NULL",
    )

    # ── job_logs ──────────────────────────────────────────────────────
    op.create_table(
        "job_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("devops_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("level", sa.String(10), server_default=sa.text("'info'")),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("stream", sa.String(10), server_default=sa.text("'stdout'")),
    )
    op.create_index("ix_joblog_job_seq", "job_logs", ["job_id", "sequence"])

    # ── devops_plugins ────────────────────────────────────────────────
    op.create_table(
        "devops_plugins",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("version", sa.String(30), nullable=False),
        sa.Column("category", sa.String(50), server_default=sa.text("'tool'")),
        sa.Column("icon_url", sa.String(500)),
        sa.Column("docs_url", sa.String(500)),
        sa.Column("manifest", sa.JSON()),
        sa.Column("requires_docker", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("min_memory_mb", sa.Integer(), server_default=sa.text("512")),
        sa.Column("supported_os", sa.JSON()),
        sa.Column("risk_level",
                  sa.Enum("low", "medium", "high", name="devops_risklevel", create_type=False),
                  nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # ── plugin_installations ──────────────────────────────────────────
    op.create_table(
        "plugin_installations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plugin_id", sa.String(80),
                  sa.ForeignKey("devops_plugins.id", ondelete="CASCADE"), nullable=False),
        sa.Column("installed_by", postgresql.UUID(as_uuid=True)),
        sa.Column("install_job_id", postgresql.UUID(as_uuid=True)),
        sa.Column("status",
                  sa.Enum("available", "installing", "installed", "failed",
                          "uninstalling", "uninstalled",
                          name="devops_pluginstatus", create_type=False),
                  nullable=False),
        sa.Column("config", sa.JSON()),
        sa.Column("env_overrides", sa.JSON()),
        sa.Column("install_path", sa.String(500)),
        sa.Column("access_url", sa.String(500)),
        sa.Column("health_status", sa.String(30)),
        sa.Column("last_health_check", sa.DateTime(timezone=True)),
        sa.Column("error_message", sa.Text()),
        sa.Column("installed_at", sa.DateTime(timezone=True)),
        sa.Column("uninstalled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("server_id", "plugin_id", name="uq_plugininstall_server_plugin"),
    )
    op.create_index("ix_plugininstall_org", "plugin_installations", ["organization_id"])

    # ── container_snapshots ───────────────────────────────────────────
    op.create_table(
        "container_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("container_id", sa.String(128), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("image", sa.String(500), nullable=False),
        sa.Column("image_tag", sa.String(200)),
        sa.Column("state", sa.String(30), nullable=False),
        sa.Column("status", sa.String(100)),
        sa.Column("exit_code", sa.Integer()),
        sa.Column("ports", sa.JSON()),
        sa.Column("labels", sa.JSON()),
        sa.Column("networks", sa.JSON()),
        sa.Column("mounts", sa.JSON()),
        sa.Column("cpu_percent", sa.Float()),
        sa.Column("memory_mb", sa.Float()),
        sa.Column("memory_limit_mb", sa.Float()),
        sa.Column("created_in_docker", sa.DateTime(timezone=True)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("captured_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_container_snap_server_ts", "container_snapshots", ["server_id", "captured_at"])
    op.create_index("ix_container_snap_org",       "container_snapshots", ["organization_id"])

    # ── devops_audit_logs ─────────────────────────────────────────────
    op.create_table(
        "devops_audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("agent_id", postgresql.UUID(as_uuid=True)),
        sa.Column("server_id", postgresql.UUID(as_uuid=True)),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(80)),
        sa.Column("resource_id", sa.String(100)),
        sa.Column("details", sa.JSON()),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("user_agent", sa.String(500)),
        sa.Column("outcome", sa.String(20), server_default=sa.text("'success'")),
        sa.Column("risk_level", sa.String(10)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_devopsaudit_org_ts",   "devops_audit_logs", ["organization_id", "created_at"])
    op.create_index("ix_devopsaudit_user",     "devops_audit_logs", ["user_id"])
    op.create_index("ix_devopsaudit_resource", "devops_audit_logs", ["resource_type", "resource_id"])

    # ── ssl_certificates ──────────────────────────────────────────────
    op.create_table(
        "ssl_certificates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("domain", sa.String(255), nullable=False),
        sa.Column("san_domains", sa.JSON()),
        sa.Column("provider", sa.String(30), server_default=sa.text("'letsencrypt'")),
        sa.Column("acme_email", sa.String(255)),
        sa.Column("status",
                  sa.Enum("pending", "active", "renewing", "expired", "failed",
                          name="devops_sslstatus", create_type=False),
                  nullable=False),
        sa.Column("cert_pem_path", sa.String(500)),
        sa.Column("chain_pem_path", sa.String(500)),
        sa.Column("key_path", sa.String(500)),
        sa.Column("issued_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("last_renewed_at", sa.DateTime(timezone=True)),
        sa.Column("auto_renew", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("error_message", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("server_id", "domain", name="uq_sslcert_server_domain"),
    )
    op.create_index("ix_sslcert_org", "ssl_certificates", ["organization_id"])

    # ── reverse_proxy_configs ─────────────────────────────────────────
    op.create_table(
        "reverse_proxy_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ssl_cert_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("ssl_certificates.id", ondelete="SET NULL")),
        sa.Column("proxy_type", sa.String(20), server_default=sa.text("'nginx'")),
        sa.Column("domain", sa.String(255), nullable=False),
        sa.Column("upstream_host", sa.String(255), nullable=False),
        sa.Column("upstream_port", sa.Integer(), nullable=False),
        sa.Column("upstream_path", sa.String(255), server_default=sa.text("'/'")),
        sa.Column("ssl_enabled", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("http_redirect", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("extra_config", sa.JSON()),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("linked_plugin_id", sa.String(80)),
        sa.Column("deployed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_proxyconfig_org", "reverse_proxy_configs", ["organization_id"])


def downgrade() -> None:
    op.drop_table("reverse_proxy_configs")
    op.drop_table("ssl_certificates")
    op.drop_table("devops_audit_logs")
    op.drop_table("container_snapshots")
    op.drop_table("plugin_installations")
    op.drop_table("devops_plugins")
    op.drop_table("job_logs")
    op.drop_constraint("fk_job_approval", "devops_jobs", type_="foreignkey")
    op.drop_table("devops_jobs")
    op.drop_table("approval_requests")
    op.drop_table("agent_tokens")
    op.drop_table("server_tag_assignments")
    op.drop_table("server_group_members")
    op.drop_table("server_groups")
    _drop_enum_if_exists("devops_sslstatus")
    _drop_enum_if_exists("devops_pluginstatus")
    _drop_enum_if_exists("devops_approvalstatus")
    _drop_enum_if_exists("devops_risklevel")
    _drop_enum_if_exists("devops_jobstatus")
