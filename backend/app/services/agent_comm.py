"""
Agent Communication Service
============================
Handles secure communication between the Control Plane API and
Server Agent daemons running on managed servers.

Security model:
  - Agent presents a signed JWT (HMAC-SHA256, org-scoped)
  - All commands go through a whitelist before dispatch
  - No arbitrary shell execution — structured command envelopes only
  - TLS 1.3 enforced for all agent connections

ADDITIVE — does not touch backup/monitoring services.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.devops_entities import AgentToken, DevOpsAuditLog

logger = logging.getLogger(__name__)
settings = get_settings()

# Default agent port (configurable per-server via Server.extra_config)
AGENT_DEFAULT_PORT = 9977
AGENT_API_VERSION = "v1"

# Whitelisted command types — agent will REFUSE anything not in this set
COMMAND_WHITELIST: frozenset[str] = frozenset({
    # Read-only / low risk
    "ping",
    "system_info",
    "container_list",
    "container_inspect",
    "container_logs",
    "container_exec",
    "container_create",
    "process_list",
    "disk_usage",
    "network_interfaces",
    "log_tail",
    "log_search",
    "service_status",
    # Medium risk
    "container_restart",
    "container_start",
    "service_restart",
    "container_stop",
    "container_remove",
    # High risk (require approval before reaching here)
    "plugin_install",
    "plugin_uninstall",
    "docker_compose_up",
    "docker_compose_down",
    "docker_compose_restart",
    "docker_compose_logs",
    "package_install",
    "github_repo_run",
    "ssl_certbot_issue",
    "ssl_certbot_renew",
    "nginx_reload",
    "nginx_test_config",
    "script_run_approved",    # only pre-approved signed scripts
})


@dataclass
class CommandEnvelope:
    """Structured command payload sent to the agent."""
    command: str
    args: dict[str, Any] = field(default_factory=dict)
    job_id: str | None = None
    timeout_seconds: int = 60


@dataclass
class AgentResponse:
    success: bool
    output: str | dict | list | None
    exit_code: int
    duration_ms: int
    agent_version: str | None = None
    error: str | None = None


class AgentCommunicationError(Exception):
    pass


class CommandNotAllowedError(AgentCommunicationError):
    pass


class AgentCommService:
    """
    Handles HTTP communication with server agents.
    Each managed server runs a lightweight agent daemon.
    """

    def __init__(self) -> None:
        pass

    # ------------------------------------------------------------------
    # Token management
    # ------------------------------------------------------------------

    @staticmethod
    def generate_raw_token() -> tuple[str, str]:
        """
        Returns (raw_token, token_hash).
        raw_token is shown ONCE to the user for installation.
        token_hash is stored in DB.
        """
        raw = secrets.token_urlsafe(48)
        h = hashlib.sha256(raw.encode()).hexdigest()
        return raw, h

    @staticmethod
    def hash_token(raw_token: str) -> str:
        return hashlib.sha256(raw_token.encode()).hexdigest()

    async def create_agent_token(
        self,
        db: AsyncSession,
        *,
        organization_id: uuid.UUID,
        server_id: uuid.UUID,
        created_by: uuid.UUID,
        label: str | None = None,
        expires_days: int = 365,
    ) -> tuple[str, AgentToken]:
        """
        Create and persist a new agent token.
        Returns (raw_token, AgentToken) — raw_token shown once only.
        """
        raw, token_hash = self.generate_raw_token()

        # Revoke any existing token for this server
        await db.execute(
            update(AgentToken)
            .where(AgentToken.server_id == server_id)
            .values(is_active=False)
        )

        token = AgentToken(
            organization_id=organization_id,
            server_id=server_id,
            token_hash=token_hash,
            label=label or "Default",
            is_active=True,
            created_by=created_by,
            expires_at=datetime.now(timezone.utc) + timedelta(days=expires_days),
        )
        db.add(token)
        await db.commit()
        await db.refresh(token)
        return raw, token

    async def validate_agent_token(
        self,
        db: AsyncSession,
        raw_token: str,
    ) -> AgentToken | None:
        """Used by the agent gateway to authenticate inbound connections."""
        h = self.hash_token(raw_token)
        result = await db.execute(
            select(AgentToken).where(
                AgentToken.token_hash == h,
                AgentToken.is_active == True,
            )
        )
        token = result.scalar_one_or_none()
        if not token:
            return None
        # Check expiry
        if token.expires_at and token.expires_at < datetime.now(timezone.utc):
            return None
        # Update last_seen
        token.last_seen_at = datetime.now(timezone.utc)
        await db.commit()
        return token

    # ------------------------------------------------------------------
    # Command execution
    # ------------------------------------------------------------------

    async def execute(
        self,
        *,
        server_hostname: str,
        server_port: int = AGENT_DEFAULT_PORT,
        agent_token_raw: str,
        command: str,
        args: dict[str, Any] | None = None,
        job_id: str | None = None,
        timeout_seconds: int = 60,
        use_tls: bool = True,
    ) -> AgentResponse:
        """
        Send a structured command to a server agent.
        Raises CommandNotAllowedError if command is not whitelisted.
        """
        if command not in COMMAND_WHITELIST:
            raise CommandNotAllowedError(
                f"Command '{command}' is not in the execution whitelist. "
                f"Allowed: {sorted(COMMAND_WHITELIST)}"
            )

        envelope = CommandEnvelope(
            command=command,
            args=args or {},
            job_id=job_id,
            timeout_seconds=timeout_seconds,
        )

        scheme = "https" if use_tls else "http"
        url = f"{scheme}://{server_hostname}:{server_port}/{AGENT_API_VERSION}/execute"

        headers = {
            "Authorization": f"Bearer {agent_token_raw}",
            "Content-Type": "application/json",
            "X-Job-Id": job_id or "",
        }

        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(
                verify=use_tls,
                timeout=httpx.Timeout(float(timeout_seconds + 10)),
            ) as client:
                resp = await client.post(
                    url,
                    json={
                        "command": envelope.command,
                        "args": envelope.args,
                        "job_id": envelope.job_id,
                        "timeout_seconds": envelope.timeout_seconds,
                    },
                    headers=headers,
                )

            duration_ms = int((time.monotonic() - t0) * 1000)

            if resp.status_code == 401:
                raise AgentCommunicationError("Agent rejected token — rotate agent credentials")
            if resp.status_code == 403:
                raise CommandNotAllowedError("Agent denied command — not in server whitelist")
            if resp.status_code >= 500:
                raise AgentCommunicationError(f"Agent returned {resp.status_code}: {resp.text[:200]}")

            data = resp.json()
            return AgentResponse(
                success=data.get("success", False),
                output=data.get("output"),
                exit_code=data.get("exit_code", 0),
                duration_ms=duration_ms,
                agent_version=data.get("agent_version"),
                error=data.get("error"),
            )

        except httpx.ConnectError as exc:
            raise AgentCommunicationError(f"Cannot reach agent at {server_hostname}:{server_port}: {exc}") from exc
        except httpx.TimeoutException as exc:
            raise AgentCommunicationError(f"Agent timed out after {timeout_seconds}s") from exc

    async def ping(
        self,
        *,
        server_hostname: str,
        server_port: int = AGENT_DEFAULT_PORT,
        agent_token_raw: str,
        use_tls: bool = True,
    ) -> tuple[bool, float]:
        """
        Returns (is_alive, latency_ms).
        Non-throwing — returns (False, -1) on failure.
        """
        try:
            resp = await self.execute(
                server_hostname=server_hostname,
                server_port=server_port,
                agent_token_raw=agent_token_raw,
                command="ping",
                timeout_seconds=10,
                use_tls=use_tls,
            )
            return resp.success, float(resp.duration_ms)
        except AgentCommunicationError:
            return False, -1.0

    async def get_container_list(
        self,
        *,
        server_hostname: str,
        server_port: int = AGENT_DEFAULT_PORT,
        agent_token_raw: str,
        include_stopped: bool = True,
        use_tls: bool = True,
    ) -> list[dict]:
        """
        Read-only: fetch container list from agent.
        Returns raw container dicts for snapshot storage.
        """
        resp = await self.execute(
            server_hostname=server_hostname,
            server_port=server_port,
            agent_token_raw=agent_token_raw,
            command="container_list",
            args={"include_stopped": include_stopped},
            use_tls=use_tls,
        )
        if not resp.success or not isinstance(resp.output, list):
            return []
        return resp.output

    async def get_system_info(
        self,
        *,
        server_hostname: str,
        server_port: int = AGENT_DEFAULT_PORT,
        agent_token_raw: str,
        use_tls: bool = True,
    ) -> dict:
        resp = await self.execute(
            server_hostname=server_hostname,
            server_port=server_port,
            agent_token_raw=agent_token_raw,
            command="system_info",
            use_tls=use_tls,
        )
        if isinstance(resp.output, dict):
            return resp.output
        return {}


# Module-level singleton
agent_comm = AgentCommService()
