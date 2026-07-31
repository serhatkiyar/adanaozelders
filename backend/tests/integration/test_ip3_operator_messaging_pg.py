"""İP-3 / Bulgu 1 — Onaysız ve ilişkisiz kütüphane operatörü mesajlaşması.

## Doğrulanan üretim durumu (bu testler yazılmadan ÖNCE koddan okundu)

`services/messaging_service.py::_can_message` taraflardan biri LIBRARY ise
**koşulsuz `True`** döner: ilişki aranmaz. `_validate_target` yalnız HEDEF
kütüphaneyken `status == ACTIVE` ister; operatör GÖNDEREN olduğunda kendi
kütüphanesinin durumuna hiç bakılmaz. `POST /libraries/register` (public,
self-servis) anında geçerli bir LIBRARY_OPERATOR token'ı ürettiğinden, henüz
onaylanmamış (PENDING) bir başvurunun operatörü ardışık öğrenci id'leri
tarayarak DM açabilir. Üstüne `api/routers/messages.py` operatörü telefon
doğrulama kapısından da muaf tutar.

## Güvenlik sözleşmesi

1. Kütüphanesi ACTIVE olmayan (PENDING/REJECTED/HIDDEN/silinmiş) operatör
   mesaj GÖNDEREMEZ → 403.
2. ACTIVE operatör yalnız **gerçek iş ilişkisi** olan öğrenciye yazabilir:
   o kütüphanenin bir deneme oturumuna kaydı, o kütüphanede çalışma
   rezervasyonu, ya da öğrencinin kendi başlattığı mevcut sohbet.
3. İlişkisiz öğrenciye yazma denemesi kimlik/varlık bilgisi SIZDIRMAZ.
4. LIBRARY↔TUTOR çiftinin karşılığı olan bir iş ilişkisi modeli YOKTUR →
   kapalıdır.
5. Öğrenci → ACTIVE kütüphane yönü açıktır (public işletmeye destek talebi);
   bu talep ilişkiyi doğurur ve operatörün cevaplamasını meşrulaştırır.
"""
from __future__ import annotations

import pytest

from models.library import LibraryStatus
from tests.integration.ip3_factory import yetki_basligi

KOK = "/api/v1/messages"


async def _gonder(http, gonderen, alici_rol: str, alici_id: int, govde="merhaba"):
    return await http.post(
        f"{KOK}/{alici_id}",
        headers=yetki_basligi(gonderen),
        json={"body": govde, "counterparty_role": alici_rol},
    )


