"""İletişim formu — outbox üzerinden gönderim (ekspertiz P0-25).

Mesafeli satışta tüketicinin satıcıya kolayca ulaşabileceği bir kanal
bulundurmak zorunludur; platformda yalnız yasal metin içinde bir e-posta adresi
geçiyordu, arkasında hiçbir yüzey yoktu.

Tasarım kararı: ayrı bir helpdesk/ticket sistemi YAZILMADI. Bu ölçekte form →
e-posta yeterli; mesajın kaybolmaması outbox ile garanti ediliyor.
"""
from __future__ import annotations

import pytest

from core import outbox
from services import support_service


class _FakeDb:
    def __init__(self) -> None:
        self.added: list = []

    def add(self, obj) -> None:
        self.added.append(obj)


@pytest.mark.asyncio
async def test_mesaj_outboxa_yazilir() -> None:
    """Doğrudan SMTP çağrılmaz: sağlayıcı anlık erişilemezse mesaj kaybolmasın."""
    db = _FakeDb()
    await support_service.submit_contact(
        db,
        name="Ayşe Yılmaz",
        email="ayse@ornek.com",
        subject="Siparişim hakkında",
        message="1024 numaralı siparişim elime ulaşmadı.",
    )
    assert len(db.added) == 1
    event = db.added[0]
    assert event.kind == "email:contact"
    assert event.payload["from_email"] == "ayse@ornek.com"
    assert event.payload["subject"] == "Siparişim hakkında"


@pytest.mark.asyncio
async def test_gonderene_teyit_maili_planlanir() -> None:
    """Kullanıcı boşluğa yazdığını sanmasın."""
    db = _FakeDb()
    await support_service.submit_contact(
        db, name="Ali", email="ali@ornek.com", subject="Soru", message="Merhaba…"
    )
    assert db.added[0].payload["ack_to"] == "ali@ornek.com"


@pytest.mark.asyncio
async def test_teyit_kapatilabilir() -> None:
    db = _FakeDb()
    await support_service.submit_contact(
        db,
        name="Ali",
        email="ali@ornek.com",
        subject="Soru",
        message="Merhaba…",
        send_ack=False,
    )
    assert db.added[0].payload["ack_to"] is None


@pytest.mark.asyncio
async def test_oturumlu_kullanicida_hesap_referansi_tasinir() -> None:
    db = _FakeDb()
    await support_service.submit_contact(
        db,
        name="Ali",
        email="ali@ornek.com",
        subject="Soru",
        message="Merhaba…",
        user_ref="ali@ornek.com (rol 3)",
    )
    assert "rol 3" in db.added[0].payload["user_ref"]


@pytest.mark.asyncio
async def test_bosluklar_kirpilir() -> None:
    db = _FakeDb()
    await support_service.submit_contact(
        db,
        name="  Ali  ",
        email="  ali@ornek.com  ",
        subject="  Konu  ",
        message="  Mesaj gövdesi  ",
    )
    p = db.added[0].payload
    assert p["from_name"] == "Ali"
    assert p["from_email"] == "ali@ornek.com"
    assert p["subject"] == "Konu"
    assert p["message"] == "Mesaj gövdesi"


def test_outbox_handleri_kayitli() -> None:
    """enqueue bilinmeyen kind'ı reddeder — kayıt yoksa form runtime'da patlar."""
    assert "email:contact" in outbox._HANDLERS


def test_destek_kutusu_yapilandirma_eksikse_de_calisir() -> None:
    """SUPPORT_EMAIL boşsa mesaj EMAIL_FROM'a düşer; sessizce kaybolmaz."""
    inbox = support_service.support_inbox()
    assert inbox and "@" in inbox
