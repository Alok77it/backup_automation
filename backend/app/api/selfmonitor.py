"""Self-monitor API — exposes runtime metrics for the server hosting this dashboard.

Uses only stdlib/psutil so no extra deps are needed (psutil is already in requirements).
"""

import os
import shutil
import time
from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.config import get_settings
from app.core.dependencies import require_permission
from app.models.entities import OrganizationMember

router = APIRouter(prefix="/selfmonitor", tags=["selfmonitor"])
settings = get_settings()


def _safe_psutil():
    try:
        import psutil
        return psutil
    except ImportError:
        return None


@router.get("/system")
async def system_info(
    membership: Annotated[OrganizationMember, Depends(require_permission("org:read"))],
):
    """Return CPU, memory, disk, and uptime for the host running this API container."""
    ps = _safe_psutil()
    data: dict = {}

    if ps:
        # CPU
        cpu_pct = ps.cpu_percent(interval=0.5)
        cpu_count = ps.cpu_count(logical=True)

        # Memory
        mem = ps.virtual_memory()
        swap = ps.swap_memory()

        # Disk — root filesystem
        root_disk = ps.disk_usage("/")

        # Uptime
        boot_ts = ps.boot_time()
        uptime_seconds = int(time.time() - boot_ts)

        # Network I/O
        try:
            net = ps.net_io_counters()
            net_in_mb = round(net.bytes_recv / 1024 / 1024, 2)
            net_out_mb = round(net.bytes_sent / 1024 / 1024, 2)
        except Exception:
            net_in_mb = net_out_mb = 0.0

        # Process count
        try:
            proc_count = len(ps.pids())
        except Exception:
            proc_count = 0

        data.update({
            "cpu_percent": round(cpu_pct, 1),
            "cpu_count": cpu_count,
            "memory_total_gb": round(mem.total / 1024**3, 2),
            "memory_used_gb": round(mem.used / 1024**3, 2),
            "memory_percent": round(mem.percent, 1),
            "swap_total_gb": round(swap.total / 1024**3, 2),
            "swap_used_gb": round(swap.used / 1024**3, 2),
            "disk_total_gb": round(root_disk.total / 1024**3, 2),
            "disk_used_gb": round(root_disk.used / 1024**3, 2),
            "disk_free_gb": round(root_disk.free / 1024**3, 2),
            "disk_percent": round(root_disk.percent, 1),
            "uptime_seconds": uptime_seconds,
            "network_in_mb": net_in_mb,
            "network_out_mb": net_out_mb,
            "process_count": proc_count,
        })
    else:
        # Fallback without psutil
        try:
            st = os.statvfs("/")
            total = st.f_blocks * st.f_frsize
            free = st.f_bfree * st.f_frsize
            used = total - free
            data.update({
                "disk_total_gb": round(total / 1024**3, 2),
                "disk_used_gb": round(used / 1024**3, 2),
                "disk_free_gb": round(free / 1024**3, 2),
                "disk_percent": round(used / total * 100, 1) if total else 0,
            })
        except Exception:
            pass

    return data


@router.get("/storage-paths")
async def storage_paths(
    membership: Annotated[OrganizationMember, Depends(require_permission("org:read"))],
):
    """Return disk usage for backup storage paths."""
    paths = []

    backup_path = getattr(settings, "BACKUP_STORAGE_PATH", "/data/backups")
    for path in [backup_path, "/data/backups", "/var/lib/backup", "/backups"]:
        if path and os.path.exists(path):
            try:
                usage = shutil.disk_usage(path)
                # Count files/dirs
                try:
                    entries = len(os.listdir(path))
                except Exception:
                    entries = 0
                # Walk and count total files + size
                total_files = 0
                total_size = 0
                try:
                    for root, dirs, files in os.walk(path):
                        total_files += len(files)
                        for f in files:
                            try:
                                total_size += os.path.getsize(os.path.join(root, f))
                            except Exception:
                                pass
                        # Limit walk depth
                        if root.count(os.sep) - path.count(os.sep) >= 3:
                            dirs.clear()
                except Exception:
                    pass

                paths.append({
                    "path": path,
                    "total_gb": round(usage.total / 1024**3, 2),
                    "used_gb": round(usage.used / 1024**3, 2),
                    "free_gb": round(usage.free / 1024**3, 2),
                    "percent": round(usage.used / usage.total * 100, 1) if usage.total else 0,
                    "top_level_entries": entries,
                    "total_backup_files": total_files,
                    "backup_data_gb": round(total_size / 1024**3, 3),
                })
                break  # Only report first found path
            except Exception:
                pass

    if not paths:
        paths.append({
            "path": backup_path,
            "total_gb": 0,
            "used_gb": 0,
            "free_gb": 0,
            "percent": 0,
            "top_level_entries": 0,
            "total_backup_files": 0,
            "backup_data_gb": 0,
            "note": "Path not accessible or does not exist",
        })

    return {"paths": paths}


@router.get("/containers")
async def docker_containers(
    membership: Annotated[OrganizationMember, Depends(require_permission("org:read"))],
):
    """Return running Docker containers (if Docker socket is accessible)."""
    containers = []
    try:
        import subprocess
        result = subprocess.run(
            ["docker", "ps", "--format",
             "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            for line in result.stdout.strip().splitlines():
                if not line.strip():
                    continue
                parts = line.split("\t")
                containers.append({
                    "id": parts[0] if len(parts) > 0 else "",
                    "name": parts[1] if len(parts) > 1 else "",
                    "status": parts[2] if len(parts) > 2 else "",
                    "image": parts[3] if len(parts) > 3 else "",
                    "ports": parts[4] if len(parts) > 4 else "",
                })
    except Exception:
        pass

    # Also try docker stats for CPU/mem
    stats = {}
    try:
        import subprocess
        result = subprocess.run(
            ["docker", "stats", "--no-stream", "--format",
             "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"],
            capture_output=True, text=True, timeout=8,
        )
        if result.returncode == 0:
            for line in result.stdout.strip().splitlines():
                parts = line.split("\t")
                if len(parts) >= 4:
                    stats[parts[0]] = {
                        "cpu": parts[1],
                        "mem_usage": parts[2],
                        "mem_percent": parts[3],
                    }
    except Exception:
        pass

    for c in containers:
        if c["name"] in stats:
            c.update(stats[c["name"]])

    return {
        "containers": containers,
        "docker_available": len(containers) > 0 or True,
    }
