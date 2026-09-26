"""Canlı ders sağlayıcı ataması — gerçek Postgres'te atomiklik.

Eğitmen ve öğrenci aynı anda ilk bileti isterse ikisi de AYNI sağlayıcıyı
almalı; atama bir kez yazılır ve sonra değişmez. Seçici bilerek iki çağrıda
FARKLI sağlayıcı önerecek şekilde yamalanır: yarış gerçekten çakışır ve
koşullu UPDATE'in (`... AND canli_ders_saglayici IS NULL`) kazananı korur.
"""
from __future__ import annotations

import asyncio
import datetime
import itertools

from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import canli_ders_saglayici


async def _db_degeri(booking_id: int) -> str | None:
    async with AsyncSessionLocal() as s:
        return await s.scalar(
            text("SELECT canli_ders_saglayici FROM bookings WHERE id = :id"),
            {"id": booking_id},
        )


async def test_ayni_derse_iki_istek_ayni_saglayiciyi_alir(factory, monkeypatch):
    seeded = await factory.booking_with_payment()
    oneriler = itertools.cycle(["zoom", "agora"])

    async def degisken_sec(db, an):
        # Seçimden sonra kısa bekleme: iki istek de SELECT'i NULL görüp
        # UPDATE'e aynı anda varsın (yarış penceresi açık kalsın).
        secim = next(oneriler)
        await asyncio.sleep(0.05)
        return secim

    monkeypatch.setattr(canli_ders_saglayici, "sec", degisken_sec)
    now = datetime.datetime.now(datetime.timezone.utc)

    a, b = await asyncio.gather(
        canli_ders_saglayici.ata(seeded.booking_id, now),
        canli_ders_saglayici.ata(seeded.booking_id, now),
    )
    assert a == b
    assert a in ("zoom", "agora")
    assert await _db_degeri(seeded.booking_id) == a

    # Atandıktan sonra değişmez: seçici öteki sağlayıcıyı önerse bile.
    ters = "agora" if a == "zoom" else "zoom"

    async def ters_sec(db, an):
        return ters

    monkeypatch.setattr(canli_ders_saglayici, "sec", ters_sec)
    assert await canli_ders_saglayici.ata(seeded.booking_id, now) == a
    assert await _db_degeri(seeded.booking_id) == a


async def test_anahtar_yoksa_atama_yapilmaz(factory, monkeypatch):
    seeded = await factory.booking_with_payment()

    async def bos_sec(db, an):
        return None

    monkeypatch.setattr(canli_ders_saglayici, "sec", bos_sec)
    now = datetime.datetime.now(datetime.timezone.utc)
    assert await canli_ders_saglayici.ata(seeded.booking_id, now) is None
    assert await _db_degeri(seeded.booking_id) is None


async def test_kullanim_bu_ay_atanmis_derslerden(factory, monkeypatch):
    """Kullanım sorgusu gerçek şemada çalışır: süre × 2 kişi-dakikası."""
    from core.config import settings

    seeded = await factory.booking_with_payment()
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE bookings SET canli_ders_saglayici = 'agora' WHERE id = :id"),
            {"id": seeded.booking_id},
        )
        await s.commit()
        bas = await s.scalar(
            text("SELECT start_at FROM bookings WHERE id = :id"), {"id": seeded.booking_id}
        )
        kullanim = await canli_ders_saglayici._bu_ayki_kullanim(s, bas)
    # Fabrika dersi 1 saat: en az 120 kişi-dakikası agora'ya yazılmış olmalı.
    assert kullanim.get("agora", 0) >= 120

    # Kotalar eşitken ve agora bu ay kullanılmışken seçim zoom'a gider.
    monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_KEY", "k")
    monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_SECRET", "s")
    monkeypatch.setattr(settings, "AGORA_APP_ID", "a")
    monkeypatch.setattr(settings, "AGORA_APP_CERTIFICATE", "c")
    monkeypatch.setattr(settings, "ZOOM_UCRETSIZ_KISI_DK", 10**9)
    monkeypatch.setattr(settings, "AGORA_UCRETSIZ_KISI_DK", 10**9)
    async with AsyncSessionLocal() as s:
        zoom_kullanim = (await canli_ders_saglayici._bu_ayki_kullanim(s, bas)).get("zoom", 0)
        if zoom_kullanim < kullanim["agora"]:
            assert await canli_ders_saglayici.sec(s, bas) == "zoom"
