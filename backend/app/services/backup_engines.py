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


def run_restic_backup(
    repo_path: str,
    source_paths: list[str],
    password: str,
    backup_type: str = "full",
    tags: list[str] | None = None,
) -> BackupResult:
    start = time.monotonic()
    repo = f"local:{repo_path}"
    os.makedirs(repo_path, exist_ok=True)
    env = {"RESTIC_PASSWORD": password}
    init_code, init_out, _ = _run_command(["restic", "-r", repo, "init"], env=env)
    if init_code not in (0, 1):
        return BackupResult(False, 0, 0, 0, None, False, 0, init_out, "Restic init failed")

    cmd = ["restic", "-r", repo, "backup", "--json"]
    if tags:
        for t in tags:
            cmd.extend(["--tag", t])
    if backup_type == "incremental":
        cmd.append("--incremental")
    cmd.extend(source_paths)

    code, output, _ = _run_command(cmd, env=env)
    duration = time.monotonic() - start
    snapshot_id = None
    bytes_added = 0
    bytes_processed = 0
    if '"snapshot_id"' in output or '"id"' in output:
        import json

        for line in output.splitlines():
            if line.strip().startswith("{"):
                try:
                    data = json.loads(line)
                    if "id" in data:
                        snapshot_id = data["id"]
                    if "data_added" in data:
                        bytes_added = int(data["data_added"])
                    if "total_files_processed" in data:
                        bytes_processed = int(data.get("total_bytes_processed", bytes_added))
                except json.JSONDecodeError:
                    pass

    return BackupResult(
        success=code == 0,
        bytes_processed=bytes_processed,
        bytes_added=bytes_added,
        duration_seconds=duration,
        snapshot_id=snapshot_id,
        checksum_valid=code == 0,
        failed_chunks=0 if code == 0 else 1,
        log_output=output,
        error_message=None if code == 0 else output[-2000:],
    )


def run_rsync_backup(
    source_paths: list[str],
    target_path: str,
    backup_type: str = "full",
    compression: bool = True,
    remote: str | None = None,
) -> BackupResult:
    start = time.monotonic()
    os.makedirs(target_path, exist_ok=True)
    total_added = 0
    logs = []
    success = True

    for src in source_paths:
        dest = os.path.join(target_path, Path(src).name)
        cmd = ["rsync", "-a", "--stats"]
        if compression:
            cmd.append("-z")
        if backup_type == "incremental":
            cmd.extend(["--link-dest", target_path + "/latest"])
        if remote:
            cmd.extend([f"{remote}:{src}", dest])
        else:
            cmd.extend([src + "/", dest + "/"])
        code, output, err = _run_command(cmd)
        logs.append(output + err)
        if code != 0:
            success = False
        for line in output.splitlines():
            if "Total file size" in line:
                try:
                    total_added += int(line.split()[-1].replace(",", ""))
                except ValueError:
                    pass

    latest_link = os.path.join(target_path, "latest")
    if success and source_paths:
        if os.path.islink(latest_link):
            os.unlink(latest_link)
        os.symlink(os.path.join(target_path, Path(source_paths[0]).name), latest_link, target_is_directory=True)

    duration = time.monotonic() - start
    return BackupResult(
        success=success,
        bytes_processed=total_added,
        bytes_added=total_added,
        duration_seconds=duration,
        snapshot_id=f"rsync-{int(start)}",
        checksum_valid=success,
        failed_chunks=0 if success else 1,
        log_output="\n".join(logs),
        error_message=None if success else "\n".join(logs)[-2000:],
    )


def run_rclone_backup(
    source: str,
    target_path: str,
    config_extra: dict | None = None,
) -> BackupResult:
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


def run_borg_backup(
    repo_path: str,
    source_paths: list[str],
    passphrase: str,
    backup_name: str | None = None,
) -> BackupResult:
    start = time.monotonic()
    os.makedirs(repo_path, exist_ok=True)
    env = {"BORG_PASSPHRASE": passphrase}
    init_code, init_out, _ = _run_command(["borg", "init", "--encryption=repokey", repo_path], env=env)
    if init_code not in (0, 2):
        return BackupResult(False, 0, 0, 0, None, False, 0, init_out, "Borg init failed")

    archive = backup_name or f"backup-{int(start)}"
    cmd = ["borg", "create", "--stats", f"{repo_path}::{archive}"]
    cmd.extend(source_paths)
    code, output, _ = _run_command(cmd, env=env)
    duration = time.monotonic() - start
    bytes_added = 0
    for line in output.splitlines():
        if "Original size" in line:
            try:
                bytes_added = int(line.split()[-2].replace(",", ""))
            except (ValueError, IndexError):
                pass
    return BackupResult(
        success=code == 0,
        bytes_processed=bytes_added,
        bytes_added=bytes_added,
        duration_seconds=duration,
        snapshot_id=archive,
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
    start = time.monotonic()
    os.makedirs(target_path, exist_ok=True)
    logs = []
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
                    if vol:
                        vol_path = os.path.join(target_path, f"{cid}-vol-{vol}.tar")
                        vc, vo, _ = _run_command(
                            [
                                "docker",
                                "run",
                                "--rm",
                                "-v",
                                f"{vol}:/data",
                                "-v",
                                f"{target_path}:/backup",
                                "alpine",
                                "tar",
                                "cf",
                                f"/backup/{cid}-vol-{vol}.tar",
                                "/data",
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


def restore_restic(repo_path: str, snapshot_id: str, target_path: str, password: str) -> BackupResult:
    start = time.monotonic()
    repo = f"local:{repo_path}"
    env = {"RESTIC_PASSWORD": password}
    os.makedirs(target_path, exist_ok=True)
    code, output, _ = _run_command(
        ["restic", "-r", repo, "restore", snapshot_id, "--target", target_path],
        env=env,
    )
    duration = time.monotonic() - start
    return BackupResult(
        success=code == 0,
        bytes_processed=0,
        bytes_added=0,
        duration_seconds=duration,
        snapshot_id=snapshot_id,
        checksum_valid=code == 0,
        failed_chunks=0,
        log_output=output,
        error_message=None if code == 0 else output[-2000:],
    )


def verify_restic_integrity(repo_path: str, password: str) -> tuple[bool, str]:
    repo = f"local:{repo_path}"
    env = {"RESTIC_PASSWORD": password}
    code, output, _ = _run_command(["restic", "-r", repo, "check"], env=env, timeout=7200)
    return code == 0, output
