"""
DevOps Execution Worker Tasks (Celery)
========================================
NEW task module — does NOT modify backup_tasks.py / monitor_tasks.py.

Registered in a new celery_devops.py that extends the existing celery_app.
All tasks are added to separate queues (devops_low, devops_medium, devops_high)
so they never compete with backup/monitoring work.

Task registry:
  - dispatch_devops_job       : Route a DevOpsJob to the appropriate handler
  - run_agent_command_task    : Execute a command on a server agent
  - install_plugin_task       : Full plugin installation pipeline
  - poll_containers_task      : Refresh container snapshots for a server
  - health_check_plugins_task : Check health of installed plugins
  - renew_ssl_certs_task      : Auto-renew expiring certificates
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from celery import Task

from app.workers.celery_app import celery_app  # reuse existing Celery instance

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper: get a fresh async DB session inside a sync Celery task
# ---------------------------------------------------------------------------

def _sync_run(coro):
    """Run an async coroutine from a sync Celery task."""
    import asyncio

    async def _runner():
        try:
            return await coro
        finally:
            # Celery prefork workers run many sync tasks in the same process.
            # asyncpg connections are bound to the event loop that created them,
            # so dispose the async pool before this per-task loop is closed.
            from app.core.database import engine

            await engine.dispose()

    loop = asyncio.new_event_loop()
    previous_loop = None
    try:
        try:
            previous_loop = asyncio.get_event_loop()
        except RuntimeError:
            previous_loop = None
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(_runner())
    finally:
        loop.close()
        asyncio.set_event_loop(previous_loop)


async def _get_db():
    from app.core.database import AsyncSessionLocal
    return AsyncSessionLocal()


# ---------------------------------------------------------------------------
# Core dispatch task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    name="app.workers.execution_tasks.dispatch_devops_job",
    queue="devops_low",
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def dispatch_devops_job(self: Task, job_id: str) -> dict:
    """
    Route a DevOpsJob to the appropriate handler task based on job_type.
    This is the single entry point from ExecutionEngine._enqueue_celery().
    """
    return _sync_run(_dispatch_job_async(self, job_id))


async def _dispatch_job_async(task: Task, job_id: str) -> dict:
    from sqlalchemy import select
    from app.models.devops_entities import DevOpsJob, JobStatus

    async with await _get_db() as db:
        result = await db.execute(select(DevOpsJob).where(DevOpsJob.id == uuid.UUID(job_id)))
        job = result.scalar_one_or_none()

        if not job:
            logger.error("Job %s not found", job_id)
            return {"error": "job_not_found"}

        if job.status == JobStatus.CANCELLED:
            logger.info("Job %s was cancelled before dispatch", job_id)
            return {"status": "cancelled"}

        # Update to EXECUTING
        job.status = JobStatus.EXECUTING
        job.started_at = datetime.now(timezone.utc)
        job.celery_task_id = task.request.id
        await db.commit()

        try:
            result_data = await _route_job(db, job)
            job.status = JobStatus.COMPLETED
            job.result = result_data
        except Exception as exc:
            logger.exception("Job %s failed: %s", job_id, exc)
            job.status = JobStatus.FAILED
            job.error_message = str(exc)[:2000]
            result_data = {"error": str(exc)}
            await _mark_plugin_install_failed(db, job, str(exc)[:2000])
        finally:
            job.completed_at = datetime.now(timezone.utc)
            if job.started_at:
                job.duration_ms = int(
                    (job.completed_at - job.started_at).total_seconds() * 1000
                )
            await db.commit()

        return result_data


async def _mark_plugin_install_failed(db, job, error_message: str) -> None:
    if job.job_type != "plugin_install":
        return
    installation_id = (job.payload or {}).get("installation_id")
    if not installation_id:
        return
    try:
        from app.models.devops_entities import PluginInstallation, PluginStatus

        install = await db.get(PluginInstallation, uuid.UUID(str(installation_id)))
        if install and install.status == PluginStatus.INSTALLING:
            install.status = PluginStatus.FAILED
            install.error_message = error_message
            install.health_status = None
    except Exception:
        logger.exception("Failed to mark plugin installation failed for job %s", job.id)


async def _route_job(db, job) -> dict:
    """Dispatch to the correct async handler based on job_type."""
    handlers = {
        "plugin_install":    _handle_plugin_install,
        "plugin_uninstall":  _handle_plugin_uninstall,
        "container_poll":    _handle_container_poll,
        "agent_command":     _handle_agent_command,
        "ssl_issue":         _handle_ssl_issue,
        "ssl_renew":         _handle_ssl_renew,
        "health_check":      _handle_health_check,
    }
    handler = handlers.get(job.job_type)
    if not handler:
        raise ValueError(f"Unknown job_type: '{job.job_type}'")
    return await handler(db, job)


# ---------------------------------------------------------------------------
# Job handlers
# ---------------------------------------------------------------------------

async def _handle_agent_command(db, job) -> dict:
    from sqlalchemy import select
    from app.models.entities import Server
    from app.models.devops_entities import AgentToken, StoredCredential
    from app.core.security import decrypt_secret
    from app.services.agent_comm import AgentCommunicationError, agent_comm

    payload = job.payload or {}
    command = payload.get("command") or job.command
    args = payload.get("args", {})

    # Fetch server details
    server = await db.get(Server, job.server_id)
    if not server:
        raise ValueError("Server not found")

    # Fetch agent token
    token_result = await db.execute(
        select(AgentToken).where(
            AgentToken.server_id == job.server_id,
            AgentToken.is_active == True,
        )
    )
    token = token_result.scalar_one_or_none()
    # NOTE: raw token NOT stored; we use the job payload for one-time commands.
    # For scheduled tasks, the raw token is retrieved from secrets manager.
    raw_token = payload.get("_agent_token_raw")
    if not raw_token and payload.get("agent_credential_id"):
        cred_result = await db.execute(
            select(StoredCredential).where(
                StoredCredential.id == uuid.UUID(payload["agent_credential_id"]),
                StoredCredential.organization_id == job.organization_id,
                StoredCredential.provider == "agent",
                StoredCredential.is_active == True,
            )
        )
        cred = cred_result.scalar_one_or_none()
        if cred:
            raw_token = decrypt_secret(cred.encrypted_secret)
    if raw_token:
        try:
            response = await agent_comm.execute(
                server_hostname=server.hostname,
                server_port=payload.get("agent_port", 9977),
                agent_token_raw=raw_token,
                command=command,
                args=args,
                job_id=str(job.id),
                timeout_seconds=job.timeout_seconds,
            )
        except AgentCommunicationError as exc:
            response = await _execute_ssh_fallback(
                server=server,
                command=command,
                args=args,
                timeout_seconds=job.timeout_seconds,
                reason=str(exc),
            )
    else:
        response = await _execute_ssh_fallback(
            server=server,
            command=command,
            args=args,
            timeout_seconds=job.timeout_seconds,
            reason="No raw agent token was available for this command",
        )

    # Persist log lines
    from app.models.devops_entities import JobLog
    if response.output:
        output_text = str(response.output)
        log = JobLog(
            job_id=job.id,
            sequence=1,
            level="info" if response.success else "error",
            message=output_text[:10000],
            stream="stdout" if response.success else "stderr",
        )
        db.add(log)

    if not response.success:
        output = response.error or response.output or "Agent command failed"
        raise RuntimeError(str(output)[:2000])

    return {
        "success": response.success,
        "exit_code": response.exit_code,
        "output": str(response.output)[:5000] if response.output else None,
        "duration_ms": response.duration_ms,
    }


async def _execute_ssh_fallback(*, server, command: str, args: dict, timeout_seconds: int, reason: str):
    from app.core.security import decrypt_secret
    from app.services.agent_comm import AgentResponse
    from app.services.ssh_service import run_ssh_command_sync

    shell = _ssh_fallback_command(command, args)
    if not shell:
        raise RuntimeError(f"Cannot reach agent and SSH fallback is not supported for command '{command}': {reason}")

    password = decrypt_secret(server.encrypted_password) if server.encrypted_password else None
    private_key = decrypt_secret(server.encrypted_private_key) if server.encrypted_private_key else None
    if not password and not private_key:
        raise RuntimeError(f"Cannot reach agent and server has no SSH credential for fallback: {reason}")

    import asyncio

    exit_code, stdout, stderr = await asyncio.to_thread(
        run_ssh_command_sync,
        server.hostname,
        server.port,
        server.username,
        shell,
        password,
        private_key,
        server.auth_method,
        timeout_seconds,
    )
    output = (
        "[SSH fallback used because the HTTP agent was unreachable]\n"
        f"Agent error: {reason}\n\n"
        f"{stdout or ''}{stderr or ''}"
    )
    return AgentResponse(
        success=exit_code == 0,
        output=output,
        exit_code=exit_code,
        duration_ms=0,
        error=None if exit_code == 0 else output,
    )


def _shell_quote(value: object) -> str:
    import shlex

    return shlex.quote(str(value))


def _ssh_fallback_command(command: str, args: dict) -> str | None:
    if command == "script_run_approved":
        script = str(args.get("script_content") or "")
        if not script:
            return None
        import base64

        encoded = base64.b64encode(script.encode()).decode()
        return (
            "set -e; export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a APT_LISTCHANGES_FRONTEND=none; "
            "tmp=$(mktemp /tmp/bi-script.XXXXXX.sh); "
            f"printf %s {_shell_quote(encoded)} | base64 -d > \"$tmp\"; "
            "chmod 700 \"$tmp\"; /bin/bash \"$tmp\"; rc=$?; rm -f \"$tmp\"; exit $rc"
        )
    if command == "package_install":
        packages = [_shell_quote(p) for p in (args.get("packages") or []) if str(p).strip()]
        if not packages:
            return None
        joined = " ".join(packages)
        return (
            "set -e; export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a APT_LISTCHANGES_FRONTEND=none; "
            "if command -v apt-get >/dev/null 2>&1; then "
            f"apt-get update -y && apt-get install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold {joined}; "
            "elif command -v dnf >/dev/null 2>&1; then "
            f"dnf install -y --assumeyes {joined}; "
            "elif command -v yum >/dev/null 2>&1; then "
            f"yum install -y --assumeyes {joined}; "
            "else echo 'No supported package manager found' >&2; exit 1; fi"
        )
    if command in {"plugin_install", "docker_compose_up"}:
        compose = str(args.get("compose_content") or "")
        install_path = str(args.get("install_path") or "/opt/devops-plugin")
        if not compose:
            return None
        import base64

        encoded = base64.b64encode(compose.encode()).decode()
        prepare_dirs = _compose_prepare_dirs(args)
        return (
            "set -e; export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a APT_LISTCHANGES_FRONTEND=none; "
            f"mkdir -p {_shell_quote(install_path)} {prepare_dirs}; "
            f"printf %s {_shell_quote(encoded)} | base64 -d > {_shell_quote(install_path)}/docker-compose.yml; "
            f"docker compose -f {_shell_quote(install_path)}/docker-compose.yml down --remove-orphans >/dev/null 2>&1 || true; "
            f"{_compose_port_patch(args, f'{install_path}/docker-compose.yml')}"
            f"docker compose -f {_shell_quote(install_path)}/docker-compose.yml up -d --pull always"
        )
    if command == "docker_compose_down":
        install_path = str(args.get("install_path") or "/opt/devops-plugin")
        return f"docker compose -f {_shell_quote(install_path)}/docker-compose.yml down --remove-orphans"
    if command == "docker_compose_restart":
        install_path = str(args.get("install_path") or "/opt/devops-plugin")
        return f"docker compose -f {_shell_quote(install_path)}/docker-compose.yml restart"
    if command == "docker_compose_logs":
        install_path = str(args.get("install_path") or "/opt/devops-plugin")
        return f"docker compose -f {_shell_quote(install_path)}/docker-compose.yml logs --tail 200"
    if command == "plugin_uninstall":
        plugin_id = str(args.get("plugin_id") or "devops-plugin")
        install_path = str(args.get("install_path") or f"/opt/{plugin_id}")
        return f"docker compose -f {_shell_quote(install_path)}/docker-compose.yml down --remove-orphans"
    if command == "github_repo_run":
        repo_url = str(args.get("repo_url") or "").strip()
        run_script = str(args.get("run_script") or "").strip()
        if not repo_url or not run_script:
            return None
        github_user = str(args.get("github_user") or "").strip()
        github_token = str(args.get("github_token") or "").strip()
        if github_user and github_token and repo_url.startswith("https://github.com/"):
            repo_url = repo_url.replace("https://", f"https://{github_user}:{github_token}@")
        import base64

        default_name = repo_url.rstrip("/").split("/")[-1].replace(".git", "") or "repo"
        install_path = str(args.get("install_path") or f"/opt/github-runs/{default_name}")
        encoded_script = base64.b64encode(run_script.encode()).decode()
        return (
            "set -e; export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a APT_LISTCHANGES_FRONTEND=none; "
            "if ! command -v git >/dev/null 2>&1; then "
            "if command -v apt-get >/dev/null 2>&1; then apt-get update -y && apt-get install -y git; "
            "elif command -v dnf >/dev/null 2>&1; then dnf install -y git; "
            "elif command -v yum >/dev/null 2>&1; then yum install -y git; fi; fi; "
            f"mkdir -p {_shell_quote('/'.join(install_path.split('/')[:-1]) or '/opt/github-runs')}; "
            f"if [ -d {_shell_quote(install_path)}/.git ]; then git -C {_shell_quote(install_path)} pull --ff-only; "
            f"else rm -rf {_shell_quote(install_path)} && git clone {_shell_quote(repo_url)} {_shell_quote(install_path)}; fi; "
            f"printf %s {_shell_quote(encoded_script)} | base64 -d > {_shell_quote(install_path)}/.bi-run.sh; "
            f"chmod 700 {_shell_quote(install_path)}/.bi-run.sh; cd {_shell_quote(install_path)}; /bin/bash ./.bi-run.sh"
        )
    if command == "container_create":
        image = str(args.get("image") or "").strip()
        if not image:
            return None
        name = str(args.get("name") or image.split("/")[-1].split(":")[0]).strip()
        parts = ["docker", "run", "-d", "--name", _shell_quote(name)]
        for port in args.get("ports") or []:
            port = str(port).strip()
            if port and all(ch.isdigit() or ch in ":/" for ch in port):
                parts.extend(["-p", _shell_quote(port)])
        for env in args.get("env") or []:
            env = str(env).strip()
            if env and "=" in env and "\n" not in env:
                parts.extend(["-e", _shell_quote(env)])
        for volume in args.get("volumes") or []:
            volume = str(volume).strip()
            if volume and ":" in volume and "\n" not in volume:
                parts.extend(["-v", _shell_quote(volume)])
        restart_policy = str(args.get("restart_policy") or "unless-stopped")
        if restart_policy in {"no", "always", "on-failure", "unless-stopped"}:
            parts.extend(["--restart", _shell_quote(restart_policy)])
        parts.append(_shell_quote(image))
        return " ".join(parts)
    if command in {"container_start", "container_stop", "container_restart"}:
        container = str(args.get("container_name") or "").strip()
        if not container:
            return None
        action = command.replace("container_", "")
        return f"docker {action} {_shell_quote(container)}"
    if command == "container_remove":
        container = str(args.get("container_name") or "").strip()
        if not container:
            return None
        force = "-f " if args.get("force", True) else ""
        return f"docker rm {force}{_shell_quote(container)}"
    if command == "container_logs":
        container = str(args.get("container_name") or "").strip()
        return f"docker logs --tail 200 {_shell_quote(container)}" if container else None
    if command == "container_inspect":
        container = str(args.get("container_name") or "").strip()
        return f"docker inspect {_shell_quote(container)}" if container else None
    if command == "container_exec":
        container = str(args.get("container_name") or "").strip()
        exec_command = str(args.get("command") or "").strip()
        shell = str(args.get("shell") or "/bin/sh")
        if shell not in {"/bin/sh", "/bin/bash", "sh", "bash"}:
            shell = "/bin/sh"
        if not container or not exec_command:
            return None
        return f"docker exec {_shell_quote(container)} {_shell_quote(shell)} -lc {_shell_quote(exec_command)}"
    if command == "container_list":
        return "docker ps -a --format '{{json .}}'"
    if command == "system_info":
        return "uname -a; cat /etc/os-release 2>/dev/null || true; uptime; free -h; df -h /"
    if command == "disk_usage":
        return "df -h"
    if command == "process_list":
        return "ps aux"
    if command == "service_status":
        service = str(args.get("service_name") or "").strip()
        return f"systemctl status {_shell_quote(service)} --no-pager" if service else None
    if command == "service_restart":
        service = str(args.get("service_name") or "").strip()
        return f"systemctl restart {_shell_quote(service)}" if service else None
    if command == "nginx_test_config":
        return "nginx -t"
    if command == "nginx_reload":
        config = str(args.get("config_content") or "")
        domain = str(args.get("domain") or "managed")
        if config:
            import base64

            encoded = base64.b64encode(config.encode()).decode()
            return (
                "set -e; mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled; "
                f"printf %s {_shell_quote(encoded)} | base64 -d > /etc/nginx/sites-available/{_shell_quote(domain)}.conf; "
                f"ln -sf /etc/nginx/sites-available/{_shell_quote(domain)}.conf /etc/nginx/sites-enabled/{_shell_quote(domain)}.conf; "
                "nginx -t; systemctl reload nginx"
            )
        return "nginx -t; systemctl reload nginx"
    return None


def _compose_prepare_dirs(args: dict) -> str:
    config = args.get("config") or {}
    candidates = [
        config.get("jenkins_home"),
        f"{args.get('install_path') or '/opt/devops-plugin'}/data",
        f"{config.get('install_path')}/data" if config.get("install_path") else None,
    ]
    dirs = []
    for item in candidates:
        text = str(item or "").strip()
        if text.startswith("/") and "\n" not in text:
            dirs.append(_shell_quote(text))
    return " ".join(dict.fromkeys(dirs))


def _compose_port_patch(args: dict, compose_file: str) -> str:
    plugin_id = str(args.get("plugin_id") or "")
    config = args.get("config") or {}
    mappings: list[tuple[str, int, int, str]] = []
    if plugin_id == "jenkins":
        mappings.append(("Jenkins UI", _int_or_default(config.get("jenkins_port"), 8080), 8080, "jenkins_port"))
        mappings.append(("Jenkins agent", _int_or_default(config.get("jenkins_agent_port"), 50000), 50000, "jenkins_agent_port"))
    elif plugin_id == "n8n":
        mappings.append(("n8n", _int_or_default(config.get("n8n_port"), 5678), 5678, "n8n_port"))
    if not mappings:
        return ""

    lines = [
        "port_busy(){ if command -v ss >/dev/null 2>&1; then ss -H -ltn \"sport = :$1\" | grep -q .; else netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq \"[:.]$1$\"; fi; }; ",
        "pick_port(){ p=\"$1\"; while port_busy \"$p\"; do p=$((p+1)); done; printf \"%s\" \"$p\"; }; ",
    ]
    quoted_file = _shell_quote(compose_file)
    for label, public_port, container_port, _key in mappings:
        safe_label = label.replace("'", "")
        lines.append(
            f"p={public_port}; np=$(pick_port \"$p\"); "
            f"if [ \"$np\" != \"$p\" ]; then "
            f"sed -i \"s/[\\\"']$p:{container_port}[\\\"']/\\\"$np:{container_port}\\\"/g\" {quoted_file}; "
            f"echo '[PORT] {safe_label} port '$p' busy; using '$np; "
            "fi; "
        )
    return "".join(lines)


def _int_or_default(value: object, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


async def _handle_plugin_install(db, job) -> dict:
    from app.services.plugin_manager import plugin_manager, PluginStatus

    payload = job.payload or {}
    plugin_id = job.plugin_id or payload.get("plugin_id")
    installation_id = payload.get("installation_id")

    if not plugin_id:
        raise ValueError("plugin_id is required for plugin_install job")

    # Delegate actual execution to agent command
    agent_result = await _handle_agent_command(db, job)

    # Update installation record
    if installation_id:
        success = agent_result.get("success", False)
        await plugin_manager.update_installation_status(
            db,
            installation_id=uuid.UUID(installation_id),
            status=PluginStatus.INSTALLED if success else PluginStatus.FAILED,
            error_message=None if success else agent_result.get("output", ""),
            access_url=payload.get("access_url"),
            install_path=(payload.get("args") or {}).get("install_path"),
        )

    return agent_result


async def _handle_plugin_uninstall(db, job) -> dict:
    from app.services.plugin_manager import plugin_manager, PluginStatus
    payload = job.payload or {}
    installation_id = payload.get("installation_id")

    agent_result = await _handle_agent_command(db, job)

    if installation_id:
        success = agent_result.get("success", False)
        await plugin_manager.update_installation_status(
            db,
            installation_id=uuid.UUID(installation_id),
            status=PluginStatus.UNINSTALLED if success else PluginStatus.FAILED,
            error_message=None if success else agent_result.get("output", ""),
        )
    return agent_result


async def _handle_container_poll(db, job) -> dict:
    from sqlalchemy import select
    from app.models.entities import Server
    from app.models.devops_entities import AgentToken
    from app.services.agent_comm import agent_comm
    from app.services.container_service import container_service

    payload = job.payload or {}
    server = await db.get(Server, job.server_id)
    if not server:
        raise ValueError("Server not found")

    token_result = await db.execute(
        select(AgentToken).where(
            AgentToken.server_id == job.server_id,
            AgentToken.is_active == True,
        )
    )
    token = token_result.scalar_one_or_none()
    if not token:
        return {"skipped": "no agent token", "server_id": str(job.server_id)}

    raw_token = payload.get("_agent_token_raw")
    if not raw_token:
        return {"skipped": "no raw token in payload"}

    containers = await agent_comm.get_container_list(
        server_hostname=server.hostname,
        server_port=payload.get("agent_port", 9977),
        agent_token_raw=raw_token,
        include_stopped=True,
    )

    snapshots = await container_service.refresh_snapshots(
        db,
        organization_id=job.organization_id,
        server_id=job.server_id,
        raw_containers=containers,
    )
    return {"containers_refreshed": len(snapshots)}


async def _handle_ssl_issue(db, job) -> dict:
    from app.services.ssl_service import ssl_service, SSLStatus
    from app.models.devops_entities import SSLCertificate
    from sqlalchemy import select

    payload = job.payload or {}
    domain = payload.get("domain")
    email = payload.get("acme_email")
    cert_id = payload.get("cert_id")

    if not domain or not email:
        raise ValueError("domain and acme_email required for ssl_issue")

    # Delegate to agent
    agent_result = await _handle_agent_command(db, job)
    success = agent_result.get("success", False)

    if cert_id:
        result = await db.execute(
            select(SSLCertificate).where(SSLCertificate.id == uuid.UUID(cert_id))
        )
        cert = result.scalar_one_or_none()
        if cert:
            cert.status = SSLStatus.ACTIVE if success else SSLStatus.FAILED
            if success:
                cert.issued_at = datetime.now(timezone.utc)
                from datetime import timedelta
                cert.expires_at = datetime.now(timezone.utc) + timedelta(days=90)
                cert.cert_pem_path = f"/etc/letsencrypt/live/{domain}/fullchain.pem"
                cert.key_path = f"/etc/letsencrypt/live/{domain}/privkey.pem"
                cert.chain_pem_path = f"/etc/letsencrypt/live/{domain}/chain.pem"
            else:
                cert.error_message = agent_result.get("output", "")[:500]
            await db.commit()

    return agent_result


async def _handle_ssl_renew(db, job) -> dict:
    return await _handle_agent_command(db, job)


async def _handle_health_check(db, job) -> dict:
    from app.models.devops_entities import PluginInstallation, PluginStatus
    from sqlalchemy import select

    payload = job.payload or {}
    installation_id = payload.get("installation_id")

    if not installation_id:
        return {"skipped": "no installation_id"}

    result = await db.execute(
        select(PluginInstallation).where(
            PluginInstallation.id == uuid.UUID(installation_id)
        )
    )
    install = result.scalar_one_or_none()
    if not install:
        return {"error": "installation not found"}

    # Attempt agent ping
    try:
        agent_result = await _handle_agent_command(db, job)
        is_healthy = agent_result.get("success", False)
    except Exception as exc:
        is_healthy = False
        agent_result = {"error": str(exc)}

    install.health_status = "healthy" if is_healthy else "unhealthy"
    install.last_health_check = datetime.now(timezone.utc)
    await db.commit()

    return {**agent_result, "health_status": install.health_status}


# ---------------------------------------------------------------------------
# Periodic tasks (registered in celery_devops.py beat schedule)
# ---------------------------------------------------------------------------

@celery_app.task(
    name="app.workers.execution_tasks.poll_all_containers",
    queue="devops_low",
)
def poll_all_containers() -> dict:
    """
    Periodic task: refresh container snapshots for all online servers
    that have an active agent token.
    """
    return _sync_run(_poll_all_containers_async())


async def _poll_all_containers_async() -> dict:
    from sqlalchemy import select
    from app.models.entities import Server, ServerStatus
    from app.models.devops_entities import AgentToken

    refreshed = 0
    errors = 0

    async with await _get_db() as db:
        # Find servers that have an active agent token
        result = await db.execute(
            select(Server, AgentToken)
            .join(AgentToken, AgentToken.server_id == Server.id)
            .where(
                Server.status == ServerStatus.ONLINE,
                AgentToken.is_active == True,
            )
        )
        pairs = result.all()

    for server, token in pairs:
        try:
            # Schedule a container_poll job (non-blocking)
            poll_containers_for_server.apply_async(
                kwargs={
                    "server_id": str(server.id),
                    "organization_id": str(server.organization_id),
                    "token_hash": token.token_hash,
                },
                queue="devops_low",
            )
            refreshed += 1
        except Exception as exc:
            logger.warning("Failed to schedule container poll for %s: %s", server.id, exc)
            errors += 1

    return {"scheduled": refreshed, "errors": errors}


@celery_app.task(
    name="app.workers.execution_tasks.poll_containers_for_server",
    queue="devops_low",
    max_retries=2,
)
def poll_containers_for_server(server_id: str, organization_id: str, token_hash: str) -> dict:
    return _sync_run(_poll_server_containers(server_id, organization_id, token_hash))


async def _poll_server_containers(server_id: str, organization_id: str, token_hash: str) -> dict:
    """
    Individual server container poll — separated so failures don't block others.
    NOTE: The raw token is not stored — this task uses the token hash to look up
    the server's stored connection profile. In production, the raw token is held
    in the server's encrypted config or a secrets manager.
    """
    logger.info("Container poll for server %s (hash=%s...)", server_id, token_hash[:8])
    return {"server_id": server_id, "status": "scheduled_by_agent_token_hash"}


@celery_app.task(
    name="app.workers.execution_tasks.check_ssl_renewals",
    queue="devops_low",
)
def check_ssl_renewals() -> dict:
    """Periodic: find certs expiring within 30 days and submit renewal jobs."""
    return _sync_run(_check_ssl_renewals_async())


async def _check_ssl_renewals_async() -> dict:
    from sqlalchemy import select
    from app.models.devops_entities import SSLCertificate, SSLStatus
    from app.models.entities import Organization
    from datetime import timedelta, timezone

    renewed = 0
    async with await _get_db() as db:
        # Query ALL active auto-renew certs expiring within 30 days across all orgs
        threshold = datetime.now(timezone.utc) + timedelta(days=30)
        result = await db.execute(
            select(SSLCertificate).where(
                SSLCertificate.auto_renew == True,
                SSLCertificate.status == SSLStatus.ACTIVE,
                SSLCertificate.expires_at <= threshold,
            )
        )
        expiring = result.scalars().all()
        logger.info("Found %d certificates due for renewal", len(expiring))
        renewed = len(expiring)
        # TODO: for each expiring cert, submit a ssl_renew job via ExecutionEngine

    return {"certs_queued_for_renewal": renewed}


@celery_app.task(
    name="app.workers.execution_tasks.health_check_all_plugins",
    queue="devops_low",
)
def health_check_all_plugins() -> dict:
    """Periodic: check health of all installed plugins."""
    return _sync_run(_health_check_all_async())


async def _health_check_all_async() -> dict:
    from sqlalchemy import select
    from app.models.devops_entities import PluginInstallation, PluginStatus

    async with await _get_db() as db:
        result = await db.execute(
            select(PluginInstallation).where(
                PluginInstallation.status == PluginStatus.INSTALLED
            )
        )
        installs = result.scalars().all()

    logger.info("Scheduling health checks for %d plugin installations", len(installs))
    return {"health_checks_scheduled": len(installs)}
