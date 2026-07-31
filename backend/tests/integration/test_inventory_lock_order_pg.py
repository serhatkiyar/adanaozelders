"""F29 kilit grafiği — gerçek PostgreSQL ters başlatma provaları.

## Neden AST yetmez

Plan §7.2 "hiçbir üretim yolu `Product → StockCountSession` sırası almaz"
diyor. Bu bir **çalışma zamanı** özelliğidir: kaynak taraması `lock_products`
çağrısının hangi satırda olduğunu görebilir ama bir ORM `with_for_update`,
bir `escrow.claim` UPDATE'i ya da bir FK doğrulaması üzerinden alınan kilidi
göremez. Bu yüzden sözleşme burada **davranışla** korunur.

Yöntem `test_stock_lock_order_pg.py` ile aynıdır: her oturum
`SET LOCAL lock_timeout` alır, böylece bir sıralama hatası testi ASKIDA
BIRAKMAK yerine kırar; deadlock 40P01, zaman aşımı 55P03 olarak ayrı ayrı
yakalanır. Her çift **ters başlatma sırasıyla** ve birkaç tur koşar.

## Kanonik sıra (plan §7.2)

    StockCountSession → Product → Order → OrderReturn → DeliveryStop → Coupon
    StockDamageEvent  → Product

Paketin ilk test commit'i olduğu için implementasyon yok: koşum KIRMIZIDIR.
"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from tests.integration.inventory_factory import Fabrika
from tests.inventory_api import servis

LOCK_TIMEOUT = "4s"
TURLAR = 3
DEADLOCK = "40P01"
LOCK_TIMEOUT_CODE = "55P03"
ADMIN_ID = 1


def _pg_code(exc: BaseException) -> str | None:
    for cand in (exc, getattr(exc, "orig", None), getattr(exc, "__cause__", None)):
        code = getattr(cand, "sqlstate", None) or getattr(cand, "pgcode", None)
        if code:
            return code
    return None


def _kilit_hatasi_yok(sonuclar) -> None:
    """Deadlock / kilit zaman aşımı OLMAMALI.

    ⚠️ `asyncio.gather(return_exceptions=True)` HER hatayı sonuç listesine
    gömer. Yalnız PG kodlarına bakan bir nöbetçi, görevin hiç çalışmamış
    olmasını da "sorun yok" sayar — bu dosyanın ilk hâlinde tam olarak öyle
    oldu: `damage_transfer` henüz yazılmadığı için görev anında patlıyordu ve
    altı parametrizasyon YEŞİL kalıyordu (yalancı yeşil, koşumla yakalandı).
    Bu yüzden beklenmeyen her hata aşağıda yeniden yükseltilir.
    """
    for r in sonuclar:
        if not isinstance(r, BaseException):
            continue
        code = _pg_code(r)
        if code == DEADLOCK:
            pytest.fail(f"DEADLOCK (40P01) — kilit sırası ihlali: {r}", pytrace=False)
        if code == LOCK_TIMEOUT_CODE:
            pytest.fail(
                f"KİLİT ZAMAN AŞIMI (55P03) — muhtemel sıralama hatası: {r}",
                pytrace=False,
            )
        _beklenen_mi(r)


def _beklenen_mi(exc: BaseException) -> None:
    """Yarışta OLABİLECEK hatalar dışındaki her şeyi yeniden yükseltir.

    Beklenen: iş kuralı çatışması (409/400) ve defterin kendi alan
    istisnaları. Beklenmeyen: modül yok, imza yanlış, tip hatası — bunlar
    testin ölçmek istediği yarışın HİÇ KURULMADIĞI anlamına gelir.
    """
    from fastapi import HTTPException

    from services import stock_ledger

    if isinstance(exc, HTTPException) and exc.status_code in (400, 409):
        return
    if isinstance(exc, stock_ledger.StockLedgerError):
        return
    raise exc


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


async def _hazir_oturum(pid: int, sayilan: int) -> int:
    """REVIEW durumunda, uygulanmaya hazır tek ürünlük oturum."""
    s_mod = servis()
    async with AsyncSessionLocal() as db:
        oturum = await s_mod.create_session(
            db, scope="MANUAL", product_ids=[pid], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await s_mod.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        for r in (
            await db.execute(
                text("SELECT id, bucket FROM stock_count_lines WHERE session_id = :s"),
                {"s": sid},
            )
        ).all():
            await s_mod.set_counted(
                db, r.id, sayilan if r.bucket == "SALEABLE" else 0, admin_id=ADMIN_ID
            )
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    return sid


async def _uygula(sid: int, gecikme: float, anahtar: str) -> None:
    await asyncio.sleep(gecikme)
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        await servis().apply_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key=anahtar
        )
        await db.commit()


async def _satis(fab: Fabrika, pid: int, adet: int, gecikme: float) -> None:
    await asyncio.sleep(gecikme)
    await fab.siparis(product_id=pid, quantity=adet)


async def _transfer(pid: int, adet: int, gecikme: float) -> None:
    await asyncio.sleep(gecikme)
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        await servis().damage_transfer(
            db, pid, qty=adet, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        await db.commit()


async def _zincir_saglam(pid: int) -> None:
    """Defter zinciri kova bazında tutarlı mı (kayıp güncelleme provası)."""
    from services import stock_ledger

    async with AsyncSessionLocal() as db:
        sonuc = await stock_ledger.verify_ledger(db, pid)
    assert sonuc.consistent, f"yarıştan sonra defter bozuk: {sonuc.problems}"


# ── Çift 1: sayım uygulaması ↔ satış ───────────────────────────────────────

@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("sayim_once", [True, False], ids=["sayim-once", "satis-once"])
async def test_sayim_uygulamasi_ve_satis_YARISI(fab, tur, sayim_once):
    # Sayılan ≠ stok: sıfır fark deftere HİÇ hareket yazmaz ve o hâlde
    # "apply her çağrıda 409 veriyor" gibi bir bozukluk da yeşil kalırdı.
    pid = await fab.urun(stock=20)
    sid = await _hazir_oturum(pid, 18)
    a, b = (0.0, 0.02) if sayim_once else (0.02, 0.0)
    sonuclar = await asyncio.gather(
        _uygula(sid, a, f"k{tur}"),
        _satis(fab, pid, 2, b),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    await _zincir_saglam(pid)
    # Son durum: sayım −2 (20→18) ve satış −2 birlikte uygulanmış olmalı.
    assert await fab.stok(pid) == 16, "iki işlemden biri kayboldu"


# ── Çift 2: sayım uygulaması ↔ hasar transferi ─────────────────────────────

@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("sayim_once", [True, False], ids=["sayim-once", "hasar-once"])
async def test_sayim_uygulamasi_ve_hasar_transferi_YARISI(fab, tur, sayim_once):
    pid = await fab.urun(stock=20)
    sid = await _hazir_oturum(pid, 18)
    a, b = (0.0, 0.02) if sayim_once else (0.02, 0.0)
    sonuclar = await asyncio.gather(
        _uygula(sid, a, f"k{tur}"),
        _transfer(pid, 3, b),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    await _zincir_saglam(pid)
    # Sayım −2, transfer satılabilirden −3 → 15; hasarlı kovada +3.
    assert await fab.stok(pid) == 15, "sayım farkı ya da transfer kayboldu"


# ── Çift 3: hasar transferi ↔ satış ────────────────────────────────────────

@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("hasar_once", [True, False], ids=["hasar-once", "satis-once"])
async def test_hasar_transferi_ve_satis_YARISI(fab, tur, hasar_once):
    pid = await fab.urun(stock=20)
    a, b = (0.0, 0.02) if hasar_once else (0.02, 0.0)
    sonuclar = await asyncio.gather(
        _transfer(pid, 3, a),
        _satis(fab, pid, 2, b),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    await _zincir_saglam(pid)


# ── Çift 4: aynı oturumun iki eşzamanlı uygulaması ─────────────────────────

@pytest.mark.parametrize("tur", range(TURLAR))
async def test_ayni_oturum_IKI_KEZ_ayni_anda_uygulanamaz(fab, tur):
    """Yalnız biri kazanır; hareketler TEK kez yazılır.

    Koşullu UPDATE claim'i olmadan ikisi de REVIEW görüp ikisi de yazardı.
    """
    pid = await fab.urun(stock=20)
    sid = await _hazir_oturum(pid, 18)
    once = await fab.hareket_sayisi(pid)

    sonuclar = await asyncio.gather(
        _uygula(sid, 0.0, f"a{tur}"),
        _uygula(sid, 0.0, f"b{tur}"),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)

    basarili = [r for r in sonuclar if not isinstance(r, BaseException)]
    assert len(basarili) == 1, f"tam olarak biri kazanmalıydı: {sonuclar}"
    assert await fab.hareket_sayisi(pid) == once + 1
    assert await fab.stok(pid) == 18


# ── Çift 5: üç yol aynı üründe ─────────────────────────────────────────────

@pytest.mark.parametrize("tur", range(TURLAR))
async def test_satis_sayim_ve_hasar_UCU_BIRDEN(fab, tur):
    """Direktifteki 'aynı üründe eşzamanlı satış, sayım uygulaması ve hasar
    transferi' senaryosu — üç farklı kilit yolu tek üründe buluşuyor."""
    pid = await fab.urun(stock=30)
    sid = await _hazir_oturum(pid, 28)
    sonuclar = await asyncio.gather(
        _uygula(sid, 0.0, f"u{tur}"),
        _satis(fab, pid, 2, 0.01),
        _transfer(pid, 4, 0.02),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    await _zincir_saglam(pid)
