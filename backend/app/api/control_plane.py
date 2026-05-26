"""
Control Plane API Router
=========================
NEW router — server groups, tags, RBAC extensions for DevOps.
Registered via app_extension.py — main.py NOT modified.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import DbSession, OrgMembership, require_permission
from app.models.devops_entities import (
    DevOpsAuditLog,
    ServerGroup,
    ServerGroupMember,
    ServerTag,
)

router = APIRouter(prefix="/control-plane", tags=["Control Plane"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ServerGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    color: str | None = Field(None, max_length=20)


class ServerGroupOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    description: str | None
    color: str | None
    member_count: int = 0

    model_config = {"from_attributes": True}


class ServerGroupMemberAdd(BaseModel):
    server_id: uuid.UUID


class ServerTagSet(BaseModel):
    key: str = Field(..., min_length=1, max_length=100)
    value: str = Field(..., max_length=255)


class ServerTagOut(BaseModel):
    id: uuid.UUID
    server_id: uuid.UUID
    key: str
    value: str

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Server Groups
# ---------------------------------------------------------------------------

@router.get("/groups", response_model=list[ServerGroupOut])
async def list_server_groups(
    db: DbSession,
    membership: OrgMembership,
):
    result = await db.execute(
        select(ServerGroup).where(
            ServerGroup.organization_id == membership.organization_id
        ).order_by(ServerGroup.name)
    )
    groups = result.scalars().all()
    out = []
    for g in groups:
        count_result = await db.execute(
            select(ServerGroupMember).where(ServerGroupMember.group_id == g.id)
        )
        members = count_result.scalars().all()
        out.append(ServerGroupOut(
            id=g.id,
            organization_id=g.organization_id,
            name=g.name,
            description=g.description,
            color=g.color,
            member_count=len(members),
        ))
    return out


@router.post("/groups", response_model=ServerGroupOut, status_code=status.HTTP_201_CREATED)
async def create_server_group(
    body: ServerGroupCreate,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrgMembership.__class__,
        Depends(require_permission("server:write"))
    ],
):
    group = ServerGroup(
        organization_id=membership.organization_id,
        name=body.name,
        description=body.description,
        color=body.color,
        created_by=membership.user_id,
    )
    db.add(group)
    db.add(DevOpsAuditLog(
        organization_id=membership.organization_id,
        user_id=membership.user_id,
        action="server_group.created",
        resource_type="server_group",
        details={"name": body.name},
        ip_address=request.client.host if request.client else None,
    ))
    await db.commit()
    await db.refresh(group)
    return ServerGroupOut(
        id=group.id,
        organization_id=group.organization_id,
        name=group.name,
        description=group.description,
        color=group.color,
        member_count=0,
    )


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server_group(
    group_id: uuid.UUID,
    db: DbSession,
    request: Request,
    membership: Annotated[
        OrgMembership.__class__,
        Depends(require_permission("server:write"))
    ],
):
    result = await db.execute(
        select(ServerGroup).where(
            ServerGroup.id == group_id,
            ServerGroup.organization_id == membership.organization_id,
        )
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Server group not found")
    await db.execute(delete(ServerGroupMember).where(ServerGroupMember.group_id == group_id))
    await db.delete(group)
    await db.commit()


@router.post("/groups/{group_id}/members", status_code=status.HTTP_201_CREATED)
async def add_server_to_group(
    group_id: uuid.UUID,
    body: ServerGroupMemberAdd,
    db: DbSession,
    membership: Annotated[
        OrgMembership.__class__,
        Depends(require_permission("server:write"))
    ],
):
    result = await db.execute(
        select(ServerGroup).where(
            ServerGroup.id == group_id,
            ServerGroup.organization_id == membership.organization_id,
        )
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Server group not found")

    member = ServerGroupMember(group_id=group_id, server_id=body.server_id)
    db.add(member)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Server already in this group")
    return {"message": "Server added to group"}


@router.delete("/groups/{group_id}/members/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_server_from_group(
    group_id: uuid.UUID,
    server_id: uuid.UUID,
    db: DbSession,
    membership: Annotated[
        OrgMembership.__class__,
        Depends(require_permission("server:write"))
    ],
):
    await db.execute(
        delete(ServerGroupMember).where(
            ServerGroupMember.group_id == group_id,
            ServerGroupMember.server_id == server_id,
        )
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Server Tags
# ---------------------------------------------------------------------------

@router.get("/servers/{server_id}/tags", response_model=list[ServerTagOut])
async def get_server_tags(
    server_id: uuid.UUID,
    db: DbSession,
    membership: OrgMembership,
):
    result = await db.execute(
        select(ServerTag).where(
            ServerTag.server_id == server_id,
            ServerTag.organization_id == membership.organization_id,
        )
    )
    return list(result.scalars().all())


@router.put("/servers/{server_id}/tags/{key}", response_model=ServerTagOut)
async def upsert_server_tag(
    server_id: uuid.UUID,
    key: str,
    body: ServerTagSet,
    db: DbSession,
    membership: Annotated[
        OrgMembership.__class__,
        Depends(require_permission("server:write"))
    ],
):
    result = await db.execute(
        select(ServerTag).where(
            ServerTag.server_id == server_id,
            ServerTag.organization_id == membership.organization_id,
            ServerTag.key == key,
        )
    )
    tag = result.scalar_one_or_none()
    if tag:
        tag.value = body.value
    else:
        tag = ServerTag(
            organization_id=membership.organization_id,
            server_id=server_id,
            key=key,
            value=body.value,
        )
        db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/servers/{server_id}/tags/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server_tag(
    server_id: uuid.UUID,
    key: str,
    db: DbSession,
    membership: Annotated[
        OrgMembership.__class__,
        Depends(require_permission("server:write"))
    ],
):
    await db.execute(
        delete(ServerTag).where(
            ServerTag.server_id == server_id,
            ServerTag.organization_id == membership.organization_id,
            ServerTag.key == key,
        )
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Audit log (DevOps-specific)
# ---------------------------------------------------------------------------

class AuditLogOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    server_id: uuid.UUID | None
    action: str
    resource_type: str | None
    resource_id: str | None
    details: dict | None
    ip_address: str | None
    outcome: str
    risk_level: str | None
    created_at: str

    model_config = {"from_attributes": True}


@router.get("/audit-logs", response_model=list[AuditLogOut])
async def get_devops_audit_logs(
    db: DbSession,
    membership: Annotated[
        OrgMembership.__class__,
        Depends(require_permission("audit:read"))
    ],
    limit: int = 100,
    offset: int = 0,
    server_id: uuid.UUID | None = None,
):
    stmt = select(DevOpsAuditLog).where(
        DevOpsAuditLog.organization_id == membership.organization_id
    )
    if server_id:
        stmt = stmt.where(DevOpsAuditLog.server_id == server_id)
    stmt = stmt.order_by(DevOpsAuditLog.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    logs = result.scalars().all()
    return [
        AuditLogOut(
            **{k: getattr(l, k) for k in AuditLogOut.model_fields},
            created_at=l.created_at.isoformat(),
        )
        for l in logs
    ]
