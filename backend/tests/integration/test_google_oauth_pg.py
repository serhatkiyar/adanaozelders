"""Google kimlik çözümlemesi — GERÇEK Postgres.

Burada ölçülen, `google_oauth_service.cozumle`nin veritabanıyla ilişkisidir:
hangi satır doğar, hangisi doğmaz, hangi kolon değişir. Bunlar sahte bir
oturumla kanıtlanamaz, çünkü asıl iddialar tekillik indeksleri ve çapraz tablo
sorguları üzerinde duruyor.

Google'ın kendisi taklit edilir: `verify_id_token` zaten
`tests/test_google_oidc_dogrulama.py` içinde ağsız olarak ölçülüyor, burada
claim'ler doğrudan verilir. Yani bu dosya "token doğru mu" değil, "doğru
token'la ne oluyor" sorusunu cevaplar.
"""
from __future__ import annotations

import datetime
import uuid

import pytest
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.client import Client
from models.consent import UserConsent
from models.oauth_identity import OAuthIdentity
from models.refresh_token import RefreshToken
from models.tutor import Tutor
from services import google_oauth_service as gos

pytestmark = pytest.mark.asyncio

ONAY_SURUMU = "2026-09-06"


async def _kapi_acik(db):
    """Kayıt kapısının açık hâli (router'daki `_kayit_kapisi` yerine)."""
    return None


async def _kapi_kapali(db):
    from fastapi import HTTPException, status

    raise HTTPException(status.HTTP_403_FORBIDDEN, "Yeni üye kaydı şu anda kapalı.")


def _claims(*, email: str, sub: str | None = None, ad="Ada", soyad="Deneme") -> dict:
    return {
        "sub": sub or f"g-{uuid.uuid4().hex[:16]}",
        "email": email,
        "email_verified": True,
        "given_name": ad,
        "family_name": soyad,
    }


def _eposta() -> str:
    return f"goauth-{uuid.uuid4().hex[:10]}@ornek-google.example.com"


async def _temizle(*, emailler: tuple[str, ...] = (), subjectler: tuple[str, ...] = ()):
    """Testin ürettiği satırları FİZİKSEL siler (suite hijyen nöbetçisi var)."""
    async with AsyncSessionLocal() as s:
        for e in emailler:
            for tablo in ("clients", "tutors"):
                satirlar = (
                    await s.execute(text(f"SELECT id, role_id FROM {tablo} WHERE email = :e"), {"e": e})
                ).all()
                for sid, rol in satirlar:
                    await s.execute(
                        text("DELETE FROM user_consents WHERE user_id = :i AND role_id = :r"),
                        {"i": sid, "r": rol},
                    )
                    await s.execute(
                        text("DELETE FROM refresh_tokens WHERE user_id = :i AND role_id = :r"),
                        {"i": sid, "r": rol},
                    )
                    await s.execute(
                        text("DELETE FROM oauth_identities WHERE user_id = :i AND role_id = :r"),
                        {"i": sid, "r": rol},
                    )
                await s.execute(text(f"DELETE FROM {tablo} WHERE email = :e"), {"e": e})
        for sub in subjectler:
            await s.execute(
                text("DELETE FROM oauth_identities WHERE subject = :s"), {"s": sub}
            )
        await s.commit()


async def _cozumle(claims, *, mod="giris", rol=None, kapi=_kapi_acik):
    async with AsyncSessionLocal() as s:
        sonuc = await gos.cozumle(
            s,
            claims,
            mod=mod,
            rol=rol,
            onay_surumu=ONAY_SURUMU,
            ip="203.0.113.7",
            user_agent="pytest",
            kayit_kapisi=kapi,
        )
        await s.commit()
        return sonuc


# ── 1. Kayit kolu ────────────────────────────────────────────────────────────


