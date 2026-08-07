"""İP-1b P düğümleri — exam/study `pay()` CLAIM disiplini (GERÇEK PostgreSQL).

## Ölçülen iş kuralı

Para durumunu değiştiren her geçiş **koşullu UPDATE** ile yapılır (`services/
escrow.py::claim`): yarışan iki istekten yalnız biri kazanır, kaybeden hiçbir
para hareketi yapmaz. Ders kolu bunu yapıyor (`payment_service.pay:170-180`);
deneme bileti ve çalışma rezervasyonu düz ORM ataması kullanıyordu
(denetim P2-8: `library_exam_service.py:539`, `study_reservation_service.py:345`).

## Bu düğüm neden yalnız "durum" değil "TAHSİLAT SAYISI" ölçer

Düz atamanın görünen zararı "iki kez PAID yazıldı" değildir — son yazan kazanır
ve satır tek görünür. Gerçek zarar iki yerdedir:
1. **iki kez tahsilat** yapılır (müşterinin kartından iki kez çekilir),
2. ikinci yazım birincinin `qr_token`'ını **ezer**, yani öğrencinin elindeki
   bilet sessizce geçersizleşir.

Bu yüzden iddia üç ayaklıdır: tek PAID · tek `charge` çağrısı · bilet ezilmedi.

## Yarış nasıl deterministik kuruluyor

`SayanSaglayici.charge_gate` ile birinci tahsilat sağlayıcıda ASILI tutulur;
o pencerede ikinci istek satırı **bayat** (`PENDING_PAYMENT`) okur. Kapı
`sleep` ile değil, "ikinci tahsilat kapıya girdi" ya da "görevlerden biri
bitti" olaylarıyla açılır — ardışıklık tahmin edilmez, ölçülür.
"""
from __future__ import annotations

import asyncio
import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException

from models.library_exam import RegistrationStatus

KAPI_TIMEOUT = 12.0


async def _ilk_gerceklesen(
    olay: asyncio.Event, gorevler: list[asyncio.Task], *, aciklama: str
) -> None:
    """`olay` set olana YA DA görevlerden biri bitene kadar SÜRELİ bekler.

    Çıplak `await olay.wait()` yasaktır: doğru uygulamada ikinci tahsilat hiç
    olmaz ve test kırmızıya değil **sonsuz beklemeye** dönerdi (İP-1a §P1-3).
    """
    kapi = asyncio.ensure_future(olay.wait())
    try:
        bitti, _ = await asyncio.wait(
            {kapi, *gorevler},
            timeout=KAPI_TIMEOUT,
            return_when=asyncio.FIRST_COMPLETED,
        )
        if not bitti:
            pytest.fail(
                f"{KAPI_TIMEOUT:.0f} sn içinde ne ikinci tahsilat ne de bir görev "
                f"sonuçlandı — {aciklama}",
                pytrace=False,
            )
    finally:
        kapi.cancel()


async def _sonuclari_topla(gorevler: list[asyncio.Task]) -> list:
    try:
        return await asyncio.wait_for(
            asyncio.gather(*gorevler, return_exceptions=True), KAPI_TIMEOUT
        )
    except TimeoutError:
        for g in gorevler:
            g.cancel()
        await asyncio.gather(*gorevler, return_exceptions=True)
        pytest.fail(f"{KAPI_TIMEOUT:.0f} sn içinde ödeme görevleri bitmedi", pytrace=False)


def _sadece_409(sonuclar: list) -> None:
    for r in sonuclar:
        if isinstance(r, BaseException):
            if isinstance(r, HTTPException) and r.status_code == 409:
                continue
            raise AssertionError(
                f"beklenmeyen istisna: {r.__class__.__name__}: {r}"
            ) from r


# ═════════════ P-1 · aynı deneme kaydına eşzamanlı iki ödeme ═════════════


