import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.entities import (
    Alert,
    AlertSeverity,
    AuditLog,
    Backup,
    BackupRun,
    Incident,
    IncidentEvent,
    IncidentRecommendation,
    IncidentReport,
    JobStatus,
    MetricSnapshot,
    SecurityFinding,
    Server,
    ServerStatus,
    StorageUsage,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _severity_from_disk(disk_percent: float | None) -> str:
    if disk_percent is None:
        return "warning"
    if disk_percent >= 95:
        return "critical"
    if disk_percent >= 90:
        return "error"
    return "warning"


def _classify_backup_failure(error: str | None, disk_percent: float | None) -> tuple[str, str, str]:
    text = (error or "").lower()
    if disk_percent and disk_percent >= 90:
        return (
            _severity_from_disk(disk_percent),
            "Destination or server disk usage is critically high.",
            "Free storage, rotate old backups, then retry the failed run.",
        )
    if any(term in text for term in ["permission denied", "auth", "authentication", "publickey"]):
        return ("error", "The backup failed because server authentication or file permissions were rejected.", "Check SSH credentials, file permissions, and stored credentials before retrying.")
    if any(term in text for term in ["timeout", "timed out", "connection", "network", "unreachable"]):
        return ("error", "The backup failed because the server or network connection was unstable.", "Run an SSH connectivity check, then retry with a larger timeout or lower-traffic schedule.")
    if any(term in text for term in ["no space", "disk full", "quota"]):
        return ("critical", "The backup failed because storage is full or quota-limited.", "Clean old backups or expand storage before retrying.")
    return ("warning", "The backup job failed and needs review of the captured error message.", "Review the failed job details, run a preflight check, then retry if the server is healthy.")


async def _latest_metric(db: AsyncSession, server_id: uuid.UUID | None) -> MetricSnapshot | None:
    if not server_id:
        return None
    result = await db.execute(
        select(MetricSnapshot)
        .where(MetricSnapshot.server_id == server_id)
        .order_by(MetricSnapshot.recorded_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _upsert_incident(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    fingerprint: str,
    title: str,
    incident_type: str,
    severity: str,
    root_cause_summary: str,
    impact_summary: str,
    event_title: str,
    event_message: str,
    server_id: uuid.UUID | None = None,
    backup_id: uuid.UUID | None = None,
    backup_run_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
    recommendations: list[dict[str, Any]] | None = None,
) -> Incident:
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.recommendations))
        .where(
            Incident.organization_id == organization_id,
            Incident.fingerprint == fingerprint,
            Incident.status != "resolved",
        )
        .limit(1)
    )
    incident = result.scalar_one_or_none()
    if incident:
        incident.last_seen_at = _now()
        incident.severity = severity
        incident.root_cause_summary = root_cause_summary
        incident.impact_summary = impact_summary
        incident.metadata_json = {**(incident.metadata_json or {}), **(metadata or {})}
    else:
        incident = Incident(
            organization_id=organization_id,
            server_id=server_id,
            backup_id=backup_id,
            backup_run_id=backup_run_id,
            title=title,
            incident_type=incident_type,
            severity=severity,
            status="open",
            fingerprint=fingerprint,
            root_cause_summary=root_cause_summary,
            impact_summary=impact_summary,
            metadata_json=metadata or {},
        )
        db.add(incident)
        await db.flush()

    db.add(
        IncidentEvent(
            incident_id=incident.id,
            event_type=incident_type,
            title=event_title,
            message=event_message,
            metadata_json=metadata or {},
        )
    )

    existing_actions = {r.action_type for r in incident.recommendations}
    for rec in recommendations or []:
        if rec["action_type"] in existing_actions:
            continue
        db.add(
            IncidentRecommendation(
                incident_id=incident.id,
                title=rec["title"],
                description=rec.get("description"),
                action_type=rec["action_type"],
                risk_level=rec.get("risk_level", "low"),
                payload_json=rec.get("payload_json", {}),
            )
        )
    await db.flush()
    return incident


