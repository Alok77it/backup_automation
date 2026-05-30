import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DbSession, require_permission, verify_csrf
from app.models.entities import BackupRun, Incident, IncidentRecommendation, JobStatus, OrganizationMember
from app.schemas.resources import IncidentReportResponse, IncidentResponse
from app.services.audit import log_audit
from app.services.ops_intelligence import build_incident_report, get_incident, list_incidents
from app.workers.backup_tasks import execute_backup_run

router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.get("", response_model=list[IncidentResponse])
async def get_incidents(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("incident:read"))],
):
    return [IncidentResponse.model_validate(i) for i in await list_incidents(db, membership.organization_id)]


@router.get("/{incident_id}", response_model=IncidentResponse)
async def get_incident_detail(
    incident_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("incident:read"))],
):
    incident = await get_incident(db, membership.organization_id, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return IncidentResponse.model_validate(incident)


@router.post("/{incident_id}/resolve", dependencies=[Depends(verify_csrf)])
async def resolve_incident(
    incident_id: uuid.UUID,
    request: Request,
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("incident:manage"))],
):
    incident = await get_incident(db, membership.organization_id, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    incident.status = "resolved"
    incident.resolved_at = datetime.now(timezone.utc)
    await log_audit(
        db,
        membership.organization_id,
        "incident.resolve",
        "incident",
        user_id=user.id,
        resource_id=str(incident.id),
        details={"title": incident.title},
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "Incident resolved"}


@router.post("/{incident_id}/analyze", dependencies=[Depends(verify_csrf)])
async def analyze_incident(
    incident_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("ai:use"))],
):
    incident = await get_incident(db, membership.organization_id, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    latest_events = sorted(incident.events, key=lambda event: event.created_at, reverse=True)[:5]
    actions = [r.title for r in incident.recommendations if r.status != "executed"]
    return {
        "summary": incident.root_cause_summary or "The system has not identified a precise root cause yet.",
        "impact": incident.impact_summary or "Impact has not been assessed yet.",
        "evidence": [
            {"title": event.title, "message": event.message, "created_at": event.created_at.isoformat()}
            for event in latest_events
        ],
        "next_steps": actions or ["Monitor the incident and verify the next backup run completes successfully."],
    }


@router.post("/{incident_id}/recommendations/{recommendation_id}/execute", dependencies=[Depends(verify_csrf)])
async def execute_recommendation(
    incident_id: uuid.UUID,
    recommendation_id: uuid.UUID,
    request: Request,
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("repair:execute"))],
):
    incident_result = await db.execute(
        select(Incident).where(Incident.id == incident_id, Incident.organization_id == membership.organization_id)
    )
    incident = incident_result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    rec = await db.get(IncidentRecommendation, recommendation_id)
    if not rec or rec.incident_id != incident.id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    if rec.status == "executed":
        return {"message": "Recommendation already executed"}

    payload = rec.payload_json or {}
    if rec.action_type == "retry_backup":
        run_id = payload.get("run_id")
        if not run_id:
            raise HTTPException(status_code=422, detail="Missing failed run id")
        old_run = await db.get(BackupRun, uuid.UUID(run_id))
        if not old_run:
            raise HTTPException(status_code=404, detail="Backup run not found")
        retry = BackupRun(
            backup_id=old_run.backup_id,
            status=JobStatus.PENDING,
            metadata_json={"retry_of": str(old_run.id), "triggered_by": "incident_recommendation"},
        )
        db.add(retry)
        await db.flush()
        await db.commit()
        task = execute_backup_run.delay(str(retry.id))
        retry.celery_task_id = task.id
        await db.commit()
        rec.result_message = f"Retry run queued: {retry.id}"
    elif rec.action_type in {"preflight_check", "ssh_check"}:
        rec.result_message = "Preflight check recorded. Run the server connection test from Infrastructure before retrying."
    elif rec.action_type == "cleanup_backups":
        rec.result_message = "Cleanup requires retention policy review. Open Storage or Policies and confirm deletion scope."
    else:
        raise HTTPException(status_code=422, detail="Unsupported recommendation action")

    rec.status = "executed"
    rec.executed_at = datetime.now(timezone.utc)
    await log_audit(
        db,
        membership.organization_id,
        "incident.recommendation.execute",
        "incident_recommendation",
        user_id=user.id,
        resource_id=str(rec.id),
        details={"incident_id": str(incident.id), "action_type": rec.action_type},
        ip_address=request.client.host if request.client else None,
    )
    return {"message": rec.result_message}


@router.post("/{incident_id}/report", response_model=IncidentReportResponse, dependencies=[Depends(verify_csrf)])
async def create_report(
    incident_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("incident:manage"))],
):
    incident = await get_incident(db, membership.organization_id, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    report = await build_incident_report(db, incident, user.id)
    return IncidentReportResponse.model_validate(report)
