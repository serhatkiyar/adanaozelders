"""İP-1b S düğümleri — silinmiş kütüphane SATIŞ YAPAMAZ (GERÇEK PostgreSQL).

## Ölçülen iş kuralı

`libraries.deleted_at` dolu bir kütüphane katalogdan düşer; onunla birlikte
**para yüzeyleri de** düşmelidir: yeni kayıt açılmaz, ödeme alınmaz, callback
bilet basmaz, public liste onu göstermez ve no-show tahsilatı ona hak ediş
yazmaz.

## Ölçüm (denetim raporundan farkı)

Denetim (P1-21) "`Library.deleted_at` `library_exam_service.py` ve
`study_reservation_service.py`'de **hiç geçmiyor**" diyor. Ölçüm bunu
doğrulamadı: `study_reservation_service.reserve` (`:234`) ve `quote` (`:190`)
hem `deleted_at`'e hem `status`'e bakıyor — **kopyalanacak doğru desen odur**.
Açık olan yollar: deneme kaydı/ödemesi/callback'i, `list_public_sessions`
(yalnız `status`'e bakar, `deleted_at`'e bakmaz), çalışma alanı ödemesi ve
her iki koldaki `auto_release_no_shows`.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException

from core.config import settings
from core.database import AsyncSessionLocal
from models.library_exam import RegistrationStatus
from services import library_exam_service, study_reservation_service

try:
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo("Europe/Istanbul")
except Exception:  # noqa: BLE001
    _TZ = datetime.timezone(datetime.timedelta(hours=3))


def _yarin_saat(saat: int = 10, sure_saat: int = 2):
    yerel = (datetime.datetime.now(_TZ) + datetime.timedelta(days=1)).replace(
        hour=saat, minute=0, second=0, microsecond=0
    )
    return (
        yerel.astimezone(datetime.timezone.utc),
        (yerel + datetime.timedelta(hours=sure_saat)).astimezone(datetime.timezone.utc),
    )


# ═══════════════════ S-1 · silinmiş kütüphaneye kayıt açılmaz ═══════════════════


async def test_S1_silinmis_kutuphanenin_oturumuna_kayit_404(ip1b, pg):
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=10)
    ogrenci = await ip1b.ogrenci()
    await ip1b.kutuphaneyi_sil(lib.id)

    with pytest.raises(HTTPException) as hata:
        await ip1b.kaydol(ogrenci, oturum.id)
    assert hata.value.status_code == 404, (
        "silinmiş kütüphanenin oturumuna kayıt açılabiliyor (denetim P1-21)"
    )


async def test_S1b_silinmis_kutuphanenin_oturumuna_kayit_http_404(
    ip1b, ip1b_http, pg, monkeypatch
):
    """Aynı kural GERÇEK HTTP yüzeyinde: uç 404 döner (servis içi 404 değil)."""
    from core import flags
    from services import payment_gates

    # Ödeme kapısı bu düğümün konusu değil; kapalı bir kol 503 üretip asıl
    # kuralı ölçülemez hâle getirirdi. Kapı yalnız bu test için açılır.
    async def _acik(db, branch):  # noqa: ANN001
        return None

    monkeypatch.setattr(payment_gates, "assert_branch_open", _acik)
    flags.reset_cache()

    from tests.integration.ip1b_factory import auth_header

    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=10)
    ogrenci = await ip1b.ogrenci()
    await ip1b.kutuphaneyi_sil(lib.id)

    yanit = await ip1b_http.post(
        "/api/v1/exam-registrations",
        json={"session_id": oturum.id},
        headers=auth_header(ogrenci.id, "CLIENT", 3, ogrenci.auth_version),
    )
    assert yanit.status_code == 404, (
        f"HTTP yüzeyinde 404 beklendi, {yanit.status_code} geldi: {yanit.text[:200]}"
    )


# ═══════════════════ S-2 · silinmiş kütüphaneye ödeme alınmaz ═══════════════════


async def test_S2_silinmis_kutuphaneye_deneme_odemesi_404(ip1b, sayan_saglayici, pg):
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=10)
    ogrenci = await ip1b.ogrenci()
    kayit = await ip1b.kaydol(ogrenci, oturum.id)
    await ip1b.kutuphaneyi_sil(lib.id)

    with pytest.raises(HTTPException) as hata:
        await ip1b.ode(ogrenci, kayit.id)
    assert hata.value.status_code == 404, (
        "silinmiş kütüphanenin oturumuna ödeme alınıyor (denetim P1-21)"
    )
    assert not sayan_saglayici.charge_calls, "reddedilmesi gereken yolda tahsilat yapıldı"


async def test_S2b_silinmis_kutuphaneye_calisma_odemesi_404(ip1b, sayan_saglayici, pg):
    """Çalışma alanı kolu: `reserve` canlılığa bakıyor ama `pay` bakmıyordu."""
    lib = await ip1b.kutuphane(
        capacity=5, study_hourly_price=Decimal("25.00"), saatler=True
    )
    starts, ends = _yarin_saat()
    ogrenci = await ip1b.ogrenci()
    res = await ip1b.rezerve_et(ogrenci, lib.id, starts, ends)
    await ip1b.kutuphaneyi_sil(lib.id)

    with pytest.raises(HTTPException) as hata:
        await ip1b.study_ode(ogrenci, res.id)
    assert hata.value.status_code == 404
    assert not sayan_saglayici.charge_calls


# ══════════════ S-3 · public liste silinmiş kütüphaneyi göstermez ══════════════


async def test_S3_public_liste_silinmis_kutuphaneyi_gostermez(ip1b, pg):
    lib = await ip1b.kutuphane()
    await ip1b.oturum(lib.id, capacity=10)
    await ip1b.kutuphaneyi_sil(lib.id)

    async with AsyncSessionLocal() as s:
        oturumlar = await library_exam_service.list_public_sessions(s, lib.id)
    assert oturumlar == [], (
        "silinmiş kütüphanenin oturumları public listede duruyor — "
        "`list_public_sessions` yalnız `status`'e bakıyor (denetim P1-21)"
    )


# ═════════ S-4 · no-show tahsilatı silinmiş kütüphaneye hak ediş yazmaz ═════════


async def test_S4_no_show_silinmis_kutuphaneye_serbest_birakmaz(ip1b, pg):
    """Silinmiş kütüphanenin ödenmiş bileti otomatik RELEASE EDİLMEZ.

    Emanet serbest bırakılırsa para, artık var olmayan bir tedarikçinin hak
    edişine yazılır ve geri alınamaz (`released_at` dolu satır iadeye claim
    edilemez — `services/escrow.py` H2). Doğru davranış: dokunma, kaydı
    sarkan bırak ve silme guard'ının (D düğümleri) bu durumu en baştan
    engellemesine güven.
    """
    lib = await ip1b.kutuphane()
    gecmis = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
        hours=settings.AUTO_COMPLETE_GRACE_HOURS + 24
    )
    oturum = await ip1b.oturum(lib.id, capacity=10, starts_at=gecmis)
    ogrenci = await ip1b.ogrenci()
    reg_id = await ip1b.ham_kayit(
        session_id=oturum.id,
        client_id=ogrenci.id,
        status=RegistrationStatus.PAID.value,
    )
    await ip1b.kutuphaneyi_sil(lib.id)

    async with AsyncSessionLocal() as s:
        await library_exam_service.auto_release_no_shows(s)
        await s.commit()

    satir = next(r for r in await ip1b.kayitlar(oturum.id) if r["id"] == reg_id)
    assert satir["released_at"] is None, (
        "silinmiş kütüphaneye no-show emaneti serbest bırakıldı — para artık "
        "var olmayan bir tedarikçinin hak edişinde (denetim P1-21)"
    )


async def test_S4b_calisma_no_show_silinmis_kutuphaneye_serbest_birakmaz(ip1b, pg):
    lib = await ip1b.kutuphane(capacity=5, study_hourly_price=Decimal("25.00"))
    simdi = datetime.datetime.now(datetime.timezone.utc)
    starts = simdi - datetime.timedelta(hours=settings.AUTO_COMPLETE_GRACE_HOURS + 26)
    ends = starts + datetime.timedelta(hours=2)
    ogrenci = await ip1b.ogrenci()
    res_id = await ip1b.ham_rezervasyon(
        library_id=lib.id,
        client_id=ogrenci.id,
        starts=starts,
        ends=ends,
        status=RegistrationStatus.PAID.value,
    )
    await ip1b.kutuphaneyi_sil(lib.id)

    async with AsyncSessionLocal() as s:
        await study_reservation_service.auto_release_no_shows(s)
        await s.commit()

    satir = next(r for r in await ip1b.rezervasyonlar(lib.id) if r["id"] == res_id)
    assert satir["released_at"] is None
