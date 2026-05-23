import logging
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class BackupResult:
    success: bool
    bytes_processed: int
    bytes_added: int
    duration_seconds: float
    snapshot_id: str | None
    checksum_valid: bool
    failed_chunks: int
    log_output: str
    error_message: str | None = None


def _run_command(cmd: list[str], env: dict | None = None, timeout: int = 86400) -> tuple[int, str, str]:
    full_env = {**os.environ, **(env or {})}
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=full_env,
        timeout=timeout,
    )
    output = proc.stdout + proc.stderr
    return proc.returncode, output, proc.stderr


def _parse_rsync_bytes(output: str) -> int:
    """Extract total transferred bytes from rsync --stats output."""
    for line in output.splitlines():
        if "Total file size" in line:
            try:
                return int(line.split()[-1].replace(",", ""))
            except (ValueError, IndexError):
                pass
    return 0


def _build_ssh_opts(
    ssh_key_path: str | None = None,
    ssh_password: str | None = None,
) -> tuple[list[str], dict]:
    """
    Return (rsync -e args, extra env vars) for SSH authentication.
    Prefers key auth; falls back to sshpass for password auth.
    """
    base = "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15"
    env: dict = {}
    if ssh_key_path:
        ssh_cmd = f"{base} -o BatchMode=yes -i {ssh_key_path}"
    elif ssh_password:
        # sshpass feeds the password to SSH non-interactively
        ssh_cmd = f"sshpass -e {base} -o BatchMode=no"
        env["SSHPASS"] = ssh_password
    else:
        ssh_cmd = f"{base} -o BatchMode=yes"
    return ["-e", ssh_cmd], env


def run_rsync_backup(
    source_paths: list[str],
    target_path: str,
    backup_type: str = "full",
    compression: bool = True,
    remote: str | None = None,
    ssh_key_path: str | None = None,
    ssh_password: str | None = None,
) -> BackupResult:
    """
    Back up one or more source_paths to target_path using rsync.

    Compression (-z) compresses data during transfer only — files are stored
    in their original format at the destination, so restore needs no
    decompression step.

    Args:
        source_paths: List of paths to back up (on the remote server if remote is set).
        target_path:  Local destination directory (inside Docker backup volume).
        backup_type:  "full" | "incremental" — incremental uses --link-dest for
                      hard-link deduplication against the previous run.
        compression:  Always True in normal use; pass False only to benchmark.
        remote:       "user@host" string for SSH remote source.
        ssh_key_path: Path to SSH private key file (preferred over password auth).
        ssh_password: Plaintext SSH password — used with sshpass when no key is set.
    """
    start = time.monotonic()
    os.makedirs(target_path, exist_ok=True)
    total_bytes = 0
    logs: list[str] = []
    success = True

    # Build SSH options once
    ssh_opts: list[str] = []
    ssh_env: dict = {}
    if remote:
        ssh_opts, ssh_env = _build_ssh_opts(ssh_key_path, ssh_password)

    for src in source_paths:
        dest = os.path.join(target_path, Path(src).name or "root")
        os.makedirs(dest, exist_ok=True)

        cmd = ["rsync", "-a", "--stats", "--delete"]
        if compression:
            cmd.append("-z")
        if backup_type == "incremental":
            latest = os.path.join(target_path, "latest")
            if os.path.exists(latest):
                cmd.extend(["--link-dest", latest])
        if ssh_opts:
            cmd.extend(ssh_opts)

        if remote:
            cmd.extend([f"{remote}:{src}/", dest + "/"])
        else:
            cmd.extend([src + "/", dest + "/"])

        code, output, _ = _run_command(cmd, env=ssh_env or None)
        logs.append(output)
        if code != 0:
            success = False
        total_bytes += _parse_rsync_bytes(output)

    # Update "latest" symlink for incremental backups
    latest_link = os.path.join(target_path, "latest")
    if success and source_paths:
        if os.path.islink(latest_link):
            os.unlink(latest_link)
        first_dest = os.path.join(target_path, Path(source_paths[0]).name or "root")
        try:
            os.symlink(first_dest, latest_link, target_is_directory=True)
        except OSError:
            pass  # non-critical

    duration = time.monotonic() - start
    return BackupResult(
        success=success,
        bytes_processed=total_bytes,
        bytes_added=total_bytes,
        duration_seconds=duration,
        snapshot_id=f"rsync-{int(start)}",
        checksum_valid=success,
        failed_chunks=0 if success else len(source_paths),
        log_output="\n".join(logs),
        error_message=None if success else "\n".join(logs)[-2000:],
    )


def restore_rsync(
    backup_path: str,
    target_path: str,
    compression: bool = True,
    remote: str | None = None,
    ssh_key_path: str | None = None,
    ssh_password: str | None = None,
) -> BackupResult:
    """
    Restore files from backup_path back to target_path using rsync.

    Because rsync -z only compresses during transfer (files at backup_path are
    already in original format), this is simply an rsync copy back — no
    decompression needed.

    Args:
        backup_path:  The directory that was created during backup (source of restore).
        target_path:  Where files should be restored to (local path or remote path).
        compression:  Compress data during the transfer (mirrors what was used at backup time).
        remote:       "user@host" — push restored files to a remote server.
        ssh_key_path: SSH private key for remote restore.
        ssh_password: SSH password — used with sshpass when no key is set.
    """
    start = time.monotonic()
    os.makedirs(target_path, exist_ok=True)

    ssh_opts: list[str] = []
    ssh_env: dict = {}
    if remote:
        ssh_opts, ssh_env = _build_ssh_opts(ssh_key_path, ssh_password)

    cmd = ["rsync", "-a", "--stats"]
    if compression:
        cmd.append("-z")
    if ssh_opts:
        cmd.extend(ssh_opts)

    if remote:
        cmd.extend([backup_path + "/", f"{remote}:{target_path}/"])
    else:
        cmd.extend([backup_path + "/", target_path + "/"])

    code, output, _ = _run_command(cmd, env=ssh_env or None)
    duration = time.monotonic() - start
    total_bytes = _parse_rsync_bytes(output)

    return BackupResult(
        success=code == 0,
        bytes_processed=total_bytes,
        bytes_added=total_bytes,
        duration_seconds=duration,
        snapshot_id=f"restore-{int(start)}",
        checksum_valid=code == 0,
        failed_chunks=0 if code == 0 else 1,
        log_output=output,
        error_message=None if code == 0 else output[-2000:],
    )


