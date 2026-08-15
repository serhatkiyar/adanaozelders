"""Eski SM-2 kelime kartı TABLOLARI düştü — migration nöbetçisi (R3, GERÇEK PG).

`flashcard_decks` ve `flashcards` baseline migration'ın (`532b1fa8771d`) içinde
doğar. Kaldırma **baseline düzenlenerek yapılamaz**: o revizyon uygulanmış
ortamlarda (geliştirme `ceyhandb` dahil) çoktan koşmuştur ve alembic aynı
revizyonu ikinci kez çalıştırmaz — geçmişi düzenlemek, o veritabanlarında
tabloları sessizce yerinde bırakırdı (İP-16'nın B7 tuzağının aynısı, bkz.
`test_flashcards_kaldirildi_migration` yerine `test_ip16_migration_pg.py` §B7).
Bu yüzden kaldırma YENİ bir revizyonla yapılır ve burada **boş bir veritabanına
zincirin tamamı koşularak** ölçülür.

## Ölçüm neden taze DB'de, `ceyhandb`'de değil

`ceyhandb` bugün tabloları taşıyor ve migration uygulandığında düşecek. Ama
"benim makinemde düştü" ile "boş bir Postgres'te `upgrade head` sonucunda yok"
farklı iddialardır: ikincisi CI'ı, üretim kurulumunu ve yeni geliştirici
ortamını kapsar. Tek kullanımlık veritabanı adı test başına benzersizdir
(sabit ad, ardışık kurup düşüren düğümler arasında yarış üretiyordu —
İP-16'da ölçülmüş bir flake) ve teardown **test başarısız olsa da** koşar
(kök CLAUDE.md §G).
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

DISPOSABLE_DB_ONEK = "adana_kk_mig"

#: Düşmesi gereken tablolar.
SM2_TABLOLARI = ("flashcards", "flashcard_decks")

#: Ayakta kalması gereken YENİ sistem — kaldırmanın komşuyu vurmadığının kanıtı.
#: Bu olmadan "flashcard tablosu yok" iddiası, migration hiç koşmadığı için de
#: sağlanabilirdi (boş veritabanında her tablo yoktur).
SRS_TABLOLARI = (
    "srs_decks",
    "srs_notes",
    "srs_cards",
    "srs_progress",
    "srs_review_logs",
    "srs_deck_assignments",
    "srs_tags",
    "srs_note_tags",
)


def _url(dbname: str) -> str:
    return (
        f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{dbname}"
    )


def _alembic(*args: str, db: str, bekle_hata: bool = False):
    env = {**os.environ, "POSTGRES_DB": db, "AUTO_CREATE_DB": "false"}
    res = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND), capture_output=True, text=True,
        encoding="utf-8", errors="replace", env=env,
    )
    if not bekle_hata:
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
    assert ad.endswith("_test") and "test" in ad
    assert ad != settings.POSTGRES_DB

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


async def _var_olan_tablolar(engine, adlar) -> list[str]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = ANY(:adlar) "
                "ORDER BY table_name"
            ),
            {"adlar": list(adlar)},
        )
        return [r[0] for r in rows]


async def test_R3_TAZE_DBDE_SM2_TABLOLARI_KURULMAZ(taze_db):
    """Boş Postgres'te `alembic upgrade head` sonrası SM-2 tabloları OLMAMALI.

    Üç şey birlikte ölçülür, çünkü tek başına hiçbiri yeterli değil:

    1. `flashcards` / `flashcard_decks` **yok** — asıl iddia.
    2. `srs_*` sekiz tablo **var** — migration'ın gerçekten koştuğunun kanıtı.
       Bu olmadan (1) boş bir veritabanında da sağlanırdı: hiç upgrade
       koşmasa, alembic sessizce patlasa ya da zincir yanlış yere bağlansa
       test yine yeşil görünürdü. Yalancı yeşilin en olası kılığı budur.
    3. `alembic check` temiz — model ile şema sapmamış, yani modeller de
       kaldırılmış. Tabloyu düşürüp `models/flashcard.py`'yi bırakmak
       autogenerate'i "tabloyu geri ekle" der hâle getirirdi.
    """
    motor, db = taze_db
    _alembic("upgrade", "head", db=db)

    kalan_sm2 = await _var_olan_tablolar(motor, SM2_TABLOLARI)
    assert kalan_sm2 == [], (
        f"SM-2 tabloları taze veritabanında kuruldu: {kalan_sm2}. "
        "Kaldırma migration'ı ya yok ya zincire bağlanmamış."
    )

    kurulan_srs = await _var_olan_tablolar(motor, SRS_TABLOLARI)
    assert kurulan_srs == sorted(SRS_TABLOLARI), (
        "Yeni FSRS sistemi kurulmadı — migration hiç koşmamış olabilir; "
        f"bu durumda yukarıdaki 'SM-2 yok' ölçümü anlamsızdır. Bulunan: {kurulan_srs}"
    )

    res = _alembic("check", db=db)
    assert "No new upgrade operations detected" in res.stdout + res.stderr, (
        f"model ile şema sapmış (model dosyaları da kaldırılmalı):\n"
        f"{res.stdout}\n{res.stderr}"
    )


async def test_R3b_DOWNGRADE_SEMAYI_GERI_KURAR_VERIYI_GETIRMEZ(taze_db):
    """`downgrade -1` şemayı geri kurmalı, `upgrade` yeniden düşürmeli.

    Kaldırma revizyonlarında `downgrade` yazmak kolayca **ölü kod** olur:
    kimse koşmaz, ilk gerçek geri alma denemesinde patlar (yanlış index adı,
    ters FK sırası, eksik kolon). Bu düğüm o yolu gerçek PostgreSQL'de yürütür.

    Ayrıca revizyonun docstring'indeki uyarıyı **ölçer**: geri kurulan tablo
    BOŞTUR. `downgrade` bir yedekleme mekanizması değildir; bunu yazıyla
    söylemek yetmez, çünkü ileride biri "nasılsa downgrade var" diye veri
    kaybını göze alabilir.

    Ölçüm zinciri: upgrade head (tablo yok) → downgrade -1 (tablo VAR, 0 satır)
    → **VERİ YAZ** → upgrade head (tablo yine yok) → downgrade -1 (tablo VAR,
    yine 0 satır) → upgrade head → `alembic check` temiz.

    **Veri yazma adımı neden var** (bağımsız denetim bulgusu F1, 14 Ağu 2026):
    ilk hâlde zincir hiç veri yazılmamış bir veritabanında koşuyordu, yani
    "downgrade sonrası `count(*) == 0`" iddiası **boş kümede** ölçülüyordu.
    O assertion, "veri geri gelmedi" ile "veri hiç yoktu" hâllerini ayırt
    etmez; downgrade'i veriyi geri yükleyecek şekilde yazan bir uygulama da,
    hiçbir şey yapmayan bir uygulama da testi geçerdi. Kök CLAUDE.md §E'nin
    sorusu ("eski bozuk kod da aynı testi geçer miydi?") burada **evet**
    diyordu. Artık satır gerçekten yazılıyor ve `upgrade`'in onu kalıcı
    olarak düşürdüğü ölçülüyor — iddianın tek gerçek kanıtı budur.
    """
    motor, db = taze_db
    _alembic("upgrade", "head", db=db)
    assert await _var_olan_tablolar(motor, SM2_TABLOLARI) == []

    # İP-19 düzeltmesi: `-1` GÖRELİDİR ve head'e bağlıdır — zincire yeni
    # revizyon (ip19_filo_veriye) eklenince "-1" ARTIK BU PAKETİ geri almıyor,
    # İP-19'u alıyordu ve test sessizce başka bir migration'ı ölçüyordu.
    # Mutlak hedef: sm2_flashcard_kaldirma'nın down_revision'ı.
    _alembic("downgrade", "ip16_srs_izin_kodu_hizalama", db=db)
    geri_gelen = await _var_olan_tablolar(motor, SM2_TABLOLARI)
    assert geri_gelen == sorted(SM2_TABLOLARI), (
        f"downgrade şemayı geri kurmadı: {geri_gelen}"
    )

    # Şema geri geldi ama VERİ gelmedi — revizyon docstring'inin iddiası.
    async with motor.connect() as conn:
        for tablo in SM2_TABLOLARI:
            sayi = (
                await conn.execute(text(f'SELECT count(*) FROM "{tablo}"'))
            ).scalar_one()
            assert sayi == 0, (
                f"{tablo} downgrade sonrası {sayi} satır taşıyor — beklenen 0. "
                "downgrade bir yedekleme mekanizması DEĞİLDİR"
            )

    # ── ASIL KANIT: boş kümede değil, DOLU tabloda ölç ───────────────────
    # Geri kurulan şemaya gerçek satır yaz (kaldırma öncesi ceyhandb'nin
    # şeklini taklit eder: 2 deste, 12 kart, hepsi ilk destede).
    async with motor.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO flashcard_decks (id, user_id, role_id, name) "
                "VALUES (1, 6, 3, 'deste bir'), (2, 6, 3, 'deste iki')"
            )
        )
        await conn.execute(
            text(
                "INSERT INTO flashcards (id, deck_id, front, back) "
                "SELECT g, 1, 'on' || g, 'arka' || g FROM generate_series(1, 12) AS g"
            )
        )

    async with motor.connect() as conn:
        yazilan = {
            tablo: (
                await conn.execute(text(f'SELECT count(*) FROM "{tablo}"'))
            ).scalar_one()
            for tablo in SM2_TABLOLARI
        }
    assert yazilan == {"flashcard_decks": 2, "flashcards": 12}, (
        f"ön koşul kurulamadı, ölçüm yine boş kümede olurdu: {yazilan}"
    )

    _alembic("upgrade", "head", db=db)
    assert await _var_olan_tablolar(motor, SM2_TABLOLARI) == [], (
        "yeniden upgrade tabloları düşürmedi (downgrade sonrası idempotent değil)"
    )

    # Tablolar veriyle birlikte düştü. Şimdi tekrar geri kur: satırlar
    # DÖNMEMELİ. Bu assertion artık ayırt edicidir — az önce 2/12 vardı.
    # İP-19 düzeltmesi: `-1` GÖRELİDİR ve head'e bağlıdır — zincire yeni
    # revizyon (ip19_filo_veriye) eklenince "-1" ARTIK BU PAKETİ geri almıyor,
    # İP-19'u alıyordu ve test sessizce başka bir migration'ı ölçüyordu.
    # Mutlak hedef: sm2_flashcard_kaldirma'nın down_revision'ı.
    _alembic("downgrade", "ip16_srs_izin_kodu_hizalama", db=db)
    async with motor.connect() as conn:
        for tablo in SM2_TABLOLARI:
            sayi = (
                await conn.execute(text(f'SELECT count(*) FROM "{tablo}"'))
            ).scalar_one()
            assert sayi == 0, (
                f"{tablo} downgrade sonrası {sayi} satır taşıyor. Bu tur ÖNCE "
                "2 deste + 12 kart yazıldı ve upgrade onları düşürdü; downgrade "
                "veriyi geri getiriyorsa revizyonun docstring'i YANLIŞTIR"
            )

    _alembic("upgrade", "head", db=db)
    assert await _var_olan_tablolar(motor, SM2_TABLOLARI) == []

    res = _alembic("check", db=db)
    assert "No new upgrade operations detected" in res.stdout + res.stderr, (
        f"downgrade→upgrade turundan sonra şema sapmış:\n{res.stdout}\n{res.stderr}"
    )