@pytest.mark.asyncio
async def test_pending_kutuphane_operatoru_iliskisiz_ogrenciye_dm_acamaz(ip3, http):
    """Senaryo 1 — self-servis kayıt anında geçerli token verir; onay vermez."""
    lib = await ip3.library(status=LibraryStatus.PENDING.value)
    op = await ip3.operator(lib)
    ogrenci = await ip3.client()

    r = await _gonder(http, op, "CLIENT", ogrenci.id)

    assert r.status_code == 403, (
        f"PENDING kütüphane operatörü DM açabildi (status={r.status_code}). "
        "Self-servis kayıt onay DEĞİLDİR."
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("durum", ["REJECTED", "HIDDEN"])
async def test_reddedilmis_veya_gizlenmis_kutuphane_operatoru_yazamaz(ip3, http, durum):
    """Onay geri alınmış/verilmemiş her durum aynı kapıdan geçmeli."""
    lib = await ip3.library(status=durum)
    op = await ip3.operator(lib)
    ogrenci = await ip3.client()

    r = await _gonder(http, op, "CLIENT", ogrenci.id)

    assert r.status_code == 403, f"{durum} kütüphane operatörü DM açabildi"


@pytest.mark.asyncio
async def test_aktif_ama_iliskisiz_operator_dm_acamaz(ip3, http):
    """Senaryo 2 — ACTIVE olmak, rastgele öğrenciye yazma hakkı vermez."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    yabanci = await ip3.client()

    r = await _gonder(http, op, "CLIENT", yabanci.id)

    assert r.status_code in (403, 404), (
        f"ACTIVE ama ilişkisiz operatör yabancı öğrenciye DM açtı "
        f"(status={r.status_code})"
    )


@pytest.mark.asyncio
async def test_iliskisiz_hedefte_kimlik_sizmaz(ip3, http):
    """Senaryo 15 — yabancı kaynakta yanıt gövdesi kimlik/varlık sızdırmaz.

    Var olan ilişkisiz bir öğrenci ile HİÇ VAR OLMAYAN bir id aynı sonucu
    vermeli; aksi halde operatör id taraması ile "bu id'de öğrenci var mı"
    sorusunu cevaplayabilir.
    """
    lib = await ip3.library()
    op = await ip3.operator(lib)
    yabanci = await ip3.client()

    var_olan = await _gonder(http, op, "CLIENT", yabanci.id)
    olmayan = await _gonder(http, op, "CLIENT", 2_000_000_000)

    assert var_olan.status_code == olmayan.status_code, (
        "var olan ilişkisiz öğrenci ile var olmayan id farklı yanıt veriyor → "
        f"varlık sızıyor ({var_olan.status_code} vs {olmayan.status_code})"
    )
    govde = var_olan.text.lower()
    for sizinti in (yabanci.username.lower(), yabanci.email.lower()):
        assert sizinti not in govde, f"yanıt gövdesinde kimlik sızıntısı: {sizinti!r}"


@pytest.mark.asyncio
async def test_deneme_kaydi_olan_ogrenciye_aktif_operator_yazabilir(ip3, http):
    """Senaryo 3 — gerçek ilişki (o kütüphanenin oturumuna ödenmiş kayıt) açar."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    ogrenci = await ip3.client()
    sess = await ip3.exam_session(lib)
    await ip3.exam_registration(sess, ogrenci, status="PAID")

    r = await _gonder(http, op, "CLIENT", ogrenci.id, "Deneme yarın 09:00'da.")

    assert r.status_code == 201, (
        f"gerçek ilişkili operatör mesaj GÖNDEREMEDİ (status={r.status_code}, "
        f"body={r.text[:200]})"
    )


@pytest.mark.asyncio
async def test_calisma_rezervasyonu_da_iliski_sayilir(ip3, http):
    """İlişki tek kaynağa bağlanmamalı: koltuk rezervasyonu da meşru bağdır."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    ogrenci = await ip3.client()
    await ip3.study_reservation(lib, ogrenci, status="PAID")

    r = await _gonder(http, op, "CLIENT", ogrenci.id, "Yerin ayrıldı.")

    assert r.status_code == 201, (
        f"çalışma rezervasyonu olan öğrenciye operatör yazamadı ({r.status_code})"
    )


@pytest.mark.asyncio
async def test_baska_kutuphanenin_iliskisi_bu_operatore_kapi_acmaz(ip3, http):
    """İlişki kütüphane bazlıdır: A kütüphanesindeki kayıt B operatörünü yetkilendirmez."""
    lib_a = await ip3.library()
    lib_b = await ip3.library()
    op_b = await ip3.operator(lib_b)
    ogrenci = await ip3.client()
    sess_a = await ip3.exam_session(lib_a)
    await ip3.exam_registration(sess_a, ogrenci, status="PAID")

    r = await _gonder(http, op_b, "CLIENT", ogrenci.id)

    assert r.status_code in (403, 404), (
        f"başka kütüphanenin kaydı B operatörüne kapı açtı ({r.status_code})"
    )


@pytest.mark.asyncio
async def test_operator_egitmene_yazamaz(ip3, http):
    """LIBRARY↔TUTOR için tanımlı bir iş ilişkisi modeli yok → kapalı."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    egitmen = await ip3.tutor()

    r = await _gonder(http, op, "TUTOR", egitmen.id)

    assert r.status_code in (403, 404), (
        f"operatör ilişkisiz eğitmene DM açtı ({r.status_code})"
    )


@pytest.mark.asyncio
async def test_ogrenci_pending_kutuphaneye_yazamaz(ip3, http):
    """Onaysız kütüphane public değildir; öğrenci ona da yazamaz (mevcut davranış
    korunuyor — regresyon nöbetçisi)."""
    lib = await ip3.library(status=LibraryStatus.PENDING.value)
    await ip3.operator(lib)
    ogrenci = await ip3.client()

    r = await _gonder(http, ogrenci, "LIBRARY", lib.id)

    assert r.status_code == 404, f"öğrenci PENDING kütüphaneye yazabildi ({r.status_code})"


@pytest.mark.asyncio
async def test_ogrencinin_actigi_sohbete_operator_cevap_verebilir(ip3, http):
    """Öğrenci ACTIVE kütüphaneye destek talebi açar → operatör cevaplayabilir."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    ogrenci = await ip3.client()

    ilk = await _gonder(http, ogrenci, "LIBRARY", lib.id, "Salonunuz kaçta açılıyor?")
    assert ilk.status_code == 201, f"öğrenci ACTIVE kütüphaneye yazamadı ({ilk.text[:200]})"

    cevap = await _gonder(http, op, "CLIENT", ogrenci.id, "09:00'da açılıyoruz.")
    assert cevap.status_code == 201, (
        f"operatör kendi sohbetine cevap veremedi ({cevap.status_code})"
    )


@pytest.mark.asyncio
async def test_telefonu_dogrulanmamis_pending_operator_yine_403(ip3, http):
    """Telefon muafiyeti onay kapısının yerini TUTAMAZ.

    `messages.py` operatörü `require_phone_verified`'dan muaf tutuyor; gerekçesi
    "operatör admin-oluşturmalı". Self-servis kayıt bu varsayımı geçersiz kıldı.
    Muafiyet korunacaksa bile onaysız operatör mesaj gönderememelidir.
    """
    lib = await ip3.library(status=LibraryStatus.PENDING.value)
    op = await ip3.operator(lib, phone_verified=False)
    ogrenci = await ip3.client()

    r = await _gonder(http, op, "CLIENT", ogrenci.id)

    assert r.status_code == 403, (
        f"telefonu doğrulanmamış PENDING operatör mesaj gönderdi ({r.status_code})"
    )