def run_rclone_backup(
    source: str,
    target_path: str,
    config_extra: dict | None = None,
) -> BackupResult:
    """
    Sync a source (rclone remote or local path) to target_path using rclone.
    Useful for cloud storage destinations (S3, GCS, B2, etc.).
    """
    start = time.monotonic()
    os.makedirs(target_path, exist_ok=True)
    cmd = ["rclone", "sync", source, target_path, "--stats-one-line", "-v"]
    if config_extra:
        for k, v in config_extra.items():
            cmd.extend([f"--{k}", str(v)])
    code, output, _ = _run_command(cmd)
    duration = time.monotonic() - start

    bytes_val = 0
    for line in output.splitlines():
        if "Transferred:" in line:
            parts = line.split()
            for i, p in enumerate(parts):
                if p.endswith("Bytes") and i > 0:
                    try:
                        bytes_val = int(parts[i - 1].replace(",", ""))
                    except ValueError:
                        pass

    return BackupResult(
        success=code == 0,
        bytes_processed=bytes_val,
        bytes_added=bytes_val,
        duration_seconds=duration,
        snapshot_id=f"rclone-{int(start)}",
        checksum_valid=code == 0,
        failed_chunks=0 if code == 0 else 1,
        log_output=output,
        error_message=None if code == 0 else output[-2000:],
    )


def run_database_backup(
    db_type: str,
    connection_string: str,
    target_file: str,
) -> BackupResult:
    """Dump a database to a file using the appropriate CLI tool."""
    start = time.monotonic()
    os.makedirs(os.path.dirname(target_file), exist_ok=True)
    cmd: list[str] = []
    if db_type == "postgresql":
        cmd = ["pg_dump", connection_string, "-Fc", "-f", target_file]
    elif db_type == "mysql":
        cmd = ["mysqldump", *connection_string.split(), f"--result-file={target_file}"]
    elif db_type == "mongodb":
        cmd = ["mongodump", "--uri", connection_string, f"--archive={target_file}"]
    elif db_type == "redis":
        cmd = ["redis-cli", "-u", connection_string, "--rdb", target_file]
    else:
        return BackupResult(False, 0, 0, 0, None, False, 0, "", f"Unsupported database: {db_type}")

    code, output, _ = _run_command(cmd)
    duration = time.monotonic() - start
    size = os.path.getsize(target_file) if os.path.exists(target_file) else 0
    return BackupResult(
        success=code == 0 and size > 0,
        bytes_processed=size,
        bytes_added=size,
        duration_seconds=duration,
        snapshot_id=os.path.basename(target_file),
        checksum_valid=code == 0,
        failed_chunks=0 if code == 0 else 1,
        log_output=output,
        error_message=None if code == 0 else output[-2000:],
    )


def run_docker_backup(
    container_ids: list[str],
    target_path: str,
    include_volumes: bool = True,
) -> BackupResult:
    """Export Docker containers and their volumes to tar archives."""
    start = time.monotonic()
    os.makedirs(target_path, exist_ok=True)
    logs: list[str] = []
    success = True
    total_bytes = 0

    for cid in container_ids:
        export_file = os.path.join(target_path, f"{cid}.tar")
        code, output, _ = _run_command(["docker", "export", "-o", export_file, cid])
        logs.append(output)
        if code != 0:
            success = False
        elif os.path.exists(export_file):
            total_bytes += os.path.getsize(export_file)

        if include_volumes:
            inspect_code, inspect_out, _ = _run_command(
                ["docker", "inspect", "-f", "{{range .Mounts}}{{.Name}} {{end}}", cid]
            )
            if inspect_code == 0:
                for vol in inspect_out.strip().split():
                    if not vol:
                        continue
                    vol_path = os.path.join(target_path, f"{cid}-vol-{vol}.tar")
                    vc, vo, _ = _run_command(
                        [
                            "docker", "run", "--rm",
                            "-v", f"{vol}:/data",
                            "-v", f"{target_path}:/backup",
                            "alpine",
                            "tar", "cf", f"/backup/{cid}-vol-{vol}.tar", "/data",
                        ]
                    )
                    logs.append(vo)
                    if vc != 0:
                        success = False
                    elif os.path.exists(vol_path):
                        total_bytes += os.path.getsize(vol_path)

    duration = time.monotonic() - start
    return BackupResult(
        success=success,
        bytes_processed=total_bytes,
        bytes_added=total_bytes,
        duration_seconds=duration,
        snapshot_id=f"docker-{int(start)}",
        checksum_valid=success,
        failed_chunks=0 if success else 1,
        log_output="\n".join(logs),
        error_message=None if success else "\n".join(logs)[-2000:],
    )