async def test_kayit_parolasiz_ve_dogrulanmis_hesap_acar(pg):
    email = _eposta()
    c = _claims(email=email)
    try:
        user, olay = await _cozumle(c, mod="kayit", rol="client")
        assert olay == "kayit"

        async with AsyncSessionLocal() as s:
            satir = (
                await s.execute(select(Client).where(Client.email == email))
            ).scalar_one()
            # Parolasiz: Google ile acilan hesabin parolasi YOKTUR.
            assert satir.hashed_password is None
            assert satir.has_password is False
            # Google `email_verified: true` demeden buraya gelinmiyor; adres
            # zaten kanitlanmis, dogrulama e-postasi gondermek anlamsiz olurdu.
            assert satir.email_verified_at is not None
            assert satir.first_name == "Ada" and satir.last_name == "Deneme"
    finally:
        await _temizle(emailler=(email,), subjectler=(c["sub"],))


async def test_kayitta_KVKK_ISPAT_KAYDI_yazilir(pg):
    """Üç zorunlu onay (KVKK/koşullar/gizlilik) doğru sürümle kayda geçmeli.

    Form kaydında bunu `auth.py::_record_signup_consents` yapıyor. Google kolu
    atlasaydı ispat yükü karşılanmazdı: "onayladım/onaylamadım" tartışmasında
    gösterilecek hiçbir kayıt olmazdı.
    """
    email = _eposta()
    c = _claims(email=email)
    try:
        user, _ = await _cozumle(c, mod="kayit", rol="client")
        async with AsyncSessionLocal() as s:
            onaylar = (
                await s.execute(
                    select(UserConsent).where(
                        UserConsent.user_id == user.id,
                        UserConsent.role_id == user.role_id,
                    )
                )
            ).scalars().all()
        anahtarlar = {o.doc_key for o in onaylar}
        assert anahtarlar == {"kvkk", "terms", "privacy"}, anahtarlar
        assert all(o.doc_version == ONAY_SURUMU for o in onaylar)
        assert all(o.granted for o in onaylar)
        # IP ve user-agent ispat baglami olarak yazilir.
        assert all(o.ip == "203.0.113.7" for o in onaylar)
    finally:
        await _temizle(emailler=(email,), subjectler=(c["sub"],))


async def test_egitmen_kaydi_tutors_tablosuna_gider(pg):
    email = _eposta()
    c = _claims(email=email)
    try:
        user, olay = await _cozumle(c, mod="kayit", rol="tutor")
        assert olay == "kayit" and isinstance(user, Tutor)
        async with AsyncSessionLocal() as s:
            assert (
                await s.execute(select(Tutor.id).where(Tutor.email == email))
            ).first() is not None
            assert (
                await s.execute(select(Client.id).where(Client.email == email))
            ).first() is None
    finally:
        await _temizle(emailler=(email,), subjectler=(c["sub"],))


async def test_kayit_kapisi_KAPALIYKEN_hicbir_satir_dogmaz(pg):
    """Kapı `start`ta da denetleniyor ama asıl kilit burada: aradaki pencere
    kullanıcının Google ekranında geçirdiği süre kadar geniş."""
    email = _eposta()
    c = _claims(email=email)
    try:
        with pytest.raises(Exception):
            await _cozumle(c, mod="kayit", rol="client", kapi=_kapi_kapali)
        async with AsyncSessionLocal() as s:
            assert (
                await s.execute(select(Client.id).where(Client.email == email))
            ).first() is None
            assert (
                await s.execute(
                    select(OAuthIdentity.id).where(OAuthIdentity.subject == c["sub"])
                )
            ).first() is None
    finally:
        await _temizle(emailler=(email,), subjectler=(c["sub"],))


# ── 2. Giris kolu: hesap ACMAZ ───────────────────────────────────────────────


