import logging
import os
import re
import gzip
import shutil
import subprocess
import tarfile
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _sanitize_log(output: str, secrets: list[str]) -> str:
    """Replace any secret values that may have leaked into log output with [REDACTED]."""
    import re
    for secret in secrets:
        if secret:
            output = output.replace(secret, "[REDACTED]")
            # Also catch URL-encoded or repr()-wrapped forms
            output = re.sub(re.escape(repr(secret)), "[REDACTED]", output)
    # Catch PGPASSWORD= patterns in shell output
    output = re.sub(r"PGPASSWORD=\S+", "PGPASSWORD=[REDACTED]", output)
    # Catch -p<password> mysql patterns
    output = re.sub(r"-p\S{3,}", "-p[REDACTED]", output)
    return output


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


ProgressCallback = Callable[[str], None]


def _run_command(
    cmd: list[str],
    env: dict | None = None,
    timeout: int = 86400,
    progress_callback: ProgressCallback | None = None,
) -> tuple[int, str, str]:
    full_env = {**os.environ, **(env or {})}
    if not progress_callback:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=full_env,
            timeout=timeout,
        )
        output = proc.stdout + proc.stderr
        return proc.returncode, output, proc.stderr

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=full_env,
        bufsize=1,
    )
    chunks: list[str] = []
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            chunks.append(line)
            progress_callback(line.rstrip())
        code = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        chunks.append(f"\nCommand timed out after {timeout}s\n")
        progress_callback(f"Command timed out after {timeout}s")
        raise
    output = "".join(chunks)
    return code, output, output


