import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Alert, AlertSeverity
from app.services.email_service import send_alert_email


async def create_alert(
    db: AsyncSession,
    organization_id: uuid.UUID,
    title: str,
    message: str,
    alert_type: str,
    severity: AlertSeverity = AlertSeverity.INFO,
    metadata: dict[str, Any] | None = None,
    notify_email: bool = True,
    recipient_emails: list[str] | None = None,
) -> Alert:
    alert = Alert(
        organization_id=organization_id,
        title=title,
        message=message,
        alert_type=alert_type,
        severity=severity,
        metadata_json=metadata or {},
    )
    db.add(alert)
    await db.flush()

    if notify_email and recipient_emails:
        sent = await send_alert_email(recipient_emails, title, message, severity.value)
        alert.email_sent = sent
        await db.flush()

    return alert