async def test_giris_modunda_hesap_yoksa_SATIR_DOGMAZ(pg):
    """Giriş düğmesine basan kişi hesabı olduğunu sanıyordur. Sessizce ikinci
    bir hesap yaratmak onu kendi verisinden ayırırdı."""
    email = _eposta()
    c = _claims(email=email)
    try:
        with pytest.raises(gos.OAuthAkisHatasi) as hata:
            await _cozumle(c, mod="giris")
        assert hata.value.kod == "hesap_yok"
        async with AsyncSessionLocal() as s:
            assert (
                await s.execute(select(Client.id).where(Client.email == email))
            ).first() is None
            assert (
                await s.execute(
                    select(OAuthIdentity.id).where(OAuthIdentity.subject == c["sub"])
                )
            ).first() is None
    finally:
        await _temizle(emailler=(email,), subjectler=(c["sub"],))


# ── 3. Bagli kimlik ──────────────────────────────────────────────────────────


async def test_ikinci_giris_YENI_SATIR_URETMEZ(pg):
    email = _eposta()
    c = _claims(email=email)
    try:
        birinci, _ = await _cozumle(c, mod="kayit", rol="client")
        ikinci, olay = await _cozumle(c, mod="giris")
        assert olay == "giris"
        assert ikinci.id == birinci.id
        async with AsyncSessionLocal() as s:
            kimlikler = (
                await s.execute(
                    select(OAuthIdentity).where(OAuthIdentity.subject == c["sub"])
                )
            ).scalars().all()
        assert len(kimlikler) == 1
    finally:
        await _temizle(emailler=(email,), subjectler=(c["sub"],))


async def test_google_epostasi_degisince_KULLANICININ_EPOSTASI_DEGISMEZ(pg):
    """Bağ `sub`a kurulu; kullanıcının kendi e-postası dışarıdan gelen bir
    değerle güncellenirse hem ÜK-5 tekilliği hem hesap devri koruması delinir.
    Yalnız denetim izi tazelenir."""
    email = _eposta()
    yeni_google_epostasi = _eposta()
    c = _claims(email=email)
    try:
        user, _ = await _cozumle(c, mod="kayit", rol="client")
        await _cozumle({**c, "email": yeni_google_epostasi}, mod="giris")

        async with AsyncSessionLocal() as s:
            satir = (await s.execute(select(Client).where(Client.id == user.id))).scalar_one()
            assert satir.email == email, "kullanıcının e-postası değişmemeliydi"
            kimlik = (
                await s.execute(
                    select(OAuthIdentity).where(OAuthIdentity.subject == c["sub"])
                )
            ).scalar_one()
            assert kimlik.email == yeni_google_epostasi, "iz tazelenmeliydi"
    finally:
        await _temizle(emailler=(email, yeni_google_epostasi), subjectler=(c["sub"],))


# ── 4. Otomatik baglama ──────────────────────────────────────────────────────


async def test_mevcut_hesaba_OTOMATIK_BAGLANIR(pg, ip3):
    """Ürün kararı: Google `email_verified` döndüğü için adresin sahibi
    kanıtlanmıştır; kullanıcı parolayla açtığı hesaba Google ile de girer."""
    mevcut = await ip3.client()
    c = _claims(email=mevcut.email)
    try:
        user, olay = await _cozumle(c, mod="giris")
        assert olay == "baglandi"
        assert user.id == mevcut.id
        async with AsyncSessionLocal() as s:
            kimlik = (
                await s.execute(
                    select(OAuthIdentity).where(OAuthIdentity.subject == c["sub"])
                )
            ).scalar_one()
            assert kimlik.user_id == mevcut.id
            assert kimlik.role_id == mevcut.role_id
    finally:
        await _temizle(subjectler=(c["sub"],))


async def test_baglanan_hesapta_PAROLA_KORUNUR(pg, ip3):
    """Bağlama mevcut giriş yolunu kapatmamalı: kullanıcı isterse parolasıyla
    girmeye devam edebilir."""
    mevcut = await ip3.client()
    c = _claims(email=mevcut.email)
    try:
        await _cozumle(c, mod="giris")
        async with AsyncSessionLocal() as s:
            satir = (await s.execute(select(Client).where(Client.id == mevcut.id))).scalar_one()
            assert satir.hashed_password is not None
            assert satir.has_password is True
    finally:
        await _temizle(subjectler=(c["sub"],))


