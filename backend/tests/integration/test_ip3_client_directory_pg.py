"""İP-3 / Bulgu 4 — Öğrenci dizini ilişkisiz eğitmenlere açık.

## Doğrulanan üretim durumu

`api/routers/clients.py::_approved_viewer` yalnız "ADMIN ya da **onaylı**
eğitmen" der. Onaydan sonra:

- `GET /clients/search` bütün öğrenci tabanını `limit`/`offset` ile sayfalar
  (ad-soyad, kullanıcı adı, **doğum tarihi**, cinsiyet, hakkında, avatar),
- `GET /clients/{id}` ardışık id taramasıyla tek tek okunabilir; üstüne
  `educations` (okul geçmişi) da döner.

İlişki kontrolü hiçbir yerde yoktur. Kitlenin bir bölümü reşit değildir.
Frontend `useClientSearch` hook'unu HİÇBİR sayfada çağırmıyor — yani toplu
dizin ucunun karşılığı olan bir ürün ihtiyacı da yok; yalnız ilişkili öğrenci
profili (`StudentProfile`, ders/soru/mesaj bağlamından) kullanılıyor.

## Güvenlik sözleşmesi

1. Toplu öğrenci dizini eğitmene KAPALIDIR.
2. Eğitmen yalnız meşru rezervasyon ilişkisi olan öğrencinin profilini görür
   (geçmiş dersler dahil; ilişki bir kez kurulduysa kalır).
3. İlişkisiz öğrenci ile var olmayan id AYNI yanıtı verir (varlık sızmaz).
4. Reşit olmayan kullanıcı riskine karşı tam doğum tarihi DÖNMEZ; ders
   planlaması için gereken `age` yeterlidir.
5. ADMIN için `users.view` izniyle erişim korunur.
"""
from __future__ import annotations

import pytest

from models.booking import BookingStatus
from tests.integration.ip3_factory import yetki_basligi

KOK = "/api/v1/clients"


@pytest.mark.asyncio
async def test_iliskisiz_egitmen_toplu_ogrenci_dizinini_alamaz(ip3, http):
    """Senaryo 9 — onaylı eğitmen bütün öğrenci tabanını sayfalayamamalı."""
    egitmen = await ip3.tutor()
    await ip3.client()
    await ip3.client()

    r = await http.get(
        f"{KOK}/search", params={"limit": 100}, headers=yetki_basligi(egitmen)
    )

    assert r.status_code in (403, 404), (
        f"onaylı eğitmen toplu öğrenci dizinini aldı (status={r.status_code}, "
        f"{len(r.json()) if r.status_code == 200 else '-'} kayıt)"
    )


@pytest.mark.asyncio
async def test_iliskisiz_ogrenci_profili_okunamaz(ip3, http):
    """Ardışık id taraması ile veri çıkarılamamalı."""
    egitmen = await ip3.tutor()
    yabanci = await ip3.client()

    r = await http.get(f"{KOK}/{yabanci.id}", headers=yetki_basligi(egitmen))

    assert r.status_code == 404, (
        f"ilişkisiz öğrenci profili okundu ({r.status_code}): {r.text[:200]}"
    )


@pytest.mark.asyncio
async def test_iliskisiz_ogrenci_ile_olmayan_id_ayni_yanit(ip3, http):
    """Varlık sızıntısı: "bu id'de öğrenci var mı" sorusu cevaplanamamalı."""
    egitmen = await ip3.tutor()
    yabanci = await ip3.client()

    var_olan = await http.get(f"{KOK}/{yabanci.id}", headers=yetki_basligi(egitmen))
    olmayan = await http.get(f"{KOK}/2000000000", headers=yetki_basligi(egitmen))

    assert var_olan.status_code == olmayan.status_code, (
        f"varlık sızıyor: {var_olan.status_code} vs {olmayan.status_code}"
    )
    assert yabanci.username.lower() not in var_olan.text.lower()


@pytest.mark.asyncio
async def test_iliskili_ogrencinin_profili_gorunur(ip3, http):
    """Senaryo 10a — kapı kapanırken meşru kullanım kaybolmamalı.

    `StudentProfile` sayfası ders/soru/mesaj bağlamından açılır; eğitmen kendi
    öğrencisinin profilini görebilmelidir.
    """
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    await ip3.booking(egitmen, ogrenci, status=BookingStatus.COMPLETED)

    r = await http.get(f"{KOK}/{ogrenci.id}", headers=yetki_basligi(egitmen))

    assert r.status_code == 200, (
        f"ilişkili öğrencinin profili görünmüyor ({r.status_code}): {r.text[:200]}"
    )
    assert r.json()["id"] == ogrenci.id


@pytest.mark.asyncio
async def test_bekleyen_rezervasyon_da_iliski_sayilir(ip3, http):
    """Eğitmen daha kabul etmeden öğrenciyi değerlendirebilmeli (PENDING talep)."""
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    await ip3.booking(egitmen, ogrenci, status=BookingStatus.PENDING, gecmis=False)

    r = await http.get(f"{KOK}/{ogrenci.id}", headers=yetki_basligi(egitmen))

    assert r.status_code == 200, (
        f"bekleyen rezervasyonun öğrencisi görünmüyor ({r.status_code})"
    )


@pytest.mark.asyncio
async def test_iliskili_ogrencide_tam_dogum_tarihi_donmez(ip3, http):
    """Senaryo 10b — reşit olmayan kitle için daha dar veri sözleşmesi.

    Ders seviyesi için YAŞ yeterlidir; tam doğum tarihi kimlik doğrulama ve
    hesap kurtarma saldırılarında kullanılan bir alandır.
    """
    egitmen = await ip3.tutor()
    ogrenci = await ip3.client()
    await ip3.booking(egitmen, ogrenci, status=BookingStatus.COMPLETED)

    r = await http.get(f"{KOK}/{ogrenci.id}", headers=yetki_basligi(egitmen))

    assert r.status_code == 200, r.text[:200]
    govde = r.json()
    assert govde.get("birth_date") is None, (
        f"eğitmene tam doğum tarihi döndü: {govde.get('birth_date')!r}"
    )
    assert govde.get("age") is not None, (
        "yaş bilgisi de kayboldu — meşru ihtiyaç karşılanmıyor"
    )


@pytest.mark.asyncio
async def test_admin_izinle_ogrenci_profiline_erisir(ip3, http):
    """Yetkili admin erişimi korunur (moderasyon/destek)."""
    admin = await ip3.admin(permissions=["users.view"])
    ogrenci = await ip3.client()

    r = await http.get(f"{KOK}/{ogrenci.id}", headers=yetki_basligi(admin))

    assert r.status_code == 200, (
        f"users.view izinli admin öğrenci profilini göremedi ({r.status_code})"
    )


@pytest.mark.asyncio
async def test_izinsiz_admin_ogrenci_profiline_erisemez(ip3, http):
    """ADMIN olmak tek başına yetmez; görev izni gerekir."""
    admin = await ip3.admin(permissions=[])
    ogrenci = await ip3.client()

    r = await http.get(f"{KOK}/{ogrenci.id}", headers=yetki_basligi(admin))

    assert r.status_code in (403, 404), (
        f"izinsiz admin öğrenci profilini gördü ({r.status_code})"
    )
