from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.dependencies import DbSession, require_permission
from app.models.entities import OrganizationMember
from app.schemas.resources import ReliabilitySummaryResponse
from app.services.ops_intelligence import reliability_summary

router = APIRouter(prefix="/reliability", tags=["reliability"])


@router.get("/summary", response_model=ReliabilitySummaryResponse)
async def get_reliability_summary(
    db: DbSession,
    membership: Annotated[OrganizationMember, Depends(require_permission("reliability:read"))],
):
    return await reliability_summary(db, membership.organization_id)