async def test_DOGRULANMAMIS_hesaba_baglanirken_oturumlar_dusurulur(pg, ip3):
    """En ince güvenlik kararı.

    E-postası hiç doğrulanmamış bir hesabı, o adresi yazan ama sahibi olmayan
    biri açmış olabilir. Adresin gerçek sahibi Google ile kanıtlayıp geldiğinde
    kanıtsız oturumlar düşmeli: `auth_version` artar (mevcut access token'lar
    anında ölür) ve refresh token'lar iptal edilir.
    """
    from services import refresh_token_service

    mevcut = await ip3.client()
    async with AsyncSessionLocal() as s:
        satir = (await s.execute(select(Client).where(Client.id == mevcut.id))).scalar_one()
        satir.email_verified_at = None  # doğrulanmamış hâle getir
        await s.commit()
        onceki_surum = satir.auth_version
        await refresh_token_service.issue(
            s, role_id=mevcut.role_id, user_id=mevcut.id, persistent=True
        )
        await s.commit()

    c = _claims(email=mevcut.email)
    try:
        await _cozumle(c, mod="giris")
        async with AsyncSessionLocal() as s:
            satir = (await s.execute(select(Client).where(Client.id == mevcut.id))).scalar_one()
            assert satir.email_verified_at is not None, "Google doğruladı, işaretlenmeliydi"
            assert satir.auth_version == onceki_surum + 1, "oturum sürümü artmalıydı"

            canli = (
                await s.execute(
                    select(RefreshToken).where(
                        RefreshToken.user_id == mevcut.id,
                        RefreshToken.role_id == mevcut.role_id,
                        RefreshToken.revoked_at.is_(None),
                    )
                )
            ).scalars().all()
            assert canli == [], "kanıtsız oturumlar düşürülmeliydi"
    finally:
        await _temizle(subjectler=(c["sub"],))


async def test_DOGRULANMIS_hesaba_baglanirken_oturumlar_DUSMEZ(pg, ip3):
    """Ters prova: yukarıdaki düşürme her bağlamada değil, YALNIZ doğrulanmamış
    hesapta olmalı. Her girişte oturum düşürmek kullanıcıyı diğer
    cihazlarından atardı."""
    from services import refresh_token_service

    mevcut = await ip3.client()
    async with AsyncSessionLocal() as s:
        satir = (await s.execute(select(Client).where(Client.id == mevcut.id))).scalar_one()
        satir.email_verified_at = datetime.datetime.now(datetime.timezone.utc)
        await s.commit()
        onceki_surum = satir.auth_version
        await refresh_token_service.issue(
            s, role_id=mevcut.role_id, user_id=mevcut.id, persistent=True
        )
        await s.commit()

    c = _claims(email=mevcut.email)
    try:
        await _cozumle(c, mod="giris")
        async with AsyncSessionLocal() as s:
            satir = (await s.execute(select(Client).where(Client.id == mevcut.id))).scalar_one()
            assert satir.auth_version == onceki_surum
            canli = (
                await s.execute(
                    select(RefreshToken).where(
                        RefreshToken.user_id == mevcut.id,
                        RefreshToken.revoked_at.is_(None),
                    )
                )
            ).scalars().all()
            assert len(canli) >= 1
    finally:
        await _temizle(subjectler=(c["sub"],))


# ── 5. UK-5: bir e-posta = bir hesap ─────────────────────────────────────────


async def test_UK5_egitmen_epostasiyla_UYE_kaydi_IKINCI_SATIR_URETMEZ(pg, ip3):
    """ÜK-5'in Google kolundaki karşılığı.

    Karar bir üretim hatasından doğmuştu: aynı e-posta hem `tutors` hem
    `clients`ta olunca `_LOGIN_PRECEDENCE` yüzünden client hesabına bir daha
    girilemiyordu. Google kolu `_email_taken`ı atlasaydı o hata geri gelirdi.
    """
    egitmen = await ip3.tutor()
    c = _claims(email=egitmen.email)
    try:
        user, olay = await _cozumle(c, mod="kayit", rol="client")
        # Yeni bir Client DOGMAZ; mevcut Tutor'a baglanir.
        assert olay == "baglandi"
        assert isinstance(user, Tutor) and user.id == egitmen.id
        async with AsyncSessionLocal() as s:
            assert (
                await s.execute(select(Client.id).where(Client.email == egitmen.email))
            ).first() is None
    finally:
        await _temizle(subjectler=(c["sub"],))


