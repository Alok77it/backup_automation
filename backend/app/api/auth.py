import re
import uuid
from datetime import datetime, timedelta, timezone

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import select

from app.core.config import get_settings
from app.core.dependencies import DbSession, verify_csrf
from app.core.role_utils import normalize_role, role_to_str
from app.core.security import (
    create_access_token,
    create_refresh_token,
    create_reset_token,
    decode_token,
    generate_csrf_token,
    hash_password,
    verify_password,
)
from app.models.entities import Organization, OrganizationMember, PasswordResetToken, Role, User
from app.schemas.auth import (
    AuthResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    ResetPasswordRequest,
    SignupRequest,
    TokenResponse,
    UserResponse,
)
from app.services.audit import log_audit
from app.services.email_service import send_password_reset_email, send_welcome_notification

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:50] or "org"


def _set_csrf_cookie(response: Response, csrf: str) -> None:
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=csrf,
        httponly=False,
        samesite="lax",
        secure=settings.SESSION_COOKIE_SECURE,
        path="/",
    )


@router.post("/signup", response_model=AuthResponse)
async def signup(request: Request, data: SignupRequest, db: DbSession, response: Response):
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        is_verified=True,
    )
    db.add(user)
    await db.flush()

    base_slug = _slugify(data.organization_name)
    slug = base_slug
    counter = 1
    while True:
        check = await db.execute(select(Organization).where(Organization.slug == slug))
        if not check.scalar_one_or_none():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1

    org = Organization(name=data.organization_name, slug=slug)
    db.add(org)
    await db.flush()

    owner_role = Role.OWNER
    membership = OrganizationMember(
        organization_id=org.id,
        user_id=user.id,
        role=owner_role,
    )
    db.add(membership)
    await db.flush()

    csrf = generate_csrf_token()
    _set_csrf_cookie(response, csrf)

    await log_audit(
        db,
        org.id,
        "user.signup",
        "user",
        user_id=user.id,
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
    )

    return AuthResponse(
        user=UserResponse.model_validate(user),
        tokens=TokenResponse(
            access_token=create_access_token(str(user.id), {"org_id": str(org.id)}),
            refresh_token=create_refresh_token(str(user.id)),
            csrf_token=csrf,
        ),
        organization_id=org.id,
        role=role_to_str(owner_role),
    )


@router.post("/login", response_model=AuthResponse)
async def login(data: LoginRequest, db: DbSession, response: Response):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    mem_result = await db.execute(
        select(OrganizationMember).where(OrganizationMember.user_id == user.id).limit(1)
    )
    membership = mem_result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No organization found")

    csrf = generate_csrf_token()
    _set_csrf_cookie(response, csrf)

    return AuthResponse(
        user=UserResponse.model_validate(user),
        tokens=TokenResponse(
            access_token=create_access_token(str(user.id), {"org_id": str(membership.organization_id)}),
            refresh_token=create_refresh_token(str(user.id)),
            csrf_token=csrf,
        ),
        organization_id=membership.organization_id,
        role=role_to_str(membership.role),
    )


@router.post("/forgot-password", response_model=MessageResponse, dependencies=[Depends(verify_csrf)])
async def forgot_password(data: ForgotPasswordRequest, db: DbSession):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if user:
        token = create_reset_token(user.email)
        token_hash = hash_password(token)
        reset = PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES),
        )
        db.add(reset)
        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        await send_password_reset_email(user.email, reset_url)
    return MessageResponse(message="If the email exists, a reset link has been sent")


@router.post("/reset-password", response_model=MessageResponse, dependencies=[Depends(verify_csrf)])
async def reset_password(data: ResetPasswordRequest, db: DbSession):
    payload = decode_token(data.token)
    if not payload or payload.get("type") != "reset":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")

    # Validate against the DB record — prevents token reuse
    token_hash_result = await db.execute(
        select(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == (
                select(User.id).where(User.email == email).scalar_subquery()
            ),
            PasswordResetToken.used == False,
            PasswordResetToken.expires_at > datetime.now(timezone.utc),
        )
        .order_by(PasswordResetToken.expires_at.desc())
        .limit(1)
    )
    reset_record = token_hash_result.scalar_one_or_none()

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not reset_record:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    # Mark token as used
    reset_record.used = True
    user.hashed_password = hash_password(data.password)
    await db.commit()
    return MessageResponse(message="Password reset successful")


@router.post("/welcome-register", response_model=AuthResponse)
async def welcome_register(request: Request, data: SignupRequest, db: DbSession, response: Response):
    """Public registration from the welcome/landing page.
    Creates platform credentials and sends notification emails."""
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        is_verified=True,
    )
    db.add(user)
    await db.flush()

    base_slug = _slugify(data.organization_name)
    slug = base_slug
    counter = 1
    while True:
        check = await db.execute(select(Organization).where(Organization.slug == slug))
        if not check.scalar_one_or_none():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1

    org = Organization(name=data.organization_name, slug=slug)
    db.add(org)
    await db.flush()

    owner_role = Role.OWNER
    membership = OrganizationMember(
        organization_id=org.id,
        user_id=user.id,
        role=owner_role,
    )
    db.add(membership)
    await db.flush()

    csrf = generate_csrf_token()
    _set_csrf_cookie(response, csrf)

    await log_audit(
        db,
        org.id,
        "user.welcome_register",
        "user",
        user_id=user.id,
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
    )

    # Fire-and-forget notification emails (don't block on email errors)
    try:
        await send_welcome_notification(
            admin_email="aloktrivedi.it@gmail.com",
            user_name=data.full_name,
            user_email=data.email,
            org_name=data.organization_name,
        )
    except Exception:
        pass  # email failure should not break registration

    return AuthResponse(
        user=UserResponse.model_validate(user),
        tokens=TokenResponse(
            access_token=create_access_token(str(user.id), {"org_id": str(org.id)}),
            refresh_token=create_refresh_token(str(user.id)),
            csrf_token=csrf,
        ),
        organization_id=org.id,
        role=role_to_str(owner_role),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(authorization: Annotated[str | None, Header(alias="Authorization")] = None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token required")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    csrf = generate_csrf_token()
    return TokenResponse(
        access_token=create_access_token(payload["sub"]),
        refresh_token=create_refresh_token(payload["sub"]),
        csrf_token=csrf,
    )
