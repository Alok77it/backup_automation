"""
Execution Engine Service
========================
Central job dispatch layer for the DevOps Control Plane.
ADDITIVE — does NOT import or modify backup/monitoring services.

Architecture:
  API → ExecutionEngine.submit_job()
      → risk check + approval gate
      → Redis job queue
      → Celery worker → agent_comm → Server Agent
      → result written back to DevOpsJob
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.devops_entities import (
    ApprovalRequest,
    ApprovalStatus,
    DevOpsAuditLog,
    DevOpsJob,
    JobStatus,
    RiskLevel,
)

logger = logging.getLogger(__name__)
settings = get_settings()

# Redis stream name for the execution queue
EXECUTION_STREAM = "devops:exec:stream"
RESULT_STREAM    = "devops:exec:results"

# Risk → Celery queue mapping
QUEUE_MAP: dict[RiskLevel, str] = {
    RiskLevel.LOW:    "devops_low",
    RiskLevel.MEDIUM: "devops_medium",
    RiskLevel.HIGH:   "devops_high",
}


class ExecutionError(Exception):
    pass


class ApprovalRequiredError(ExecutionError):
    """Raised when a HIGH-risk job needs manual approval before execution."""
    def __init__(self, approval_id: uuid.UUID):
        self.approval_id = approval_id
        super().__init__(f"Approval required: {approval_id}")


class ExecutionEngine:
    """
    Stateless service — instantiate per-request or as a singleton.
    All heavy work is delegated to Celery workers.
    """

    def __init__(self) -> None:
        self._redis: aioredis.Redis | None = None

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        return self._redis

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def submit_job(
        self,
        db: AsyncSession,
        *,
        organization_id: uuid.UUID,
        server_id: uuid.UUID | None,
        created_by: uuid.UUID,
        job_type: str,
        command: str | None = None,
        payload: dict[str, Any] | None = None,
        plugin_id: str | None = None,
        risk_level: RiskLevel = RiskLevel.LOW,
        timeout_seconds: int = 300,
        ip_address: str | None = None,
    ) -> DevOpsJob:
        """
        Create and optionally enqueue a DevOpsJob.
        HIGH-risk jobs are parked as PENDING and an ApprovalRequest is created.
        MEDIUM/LOW jobs are immediately queued.
        """
        # --- scope validation ---
        if not organization_id or not created_by:
            raise ExecutionError("organization_id and created_by are required")

        requires_approval = risk_level == RiskLevel.HIGH
        approval_id: uuid.UUID | None = None

        if requires_approval:
            approval = ApprovalRequest(
                organization_id=organization_id,
                requested_by=created_by,
                title=f"{job_type} on server {server_id}",
                description=json.dumps(payload or {}),
                action_type=job_type,
                action_payload=payload,
                risk_level=risk_level,
                server_id=server_id,
            )
            db.add(approval)
            await db.flush()  # get approval.id
            approval_id = approval.id

        job = DevOpsJob(
            organization_id=organization_id,
            server_id=server_id,
            created_by=created_by,
            job_type=job_type,
            command=command,
            payload=payload,
            plugin_id=plugin_id,
            risk_level=risk_level,
            requires_approval=requires_approval,
            approval_id=approval_id,
            status=JobStatus.PENDING if requires_approval else JobStatus.QUEUED,
            timeout_seconds=timeout_seconds,
            queued_at=None if requires_approval else datetime.now(timezone.utc),
        )
        db.add(job)
        await db.flush()  # get job.id before writing audit log

        await self._write_audit(
            db,
            organization_id=organization_id,
            user_id=created_by,
            server_id=server_id,
            action="job.created",
            resource_type="job",
            resource_id=str(job.id),
            details={"job_type": job_type, "risk_level": risk_level.value},
            ip_address=ip_address,
        )

        await db.commit()
        await db.refresh(job)

        if not requires_approval:
            await self._enqueue_celery(db, job)

        return job

    async def approve_and_enqueue(
        self,
        db: AsyncSession,
        *,
        approval_id: uuid.UUID,
        reviewed_by: uuid.UUID,
        review_note: str | None = None,
        ip_address: str | None = None,
    ) -> DevOpsJob:
        """Admin approves a pending HIGH-risk job. Transitions it to QUEUED."""
        result = await db.execute(
            select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
        )
        approval = result.scalar_one_or_none()
        if not approval:
            raise ExecutionError("Approval request not found")
        if approval.status != ApprovalStatus.PENDING:
            raise ExecutionError(f"Approval is already {approval.status.value}")

        # Update approval
        approval.status = ApprovalStatus.APPROVED
        approval.reviewed_by = reviewed_by
        approval.review_note = review_note
        approval.reviewed_at = datetime.now(timezone.utc)

        # Find linked job
        job_result = await db.execute(
            select(DevOpsJob).where(DevOpsJob.approval_id == approval_id)
        )
        job = job_result.scalar_one_or_none()
        if not job:
            raise ExecutionError("Linked job not found for this approval")

        job.status = JobStatus.QUEUED
        job.queued_at = datetime.now(timezone.utc)

        await self._write_audit(
            db,
            organization_id=approval.organization_id,
            user_id=reviewed_by,
            server_id=approval.server_id,
            action="approval.granted",
            resource_type="approval",
            resource_id=str(approval_id),
            details={"job_id": str(job.id), "note": review_note},
            ip_address=ip_address,
        )

        await db.commit()
        await db.refresh(job)
        await self._enqueue_celery(db, job)
        return job

    async def reject_approval(
        self,
        db: AsyncSession,
        *,
        approval_id: uuid.UUID,
        reviewed_by: uuid.UUID,
        review_note: str | None = None,
        ip_address: str | None = None,
    ) -> ApprovalRequest:
        result = await db.execute(
            select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
        )
        approval = result.scalar_one_or_none()
        if not approval:
            raise ExecutionError("Approval request not found")
        if approval.status != ApprovalStatus.PENDING:
            raise ExecutionError(f"Approval is already {approval.status.value}")

        approval.status = ApprovalStatus.REJECTED
        approval.reviewed_by = reviewed_by
        approval.review_note = review_note
        approval.reviewed_at = datetime.now(timezone.utc)

        # Cancel the linked job
        job_result = await db.execute(
            select(DevOpsJob).where(DevOpsJob.approval_id == approval_id)
        )
        job = job_result.scalar_one_or_none()
        if job:
            job.status = JobStatus.CANCELLED
            job.error_message = f"Rejected by reviewer: {review_note or ''}"
            job.completed_at = datetime.now(timezone.utc)

        await self._write_audit(
            db,
            organization_id=approval.organization_id,
            user_id=reviewed_by,
            server_id=approval.server_id,
            action="approval.rejected",
            resource_type="approval",
            resource_id=str(approval_id),
            details={"note": review_note},
            ip_address=ip_address,
        )

        await db.commit()
        return approval

    async def cancel_job(
        self,
        db: AsyncSession,
        *,
        job_id: uuid.UUID,
        cancelled_by: uuid.UUID,
        organization_id: uuid.UUID,
    ) -> DevOpsJob:
        result = await db.execute(
            select(DevOpsJob).where(
                DevOpsJob.id == job_id,
                DevOpsJob.organization_id == organization_id,
            )
        )
        job = result.scalar_one_or_none()
        if not job:
            raise ExecutionError("Job not found")
        if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            raise ExecutionError(f"Job already in terminal state: {job.status.value}")

        job.status = JobStatus.CANCELLED
        job.completed_at = datetime.now(timezone.utc)
        job.error_message = f"Cancelled by user {cancelled_by}"

        # Best-effort Celery revoke
        if job.celery_task_id:
            try:
                from app.workers.celery_app import celery_app
                celery_app.control.revoke(job.celery_task_id, terminate=True)
            except Exception:
                pass

        await db.commit()
        await db.refresh(job)
        return job

    async def get_pending_approvals(
        self,
        db: AsyncSession,
        organization_id: uuid.UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ApprovalRequest]:
        result = await db.execute(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.organization_id == organization_id,
                ApprovalRequest.status == ApprovalStatus.PENDING,
            )
            .order_by(ApprovalRequest.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _enqueue_celery(self, db: AsyncSession, job: DevOpsJob) -> None:
        """Push job to the appropriate Celery queue and persist the Celery task ID."""
        try:
            from app.workers.execution_tasks import dispatch_devops_job
            queue = QUEUE_MAP.get(job.risk_level, "devops_low")
            result = dispatch_devops_job.apply_async(
                kwargs={"job_id": str(job.id)},
                queue=queue,
                countdown=0,
            )
            # Persist task ID so cancel_job can revoke it
            job.celery_task_id = result.id
            await db.commit()
            logger.info("Job %s enqueued on queue=%s task=%s", job.id, queue, result.id)
        except Exception as exc:
            logger.exception("Failed to enqueue job %s: %s", job.id, exc)

    @staticmethod
    async def _write_audit(
        db: AsyncSession,
        *,
        organization_id: uuid.UUID,
        user_id: uuid.UUID | None,
        server_id: uuid.UUID | None,
        action: str,
        resource_type: str | None,
        resource_id: str | None,
        details: dict | None,
        ip_address: str | None,
    ) -> None:
        audit = DevOpsAuditLog(
            organization_id=organization_id,
            user_id=user_id,
            server_id=server_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details,
            ip_address=ip_address,
        )
        db.add(audit)


# Module-level singleton — cheap to create per request, but usable as singleton
execution_engine = ExecutionEngine()