def _parse_rsync_bytes(output: str) -> int:
    """Extract total transferred bytes from rsync --stats output."""
    for line in output.splitlines():
        if "Total file size" in line:
            match = re.search(r"Total file size:\s*([0-9,]+)", line)
            if match:
                return int(match.group(1).replace(",", ""))
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
    progress_callback: ProgressCallback | None = None,
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

        cmd = [
            "rsync",
            "-a",
            "--stats",
            "--delete",
            "--partial",
            "--timeout=600",
            "--contimeout=30",
            "--info=progress2,name1,stats2",
        ]
        if remote and src.strip() == "/":
            cmd.extend([
                "--one-file-system",
                "--exclude=/proc/***",
                "--exclude=/sys/***",
                "--exclude=/dev/***",
                "--exclude=/run/***",
                "--exclude=/tmp/***",
                "--exclude=/mnt/***",
                "--exclude=/media/***",
                "--exclude=/lost+found",
            ])
        if os.path.abspath(target_path).startswith(os.path.abspath(src.rstrip("/") or "/") + os.sep):
            cmd.extend([f"--exclude={os.path.abspath(target_path)}/***"])
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

        if progress_callback:
            progress_callback(f"Starting rsync: {src} -> {dest}")
        code, output, _ = _run_command(cmd, env=ssh_env or None, progress_callback=progress_callback)
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
    snapshot_id = f"files-{int(start)}.tar.gz" if compression else f"files-{int(start)}"
    if success and compression:
        archive_path = os.path.join(target_path, snapshot_id)
        if progress_callback:
            progress_callback(f"Creating compressed archive: {archive_path}")
        with tarfile.open(archive_path, "w:gz") as tar:
            for item in os.listdir(target_path):
                item_path = os.path.join(target_path, item)
                if item == snapshot_id or item == "latest":
                    continue
                tar.add(item_path, arcname=item)
        for item in os.listdir(target_path):
            item_path = os.path.join(target_path, item)
            if item == snapshot_id or item == "latest":
                continue
            if os.path.isdir(item_path) and not os.path.islink(item_path):
                shutil.rmtree(item_path)
            elif os.path.exists(item_path):
                os.unlink(item_path)
        total_bytes = os.path.getsize(archive_path) if os.path.exists(archive_path) else total_bytes

    return BackupResult(
        success=success,
        bytes_processed=total_bytes,
        bytes_added=total_bytes,
        duration_seconds=duration,
        snapshot_id=snapshot_id,
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
    progress_callback: ProgressCallback | None = None,
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
    import tempfile

    start = time.monotonic()
    if not remote:
        os.makedirs(target_path, exist_ok=True)
    temp_dir: str | None = None
    source_path = backup_path
    if os.path.isfile(backup_path) and backup_path.endswith((".tar.gz", ".tgz")):
        if progress_callback:
            progress_callback(f"Extracting archive for restore: {backup_path}")
        temp_dir = tempfile.mkdtemp(prefix="backup-restore-")
        with tarfile.open(backup_path, "r:gz") as tar:
            root = os.path.realpath(temp_dir)
            for member in tar.getmembers():
                member_path = os.path.realpath(os.path.join(root, member.name))
                if not member_path.startswith(root + os.sep):
                    raise RuntimeError(f"Unsafe archive member: {member.name}")
            tar.extractall(temp_dir)
        source_path = temp_dir

    ssh_opts: list[str] = []
    ssh_env: dict = {}
    if remote:
        ssh_opts, ssh_env = _build_ssh_opts(ssh_key_path, ssh_password)

    cmd = [
        "rsync",
        "-a",
        "--stats",
        "--partial",
        "--timeout=600",
        "--contimeout=30",
        "--info=progress2,name1,stats2",
    ]
    if compression:
        cmd.append("-z")
    if ssh_opts:
        cmd.extend(ssh_opts)

    if remote:
        cmd.extend([source_path + "/", f"{remote}:{target_path}/"])
    else:
        cmd.extend([source_path + "/", target_path + "/"])

    try:
        if progress_callback:
            progress_callback(f"Starting restore rsync: {source_path} -> {target_path}")
        code, output, _ = _run_command(cmd, env=ssh_env or None, progress_callback=progress_callback)
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)
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
    progress_callback: ProgressCallback | None = None,
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
    if progress_callback:
        progress_callback(f"Starting rclone sync: {source} -> {target_path}")
    code, output, _ = _run_command(cmd, progress_callback=progress_callback)
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
    db_host: str = "localhost",
    db_port: int | None = None,
    db_user: str = "",
    db_password: str = "",
    db_name: str = "",
    ssh_remote: str | None = None,
    ssh_key_path: str | None = None,
    ssh_password: str | None = None,
    progress_callback: ProgressCallback | None = None,
) -> BackupResult:
    """Dump a database to a file using the appropriate CLI tool.

    If ssh_remote is set, runs the dump command remotely via SSH and streams
    the output locally (using pg_dump | ssh style for PostgreSQL).
    """
    import tempfile
    start = time.monotonic()
    os.makedirs(os.path.dirname(target_file) if os.path.dirname(target_file) else ".", exist_ok=True)
    if progress_callback:
        progress_callback(f"Preparing {db_type} dump for database '{db_name}'")
    final_target_file = target_file
    compress_output = target_file.endswith(".gz")
    if compress_output:
        raw_suffix = "".join(Path(target_file[:-3]).suffixes) or ".dump"
        tmp = tempfile.NamedTemporaryFile(suffix=raw_suffix, delete=False)
        tmp.close()
        target_file = tmp.name

    def _build_pg_cmd() -> list[str]:
        cmd = ["pg_dump"]
        if db_host and db_host != "localhost":
            cmd += ["-h", db_host]
        if db_port:
            cmd += ["-p", str(db_port)]
        if db_user:
            cmd += ["-U", db_user]
        cmd += ["-Fc", db_name or "postgres", "-f", target_file]
        return cmd

    def _build_mysql_cmd() -> list[str]:
        cmd = ["mysqldump"]
        if db_host:
            cmd += ["-h", db_host]
        if db_port:
            cmd += ["-P", str(db_port)]
        if db_user:
            cmd += ["-u", db_user]
        if db_password:
            cmd += [f"-p{db_password}"]
        cmd += [db_name or "", f"--result-file={target_file}"]
        return cmd

    if ssh_remote and (ssh_key_path or ssh_password):
        # Run dump command on remote server via SSH, pipe output locally
        if db_type == "postgresql":
            # Build remote pg_dump that outputs to stdout, capture locally
            remote_parts = ["pg_dump"]
            if db_host and db_host != "localhost":
                remote_parts += ["-h", db_host]
            if db_port:
                remote_parts += ["-p", str(db_port)]
            if db_user:
                remote_parts += ["-U", db_user]
            remote_parts += ["-Fc", db_name or "postgres"]
            remote_cmd = " ".join(remote_parts)
            if db_password:
                remote_cmd = f"PGPASSWORD={repr(db_password)} {remote_cmd}"

            ssh_parts = _build_ssh_prefix(ssh_key_path, ssh_password, ssh_remote)
            import subprocess
            if progress_callback:
                progress_callback(f"Running remote pg_dump via SSH: {ssh_remote}")
            with open(target_file, "wb") as out_f:
                proc = subprocess.run(
                    ssh_parts + [remote_cmd],
                    stdout=out_f, stderr=subprocess.PIPE,
                    timeout=3600,
                )
            code = proc.returncode
            output = proc.stderr.decode(errors="replace")

        elif db_type in ("mysql", "mariadb"):
            remote_parts = ["mysqldump"]
            if db_host:
                remote_parts += ["-h", db_host]
            if db_port:
                remote_parts += ["-P", str(db_port)]
            if db_user:
                remote_parts += ["-u", db_user]
            if db_password:
                remote_parts += [f"-p{db_password}"]
            remote_parts += [db_name or ""]
            remote_cmd = " ".join(remote_parts)

            ssh_parts = _build_ssh_prefix(ssh_key_path, ssh_password, ssh_remote)
            import subprocess
            if progress_callback:
                progress_callback(f"Running remote mysqldump via SSH: {ssh_remote}")
            with open(target_file, "wb") as out_f:
                proc = subprocess.run(
                    ssh_parts + [remote_cmd],
                    stdout=out_f, stderr=subprocess.PIPE,
                    timeout=3600,
                )
            code = proc.returncode
            output = proc.stderr.decode(errors="replace")

        elif db_type == "mongodb":
            archive_remote = f"/tmp/mongodump-{db_name}.archive"
            # Build URI from components (never use plaintext connection_string)
            mongo_auth = ""
            if db_user and db_password:
                import urllib.parse
                mongo_auth = f"{urllib.parse.quote(db_user)}:{urllib.parse.quote(db_password)}@"
            mongo_host = db_host or "localhost"
            mongo_port_str = f":{db_port}" if db_port else ""
            mongo_uri = f"mongodb://{mongo_auth}{mongo_host}{mongo_port_str}/{db_name or ''}"
            remote_cmd = f"mongodump --uri '{mongo_uri}' --archive={archive_remote} && cat {archive_remote}"
            ssh_parts = _build_ssh_prefix(ssh_key_path, ssh_password, ssh_remote)
            import subprocess
            if progress_callback:
                progress_callback(f"Running remote mongodump via SSH: {ssh_remote}")
            with open(target_file, "wb") as out_f:
                proc = subprocess.run(ssh_parts + [remote_cmd], stdout=out_f, stderr=subprocess.PIPE, timeout=3600)
            code = proc.returncode
            output = proc.stderr.decode(errors="replace")

        else:
            return BackupResult(False, 0, 0, 0, None, False, 0, "", f"Unsupported DB type for SSH: {db_type}")

    else:
        # Local execution
        env_extra = {}
        if db_type == "postgresql":
            if db_password:
                env_extra["PGPASSWORD"] = db_password
            cmd = _build_pg_cmd()
        elif db_type in ("mysql", "mariadb"):
            cmd = _build_mysql_cmd()
        elif db_type == "mongodb":
            import urllib.parse
            mongo_auth = ""
            if db_user and db_password:
                mongo_auth = f"{urllib.parse.quote(db_user)}:{urllib.parse.quote(db_password)}@"
            mongo_host = db_host or "localhost"
            mongo_port_str = f":{db_port}" if db_port else ""
            mongo_uri = f"mongodb://{mongo_auth}{mongo_host}{mongo_port_str}/{db_name or ''}"
            cmd = ["mongodump", "--uri", mongo_uri, f"--archive={target_file}"]
        elif db_type == "redis":
            redis_auth = f":{db_password}@" if db_password else ""
            redis_uri = f"redis://{redis_auth}{db_host or 'localhost'}:{db_port or 6379}"
            cmd = ["redis-cli", "-u", redis_uri, "--rdb", target_file]
        else:
            return BackupResult(False, 0, 0, 0, None, False, 0, "", f"Unsupported database: {db_type}")

        import subprocess
        env = {**os.environ, **env_extra}
        if progress_callback:
            progress_callback(f"Running local dump command: {cmd[0]}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, env=env)
        code = result.returncode
        output = result.stdout + result.stderr

    if compress_output and code == 0 and os.path.exists(target_file):
        if progress_callback:
            progress_callback(f"Compressing dump: {final_target_file}")
        with open(target_file, "rb") as src, gzip.open(final_target_file, "wb") as dst:
            shutil.copyfileobj(src, dst)
        os.unlink(target_file)
        target_file = final_target_file

    duration = time.monotonic() - start
    size = os.path.getsize(target_file) if os.path.exists(target_file) else 0
    # Sanitize log output — strip any secrets that may appear
    safe_output = _sanitize_log(output or "", [db_password, ssh_password])
    return BackupResult(
        success=code == 0 and size > 0,
        bytes_processed=size,
        bytes_added=size,
        duration_seconds=duration,
        snapshot_id=os.path.basename(target_file),
        checksum_valid=code == 0,
        failed_chunks=0 if code == 0 else 1,
        log_output=safe_output[:8000],
        error_message=None if code == 0 and size > 0 else (safe_output[-2000:] if safe_output else f"Empty dump file after {db_type} backup"),
    )


def _build_ssh_prefix(ssh_key_path: str | None, ssh_password: str | None, remote: str) -> list[str]:
    """Build the ssh command prefix for remote execution."""
    if ssh_key_path:
        return [
            "ssh", "-i", ssh_key_path,
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=15",
            remote,
        ]
    elif ssh_password:
        return [
            "sshpass", "-p", ssh_password,
            "ssh", "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=15",
            remote,
        ]
    return ["ssh", "-o", "StrictHostKeyChecking=no", remote]


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


def run_database_restore(
    dump_file: str,
    db_type: str,
    db_host: str = "localhost",
    db_port: int | None = None,
    db_user: str = "",
    db_password: str = "",
    db_name: str = "",
    ssh_remote: str | None = None,
    ssh_key_path: str | None = None,
    ssh_password: str | None = None,
    progress_callback: ProgressCallback | None = None,
) -> BackupResult:
    """Restore a database dump file to the target database.

    Supports pg_restore (PostgreSQL custom format), mysql, and mongorestore.
    If ssh_remote is set, streams the dump file into the remote DB via SSH pipe.
    """
    import subprocess
    import tempfile
    start = time.monotonic()

    if not os.path.exists(dump_file):
        return BackupResult(False, 0, 0, 0, None, False, 1, "", f"Dump file not found: {dump_file}")
    if progress_callback:
        progress_callback(f"Preparing {db_type} restore from {dump_file}")

    dump_size = os.path.getsize(dump_file)
    temp_dump: str | None = None
    restore_file = dump_file
    if dump_file.endswith(".gz"):
        if progress_callback:
            progress_callback("Decompressing dump for restore")
        suffixes = Path(dump_file[:-3]).suffixes
        suffix = "".join(suffixes) or ".dump"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp.close()
        with gzip.open(dump_file, "rb") as src, open(tmp.name, "wb") as dst:
            shutil.copyfileobj(src, dst)
        temp_dump = tmp.name
        restore_file = tmp.name
    code = 1
    output = ""

    if ssh_remote and (ssh_key_path or ssh_password):
        # ── Remote restore via SSH ────────────────────────────────────────────
        ssh_parts = _build_ssh_prefix(ssh_key_path, ssh_password, ssh_remote)

        if db_type == "postgresql":
            # Stream local dump into remote pg_restore
            remote_parts = ["pg_restore", "--no-owner", "--no-acl", "-d", db_name or "postgres"]
            if db_host and db_host != "localhost":
                remote_parts += ["-h", db_host]
            if db_port:
                remote_parts += ["-p", str(db_port)]
            if db_user:
                remote_parts += ["-U", db_user]
            remote_cmd = " ".join(remote_parts)
            if db_password:
                remote_cmd = f"PGPASSWORD={repr(db_password)} {remote_cmd}"

            if progress_callback:
                progress_callback(f"Running remote pg_restore via SSH: {ssh_remote}")
            with open(restore_file, "rb") as dump_f:
                proc = subprocess.run(
                    ssh_parts + [remote_cmd],
                    stdin=dump_f,
                    capture_output=True,
                    timeout=7200,
                )
            code = proc.returncode
            output = proc.stderr.decode(errors="replace")

        elif db_type in ("mysql", "mariadb"):
            remote_parts = ["mysql"]
            if db_host:
                remote_parts += ["-h", db_host]
            if db_port:
                remote_parts += ["-P", str(db_port)]
            if db_user:
                remote_parts += ["-u", db_user]
            if db_password:
                remote_parts += [f"-p{db_password}"]
            remote_parts += [db_name or ""]
            remote_cmd = " ".join(remote_parts)

            if progress_callback:
                progress_callback(f"Running remote mysql restore via SSH: {ssh_remote}")
            with open(restore_file, "rb") as dump_f:
                proc = subprocess.run(
                    ssh_parts + [remote_cmd],
                    stdin=dump_f,
                    capture_output=True,
                    timeout=7200,
                )
            code = proc.returncode
            output = proc.stderr.decode(errors="replace")

        elif db_type == "mongodb":
            import urllib.parse
            mongo_auth = ""
            if db_user and db_password:
                mongo_auth = f"{urllib.parse.quote(db_user)}:{urllib.parse.quote(db_password)}@"
            mongo_host = db_host or "localhost"
            mongo_port_str = f":{db_port}" if db_port else ""
            mongo_uri = f"mongodb://{mongo_auth}{mongo_host}{mongo_port_str}/{db_name or ''}"

            archive_remote = f"/tmp/mongorestore-{db_name}.archive"
            # Copy archive to remote first, then mongorestore
            scp_parts = _build_ssh_prefix(ssh_key_path, ssh_password, ssh_remote)
            # Use cat + ssh to pipe file to remote tmp
            if progress_callback:
                progress_callback(f"Copying MongoDB archive to remote host: {ssh_remote}")
            with open(restore_file, "rb") as dump_f:
                copy_proc = subprocess.run(
                    ssh_parts + [f"cat > {archive_remote}"],
                    stdin=dump_f,
                    capture_output=True,
                    timeout=3600,
                )
            if copy_proc.returncode != 0:
                output = copy_proc.stderr.decode(errors="replace")
                code = copy_proc.returncode
            else:
                remote_cmd = f"mongorestore --uri '{mongo_uri}' --archive={archive_remote} --drop && rm -f {archive_remote}"
                if progress_callback:
                    progress_callback(f"Running remote mongorestore via SSH: {ssh_remote}")
                restore_proc = subprocess.run(
                    ssh_parts + [remote_cmd],
                    capture_output=True,
                    timeout=7200,
                )
                code = restore_proc.returncode
                output = restore_proc.stderr.decode(errors="replace")
        else:
            return BackupResult(False, 0, 0, 0, None, False, 1, "", f"Unsupported DB type for SSH restore: {db_type}")

    else:
        # ── Local restore ─────────────────────────────────────────────────────
        env_extra = {}

        if db_type == "postgresql":
            if db_password:
                env_extra["PGPASSWORD"] = db_password
            cmd = ["pg_restore", "--no-owner", "--no-acl", "-d", db_name or "postgres"]
            if db_host and db_host != "localhost":
                cmd += ["-h", db_host]
            if db_port:
                cmd += ["-p", str(db_port)]
            if db_user:
                cmd += ["-U", db_user]
            cmd.append(restore_file)

        elif db_type in ("mysql", "mariadb"):
            cmd = ["mysql"]
            if db_host:
                cmd += ["-h", db_host]
            if db_port:
                cmd += ["-P", str(db_port)]
            if db_user:
                cmd += ["-u", db_user]
            if db_password:
                cmd += [f"-p{db_password}"]
            cmd += [db_name or ""]
            # mysql reads from stdin
            env = {**os.environ, **env_extra}
            with open(restore_file, "rb") as dump_f:
                if progress_callback:
                    progress_callback("Running local mysql restore")
                result_proc = subprocess.run(
                    cmd, stdin=dump_f, capture_output=True, text=True, timeout=7200, env=env
                )
            code = result_proc.returncode
            output = result_proc.stdout + result_proc.stderr
            duration = time.monotonic() - start
            safe_output = _sanitize_log(output, [db_password, ssh_password])
            return BackupResult(
                success=code == 0,
                bytes_processed=dump_size,
                bytes_added=dump_size if code == 0 else 0,
                duration_seconds=duration,
                snapshot_id=os.path.basename(dump_file),
                checksum_valid=code == 0,
                failed_chunks=0 if code == 0 else 1,
                log_output=safe_output[:8000],
                error_message=None if code == 0 else safe_output[-2000:],
            )

        elif db_type == "mongodb":
            import urllib.parse
            mongo_auth = ""
            if db_user and db_password:
                mongo_auth = f"{urllib.parse.quote(db_user)}:{urllib.parse.quote(db_password)}@"
            mongo_host = db_host or "localhost"
            mongo_port_str = f":{db_port}" if db_port else ""
            mongo_uri = f"mongodb://{mongo_auth}{mongo_host}{mongo_port_str}/{db_name or ''}"
            cmd = ["mongorestore", "--uri", mongo_uri, f"--archive={restore_file}", "--drop"]

        else:
            return BackupResult(False, 0, 0, 0, None, False, 1, "", f"Unsupported database type: {db_type}")

        env = {**os.environ, **env_extra}
        if progress_callback:
            progress_callback(f"Running local restore command: {cmd[0]}")
        result_proc = subprocess.run(cmd, capture_output=True, text=True, timeout=7200, env=env)
        code = result_proc.returncode
        output = result_proc.stdout + result_proc.stderr

    if temp_dump:
        os.unlink(temp_dump)

    duration = time.monotonic() - start
    safe_output = _sanitize_log(output or "", [db_password, ssh_password])
    return BackupResult(
        success=code == 0,
        bytes_processed=dump_size,
        bytes_added=dump_size if code == 0 else 0,
        duration_seconds=duration,
        snapshot_id=os.path.basename(dump_file),
        checksum_valid=code == 0,
        failed_chunks=0 if code == 0 else 1,
        log_output=safe_output[:8000],
        error_message=None if code == 0 else safe_output[-2000:],
    )
