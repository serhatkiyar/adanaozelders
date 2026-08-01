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


@pytest.mark.asyncio
async def test_silmede_denylist_ttl_kalan_omur_kadar(ip3, http):
    """TB — denylist TTL'i MUTLAK EPOCH değil, token'ın KALAN ÖMRÜ olmalı.

    `api/routers/auth.py::delete_my_account` `revoke(jti, exp - now)` çağırır.
    `exp` doğrudan TTL olarak verilseydi (yazılması çok kolay bir hata) Redis
    anahtarı ~55 YIL yaşardı: sessiz bir kaynak sızıntısı, hiçbir davranış
    testinin göremeyeceği türden — çünkü "silme sonrası eski token 401" iddiası
    denylist tamamen kaldırılsa bile geçer (hesap zaten pasifleşiyor).
    Dolayısıyla bu değer SAYISAL ölçülmek zorundadır.

    Ölçüm gerçek Redis üzerinden yapılır: sahte nesneyle çağrı argümanını
    yakalamak yalnız router'daki aritmetiği görür; anahtarın gerçekten doğru
    adla yazıldığını ve okuma ucunun onu bulduğunu görmez.
    """
    from core import token_denylist
    from core.config import settings
    from core.security import decode_access_token
    from core.token_denylist import _PREFIX, is_revoked
    from tests.service_guard import servis_yok

    ogrenci = await ip3.client()
    token = yetki_basligi(ogrenci)["Authorization"].removeprefix("Bearer ")
    jti = decode_access_token(token)["jti"]

    # `token_denylist._client` süreç ömrü boyunca ÖNBELLEKLENİR ve asyncpg gibi
    # redis.asyncio bağlantıları da açıldıkları event loop'a bağlıdır.
    # pytest-asyncio her teste yeni loop kurduğu için önbellekteki istemci
    # "Event loop is closed" verir; bu bir ALTYAPI YOKLUĞU DEĞİLDİR. Ayrım
    # yapılmazsa test "Redis erişilemiyor" diye SKIP olur ve nöbetçi hiç
    # koşmadan yeşil görünür — ilk koşumda tam olarak bu yaşandı.
    token_denylist._client = None
    r = token_denylist._redis()
    if r is None:
        servis_yok("Redis", RuntimeError("denylist istemcisi kurulamadı"))
    try:
        await r.ping()
    except Exception as exc:  # noqa: BLE001 — yalnız "servis yok" ayrımı için
        servis_yok("Redis", exc)

    silme = await http.post(
        SIL, headers={"Authorization": f"Bearer {token}"}, json={"password": PAROLA}
    )
    assert silme.status_code == 204, f"silme başarısız: {silme.text[:300]}"

    ttl = await r.ttl(f"{_PREFIX}{jti}")

    assert ttl > 0, (
        f"denylist anahtarı yok ya da TTL'siz (ttl={ttl}) — iptal ya hiç "
        "yazılmadı ya da sonsuza dek yaşayacak"
    )
    tavan = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    # ASIL nöbetçi bu ÜST sınırdır: epoch (~1.7e9) yazılırsa `> 0` geçer, bu
    # kırılır. Alt sınır saat farkı/gecikme için 120 sn tolerans bırakır.
    assert ttl <= tavan, (
        f"denylist TTL'i token ömrünü aşıyor (ttl={ttl}s, tavan={tavan}s) — "
        "mutlak epoch TTL olarak verilmiş olabilir (~55 yıl)"
    )
    assert ttl >= tavan - 120, (
        f"denylist TTL'i beklenenden kısa (ttl={ttl}s, beklenen ≈{tavan}s) — "
        "token kalan ömrünü doldurmadan denylist'ten düşer"
    )

    assert await is_revoked(jti) is True, (
        "anahtar yazıldı ama okuma ucu bulamıyor (önek/ad uyuşmazlığı)"
    )

    # Test izi Redis'te de kalmaz; istemci bu loop'a bağlı olduğu için önbellek
    # de boşaltılır (sonraki test bayat bağlantı almasın).
    await r.delete(f"{_PREFIX}{jti}")
    await r.aclose()
    token_denylist._client = None
