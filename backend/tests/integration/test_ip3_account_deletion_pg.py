"""İP-3 / Bulgu 3 — KVKK hesap silme yalnız CLIENT için çalışıyor.

## Doğrulanan üretim durumu

`services/account_deletion_service.py::anonymize_account`:

    for field in ("iban", "payout_status", "tckn_encrypted"):
        if hasattr(user, field):
            setattr(user, field, None)

- `payout_status` `PayoutMixin`'de **NOT NULL** (`String(10)`, server_default
  `'NONE'`) → eğitmen hesabı silinirken flush NOT NULL ihlali üretir.
- `tckn_encrypted` **hiçbir modelde yoktur** (ölü ad); `hasattr` False döndüğü
  için sessizce hiçbir şey yapmaz. Gerçek alanlar `identity_last4` ve
  `TutorEducation.verification_tckn`'dir ve İKİSİ DE temizlenmez.
- `TutorEducation.document_url` (diploma, `private/` altında) ve
  `verification_code` (e-Devlet barkodu) de kalır.
- `sub_merchant_key` sağlayıcıdaki alt üye işyerine işaret eder; kalır.

Mevcut testler (`tests/verify/test_verify_privacy_and_config.py`) yalnız CLIENT
yolunu geziyor; bu yüzden hata bulunamadı.

## Güvenlik sözleşmesi

1. CLIENT, TUTOR, LIBRARY_OPERATOR ve COURIER için silme 204 döner.
2. NOT NULL alanlar geçerli anonim/pasif değerine çekilir (`payout_status`
   silinmez, `'NONE'` yapılır).
3. TCKN, kimlik son dördü, e-Devlet doğrulama kodu, diploma dosya referansı ve
   alt üye anahtarı temizlenir.
4. Mali/yasal saklama gerektiren satırlar (sipariş, ödeme, escrow tutarları)
   SİLİNMEZ — ayrım bilinçlidir.
5. İşlem idempotenttir: ikinci çağrı 500 üretmez.
6. Denetim kaydı ve hata gövdesi hassas veriyi yeniden sızdırmaz.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.tutor import Tutor, TutorEducation
from tests.integration.ip3_factory import PAROLA, yetki_basligi

SIL = "/api/v1/auth/me/delete"


async def _sil(http, user, parola: str = PAROLA):
    return await http.post(
        SIL, headers=yetki_basligi(user), json={"password": parola}
    )


@pytest.mark.asyncio
async def test_tutor_hesap_silme_hata_vermez(ip3, http):
    """Senaryo 6 — `payout_status = None` NOT NULL ihlali üretiyor."""
    egitmen = await ip3.tutor(with_identity=True)

    r = await _sil(http, egitmen)

    assert r.status_code == 204, (
        f"eğitmen hesap silme başarısız (status={r.status_code}, "
        f"body={r.text[:300]}) — NOT NULL alan None'a çekiliyor olabilir"
    )


@pytest.mark.asyncio
async def test_tutor_kimlik_ve_diploma_verisi_temizlenir(ip3, http):
    """Senaryo 7 — silme sonrası DB'de TCKN/kimlik/diploma izi kalmamalı."""
    egitmen = await ip3.tutor(with_identity=True)

    r = await _sil(http, egitmen)
    assert r.status_code == 204, f"silme başarısız: {r.text[:300]}"

    async with AsyncSessionLocal() as s:
        t = await s.get(Tutor, egitmen.id)
        assert t is not None, "satır fiziksel silinmiş — mali bütünlük için KALMALI"
        assert t.deleted_at is not None and t.is_active is False
        assert t.iban is None, "IBAN duruyor"
        assert t.identity_last4 is None, "kimlik son dördü duruyor"
        assert t.sub_merchant_key is None, "alt üye işyeri anahtarı duruyor"
        assert t.payout_status == "NONE", (
            f"payout_status geçerli anonim değere çekilmemiş: {t.payout_status!r}"
        )

        egitimler = (
            await s.execute(
                select(TutorEducation).where(TutorEducation.tutor_id == egitmen.id)
            )
        ).scalars().all()
        assert egitimler, "eğitim satırı yok — test hiçbir şey ölçmüyor"
        for e in egitimler:
            assert e.verification_tckn is None, "TutorEducation.verification_tckn DURUYOR"
            assert e.verification_code is None, "e-Devlet doğrulama kodu duruyor"
            assert e.document_url is None, "diploma dosya referansı duruyor"


