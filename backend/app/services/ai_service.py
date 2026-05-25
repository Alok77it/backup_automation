"""AI service — full context gathering, response generation, and action parsing.

The AI can propose SSH commands using <ACTION> blocks embedded in its response:

    <ACTION>
    title: Restart nginx
    description: nginx has crashed on web-01 per error logs
    server_id: <UUID>
    command: systemctl restart nginx && systemctl status nginx
    risk_level: low
    </ACTION>

These blocks are extracted, stored as AIAction records (status=pending_approval),
and replaced with a friendly inline placeholder in the text shown to users.
"""

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Backup Intelligence AI — an expert infrastructure, backup, and DevOps assistant.

## Your Capabilities
You have access to REAL-TIME platform data:
- All servers, their status, CPU/memory/disk metrics
- All backup jobs with health scores, recent run history, errors
- Recent error/warning log entries
- Unresolved alerts
- Storage usage and trends

## How to Propose Actions
When you identify something that should be fixed on a server, you can propose an SSH command.
Format it EXACTLY like this — one block per action:

<ACTION>
title: Short title (max 80 chars)
description: Why this action is needed (1-2 sentences)
server_id: <exact UUID from the context>
command: <shell command to run>
risk_level: low|medium|high
</ACTION>

Rules for actions:
- Only propose actions for servers listed in the context (use their exact UUIDs)
- Keep commands safe — avoid `rm -rf`, irreversible destructive operations
- Mark `risk_level: high` for anything that restarts critical services or modifies data
- You may propose multiple actions in one response
- The user will review and approve/reject each action before anything runs

## What to Analyze
Focus on: backup failures, performance degradation, server risks, storage pressure,
restore readiness, SSH/connectivity issues, service health on servers.

