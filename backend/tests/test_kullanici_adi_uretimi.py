"""Kullanıcı adı üretimi — kayıt formu artık sormuyor.

NEDEN BU TEST VAR: kayıt 4 alana indirildi (e-posta, parola, ad, soyad) ve
kullanıcı adı sunucuda üretiliyor. Üretimin iki sessiz kırılma yolu var ve
ikisi de kullanıcıya 500 olarak döner:

1. Desen ihlali — `USERNAME_PATTERN` yalnız `[a-zA-Z0-9_]` kabul eder. Türkçe
   ad ("Şeyma Güngör") veya tireli soyad, `slugify_tr`'den tireyle çıkar.
2. Çakışma — aynı adı taşıyan ikinci kişi kayıt olamaz.

DB'ye gerek yok: tekillik sorgusu tek bir yardımcıda toplandığı için
(`_username_taken`) yerine sahte konur ve saf üretim mantığı ölçülür.
"""
from __future__ import annotations

import re

import pytest

from schemas.user import USERNAME_PATTERN
from services import auth_service


@pytest.fixture
def alinmis(monkeypatch):
    """`_username_taken`'ı kümeye bağlar; küme testin kontrolünde."""
    kume: set[str] = set()

    async def _sahte(db, username, **_kw):  # noqa: ANN001
        return username in kume

    monkeypatch.setattr(auth_service, "_username_taken", _sahte)
    return kume


async def _uret(ad: str, soyad: str) -> str:
    return await auth_service._turet_kullanici_adi(None, ad, soyad)


@pytest.mark.parametrize(
    "ad, soyad, beklenen",
    [
        ("Ahmet", "Yılmaz", "ahmet_yilmaz"),
        ("Şeyma", "Güngör", "seyma_gungor"),
        ("İdil", "Öztürk", "idil_ozturk"),
        ("Ayşe Nur", "Çağlar", "ayse_nur_caglar"),
    ],
)
@pytest.mark.anyio
async def test_turkce_ad_desene_uyar(alinmis, ad, soyad, beklenen):
    """Türkçe harfler ASCII'ye katlanır, boşluk/tire alt çizgi olur."""
    assert await _uret(ad, soyad) == beklenen


@pytest.mark.anyio
async def test_uretilen_ad_daima_desene_uyar(alinmis):
    """Desen ihlali kayıt anında 500 demek — üretim bunu üretemez.

    ASCII'ye hiç katlanamayan ad (yalnız Kiril/emoji) uç durumdur; taban boş
    kalırsa yedek ad devreye girer.
    """
    desen = re.compile(USERNAME_PATTERN)
    for ad, soyad in [
        ("Ahmet", "Yılmaz"),
        ("O'Brien", "D'Angelo"),
        ("Ali-Kaan", "Şen-Yıldız"),
        ("陳", "大文"),
        ("A", "B"),
        ("x" * 60, "y" * 60),
    ]:
        uretilen = await _uret(ad, soyad)
        assert desen.match(uretilen), f"{ad} {soyad} → {uretilen!r}"
        assert 3 <= len(uretilen) <= 50, uretilen


@pytest.mark.anyio
async def test_cakismada_yeni_ad_uretir(alinmis):
    """İkinci 'Ahmet Yılmaz' da kayıt olabilmeli."""
    alinmis.add("ahmet_yilmaz")
    ikinci = await _uret("Ahmet", "Yılmaz")
    assert ikinci != "ahmet_yilmaz"
    assert ikinci.startswith("ahmet_yilmaz_")
    assert re.match(USERNAME_PATTERN, ikinci)


@pytest.mark.anyio
async def test_taban_ve_tum_sayilar_doluyken_de_ad_uretir(monkeypatch):
    """Her aday alınmışsa bile üretim SONSUZ DÖNMEZ, bir ad döndürür.

    Sıralı sayaç yerine rastgele son ek kullanıldığı için kuyruk durumunda
    tıkanma riski buradadır; sözleşme 'her koşulda geçerli bir ad' olmalı.
    """
    async def _hep_dolu(db, username, **_kw):  # noqa: ANN001
        return True

    monkeypatch.setattr(auth_service, "_username_taken", _hep_dolu)
    uretilen = await _uret("Ahmet", "Yılmaz")
    assert re.match(USERNAME_PATTERN, uretilen)
    assert len(uretilen) <= 50
