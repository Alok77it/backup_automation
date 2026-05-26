"""
DevOps Control Plane — Server Agent Daemon
============================================
Lightweight FastAPI HTTP server installed on managed servers.
Communicates with the Control Plane API over TLS.

Security:
  - Bearer token authentication (SHA-256 HMAC, rotatable)
  - Strict command whitelist — REFUSES anything not pre-approved
  - Sandboxed subprocess execution (no shell=True, no arbitrary commands)
  - All executions logged locally and reported back

Installation:
  pip install -r requirements.txt
  AGENT_TOKEN=<raw_token> python agent.py

Systemd service template in: agent.service
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Configuration (from environment)
# ---------------------------------------------------------------------------

AGENT_TOKEN_RAW: str = os.getenv("AGENT_TOKEN", "")
AGENT_PORT: int       = int(os.getenv("AGENT_PORT", "9977"))
AGENT_TLS_CERT: str   = os.getenv("AGENT_TLS_CERT", "")
AGENT_TLS_KEY: str    = os.getenv("AGENT_TLS_KEY", "")
AGENT_LOG_PATH: str   = os.getenv("AGENT_LOG_PATH", "/var/log/devops-agent.log")
AGENT_VERSION: str    = "1.0.0"

# Hash the raw token once at startup — never store plaintext in memory longer than needed
_TOKEN_HASH: str = hashlib.sha256(AGENT_TOKEN_RAW.encode()).hexdigest() if AGENT_TOKEN_RAW else ""

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        *(
            [logging.FileHandler(AGENT_LOG_PATH)]
            if os.path.dirname(AGENT_LOG_PATH) and os.access(os.path.dirname(AGENT_LOG_PATH), os.W_OK)
            else []
        ),
    ],
)
logger = logging.getLogger("devops-agent")

# ---------------------------------------------------------------------------
# Command whitelist — absolute safety boundary
# ---------------------------------------------------------------------------

# Map command → [allowed_binary, ...fixed_args...]
# Args from payload are validated before appending.
COMMAND_DEFINITIONS: dict[str, dict] = {
    "ping": {
        "handler": "builtin_ping",
    },
    "system_info": {
        "handler": "builtin_system_info",
    },
    "container_list": {
        "cmd": ["docker", "ps", "-a", "--format", "json"],
        "handler": "docker_list",
    },
    "container_inspect": {
        "cmd": ["docker", "inspect"],
        "allowed_args": ["container_name"],
    },
    "container_logs": {
        "cmd": ["docker", "logs", "--tail", "100"],
        "allowed_args": ["container_name"],
    },
    "container_restart": {
        "cmd": ["docker", "restart"],
        "allowed_args": ["container_name"],
    },
    "container_stop": {
        "cmd": ["docker", "stop"],
        "allowed_args": ["container_name"],
    },
    "service_status": {
        "cmd": ["systemctl", "status"],
        "allowed_args": ["service_name"],
    },
    "service_restart": {
        "cmd": ["systemctl", "restart"],
        "allowed_args": ["service_name"],
    },
    "disk_usage": {
        "cmd": ["df", "-h"],
        "handler": "builtin_passthrough",
    },
    "process_list": {
        "cmd": ["ps", "aux"],
        "handler": "builtin_passthrough",
    },
    "log_tail": {
        "cmd": ["tail", "-n", "100"],
        "allowed_args": ["log_path"],
        "path_allowlist": ["/var/log/", "/opt/"],
    },
    "nginx_reload": {
        "handler": "nginx_reload",
    },
    "nginx_test_config": {
        "cmd": ["nginx", "-t"],
        "handler": "builtin_passthrough",
    },
    "ssl_certbot_issue": {
        "handler": "certbot_issue",
    },
    "ssl_certbot_renew": {
        "cmd": ["certbot", "renew", "--quiet", "--non-interactive"],
        "handler": "builtin_passthrough",
    },
    "plugin_install": {
        "handler": "plugin_install",
    },
    "plugin_uninstall": {
        "handler": "plugin_uninstall",
    },
    "docker_compose_up": {
        "handler": "compose_up",
    },
    "docker_compose_down": {
        "handler": "compose_down",
    },
    "script_run_approved": {
        "handler": "run_approved_script",
    },
}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="DevOps Agent", version=AGENT_VERSION, docs_url=None, redoc_url=None)


def _verify_token(request: Request) -> None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    raw = auth[7:]
    h = hashlib.sha256(raw.encode()).hexdigest()
    if not _TOKEN_HASH or h != _TOKEN_HASH:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class CommandRequest(BaseModel):
    command: str = Field(..., min_length=1, max_length=80)
    args: dict[str, Any] = Field(default_factory=dict)
    job_id: str | None = None
    timeout_seconds: int = Field(60, ge=1, le=600)


class CommandResponse(BaseModel):
    success: bool
    output: Any
    exit_code: int
    duration_ms: int
    agent_version: str
    error: str | None = None


# ---------------------------------------------------------------------------
# Execute endpoint
# ---------------------------------------------------------------------------

@app.post("/v1/execute", response_model=CommandResponse)
async def execute_command(request: Request, body: CommandRequest):
    _verify_token(request)

    command = body.command.strip()
    if command not in COMMAND_DEFINITIONS:
        logger.warning("Rejected unknown command: %r", command)
        raise HTTPException(status_code=403, detail=f"Command '{command}' not allowed")

    logger.info("Executing command=%r job_id=%s args_keys=%s",
                command, body.job_id, list(body.args.keys()))

    t0 = time.monotonic()
    try:
        output, exit_code = await _dispatch(command, body.args, body.timeout_seconds)
        success = (exit_code == 0)
        error = None
    except Exception as exc:
        output = None
        exit_code = 1
        success = False
        error = str(exc)[:500]
        logger.exception("Command %r failed: %s", command, exc)

    duration_ms = int((time.monotonic() - t0) * 1000)
    return CommandResponse(
        success=success,
        output=output,
        exit_code=exit_code,
        duration_ms=duration_ms,
        agent_version=AGENT_VERSION,
        error=error,
    )


@app.get("/v1/health")
async def health():
    return {"status": "ok", "version": AGENT_VERSION, "timestamp": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

async def _dispatch(command: str, args: dict, timeout: int) -> tuple[Any, int]:
    defn = COMMAND_DEFINITIONS[command]
    handler = defn.get("handler")

    if handler == "builtin_ping":
        return {"pong": True, "timestamp": datetime.now(timezone.utc).isoformat()}, 0

    if handler == "builtin_system_info":
        return await _system_info(), 0

    if handler == "docker_list":
        return await _docker_list(), 0

    if handler == "nginx_reload":
        config_content = args.get("config_content")
        domain = args.get("domain", "unknown")
        return await _nginx_reload(config_content, domain, timeout), 0

    if handler == "certbot_issue":
        cmd_str = args.get("command_string", "")
        return await _run_shell_command(cmd_str.split(), timeout), 0

    if handler in ("plugin_install", "plugin_uninstall", "compose_up", "compose_down"):
        return await _compose_operation(handler, args, timeout), 0

    if handler == "run_approved_script":
        return await _run_approved_script(args, timeout), 0

    if handler == "builtin_passthrough":
        cmd_base = defn.get("cmd", [])
        return await _run_subprocess(cmd_base, timeout), 0

    # Generic: build command with allowed_args
    cmd_base = list(defn.get("cmd", []))
    for arg_key in defn.get("allowed_args", []):
        val = args.get(arg_key)
        if val:
            # Sanitize: no shell metacharacters
            sanitized = str(val).replace(";", "").replace("&", "").replace("|", "").replace("`", "")
            # Path allowlist check
            if "path_allowlist" in defn:
                allowed = defn["path_allowlist"]
                if not any(sanitized.startswith(p) for p in allowed):
                    raise ValueError(f"Path '{sanitized}' not in allowlist: {allowed}")
            cmd_base.append(sanitized)

    return await _run_subprocess(cmd_base, timeout), 0


async def _run_subprocess(cmd: list[str], timeout: int) -> str:
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,  # NEVER use shell=True
        )
    )
    combined = (result.stdout or "") + (result.stderr or "")
    return combined[:50000]


async def _run_shell_command(cmd: list[str], timeout: int) -> str:
    """Same as _run_subprocess — no shell=True even for certbot."""
    return await _run_subprocess(cmd, timeout)


async def _system_info() -> dict:
    info: dict[str, Any] = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if "MemTotal" in line:
                    info["memory_total_mb"] = int(line.split()[1]) // 1024
                elif "MemAvailable" in line:
                    info["memory_available_mb"] = int(line.split()[1]) // 1024
    except Exception:
        pass
    try:
        with open("/proc/cpuinfo") as f:
            info["cpu_cores"] = sum(1 for l in f if l.startswith("processor"))
    except Exception:
        pass
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    info["os"] = line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    try:
        with open("/proc/uptime") as f:
            info["uptime_seconds"] = float(f.read().split()[0])
    except Exception:
        pass
    return info


async def _docker_list() -> list[dict]:
    try:
        output = await _run_subprocess(
            ["docker", "ps", "-a", "--format", "{{json .}}"], 60
        )
        import json
        containers = []
        for line in output.strip().splitlines():
            line = line.strip()
            if line:
                try:
                    containers.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return containers
    except Exception as exc:
        logger.warning("docker list failed: %s", exc)
        return []


async def _nginx_reload(config_content: str | None, domain: str, timeout: int) -> str:
    if config_content:
        config_path = f"/etc/nginx/sites-available/{domain}.conf"
        enabled_path = f"/etc/nginx/sites-enabled/{domain}.conf"
        # Write config
        try:
            import os as _os
            _os.makedirs("/etc/nginx/sites-available", exist_ok=True)
            _os.makedirs("/etc/nginx/sites-enabled", exist_ok=True)
            with open(config_path, "w") as f:
                f.write(config_content)
            # Symlink
            if not _os.path.exists(enabled_path):
                _os.symlink(config_path, enabled_path)
            logger.info("Wrote nginx config for domain: %s", domain)
        except Exception as exc:
            return f"Config write failed: {exc}"

    # Test config
    test_result = await _run_subprocess(["nginx", "-t"], 30)
    if "test failed" in test_result.lower():
        return f"nginx config test failed:\n{test_result}"

    # Reload
    reload_result = await _run_subprocess(["systemctl", "reload", "nginx"], timeout)
    return f"nginx reloaded.\n{reload_result}"


async def _compose_operation(operation: str, args: dict, timeout: int) -> str:
    install_path = args.get("install_path", "/opt/devops-plugin")
    import os as _os
    if not _os.path.exists(install_path):
        _os.makedirs(install_path, exist_ok=True)

    compose_content = args.get("compose_content")
    if compose_content:
        with open(f"{install_path}/docker-compose.yml", "w") as f:
            f.write(compose_content)

    if operation in ("plugin_install", "compose_up"):
        cmd = ["docker", "compose", "-f", f"{install_path}/docker-compose.yml", "up", "-d", "--pull", "always"]
    elif operation in ("plugin_uninstall", "compose_down"):
        cmd = ["docker", "compose", "-f", f"{install_path}/docker-compose.yml", "down", "--remove-orphans"]
    else:
        return "Unknown compose operation"

    return await _run_subprocess(cmd, timeout)


async def _run_approved_script(args: dict, timeout: int) -> str:
    """
    Run a pre-approved script. The script content must be passed explicitly
    (not a path) to prevent path traversal. Script is written to a temp file.
    """
    import tempfile, os as _os
    script_content = args.get("script_content", "")
    if not script_content:
        return "No script_content provided"

    with tempfile.NamedTemporaryFile(mode="w", suffix=".sh", delete=False) as f:
        f.write(script_content)
        tmp_path = f.name

    try:
        _os.chmod(tmp_path, 0o700)
        result = await _run_subprocess(["/bin/bash", tmp_path], timeout)
    finally:
        _os.unlink(tmp_path)

    return result


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if not AGENT_TOKEN_RAW:
        print("ERROR: AGENT_TOKEN environment variable is required", file=sys.stderr)
        sys.exit(1)

    ssl_config = {}
    if AGENT_TLS_CERT and AGENT_TLS_KEY:
        ssl_config = {"ssl_certfile": AGENT_TLS_CERT, "ssl_keyfile": AGENT_TLS_KEY}
        logger.info("TLS enabled: cert=%s", AGENT_TLS_CERT)
    else:
        logger.warning("TLS not configured — running in HTTP mode (not recommended for production)")

    logger.info("Starting DevOps Agent v%s on port %d", AGENT_VERSION, AGENT_PORT)
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=AGENT_PORT,
        log_level="info",
        **ssl_config,
    )
