"""Parolasız hesap (Google ile açılmış) parola yolundan ASLA açılmaz.

## Bu nöbetçi neden var — ölçülmüş gerekçe

`hashed_password` beş kullanıcı tablosunda da NULL olabilir hale geldi. İlk
akla gelen alternatif, kolonu NOT NULL bırakıp sentinel bir hash (`"!"`)
yazmaktı: depo bu sentinel'i zaten iki yerde kullanıyor
(`api/deps.get_shopping_client` gölge satırı, `account_deletion_service`
anonimleştirmesi), yani "migration'dan kurtuluruz" cazipti.

Ölçüm bunu çürüttü:

    bcrypt.checkpw(b"sifre", b"!")  ->  ValueError: Invalid salt

ve `core/security.verify_password` bu istisnayı yakalamıyordu. Sentinel bugün
patlamıyor çünkü onu taşıyan iki satır tipi de `authenticate`'in sorgusundan
zaten düşüyor: gölge `_exclude_shadow` ile, silinmiş hesap `deleted_at` ile.
**Google hesabı bunun tersidir** — canlı, silinmemiş, gölge değil; yani
`authenticate`'in tam da bulacağı satır. Sentinel seçilseydi o e-postayla bir
parola denemesi 401 değil **500** dönerdi ve "var olmayan e-posta 401 /
Google hesabı 500" ayrımı bir hesap-varlığı yan kanalı olurdu.

## Gücü ve sınırı (kök CLAUDE.md → C)

Buradaki testler `authenticate`/`change_password`/`verify_password`
davranışını sahte oturumla ölçer; gerçek HTTP + gerçek Postgres kanıtı
`tests/integration/test_google_oauth_pg.py` dosyasındadır. Bu dosyanın işi,
üç savunmadan biri sessizce kaldırılırsa CI'ın kırılması.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from core.security import hash_password, verify_password
from models.client import Client
from models.role import ROLE_IDS, RoleType


# ── verify_password: dogrulanamayan her durum False, ISTISNA DEGIL ────────────


@pytest.mark.parametrize(
    "hash_degeri, aciklama",
    [
        (None, "parolasız hesap (Google)"),
        ("", "boş dize"),
        ("!", "sentinel — bcrypt burada ValueError fırlatır"),
        ("bozuk-hash", "biçimi geçersiz hash"),
    ],
)
def test_verify_password_dogrulanamayani_false_doner(hash_degeri, aciklama):
    assert verify_password("herhangi", hash_degeri) is False, aciklama


def test_verify_password_gercek_hash_hala_calisiyor():
    """Kalkan doğru parolayı da yutmuş olmasın — ters prova."""
    h = hash_password("DogruParola123")
    assert verify_password("DogruParola123", h) is True
    assert verify_password("YanlisParola", h) is False


# ── authenticate: parolasiz hesap parola ile ACILMAZ ─────────────────────────


class _SahteSonuc:
    def __init__(self, deger):
        self._deger = deger

    def scalar_one_or_none(self):
        return self._deger


class _SahteDB:
    """`_LOGIN_PRECEDENCE` beş tabloyu sırayla gezer; her çağrıya sıradaki satır."""

    def __init__(self, sirali_satirlar):
        self._kalan = list(sirali_satirlar)

    async def execute(self, _stmt):
        return _SahteSonuc(self._kalan.pop(0) if self._kalan else None)


def _parolasiz_client() -> Client:
    return Client(
        id=42,
        email="google@ornek.com",
        hashed_password=None,
        is_active=True,
        role_id=ROLE_IDS[RoleType.CLIENT],
        first_name="Ada",
        last_name="Deneme",
        auth_version=1,
    )


@pytest.mark.asyncio
async def test_parolasiz_hesap_parola_ile_acilmaz():
    """Asıl iddia: eşleşme YOK ve istisna da YOK (yani 401, 500 değil)."""
    from services import auth_service

    # ADMIN, TUTOR bulunamadı; CLIENT sırasında parolasız satır çıktı.
    db = _SahteDB([None, None, _parolasiz_client(), None, None])
    user, role = await auth_service.authenticate(
        db, email="google@ornek.com", password="herhangi"
    )
    assert user is None and role is None


@pytest.mark.asyncio
async def test_parolasiz_hesapta_bcrypt_HIC_CAGRILMAZ(monkeypatch):
    """`authenticate`in KENDİ kontrolünü çıpalar — kalkan onu maskelemesin.

    Mutasyon provasında ölçüldü: `authenticate`ten
    `user.hashed_password is not None` satırı silindiğinde diğer testlerin
    hepsi YEŞİL kalıyordu, çünkü `verify_password`in yedek kalkanı aynı sonucu
    üretiyor. Yani birincil savunma nöbetsizdi ve sessizce silinebilirdi.

    İki katmanı ayıran tek gözlem, bcrypt'e gidilip gidilmediğidir: açık
    kontrol varken hash doğrulaması HİÇ çağrılmaz. Bu aynı zamanda davranışın
    kendisi için de doğru olan iddiadır — yok olan bir parolayı doğrulamak
    için ~250 ms CPU harcamanın anlamı yok.
    """
    from services import auth_service

    cagri_sayisi = 0

    async def _sayan(password, hashed_password):
        nonlocal cagri_sayisi
        cagri_sayisi += 1
        return False

    monkeypatch.setattr(auth_service, "verify_password_async", _sayan)

    db = _SahteDB([None, None, _parolasiz_client(), None, None])
    user, _ = await auth_service.authenticate(
        db, email="google@ornek.com", password="herhangi"
    )

    assert user is None
    assert cagri_sayisi == 0, (
        "Parolasız hesapta hash doğrulamasına gidildi: `authenticate` içindeki "
        "`hashed_password is not None` kontrolü kaldırılmış olmalı. Yedek kalkan "
        "sonucu düzeltir ama birincil savunma kaybolur."
    )


@pytest.mark.asyncio
async def test_parolali_hesapta_bcrypt_CAGRILIR(monkeypatch):
    """Ters prova: yukarıdaki sayaç her durumda 0 kalan bir ölü iddia değil."""
    from services import auth_service

    cagri_sayisi = 0

    async def _sayan(password, hashed_password):
        nonlocal cagri_sayisi
        cagri_sayisi += 1
        return True

    monkeypatch.setattr(auth_service, "verify_password_async", _sayan)

    satir = _parolasiz_client()
    satir.hashed_password = hash_password("DogruParola123")
    db = _SahteDB([None, None, satir, None, None])
    user, _ = await auth_service.authenticate(
        db, email="google@ornek.com", password="DogruParola123"
    )

    assert user is satir
    assert cagri_sayisi == 1


@pytest.mark.asyncio
async def test_parolasiz_hesap_bos_parolayla_da_acilmaz():
    from services import auth_service

    db = _SahteDB([None, None, _parolasiz_client(), None, None])
    user, _ = await auth_service.authenticate(db, email="google@ornek.com", password="")
    assert user is None


@pytest.mark.asyncio
async def test_parolali_hesap_hala_acilir():
    """Ters prova: koruma, çalışan girişi de kapatmış olmasın."""
    from services import auth_service

    user_satiri = _parolasiz_client()
    user_satiri.hashed_password = hash_password("DogruParola123")

    db = _SahteDB([None, None, user_satiri, None, None])
    user, role = await auth_service.authenticate(
        db, email="google@ornek.com", password="DogruParola123"
    )
    assert user is user_satiri
    assert role is RoleType.CLIENT


# ── change_password: parolasiz hesapta anlamli hata ───────────────────────────


@pytest.mark.asyncio
async def test_change_password_parolasiz_hesapta_yonlendirici_mesaj_verir():
    """"Parola hatalı" demek yanlış olurdu: kullanıcı olmayan bir parolayı
    hatırlamaya çalışırdı. Doğru yol "Şifremi unuttum" akışıdır."""
    from services import auth_service

    with pytest.raises(HTTPException) as hata:
        await auth_service.change_password(
            _SahteDB([]),
            _parolasiz_client(),
            current_password="herhangi",
            new_password="YeniParola123",
        )

    assert hata.value.status_code == 400
    assert "Şifremi unuttum" in hata.value.detail


# ── UserOut sozlesmesi ────────────────────────────────────────────────────────


def test_has_password_parolanin_varligini_bildirir():
    kullanici = _parolasiz_client()
    assert kullanici.has_password is False

    kullanici.hashed_password = hash_password("DogruParola123")
    assert kullanici.has_password is True
