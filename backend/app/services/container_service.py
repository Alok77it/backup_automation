"""
Container Management Service — READ-ONLY
==========================================
Fetches Docker container state from server agents and persists
ContainerSnapshot records. Never modifies Docker runtime directly.

ADDITIVE — no changes to backup/monitoring modules.
"""

from __future__ import annotations

import logging
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.devops_entities import ContainerSnapshot

logger = logging.getLogger(__name__)

# Container states of interest
CONTAINER_STATES = frozenset({"running", "stopped", "exited", "dead", "paused", "restarting"})


class ContainerService:
    """
    Read-only container visibility layer.
    All writes are snapshots — runtime is never touched.
    """

    async def refresh_snapshots(
        self,
        db: AsyncSession,
        *,
        organization_id: uuid.UUID,
        server_id: uuid.UUID,
        raw_containers: list[dict],
    ) -> list[ContainerSnapshot]:
        """
        Replace all ContainerSnapshot records for a server with fresh data.
        Called by the Celery container_poll task (via agent_comm.get_container_list).
        """
        # Delete stale snapshots for this server
        await db.execute(
            delete(ContainerSnapshot).where(ContainerSnapshot.server_id == server_id)
        )

        snapshots: list[ContainerSnapshot] = []
        for c in raw_containers:
            snap = self._parse_container(c, organization_id=organization_id, server_id=server_id)
            db.add(snap)
            snapshots.append(snap)

        await db.commit()
        logger.info(
            "Refreshed %d container snapshots for server=%s",
            len(snapshots), server_id,
        )
        return snapshots

    async def get_snapshots(
        self,
        db: AsyncSession,
        *,
        organization_id: uuid.UUID,
        server_id: uuid.UUID | None = None,
        state_filter: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[ContainerSnapshot]:
        stmt = select(ContainerSnapshot).where(
            ContainerSnapshot.organization_id == organization_id
        )
        if server_id:
            stmt = stmt.where(ContainerSnapshot.server_id == server_id)
        if state_filter:
            stmt = stmt.where(ContainerSnapshot.state == state_filter)
        stmt = stmt.order_by(ContainerSnapshot.captured_at.desc()).offset(offset).limit(limit)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def get_summary(
        self,
        db: AsyncSession,
        *,
        organization_id: uuid.UUID,
        server_id: uuid.UUID | None = None,
    ) -> dict:
        """Returns counts by state for dashboard widgets."""
        snapshots = await self.get_snapshots(
            db, organization_id=organization_id, server_id=server_id, limit=5000
        )
        summary: dict[str, int] = {s: 0 for s in CONTAINER_STATES}
        summary["total"] = len(snapshots)
        for snap in snapshots:
            state = snap.state or "unknown"
            summary[state] = summary.get(state, 0) + 1
        return summary

    # ------------------------------------------------------------------
    # Parsing helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_container(
        raw: dict,
        organization_id: uuid.UUID,
        server_id: uuid.UUID,
    ) -> ContainerSnapshot:
        """
        Parse Docker SDK / agent JSON into a ContainerSnapshot.
        Tolerant of missing fields — never raises.
        """
        state = (raw.get("State") or raw.get("state") or "unknown").lower()
        name = raw.get("Names") or raw.get("name") or raw.get("Name") or ""
        if isinstance(name, list):
            name = name[0] if name else ""
        name = name.lstrip("/")

        # Stats may come from a separate /stats call
        stats = raw.get("stats") or {}
        cpu = stats.get("cpu_percent") or raw.get("cpu_percent")
        mem = stats.get("memory_mb") or raw.get("memory_mb")
        mem_limit = stats.get("memory_limit_mb") or raw.get("memory_limit_mb")
        state_details = raw.get("State") if isinstance(raw.get("State"), dict) else {}

        return ContainerSnapshot(
            organization_id=organization_id,
            server_id=server_id,
            container_id=raw.get("Id") or raw.get("ID") or raw.get("id") or "",
            name=name,
            image=raw.get("Image") or raw.get("image") or "",
            image_tag=raw.get("ImageTag") or raw.get("image_tag"),
            state=state,
            status=raw.get("Status") or raw.get("status"),
            exit_code=_int_or_none(raw.get("ExitCode") or raw.get("exit_code")),
            ports=_json_object(raw.get("Ports") or raw.get("ports")),
            labels=_json_object(raw.get("Labels") or raw.get("labels")),
            networks=_json_list(raw.get("Networks") or raw.get("networks")),
            mounts=_json_list(raw.get("Mounts") or raw.get("mounts")),
            cpu_percent=float(cpu) if cpu is not None else None,
            memory_mb=float(mem) if mem is not None else None,
            memory_limit_mb=float(mem_limit) if mem_limit is not None else None,
            created_in_docker=_parse_dt(raw.get("CreatedAt") or raw.get("Created") or raw.get("created")),
            started_at=_parse_dt(state_details.get("StartedAt")),
            finished_at=_parse_dt(state_details.get("FinishedAt")),
            captured_at=datetime.now(timezone.utc),
        )


def _json_object(value: object) -> dict | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        return {"items": value}
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except Exception:
        return {"raw": text}
    if isinstance(parsed, dict):
        return parsed
    return {"raw": parsed}


def _json_list(value: object) -> list | None:
    if value is None:
        return None
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except Exception:
        return [{"raw": text}]
    if isinstance(parsed, list):
        return parsed
    return [parsed]


def _int_or_none(value: object) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_dt(value: str | int | None) -> datetime | None:
    if not value:
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc)
        from dateutil import parser as dtp
        parsed = dtp.parse(str(value))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return None


container_service = ContainerService()
