"""`username` (kullanıcı adı) KALDIRILDI — yokluk sözleşmesi (U1 · U2 · U3 · U4 · U5).

Bu dosya, beş kullanıcı tablosundaki `username` / `username_change_count`
kolonlarının, onları üreten servislerin, taşıyan şemaların ve üstlerine kurulmuş
admin onaylı "kullanıcı adı değiştirme" iş akışının kaldırıldığını ölçer.

## Neden kaldırıldı

Ölçüldü: giriş E-POSTA ile yapılıyor, eğitmen profili `isim-soyisim-{id}`
slug'ı ile açılıyor, öğrenci profili düz id ile; kayıt formu kullanıcı adını
sormuyor ve mesajlaşma/yorum/soru-cevap yüzeylerinin hiçbirinde görünmüyor.
Yani alan taşınıyordu ama iş yapmıyordu — buna karşılık beş tabloda NOT NULL
kolon, beş kısmi UNIQUE index, üç ayrı üretici ve her kayıtta beş tabloyu
tarayan bir tekillik sorgusu maliyeti vardı.

## Neden "yokluk sözleşmesi" ve neden bu dosya kırmızı doğdu

Bir şeyin kaldırıldığını iddia eden test, o şey **hiç var olmamış olsa da**
geçer; yeşil olması tek başına hiçbir şey kanıtlamaz. Kanıt, testin kaldırmadan
ÖNCE gerçekten kırmızı düştüğünün görülmesidir. Bu dosya bilerek üretim
kodundan önce, ayrı bir commit'te yazıldı; kırmızı çıktısı o commit'in
mesajındadır.

Kaldırma bitince dosyanın işlevi değişir: kaldırmanın kanıtı olmaktan çıkar,
**geri sızmanın nöbetçisi** olur. Geri sızma vektörü tek satırdır —
`models/mixins.py`'ye `username` kolonunu geri eklemek.

## EN KRİTİK SINIR — `username` aynı zamanda GİRİŞ formunun alan adıdır

`OAuth2PasswordRequestForm`'un alanı standart gereği `username`'dir ve bizde
içine E-POSTA konur (`api/routers/auth.py`). Bu alan KALIR ve kalmalıdır.
Global bir bul-değiştir herkesin girişini kırar; `test_U3_*` bu ayrımı hem
yasak hem de ZORUNLU tarafıyla ölçer.

## Sınıflandırma (kök CLAUDE.md §H)

- U1/U2: gerçek Pydantic `model_fields` ve gerçek SQLAlchemy `__table__` —
  metin taraması DEĞİL, eşlenmiş nesne.
- U3: gerçek `app.openapi()` şeması (`app.routes` KULLANILMAZ, bkz.
  `test_flashcards_kaldirildi.py` R2 gerekçesi).
- U4: gerçek attribute denemesi.

R3 (kolonların ve indekslerin gerçekten düştüğü) taze tek kullanımlık
PostgreSQL ister: `tests/integration/test_kullanici_adi_migration_pg.py`.
"""
from __future__ import annotations

import pytest

from models.admin import Admin
from models.client import Client
from models.courier_account import CourierAccount
from models.library_operator import LibraryOperator
from models.name_change_request import NameChangeRequest
from models.tutor import Tutor
from schemas.admin import AdminUserOut
from schemas.auth import RegisterRequest
from schemas.delivery import CourierAccountOut
from schemas.user import ClientPublicOut, ClientSearchOut, NameChangeRequestOut, UserOut, UserUpdate
from services import account_deletion_service, auth_service

#: Yasak alan adları — hangi biçimde geri gelirse gelsin.
YASAK = {"username", "username_change_count", "new_username"}

SEMALAR = [
    UserOut,
    UserUpdate,
    ClientPublicOut,
    ClientSearchOut,
    AdminUserOut,
    CourierAccountOut,
    RegisterRequest,
    NameChangeRequestOut,
]

MODELLER = [Admin, Tutor, Client, LibraryOperator, CourierAccount]


@pytest.mark.parametrize("sema", SEMALAR, ids=lambda s: s.__name__)
def test_U1_pydantic_semalarinda_username_yok(sema) -> None:
    ortak = YASAK & set(sema.model_fields)
    assert not ortak, f"{sema.__name__} hâlâ taşıyor: {sorted(ortak)}"


