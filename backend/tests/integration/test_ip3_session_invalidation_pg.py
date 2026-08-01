"""İP-3 / Bulgu 6 — Şifre değişimi/sıfırlaması mevcut access token'ı öldürmüyor.

## Doğrulanan üretim durumu

`services/auth_service.change_password` / `reset_password` yalnız
`refresh_token_service.revoke_all_for_user` çağırır. Access token:

- `ACCESS_TOKEN_EXPIRE_MINUTES = 60` (core/config.py) → **bir saate kadar**
  yaşamaya devam eder,
- denylist'e (`core/token_denylist`) yalnız `/auth/logout` ve hesap silme yazar,
- `auth_version` claim'i `api/deps.py`'de YALNIZ `CourierAccount` için
  denetlenir (`if model is CourierAccount and ...`), ve kuryede bile
  `change_password` sürümü artırmaz.

Yani "şifremi değiştirdim, saldırgan atıldı" taahhüdü hiçbir rolde tam
karşılanmıyor.

Ayrıca iki ayrı rol kataloğu drift etmiş:

- `auth_service._LOGIN_PRECEDENCE` → 5 rol (ADMIN, TUTOR, CLIENT,
  LIBRARY_OPERATOR, COURIER) — `find_by_email` bunu kullanır, yani sıfırlama
  maili operatöre/kuryeye GİDER,
- `verification_service._MODEL_BY_ROLE` → yalnız 3 rol. `consume_token`
  `_MODEL_BY_ROLE.get(role_id)` None dönünce token'ı geçersiz sayar → operatör
  ve kurye "şifremi unuttum" akışını TAMAMLAYAMAZ.

## Güvenlik sözleşmesi

1. Şifre değişimi ve sıfırlaması, BÜTÜN rollerde mevcut access token'ları da
   geçersizleştirir (eski token anında 401).
2. Oturum sürümü (`auth_version` ya da eşdeğeri) gerçek auth dependency'sinde
   bütün kullanıcı tipleri için denetlenir.
3. Rol→model eşlemesi tek kaynaktan türetilir; ikinci bir katalog tutulmaz.
4. İşlemi yapan cihaz atılmaz: yeni token'la istek çalışır.
5. Sıfırlama akışı 5 rolün hepsinde uçtan uca tamamlanır.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from core.database import AsyncSessionLocal
from core.security import decode_access_token
from models.admin import Admin
from models.client import Client
from models.courier_account import CourierAccount
from models.library_operator import LibraryOperator
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from models.verification_token import TokenPurpose, VerificationToken
from tests.integration.ip3_factory import PAROLA, yetki_basligi

ME = "/api/v1/auth/me"
SIFRE = "/api/v1/auth/me/password"
RESET_ISTE = "/api/v1/auth/password-reset/request"
RESET_ONAY = "/api/v1/auth/password-reset/confirm"
YENI_PAROLA = "ip3-yeni-sifre-456"


async def _kullanici(ip3, rol: str):
    if rol == "CLIENT":
        return await ip3.client()
    if rol == "TUTOR":
        return await ip3.tutor()
    if rol == "ADMIN":
        return await ip3.admin(permissions=[])
    if rol == "LIBRARY_OPERATOR":
        return await ip3.operator(await ip3.library())
    if rol == "COURIER":
        return await ip3.courier_account()
    raise AssertionError(rol)


ROLLER = ["CLIENT", "TUTOR", "ADMIN", "LIBRARY_OPERATOR", "COURIER"]


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ROLLER)
async def test_sifre_degisiminden_sonra_eski_access_token_401(ip3, http, rol):
    """Senaryo 13 — beş rolün her biri ayrı ayrı kanıtlanır."""
    user = await _kullanici(ip3, rol)
    eski = yetki_basligi(user)

    onceki = await http.get(ME, headers=eski)
    assert onceki.status_code == 200, (
        f"{rol}: kurulum bozuk, eski token baştan çalışmıyor ({onceki.status_code})"
    )

    degis = await http.post(
        SIFRE,
        headers=eski,
        json={"current_password": PAROLA, "new_password": YENI_PAROLA},
    )
    assert degis.status_code == 200, f"{rol}: şifre değişmedi — {degis.text[:200]}"

    sonraki = await http.get(ME, headers=eski)

    assert sonraki.status_code == 401, (
        f"{rol}: şifre değiştikten SONRA eski access token hâlâ geçerli "
        f"({sonraki.status_code}) — çalınmış token bir saat daha yaşıyor"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ROLLER)
async def test_sifre_degisimi_islemi_yapan_cihazi_atmaz(ip3, http, rol):
    """Senaryo 13b — kapı kapanırken kullanıcının kendisi dışarıda kalmamalı."""
    user = await _kullanici(ip3, rol)

    degis = await http.post(
        SIFRE,
        headers=yetki_basligi(user),
        json={"current_password": PAROLA, "new_password": YENI_PAROLA},
    )
    assert degis.status_code == 200, f"{rol}: {degis.text[:200]}"
    yeni_token = degis.json().get("access_token")
    assert yeni_token, f"{rol}: yanıtta yeni access token yok"

    r = await http.get(ME, headers={"Authorization": f"Bearer {yeni_token}"})

    assert r.status_code == 200, (
        f"{rol}: şifre değişiminden sonra YENİ token da çalışmıyor ({r.status_code})"
    )


#: Rol → model. Test tarafında BİLİNÇLİ olarak elle yazılır: üretimdeki
#: kataloğun (`auth_service._LOGIN_PRECEDENCE`) doğruluğunu ölçmek istiyoruz,
#: onu ithal edersek aynı hatayı tekrarlarız.
_MODEL = {
    ROLE_IDS[RoleType.ADMIN]: Admin,
    ROLE_IDS[RoleType.TUTOR]: Tutor,
    ROLE_IDS[RoleType.CLIENT]: Client,
    ROLE_IDS[RoleType.LIBRARY_OPERATOR]: LibraryOperator,
    ROLE_IDS[RoleType.COURIER]: CourierAccount,
}


async def _reset_tokeni(user) -> str:
    """Sıfırlama token'ı üretir (ham token yalnız e-posta linkinde olduğu ve
    DB'de SHA-256 hash'li saklandığı için mailden okunamaz).

    Ölçülen şey **tüketim** tarafıdır: `verification_service.consume_token`
    rol kataloğu.
    """
    from services import verification_service

    async with AsyncSessionLocal() as s:
        db_user = await s.get(_MODEL[user.role_id], user.id)
        raw = await verification_service.issue_token(
            s, user=db_user, purpose=TokenPurpose.PASSWORD_RESET
        )
        await s.commit()
    return raw


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ROLLER)
async def test_password_reset_tum_rollerde_tamamlanir(ip3, http, rol):
    """Senaryo 14 — LibraryOperator ve Courier `_MODEL_BY_ROLE`'da yok."""
    user = await _kullanici(ip3, rol)
    raw = await _reset_tokeni(user)

    r = await http.post(
        RESET_ONAY, json={"token": raw, "new_password": YENI_PAROLA}
    )

    assert r.status_code == 200, (
        f"{rol}: şifre sıfırlama tamamlanamadı ({r.status_code}) — rol kataloğu "
        f"eksik olabilir: {r.text[:200]}"
    )

    # Yeni parola gerçekten geçerli mi? (Sıfırlamanın gözlemlenebilir sonucu.)
    giris = await http.post(
        "/api/v1/auth/login",
        data={"username": user.email, "password": YENI_PAROLA},
    )
    assert giris.status_code == 200, (
        f"{rol}: sıfırlama sonrası yeni parolayla giriş yapılamadı "
        f"({giris.status_code}): {giris.text[:200]}"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ROLLER)
