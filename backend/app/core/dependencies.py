import uuid
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.rbac import has_permission
from app.core.security import decode_token
from app.models.entities import OrganizationMember, Role, User

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id), User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_org_membership(
    db: DbSession,
    user: CurrentUser,
    x_organization_id: Annotated[str | None, Header(alias="X-Organization-Id")] = None,
) -> OrganizationMember:
    if not x_organization_id:
        result = await db.execute(
            select(OrganizationMember)
            .where(OrganizationMember.user_id == user.id)
            .options(selectinload(OrganizationMember.organization))
            .limit(1)
        )
        membership = result.scalar_one_or_none()
        if not membership:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No organization context")
        return membership
    try:
        org_id = uuid.UUID(x_organization_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid organization ID") from e
    result = await db.execute(
        select(OrganizationMember)
        .where(OrganizationMember.user_id == user.id, OrganizationMember.organization_id == org_id)
        .options(selectinload(OrganizationMember.organization))
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this organization")
    return membership


OrgMembership = Annotated[OrganizationMember, Depends(get_org_membership)]


def require_permission(permission: str):
    async def checker(membership: OrgMembership) -> OrganizationMember:
        if not has_permission(membership.role, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return membership

    return checker


async def verify_csrf(
    request: Request,
    csrf_token: Annotated[str | None, Cookie(alias="csrf_token")] = None,
    x_csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> None:
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if not csrf_token or not x_csrf_token or csrf_token != x_csrf_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