Be concise, technical, and specific. Reference actual data from context.
Use markdown formatting (headers, code blocks, bullet lists) for clarity."""


# ─── Action parsing ──────────────────────────────────────────────────────────

ACTION_BLOCK_RE = re.compile(
    r"<ACTION>(.*?)</ACTION>", re.DOTALL | re.IGNORECASE
)
ACTION_FIELD_RE = re.compile(r"^\s*(\w+)\s*:\s*(.+)$", re.MULTILINE)


@dataclass
class ProposedAction:
    title: str
    description: str
    server_id: str | None
    command: str
    risk_level: str


def parse_actions(text: str) -> tuple[str, list[ProposedAction]]:
    """Extract <ACTION> blocks from AI response text.

    Returns:
        (cleaned_text, list_of_ProposedAction)
    cleaned_text has ACTION blocks replaced with a user-friendly placeholder.
    """
    actions: list[ProposedAction] = []
    cleaned = text

    for match in ACTION_BLOCK_RE.finditer(text):
        block_text = match.group(1)
        fields: dict[str, str] = {}
        for field_match in ACTION_FIELD_RE.finditer(block_text):
            key = field_match.group(1).strip().lower()
            val = field_match.group(2).strip()
            fields[key] = val

        command = fields.get("command", "").strip()
        title = fields.get("title", "Proposed action")
        if not command:
            continue

        action = ProposedAction(
            title=title[:255],
            description=fields.get("description", ""),
            server_id=fields.get("server_id", "").strip() or None,
            command=command,
            risk_level=fields.get("risk_level", "low").lower(),
        )
        actions.append(action)

        risk_badge = {"low": "🟢", "medium": "🟡", "high": "🔴"}.get(action.risk_level, "🟡")
        placeholder = (
            f"\n\n---\n**{risk_badge} Proposed Action: {action.title}**\n"
            f"> {action.description}\n"
            f"```\n{action.command}\n```\n"
            f"*Risk: {action.risk_level.upper()} — see approval card below*\n---\n"
        )
        cleaned = cleaned.replace(match.group(0), placeholder)

    return cleaned, actions


# ─── Main response function ───────────────────────────────────────────────────

async def get_ai_response(
    user_message: str,
    context: dict[str, Any] | None = None,
    conversation_history: list[dict[str, str]] | None = None,
) -> str:
    """Call AI provider and return raw response text (may contain ACTION blocks)."""
    settings = get_settings()
    provider = settings.ai_provider
    if provider == "none":
        return _heuristic_response(user_message, context)

    context_block = ""
    if context:
        # Only include the most critical context to keep tokens manageable
        trimmed = {
            "servers": context.get("all_servers", [])[:10],
            "servers_at_risk": context.get("servers_at_risk", [])[:5],
            "backups_at_risk": context.get("backups_at_risk", [])[:5],
            "recent_failures": context.get("recent_failures", [])[:5],
            "recent_errors": context.get("recent_errors", [])[:10],
            "unresolved_alerts": context.get("unresolved_alerts", 0),
            "storage_used_gb": context.get("storage_used_gb", 0),
            "storage_quota_gb": context.get("storage_quota_gb", 100),
            "avg_restore_confidence": context.get("avg_restore_confidence", 0),
        }
        context_json = json.dumps(trimmed, indent=2, default=str)
        if len(context_json) > 8000:
            context_json = context_json[:8000] + "\n... (truncated for token limit)"
        context_block = (
            f"\n\n---\n## Live System Context (real-time data)\n```json\n{context_json}\n```\n---"
        )

    messages: list[dict[str, str]] = []
    if conversation_history:
        # Skip the very last message since it's the current user message we're about to add
        history = conversation_history[:-1] if conversation_history else []
        for msg in history[-18:]:
            if msg.get("role") in ("user", "assistant") and msg.get("content"):
                messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message + context_block})

    try:
        if provider == "anthropic":
            return await _anthropic_chat(messages)
        return await _openai_chat(messages)
    except Exception as e:
        logger.error("AI provider error: %s", e)
        return _heuristic_response(user_message, context)


async def _anthropic_chat(messages: list[dict[str, str]]) -> str:
    import anthropic

    settings = get_settings()
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    return response.content[0].text


async def _openai_chat(messages: list[dict[str, str]]) -> str:
    from openai import AsyncOpenAI

    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=full_messages,
        max_tokens=4096,
    )
    return response.choices[0].message.content or ""


def _heuristic_response(message: str, context: dict | None) -> str:
    msg_lower = message.lower()
    ctx = context or {}

    if "fail" in msg_lower and "backup" in msg_lower:
        failures = ctx.get("recent_failures", [])
        if failures:
            lines = "\n".join(
                f"- **{f.get('backup_name', 'Backup')}** on `{f.get('server', 'unknown')}`"
                f": {f.get('error', 'Unknown error')[:120]}"
                for f in failures[:5]
            )
            return (
                "## Recent Backup Failures\n\n"
                f"{lines}\n\n"
                "**Recommendations:**\n"
                "1. Check SSH connectivity and credentials on the affected server\n"
                "2. Verify source paths exist and are readable\n"
                "3. Confirm sufficient disk space on backup target\n"
                "4. Review log output for detailed error messages\n\n"
                "*(Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env for AI-powered root-cause analysis)*"
            )
        return "No recent backup failures found in context. All backups appear healthy."

    if "slow" in msg_lower or "performance" in msg_lower:
        avg_duration = ctx.get("avg_backup_duration_seconds", 0)
        return (
            f"## Backup Performance Analysis\n\n"
            f"Average backup duration: **{avg_duration:.1f}s**\n\n"
            "**Optimization steps:**\n"
            "1. Use incremental backups instead of full where possible\n"
            "2. Enable compression to reduce transfer size\n"
            "3. Exclude large, unimportant paths (logs, caches, temp files)\n"
            "4. Check network bandwidth to remote servers\n"
            "5. Schedule backups during off-peak hours"
        )

    if "risk" in msg_lower or "risky" in msg_lower or "health" in msg_lower:
        servers = ctx.get("servers_at_risk", [])
        backups_at_risk = ctx.get("backups_at_risk", [])
        result = "## Risk Assessment\n\n"
        if servers:
            result += f"**Servers needing attention ({len(servers)}):**\n"
            result += "\n".join(
                f"- **{s['name']}** (`{s.get('hostname', '')}`) — {s.get('status', 'unknown')}"
                for s in servers
            ) + "\n\n"
        if backups_at_risk:
            result += f"**Low-health backups ({len(backups_at_risk)}):**\n"
            result += "\n".join(
                f"- **{b['name']}** — health: {b.get('health_score', 0):.0f}%, risk: {b.get('risk_level', 'unknown')}"
                for b in backups_at_risk
            ) + "\n\n"
        if not servers and not backups_at_risk:
            result += "All servers and backups are within acceptable risk thresholds. ✅"
        return result

    if "restore" in msg_lower:
        confidence = ctx.get("avg_restore_confidence", 0)
        return (
            f"## Restore Readiness\n\n"
            f"Average restore confidence across all backups: **{confidence:.0f}%**\n\n"
            + (
                "✅ Restore confidence is high — proceed with standard precautions."
                if confidence >= 70
                else "⚠️ Restore confidence is low — run integrity checks before restoring."
            )
        )

    if "storage" in msg_lower or "optim" in msg_lower or "disk" in msg_lower:
        used = ctx.get("storage_used_gb", 0)
        quota = ctx.get("storage_quota_gb", 100)
        pct = (used / quota * 100) if quota else 0
        return (
            f"## Storage Status\n\n"
            f"Usage: **{used:.1f} GB / {quota:.1f} GB ({pct:.1f}%)**\n\n"
            "**Recommendations:**\n"
            "1. Review retention policies — delete runs older than policy limit\n"
            "2. Enable incremental backups to reduce storage growth\n"
            "3. Identify large backups with low restore confidence for review\n"
            "4. Consider archiving old full backups to cold storage"
        )

    if "alert" in msg_lower or "warn" in msg_lower:
        unresolved = ctx.get("unresolved_alerts", 0)
        return (
            f"## Alert Summary\n\n"
            f"You have **{unresolved}** unresolved alert(s).\n\n"
            "Go to the Alerts section to review and resolve them.\n"
            "Configure thresholds in Policies to reduce noise."
        )

    if "log" in msg_lower:
        logs = ctx.get("recent_errors", [])
        if logs:
            lines = "\n".join(f"- `{l.get('level', 'info').upper()}` — {l.get('message', '')[:120]}" for l in logs[:10])
            return f"## Recent Log Errors\n\n{lines}"
        return "No recent errors found in system logs."

    if "server" in msg_lower or "infrastructure" in msg_lower or "fleet" in msg_lower:
        all_servers = ctx.get("all_servers", [])
        result = f"## Infrastructure Overview\n\n**Total servers: {len(all_servers)}**\n\n"
        for s in all_servers[:10]:
            status_icon = "✅" if s.get("status") == "online" else "❌"
            result += (
                f"{status_icon} **{s['name']}** (`{s.get('hostname', '')}`) — "
                f"CPU: {s.get('cpu', 'N/A')}%, MEM: {s.get('mem', 'N/A')}%, "
                f"DISK: {s.get('disk', 'N/A')}%\n"
            )
        return result

    return (
        "## Backup Intelligence Assistant\n\n"
        "I analyze your live infrastructure data and can help with:\n"
        "- **Backup failures** — root causes and targeted fixes\n"
        "- **Server risks** — identify unhealthy or at-risk servers\n"
        "- **Performance** — why backups are slow and how to speed them up\n"
        "- **Restore safety** — confidence levels and risk assessment\n"
        "- **Storage optimization** — reduce usage and extend retention\n"
        "- **System logs** — recent errors and warning patterns\n"
        "- **Actions** — propose and execute SSH commands with your approval\n\n"
        "💡 Add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to your `.env` and restart the API for full AI analysis.\n\n"
        f"You asked: *{message}*"
    )


async def summarize_logs(logs: list[dict]) -> str:
    if not logs:
        return "No logs to summarize."
    prompt = (
        f"Summarize these {len(logs)} infrastructure/backup log entries. "
        "Highlight errors, patterns, and actionable items:\n"
    )
    prompt += json.dumps(logs[:50], default=str)
    return await get_ai_response(prompt, {"log_count": len(logs)})


async def analyze_backup_failure(error: str, logs: str, metadata: dict) -> str:
    prompt = (
        f"Analyze this backup failure and propose fixes:\n\n"
        f"Error: {error}\n\nLogs:\n{logs[-3000:]}\n\n"
        f"Metadata: {json.dumps(metadata, default=str)}"
    )
    return await get_ai_response(prompt, metadata)
