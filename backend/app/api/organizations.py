from pydantic import BaseModel
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.dependencies import CurrentUser, DbSession, OrgMembership, require_permission, verify_csrf
from app.core.role_utils import normalize_role, role_to_str
from app.models.entities import Invitation, Organization, OrganizationMember, Team, User
from app.schemas.resources import (
    AuditLogResponse,
    BillingInfo,
    InvitationCreate,
    InvitationResponse,
    MemberResponse,
    OrganizationResponse,
    TeamCreate,
    TeamResponse,
)
from app.services.audit import log_audit
from app.services.email_service import send_invitation_email

router = APIRouter(prefix="/organizations", tags=["organizations"])
settings = get_settings()


@router.get("/current", response_model=OrganizationResponse)
async def get_current_org(membership: OrgMembership):
    return OrganizationResponse.model_validate(membership.organization)


@router.get("/members", response_model=list[MemberResponse])
async def list_members(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("org:read"))],
):
    result = await db.execute(
        select(OrganizationMember, User)
        .join(User, OrganizationMember.user_id == User.id)
        .where(OrganizationMember.organization_id == membership.organization_id)
    )
    members = []
    for mem, user in result.all():
        members.append(
            MemberResponse(
                id=mem.id,
                user_id=user.id,
                email=user.email,
                full_name=user.full_name,
                role=role_to_str(mem.role),
                joined_at=mem.joined_at,
            )
        )
    return members


@router.post("/invitations", response_model=InvitationResponse, dependencies=[Depends(verify_csrf)])
async def create_invitation(
    data: InvitationCreate,
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("org:invite"))],
):
    token = secrets.token_urlsafe(32)
    invitation = Invitation(
        organization_id=membership.organization_id,
        email=data.email,
        role=normalize_role(data.role),
        token=token,
        invited_by_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(invitation)
    await db.flush()
    invite_url = f"{settings.FRONTEND_URL}/invite/{token}"
    await send_invitation_email(data.email, membership.organization.name, invite_url)
    return InvitationResponse.model_validate(invitation)


@router.get("/invitations", response_model=list[InvitationResponse])
async def list_invitations(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("org:read"))],
):
    result = await db.execute(
        select(Invitation).where(Invitation.organization_id == membership.organization_id, Invitation.accepted == False)
    )
    return [InvitationResponse.model_validate(i) for i in result.scalars().all()]


@router.post("/teams", response_model=TeamResponse, dependencies=[Depends(verify_csrf)])
async def create_team(
    data: TeamCreate,
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("org:manage"))],
):
    team = Team(organization_id=membership.organization_id, name=data.name, description=data.description)
    db.add(team)
    await db.flush()
    return TeamResponse(id=team.id, name=team.name, description=team.description, created_at=team.created_at)


@router.get("/teams", response_model=list[TeamResponse])
async def list_teams(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("org:read"))],
):
    result = await db.execute(
        select(Team).where(Team.organization_id == membership.organization_id).options(selectinload(Team.members))
    )
    teams = []
    for team in result.scalars().all():
        teams.append(
            TeamResponse(
                id=team.id,
                name=team.name,
                description=team.description,
                member_count=len(team.members),
                created_at=team.created_at,
            )
        )
    return teams


@router.get("/audit-logs", response_model=list[AuditLogResponse])
async def list_audit_logs(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("audit:read"))],
    limit: int = 100,
):
    from app.models.entities import AuditLog

    result = await db.execute(
        select(AuditLog, User.email)
        .outerjoin(User, AuditLog.user_id == User.id)
        .where(AuditLog.organization_id == membership.organization_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    logs = []
    for entry, email in result.all():
        logs.append(
            AuditLogResponse(
                id=entry.id,
                action=entry.action,
                resource_type=entry.resource_type,
                resource_id=entry.resource_id,
                user_email=email,
                details_json=entry.details_json,
                ip_address=entry.ip_address,
                created_at=entry.created_at,
            )
        )
    return logs


@router.get("/billing", response_model=BillingInfo)
async def get_billing(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("org:billing"))],
):
    from app.models.entities import Backup, Server, StorageUsage

    org = membership.organization
    members = await db.scalar(
        select(func.count(OrganizationMember.id)).where(OrganizationMember.organization_id == org.id)
    ) or 0
    servers = await db.scalar(select(func.count(Server.id)).where(Server.organization_id == org.id)) or 0
    backups = await db.scalar(select(func.count(Backup.id)).where(Backup.organization_id == org.id)) or 0
    storage_result = await db.execute(
        select(StorageUsage).where(StorageUsage.organization_id == org.id).order_by(StorageUsage.recorded_at.desc()).limit(1)
    )
    storage = storage_result.scalar_one_or_none()
    used_gb = (storage.used_bytes / 1024**3) if storage else 0

    return BillingInfo(
        plan=org.plan,
        storage_used_gb=used_gb,
        storage_quota_gb=org.storage_quota_gb,
        members_count=members,
        servers_count=servers,
        backups_count=backups,
    )


# ─── Direct user creation (no invite email needed) ───────────────────────────

class CreateUserRequest(BaseModel):
    email: str
    full_name: str
    password: str
    role: str = "viewer"

    @classmethod
    def validate_password_strength(cls, password: str) -> str:
        """Enforce minimum password strength: 8+ chars, at least 1 uppercase, 1 digit."""
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if not any(c.isupper() for c in password):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in password):
            raise ValueError("Password must contain at least one digit")
        return password


class CreateUserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    joined_at: datetime

    class Config:
        from_attributes = True


@router.post("/users", response_model=CreateUserResponse, dependencies=[Depends(verify_csrf)])
async def create_user(
    data: "CreateUserRequest",
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("org:invite"))],
):
    """Create a new user and add them directly to this organization."""
    from app.core.security import hash_password as _hash
    from app.core.role_utils import normalize_role as _nr

    # Validate password strength before proceeding
    try:
        CreateUserRequest.validate_password_strength(data.password)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Check email not already taken
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A user with this email already exists")

    new_user = User(
        email=data.email,
        full_name=data.full_name,
        hashed_password=_hash(data.password),
        is_verified=True,
    )
    db.add(new_user)
    await db.flush()

    role = _nr(data.role)
    new_membership = OrganizationMember(
        organization_id=membership.organization_id,
        user_id=new_user.id,
        role=role,
    )
    db.add(new_membership)
    await db.flush()

    await log_audit(
        db,
        membership.organization_id,
        "user.created",
        "user",
        resource_id=str(new_user.id),
    )

    from datetime import datetime, timezone as _tz
    await db.refresh(new_membership)
    return CreateUserResponse(
        id=new_user.id,
        email=new_user.email,
        full_name=new_user.full_name,
        role=role.value if hasattr(role, "value") else str(role),
        joined_at=new_membership.joined_at or datetime.now(_tz.utc),
    )



@router.delete("/members/{user_id}", dependencies=[Depends(verify_csrf)])
async def remove_member(
    user_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    membership: Annotated[OrganizationMember, Depends(require_permission("org:manage"))],
):
    """Remove a member from the organization."""
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")
    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == membership.organization_id,
        )
    )
    mem = result.scalar_one_or_none()
    if not mem:
        raise HTTPException(status_code=404, detail="Member not found")
    # Prevent removing the org owner
    from app.models.entities import UserRole
    if mem.role == UserRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot remove the organization owner")
    await db.delete(mem)
    await log_audit(db, membership.organization_id, "user.removed", "user", resource_id=str(user_id))
    return {"message": "Member removed"}
