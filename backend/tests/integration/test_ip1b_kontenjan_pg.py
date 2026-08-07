"""İP-1b K düğümleri — kütüphane kolunda KONTENJAN (GERÇEK PostgreSQL).

## Ölçülen iş kuralı

Bir deneme oturumuna `capacity` sayısından fazla **ödenmiş** kayıt, bir
kütüphanenin çalışma alanına da aynı saat aralığında `capacity` sayısından
fazla **ödenmiş** rezervasyon giremez. Kural üç yazma yolunun HEPSİNDE
geçerlidir: `register()/reserve()`, `pay()` ve iyzico callback'i
(`complete_checkout`).

## Neden "kaç kayıt var" değil "kaç PARA ALINDI" ölçülüyor

Ödeme bekleyen tutma (PENDING_PAYMENT) geçicidir; süresi dolunca koltuk
serbest kalır. Kalıcı zarar, kapasitenin üzerinde **tahsilat** yapılmasıdır:
ders günü salona sığmayan öğrencinin parası emanettedir ve
`REFUND_WINDOW_HOURS` dolduysa iade de edilemez (`library_exam_service.py`
`cancel_registration`). Bu yüzden her düğümün nihai iddiası
`Ip1bFabrika.koltuk_tutanlar()` (PAID + ATTENDED) üzerinden kurulur.

## Yarış nasıl kuruluyor

`asyncio.gather` + **her görev için ayrı `AsyncSessionLocal`** (fabrika
metotları kendi oturumlarını açar). Tek oturumda "aynı anda" iki çağrı yapmak
yarış KURMAZ; ikinci çağrı birincinin yazdığını görür ve DB seviyesindeki
koruma hiç sınanmaz (İP-1a sözleşmesi §9c/4'te yakalanan kusur).

`asyncio.sleep` YOKTUR. Yarışın gerçekten kurulduğunun kanıtı, düğümlerin
düzeltme öncesi KIRMIZI olmasıdır: koruma yoksa fazla satış gerçekleşir.
"""
from __future__ import annotations

import asyncio
import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from models.library_exam import RegistrationStatus
from services import library_exam_service

try:
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo("Europe/Istanbul")
except Exception:  # noqa: BLE001
    _TZ = datetime.timezone(datetime.timedelta(hours=3))


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _yarin_saat(saat: int = 10, sure_saat: int = 2) -> tuple[datetime.datetime, datetime.datetime]:
    """Yarın yerel `saat`:00'da başlayan pencere (UTC döner).

    Yerel saatle sabitlenir çünkü `study_reservation_service._assert_within_hours`
    pencerenin TEK bir yerel güne sığmasını şart koşar; UTC'de "şimdi + 1 gün"
    demek gece yarısını sarabilir ve test **yanlış** kırmızıya düşerdi.
    """
    yerel = (datetime.datetime.now(_TZ) + datetime.timedelta(days=1)).replace(
        hour=saat, minute=0, second=0, microsecond=0
    )
    return (
        yerel.astimezone(datetime.timezone.utc),
        (yerel + datetime.timedelta(hours=sure_saat)).astimezone(datetime.timezone.utc),
    )


def _ayikla(sonuclar: list) -> tuple[list, list]:
    """(başarılılar, 409'lar) — başka her istisna yükseltilir.

    Beklenmeyen bir hatayı "çatışma" sayıp yutmak, kontenjanı hiç zorlamayan
    bir uygulamayı da yeşil gösterebilirdi (ör. 500 üreten bir kod "kayıt
    olmadı" diye okunurdu).
    """
    basarili = [r for r in sonuclar if not isinstance(r, BaseException)]
    catisma = []
    for r in sonuclar:
        if not isinstance(r, BaseException):
            continue
        if isinstance(r, HTTPException) and r.status_code == 409:
            catisma.append(r)
        else:
            raise AssertionError(
                f"beklenmeyen istisna: {r.__class__.__name__}: {r}"
            ) from r
    return basarili, catisma


# ═══════════════════════ K-1 · eşzamanlı kayıt yarışı ═══════════════════════


async def test_K1_iki_kisilik_oturuma_bes_escasman_kayit(ip1b, pg):
    """2 kişilik oturuma 5 eşzamanlı kayıt → tam olarak 2'si başarılı."""
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=2)
    ogrenciler = [await ip1b.ogrenci() for _ in range(5)]

    sonuclar = await asyncio.gather(
        *[ip1b.kaydol(o, oturum.id) for o in ogrenciler], return_exceptions=True
    )
    basarili, catisma = _ayikla(list(sonuclar))

    assert len(basarili) == 2, (
        f"2 kişilik oturuma {len(basarili)} kayıt kabul edildi — kontenjan hiçbir "
        f"katmanda zorlanmıyor (409 sayısı: {len(catisma)})"
    )
    assert len(catisma) == 3

    satirlar = await ip1b.kayitlar(oturum.id)
    assert len(satirlar) == 2, f"DB'de {len(satirlar)} kayıt kaldı"


