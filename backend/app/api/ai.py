import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select

from app.core.dependencies import CurrentUser, DbSession, require_permission, verify_csrf
from app.models.entities import (
    AIAction,
    AIActionStatus,
    AIConversation,
    AIConversationMessage,
    Alert,
    Backup,
    BackupRun,
    JobStatus,
    LogEntry,
    MetricSnapshot,
    OrganizationMember,
    Server,
    StorageUsage,
)
from app.schemas.resources import (
    AIChatRequest,
    AIChatResponse,
    AIActionResponse,
    AIConversationResponse,
)
from app.core.config import get_settings
from app.services.ai_service import analyze_backup_failure, get_ai_response, parse_actions

router = APIRouter(prefix="/ai", tags=["ai"])


# ─── Status ───────────────────────────────────────────────────────────────────

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


# ─── Context builder ──────────────────────────────────────────────────────────

async def _build_context(db, org_id: uuid.UUID) -> dict:
    """Gather comprehensive live system data to feed to the AI."""

    # ── Servers ──────────────────────────────────────────────────────────────
    servers_result = await db.execute(
        select(Server).where(Server.organization_id == org_id)
    )
    all_server_objs = servers_result.scalars().all()

    # Latest metric snapshot per server
    server_metrics: dict[str, dict] = {}
    for s in all_server_objs:
        m = await db.execute(
            select(MetricSnapshot)
            .where(MetricSnapshot.server_id == s.id)
            .order_by(MetricSnapshot.recorded_at.desc())
            .limit(1)
        )
        snap = m.scalar_one_or_none()
        server_metrics[str(s.id)] = {
            "cpu": round(snap.cpu_percent or 0, 1) if snap else None,
            "mem": round(snap.memory_percent or 0, 1) if snap else None,
            "disk": round(snap.disk_percent or 0, 1) if snap else None,
            "last_metric_at": snap.recorded_at.isoformat() if snap else None,
        }

    all_servers = [
        {
            "id": str(s.id),          # included so AI can put it in ACTION blocks
            "name": s.name,
            "hostname": s.hostname,
            "port": s.port,
            "username": s.username,
            "status": s.status.value,
            "os_info": s.os_info,
            "last_seen_at": s.last_seen_at.isoformat() if s.last_seen_at else None,
            **server_metrics.get(str(s.id), {}),
        }
        for s in all_server_objs
    ]
    servers_at_risk = [s for s in all_servers if s["status"] != "online"]

    # ── Backups ───────────────────────────────────────────────────────────────
    backups_result = await db.execute(
        select(Backup).where(Backup.organization_id == org_id, Backup.is_active == True)
    )
    all_backup_objs = backups_result.scalars().all()

    # Last run per backup
    backups_info = []
    for b in all_backup_objs:
        last_run = await db.execute(
            select(BackupRun)
            .where(BackupRun.backup_id == b.id)
            .order_by(BackupRun.started_at.desc())
            .limit(1)
        )
        lr = last_run.scalar_one_or_none()
        backups_info.append(
            {
                "id": str(b.id),
                "name": b.name,
                "engine": b.engine.value,
                "backup_type": b.backup_type.value,
                "health_score": round(b.health_score, 1),
                "restore_confidence": round(b.restore_confidence, 1),
                "risk_level": b.risk_level,
                "schedule_cron": b.schedule_cron,
                "last_run_status": lr.status.value if lr else None,
                "last_run_at": lr.started_at.isoformat() if lr and lr.started_at else None,
                "last_run_error": lr.error_message if lr and lr.status == JobStatus.FAILED else None,
            }
        )
    backups_at_risk = [b for b in backups_info if b["health_score"] < 70 or b["risk_level"] in ("high", "critical")]

    # ── Recent failures ───────────────────────────────────────────────────────
    failed_result = await db.execute(
        select(BackupRun, Backup)
        .join(Backup, BackupRun.backup_id == Backup.id)
        .where(
            Backup.organization_id == org_id,
            BackupRun.status == JobStatus.FAILED,
        )
        .order_by(BackupRun.started_at.desc())
        .limit(10)
    )
    recent_failures = [
        {
            "backup_name": backup.name,
            "run_id": str(run.id),
            "error": run.error_message or "Unknown error",
            "log_tail": (run.log_output or "")[-500:] if run.log_output else None,
            "failed_at": run.started_at.isoformat() if run.started_at else None,
            "server": next(
                (s["hostname"] for s in all_servers if s["id"] == str(backup.server_id)),
                None,
            ),
        }
        for run, backup in failed_result.all()
    ]

    # ── Recent log entries (errors + warnings) ────────────────────────────────
    logs_result = await db.execute(
        select(LogEntry)
        .where(
            LogEntry.organization_id == org_id,
            LogEntry.level.in_(["error", "warning", "critical"]),
        )
        .order_by(LogEntry.created_at.desc())
        .limit(20)
    )
    recent_errors = [
        {
            "level": le.level,
            "source": le.source,
            "message": le.message[:300],
            "created_at": le.created_at.isoformat(),
            "server_id": str(le.server_id) if le.server_id else None,
            "backup_id": str(le.backup_id) if le.backup_id else None,
        }
        for le in logs_result.scalars().all()
    ]

    # ── Alerts ────────────────────────────────────────────────────────────────
    alerts_result = await db.execute(
        select(Alert)
        .where(Alert.organization_id == org_id, Alert.is_resolved == False)
        .order_by(Alert.created_at.desc())
        .limit(10)
    )
    unresolved_alert_list = [
        {
            "title": a.title,
            "severity": a.severity.value,
            "message": a.message[:200],
            "created_at": a.created_at.isoformat(),
        }
        for a in alerts_result.scalars().all()
    ]

    # ── Storage ───────────────────────────────────────────────────────────────
    storage = await db.execute(
        select(StorageUsage)
        .where(StorageUsage.organization_id == org_id)
        .order_by(StorageUsage.recorded_at.desc())
        .limit(1)
    )
    s = storage.scalar_one_or_none()

    avg_restore_conf = await db.scalar(
        select(func.avg(Backup.restore_confidence)).where(Backup.organization_id == org_id)
    )

    return {
        "all_servers": all_servers,
        "servers_at_risk": servers_at_risk,
        "all_backups": backups_info,
        "backups_at_risk": backups_at_risk,
        "recent_failures": recent_failures,
        "recent_errors": recent_errors,
        "unresolved_alerts": len(unresolved_alert_list),
        "alert_details": unresolved_alert_list,
        "storage_used_gb": round(s.used_bytes / 1024**3, 2) if s else 0,
        "storage_quota_gb": 100,
        "avg_restore_confidence": round(float(avg_restore_conf or 0), 1),
    }


