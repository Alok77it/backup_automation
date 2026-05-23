"""Add ai_actions table for human-in-the-loop AI command approval

Revision ID: 004
Revises: 003
Create Date: 2026-05-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the AIActionStatus enum type only if it doesn't already exist
    aiactionstatus = postgresql.ENUM(
        "pending_approval",
        "approved",
        "rejected",
        "executing",
        "executed",
        "failed",
        name="aiactionstatus",
        create_type=False,  # we handle creation manually below
    )
    aiactionstatus.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "ai_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status",
            # create_type=False so SQLAlchemy doesn't try to CREATE TYPE again
            # inside create_table — we already handled it above
            postgresql.ENUM(
                "pending_approval",
                "approved",
                "rejected",
                "executing",
                "executed",
                "failed",
                name="aiactionstatus",
                create_type=False,
            ),
            nullable=False,
            server_default="pending_approval",
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("command", sa.Text(), nullable=False),
        sa.Column("risk_level", sa.String(20), nullable=False, server_default="low"),
        sa.Column("server_name", sa.String(255), nullable=True),
        sa.Column("result_output", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("celery_task_id", sa.String(255), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["approved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["ai_conversations.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ai_actions_org_status", "ai_actions", ["organization_id", "status"]
    )
    op.create_index(
        "ix_ai_actions_organization_id", "ai_actions", ["organization_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_ai_actions_organization_id", table_name="ai_actions")
    op.drop_index("ix_ai_actions_org_status", table_name="ai_actions")
    op.drop_table("ai_actions")
    postgresql.ENUM(name="aiactionstatus", create_type=False).drop(op.get_bind(), checkfirst=True)
