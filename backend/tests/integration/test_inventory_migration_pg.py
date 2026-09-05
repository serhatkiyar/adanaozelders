"""F29 migration zinciri — TEK KULLANIMLIK veritabanında (GERÇEK PostgreSQL).

## Neden bu dosya var

Kapanış denetiminde çıktı: `test_stock_migration_pg.py` bilinçli olarak
`stok_hareket_defteri_sku` revizyonuna kadar migrate ediyor, `head`'e değil.
F29'un dört migration'ı onun ÜSTÜNDE duruyor; dolayısıyla `stock_count_*`,
`stock_damage_events`, append-only trigger'lar, actor-kapsamlı unique index ve
`products.damaged_stock` backfill'inin **boş bir Postgres'te doğru kurulduğunu**
koşan hiçbir test yoktu. Tek dolaylı kanıt, zaten var olan test DB'sinde
çalışan ve ikinci koşumdan itibaren no-op olan `alembic upgrade head`'ti.

Burada zincir F29 ÖNCESİ head'den başlatılır, gerçekçi eski veri yazılır ve
backfill gerçek SQL ile ölçülür.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.config import settings

BACKEND = Path(__file__).resolve().parents[2]

#: Sabit kodlu ve içinde `test` geçiyor — kaza payı bırakmamak için parametre DEĞİL.
DISPOSABLE_DB = "adana_f29_migration_test"

F29_ONCESI = "tb1_order_returns_reason_default"
F29_ZINCIR = (
    "f29_sayim_hasarli_stok",
    "f29a_bucket_default_kaldir",
    "f29b_damage_event_idempotency",
    "f29c_damage_idem_actor_scope",
)


def _url(dbname: str) -> str:
    return (
        f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{dbname}"
    )


@pytest.fixture
async def mig_db():
    if settings.ENVIRONMENT == "production":
        pytest.fail("Üretimde migration testi koşulamaz")
    assert "test" in DISPOSABLE_DB
    assert DISPOSABLE_DB != settings.POSTGRES_DB, (
        "tek kullanımlık DB, çalışma veritabanıyla aynı olamaz"
    )

    bakim = create_async_engine(_url("postgres"), isolation_level="AUTOCOMMIT")
    try:
        async with bakim.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except (OSError, ConnectionRefusedError) as exc:
        await bakim.dispose()
        pytest.skip(f"Bakım veritabanına ulaşılamıyor ({exc.__class__.__name__})")

    async with bakim.connect() as conn:
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{DISPOSABLE_DB}" WITH (FORCE)'))
        await conn.execute(text(f'CREATE DATABASE "{DISPOSABLE_DB}"'))

    engine = create_async_engine(_url(DISPOSABLE_DB))
    Session = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield Session
    finally:
        await engine.dispose()
        async with bakim.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{DISPOSABLE_DB}" WITH (FORCE)'))
        await bakim.dispose()


def _alembic(*args: str, bekle_hata: bool = False) -> subprocess.CompletedProcess:
    env = {**os.environ, "POSTGRES_DB": DISPOSABLE_DB, "AUTO_CREATE_DB": "false"}
    res = subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=str(BACKEND),
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=env,
    )
    if not bekle_hata:
        assert res.returncode == 0, (
            f"alembic {' '.join(args)} başarısız:\n{res.stdout}\n{res.stderr}"
        )
    return res


ESKI_VERI = """
INSERT INTO products (slug,title,kind,seller_type,price,stock,status,created_at,updated_at)
VALUES ('f29mig-fiz','F29 Mig Fiziksel','PHYSICAL','PLATFORM',100,7,'ACTIVE',now(),now()),
       ('f29mig-dij','F29 Mig Dijital','DIGITAL','PLATFORM',50,NULL,'ACTIVE',now(),now());
INSERT INTO stock_movements (product_id,qty_delta,qty_after,movement_type,reason_code,
                             ref_type,ref_id,ref_line_id,actor_type,idempotency_key,created_at)
SELECT id,10,10,'INITIAL','PRODUCT_CREATE',NULL,NULL,NULL,'SYSTEM','f29mig:init',now()
  FROM products WHERE slug='f29mig-fiz';
INSERT INTO stock_movements (product_id,qty_delta,qty_after,movement_type,reason_code,
                             ref_type,ref_id,ref_line_id,actor_type,idempotency_key,created_at)
SELECT id,-3,7,'SALE','ORDER_PAID','order',9001,9101,'SYSTEM','f29mig:sale',now()
  FROM products WHERE slug='f29mig-fiz';
