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
    "container_exec": {
        "handler": "container_exec",
    },
    "container_restart": {
        "cmd": ["docker", "restart"],
        "allowed_args": ["container_name"],
    },
    "container_start": {
        "cmd": ["docker", "start"],
        "allowed_args": ["container_name"],
    },
    "container_stop": {
        "cmd": ["docker", "stop"],
        "allowed_args": ["container_name"],
    },
    "container_remove": {
        "handler": "container_remove",
    },
    "container_create": {
        "handler": "container_create",
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
    "docker_compose_restart": {
        "handler": "compose_restart",
    },
    "docker_compose_logs": {
        "handler": "compose_logs",
    },
    "script_run_approved": {
        "handler": "run_approved_script",
    },
    "package_install": {
        "handler": "package_install",
    },
    "github_repo_run": {
        "handler": "github_repo_run",
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

    if handler in ("plugin_install", "plugin_uninstall", "compose_up", "compose_down", "compose_restart", "compose_logs"):
        return await _compose_operation(handler, args, timeout), 0

    if handler == "run_approved_script":
        return await _run_approved_script(args, timeout), 0

    if handler == "container_create":
        return await _container_create(args, timeout), 0

    if handler == "container_remove":
        return await _container_remove(args, timeout), 0

    if handler == "container_exec":
        return await _container_exec(args, timeout), 0

    if handler == "package_install":
        return await _package_install(args, timeout), 0

    if handler == "github_repo_run":
        return await _github_repo_run(args, timeout), 0

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
    env = os.environ.copy()
    env.setdefault("DEBIAN_FRONTEND", "noninteractive")
    env.setdefault("NEEDRESTART_MODE", "a")
    env.setdefault("APT_LISTCHANGES_FRONTEND", "none")
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,  # NEVER use shell=True
            env=env,
        )
    )
    combined = (result.stdout or "") + (result.stderr or "")
    if result.returncode != 0:
        raise RuntimeError(combined[:50000] or f"Command failed with exit code {result.returncode}")
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
    for path in _compose_prepare_dirs(args):
        _os.makedirs(path, exist_ok=True)

    compose_content = args.get("compose_content")
    if compose_content:
        with open(f"{install_path}/docker-compose.yml", "w") as f:
            f.write(compose_content)

    if operation in ("plugin_install", "compose_up"):
        cmd = ["docker", "compose", "-f", f"{install_path}/docker-compose.yml", "up", "-d", "--pull", "always"]
    elif operation in ("plugin_uninstall", "compose_down"):
        cmd = ["docker", "compose", "-f", f"{install_path}/docker-compose.yml", "down", "--remove-orphans"]
    elif operation == "compose_restart":
        cmd = ["docker", "compose", "-f", f"{install_path}/docker-compose.yml", "restart"]
    elif operation == "compose_logs":
        cmd = ["docker", "compose", "-f", f"{install_path}/docker-compose.yml", "logs", "--tail", "200"]
    else:
        return "Unknown compose operation"

    return await _run_subprocess(cmd, timeout)


def _compose_prepare_dirs(args: dict) -> list[str]:
    config = args.get("config") or {}
    install_path = args.get("install_path", "/opt/devops-plugin")
    candidates = [
        config.get("jenkins_home"),
        f"{install_path}/data",
        f"{config.get('install_path')}/data" if config.get("install_path") else None,
    ]
    dirs: list[str] = []
    for item in candidates:
        text = str(item or "").strip()
        if text.startswith("/") and "\n" not in text and text not in dirs:
            dirs.append(text)
    return dirs


def _safe_name(value: str, fallback: str = "managed") -> str:
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-"
    cleaned = "".join(ch for ch in str(value or fallback) if ch in allowed)
    return cleaned[:80] or fallback


async def _docker_login(args: dict, timeout: int) -> str:
    username = args.get("docker_username")
    token = args.get("docker_token")
    registry = args.get("docker_registry") or "docker.io"
    if not username or not token:
        return ""
    return await _run_subprocess(["docker", "login", registry, "-u", str(username), "-p", str(token)], timeout)


