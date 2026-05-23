import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.core.role_utils import normalize_role


class OrganizationResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    plan: str
    storage_quota_gb: float
    created_at: datetime

    model_config = {"from_attributes": True}


class MemberResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: str
    full_name: str
    role: str
    joined_at: datetime


class InvitationCreate(BaseModel):
    email: str
    role: str = "viewer"

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        return normalize_role(v).value


class InvitationResponse(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    accepted: bool
    expires_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class TeamCreate(BaseModel):
    name: str
    description: str | None = None


class TeamResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    member_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class ServerCreate(BaseModel):
    name: str
    hostname: str
    port: int = 22
    username: str
    password: str | None = None
    private_key: str | None = None
    auth_method: str = "password"


class ServerUpdate(BaseModel):
    name: str | None = None
    hostname: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None
    private_key: str | None = None


class ServerResponse(BaseModel):
    id: uuid.UUID
    name: str
    hostname: str
    port: int
    username: str
    auth_method: str
    status: str
    os_info: str | None
    last_seen_at: datetime | None
    created_at: datetime
    cpu_percent: float | None = None
    memory_percent: float | None = None
    disk_percent: float | None = None

    model_config = {"from_attributes": True}


class ServerConnectionTest(BaseModel):
    success: bool
    message: str
    os_info: str | None = None
    latency_ms: float | None = None


class BackupCreate(BaseModel):
    name: str
    server_id: uuid.UUID | None = None
    destination_server_id: uuid.UUID | None = None
    policy_id: uuid.UUID | None = None
    backup_type: str
    engine: str = "rsync"
    source_paths: list[str] = Field(default_factory=list)
    target_path: str | None = None
    schedule_cron: str | None = None
    compression: bool = True
    encryption: bool = True
    config_json: dict[str, Any] = Field(default_factory=dict)


class BackupResponse(BaseModel):
    id: uuid.UUID
    name: str
    backup_type: str
    engine: str
    source_paths: list[str] | None
    target_path: str
    schedule_cron: str | None
    is_active: bool
    health_score: float
    restore_confidence: float
    risk_level: str
    corruption_probability: float
    server_id: uuid.UUID | None
    server_name: str | None = None
    destination_server_id: uuid.UUID | None = None
    destination_server_name: str | None = None
    created_at: datetime
    last_run_status: str | None = None
    last_run_at: datetime | None = None

    model_config = {"from_attributes": True}


class BackupRunResponse(BaseModel):
    id: uuid.UUID
    backup_id: uuid.UUID
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    bytes_processed: int
    bytes_added: int
    duration_seconds: float | None
    checksum_valid: bool | None
    failed_chunks: int
    error_message: str | None
    snapshot_id: str | None

    model_config = {"from_attributes": True}


class PolicyCreate(BaseModel):
    name: str
    retention_days: int = 30
    retention_count: int = 10
    retry_count: int = 3
    retry_delay_seconds: int = 300
    compression_enabled: bool = True
    encryption_enabled: bool = True
    cleanup_enabled: bool = True
    cron_expression: str | None = None
    config_json: dict[str, Any] = Field(default_factory=dict)


class PolicyResponse(BaseModel):
    id: uuid.UUID
    name: str
    retention_days: int
    retention_count: int
    retry_count: int
    retry_delay_seconds: int
    compression_enabled: bool
    encryption_enabled: bool
    cleanup_enabled: bool
    cron_expression: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class RestoreCreate(BaseModel):
    backup_id: uuid.UUID
    backup_run_id: uuid.UUID | None = None
    target_path: str
    target_server_id: uuid.UUID | None = None
    overwrite_protection: bool = True


class RestoreAnalysis(BaseModel):
    restore_confidence: float
    estimated_duration_seconds: float
    dependency_warnings: list[str]
    corruption_risks: list[str]
    health_score: float
    risk_level: str
    ai_summary: str | None = None


class RestoreJobResponse(BaseModel):
    id: uuid.UUID
    backup_id: uuid.UUID
    status: str
    target_path: str
    overwrite_protection: bool
    restore_confidence: float
    estimated_duration_seconds: float | None
    dependency_warnings: list[str] | None
    corruption_risks: list[str] | None
    ai_analysis_json: dict | None
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertResponse(BaseModel):
    id: uuid.UUID
    title: str
    message: str
    alert_type: str
    severity: str
    is_read: bool
    is_resolved: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class LogEntryResponse(BaseModel):
    id: uuid.UUID
    source: str
    level: str
    message: str
    context_json: dict | None
    server_id: uuid.UUID | None
    backup_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class LogSearchParams(BaseModel):
    query: str | None = None
    source: str | None = None
    level: str | None = None
    page: int = 1
    page_size: int = 50


class MetricResponse(BaseModel):
    recorded_at: datetime
    cpu_percent: float | None
    memory_percent: float | None
    disk_percent: float | None
    disk_read_mb_s: float | None
    disk_write_mb_s: float | None
    network_in_mb_s: float | None
    network_out_mb_s: float | None
    backup_throughput_mb_s: float | None
    restore_throughput_mb_s: float | None

    model_config = {"from_attributes": True}


class StorageAnalytics(BaseModel):
    total_bytes: int
    used_bytes: int
    quota_bytes: int
    compression_ratio: float
    redundant_bytes: int
    backup_count: int
    growth_trend: list[dict[str, Any]]


class AIChatRequest(BaseModel):
    message: str
    conversation_id: uuid.UUID | None = None


class AIChatResponse(BaseModel):
    conversation_id: uuid.UUID
    message: str
    role: str = "assistant"


class AIConversationResponse(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class AuditLogResponse(BaseModel):
    id: uuid.UUID
    action: str
    resource_type: str
    resource_id: str | None
    user_email: str | None
    details_json: dict | None
    ip_address: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BillingInfo(BaseModel):
    plan: str
    storage_used_gb: float
    storage_quota_gb: float
    members_count: int
    servers_count: int
    backups_count: int
    billing_cycle: str = "monthly"
    next_invoice_date: datetime | None = None