async def test_UK5_register_google_user_KENDI_KAPISINI_tasir(pg, ip3):
    """`register_google_user`in tekillik kapısını DOĞRUDAN ölçer.

    Mutasyon provasında ölçüldü: `_email_taken` çağrısı silindiğinde diğer
    testler yeşil kalıyordu, çünkü hepsi `find_by_email` kolunda durup buraya
    hiç ulaşmıyor. Kapıya normal akışta yalnız YARIŞ durumunda gelinir
    (`find_by_email` ile bu satır arasında aynı e-posta kaydolursa), ve tam da
    o yüzden nöbetsiz kalırsa kimse fark etmez.

    Yarışı zamanla kurmak yerine kapı doğrudan sürülüyor: ölçülmek istenen
    "eşzamanlılık" değil, "kapı duruyor mu".
    """
    from fastapi import HTTPException

    from models.role import RoleType
    from services import auth_service

    egitmen = await ip3.tutor()
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as hata:
            await auth_service.register_google_user(
                s,
                rol=RoleType.CLIENT,
                email=egitmen.email,
                first_name="Ada",
                last_name="Deneme",
            )
    assert hata.value.status_code == 409

    async with AsyncSessionLocal() as s:
        assert (
            await s.execute(select(Client.id).where(Client.email == egitmen.email))
        ).first() is None


async def test_ayni_hesaba_IKINCI_google_hesabi_baglanamaz(pg, ip3):
    """`uq_oauth_identities_provider_user`: "hangi Google hesabı bu hesabı
    açar" sorusunun tek bir cevabı olmalı."""
    mevcut = await ip3.client()
    ilk = _claims(email=mevcut.email)
    ikinci = _claims(email=mevcut.email)
    try:
        await _cozumle(ilk, mod="giris")
        with pytest.raises(gos.OAuthAkisHatasi) as hata:
            await _cozumle(ikinci, mod="giris")
        assert hata.value.kod == "baska_google_bagli"
    finally:
        await _temizle(subjectler=(ilk["sub"], ikinci["sub"]))


# ── 6. Hesap yasam dongusu ───────────────────────────────────────────────────


async def test_PASIF_hesap_google_ile_de_acilmaz(pg, ip3):
    mevcut = await ip3.client()
    async with AsyncSessionLocal() as s:
        satir = (await s.execute(select(Client).where(Client.id == mevcut.id))).scalar_one()
        satir.is_active = False
        await s.commit()

    c = _claims(email=mevcut.email)
    try:
        with pytest.raises(gos.OAuthAkisHatasi) as hata:
            await _cozumle(c, mod="giris")
        assert hata.value.kod == "pasif"
    finally:
        await _temizle(subjectler=(c["sub"],))


async def test_SILINMIS_hesap_google_ile_geri_donmez(pg, ip3):
    """Soft-delete edilmiş hesap bağlı kimliğiyle geri giriş yapamamalı."""
    mevcut = await ip3.client()
    c = _claims(email=mevcut.email)
    try:
        await _cozumle(c, mod="giris")
        async with AsyncSessionLocal() as s:
            satir = (await s.execute(select(Client).where(Client.id == mevcut.id))).scalar_one()
            satir.deleted_at = datetime.datetime.now(datetime.timezone.utc)
            await s.commit()

        with pytest.raises(gos.OAuthAkisHatasi) as hata:
            await _cozumle(c, mod="giris")
        assert hata.value.kod == "hesap_yok"
    finally:
        await _temizle(subjectler=(c["sub"],))