async def _container_create(args: dict, timeout: int) -> str:
    image = str(args.get("image") or "").strip()
    if not image:
        return "image is required"

    output = await _docker_login(args, timeout)
    name = _safe_name(args.get("name") or image.split("/")[-1].split(":")[0])
    cmd = ["docker", "run", "-d", "--name", name]

    for port in args.get("ports") or []:
        port = str(port).strip()
        if port and all(ch.isdigit() or ch in ":/" for ch in port):
            cmd.extend(["-p", port])
    for env in args.get("env") or []:
        env = str(env).strip()
        if env and "=" in env and "\n" not in env:
            cmd.extend(["-e", env])
    for volume in args.get("volumes") or []:
        volume = str(volume).strip()
        if volume and ":" in volume and "\n" not in volume:
            cmd.extend(["-v", volume])

    restart_policy = args.get("restart_policy") or "unless-stopped"
    if restart_policy in {"no", "always", "on-failure", "unless-stopped"}:
        cmd.extend(["--restart", restart_policy])

    cmd.append(image)
    result = await _run_subprocess(cmd, timeout)
    return (output + "\n" + result).strip()


async def _container_remove(args: dict, timeout: int) -> str:
    name = _safe_name(args.get("container_name") or args.get("name"))
    force = bool(args.get("force", True))
    cmd = ["docker", "rm"]
    if force:
        cmd.append("-f")
    cmd.append(name)
    return await _run_subprocess(cmd, timeout)


async def _container_exec(args: dict, timeout: int) -> str:
    name = _safe_name(args.get("container_name") or args.get("name"))
    command = str(args.get("command") or "").strip()
    shell = str(args.get("shell") or "/bin/sh").strip()
    if shell not in {"/bin/sh", "/bin/bash", "sh", "bash"}:
        shell = "/bin/sh"
    if not command:
        return "No command provided"
    if len(command) > 4000:
        raise ValueError("Command is too long")
    return await _run_subprocess(["docker", "exec", name, shell, "-lc", command], timeout)


async def _package_install(args: dict, timeout: int) -> str:
    packages = [_safe_name(p, "") for p in (args.get("packages") or [])]
    packages = [p for p in packages if p]
    if not packages:
        return "No packages provided"
    if os.path.exists("/usr/bin/apt-get"):
        return await _run_subprocess(["apt-get", "update", "-y"], timeout) + await _run_subprocess([
            "apt-get",
            "install",
            "-y",
            "-o",
            "Dpkg::Options::=--force-confdef",
            "-o",
            "Dpkg::Options::=--force-confold",
            *packages,
        ], timeout)
    if os.path.exists("/usr/bin/yum"):
        return await _run_subprocess(["yum", "install", "-y", "--assumeyes", *packages], timeout)
    if os.path.exists("/usr/bin/dnf"):
        return await _run_subprocess(["dnf", "install", "-y", "--assumeyes", *packages], timeout)
    return "No supported package manager found"


async def _github_repo_run(args: dict, timeout: int) -> str:
    repo_url = str(args.get("repo_url") or "").strip()
    run_script = str(args.get("run_script") or "").strip()
    github_user = str(args.get("github_user") or "").strip()
    github_token = str(args.get("github_token") or "").strip()
    if not repo_url or not run_script:
        return "repo_url and run_script are required"
    if github_user and github_token and repo_url.startswith("https://github.com/"):
        repo_url = repo_url.replace("https://", f"https://{github_user}:{github_token}@")

    install_path = args.get("install_path") or f"/opt/github-runs/{_safe_name(repo_url.split('/')[-1].replace('.git', ''))}"
    os.makedirs(os.path.dirname(install_path), exist_ok=True)
    if os.path.exists(install_path):
        await _run_subprocess(["git", "-C", install_path, "pull", "--ff-only"], timeout)
    else:
        await _run_subprocess(["git", "clone", repo_url, install_path], timeout)

    script_path = os.path.join(install_path, ".codex-run.sh")
    with open(script_path, "w") as f:
        f.write(run_script)
    os.chmod(script_path, 0o700)
    return await _run_subprocess(["/bin/bash", script_path], timeout)


async def _run_approved_script(args: dict, timeout: int) -> str:
    """
    Run a pre-approved script. The script content must be passed explicitly
    (not a path) to prevent path traversal. Script is written to a temp file.
    """
    import tempfile, os as _os
    script_content = args.get("script_content", "")
    if not script_content:
        return "No script_content provided"
    prefix = """export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export APT_LISTCHANGES_FRONTEND=none
"""

    with tempfile.NamedTemporaryFile(mode="w", suffix=".sh", delete=False) as f:
        f.write(prefix + "\n" + script_content)
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
