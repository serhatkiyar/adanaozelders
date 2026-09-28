"""Her e-posta şablonu gerçekten üretilebilmeli.

NEDEN VAR: `contact_message_email` ve `contact_ack_email` `EmailMessage(body=...)`
diye çağırıyordu ama dataclass `text`/`html` bekliyor — yani /iletisim formundan
gelen HİÇBİR mesaj gönderilmiyordu. Hata görünmüyordu çünkü gönderim bilinçli
olarak best-effort'tur (`_safe_send` istisnayı yutar ve akışı bozmaz): kullanıcı
"mesajın alındı" ekranını görüyor, mesaj ise hiç kimseye ulaşmıyordu.

İlk test şablonların ÇAĞRILABİLİRLİĞİNİ sabitler; alttakiler ortak layout'un
sözleşmesini (kaçış, preheader, HTTPS logo) sabitler.
"""
from __future__ import annotations

import pytest

from core.mail import templates
from core.mail.base import EmailMessage

CASES = {
    "verification_email": dict(
        to="a@b.co", name="Ahmet", verify_url="https://x.test/dogrula?t=1"
    ),
    "password_reset_email": dict(
        to="a@b.co", name="Ahmet", reset_url="https://x.test/sifre?t=1"
    ),
    "back_in_stock_email": dict(
        to="a@b.co", product_title="Matematik Soru Bankası", product_url="https://x.test/u/1"
    ),
    "contact_message_email": dict(
        to="destek@x.test",
        from_name="Ahmet",
        from_email="a@b.co",
        subject="Sipariş sorunu",
        message="Merhaba, siparişim gelmedi.",
    ),
    "contact_ack_email": dict(to="a@b.co", name="Ahmet", subject="Sipariş sorunu"),
    "payout_changed_email": dict(
        to="a@b.co", name="Ahmet", iban_masked="TR** **** **** 1234"
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_sablon_uretilebiliyor(name: str) -> None:
    message = getattr(templates, name)(**CASES[name])
    assert isinstance(message, EmailMessage)
    assert message.to and message.subject
    # Çoklu-parça sözleşmesi: iki gövde de dolu olmalı, aksi halde bazı
    # istemcilerde e-posta boş görünür.
    assert message.text.strip()
    assert message.html.strip()


def test_order_status_email_uretilebiliyor() -> None:
    """İmzası diğerlerinden farklı olduğu için ayrı: durum + sipariş bilgisi ister."""
    import inspect

    sig = inspect.signature(templates.order_status_email)
    kwargs: dict[str, object] = {}
    for param in sig.parameters.values():
        if param.default is not inspect.Parameter.empty:
            continue
        kwargs[param.name] = {
            "to": "a@b.co",
            "order_id": 1,
        }.get(param.name, "PAID" if "status" in param.name else "x")
    message = templates.order_status_email(**kwargs)  # type: ignore[arg-type]
    assert isinstance(message, EmailMessage)
    assert message.text.strip() and message.html.strip()


_XSS = '<img src=x onerror=alert(1)>'


@pytest.mark.parametrize(
    ("name", "kwargs"),
    [
        ("verification_email", dict(to="a@b.co", name=_XSS, verify_url="https://x.test/d?t=1")),
        ("password_reset_email", dict(to="a@b.co", name=_XSS, reset_url="https://x.test/s?t=1")),
        ("back_in_stock_email", dict(to="a@b.co", product_title=_XSS, product_url="https://x.test/u")),
        ("contact_ack_email", dict(to="a@b.co", name="Ahmet", subject=_XSS)),
        (
            "contact_message_email",
            dict(to="d@x.test", from_name="A", from_email="a@b.co", subject="Konu", message=_XSS),
        ),
        ("payout_changed_email", dict(to="a@b.co", name=_XSS, iban_masked="TR** 1234")),
    ],
)
def test_kullanici_verisi_html_gövdede_kacislanir(name: str, kwargs: dict) -> None:
    """Ad, ürün adı, konu ve mesaj kullanıcıdan gelir. Kaçış yapılmazsa
    e-posta istemcisinde biçim bozulur ve zararlı işaretleme taşınır (eski
    şablonlar adı/ürün adını HTML'e ham gömüyordu)."""
    html = getattr(templates, name)(**kwargs).html
    assert "<img src=x" not in html
    assert "&lt;img src=x onerror=alert(1)&gt;" in html


@pytest.mark.parametrize("status", ["PAID", "SHIPPED", "DELIVERED", "REFUNDED", "BILINMEYEN"])
def test_siparis_durumlari_ayri_gorunum_uretir(status: str) -> None:
    message = templates.order_status_email(
        to="a@b.co", name="Ahmet", order_id=42, status=status,
        total="149.90", currency="TRY", orders_url="https://x.test/siparislerim",
    )
    assert "#42" in message.subject
    assert "149.90 TRY" in message.html and "149.90 TRY" in message.text
    assert "https://x.test/siparislerim" in message.html
    # İlerleme çubuğu yalnız teslimat hattındaki durumlarda çıkar.
    assert ("Kargoda" in message.html) is (status in {"PAID", "SHIPPED", "DELIVERED"})


def test_her_html_preheader_ve_istemci_uyumlu_iskelet_tasir() -> None:
    message = templates.verification_email(
        to="a@b.co", name="Ahmet", verify_url="https://x.test/d?t=1"
    )
    html = message.html
    assert html.startswith("<!DOCTYPE html>")
    assert '<html lang="tr"' in html
    assert 'role="presentation"' in html
    # Gizli önizleme metni gövdenin başında.
    assert "tek adım kaldı" in html.split("<table", 1)[0]
    # Outlook için VML düğme + diğer istemciler için <a>.
    assert "v:roundrect" in html and 'href="https://x.test/d?t=1"' in html


def test_logo_yalniz_https_kokten_yuklenir(monkeypatch) -> None:
    """E-posta istemcisi göreli/HTTP görseli ya engeller ya uyarı gösterir;
    yerelde (http://localhost) metin logo kullanılır, kırık görsel çıkmaz."""
    from core.config import settings

    monkeypatch.setattr(settings, "FRONTEND_BASE_URL", "http://localhost:5173")
    html = templates.contact_ack_email(to="a@b.co", name="A", subject="S").html
    assert "<img" not in html
    assert "instagram.com/adanaozeldersofficial" in html  # ikon yerine metin bağlantı

    monkeypatch.setattr(settings, "FRONTEND_BASE_URL", "https://adanaozelders.com.tr/")
    html = templates.contact_ack_email(to="a@b.co", name="A", subject="S").html
    assert 'src="https://adanaozelders.com.tr/eposta/logo.png"' in html
    assert 'alt="Adana Özel Ders"' in html
    # Footer'daki sosyal hesap ikonları da aynı HTTPS kökten PNG olarak gelir.
    for key in ("instagram", "tiktok", "youtube", "facebook", "x"):
        assert f'src="https://adanaozelders.com.tr/eposta/{key}.png"' in html
