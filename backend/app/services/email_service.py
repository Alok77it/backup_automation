import logging

import aiosmtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


async def send_email(to_addresses: list[str], subject: str, html_body: str, text_body: str | None = None) -> bool:
    if not to_addresses:
        return False
    message = MIMEMultipart("alternative")
    message["From"] = settings.SMTP_FROM
    message["To"] = ", ".join(to_addresses)
    message["Subject"] = subject
    if text_body:
        message.attach(MIMEText(text_body, "plain"))
    message.attach(MIMEText(html_body, "html"))
    try:
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER or None,
            password=settings.SMTP_PASSWORD or None,
            use_tls=settings.SMTP_TLS,
        )
        return True
    except Exception as e:
        logger.warning("Failed to send email: %s", e)
        return False


async def send_password_reset_email(email: str, reset_url: str) -> bool:
    subject = "Reset your Backup Intelligence password"
    html = f"""
    <html><body style="font-family: sans-serif;">
    <h2 style="color: #10B981;">Password Reset</h2>
    <p>Click the link below to reset your password. This link expires in 60 minutes.</p>
    <a href="{reset_url}" style="background: #10B981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Reset Password</a>
    </body></html>
    """
    return await send_email([email], subject, html, f"Reset your password: {reset_url}")


async def send_invitation_email(email: str, org_name: str, invite_url: str) -> bool:
    subject = f"Invitation to join {org_name} on Backup Intelligence"
    html = f"""
    <html><body style="font-family: sans-serif;">
    <h2 style="color: #10B981;">Organization Invitation</h2>
    <p>You have been invited to join <strong>{org_name}</strong>.</p>
    <a href="{invite_url}" style="background: #10B981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Accept Invitation</a>
    </body></html>
    """
    return await send_email([email], subject, html, f"Join {org_name}: {invite_url}")


async def send_alert_email(emails: list[str], title: str, message: str, severity: str) -> bool:
    subject = f"[{severity.upper()}] {title}"
    html = f"""
    <html><body style="font-family: sans-serif;">
    <h2 style="color: #10B981;">Alert: {title}</h2>
    <p><strong>Severity:</strong> {severity}</p>
    <p>{message}</p>
    </body></html>
    """
    return await send_email(emails, subject, html, f"{title}\n\n{message}")
