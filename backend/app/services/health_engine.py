from dataclasses import dataclass
from datetime import datetime, timezone

from app.models.entities import BackupRun, JobStatus

_EPOCH = datetime.min.replace(tzinfo=timezone.utc)


@dataclass
class HealthAssessment:
    health_score: float
    restore_confidence: float
    risk_level: str
    corruption_probability: float
    factors: dict


def calculate_backup_health(
    runs: list[BackupRun],
    checksum_failures: int = 0,
    storage_consistency: float = 1.0,
    restore_test_passed: bool | None = None,
) -> HealthAssessment:
    if not runs:
        return HealthAssessment(50.0, 50.0, "medium", 0.3, {"reason": "no_backup_history"})

    completed = [r for r in runs if r.status == JobStatus.COMPLETED]
    failed = [r for r in runs if r.status == JobStatus.FAILED]
    total = len(runs)
    success_rate = len(completed) / total if total else 0

    recent_runs = sorted(runs, key=lambda r: r.started_at or r.completed_at or _EPOCH, reverse=True)[:10]
    recent_failures = sum(1 for r in recent_runs if r.status == JobStatus.FAILED)
    recent_failure_rate = recent_failures / len(recent_runs) if recent_runs else 0

    avg_failed_chunks = sum(r.failed_chunks for r in completed) / len(completed) if completed else 0
    checksum_valid_rate = (
        sum(1 for r in completed if r.checksum_valid) / len(completed) if completed else 1.0
    )

    health = 100.0
    health -= (1 - success_rate) * 40
    health -= recent_failure_rate * 25
    health -= min(avg_failed_chunks * 5, 20)
    health -= (1 - checksum_valid_rate) * 20
    health -= checksum_failures * 10
    health *= storage_consistency
    health = max(0, min(100, health))

    restore_conf = health * 0.7 + checksum_valid_rate * 20
    if restore_test_passed is True:
        restore_conf = min(100, restore_conf + 15)
    elif restore_test_passed is False:
        restore_conf = max(0, restore_conf - 30)
    restore_conf = max(0, min(100, restore_conf))

    corruption_prob = 0.0
    corruption_prob += (1 - checksum_valid_rate) * 0.4
    corruption_prob += recent_failure_rate * 0.3
    corruption_prob += min(avg_failed_chunks * 0.05, 0.2)
    corruption_prob += checksum_failures * 0.1
    corruption_prob += (1 - storage_consistency) * 0.2
    corruption_prob = max(0, min(1, corruption_prob))

    if health >= 80 and corruption_prob < 0.15:
        risk = "low"
    elif health >= 50 and corruption_prob < 0.4:
        risk = "medium"
    elif health >= 25:
        risk = "high"
    else:
        risk = "critical"

    return HealthAssessment(
        health_score=round(health, 2),
        restore_confidence=round(restore_conf, 2),
        risk_level=risk,
        corruption_probability=round(corruption_prob, 4),
        factors={
            "success_rate": round(success_rate, 4),
            "recent_failure_rate": round(recent_failure_rate, 4),
            "checksum_valid_rate": round(checksum_valid_rate, 4),
            "avg_failed_chunks": avg_failed_chunks,
            "total_runs": total,
            "failed_runs": len(failed),
        },
    )


def analyze_restore_readiness(
    health: HealthAssessment,
    backup_size_bytes: int,
    target_exists: bool,
    overwrite_protection: bool,
) -> dict:
    warnings = []
    risks = []

    if health.corruption_probability > 0.3:
        risks.append("Elevated corruption probability detected in backup history")
    if health.restore_confidence < 60:
        risks.append("Low restore confidence score - verify backup integrity before proceeding")
    if health.risk_level in ("high", "critical"):
        risks.append(f"Backup risk level is {health.risk_level}")
    if target_exists and overwrite_protection:
        warnings.append("Target path exists and overwrite protection is enabled")
    if backup_size_bytes > 100 * 1024**3:
        warnings.append("Large backup size - restore may take significant time")

    estimated_seconds = max(60, backup_size_bytes / (50 * 1024 * 1024))

    return {
        "restore_confidence": health.restore_confidence,
        "estimated_duration_seconds": round(estimated_seconds, 1),
        "dependency_warnings": warnings,
        "corruption_risks": risks,
        "health_score": health.health_score,
        "risk_level": health.risk_level,
    }
