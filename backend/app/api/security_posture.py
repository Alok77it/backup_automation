import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DbSession, require_permission, verify_csrf
from app.models.entities import OrganizationMember, SecurityFinding
from app.schemas.resources import SecurityPostureResponse
from app.services.audit import log_audit
from app.services.ops_intelligence import security_posture

router = APIRouter(prefix="/security", tags=["security"])


@router.get("/posture", response_model=SecurityPostureResponse)
async def get_security_posture(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("security:read"))],
):
    return await security_posture(db, membership.organization_id)


@router.post("/findings/{finding_id}/dismiss", dependencies=[Depends(verify_csrf)])
async def dismiss_finding(
    finding_id: uuid.UUID,
    request: Request,
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("security:manage"))],
):
    result = await db.execute(
        select(SecurityFinding).where(
            SecurityFinding.id == finding_id,
            SecurityFinding.organization_id == membership.organization_id,
        )
    )
    finding = result.scalar_one_or_none()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")
    finding.status = "dismissed"
    finding.dismissed_at = datetime.now(timezone.utc)
    await log_audit(
        db,
        membership.organization_id,
        "security.finding.dismiss",
        "security_finding",
        user_id=user.id,
        resource_id=str(finding.id),
        details={"finding_key": finding.finding_key, "title": finding.title},
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "Finding dismissed"}
