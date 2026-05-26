"""Add encrypted reusable credentials

Revision ID: 006
Revises: 005
Create Date: 2026-05-26
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "006"
down_revision: str = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stored_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("encrypted_secret", sa.Text(), nullable=False),
        sa.Column("registry_url", sa.String(500), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "server_id", "provider", "label", name="uq_credential_scope_provider_label"),
    )
    op.create_index("ix_credentials_org_provider", "stored_credentials", ["organization_id", "provider"])
    op.create_index("ix_credentials_server", "stored_credentials", ["server_id"])


def downgrade() -> None:
    op.drop_index("ix_credentials_server", table_name="stored_credentials")
    op.drop_index("ix_credentials_org_provider", table_name="stored_credentials")
    op.drop_table("stored_credentials")