async def sync_incidents(db: AsyncSession, organization_id: uuid.UUID) -> None:
    since = _now() - timedelta(days=14)
    failed_runs = await db.execute(
        select(BackupRun, Backup)
        .join(Backup, BackupRun.backup_id == Backup.id)
        .where(
            Backup.organization_id == organization_id,
            BackupRun.status == JobStatus.FAILED,
            BackupRun.started_at >= since,
        )
        .order_by(BackupRun.started_at.desc())
        .limit(50)
    )
    for run, backup in failed_runs.all():
        metric = await _latest_metric(db, backup.server_id)
        disk = metric.disk_percent if metric else None
        severity, cause, fix = _classify_backup_failure(run.error_message, disk)
        await _upsert_incident(
            db,
            organization_id=organization_id,
            fingerprint=f"backup-failure:{backup.id}",
            title=f"Backup failed: {backup.name}",
            incident_type="backup_failure",
            severity=severity,
            root_cause_summary=cause,
            impact_summary="The latest protected data point may be older than expected until this backup succeeds.",
            event_title="Backup run failed",
            event_message=run.error_message or "Backup run failed without a detailed error message.",
            server_id=backup.server_id,
            backup_id=backup.id,
            backup_run_id=run.id,
            metadata={
                "backup_name": backup.name,
                "run_id": str(run.id),
                "disk_percent": disk,
                "failed_at": run.started_at.isoformat() if run.started_at else None,
            },
            recommendations=[
                {"title": "Retry failed backup", "description": fix, "action_type": "retry_backup", "risk_level": "low", "payload_json": {"backup_id": str(backup.id), "run_id": str(run.id)}},
                {"title": "Run preflight check", "description": "Validate connectivity, disk headroom, and backup paths before another run.", "action_type": "preflight_check", "risk_level": "low", "payload_json": {"backup_id": str(backup.id), "server_id": str(backup.server_id) if backup.server_id else None}},
            ],
        )

    servers = await db.execute(select(Server).where(Server.organization_id == organization_id))
    for server in servers.scalars().all():
        metric = await _latest_metric(db, server.id)
        if server.status in {ServerStatus.OFFLINE, ServerStatus.ERROR}:
            await _upsert_incident(
                db,
                organization_id=organization_id,
                fingerprint=f"server-unavailable:{server.id}",
                title=f"Server unavailable: {server.name}",
                incident_type="server_unavailable",
                severity="critical" if server.status == ServerStatus.ERROR else "error",
                root_cause_summary="The server is not reporting as healthy to the control plane.",
                impact_summary="Backups and repair actions that depend on this server may fail.",
                event_title="Server health degraded",
                event_message=f"Server status is {server.status.value}.",
                server_id=server.id,
                metadata={"hostname": server.hostname, "last_seen_at": server.last_seen_at.isoformat() if server.last_seen_at else None},
                recommendations=[
                    {"title": "Run SSH connectivity check", "description": "Confirm the control plane can reach the server and authenticate.", "action_type": "ssh_check", "risk_level": "low", "payload_json": {"server_id": str(server.id)}},
                ],
            )
        if metric and metric.disk_percent and metric.disk_percent >= 85:
            await _upsert_incident(
                db,
                organization_id=organization_id,
                fingerprint=f"disk-pressure:{server.id}",
                title=f"Disk pressure: {server.name}",
                incident_type="disk_pressure",
                severity=_severity_from_disk(metric.disk_percent),
                root_cause_summary=f"Disk usage is {metric.disk_percent:.1f}%, which can cause backups and restores to fail.",
                impact_summary="Storage pressure increases the chance of failed backups, partial snapshots, and service instability.",
                event_title="High disk usage detected",
                event_message=f"Latest disk usage is {metric.disk_percent:.1f}%.",
                server_id=server.id,
                metadata={"disk_percent": metric.disk_percent, "recorded_at": metric.recorded_at.isoformat()},
                recommendations=[
                    {"title": "Cleanup old backups", "description": "Apply retention cleanup or move older backup artifacts to colder storage.", "action_type": "cleanup_backups", "risk_level": "medium", "payload_json": {"server_id": str(server.id)}},
                ],
            )


async def list_incidents(db: AsyncSession, organization_id: uuid.UUID) -> list[Incident]:
    await sync_incidents(db, organization_id)
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.events), selectinload(Incident.recommendations))
        .where(Incident.organization_id == organization_id)
        .order_by(Incident.last_seen_at.desc())
        .limit(100)
    )
    return list(result.scalars().unique().all())


async def get_incident(db: AsyncSession, organization_id: uuid.UUID, incident_id: uuid.UUID) -> Incident | None:
    await sync_incidents(db, organization_id)
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.events), selectinload(Incident.recommendations))
        .where(Incident.id == incident_id, Incident.organization_id == organization_id)
    )
    return result.scalar_one_or_none()