async def test_P1_escasman_iki_deneme_odemesi_tek_tahsilat_uretir(
    ip1b, sayan_saglayici, pg
):
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=10)
    ogrenci = await ip1b.ogrenci()
    kayit = await ip1b.kaydol(ogrenci, oturum.id)

    sayan_saglayici.charge_gate = asyncio.Event()
    gorevler = [
        asyncio.create_task(ip1b.ode(ogrenci, kayit.id), name=f"ode-{i}")
        for i in range(2)
    ]
    try:
        await _ilk_gerceklesen(
            sayan_saglayici.ikinci_charge,
            gorevler,
            aciklama="aynı kayda iki eşzamanlı ödeme",
        )
    finally:
        sayan_saglayici.charge_gate.set()
    sonuclar = await _sonuclari_topla(gorevler)
    _sadece_409(sonuclar)

    assert len(sayan_saglayici.charge_calls) == 1, (
        f"aynı kayda {len(sayan_saglayici.charge_calls)} kez tahsilat yapıldı — "
        "`pay()` eşzamanlı çağrıyı seri hâle getirmiyor (denetim P2-8)"
    )
    satirlar = await ip1b.kayitlar(oturum.id)
    assert len(satirlar) == 1
    satir = satirlar[0]
    assert satir["status"] == RegistrationStatus.PAID.value
    assert satir["qr_token"], "ödenmiş kayda bilet basılmadı"


async def test_P1b_zaten_odenmis_kayda_ikinci_odeme_tahsilat_yapmaz(
    ip1b, sayan_saglayici, pg
):
    """Ardışık ikinci `pay()` idempotenttir: yeni tahsilat YOK, bilet EZİLMEZ."""
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=10)
    ogrenci = await ip1b.ogrenci()
    kayit = await ip1b.kaydol(ogrenci, oturum.id)

    await ip1b.ode(ogrenci, kayit.id)
    ilk = (await ip1b.kayitlar(oturum.id))[0]
    await ip1b.ode(ogrenci, kayit.id)
    ikinci = (await ip1b.kayitlar(oturum.id))[0]

    assert len(sayan_saglayici.charge_calls) == 1
    assert ikinci["qr_token"] == ilk["qr_token"], "ikinci ödeme bileti EZDİ"
    assert ikinci["short_code"] == ilk["short_code"]


# ═══════════ P-2 · aynı çalışma rezervasyonuna eşzamanlı iki ödeme ═══════════


async def test_P2_escasman_iki_calisma_odemesi_tek_tahsilat_uretir(
    ip1b, sayan_saglayici, pg
):
    lib = await ip1b.kutuphane(
        capacity=10, study_hourly_price=Decimal("25.00"), saatler=True
    )
    ogrenci = await ip1b.ogrenci()
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo("Europe/Istanbul")
    except Exception:  # noqa: BLE001
        tz = datetime.timezone(datetime.timedelta(hours=3))
    yerel = (datetime.datetime.now(tz) + datetime.timedelta(days=1)).replace(
        hour=10, minute=0, second=0, microsecond=0
    )
    starts = yerel.astimezone(datetime.timezone.utc)
    ends = (yerel + datetime.timedelta(hours=2)).astimezone(datetime.timezone.utc)
    res = await ip1b.rezerve_et(ogrenci, lib.id, starts, ends)

    sayan_saglayici.charge_gate = asyncio.Event()
    gorevler = [
        asyncio.create_task(ip1b.study_ode(ogrenci, res.id), name=f"study-ode-{i}")
        for i in range(2)
    ]
    try:
        await _ilk_gerceklesen(
            sayan_saglayici.ikinci_charge,
            gorevler,
            aciklama="aynı rezervasyona iki eşzamanlı ödeme",
        )
    finally:
        sayan_saglayici.charge_gate.set()
    sonuclar = await _sonuclari_topla(gorevler)
    _sadece_409(sonuclar)

    assert len(sayan_saglayici.charge_calls) == 1, (
        f"aynı rezervasyona {len(sayan_saglayici.charge_calls)} kez tahsilat yapıldı "
        "(denetim P2-8)"
    )
    satirlar = await ip1b.rezervasyonlar(lib.id)
    assert len(satirlar) == 1
    assert satirlar[0]["status"] == RegistrationStatus.PAID.value
    assert satirlar[0]["qr_token"]
