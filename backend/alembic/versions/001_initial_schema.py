"""Initial schema

Revision ID: 001
Revises:
Create Date: 2026-05-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(512), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("is_verified", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("plan", sa.String(50), default="starter"),
        sa.Column("storage_quota_gb", sa.Float(), default=100.0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "organization_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("role", sa.Enum("owner", "admin", "operator", "viewer", name="role"), default="viewer"),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_org_user"),
    )

    op.create_table(
        "invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("role", sa.Enum("owner", "admin", "operator", "viewer", name="role", create_type=False)),
        sa.Column("token", sa.String(128), unique=True),
        sa.Column("invited_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("accepted", sa.Boolean(), default=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "teams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "team_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("teams.id", ondelete="CASCADE")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("team_id", "user_id", name="uq_team_user"),
    )

    op.create_table(
        "servers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("hostname", sa.String(255), nullable=False),
        sa.Column("port", sa.Integer(), default=22),
        sa.Column("username", sa.String(128), nullable=False),
        sa.Column("encrypted_password", sa.Text()),
        sa.Column("encrypted_private_key", sa.Text()),
        sa.Column("auth_method", sa.String(20), default="password"),
        sa.Column("status", sa.Enum("online", "offline", "unknown", "error", name="serverstatus"), default="unknown"),
        sa.Column("os_info", sa.String(255)),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("metadata_json", sa.JSON()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "backup_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("retention_days", sa.Integer(), default=30),
        sa.Column("retention_count", sa.Integer(), default=10),
        sa.Column("retry_count", sa.Integer(), default=3),
        sa.Column("retry_delay_seconds", sa.Integer(), default=300),
        sa.Column("compression_enabled", sa.Boolean(), default=True),
        sa.Column("encryption_enabled", sa.Boolean(), default=True),
        sa.Column("cleanup_enabled", sa.Boolean(), default=True),
        sa.Column("cron_expression", sa.String(100)),
        sa.Column("config_json", sa.JSON()),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "backups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("servers.id", ondelete="SET NULL")),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("backup_policies.id", ondelete="SET NULL")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("backup_type", sa.Enum("full", "incremental", "differential", "snapshot", "database", "docker", "path", name="backuptype")),
        sa.Column("engine", sa.Enum("restic", "rsync", "rclone", "borg", name="backupengine"), default="restic"),
        sa.Column("source_paths", sa.JSON()),
        sa.Column("target_path", sa.String(512), nullable=False),
        sa.Column("schedule_cron", sa.String(100)),
        sa.Column("config_json", sa.JSON()),
        sa.Column("compression", sa.Boolean(), default=True),
        sa.Column("encryption", sa.Boolean(), default=True),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("health_score", sa.Float(), default=100.0),
        sa.Column("restore_confidence", sa.Float(), default=100.0),
        sa.Column("risk_level", sa.String(20), default="low"),
        sa.Column("corruption_probability", sa.Float(), default=0.0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "backup_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("backup_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("backups.id", ondelete="CASCADE")),
        sa.Column("status", sa.Enum("pending", "running", "completed", "failed", "cancelled", name="jobstatus"), default="pending"),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("bytes_processed", sa.Integer(), default=0),
        sa.Column("bytes_added", sa.Integer(), default=0),
        sa.Column("duration_seconds", sa.Float()),
        sa.Column("checksum_valid", sa.Boolean()),
        sa.Column("failed_chunks", sa.Integer(), default=0),
        sa.Column("error_message", sa.Text()),
        sa.Column("log_output", sa.Text()),
        sa.Column("snapshot_id", sa.String(255)),
        sa.Column("metadata_json", sa.JSON()),
        sa.Column("celery_task_id", sa.String(255)),
    )

    op.create_table(
        "restore_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("backup_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("backups.id", ondelete="CASCADE")),
        sa.Column("backup_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("backup_runs.id", ondelete="SET NULL")),
        sa.Column("initiated_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("status", sa.Enum("pending", "running", "completed", "failed", "cancelled", name="jobstatus", create_type=False)),
        sa.Column("target_path", sa.String(512), nullable=False),
        sa.Column("overwrite_protection", sa.Boolean(), default=True),
        sa.Column("restore_confidence", sa.Float(), default=0.0),
        sa.Column("estimated_duration_seconds", sa.Float()),
        sa.Column("ai_analysis_json", sa.JSON()),
        sa.Column("dependency_warnings", sa.JSON()),
        sa.Column("corruption_risks", sa.JSON()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("error_message", sa.Text()),
        sa.Column("log_output", sa.Text()),
        sa.Column("celery_task_id", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "log_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("level", sa.String(20), default="info"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("context_json", sa.JSON()),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("servers.id", ondelete="SET NULL")),
        sa.Column("backup_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("backups.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("alert_type", sa.String(50), nullable=False),
        sa.Column("severity", sa.Enum("info", "warning", "error", "critical", name="alertseverity"), default="info"),
        sa.Column("is_read", sa.Boolean(), default=False),
        sa.Column("is_resolved", sa.Boolean(), default=False),
        sa.Column("email_sent", sa.Boolean(), default=False),
        sa.Column("metadata_json", sa.JSON()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "metric_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("servers.id", ondelete="CASCADE")),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("cpu_percent", sa.Float()),
        sa.Column("memory_percent", sa.Float()),
        sa.Column("disk_percent", sa.Float()),
        sa.Column("disk_read_mb_s", sa.Float()),
        sa.Column("disk_write_mb_s", sa.Float()),
        sa.Column("network_in_mb_s", sa.Float()),
        sa.Column("network_out_mb_s", sa.Float()),
        sa.Column("backup_throughput_mb_s", sa.Float()),
        sa.Column("restore_throughput_mb_s", sa.Float()),
        sa.Column("uptime_seconds", sa.Float()),
        sa.Column("extra_json", sa.JSON()),
    )

    op.create_table(
        "storage_usage",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("total_bytes", sa.Integer(), default=0),
        sa.Column("used_bytes", sa.Integer(), default=0),
        sa.Column("compressed_bytes", sa.Integer(), default=0),
        sa.Column("redundant_bytes", sa.Integer(), default=0),
        sa.Column("backup_count", sa.Integer(), default=0),
        sa.Column("compression_ratio", sa.Float(), default=1.0),
    )

    op.create_table(
        "ai_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("title", sa.String(255), default="New conversation"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "ai_conversation_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ai_conversations.id", ondelete="CASCADE")),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.JSON()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.String(100)),
        sa.Column("details_json", sa.JSON()),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("token_hash", sa.String(128), unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("used", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    for table in [
        "password_reset_tokens", "audit_logs", "ai_conversation_messages", "ai_conversations",
        "storage_usage", "metric_snapshots", "alerts", "log_entries", "restore_jobs",
        "backup_runs", "backups", "backup_policies", "servers", "team_members", "teams",
        "invitations", "organization_members", "organizations", "users",
    ]:
        op.drop_table(table)
    for enum in ["role", "serverstatus", "backuptype", "backupengine", "jobstatus", "alertseverity"]:
        op.execute(f"DROP TYPE IF EXISTS {enum}")