def test_U1_DOLULUK_semalar_bosalmadi() -> None:
    """Boşalmış ya da yeniden adlandırılmış bir şema yukarıdaki iddiayı bedava geçerdi."""
    assert "email" in UserOut.model_fields
    assert "first_name" in UserOut.model_fields
    assert "email" in RegisterRequest.model_fields


@pytest.mark.parametrize("model", MODELLER, ids=lambda m: m.__name__)
def test_U2_orm_kolonlarinda_username_yok(model) -> None:
    kolonlar = set(model.__table__.columns.keys())
    ortak = YASAK & kolonlar
    assert not ortak, f"{model.__name__} tablosunda hâlâ var: {sorted(ortak)}"


def test_U2_name_change_request_new_username_yok() -> None:
    assert "new_username" not in NameChangeRequest.__table__.columns.keys()


def test_U2_DOLULUK_tablolar_bosalmadi() -> None:
    for model in MODELLER:
        kolonlar = set(model.__table__.columns.keys())
        assert "email" in kolonlar, f"{model.__name__}: email de yok — tablo boşalmış"
        assert "first_name" in kolonlar
        assert "deleted_at" in kolonlar
    # Ad değişikliği dalı YAŞIYOR; kaldırılan yalnız kullanıcı adı dalıdır.
    assert "new_first_name" in NameChangeRequest.__table__.columns.keys()


def test_U3_openapi_semalarinda_username_yok_AMA_giris_govdesinde_VAR() -> None:
    """Tek istisna OAuth2 giriş gövdesidir — ve o istisna ZORUNLUDUR.

    Bu düğüm iki yönlüdür: kimsenin aklına gelmeyen bir şemadan alanın geri
    sızmasını yakalar, aynı zamanda temizlik sırasında girişin kırılmadığını
    kanıtlar.
    """
    from main import app

    sema = app.openapi()
    bilesenler = sema.get("components", {}).get("schemas", {})

    giris_govdeleri = [ad for ad in bilesenler if ad.startswith("Body_login")]
    assert giris_govdeleri, "giriş gövdesi şeması hiç yok — OpenAPI boşalmış olabilir"

    kirli: list[str] = []
    for ad, govde in bilesenler.items():
        if ad in giris_govdeleri:
            continue
        if YASAK & set(govde.get("properties", {})):
            kirli.append(ad)
    assert not kirli, f"OpenAPI şemalarında kullanıcı adı sızıntısı: {sorted(kirli)}"

    # DOLULUK + giriş sözleşmesi: OAuth2 gövdesi `username` alanını HÂLÂ taşır.
    for ad in giris_govdeleri:
        assert "username" in bilesenler[ad].get("properties", {}), (
            f"{ad}: OAuth2 giriş alanı silinmiş — bu GİRİŞİ KIRAR"
        )


@pytest.mark.parametrize(
    "modul, ad",
    [
        (auth_service, "_turet_kullanici_adi"),
        (auth_service, "_username_taken"),
        (account_deletion_service, "anonymized_username"),
    ],
)
def test_U4_ureticiler_kaldirildi(modul, ad) -> None:
    assert not hasattr(modul, ad), f"{modul.__name__}.{ad} hâlâ duruyor"


def test_U4_DOLULUK_moduller_bosalmadi() -> None:
    assert hasattr(auth_service, "authenticate")
    assert hasattr(account_deletion_service, "anonymized_email")


def test_U5_kvkk_dokumunde_kullanici_adi_anahtari_yok() -> None:
    """Hep `None` dönen bir anahtar yokluktan kötüdür: veri sahibine hâlâ
    kullanıcı adı tuttuğumuzu söyler (KVKK m.20 dökümü tutulanı tarif etmeli)."""
    import inspect

    kaynak = inspect.getsource(account_deletion_service.export_personal_data)
    kod = "\n".join(s for s in kaynak.splitlines() if not s.strip().startswith("#"))
    assert "kullanici_adi" not in kod
    # DOLULUK: döküm hâlâ kimlik alanlarını taşıyor.
    assert "eposta" in kod