# ─── Chat ─────────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=AIChatResponse, dependencies=[Depends(verify_csrf)])
async def chat(
    data: AIChatRequest,
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    org_id = membership.organization_id
    context = await _build_context(db, org_id)

    # Get or create conversation
    if data.conversation_id:
        conv = await db.get(AIConversation, data.conversation_id)
        if not conv or conv.organization_id != org_id:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conv = AIConversation(organization_id=org_id, user_id=user.id, title=data.message[:80])
        db.add(conv)
        await db.flush()

    # Save user message
    user_msg = AIConversationMessage(conversation_id=conv.id, role="user", content=data.message)
    db.add(user_msg)

    # Fetch conversation history
    history_result = await db.execute(
        select(AIConversationMessage)
        .where(AIConversationMessage.conversation_id == conv.id)
        .order_by(AIConversationMessage.created_at.asc())
        .limit(20)
    )
    history = [{"role": m.role, "content": m.content} for m in history_result.scalars().all()]

    # Get AI response (raw — may contain ACTION blocks)
    raw_response = await get_ai_response(data.message, context, history)

    # Parse out ACTION blocks → create AIAction DB records
    cleaned_response, proposed = parse_actions(raw_response)

    saved_actions: list[AIAction] = []
    for pa in proposed:
        # Validate server_id is a real server in this org
        server_obj = None
        server_name = None
        if pa.server_id:
            try:
                sid = uuid.UUID(pa.server_id)
                server_obj = await db.get(Server, sid)
                if server_obj and server_obj.organization_id != org_id:
                    server_obj = None  # reject cross-org
                if server_obj:
                    server_name = server_obj.name
            except (ValueError, Exception):
                pass

        action = AIAction(
            organization_id=org_id,
            conversation_id=conv.id,
            server_id=server_obj.id if server_obj else None,
            status=AIActionStatus.PENDING_APPROVAL,
            title=pa.title,
            description=pa.description,
            command=pa.command,
            risk_level=pa.risk_level,
            server_name=server_name,
        )
        db.add(action)
        saved_actions.append(action)

    # Save cleaned AI message to conversation
    assistant_msg = AIConversationMessage(
        conversation_id=conv.id, role="assistant", content=cleaned_response
    )
    db.add(assistant_msg)
    await db.flush()

    # Refresh IDs for response
    for action in saved_actions:
        await db.refresh(action)

    action_responses = [
        AIActionResponse(
            id=a.id,
            title=a.title,
            description=a.description,
            command=a.command,
            server_id=a.server_id,
            server_name=a.server_name,
            risk_level=a.risk_level,
            status=a.status.value,
            result_output=a.result_output,
            error_message=a.error_message,
            created_at=a.created_at,
        )
        for a in saved_actions
    ]

    return AIChatResponse(
        conversation_id=conv.id,
        message=cleaned_response,
        proposed_actions=action_responses,
    )


# ─── Conversations ────────────────────────────────────────────────────────────

@router.get("/conversations", response_model=list[AIConversationResponse])
async def list_conversations(
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    result = await db.execute(
        select(AIConversation)
        .where(
            AIConversation.organization_id == membership.organization_id,
            AIConversation.user_id == user.id,
        )
        .order_by(AIConversation.updated_at.desc())
    )
    convs = []
    for c in result.scalars().all():
        count = await db.scalar(
            select(func.count(AIConversationMessage.id)).where(
                AIConversationMessage.conversation_id == c.id
            )
        )
        convs.append(
            AIConversationResponse(
                id=c.id,
                title=c.title,
                created_at=c.created_at,
                updated_at=c.updated_at,
                message_count=count or 0,
            )
        )
    return convs


# ─── AI Actions (approval workflow) ──────────────────────────────────────────

@router.get("/actions", response_model=list[AIActionResponse])
async def list_actions(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
    status: str | None = None,
):
    """List AI-proposed actions. Defaults to pending_approval if no status given."""
    filter_status = status or "pending_approval"
    result = await db.execute(
        select(AIAction)
        .where(
            AIAction.organization_id == membership.organization_id,
            AIAction.status == filter_status,
        )
        .order_by(AIAction.created_at.desc())
        .limit(50)
    )
    return [
        AIActionResponse(
            id=a.id,
            title=a.title,
            description=a.description,
            command=a.command,
            server_id=a.server_id,
            server_name=a.server_name,
            risk_level=a.risk_level,
            status=a.status.value,
            result_output=a.result_output,
            error_message=a.error_message,
            created_at=a.created_at,
        )
        for a in result.scalars().all()
    ]


@router.get("/actions/{action_id}", response_model=AIActionResponse)
async def get_action(
    action_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    action = await db.get(AIAction, action_id)
    if not action or action.organization_id != membership.organization_id:
        raise HTTPException(status_code=404, detail="Action not found")
    return AIActionResponse(
        id=action.id,
        title=action.title,
        description=action.description,
        command=action.command,
        server_id=action.server_id,
        server_name=action.server_name,
        risk_level=action.risk_level,
        status=action.status.value,
        result_output=action.result_output,
        error_message=action.error_message,
        created_at=action.created_at,
    )


@router.post(
    "/actions/{action_id}/approve",
    response_model=AIActionResponse,
    dependencies=[Depends(verify_csrf)],
)
async def approve_action(
    action_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    """Approve an AI-proposed action. Dispatches Celery task for SSH execution."""
    from datetime import datetime, timezone

    action = await db.get(AIAction, action_id)
    if not action or action.organization_id != membership.organization_id:
        raise HTTPException(status_code=404, detail="Action not found")
    if action.status != AIActionStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=400,
            detail=f"Action is already {action.status.value}",
        )
    if not action.server_id:
        raise HTTPException(status_code=400, detail="Action has no target server")

    action.status = AIActionStatus.APPROVED
    action.approved_by_id = user.id
    action.approved_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(action)

    # Dispatch Celery task
    from app.workers.backup_tasks import execute_ai_action as _exec_task

    task = _exec_task.delay(str(action.id))
    action.celery_task_id = task.id
    await db.flush()

    return AIActionResponse(
        id=action.id,
        title=action.title,
        description=action.description,
        command=action.command,
        server_id=action.server_id,
        server_name=action.server_name,
        risk_level=action.risk_level,
        status=action.status.value,
        result_output=action.result_output,
        error_message=action.error_message,
        created_at=action.created_at,
    )


@router.post(
    "/actions/{action_id}/reject",
    response_model=AIActionResponse,
    dependencies=[Depends(verify_csrf)],
)
async def reject_action(
    action_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    """Reject an AI-proposed action — no command will run."""
    action = await db.get(AIAction, action_id)
    if not action or action.organization_id != membership.organization_id:
        raise HTTPException(status_code=404, detail="Action not found")
    if action.status != AIActionStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=400,
            detail=f"Action is already {action.status.value}",
        )

    action.status = AIActionStatus.REJECTED
    await db.flush()

    return AIActionResponse(
        id=action.id,
        title=action.title,
        description=action.description,
        command=action.command,
        server_id=action.server_id,
        server_name=action.server_name,
        risk_level=action.risk_level,
        status=action.status.value,
        result_output=action.result_output,
        error_message=action.error_message,
        created_at=action.created_at,
    )


# ─── Failure analysis ─────────────────────────────────────────────────────────

@router.post("/analyze-failure/{run_id}")
async def analyze_failure(
    run_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    result = await db.execute(
        select(BackupRun)
        .join(Backup)
        .where(
            BackupRun.id == run_id,
            Backup.organization_id == membership.organization_id,
        )
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
