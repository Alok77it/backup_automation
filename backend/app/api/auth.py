import re
<<<<<<< HEAD
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
=======
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
>>>>>>> 4fc4a62 (initial commit)

from app.core.config import get_settings
from app.core.dependencies import DbSession, verify_csrf
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
from app.services.email_service import send_password_reset_email

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:50] or "org"


<<<<<<< HEAD
@router.post("/signup", response_model=AuthResponse)
async def signup(request: Request, data: SignupRequest, db: DbSession, response: Response):
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
=======
# =========================
# SIGNUP (FIXED)
# =========================
@router.post("/signup", response_model=AuthResponse)
async def signup(request: Request, data: SignupRequest, db: DbSession, response: Response):

    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    # ❌ REMOVED: async with db.begin()
>>>>>>> 4fc4a62 (initial commit)

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        is_verified=True,
    )
    db.add(user)
    await db.flush()

<<<<<<< HEAD
    base_slug = _slugify(data.organization_name)
    slug = base_slug
    counter = 1
    while True:
        check = await db.execute(select(Organization).where(Organization.slug == slug))
=======
    user_id = user.id

    base_slug = _slugify(data.organization_name)
    slug = base_slug
    counter = 1

    while True:
        check = await db.execute(
            select(Organization).where(Organization.slug == slug)
        )
>>>>>>> 4fc4a62 (initial commit)
        if not check.scalar_one_or_none():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1

    org = Organization(name=data.organization_name, slug=slug)
    db.add(org)
    await db.flush()

<<<<<<< HEAD
    membership = OrganizationMember(organization_id=org.id, user_id=user.id, role=Role.OWNER)
    db.add(membership)
    await db.flush()

    csrf = generate_csrf_token()
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=csrf,
        httponly=False,
=======
    org_id = org.id

    membership = OrganizationMember(
        organization_id=org_id,
        user_id=user_id,
        role=normalize_role("owner")
    )
    db.add(membership)

    # ❌ REMOVED transaction block — commit handled by session lifecycle


    csrf = generate_csrf_token()

    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=csrf,
        httponly=True,
>>>>>>> 4fc4a62 (initial commit)
        samesite="lax",
        secure=settings.SESSION_COOKIE_SECURE,
    )

<<<<<<< HEAD
    tokens = TokenResponse(
        access_token=create_access_token(str(user.id), {"org_id": str(org.id)}),
        refresh_token=create_refresh_token(str(user.id)),
        csrf_token=csrf,
    )

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
        tokens=tokens,
        organization_id=org.id,
        role=Role.OWNER.value,
    )


@router.post("/login", response_model=AuthResponse)
async def login(data: LoginRequest, db: DbSession, response: Response):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
=======
    return AuthResponse(
        user=UserResponse.model_validate(user),
        tokens=TokenResponse(
            access_token=create_access_token(str(user.id), {"org_id": str(org_id)}),
            refresh_token=create_refresh_token(str(user.id)),
            csrf_token=csrf,
        ),
        organization_id=org_id,
        role=normalize_role("owner"),
    )


# =========================
# LOGIN (FIXED)
# =========================
@router.post("/login", response_model=AuthResponse)
async def login(data: LoginRequest, db: DbSession, response: Response):

    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

>>>>>>> 4fc4a62 (initial commit)
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    mem_result = await db.execute(
<<<<<<< HEAD
        select(OrganizationMember).where(OrganizationMember.user_id == user.id).limit(1)
    )
    membership = mem_result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No organization found")

    csrf = generate_csrf_token()
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=csrf,
        httponly=False,
=======
        select(OrganizationMember)
        .where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.is_default == True
        )
        .order_by(OrganizationMember.created_at.desc())
    )

    membership = mem_result.scalar_one_or_none()

    if not membership:
        raise HTTPException(status_code=400, detail="No organization found")

    csrf = generate_csrf_token()

    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=csrf,
        httponly=True,
>>>>>>> 4fc4a62 (initial commit)
        samesite="lax",
        secure=settings.SESSION_COOKIE_SECURE,
    )

    return AuthResponse(
        user=UserResponse.model_validate(user),
        tokens=TokenResponse(
            access_token=create_access_token(str(user.id), {"org_id": str(membership.organization_id)}),
            refresh_token=create_refresh_token(str(user.id)),
            csrf_token=csrf,
        ),
        organization_id=membership.organization_id,
<<<<<<< HEAD
        role=membership.role.value,
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

    result = await db.execute(select(User).where(User.email == payload["sub"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")

    user.hashed_password = hash_password(data.password)
    return MessageResponse(message="Password reset successful")


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(authorization: str | None = None, response: Response = None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token required")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    csrf = generate_csrf_token()
=======
        role=membership.role,
    )


# =========================
# FORGOT PASSWORD (OK but transactional safe)
# =========================
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
            expires_at=datetime.now(timezone.utc) + timedelta(
                minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES
            ),
        )
        db.add(reset)

        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        await send_password_reset_email(user.email, reset_url)

    return MessageResponse(message="If the email exists, a reset link has been sent")


# =========================
# RESET PASSWORD (FIXED - missing commit)
# =========================
@router.post("/reset-password", response_model=MessageResponse, dependencies=[Depends(verify_csrf)])
async def reset_password(data: ResetPasswordRequest, db: DbSession):

    payload = decode_token(data.token)
    if not payload or payload.get("type") != "reset":
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    async with db.begin():   # FIX
        result = await db.execute(
            select(User).where(User.email == payload["sub"])
        )
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=400, detail="Invalid token")

        user.hashed_password = hash_password(data.password)

    return MessageResponse(message="Password reset successful")


# =========================
# REFRESH TOKEN (OK but improve later with DB rotation)
# =========================
@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(authorization: str | None = None):

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Refresh token required")

    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)

    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    csrf = generate_csrf_token()

>>>>>>> 4fc4a62 (initial commit)
    return TokenResponse(
        access_token=create_access_token(payload["sub"]),
        refresh_token=create_refresh_token(payload["sub"]),
        csrf_token=csrf,
    )