async def test_reset_sonrasi_eski_access_token_401(ip3, http, rol):
    """Sıfırlama da (değişim gibi) mevcut oturumları düşürmeli.

    "Şifremi unuttum" akışının ASIL amacı hesabı ele geçirenin atılmasıdır;
    saldırganın elindeki access token bir saat daha yaşarsa akış amacını
    karşılamaz.
    """
    user = await _kullanici(ip3, rol)
    eski = yetki_basligi(user)
    assert (await http.get(ME, headers=eski)).status_code == 200, f"{rol}: kurulum bozuk"

    raw = await _reset_tokeni(user)
    r = await http.post(RESET_ONAY, json={"token": raw, "new_password": YENI_PAROLA})
    assert r.status_code == 200, f"{rol}: sıfırlama başarısız — {r.text[:200]}"

    sonraki = await http.get(ME, headers=eski)

    assert sonraki.status_code == 401, (
        f"{rol}: şifre SIFIRLANDIKTAN sonra eski access token hâlâ geçerli "
        f"({sonraki.status_code})"
    )


KAYIT = "/api/v1/libraries/register"
OPERATOR_ME = "/api/v1/library-operators/me"


async def _kutuphane_kaydi(ip3, http):
    """GERÇEK self-servis kayıt isteği; oluşan satırlar fabrikanın teardown'ına
    bağlanır (hijyen nöbetçisi kalıcı satır bırakmayı suite hatası sayar)."""
    u = uuid.uuid4().hex[:10]
    eposta = f"ip3reg-{u}@ip3kutuphane.example.com"
    r = await http.post(
        KAYIT,
        json={
            "email": eposta,
            "password": PAROLA,
            "first_name": "Operator",
            "last_name": f"Kayit{u[:4]}",
            "name": f"IP3 Kayit Kutuphane {u}",
            "city": "Adana",
            "district": "Seyhan",
        },
    )
    assert r.status_code == 201, f"kayıt başarısız — {r.status_code}: {r.text[:300]}"

    async with AsyncSessionLocal() as s:
        op = (
            await s.execute(
                select(LibraryOperator).where(LibraryOperator.email == eposta)
            )
        ).scalar_one()
        ip3.operator_ids.append(op.id)
        ip3.library_ids.append(op.library_id)
        return r, op.id, op.library_id, op.auth_version