"""


async def _sor(Session, sql: str, **p):
    async with Session() as s:
        return (await s.execute(text(sql), p)).all()


async def test_F29_zinciri_BOS_veritabaninda_kurulur_ve_BACKFILL_dogru(mig_db):
    """Zincirin tamamı + backfill + kısıtlar, tek kullanımlık DB'de."""
    _alembic("upgrade", F29_ONCESI)

    async with mig_db() as s:
        for ifade in ESKI_VERI.strip().split(";"):
            if ifade.strip():
                await s.execute(text(ifade))
        await s.commit()

    yukseltme = _alembic("upgrade", "head")

    # 1. Tek head + F29 zincirinin tamamı uygulanan yolun içinde
    #
    # "head, F29'un SON revizyonudur" demek KIRILGANDI: F29'un üstüne konan her
    # yeni migration (ilki: F30 paketleme şeması) bu testi F29'la hiç ilgisi
    # olmayan bir sebeple kırardı. Ölçülmesi gereken şey head'in adı değil,
    # **F29 zincirinin gerçekten uygulanmış olmasıdır** — aşağıdaki 2-5. adımlar
    # da bunu şemadan doğrular.
    heads = _alembic("heads").stdout
    assert heads.count("(head)") == 1, f"birden çok head: {heads}"
    # F29 zincirinin ucu bu DB'de GERÇEKTEN koştu mu? Eski assert
    # (`F29_ZINCIR[-1] in heads`) zincirin ucunun HEAD OLMASINI şart koşuyordu —
    # üzerine eklenen her yeni migration'da (ilk örnek: ip3_auth_version_all_roles)
    # yanlış kırmızı üretiyordu. F29_ONCESI'nden head'e çıkarken alembic her
    # adımı loglar; uygulanma kanıtı head adından daha güçlüdür.
    assert F29_ZINCIR[-1] in yukseltme.stdout + yukseltme.stderr, (
        f"F29 zincirinin ucu bu yükseltmede koşmadı:\n{yukseltme.stdout}\n{yukseltme.stderr}"
    )
    # İkinci ve TAMAMLAYICI kanıt (main tarafından geldi): yalnız zincirin UCU
    # değil, DÖRT revizyonun tamamı uygulanan yolun içinde mi? Üstteki assert
    # "son adım koştu" der, bu assert "aradan biri düşmedi" der; ikisi birden
    # tutulur çünkü biri diğerinin kör noktasını kapatır.
    gecmis = _alembic("history", "-r", "base:head").stdout
    eksik = [r for r in F29_ZINCIR if r not in gecmis]
    assert not eksik, f"F29 zinciri uygulanan yolda değil: {eksik}\n{gecmis}"

    # 2. Dijital NULL, fiziksel 0 — stok bozulmadan
    satir = await _sor(
        mig_db, "SELECT slug, stock, damaged_stock FROM products "
                "WHERE slug LIKE 'f29mig-%' ORDER BY slug"
    )
    kayit = {r.slug: (r.stock, r.damaged_stock) for r in satir}
    assert kayit["f29mig-dij"][1] is None, "dijital üründe damaged_stock NULL olmalı"
    assert kayit["f29mig-fiz"] == (7, 0), "fiziksel ürünün stoğu bozuldu"

    # 3. Eski hareketler SALEABLE'a backfill
    kovalar = await _sor(mig_db, "SELECT bucket, count(*) AS n FROM stock_movements GROUP BY bucket")
    assert {r.bucket: r.n for r in kovalar} == {"SALEABLE": 2}

    # 4. bucket: NOT NULL, server default YOK
    kolon = await _sor(
        mig_db, "SELECT is_nullable, column_default FROM information_schema.columns "
                "WHERE table_name='stock_movements' AND column_name='bucket'"
    )
    assert kolon[0].is_nullable == "NO"
    assert kolon[0].column_default is None, (
        "kalıcı server default, DAMAGED bir hareketi sessizce SALEABLE yazardı"
    )

    # 5. F29 tabloları ve actor-kapsamlı unique index
    tablolar = await _sor(
        mig_db, "SELECT table_name FROM information_schema.tables WHERE table_name IN "
                "('stock_count_sessions','stock_count_lines','stock_count_line_events',"
                "'stock_damage_events')"
    )
    assert len(tablolar) == 4, f"F29 tabloları eksik: {[t.table_name for t in tablolar]}"

    idx = await _sor(
        mig_db, "SELECT indexdef FROM pg_indexes WHERE tablename='stock_damage_events' "
                "AND indexname='uq_stock_damage_events_idem'"
    )
    assert idx and "UNIQUE" in idx[0].indexdef.upper()
    assert "actor_admin_id" in idx[0].indexdef and "idempotency_key" in idx[0].indexdef