@pytest.mark.asyncio
async def test_library_operator_hesap_silme_calisir(ip3, http):
    """Senaryo 8a — 4. rol hiç sınanmamıştı."""
    lib = await ip3.library()
    op = await ip3.operator(lib)

    r = await _sil(http, op)

    assert r.status_code == 204, (
        f"kütüphane operatörü hesabını silemedi ({r.status_code}): {r.text[:300]}"
    )


@pytest.mark.asyncio
async def test_courier_hesap_silme_calisir(ip3, http):
    """Senaryo 8b — 5. rol hiç sınanmamıştı."""
    kurye = await ip3.courier_account()

    r = await _sil(http, kurye)

    assert r.status_code == 204, (
        f"kurye hesabını silemedi ({r.status_code}): {r.text[:300]}"
    )


@pytest.mark.asyncio
async def test_client_hesap_silme_bozulmadi(ip3, http):
    """Regresyon nöbetçisi: çalışan tek yol bozulmasın."""
    ogrenci = await ip3.client()

    r = await _sil(http, ogrenci)

    assert r.status_code == 204, f"öğrenci silme bozuldu: {r.text[:300]}"


@pytest.mark.asyncio
async def test_silme_idempotent_ikinci_cagri_500_vermez(ip3, http):
    """Aynı token'la ikinci silme denemesi opak 500 değil, kimlik hatası olmalı."""
    egitmen = await ip3.tutor(with_identity=True)
    baslik = yetki_basligi(egitmen)

    ilk = await http.post(SIL, headers=baslik, json={"password": PAROLA})
    assert ilk.status_code == 204, f"ilk silme başarısız: {ilk.text[:300]}"

    ikinci = await http.post(SIL, headers=baslik, json={"password": PAROLA})

    assert ikinci.status_code < 500, (
        f"ikinci silme çağrısı sunucu hatası verdi ({ikinci.status_code})"
    )
    assert ikinci.status_code in (401, 403, 404, 409), (
        f"beklenmeyen durum kodu: {ikinci.status_code}"
    )


@pytest.mark.asyncio
async def test_silme_hatasi_ham_sql_veya_alan_adi_sizdirmaz(ip3, http):
    """Yanlış parolayla gelen istek iç şema ayrıntısı sızdırmamalı."""
    egitmen = await ip3.tutor(with_identity=True)

    r = await http.post(
        SIL, headers=yetki_basligi(egitmen), json={"password": "yanlis-parola"}
    )

    assert r.status_code == 400
    govde = r.text.lower()
    for iz in ("traceback", "insert into", "update ", "payout_status", "tckn", "psycopg", "asyncpg"):
        assert iz not in govde, f"hata gövdesinde iç ayrıntı sızıntısı: {iz!r}"


@pytest.mark.asyncio
async def test_silme_denetim_kaydi_tckn_sizdirmaz(ip3, http):
    """Denetim izi PII'yi geri getirmemeli."""
    egitmen = await ip3.tutor(with_identity=True)

    r = await _sil(http, egitmen)
    assert r.status_code == 204, f"silme başarısız: {r.text[:300]}"

    async with AsyncSessionLocal() as s:
        satirlar = (
            await s.execute(
                text(
                    "SELECT coalesce(details, '') || ' ' || coalesce(reason, '') || ' ' "
                    "|| coalesce(before_values::text, '') || ' ' "
                    "|| coalesce(after_values::text, '') || ' ' "
                    "|| coalesce(metadata::text, '') "
                    "FROM audit_logs WHERE target_id = :i"
                ),
                {"i": egitmen.id},
            )
        ).scalars().all()
    for satir in satirlar:
        assert "12345678901" not in satir, "denetim kaydında TCKN var"
        assert "TR330006100519786457841326" not in satir, "denetim kaydında IBAN var"
