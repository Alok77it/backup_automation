import json
import logging
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Backup Intelligence AI, an expert infrastructure and backup recovery assistant.
You analyze backup logs, metrics, restore history, and infrastructure events.
Provide actionable, precise technical guidance. Reference specific data when available.
Focus on: backup failures, performance, corruption risks, restore safety, storage optimization, retention policies.
Be concise but thorough. Use markdown formatting when helpful."""


async def get_ai_response(
    user_message: str,
    context: dict[str, Any] | None = None,
    conversation_history: list[dict[str, str]] | None = None,
) -> str:
    settings = get_settings()
    provider = settings.ai_provider
    if provider == "none":
        return _heuristic_response(user_message, context)

    context_block = ""
    if context:
        context_block = f"\n\n## Platform Context\n```json\n{json.dumps(context, indent=2, default=str)[:8000]}\n```"

    messages = []
    if conversation_history:
        for msg in conversation_history[-20:]:
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
        model="claude-sonnet-4-20250514",
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
            return (
                "## Backup Failure Analysis\n\n"
                f"Detected {len(failures)} recent failure(s). "
                f"Latest error: {failures[0].get('error', 'Unknown')}\n\n"
                "**Recommendations:**\n"
                "1. Check SSH connectivity and credentials\n"
                "2. Verify source paths exist and are readable\n"
                "3. Confirm sufficient disk space on backup target\n"
                "4. Review backup engine logs for checksum errors"
            )
        return "No recent backup failures found in context. Check server connectivity and backup job configuration."

    if "slow" in msg_lower:
        avg_duration = ctx.get("avg_backup_duration_seconds", 0)
        return (
            f"## Backup Performance Analysis\n\n"
            f"Average backup duration: {avg_duration:.1f}s\n\n"
            "**Optimization steps:**\n"
            "1. Enable compression if not active\n"
            "2. Use incremental backups instead of full\n"
            "3. Exclude unnecessary paths\n"
            "4. Check network bandwidth to remote servers"
        )

    if "risky" in msg_lower or "risk" in msg_lower:
        servers = ctx.get("servers_at_risk", [])
        if servers:
            lines = "\n".join(f"- **{s['name']}**: health {s.get('health', 'N/A')}" for s in servers)
            return f"## Server Risk Assessment\n\n{lines}"
        return "All monitored servers are within acceptable risk thresholds."

    if "restore" in msg_lower and "safe" in msg_lower:
        confidence = ctx.get("restore_confidence", 0)
        return (
            f"## Restore Safety Analysis\n\n"
            f"Restore confidence: **{confidence}%**\n\n"
            f"{'Restore appears safe to proceed with standard precautions.' if confidence >= 70 else 'Exercise caution - run integrity check before restore.'}"
        )

    if "storage" in msg_lower or "optim" in msg_lower:
        used = ctx.get("storage_used_gb", 0)
        quota = ctx.get("storage_quota_gb", 100)
        pct = (used / quota * 100) if quota else 0
        return (
            f"## Storage Optimization\n\n"
            f"Current usage: {used:.1f} GB / {quota:.1f} GB ({pct:.1f}%)\n\n"
            "**Recommendations:**\n"
            "1. Review retention policies for old snapshots\n"
            "2. Enable deduplication (Restic/Borg)\n"
            "3. Identify redundant full backups\n"
            "4. Consider compression tuning"
        )

    return (
        "## Backup Intelligence Assistant\n\n"
        "I can help analyze backup failures, performance issues, server risks, restore safety, and storage optimization. "
        "Configure ANTHROPIC_API_KEY or OPENAI_API_KEY for enhanced AI analysis.\n\n"
        f"Your question: {message}"
    )


async def summarize_logs(logs: list[dict]) -> str:
    if not logs:
        return "No logs to summarize."
    prompt = f"Summarize these {len(logs)} infrastructure/backup log entries. Highlight errors, patterns, and actionable items:\n"
    prompt += json.dumps(logs[:50], default=str)
    return await get_ai_response(prompt, {"log_count": len(logs)})


async def analyze_backup_failure(error: str, logs: str, metadata: dict) -> str:
    prompt = (
        f"Analyze this backup failure:\n\nError: {error}\n\nLogs:\n{logs[-3000:]}\n\n"
        f"Metadata: {json.dumps(metadata, default=str)}"
    )
    return await get_ai_response(prompt, metadata)