# ═══════════════ K-2 · ödeme bekleyen tutma koltuk tutuyor mu ═══════════════


async def test_K2_pending_payment_koltuk_tutar(ip1b, pg):
    """1 kişilik oturumda ödeme bekleyen tutma varken ikinci kayıt reddedilir."""
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=1)
    a, b = await ip1b.ogrenci(), await ip1b.ogrenci()

    ilk = await ip1b.kaydol(a, oturum.id)
    assert ilk.status == RegistrationStatus.PENDING_PAYMENT.value

    with pytest.raises(HTTPException) as hata:
        await ip1b.kaydol(b, oturum.id)
    assert hata.value.status_code == 409, (
        "ödeme bekleyen tutma koltuk tutmuyor — kontenjan kadar kişi kaydolup "
        "hepsi ödeyebilir (denetim P1-20)"
    )


# ═════════════════════ K-3 · pay() kontenjanı kontrol eder ═════════════════════


async def test_K3_pay_kontenjani_kontrol_eder(ip1b, sayan_saglayici, pg):
    """Tutması sona ermiş kayıt, koltuğu başkası aldıysa ÖDEYEMEZ.

    Kurulum her iki sürümde de aynı invariant'ı ölçer:
    - düzeltme ÖNCESİ `hold_bitir` no-op'tur; iki kayıt da açılır ve ikisi de
      öder → 1 kişilik oturumda 2 tahsilat (KIRMIZI);
    - düzeltme SONRASI A'nın tutması sona erer, koltuğu B alır ve A'nın
      ödemesi 409 ile reddedilir → tek tahsilat.
    """
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=1)
    a, b = await ip1b.ogrenci(), await ip1b.ogrenci()

    kayit_a = await ip1b.kaydol(a, oturum.id)
    await ip1b.hold_bitir("exam_registrations", kayit_a.id)

    try:
        kayit_b = await ip1b.kaydol(b, oturum.id)
    except HTTPException as e:  # pragma: no cover - kurulum bozulursa görünür olsun
        pytest.fail(f"B kaydolamadı, senaryo kurulamadı: {e.detail}")

    for ogrenci, kayit in ((b, kayit_b), (a, kayit_a)):
        try:
            await ip1b.ode(ogrenci, kayit.id)
        except HTTPException as e:
            assert e.status_code == 409, f"beklenmeyen ödeme hatası: {e.status_code}"

    koltuklar = ip1b.koltuk_tutanlar(await ip1b.kayitlar(oturum.id))
    assert len(koltuklar) == 1, (
        f"1 kişilik oturumda {len(koltuklar)} ödenmiş kayıt var — pay() kontenjanı "
        "kontrol etmiyor (denetim P1-20)"
    )
    assert len(sayan_saglayici.charge_calls) == 1, (
        f"kontenjan dolu olmasına rağmen {len(sayan_saglayici.charge_calls)} tahsilat "
        "denendi"
    )


# ═══════════ K-4 · complete_checkout (iyzico callback) kontenjanı görür ═══════════


async def test_K4_complete_checkout_kontenjani_kontrol_eder(ip1b, sayan_saglayici, pg):
    """Koltuk dolduktan sonra gelen callback bilet BASMAZ; para iade edilir."""
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=1)
    a, b = await ip1b.ogrenci(), await ip1b.ogrenci()

    kayit_a = await ip1b.kaydol(a, oturum.id)
    await ip1b.hold_bitir("exam_registrations", kayit_a.id)
    kayit_b = await ip1b.kaydol(b, oturum.id)
    await ip1b.ode(b, kayit_b.id)  # koltuk B'nin

    from core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        await library_exam_service.complete_checkout(
            s,
            registration_id=kayit_a.id,
            success=True,
            provider_ref="ip1b-cf-ref",
        )
        await s.commit()

    satirlar = await ip1b.kayitlar(oturum.id)
    koltuklar = ip1b.koltuk_tutanlar(satirlar)
    assert len(koltuklar) == 1, (
        f"callback kontenjanı aştı — {len(koltuklar)} ödenmiş kayıt (denetim P1-20)"
    )
    a_satir = next(r for r in satirlar if r["id"] == kayit_a.id)
    assert a_satir["status"] != RegistrationStatus.PAID.value
    assert a_satir["qr_token"] is None, "kontenjan dışı kayda bilet basıldı"
    assert sayan_saglayici.refund_calls, (
        "kontenjan dolu olduğu için kesinleştirilemeyen tahsilat İADE EDİLMEDİ — "
        "para kara delikte kaldı"
    )


