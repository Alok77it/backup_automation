import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select

from app.core.dependencies import CurrentUser, DbSession, require_permission, verify_csrf
from app.models.entities import OrganizationMember
from app.models.entities import AIConversation, AIConversationMessage, Alert, Backup, BackupRun, JobStatus, LogEntry, Server
from app.schemas.resources import AIChatRequest, AIChatResponse, AIConversationResponse
from app.core.config import get_settings
from app.services.ai_service import get_ai_response

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status")
async def ai_status(
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    settings = get_settings()
    provider = settings.ai_provider
    return {
        "provider": provider,
        "configured": provider != "none",
        "anthropic": bool(settings.ANTHROPIC_API_KEY),
        "openai": bool(settings.OPENAI_API_KEY),
    }


async def _build_context(db, org_id: uuid.UUID) -> dict:
    failed_runs = await db.execute(
        select(BackupRun)
        .join(Backup)
        .where(Backup.organization_id == org_id, BackupRun.status == JobStatus.FAILED)
        .order_by(BackupRun.started_at.desc())
        .limit(5)
    )
    recent_failures = [
        {"error": r.error_message, "backup_id": str(r.backup_id)} for r in failed_runs.scalars().all()
    ]

    servers = await db.execute(select(Server).where(Server.organization_id == org_id))
    servers_at_risk = [
        {"name": s.name, "status": s.status.value} for s in servers.scalars().all() if s.status.value != "online"
    ]

    restore_conf = await db.scalar(
        select(func.avg(Backup.restore_confidence)).where(Backup.organization_id == org_id)
    )

    from app.models.entities import StorageUsage

    storage = await db.execute(
        select(StorageUsage).where(StorageUsage.organization_id == org_id).order_by(StorageUsage.recorded_at.desc()).limit(1)
    )
    s = storage.scalar_one_or_none()

    return {
        "recent_failures": recent_failures,
        "servers_at_risk": servers_at_risk,
        "restore_confidence": float(restore_conf or 0),
        "storage_used_gb": (s.used_bytes / 1024**3) if s else 0,
        "storage_quota_gb": 100,
        "unresolved_alerts": await db.scalar(
            select(func.count(Alert.id)).where(Alert.organization_id == org_id, Alert.is_resolved == False)
        ),
    }


@router.post("/chat", response_model=AIChatResponse, dependencies=[Depends(verify_csrf)])
async def chat(
    data: AIChatRequest,
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    org_id = membership.organization_id
    context = await _build_context(db, org_id)

    if data.conversation_id:
        conv = await db.get(AIConversation, data.conversation_id)
        if not conv or conv.organization_id != org_id:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conv = AIConversation(organization_id=org_id, user_id=user.id, title=data.message[:80])
        db.add(conv)
        await db.flush()

    user_msg = AIConversationMessage(conversation_id=conv.id, role="user", content=data.message)
    db.add(user_msg)

    history_result = await db.execute(
        select(AIConversationMessage)
        .where(AIConversationMessage.conversation_id == conv.id)
        .order_by(AIConversationMessage.created_at.asc())
        .limit(20)
    )
    history = [{"role": m.role, "content": m.content} for m in history_result.scalars().all()]

    response_text = await get_ai_response(data.message, context, history)
    assistant_msg = AIConversationMessage(conversation_id=conv.id, role="assistant", content=response_text)
    db.add(assistant_msg)
    await db.flush()

    return AIChatResponse(conversation_id=conv.id, message=response_text)


@router.get("/conversations", response_model=list[AIConversationResponse])
async def list_conversations(
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    result = await db.execute(
        select(AIConversation)
        .where(AIConversation.organization_id == membership.organization_id, AIConversation.user_id == user.id)
        .order_by(AIConversation.updated_at.desc())
    )
    convs = []
    for c in result.scalars().all():
        count = await db.scalar(
            select(func.count(AIConversationMessage.id)).where(AIConversationMessage.conversation_id == c.id)
        )
        convs.append(AIConversationResponse(id=c.id, title=c.title, created_at=c.created_at, updated_at=c.updated_at, message_count=count or 0))
    return convs


@router.post("/analyze-failure/{run_id}")
async def analyze_failure(
    run_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    from app.services.ai_service import analyze_backup_failure

    result = await db.execute(
        select(BackupRun)
        .join(Backup)
        .where(BackupRun.id == run_id, Backup.organization_id == membership.organization_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    analysis = await analyze_backup_failure(
        run.error_message or "Unknown error",
        run.log_output or "",
        {"backup_id": str(run.backup_id), "status": run.status.value},
    )
    return {"analysis": analysis}