async def reliability_summary(db: AsyncSession, organization_id: uuid.UUID) -> dict[str, Any]:
    await sync_incidents(db, organization_id)
    now = _now()

    async def success_rate(days: int) -> float:
        since = now - timedelta(days=days)
        rows = await db.execute(
            select(BackupRun.status)
            .join(Backup, BackupRun.backup_id == Backup.id)
            .where(Backup.organization_id == organization_id, BackupRun.started_at >= since)
        )
        statuses = list(rows.scalars().all())
        if not statuses:
            return 100.0
        success = sum(1 for s in statuses if s == JobStatus.COMPLETED)
        return round(success / len(statuses) * 100, 1)

    failed_24h = await db.scalar(
        select(func.count(BackupRun.id))
        .join(Backup, BackupRun.backup_id == Backup.id)
        .where(
            Backup.organization_id == organization_id,
            BackupRun.status == JobStatus.FAILED,
            BackupRun.started_at >= now - timedelta(hours=24),
        )
    )
    active_incidents = await db.scalar(select(func.count(Incident.id)).where(Incident.organization_id == organization_id, Incident.status != "resolved"))
    critical_incidents = await db.scalar(select(func.count(Incident.id)).where(Incident.organization_id == organization_id, Incident.status != "resolved", Incident.severity == "critical"))
    last_success = await db.scalar(
        select(func.max(BackupRun.completed_at))
        .join(Backup, BackupRun.backup_id == Backup.id)
        .where(Backup.organization_id == organization_id, BackupRun.status == JobStatus.COMPLETED)
    )

    servers_result = await db.execute(select(Server).where(Server.organization_id == organization_id))
    risky_servers = []
    for s in servers_result.scalars().all():
        metric = await _latest_metric(db, s.id)
        reasons = []
        if s.status != ServerStatus.ONLINE:
            reasons.append(f"status {s.status.value}")
        if metric and metric.disk_percent and metric.disk_percent >= 85:
            reasons.append(f"disk {metric.disk_percent:.1f}%")
        if reasons:
            risky_servers.append({"id": str(s.id), "name": s.name, "hostname": s.hostname, "status": s.status.value, "reasons": reasons})

    backups_result = await db.execute(select(Backup).where(Backup.organization_id == organization_id, Backup.is_active == True))
    risky_backups = [
        {"id": str(b.id), "name": b.name, "health_score": b.health_score, "risk_level": b.risk_level}
        for b in backups_result.scalars().all()
        if b.health_score < 75 or b.risk_level in {"high", "critical"}
    ]

    storage_rows = await db.execute(
        select(StorageUsage)
        .where(StorageUsage.organization_id == organization_id)
        .order_by(StorageUsage.recorded_at.desc())
        .limit(14)
    )
    storage = list(storage_rows.scalars().all())
    latest_storage = storage[0] if storage else None
    quota_gb = (latest_storage.total_bytes / 1024**3) if latest_storage and latest_storage.total_bytes else 100.0
    used_gb = (latest_storage.used_bytes / 1024**3) if latest_storage else 0.0
    forecast_days = None
    if len(storage) >= 2:
        newest, oldest = storage[0], storage[-1]
        elapsed = max((newest.recorded_at - oldest.recorded_at).total_seconds() / 86400, 0.01)
        growth_per_day = (newest.used_bytes - oldest.used_bytes) / elapsed
        if growth_per_day > 0 and newest.total_bytes > newest.used_bytes:
            forecast_days = round((newest.total_bytes - newest.used_bytes) / growth_per_day, 1)

    rate24 = await success_rate(1)
    rate7 = await success_rate(7)
    rate30 = await success_rate(30)
    age_hours = round((now - last_success).total_seconds() / 3600, 1) if last_success else None
    slo_score = max(0.0, min(100.0, rate30 - (active_incidents or 0) * 4 - (critical_incidents or 0) * 10 - len(risky_servers) * 3))
    return {
        "slo_score": round(slo_score, 1),
        "backup_success_rate_24h": rate24,
        "backup_success_rate_7d": rate7,
        "backup_success_rate_30d": rate30,
        "failed_jobs_24h": int(failed_24h or 0),
        "active_incidents": int(active_incidents or 0),
        "critical_incidents": int(critical_incidents or 0),
        "last_successful_backup_at": last_success,
        "last_successful_backup_age_hours": age_hours,
        "rpo_status": "breached" if age_hours is None or age_hours > 24 else "healthy",
        "rto_status": "at_risk" if critical_incidents else "healthy",
        "storage_used_gb": round(used_gb, 2),
        "storage_quota_gb": round(quota_gb, 2),
        "storage_forecast_days": forecast_days,
        "risky_servers": risky_servers,
        "risky_backups": risky_backups,
    }


