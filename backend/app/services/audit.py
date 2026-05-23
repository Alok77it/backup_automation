import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import AuditLog


async def log_audit(
    db: AsyncSession,
    organization_id: uuid.UUID,
    action: str,
    resource_type: str,
    user_id: uuid.UUID | None = None,
    resource_id: str | None = None,
    details: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        organization_id=organization_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details_json=details or {},
        ip_address=ip_address,
    )
    db.add(entry)
    await db.flush()
    return entry