@pytest.mark.asyncio
async def test_kutuphane_kayit_tokeni_refreshsiz_calisir(ip3, http):
    """Bulgu P1-A — `POST /libraries/register` token'ı `auth_ver` taşımıyordu.

    Kayıt 201 dönüyor, gövdede access token da geliyordu; ama `get_current_user`
    artık `auth_ver`'ı BÜTÜN rollerde denetlediği için o token hiçbir uçta
    çalışmıyordu — kullanıcı ancak `/auth/refresh` çağırıp YENİ token aldıktan
    sonra oturum açabiliyordu. Bu test claim'in varlığını değil, token'ın gerçek
    dependency zincirinden (rol çözümü + auth_version denetimi) geçtiğini ölçer.
    """
    kayit, op_id, lib_id, db_auth_version = await _kutuphane_kaydi(ip3, http)

    token = kayit.json().get("access_token")
    assert token, "kayıt yanıtında access token yok"
    basliklar = {"Authorization": f"Bearer {token}"}

    # (1) Asıl kanıt: REFRESH ÇAĞRILMADAN operatör ucu çalışıyor mu?
    me = await http.get(OPERATOR_ME, headers=basliklar)
    assert me.status_code == 200, (
        "kayıt token'ı operatör ucunda çalışmıyor "
        f"({me.status_code}) — kullanıcı kaydolur olmaz kilitleniyor: {me.text[:200]}"
    )
    govde = me.json()
    assert govde["id"] == op_id, f"başka operatör çözüldü: {govde['id']} != {op_id}"
    assert govde["library_id"] == lib_id, (
        f"operatör yanlış kütüphaneye bağlandı: {govde['library_id']} != {lib_id}"
    )

    # (2) Ortak kullanıcı ucu da aynı token'la çalışmalı.
    auth_me = await http.get(ME, headers=basliklar)
    assert auth_me.status_code == 200, (
        f"kayıt token'ı /auth/me'de çalışmıyor ({auth_me.status_code})"
    )

    # (3) Claim gerçekten DB'deki sürümden geliyor mu? (Sabit `1` yazılmış olsa
    #     da bu koşumda geçerdi; asıl nöbetçi (1) — burada sözleşme sabitlenir.)
    claims = decode_access_token(token)
    assert "auth_ver" in claims, "kayıt token'ında auth_ver claim'i yok"
    assert claims["auth_ver"] == db_auth_version, (
        f"claim DB'deki sürümle uyuşmuyor: {claims['auth_ver']} != {db_auth_version}"
    )
    assert claims["role_id"] == ROLE_IDS[RoleType.LIBRARY_OPERATOR]


@pytest.mark.asyncio
async def test_kutuphane_kayit_sonrasi_refresh_akisi_bozulmadi(ip3, http):
    """Düzeltme refresh yolunu kırmamalı: çerezle gelen refresh yeni ve
    ÇALIŞAN bir access token üretmeye devam eder (regresyon nöbetçisi)."""
    kayit, op_id, _lib_id, _sur = await _kutuphane_kaydi(ip3, http)
    assert kayit.cookies.get("refresh_token"), "kayıt refresh çerezi bırakmadı"

    yenile = await http.post("/api/v1/auth/refresh")
    assert yenile.status_code == 200, f"refresh çalışmadı — {yenile.text[:200]}"
    yeni = yenile.json()["access_token"]
    assert decode_access_token(yeni)["auth_ver"] is not None

    me = await http.get(OPERATOR_ME, headers={"Authorization": f"Bearer {yeni}"})
    assert me.status_code == 200, f"refresh token'ı çalışmıyor ({me.status_code})"
    assert me.json()["id"] == op_id


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", ["LIBRARY_OPERATOR", "COURIER"])
async def test_reset_istegi_operator_ve_kurye_icin_token_uretir(ip3, http, rol):
    """`find_by_email` 5 rolü tanıyor; akışın ilk adımı da uçtan uca çalışmalı."""
    user = await _kullanici(ip3, rol)

    r = await http.post(RESET_ISTE, json={"email": user.email})
    assert r.status_code == 200, r.text[:200]

    async with AsyncSessionLocal() as s:
        tokenlar = (
            await s.execute(
                select(VerificationToken).where(
                    VerificationToken.role_id == user.role_id,
                    VerificationToken.user_id == user.id,
                    VerificationToken.purpose == TokenPurpose.PASSWORD_RESET,
                )
            )
        ).scalars().all()

    assert tokenlar, (
        f"{rol}: sıfırlama talebi token üretmedi — akış ilk adımda sessizce ölüyor"
    )
