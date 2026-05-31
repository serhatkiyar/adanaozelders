from __future__ import annotations

from core.config import settings
from core.mail.base import EmailMessage

_BRAND = "Ceyhan Özel Ders"


def _layout(*, heading: str, intro: str, button_label: str, button_url: str, outro: str) -> str:
    """Inline-stilli basit, markalı HTML şablonu (e-posta istemcileri inline ister)."""
    return f"""\
<!DOCTYPE html>
<html lang="tr">
<body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="background:#4f46e5;padding:20px 32px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;">{_BRAND}</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">{heading}</h1>
          <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#475569;">{intro}</p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#4f46e5;">
            <a href="{button_url}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">{button_label}</a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-size:12px;line-height:20px;color:#94a3b8;">{outro}</p>
          <p style="margin:16px 0 0;font-size:12px;line-height:20px;color:#94a3b8;word-break:break-all;">
            Buton çalışmazsa bu bağlantıyı tarayıcına yapıştır:<br>{button_url}
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
          <span style="font-size:11px;color:#cbd5e1;">© {_BRAND}</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def verification_email(*, to: str, name: str, verify_url: str) -> EmailMessage:
    ttl = settings.EMAIL_VERIFY_TOKEN_TTL_HOURS
    subject = f"{_BRAND} · E-posta adresini doğrula"
    text = (
        f"Merhaba {name},\n\n"
        f"{_BRAND} hesabını etkinleştirmek için e-posta adresini doğrula:\n"
        f"{verify_url}\n\n"
        f"Bu bağlantı {ttl} saat geçerlidir. Bu kaydı sen yapmadıysan bu e-postayı yok sayabilirsin."
    )
    html = _layout(
        heading="E-posta adresini doğrula",
        intro=f"Merhaba <b>{name}</b>, {_BRAND} hesabını etkinleştirmek için aşağıdaki butona tıkla.",
        button_label="E-postamı doğrula",
        button_url=verify_url,
        outro=f"Bağlantı {ttl} saat geçerlidir. Bu kaydı sen yapmadıysan bu e-postayı yok sayabilirsin.",
    )
    return EmailMessage(to=to, subject=subject, html=html, text=text)


def password_reset_email(*, to: str, name: str, reset_url: str) -> EmailMessage:
    ttl = settings.PASSWORD_RESET_TOKEN_TTL_HOURS
    subject = f"{_BRAND} · Şifre sıfırlama"
    text = (
        f"Merhaba {name},\n\n"
        f"Şifreni sıfırlamak için aşağıdaki bağlantıya tıkla:\n"
        f"{reset_url}\n\n"
        f"Bu bağlantı {ttl} saat geçerlidir. Bu talebi sen yapmadıysan şifren değişmez; "
        f"bu e-postayı yok sayabilirsin."
    )
    html = _layout(
        heading="Şifreni sıfırla",
        intro=f"Merhaba <b>{name}</b>, hesabının şifresini sıfırlamak için aşağıdaki butona tıkla.",
        button_label="Şifremi sıfırla",
        button_url=reset_url,
        outro=(
            f"Bağlantı {ttl} saat geçerlidir. Bu talebi sen yapmadıysan şifren değişmez; "
            f"bu e-postayı yok sayabilirsin."
        ),
    )
    return EmailMessage(to=to, subject=subject, html=html, text=text)
