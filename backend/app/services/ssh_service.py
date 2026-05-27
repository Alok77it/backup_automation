import asyncio
import json
import logging
import time
from dataclasses import dataclass

import asyncssh

from app.core.security import decrypt_secret

logger = logging.getLogger(__name__)


@dataclass
class SSHConnectionInfo:
    hostname: str
    port: int
    username: str
    password: str | None = None
    private_key: str | None = None


@dataclass
class ServerMetrics:
    cpu_percent: float
    memory_percent: float
    disk_percent: float
    disk_read_mb_s: float
    disk_write_mb_s: float
    network_in_mb_s: float
    network_out_mb_s: float
    uptime_seconds: float
    os_info: str


METRICS_SCRIPT = r"""#!/bin/bash
set -e
CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1 2>/dev/null || grep 'cpu ' /proc/stat | awk '{usage=($2+$4)*100/($2+$3+$4+$5)} END {print usage}')
MEM=$(free | awk '/Mem:/ {printf "%.2f", $3/$2 * 100}')
DISK=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
READ=$(cat /proc/diskstats 2>/dev/null | awk '{r+=$6; w+=$10} END {print r/2048, w/2048}' || echo "0 0")
NET=$(cat /proc/net/dev 2>/dev/null | awk 'NR>2 {ri+=$2; ro+=$10} END {print ri/1048576, ro/1048576}' || echo "0 0")
UPTIME=$(cat /proc/uptime | awk '{print $1}')
OS=$(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' || uname -s)
echo "{\"cpu\":$CPU,\"mem\":$MEM,\"disk\":$DISK,\"read\":$(echo $READ|awk '{print $1}'),\"write\":$(echo $READ|awk '{print $2}'),\"net_in\":$(echo $NET|awk '{print $1}'),\"net_out\":$(echo $NET|awk '{print $2}'),\"uptime\":$UPTIME,\"os\":\"$OS\"}"
"""


async def test_ssh_connection(
    hostname: str,
    port: int,
    username: str,
    encrypted_password: str | None = None,
    encrypted_private_key: str | None = None,
    auth_method: str = "password",
) -> tuple[bool, str, str | None, float | None]:
    password = decrypt_secret(encrypted_password) if encrypted_password else None
    private_key = decrypt_secret(encrypted_private_key) if encrypted_private_key else None
    start = time.monotonic()
    try:
        connect_kwargs: dict = {
            "host": hostname,
            "port": port,
            "username": username,
            "known_hosts": None,
        }
        if auth_method == "key" and private_key:
            connect_kwargs["client_keys"] = [asyncssh.import_private_key(private_key)]
        elif password:
            connect_kwargs["password"] = password
        else:
            return False, "No credentials provided", None, None

        async with asyncssh.connect(**connect_kwargs) as conn:
            result = await conn.run("uname -a && cat /etc/os-release 2>/dev/null | head -5", check=False)
            os_info = result.stdout.strip()[:500] if result.stdout else "Linux"
            latency = (time.monotonic() - start) * 1000
            return True, "Connection successful", os_info, latency
    except Exception as e:
        logger.error("SSH connection failed to %s: %s", hostname, e)
        return False, str(e), None, None


async def collect_remote_metrics(
    hostname: str,
    port: int,
    username: str,
    encrypted_password: str | None = None,
    encrypted_private_key: str | None = None,
    auth_method: str = "password",
) -> ServerMetrics | None:
    password = decrypt_secret(encrypted_password) if encrypted_password else None
    private_key = decrypt_secret(encrypted_private_key) if encrypted_private_key else None
    try:
        connect_kwargs: dict = {
            "host": hostname,
            "port": port,
            "username": username,
            "known_hosts": None,
        }
        if auth_method == "key" and private_key:
            connect_kwargs["client_keys"] = [asyncssh.import_private_key(private_key)]
        elif password:
            connect_kwargs["password"] = password
        else:
            return None

        async with asyncssh.connect(**connect_kwargs) as conn:
            result = await conn.run(METRICS_SCRIPT, check=False)
            if result.exit_status != 0 or not result.stdout:
                return _parse_fallback_metrics(result.stdout or "")
            data = json.loads(result.stdout.strip().split("\n")[-1])
            return ServerMetrics(
                cpu_percent=float(data.get("cpu", 0)),
                memory_percent=float(data.get("mem", 0)),
                disk_percent=float(data.get("disk", 0)),
                disk_read_mb_s=float(data.get("read", 0)),
                disk_write_mb_s=float(data.get("write", 0)),
                network_in_mb_s=float(data.get("net_in", 0)),
                network_out_mb_s=float(data.get("net_out", 0)),
                uptime_seconds=float(data.get("uptime", 0)),
                os_info=str(data.get("os", "Linux")),
            )
    except Exception as e:
        logger.error("Metrics collection failed for %s: %s", hostname, e)
        return None


def _parse_fallback_metrics(output: str) -> ServerMetrics:
    return ServerMetrics(
        cpu_percent=0.0,
        memory_percent=0.0,
        disk_percent=0.0,
        disk_read_mb_s=0.0,
        disk_write_mb_s=0.0,
        network_in_mb_s=0.0,
        network_out_mb_s=0.0,
        uptime_seconds=0.0,
        os_info=output[:100] if output else "Unknown",
    )


def run_ssh_command_sync(
    hostname: str,
    port: int,
    username: str,
    command: str,
    password: str | None = None,
    private_key: str | None = None,
    auth_method: str = "password",
    timeout: int = 3600,
    use_sudo: bool = False,
) -> tuple[int, str, str]:
    import shlex
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        if auth_method == "key" and private_key:
            import io

            key = paramiko.RSAKey.from_private_key(io.StringIO(private_key))
            client.connect(hostname, port=port, username=username, pkey=key, timeout=30)
        else:
            client.connect(hostname, port=port, username=username, password=password, timeout=30)
        exec_command = command
        get_pty = False
        if use_sudo and username != "root":
            quoted_command = shlex.quote(command)
            if password:
                exec_command = f"sudo -S -p '' bash -lc {quoted_command}"
                get_pty = True
            else:
                exec_command = f"sudo -n bash -lc {quoted_command}"
        stdin, stdout, stderr = client.exec_command(exec_command, timeout=timeout, get_pty=get_pty)
        if use_sudo and username != "root" and password:
            stdin.write(password + "\n")
            stdin.flush()
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, stdout.read().decode(), stderr.read().decode()
    finally:
        client.close()
