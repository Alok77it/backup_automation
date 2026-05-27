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
        use_tls = settings.SMTP_PORT == 465
        smtp = aiosmtplib.SMTP(
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            use_tls=use_tls,
            start_tls=False,
        )
        await smtp.connect()
        if settings.SMTP_PORT == 587:
            await smtp.starttls()
        if settings.SMTP_USER:
            await smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        await smtp.send_message(message)
        await smtp.quit()
        return True
    except Exception as e:
        logger.warning("Failed to send email: %s", e)
        return False


async def send_password_reset_email(email: str, reset_url: str) -> bool:
    subject = "Reset your InfiOps password"
    html = f"""
    <html><body style="font-family: 'Rubik', sans-serif; background: #150f23; color: #fff; padding: 40px;">
    <div style="max-width: 480px; margin: 0 auto; background: #1f1633; border: 1px solid #362d59; border-radius: 12px; padding: 40px;">
      <div style="margin-bottom: 24px;">
        <span style="background: #c2ef4e; color: #150f23; font-weight: 700; padding: 4px 10px; border-radius: 6px; font-size: 14px;">io</span>
        <strong style="margin-left: 10px; font-size: 18px;">InfiOps</strong>
      </div>
      <h2 style="margin-bottom: 16px;">Password Reset</h2>
      <p style="color: #bdb8c0; margin-bottom: 28px;">Click the link below to reset your password. This link expires in 60 minutes.</p>
      <a href="{reset_url}" style="background: #c2ef4e; color: #150f23; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 700; display: inline-block;">Reset Password</a>
    </div></body></html>
    """
    return await send_email([email], subject, html, f"Reset your password: {reset_url}")


async def send_welcome_notification(
    admin_email: str,
    user_name: str,
    user_email: str,
    org_name: str,
) -> None:
    """Send two emails: notification to Alok, thank-you to the registrant."""

    # ── Email 1: Admin notification ──────────────────────────────────────────
    admin_html = f"""
    <html><body style="font-family: sans-serif; background: #150f23; color: #fff; padding: 40px;">
    <div style="max-width: 560px; margin: 0 auto; background: #1f1633; border: 1px solid #362d59; border-radius: 12px; padding: 36px;">
      <div style="margin-bottom: 20px;">
        <span style="background: #c2ef4e; color: #150f23; font-weight: 700; padding: 3px 9px; border-radius: 5px;">io</span>
        <strong style="margin-left: 8px;">InfiOps · New Registration</strong>
      </div>
      <h2 style="color: #c2ef4e; margin-bottom: 24px;">🎉 New Early Access Registration</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 10px 0; color: #bdb8c0; width: 160px;">Name</td>
            <td style="padding: 10px 0; font-weight: 600;">{user_name}</td></tr>
        <tr><td style="padding: 10px 0; color: #bdb8c0;">Email</td>
            <td style="padding: 10px 0; font-weight: 600;">{user_email}</td></tr>
        <tr><td style="padding: 10px 0; color: #bdb8c0;">Organization</td>
            <td style="padding: 10px 0; font-weight: 600;">{org_name}</td></tr>
      </table>
      <p style="margin-top: 24px; color: #bdb8c0; font-size: 13px;">
        Account created successfully. User can sign in at the platform immediately.
      </p>
    </div></body></html>
    """
    await send_email(
        [admin_email],
        f"[InfiOps] New Registration — {user_name} ({org_name})",
        admin_html,
    )

    # ── Email 2: Thank-you to user ────────────────────────────────────────────
    user_html = f"""
    <html><body style="font-family: sans-serif; background: #150f23; color: #fff; padding: 40px;">
    <div style="max-width: 560px; margin: 0 auto; background: #1f1633; border: 1px solid #362d59; border-radius: 12px; padding: 36px;">
      <div style="margin-bottom: 24px;">
        <span style="background: #c2ef4e; color: #150f23; font-weight: 700; padding: 3px 9px; border-radius: 5px;">io</span>
        <strong style="margin-left: 8px; font-size: 16px;">InfiOps</strong>
      </div>
      <h2 style="margin-bottom: 8px;">Welcome aboard, {user_name.split()[0]}! 👋</h2>
      <p style="color: #bdb8c0; margin-bottom: 24px;">
        Thank you for registering for early access to the InfiOps Platform.
      </p>
      <div style="background: #2d2540; border: 1px solid #362d59; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <p style="color: #c2ef4e; font-weight: 600; margin: 0 0 8px;">What's next?</p>
        <p style="color: #bdb8c0; margin: 0; font-size: 14px; line-height: 1.7;">
          We are actively working on the platform and will notify you with updates, new features, and your access details.
          Stay tuned — big things are coming!
        </p>
      </div>
      <p style="color: #bdb8c0; font-size: 14px;">— The InfiOps Team</p>
    </div></body></html>
    """
    await send_email(
        [user_email],
        "Welcome to InfiOps — We'll be in touch soon!",
        user_html,
        f"Hi {user_name.split()[0]}, thanks for registering! We'll keep you updated.",
    )


async def send_invitation_email(email: str, org_name: str, invite_url: str) -> bool:
    subject = f"Invitation to join {org_name} on InfiOps"
    html = f"""
    <html><body style="font-family: sans-serif; background: #150f23; color: #fff; padding: 40px;">
    <div style="max-width: 480px; margin: 0 auto; background: #1f1633; border: 1px solid #362d59; border-radius: 12px; padding: 36px;">
      <h2>You've been invited to join <strong>{org_name}</strong></h2>
      <p style="color: #bdb8c0; margin-bottom: 24px;">Accept the invitation to get started.</p>
      <a href="{invite_url}" style="background: #c2ef4e; color: #150f23; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 700;">Accept Invitation</a>
    </div></body></html>
    """
    return await send_email([email], subject, html, f"Join {org_name}: {invite_url}")
