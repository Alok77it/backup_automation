import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import LogEntry


async def create_log(
    db: AsyncSession,
    organization_id: uuid.UUID,
    source: str,
    message: str,
    level: str = "info",
    context: dict[str, Any] | None = None,
    server_id: uuid.UUID | None = None,
    backup_id: uuid.UUID | None = None,
) -> LogEntry:
    entry = LogEntry(
        organization_id=organization_id,
        source=source,
        level=level,
        message=message,
        context_json=context or {},
        server_id=server_id,
        backup_id=backup_id,
    )
    db.add(entry)
    await db.flush()
    return entry
