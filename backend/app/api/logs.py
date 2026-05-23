from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select

from app.core.dependencies import DbSession, require_permission
from app.models.entities import OrganizationMember
from app.models.entities import LogEntry
from app.schemas.common import PaginatedResponse
from app.schemas.resources import LogEntryResponse
from app.services.ai_service import summarize_logs

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("", response_model=PaginatedResponse[LogEntryResponse])
async def search_logs(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("org:read"))],
    query: str | None = None,
    source: str | None = None,
    level: str | None = None,
    page: int = 1,
    page_size: int = 50,
):
    org_id = membership.organization_id
    base = select(LogEntry).where(LogEntry.organization_id == org_id)
    if query:
        base = base.where(or_(LogEntry.message.ilike(f"%{query}%")))
    if source:
        base = base.where(LogEntry.source == source)
    if level:
        base = base.where(LogEntry.level == level)

    count_result = await db.execute(select(LogEntry.id).where(LogEntry.organization_id == org_id))
    total = len(count_result.all())

    result = await db.execute(
        base.order_by(LogEntry.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    items = [LogEntryResponse.model_validate(e) for e in result.scalars().all()]
    pages = max(1, (total + page_size - 1) // page_size)
    return PaginatedResponse(items=items, total=total, page=page, page_size=page_size, pages=pages)


@router.post("/summarize")
async def ai_summarize_logs(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
    limit: int = 100,
):
    result = await db.execute(
        select(LogEntry)
        .where(LogEntry.organization_id == membership.organization_id)
        .order_by(LogEntry.created_at.desc())
        .limit(limit)
    )
    logs = [
        {"source": l.source, "level": l.level, "message": l.message, "created_at": str(l.created_at)}
        for l in result.scalars().all()
    ]
    summary = await summarize_logs(logs)
    return {"summary": summary, "log_count": len(logs)}