async def generate_security_findings(db: AsyncSession, organization_id: uuid.UUID) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    servers = await db.execute(select(Server).where(Server.organization_id == organization_id))
    for s in servers.scalars().all():
        if s.auth_method == "password":
            findings.append({
                "finding_key": f"server-password-auth:{s.id}",
                "title": f"Password SSH enabled on {s.name}",
                "description": "Password-based SSH is easier to brute-force and harder to rotate safely than key-based access.",
                "severity": "medium",
                "resource_type": "server",
                "resource_id": str(s.id),
                "recommendation": "Move this server to private-key authentication and rotate the stored password.",
            })
    backups = await db.execute(select(Backup).where(Backup.organization_id == organization_id, Backup.is_active == True))
    for b in backups.scalars().all():
        if not b.encryption:
            findings.append({
                "finding_key": f"backup-encryption-disabled:{b.id}",
                "title": f"Backup encryption disabled: {b.name}",
                "description": "Backup artifacts can contain production data and should be encrypted at rest.",
                "severity": "high",
                "resource_type": "backup",
                "resource_id": str(b.id),
                "recommendation": "Enable encryption on this backup profile and rotate old unencrypted artifacts where possible.",
            })
    unresolved_critical = await db.scalar(select(func.count(Alert.id)).where(Alert.organization_id == organization_id, Alert.is_resolved == False, Alert.severity.in_([AlertSeverity.CRITICAL, AlertSeverity.ERROR])))
    if unresolved_critical:
        findings.append({
            "finding_key": "unresolved-critical-alerts",
            "title": "Critical alerts are unresolved",
            "description": f"{unresolved_critical} critical/error alerts are still open.",
            "severity": "medium",
            "resource_type": "alert",
            "recommendation": "Triage and resolve critical alerts, or convert repeated ones into incidents.",
        })
    audit_count = await db.scalar(select(func.count(AuditLog.id)).where(AuditLog.organization_id == organization_id))
    if not audit_count:
        findings.append({
            "finding_key": "missing-audit-activity",
            "title": "No audit activity recorded",
            "description": "Production repair and security actions should leave an audit trail.",
            "severity": "low",
            "resource_type": "audit",
            "recommendation": "Verify audit logging is enabled for privileged actions.",
        })
    return findings


async def security_posture(db: AsyncSession, organization_id: uuid.UUID) -> dict[str, Any]:
    generated = await generate_security_findings(db, organization_id)
    now = _now()
    persisted: list[SecurityFinding] = []
    for item in generated:
        result = await db.execute(
            select(SecurityFinding).where(
                SecurityFinding.organization_id == organization_id,
                SecurityFinding.finding_key == item["finding_key"],
            )
        )
        finding = result.scalar_one_or_none()
        if finding:
            if finding.status != "dismissed":
                finding.title = item["title"]
                finding.description = item["description"]
                finding.severity = item["severity"]
                finding.resource_type = item.get("resource_type")
                finding.resource_id = item.get("resource_id")
                finding.recommendation = item.get("recommendation")
                finding.last_seen_at = now
            persisted.append(finding)
        else:
            finding = SecurityFinding(organization_id=organization_id, status="open", metadata_json={}, **item)
            db.add(finding)
            persisted.append(finding)
    await db.flush()
    open_findings = [f for f in persisted if f.status == "open"]
    high = sum(1 for f in open_findings if f.severity == "high")
    medium = sum(1 for f in open_findings if f.severity == "medium")
    low = sum(1 for f in open_findings if f.severity == "low")
    score = max(0.0, 100.0 - high * 18 - medium * 9 - low * 4)
    return {"score": round(score, 1), "high_count": high, "medium_count": medium, "low_count": low, "open_findings": len(open_findings), "findings": persisted}


async def build_incident_report(db: AsyncSession, incident: Incident, user_id: uuid.UUID | None) -> IncidentReport:
    timeline = [
        {"time": e.created_at.isoformat(), "title": e.title, "message": e.message, "type": e.event_type}
        for e in sorted(incident.events, key=lambda item: item.created_at)
    ]
    actions = [
        {"title": r.title, "status": r.status, "action_type": r.action_type, "result": r.result_message}
        for r in incident.recommendations
    ]
    summary = (
        f"{incident.title}\n\n"
        f"Severity: {incident.severity}\n"
        f"Status: {incident.status}\n"
        f"Root cause: {incident.root_cause_summary or 'Unknown'}\n"
        f"Impact: {incident.impact_summary or 'Impact not assessed'}\n"
        f"Events captured: {len(timeline)}\n"
        f"Recommended actions: {len(actions)}"
    )
    report = IncidentReport(incident_id=incident.id, summary=summary, timeline_json=timeline, actions_json=actions, created_by_id=user_id)
    db.add(report)
    await db.flush()
    return report
