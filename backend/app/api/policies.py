import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.core.dependencies import DbSession, require_permission, verify_csrf
from app.models.entities import OrganizationMember
from app.models.entities import BackupPolicy
from app.schemas.resources import PolicyCreate, PolicyResponse

router = APIRouter(prefix="/policies", tags=["policies"])


@router.get("", response_model=list[PolicyResponse])
async def list_policies(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("policy:read"))],
):
    result = await db.execute(
        select(BackupPolicy).where(BackupPolicy.organization_id == membership.organization_id)
    )
    return [PolicyResponse.model_validate(p) for p in result.scalars().all()]


@router.post("", response_model=PolicyResponse, dependencies=[Depends(verify_csrf)])
async def create_policy(
    data: PolicyCreate,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("policy:write"))],
):
    policy = BackupPolicy(organization_id=membership.organization_id, **data.model_dump())
    db.add(policy)
    await db.flush()
    return PolicyResponse.model_validate(policy)


@router.put("/{policy_id}", response_model=PolicyResponse, dependencies=[Depends(verify_csrf)])
async def update_policy(
    policy_id: uuid.UUID,
    data: PolicyCreate,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("policy:write"))],
):
    result = await db.execute(
        select(BackupPolicy).where(
            BackupPolicy.id == policy_id, BackupPolicy.organization_id == membership.organization_id
        )
    )
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    for k, v in data.model_dump().items():
        setattr(policy, k, v)
    await db.flush()
    return PolicyResponse.model_validate(policy)


@router.delete("/{policy_id}", dependencies=[Depends(verify_csrf)])
async def delete_policy(
    policy_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("policy:write"))],
):
    result = await db.execute(
        select(BackupPolicy).where(
            BackupPolicy.id == policy_id, BackupPolicy.organization_id == membership.organization_id
        )
    )
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    await db.delete(policy)
    return {"message": "Policy deleted"}