# ══════════════════ K-5 · eşzamanlı iki pay() kontenjanı aşamaz ══════════════════


async def test_K5_escasman_iki_odeme_kontenjani_asamaz(ip1b, sayan_saglayici, pg):
    """1 kişilik oturumda tutmasız iki kayıt eşzamanlı öderse yalnız biri geçer.

    Ön-durum (`ham_kayit`) bir para durumu SAHTELEMEZ: iki satır da
    `PENDING_PAYMENT`'tır. Bu durum üretimde de doğar — tutması sona ermiş ya
    da bu sürümden önce açılmış kayıtlar. `pay()` ona karşı doğru davranmak
    zorundadır.
    """
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=1)
    a, b = await ip1b.ogrenci(), await ip1b.ogrenci()
    reg_a = await ip1b.ham_kayit(session_id=oturum.id, client_id=a.id)
    reg_b = await ip1b.ham_kayit(session_id=oturum.id, client_id=b.id)

    sonuclar = await asyncio.gather(
        ip1b.ode(a, reg_a), ip1b.ode(b, reg_b), return_exceptions=True
    )
    _ayikla(list(sonuclar))

    koltuklar = ip1b.koltuk_tutanlar(await ip1b.kayitlar(oturum.id))
    assert len(koltuklar) == 1, (
        f"eşzamanlı iki ödeme {len(koltuklar)} koltuk sattı (kapasite 1) — pay() "
        "kontenjanı seri hâle getirmiyor"
    )


# ═══════════ K-6 · çalışma alanı: eşzamanlı iki rezervasyon, tek koltuk ═══════════


async def test_K6_escasman_calisma_rezervasyonu_kapasiteyi_asamaz(
    ip1b, sayan_saglayici, pg
):
    """Kapasite 1 iken aynı slota iki eşzamanlı rezervasyon → tek ödenmiş kalır."""
    lib = await ip1b.kutuphane(
        capacity=1, study_hourly_price=Decimal("25.00"), saatler=True
    )
    starts, ends = _yarin_saat()
    a, b = await ip1b.ogrenci(), await ip1b.ogrenci()

    sonuclar = await asyncio.gather(
        ip1b.rezerve_et(a, lib.id, starts, ends),
        ip1b.rezerve_et(b, lib.id, starts, ends),
        return_exceptions=True,
    )
    basarili, _ = _ayikla(list(sonuclar))

    eslesme = {a.id: a, b.id: b}
    for res in basarili:
        try:
            await ip1b.study_ode(eslesme[res.client_id], res.id)
        except HTTPException as e:
            assert e.status_code == 409, f"beklenmeyen ödeme hatası: {e.status_code}"

    aktif = await ip1b.cakisan_aktif(lib.id, starts, ends)
    assert aktif == 1, (
        f"1 koltukluk çalışma alanında çakışan {aktif} ödenmiş rezervasyon var — "
        "kapasite hiçbir katmanda zorlanmıyor (denetim P1-20)"
    )


# ══════════ K-7 · aynı öğrencinin çakışan rezervasyonu DB'de engellenir ══════════


async def test_K7_ayni_ogrencinin_cakisan_rezervasyonu_db_de_engellenir(ip1b, pg):
    """Aynı öğrenci, aynı kütüphanede çakışan İKİ ödenmiş rezervasyon tutamaz.

    Bu düğüm bilinçli olarak **servis katmanını atlar**: iddia "DB kuralı var
    mı"dır. Ders tarafı bunu `ex_bookings_no_overlap` GiST exclusion'ı ile
    çözmüştür (`models/booking.py:103-109`); `study_reservations`'ta ne
    exclusion ne tekillik kısıtı vardı (denetim P1-20).
    """
    lib = await ip1b.kutuphane(capacity=5, study_hourly_price=Decimal("25.00"))
    starts, ends = _yarin_saat()
    ogrenci = await ip1b.ogrenci()

    await ip1b.ham_rezervasyon(
        library_id=lib.id,
        client_id=ogrenci.id,
        starts=starts,
        ends=ends,
        status=RegistrationStatus.PAID.value,
    )
    with pytest.raises(IntegrityError):
        await ip1b.ham_rezervasyon(
            library_id=lib.id,
            client_id=ogrenci.id,
            starts=starts + datetime.timedelta(minutes=30),
            ends=ends + datetime.timedelta(minutes=30),
            status=RegistrationStatus.PAID.value,
        )
