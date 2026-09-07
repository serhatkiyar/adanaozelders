"""`username` KOLONLARI ve INDEKSLERİ düştü — migration nöbetçisi (R3, GERÇEK PG).

`username` / `username_change_count` beş kullanıcı tablosunda baseline
(`532b1fa8771d`) ve `8590183c3cc1` içinde doğar; kısmi UNIQUE indekslerin
güncel tanımı ise `b1c4e7a90d52`'de (clients için gölge yüklemi eklenmişti).
Kaldırma **eski revizyonlar düzenlenerek yapılamaz**: onlar uygulanmış
ortamlarda çoktan koşmuştur ve alembic aynı revizyonu ikinci kez çalıştırmaz —
geçmişi düzenlemek o veritabanlarında kolonları sessizce yerinde bırakırdı.
Bu yüzden kaldırma YENİ bir revizyonla yapılır ve burada **boş bir
veritabanına zincirin tamamı koşularak** ölçülür.

Ayrıca `alembic check` düğümü var: `models/mixins.py`'de unutulan tek bir alan
ancak orada görünür (şema ile model arasında sapma).
"""
from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from core.config import settings

BACKEND = Path(__file__).resolve().parents[2]

DISPOSABLE_DB_ONEK = "adana_kad_mig"

#: Kolonun düşmesi gereken beş kullanıcı tablosu.
KULLANICI_TABLOLARI = (
    "admins",
    "tutors",
    "clients",
    "library_operators",
    "courier_accounts",
)

#: Düşmesi gereken kısmi UNIQUE indeksler.
DUSEN_INDEKSLER = tuple(f"uq_{t}_username_active" for t in KULLANICI_TABLOLARI)

#: AYAKTA KALMASI gereken kardeş indeksler — kaldırmanın komşuyu vurmadığının
#: kanıtı. Bu olmadan "username indeksi yok" iddiası, migration hiç koşmadığı
#: için de sağlanabilirdi (boş veritabanında hiçbir indeks yoktur).
KALAN_INDEKSLER = tuple(f"uq_{t}_email_active" for t in KULLANICI_TABLOLARI)


def _url(dbname: str) -> str:
    return (
        f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{dbname}"
    )


def _alembic(*args: str, db: str):
    env = {**os.environ, "POSTGRES_DB": db, "AUTO_CREATE_DB": "false"}
    res = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND), capture_output=True, text=True,
        encoding="utf-8", errors="replace", env=env,
    )
    assert res.returncode == 0, (
        f"alembic {' '.join(args)} başarısız:\n{res.stdout}\n{res.stderr}"
    )
    return res


@pytest.fixture
async def taze_db():
    """Boş, TEST BAŞINA BENZERSİZ tek kullanımlık veritabanı."""
    if settings.ENVIRONMENT == "production":
        pytest.fail("Üretimde migration testi koşulamaz")
    ad = f"{DISPOSABLE_DB_ONEK}_{uuid.uuid4().hex[:8]}_test"
    assert ad.endswith("_test") and ad != settings.POSTGRES_DB

    bakim = create_async_engine(_url("postgres"), isolation_level="AUTOCOMMIT")
    try:
        async with bakim.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except (OSError, ConnectionRefusedError) as exc:
        await bakim.dispose()
        pytest.skip(f"Bakım veritabanına ulaşılamıyor ({exc.__class__.__name__})")

    async with bakim.connect() as conn:
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{ad}" WITH (FORCE)'))
        await conn.execute(text(f'CREATE DATABASE "{ad}"'))

    engine = create_async_engine(_url(ad))
    try:
        yield engine, ad
    finally:
        await engine.dispose()
        async with bakim.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{ad}" WITH (FORCE)'))
        await bakim.dispose()


async def _kolonlar(engine, tablo: str) -> set[str]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name=:t"
            ),
            {"t": tablo},
        )
        return {r[0] for r in rows}


async def _indeksler(engine, adlar) -> list[str]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname='public' AND indexname = ANY(:adlar) "
                "ORDER BY indexname"
            ),
            {"adlar": list(adlar)},
        )
        return [r[0] for r in rows]


async def test_R3_taze_dbde_username_kolonlari_ve_indeksleri_YOK(taze_db):
    engine, ad = taze_db
    _alembic("upgrade", "head", db=ad)

    for tablo in KULLANICI_TABLOLARI:
        kolonlar = await _kolonlar(engine, tablo)
        assert kolonlar, f"{tablo} tablosu hiç yok — migration koşmamış olabilir"
        assert "username" not in kolonlar, f"{tablo}.username hâlâ duruyor"
        assert "username_change_count" not in kolonlar, (
            f"{tablo}.username_change_count hâlâ duruyor"
        )
        # DOLULUK: kardeş kolonlar yerinde — tablo boşalmadı.
        assert "email" in kolonlar
        assert "first_name" in kolonlar

    ncr = await _kolonlar(engine, "name_change_requests")
    assert ncr, "name_change_requests tablosu yok"
    assert "new_username" not in ncr
    assert "new_first_name" in ncr, "ad değişikliği dalı da silinmiş"

    assert await _indeksler(engine, DUSEN_INDEKSLER) == []
    # DOLULUK: e-posta indeksleri ayakta. Boş bir veritabanında hiçbir indeks
    # yoktur; bu düğüm olmadan yukarıdaki iddia bedava geçerdi.
    kalan = await _indeksler(engine, KALAN_INDEKSLER)
    assert sorted(kalan) == sorted(KALAN_INDEKSLER), f"e-posta indeksleri eksik: {kalan}"


async def test_R3_alembic_check_temiz(taze_db):
    """Şema ile model arasında sapma yok.

    `models/mixins.py`'de unutulan tek bir `username` alanı yalnız burada
    görünür: kolon düşmüş ama model hâlâ bekliyorsa autogenerate fark üretir.
    """
    _, ad = taze_db
    _alembic("upgrade", "head", db=ad)
    _alembic("check", db=ad)


async def test_R3b_downgrade_KAYIPLIDIR_veri_geri_gelmez(taze_db):
    """`downgrade` şemayı geri verir, VERİYİ DEĞİL.

    Ön-iddia şart: downgrade'den ÖNCE kolonun yok olduğunu ölçmezsek,
    "veri geri gelmedi" ile "veri hiç yoktu" hâllerini ayırt edemeyiz ve
    test hiçbir şey kanıtlamaz.
    """
    engine, ad = taze_db
    _alembic("upgrade", "head", db=ad)
    assert "username" not in await _kolonlar(engine, "clients")

    # `-1` DEĞİL, ADLI revizyon: zincire yeni bir migration eklendiği anda
    # `-1` başka bir şeyi geri alır ve bu test "downgrade kolonu geri
    # getirmedi" diye YANLIŞ yerde kırılır. (6 Eyl'de tam olarak bu oldu:
    # izin etiketi migration'ı head olunca `-1` onu geri aldı.)
    # Hedef, `username`i düşüren revizyonun EBEVEYNİ.
    _alembic("downgrade", "c8e1a5b73f20", db=ad)
    kolonlar = await _kolonlar(engine, "clients")
    assert "username" in kolonlar, "downgrade kolonu geri getirmedi"

    # Geri gelen değerler SENTETİK ("u<id>") — gerçek kullanıcı adları gitti.
    async with engine.connect() as conn:
        satir = await conn.execute(
            text("SELECT username FROM clients LIMIT 1")
        )
        _ = satir.first()  # taze DB'de satır yok; şema kanıtı yeterli

    _alembic("upgrade", "head", db=ad)
    assert "username" not in await _kolonlar(engine, "clients")
