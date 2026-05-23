import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update

from app.core.dependencies import DbSession, OrgMembership, require_permission, verify_csrf
from app.models.entities import Alert
from app.schemas.resources import AlertResponse

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertResponse])
async def list_alerts(
    db: DbSession,
    membership: OrgMembership = Depends(require_permission("alert:read")),
    unresolved_only: bool = False,
):
    query = select(Alert).where(Alert.organization_id == membership.organization_id)
    if unresolved_only:
        query = query.where(Alert.is_resolved == False)
    result = await db.execute(query.order_by(Alert.created_at.desc()).limit(100))
    return [AlertResponse.model_validate(a) for a in result.scalars().all()]


@router.post("/{alert_id}/read", dependencies=[Depends(verify_csrf)])
async def mark_read(
    alert_id: uuid.UUID,
    db: DbSession,
    membership: OrgMembership = Depends(require_permission("alert:manage")),
):
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.organization_id == membership.organization_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.is_read = True
    await db.flush()
    return {"message": "Marked as read"}


@router.post("/{alert_id}/resolve", dependencies=[Depends(verify_csrf)])
async def resolve_alert(
    alert_id: uuid.UUID,
    db: DbSession,
    membership: OrgMembership = Depends(require_permission("alert:manage")),
):
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.organization_id == membership.organization_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.is_resolved = True
    await db.flush()
    return {"message": "Resolved"}


@router.post("/mark-all-read", dependencies=[Depends(verify_csrf)])
async def mark_all_read(
    db: DbSession,
    membership: OrgMembership = Depends(require_permission("alert:manage")),
):
    await db.execute(
        update(Alert)
        .where(Alert.organization_id == membership.organization_id, Alert.is_read == False)
        .values(is_read=True)
    )
    return {"message": "All alerts marked as read"}
