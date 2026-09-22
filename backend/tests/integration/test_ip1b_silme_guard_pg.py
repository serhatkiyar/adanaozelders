"""İP-1b D düğümleri — silmeden önce AÇIK EMANET kontrolü (GERÇEK PostgreSQL).

## Ölçülen iş kuralı

Bir tedarikçi (kütüphane / eğitmen) **üzerinde açık para varken silinemez**.
Aksi halde emanet yetim kalır: hak ediş defteri onu "hak edilmiş" saymaya devam
eder ama karşılığında hesap yoktur (denetim P1-22), ve serbest bırakma yolu
artık silinmiş bir tedarikçiye para yazar (S-4).

## Guard'ın kapsamı (sözleşme)

Kütüphane silinemez ise:
- ödenmiş/iade sürecindeki deneme bileti (`PAID`/`REFUNDING`, `released_at` boş),
- ödenmiş/iade sürecindeki çalışma rezervasyonu (aynı ölçüt),
- **gelecekteki** `SCHEDULED` deneme oturumu (henüz bilet satılmamış olsa bile:
  silme, verilmiş bir taahhüdü sessizce yutmamalı — admin önce oturumu iptal
  eder, o yol gerekli iadeleri üretir).

Geçmiş oturumlar, iptal edilmiş oturumlar ve kapanmış para (RELEASED/REFUNDED)
engellemez — aksi halde hiçbir kütüphane hiçbir zaman silinemezdi.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.library import Library
from models.library_exam import ExamSessionStatus, RegistrationStatus
from services import library_service


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _sil(library_id: int) -> None:
    async with AsyncSessionLocal() as s:
        await library_service.delete_library(s, library_id)


async def _silindi_mi(library_id: int) -> bool:
    async with AsyncSessionLocal() as s:
        lib = await s.get(Library, library_id)
        return lib is not None and lib.deleted_at is not None


# ═════════════ D-1 · açık deneme emaneti varken kütüphane silinemez ═════════════


async def test_D1_acik_deneme_emaneti_silmeyi_engeller(ip1b, pg):
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=10)
    ogrenci = await ip1b.ogrenci()
    await ip1b.ham_kayit(
        session_id=oturum.id,
        client_id=ogrenci.id,
        status=RegistrationStatus.PAID.value,
    )

    with pytest.raises(HTTPException) as hata:
        await _sil(lib.id)
    assert hata.value.status_code == 409, (
        "emanette parası olan kütüphane silinebiliyor — yetim emanet (P1-22)"
    )
    assert "bilet" in str(hata.value.detail).lower(), (
        f"hata mesajı hangi kaydın engellediğini söylemiyor: {hata.value.detail!r}"
    )
    assert not await _silindi_mi(lib.id), "reddedilen silme yine de damgalandı"


# ══════════ D-2 · açık çalışma rezervasyonu varken kütüphane silinemez ══════════


async def test_D2_acik_calisma_rezervasyonu_silmeyi_engeller(ip1b, pg):
    lib = await ip1b.kutuphane(capacity=5, study_hourly_price=Decimal("25.00"))
    ogrenci = await ip1b.ogrenci()
    starts = _now() + datetime.timedelta(days=2)
    await ip1b.ham_rezervasyon(
        library_id=lib.id,
        client_id=ogrenci.id,
        starts=starts,
        ends=starts + datetime.timedelta(hours=2),
        status=RegistrationStatus.PAID.value,
    )

    with pytest.raises(HTTPException) as hata:
        await _sil(lib.id)
    assert hata.value.status_code == 409
    assert "rezervasyon" in str(hata.value.detail).lower(), (
        f"hata mesajı engelleyen kaydı söylemiyor: {hata.value.detail!r}"
    )
    assert not await _silindi_mi(lib.id)


async def test_D2b_gelecek_scheduled_oturum_silmeyi_engeller(ip1b, pg):
    """Bilet satılmamış olsa bile gelecekteki planlı oturum silmeyi engeller."""
    lib = await ip1b.kutuphane()
    await ip1b.oturum(lib.id, capacity=10)

    with pytest.raises(HTTPException) as hata:
        await _sil(lib.id)
    assert hata.value.status_code == 409
    assert "oturum" in str(hata.value.detail).lower()


# ═══════════════════════ D-3 · temiz kütüphane silinebilir ═══════════════════════


async def test_D3_temiz_kutuphane_silinebilir(ip1b, pg):
    """Guard fazla geniş değil: kapanmış para ve geçmiş oturum engellemez.

    Bu düğüm guard'ın kendisi kadar önemlidir: yalnız "409 dönüyor mu" ölçen
    bir sözleşme, her şeyi reddeden bir uygulamayla da yeşil kalırdı.
    """
    lib = await ip1b.kutuphane()
    gecmis = _now() - datetime.timedelta(days=30)
    oturum = await ip1b.oturum(lib.id, capacity=10, starts_at=gecmis)
    ogrenci = await ip1b.ogrenci()
    reg_id = await ip1b.ham_kayit(
        session_id=oturum.id,
        client_id=ogrenci.id,
        status=RegistrationStatus.ATTENDED.value,
    )
    # Katılım doğrulanmış = emanet zaten kütüphaneye serbest (kapanmış para).
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE exam_registrations SET released_at = now() WHERE id = :i"),
            {"i": reg_id},
        )
        await s.commit()
    # İptal edilmiş gelecek oturum da engellememeli.
    await ip1b.oturum(
        lib.id, capacity=10, status=ExamSessionStatus.CANCELLED.value
    )

    await _sil(lib.id)
    assert await _silindi_mi(lib.id), "temiz kütüphane silinemedi — guard fazla geniş"


# ══════════ D-4/D-5 · aynı kural eğitmen tarafında (P1-22 ikisini kapsar) ══════════


async def test_D4_acik_emanetli_egitmen_silinemez(ip1a, pg):
    """HELD ödemesi olan eğitmen silinemez (`admin_service.delete_tutor`)."""
    from models.tutor import Tutor
    from services import admin_service

    ders = await ip1a.odenmis()
    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, ders.tutor_id)
        with pytest.raises(HTTPException) as hata:
            await admin_service.delete_tutor(s, tutor)
        await s.rollback()
    assert hata.value.status_code == 409, (
        "emanette parası olan öğretmen silinebiliyor — yetim emanet (P1-22)"
    )

    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, ders.tutor_id)
        assert tutor.deleted_at is None


async def test_D5_temiz_egitmen_silinebilir(ip1a, pg):
    from models.tutor import Tutor
    from services import admin_service

    ders = await ip1a.ders()  # yalnız PENDING ders, ödeme yok
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE bookings SET status = 'CANCELLED' WHERE id = :i"),
            {"i": ders.booking_id},
        )
        await s.commit()
    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, ders.tutor_id)
        await admin_service.delete_tutor(s, tutor)
        await s.commit()
    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, ders.tutor_id)
        assert tutor.deleted_at is not None, "temiz öğretmen silinemedi"
