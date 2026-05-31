"""E-posta doğrulama / şifre sıfırlama katmanının DB'siz testleri.

Token üretimi/tüketimi DB gerektirir (entegrasyon); burada saf yardımcılar, şablon
üretimi ve sağlayıcı seçimi/`_safe_send` dayanıklılığı test edilir.
"""
from core import mail
from core.config import settings
from core.mail import templates
from core.mail import sender as sender_mod
from core.mail.console import ConsoleEmailSender
from core.mail.smtp import SMTPEmailSender
from models.verification_token import TokenPurpose
from services import verification_service as vs


def test_hash_is_deterministic_sha256_hex():
    h1 = vs._hash("token-abc")
    assert h1 == vs._hash("token-abc")  # deterministik
    assert len(h1) == 64  # sha256 hex
    assert h1 != vs._hash("token-abd")  # çakışmaz


def test_ttl_hours_per_purpose():
    assert vs._ttl_hours(TokenPurpose.EMAIL_VERIFY) == settings.EMAIL_VERIFY_TOKEN_TTL_HOURS
    assert (
        vs._ttl_hours(TokenPurpose.PASSWORD_RESET)
        == settings.PASSWORD_RESET_TOKEN_TTL_HOURS
    )


def test_verification_template_embeds_url_and_name():
    url = "http://localhost:5173/e-posta-dogrula?token=XYZ"
    msg = templates.verification_email(to="a@b.com", name="Ada", verify_url=url)
    assert msg.to == "a@b.com"
    assert "doğrula" in msg.subject.lower()
    assert url in msg.html  # buton + fallback linkte
    assert url in msg.text
    assert "Ada" in msg.text


def test_password_reset_template_embeds_url():
    url = "http://localhost:5173/sifre-yenile?token=XYZ"
    msg = templates.password_reset_email(to="a@b.com", name="Ada", reset_url=url)
    assert url in msg.html
    assert url in msg.text
    assert "sıfırla" in msg.subject.lower()


def test_get_email_sender_selects_provider(monkeypatch):
    mail.get_email_sender.cache_clear()
    monkeypatch.setattr(settings, "EMAIL_PROVIDER", "console")
    assert isinstance(mail.get_email_sender(), ConsoleEmailSender)

    mail.get_email_sender.cache_clear()
    monkeypatch.setattr(settings, "EMAIL_PROVIDER", "SMTP")  # büyük/küçük harf duyarsız
    assert isinstance(mail.get_email_sender(), SMTPEmailSender)

    mail.get_email_sender.cache_clear()  # diğer testler için varsayılana dön


async def test_console_sender_send_does_not_raise():
    sender = ConsoleEmailSender()
    msg = templates.verification_email(
        to="x@y.com", name="Zeynep", verify_url="http://x/y?token=t"
    )
    await sender.send(msg)  # yalnız loglar; istisna fırlatmamalı


async def test_safe_send_swallows_provider_errors(monkeypatch):
    """Sağlayıcı patlasa bile _safe_send False döner — kayıt/sıfırlama akışı bozulmaz."""

    class Boom(ConsoleEmailSender):
        async def send(self, message):
            raise RuntimeError("smtp down")

    monkeypatch.setattr(sender_mod, "get_email_sender", lambda: Boom())
    ok = await sender_mod._safe_send(
        templates.verification_email(to="x@y.com", name="A", verify_url="http://x?token=t")
    )
    assert ok is False
