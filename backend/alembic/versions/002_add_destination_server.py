"""Add destination_server_id to backups

Revision ID: 002
Revises: 001
Create Date: 2026-05-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "backups",
        sa.Column(
            "destination_server_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("servers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_backups_destination_server_id", "backups", ["destination_server_id"])


def downgrade() -> None:
    op.drop_index("ix_backups_destination_server_id", table_name="backups")
    op.drop_column("backups", "destination_server_id")
