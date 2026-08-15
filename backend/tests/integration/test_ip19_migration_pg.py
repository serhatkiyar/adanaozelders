"""İP-19 migration nöbetçisi — D-9 (GERÇEK PG, taze tek kullanımlık DB).

Ölçülen zincir (SM-2 paketinin R3b dersiyle — bkz. `test_flashcards_migration_pg.py`
ve oradaki F1 düzeltmesi: **boş kümede ölçüm ayırt edici değildir**, veri
YAZILARAK ölçülür):

    upgrade head        → vehicles/pickup_points KURULU, seed'ler yerinde,
                          delivery_runs.vehicle_id VAR, eski `vehicle` YOK
    veri yaz            → tur aç (COROLLA), kuryeye plaka YAZILAMAZ
    downgrade -1        → eski şema geri: `vehicle` kolonu dolu ('COROLLA'),
                          vehicles/pickup_points YOK — ama plaka verisi
                          GERİ GELMEZ (docstring'in canlı ölçümü)
    upgrade head        → yeni şema yeniden; tur satırı vehicle_id'ye
                          yeniden eşlenmiş
    alembic check       → temiz

Teardown test başarısız olsa da koşar (kök CLAUDE.md §G).
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
DISPOSABLE_DB_ONEK = "adana_ip19_mig"

YENI_TABLOLAR = ("vehicles", "pickup_points")


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
    """Boş, test başına benzersiz tek kullanımlık veritabanı."""
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
        await conn.execute(text(f'CREATE DATABASE "{ad}"'))
    motor = create_async_engine(_url(ad))
    try:
        yield motor, ad
    finally:
        await motor.dispose()
        async with bakim.connect() as conn:
            await conn.execute(
                text(f'DROP DATABASE IF EXISTS "{ad}" WITH (FORCE)')
            )
        await bakim.dispose()


async def _tablolar_var_mi(motor, adlar) -> list[str]:
    async with motor.connect() as conn:
        mevcut = {
            r[0]
            for r in await conn.execute(
                text(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
                )
            )
        }
    return sorted(a for a in adlar if a in mevcut)


async def test_D9_zincir_dolu_tabloda_gidip_gelir(taze_db):
    motor, db = taze_db

    # ── upgrade: yeni dünya ───────────────────────────────────────────────
    _alembic("upgrade", "head", db=db)
    assert await _tablolar_var_mi(motor, YENI_TABLOLAR) == sorted(YENI_TABLOLAR)
    async with motor.connect() as conn:
        seed = {
            r[0]: r[1]
            for r in await conn.execute(
                text("SELECT code, fixed_cost FROM vehicles ORDER BY sort_order")
            )
        }
        assert seed == {"LADA": 0, "COROLLA": 1800}, f"seed sapmış: {seed}"
        base = (
            await conn.execute(
                text("SELECT COUNT(*) FROM pickup_points WHERE kind = 'BASE'")
            )
        ).scalar_one()
        assert base == 1
        kolonlar = {
            r[0]
            for r in await conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'delivery_runs'"
                )
            )
        }
        assert "vehicle_id" in kolonlar and "vehicle" not in kolonlar
        plaka_kolon = (
            await conn.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_name = 'couriers' "
                    "AND column_name = 'vehicle_plate'"
                )
            )
        ).scalar_one()
        assert plaka_kolon == 0, "couriers.vehicle_plate hâlâ duruyor (K-5)"

    # ── VERİ YAZ (boş kümede ölçüm ayırt edici değildir — SM-2/F1 dersi) ──
    async with motor.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO delivery_runs (run_date, vehicle_id, status) "
                "VALUES (CURRENT_DATE, "
                "(SELECT id FROM vehicles WHERE code = 'COROLLA'), 'DONE')"
            )
        )
        await conn.execute(
            text("UPDATE vehicles SET plate = '01 TEST 01' WHERE code = 'LADA'")
        )

    # ── downgrade: eski şema geri, eşleme dolu, plaka verisi GİTTİ ────────
    # `-1` değil MUTLAK hedef: SM-2'nin R3b'si bu tuzağa düştü (zincir
    # uzayınca "-1" başka revizyonu geri alıyor). İP-20 eklendiğinde bu test
    # aynı sessiz kaymayı yaşamasın.
    _alembic("downgrade", "sm2_flashcard_kaldirma", db=db)
    assert await _tablolar_var_mi(motor, YENI_TABLOLAR) == []
    async with motor.connect() as conn:
        eski = (
            await conn.execute(text("SELECT vehicle FROM delivery_runs"))
        ).scalar_one()
        assert eski == "COROLLA", (
            "downgrade eşlemesi bozuk: tur satırı kod-string'e geri dönmeli"
        )
        plaka_kolon = (
            await conn.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_name = 'couriers' "
                    "AND column_name = 'vehicle_plate'"
                )
            )
        ).scalar_one()
        assert plaka_kolon == 1, "downgrade eski kolonu geri kurmalı"
        # Kanıtın özü: kolon geri geldi ama '01 TEST 01' verisi GELMEDİ —
        # vehicles tablosu düştüğünde plaka da gitti. Downgrade yedek değildir.
        plakalar = [
            r[0]
            for r in await conn.execute(
                text(
                    "SELECT vehicle_plate FROM couriers "
                    "WHERE vehicle_plate IS NOT NULL"
                )
            )
        ]
        assert plakalar == [], f"plaka verisi hortladı: {plakalar}"

    # ── yeniden upgrade: idempotent + eşleme yeniden ──────────────────────
    _alembic("upgrade", "head", db=db)
    async with motor.connect() as conn:
        yeni = (
            await conn.execute(
                text(
                    "SELECT v.code FROM delivery_runs r "
                    "JOIN vehicles v ON v.id = r.vehicle_id"
                )
            )
        ).scalar_one()
        assert yeni == "COROLLA"

    res = _alembic("check", db=db)
    assert "No new upgrade operations detected" in res.stdout + res.stderr, (
        f"model ile şema sapmış:\n{res.stdout}\n{res.stderr}"
    )


async def test_B4_eslesmeyen_arac_kodu_LADA_ya_ezilmez(taze_db):
    """🔴 Bağımsız denetim bulgusu B-4.

    Migration eşlemeyi `v.code = r.vehicle` ile yapıp eşleşmeyen her satırı
    LADA'ya düşürüyor. `delivery_runs.vehicle` FK'siz/CHECK'siz serbest bir
    `String(20)` olduğu için (sözleşme §0.1'in şikâyeti) bu teorik değil:
    elle ya da eski bir sürümle yazılmış "KANGOO" turu, upgrade sonrası
    LADA'ymış gibi görünür. Oysa `models/delivery.py`'de FK'nin RESTRICT
    olmasının gerekçesi tam olarak **geçmiş turun hangi araçla koştuğunun
    kaybolmaması**.

    İddia: eşleşmeyen her DISTINCT kod için bir `vehicles` satırı açılır ve
    tur o satıra bağlanır — hiçbir tarihsel kayıt başka bir araca yazılmaz.
    """
    motor, db = taze_db

    # Eski dünya: `delivery_runs.vehicle` hâlâ string.
    _alembic("upgrade", "sm2_flashcard_kaldirma", db=db)
    async with motor.begin() as conn:
        for i, kod in enumerate(("LADA", "COROLLA", "KANGOO", "kangoo")):
            await conn.execute(
                text(
                    "INSERT INTO delivery_runs (run_date, vehicle, status) "
                    "VALUES (CURRENT_DATE + CAST(:i AS integer), :v, 'DONE')"
                ),
                {"i": i, "v": kod},
            )

    _alembic("upgrade", "head", db=db)
    async with motor.connect() as conn:
        eslesme = {
            r[0]: r[1]
            for r in await conn.execute(
                text(
                    "SELECT r.run_date, v.code FROM delivery_runs r "
                    "JOIN vehicles v ON v.id = r.vehicle_id ORDER BY r.run_date"
                )
            )
        }
        kodlar = sorted(eslesme.values())
        assert kodlar == sorted(["LADA", "COROLLA", "KANGOO", "KANGOO"]), (
            f"tarihsel araç bilgisi kayboldu: {kodlar}"
        )
        # Türetilen araç gerçekten yeni bir satırdır (LADA'ya iliştirilmedi).
        assert (
            await conn.execute(
                text("SELECT COUNT(*) FROM vehicles WHERE code = 'KANGOO'")
            )
        ).scalar_one() == 1
