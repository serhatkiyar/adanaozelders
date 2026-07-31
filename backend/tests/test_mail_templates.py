"""Her e-posta şablonu gerçekten üretilebilmeli.

NEDEN VAR: `contact_message_email` ve `contact_ack_email` `EmailMessage(body=...)`
diye çağırıyordu ama dataclass `text`/`html` bekliyor — yani /iletisim formundan
gelen HİÇBİR mesaj gönderilmiyordu. Hata görünmüyordu çünkü gönderim bilinçli
olarak best-effort'tur (`_safe_send` istisnayı yutar ve akışı bozmaz): kullanıcı
"mesajın alındı" ekranını görüyor, mesaj ise hiç kimseye ulaşmıyordu.

Bu test şablonların ÇAĞRILABİLİRLİĞİNİ sabitler; içerik denetlemez.
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


def test_plain_html_kacis_yapar() -> None:
    """Kullanıcı metni HTML gövdeye gömülüyor; kaçış yapılmazsa e-posta
    istemcisinde biçim bozulur (ve zararlı işaretleme taşınır)."""
    out = templates._plain_html("<script>alert(1)</script> & 5 < 6")
    assert "<script>" not in out
    assert "&lt;script&gt;" in out
    assert "&amp;" in out
