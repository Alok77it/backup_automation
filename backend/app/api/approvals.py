"""
Approval System API Router
============================
PENDING -> APPROVED -> EXECUTING -> COMPLETED | FAILED
Only OWNER / ADMIN can approve or reject.
All decisions are immutably audit-logged.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.core.dependencies import DbSession, OrgMembership, require_permission, verify_csrf
from app.models.devops_entities import ApprovalRequest, ApprovalStatus, RiskLevel
from app.models.entities import OrganizationMember
from app.services.execution_engine import ExecutionError, execution_engine

router = APIRouter(prefix="/approvals", tags=["Approval System"])


class ApprovalOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    requested_by: uuid.UUID
    reviewed_by: uuid.UUID | None
    title: str
    description: str | None
    action_type: str
    action_payload: dict | None
    risk_level: str
    server_id: uuid.UUID | None
    status: str
    review_note: str | None
    expires_at: datetime | None
    reviewed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApprovalDecision(BaseModel):
    note: str | None = None


@router.get("", response_model=list[ApprovalOut])
async def list_approvals(
    db: DbSession,
    membership: OrgMembership,
    status_filter: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    from sqlalchemy import select
    stmt = select(ApprovalRequest).where(
        ApprovalRequest.organization_id == membership.organization_id
    )
    if status_filter:
        try:
            stmt = stmt.where(ApprovalRequest.status == ApprovalStatus(status_filter))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status_filter}")
    stmt = stmt.order_by(ApprovalRequest.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/pending", response_model=list[ApprovalOut])
async def get_pending_approvals(
    db: DbSession,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("org:manage"))
    ],
):
    """Quick view of all pending approvals -- requires admin+."""
    return await execution_engine.get_pending_approvals(
        db, organization_id=membership.organization_id
    )


@router.get("/{approval_id}", response_model=ApprovalOut)
async def get_approval(
    approval_id: uuid.UUID,
    db: DbSession,
    membership: OrgMembership,
):
    from sqlalchemy import select
    result = await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.id == approval_id,
            ApprovalRequest.organization_id == membership.organization_id,
        )
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval


@router.post("/{approval_id}/approve", response_model=ApprovalOut, dependencies=[Depends(verify_csrf)])
async def approve_request(
    approval_id: uuid.UUID,
    body: ApprovalDecision,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("org:manage"))
    ],
):
    """Approve a pending HIGH-risk job. Requires Admin or Owner role."""
    try:
        await execution_engine.approve_and_enqueue(
            db,
            approval_id=approval_id,
            reviewed_by=membership.user_id,
            review_note=body.note,
            ip_address=request.client.host if request.client else None,
        )
        from sqlalchemy import select
        result = await db.execute(
            select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
        )
        return result.scalar_one()
    except ExecutionError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{approval_id}/reject", response_model=ApprovalOut, dependencies=[Depends(verify_csrf)])
async def reject_request(
    approval_id: uuid.UUID,
    body: ApprovalDecision,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrganizationMember,
        Depends(require_permission("org:manage"))
    ],
):
    """Reject a pending request. The linked job is cancelled. Requires Admin or Owner role."""
    try:
        approval = await execution_engine.reject_approval(
            db,
            approval_id=approval_id,
            reviewed_by=membership.user_id,
            review_note=body.note,
            ip_address=request.client.host if request.client else None,
        )
        return approval
    except ExecutionError as e:
        raise HTTPException(status_code=400, detail=str(e))
