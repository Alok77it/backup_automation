"""Change byte columns from Integer to BigInteger

Revision ID: 003
Revises: 002
Create Date: 2026-05-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # backup_runs
    op.alter_column("backup_runs", "bytes_processed", type_=sa.BigInteger(), existing_type=sa.Integer())
    op.alter_column("backup_runs", "bytes_added",     type_=sa.BigInteger(), existing_type=sa.Integer())

    # storage_usage
    op.alter_column("storage_usage", "total_bytes",      type_=sa.BigInteger(), existing_type=sa.Integer())
    op.alter_column("storage_usage", "used_bytes",       type_=sa.BigInteger(), existing_type=sa.Integer())
    op.alter_column("storage_usage", "compressed_bytes", type_=sa.BigInteger(), existing_type=sa.Integer())
    op.alter_column("storage_usage", "redundant_bytes",  type_=sa.BigInteger(), existing_type=sa.Integer())


def downgrade() -> None:
    op.alter_column("storage_usage", "redundant_bytes",  type_=sa.Integer(), existing_type=sa.BigInteger())
    op.alter_column("storage_usage", "compressed_bytes", type_=sa.Integer(), existing_type=sa.BigInteger())
    op.alter_column("storage_usage", "used_bytes",       type_=sa.Integer(), existing_type=sa.BigInteger())
    op.alter_column("storage_usage", "total_bytes",      type_=sa.Integer(), existing_type=sa.BigInteger())
    op.alter_column("backup_runs",   "bytes_added",      type_=sa.Integer(), existing_type=sa.BigInteger())
    op.alter_column("backup_runs",   "bytes_processed",  type_=sa.Integer(), existing_type=sa.BigInteger())
