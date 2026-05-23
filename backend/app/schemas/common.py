import uuid
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


class MessageResponse(BaseModel):
    message: str
    success: bool = True


class HealthScores(BaseModel):
    health_score: float
    restore_confidence: float
    risk_level: str
    corruption_probability: float


class DashboardStats(BaseModel):
    total_servers: int
    active_backups: int
    failed_jobs_24h: int
    storage_used_bytes: int
    storage_quota_bytes: int
    restore_readiness_avg: float
    ai_risk_alerts: int
    backup_health_avg: float


class TimeSeriesPoint(BaseModel):
    timestamp: datetime
    value: float
    label: str | None = None