async def test_F29_bucketsiz_ham_INSERT_reddedilir(mig_db):
    _alembic("upgrade", F29_ONCESI)
    async with mig_db() as s:
        for ifade in ESKI_VERI.strip().split(";"):
            if ifade.strip():
                await s.execute(text(ifade))
        await s.commit()
    _alembic("upgrade", "head")

    async with mig_db() as s:
        with pytest.raises(Exception) as hata:
            await s.execute(text(
                "INSERT INTO stock_movements (product_id,qty_delta,qty_after,movement_type,"
                "reason_code,actor_type,idempotency_key,created_at) SELECT id,1,8,'INITIAL',"
                "'PRODUCT_CREATE','SYSTEM','f29mig:nobucket',now() FROM products "
                "WHERE slug='f29mig-fiz'"
            ))
            await s.commit()
    assert "null value" in str(hata.value).lower() or "not-null" in str(hata.value).lower()


async def test_F29_append_only_triggerlari_DOLU_tabloda_calisir(mig_db):
    """Satır-seviyesi trigger BOŞ tabloda hiç ateşlenmez; önce satır yazılır."""
    _alembic("upgrade", "head")

    async with mig_db() as s:
        await s.execute(text(
            "INSERT INTO roles (id,name) VALUES (1,'ADMIN') ON CONFLICT DO NOTHING"))
        await s.execute(text(
            "INSERT INTO product_categories (slug,name,sort_order) "
            "VALUES ('f29mig-kat','F29 Migration Testi',0) ON CONFLICT DO NOTHING"))
        await s.execute(text(
            "INSERT INTO products (slug,title,kind,seller_type,price,stock,status,"
            "category_id,created_at,updated_at) VALUES "
            "('f29mig-t','T','PHYSICAL','PLATFORM',1,1,'ACTIVE',"
            "(SELECT id FROM product_categories WHERE slug='f29mig-kat' "
            "AND deleted_at IS NULL),now(),now())"))
        await s.execute(text(
            "INSERT INTO admins (email,hashed_password,first_name,last_name,"
            "role_id,is_active,created_at,updated_at) VALUES ('f29mig@t.local','x','A','B',"
            "1,true,now(),now())"))
        await s.execute(text(
            "INSERT INTO stock_damage_events (product_id,kind,qty,source_bucket,reason_code,"
            "actor_admin_id,created_at) SELECT p.id,'TRANSFER',1,'SALEABLE','KIRIK',a.id,now() "
            "FROM products p, admins a WHERE p.slug='f29mig-t' AND a.email='f29mig@t.local'"))
        await s.commit()

    for sql in (
        "UPDATE stock_damage_events SET qty = 99",
        "DELETE FROM stock_damage_events",
    ):
        async with mig_db() as s:
            with pytest.raises(Exception) as hata:
                await s.execute(text(sql))
                await s.commit()
        assert "append-only" in str(hata.value).lower(), f"{sql} reddedilmedi"


async def test_F29_downgrade_VERI_VARKEN_reddedilir_temizken_calisir(mig_db):
    _alembic("upgrade", "head")

    async with mig_db() as s:
        await s.execute(text(
            "INSERT INTO product_categories (slug,name,sort_order) "
            "VALUES ('f29mig-kat','F29 Migration Testi',0) ON CONFLICT DO NOTHING"))
        await s.execute(text(
            "INSERT INTO products (slug,title,kind,seller_type,price,stock,damaged_stock,"
            "status,category_id,created_at,updated_at) VALUES "
            "('f29mig-d','D','PHYSICAL','PLATFORM',1,5,2,'ACTIVE',"
            "(SELECT id FROM product_categories WHERE slug='f29mig-kat' "
            "AND deleted_at IS NULL),now(),now())"))
        await s.commit()

    red = _alembic("downgrade", F29_ONCESI, bekle_hata=True)
    assert red.returncode != 0, "hasarlı bakiye varken downgrade veri kaybettirirdi"

    async with mig_db() as s:
        await s.execute(text("UPDATE products SET damaged_stock = 0 WHERE damaged_stock > 0"))
        await s.commit()

    _alembic("downgrade", F29_ONCESI)
    kalan = await _sor(
        mig_db, "SELECT count(*) AS n FROM information_schema.columns "
                "WHERE table_name='stock_movements' AND column_name='bucket'"
    )
    assert kalan[0].n == 0, "downgrade bucket kolonunu bırakmış"

    _alembic("upgrade", "head")  # tekrar ileri gidebilmeli
