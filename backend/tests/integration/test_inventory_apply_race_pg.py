"""F29 sayım uygulaması — GERÇEK eşzamanlılık ve kilit sırası (commit 5).

`test_inventory_lock_order_pg.py` beş çiftin **hepsini** hedefler ve hasar
servisini de kapsar (commit 6'ya kadar kırmızı). Bu dosya commit 5'te
uygulanabilir olan yarışları **bugün** ölçer:

* sayım uygulaması ↔ satış
* sayım uygulaması ↔ admin düzeltmesi
* iki sayım uygulaması (farklı oturum, aynı ürün)
* sayım uygulaması ↔ tam iade geri yüklemesi
* yeniden sayım ↔ uygulama

Yöntem: her oturum `SET LOCAL lock_timeout` alır — bir sıralama hatası testi
ASKIDA BIRAKMAK yerine kırar. Deadlock `40P01`, zaman aşımı `55P03` ayrı ayrı
yakalanır ve her çift **ters başlatma sırasıyla**, birkaç tur koşar.

⚠️ `asyncio.gather(return_exceptions=True)` HER hatayı sonuç listesine gömer.
Yalnız PG kodlarına bakan bir nöbetçi, görevin hiç çalışmamış olmasını da
"sorun yok" sayar — bu tuzağa bu pakette bir kez düşüldü. Bu yüzden beklenen
iş kuralı hataları dışında her istisna yeniden yükseltilir.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import inventory_service, stock_ledger
from tests.integration.inventory_factory import Fabrika

LOCK_TIMEOUT = "4s"
TURLAR = 3
DEADLOCK = "40P01"
LOCK_TIMEOUT_CODE = "55P03"
ADMIN_ID = 1
SALEABLE = stock_ledger.StockBucket.SALEABLE


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


def _pg_code(exc: BaseException) -> str | None:
    for cand in (exc, getattr(exc, "orig", None), getattr(exc, "__cause__", None)):
        kod = getattr(cand, "sqlstate", None) or getattr(cand, "pgcode", None)
        if kod:
            return kod
    return None


def _beklenen_mi(exc: BaseException) -> None:
    """Yarışta OLABİLECEK hatalar dışındaki her şeyi yeniden yükseltir."""
    from fastapi import HTTPException

    if isinstance(exc, HTTPException) and exc.status_code in (400, 409):
        return
    if isinstance(exc, stock_ledger.StockLedgerError):
        return
    raise exc


def _kilit_hatasi_yok(sonuclar) -> None:
    for r in sonuclar:
        if not isinstance(r, BaseException):
            continue
        kod = _pg_code(r)
        if kod == DEADLOCK:
            pytest.fail(f"DEADLOCK (40P01) — kilit sırası ihlali: {r}", pytrace=False)
        if kod == LOCK_TIMEOUT_CODE:
            pytest.fail(
                f"KİLİT ZAMAN AŞIMI (55P03) — muhtemel sıralama hatası: {r}",
                pytrace=False,
            )
        _beklenen_mi(r)


async def _hazir_oturum(pid: int, sayilan: int) -> int:
    """REVIEW durumunda, uygulanmaya hazır tek ürünlük oturum."""
    async with AsyncSessionLocal() as db:
        oturum = await inventory_service.create_session(
            db, scope="MANUAL", product_ids=[pid], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await inventory_service.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        for r in (
            await db.execute(
                text("SELECT id, bucket FROM stock_count_lines WHERE session_id = :s"),
                {"s": sid},
            )
        ).all():
            await inventory_service.set_counted(
                db, r.id, sayilan if r.bucket == "SALEABLE" else 0, admin_id=ADMIN_ID
            )
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    return sid


async def _uygula(sid: int, gecikme: float, anahtar: str) -> None:
    await asyncio.sleep(gecikme)
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        await inventory_service.apply_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key=anahtar
        )
        await db.commit()


async def _satis(fab: Fabrika, pid: int, adet: int, gecikme: float) -> None:
    await asyncio.sleep(gecikme)
    await fab.siparis(product_id=pid, quantity=adet)


async def _admin_duzeltmesi(pid: int, delta: int, gecikme: float) -> None:
    await asyncio.sleep(gecikme)
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        await stock_ledger.apply_movement(
            db, pid, qty_delta=delta, bucket=SALEABLE,
            movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
            reason_code="TEDARIK", actor_type="ADMIN", actor_id=ADMIN_ID,
        )
        await db.commit()


async def _iade_geri_yukleme(pid: int, adet: int, gecikme: float) -> None:
    """Tam iade geri yüklemesi (`SALE_CANCEL`) — sipariş yolunun defter etkisi."""
    await asyncio.sleep(gecikme)
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        await stock_ledger.apply_movement(
            db, pid, qty_delta=adet, bucket=SALEABLE,
            movement_type=stock_ledger.StockMovementType.SALE_CANCEL,
            reason_code="ORDER_CANCELLED",
            ref_type="order_item", ref_id=10_000, ref_line_id=None,
            idempotency_key=f"iade-{_uniq()}",
        )
        await db.commit()


async def _yeniden_say(sid: int, sayilan: int, gecikme: float) -> None:
    """REVIEW'daki oturumu geri açıp yeniden sayar (uygulamayla yarışır)."""
    await asyncio.sleep(gecikme)
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        await inventory_service.reopen_session(db, sid, admin_id=ADMIN_ID)
        satir = (
            await db.execute(
                text(
                    "SELECT id FROM stock_count_lines WHERE session_id = :s "
                    "AND bucket = 'SALEABLE'"
                ),
                {"s": sid},
            )
        ).scalar_one()
        await inventory_service.set_counted(db, satir, sayilan, admin_id=ADMIN_ID)
        await db.commit()


async def _zincir_saglam(pid: int) -> None:
    async with AsyncSessionLocal() as db:
        sonuc = await stock_ledger.verify_ledger(db, pid)
    assert sonuc.consistent, f"yarıştan sonra defter bozuk: {sonuc.problems}"


# ── Çift 1: sayım uygulaması ↔ satış ───────────────────────────────────────

@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("sayim_once", [True, False], ids=["sayim-once", "satis-once"])
async def test_sayim_apply_ve_SATIS_yarisi(fab, tur, sayim_once):
    pid = await fab.urun(stock=20)
    sid = await _hazir_oturum(pid, 18)          # −2 fark
    a, b = (0.0, 0.02) if sayim_once else (0.02, 0.0)
    sonuclar = await asyncio.gather(
        _uygula(sid, a, f"s1-{tur}-{_uniq()}"),
        _satis(fab, pid, 2, b),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    await _zincir_saglam(pid)
    # İki hareket de uygulandıysa bakiye ikisinin toplamıdır: 20 − 2 − 2.
    assert await fab.stok(pid) == 16


# ── Çift 2: sayım uygulaması ↔ admin düzeltmesi ────────────────────────────

@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("sayim_once", [True, False], ids=["sayim-once", "admin-once"])
async def test_sayim_apply_ve_ADMIN_DUZELTMESI_yarisi(fab, tur, sayim_once):
    pid = await fab.urun(stock=20)
    sid = await _hazir_oturum(pid, 18)
    a, b = (0.0, 0.02) if sayim_once else (0.02, 0.0)
    sonuclar = await asyncio.gather(
        _uygula(sid, a, f"s2-{tur}-{_uniq()}"),
        _admin_duzeltmesi(pid, +5, b),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    await _zincir_saglam(pid)
    # Admin düzeltmesi sayımdan ÖNCE geçtiyse satır STALE olup uygulama
    # reddedilebilir; SONRA geçtiyse ikisi de uygulanır. İki sonuç da
    # geçerlidir — ölçtüğümüz şey kilit sırası ve defterin sağlamlığıdır.
    assert await fab.stok(pid) in (23, 25)


# ── Çift 3: iki sayım uygulaması (farklı oturum, aynı ürün) ────────────────

@pytest.mark.parametrize("tur", range(TURLAR))
async def test_IKI_AYRI_oturum_ayni_urunu_ayni_anda_uygular(fab, tur):
    """Ürün başına tek AÇIK oturum kısıtı ikinci oturumun **açılmasını**
    engeller; bu yüzden yarış ancak birincisi kapandıktan sonra kurulabilir.
    Burada ölçülen: iki apply aynı ürüne aynı anda gelirse defter bozulmuyor.
    """
    pid = await fab.urun(stock=30)
    ilk = await _hazir_oturum(pid, 28)
    async with AsyncSessionLocal() as db:
        await inventory_service.apply_session(
            db, ilk, admin_id=ADMIN_ID, idempotency_key=f"ilk-{_uniq()}"
        )
        await db.commit()
    ikinci = await _hazir_oturum(pid, 26)

    sonuclar = await asyncio.gather(
        _uygula(ikinci, 0.0, f"a-{tur}-{_uniq()}"),
        _uygula(ikinci, 0.0, f"b-{tur}-{_uniq()}"),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    basarili = [r for r in sonuclar if not isinstance(r, BaseException)]
    assert len(basarili) == 1, f"tam olarak biri kazanmalıydı: {sonuclar}"
    assert await fab.stok(pid) == 26
    await _zincir_saglam(pid)


# ── Çift 4: sayım uygulaması ↔ tam iade geri yüklemesi ─────────────────────

@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("sayim_once", [True, False], ids=["sayim-once", "iade-once"])
async def test_sayim_apply_ve_TAM_IADE_yarisi(fab, tur, sayim_once):
    pid = await fab.urun(stock=20)
    sid = await _hazir_oturum(pid, 18)
    a, b = (0.0, 0.02) if sayim_once else (0.02, 0.0)
    sonuclar = await asyncio.gather(
        _uygula(sid, a, f"s4-{tur}-{_uniq()}"),
        _iade_geri_yukleme(pid, 3, b),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    await _zincir_saglam(pid)
    # `SALE_CANCEL` otomatik uzlaştırılabilir → sayım engellenmez: 20 − 2 + 3.
    assert await fab.stok(pid) == 21


# ── Claim sözleşmesi: DETERMİNİSTİK ────────────────────────────────────────

async def test_SAHIPLENILMIS_oturum_ikinci_kez_uygulanamaz(fab):
    """Koşullu UPDATE claim'inin **gerekliliği** — zamanlamaya bırakılmadan.

    Senaryo gerçektir: bir uygulama isteği oturumu sahiplenir, sonra süreç
    çöker ya da hareketler yazılamaz. Oturum `REVIEW` görünür ama artık BİR
    uygulama denemesine ait damgayı taşır. İkinci bir aktörün farklı bir
    anahtarla sessizce yeniden uygulaması, aynı farkın iki kez yazılması
    riskini doğurur.

    Claim kontrolü kaldırılırsa (yalnız çağrılıp sonucu yok sayılırsa) bu test
    kırılır: uygulama devam eder ve hareket yazar.
    """
    pid = await fab.urun(stock=20)
    sid = await _hazir_oturum(pid, 18)

    # Yarım kalmış bir uygulamanın damgası: claim COMMIT edilmiş, hareket yok.
    async with AsyncSessionLocal() as db:
        sahiplenildi = await inventory_service._claim_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key="yarim-kalan"
        )
        await db.commit()
    assert sahiplenildi is True

    once = await fab.hareket_sayisi(pid)
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await inventory_service.apply_session(
                db, sid, admin_id=ADMIN_ID, idempotency_key="baska-anahtar"
            )
            await db.commit()
    assert getattr(exc.value, "status_code", None) == 409, exc.value
    assert await fab.hareket_sayisi(pid) == once, "sahiplenilmiş oturum yazdı"
    assert await fab.stok(pid) == 20


# ── Çift 5a: DETERMİNİSTİK kilit provası ───────────────────────────────────

async def test_UYGULAMA_SURERKEN_yeniden_sayim_oturumu_DEGISTIREMEZ(fab):
    """Kayıp güncelleme provası — zamanlamaya bırakılmadan.

    Uygulama oturumu claim etmiş ama HENÜZ COMMIT ETMEMİŞKEN gelen bir "yeniden
    say" isteği, kilitsiz okumada eski anlık görüntüde `REVIEW` görür, geçişi
    geçerli sayar ve uygulamanın commit'ini bekledikten sonra oturumu
    `IN_PROGRESS`'e çeker. Sonuç: **hareketleri yazılmış ama uygulanmamış
    görünen** bir oturum.

    Bu hata gerçekten vardı ve yukarıdaki zamanlama tabanlı yarış testi onu
    tesadüfen yakalamıyordu; burada pencere açıkça tutuluyor.
    """
    pid = await fab.urun(stock=20)
    sid = await _hazir_oturum(pid, 18)

    async def yeniden_say() -> None:
        """Kilitte bekler; kilit serbest kalınca TAZE durumu görmek zorunda."""
        async with AsyncSessionLocal() as db:
            await db.execute(text("SET LOCAL lock_timeout = '10s'"))
            await inventory_service.reopen_session(db, sid, admin_id=ADMIN_ID)
            await db.commit()

    uygulama = AsyncSessionLocal()
    gorev = None
    try:
        # A: uygulama oturumu sahiplenir ve APPLIED yapar — COMMIT ETMEZ.
        await inventory_service._claim_session(
            uygulama, sid, admin_id=ADMIN_ID, idempotency_key=f"tut-{_uniq()}"
        )
        await uygulama.execute(
            text("UPDATE stock_count_sessions SET status = 'APPLIED' WHERE id = :i"),
            {"i": sid},
        )
        # B: aynı anda yeniden sayım. Satır kilitli olduğu için BEKLER.
        gorev = asyncio.create_task(yeniden_say())
        await asyncio.sleep(0.3)
        assert not gorev.done(), "yeniden sayım kilidi hiç beklemedi"
        # A commit eder: oturum artık APPLIED.
        await uygulama.commit()
    finally:
        await uygulama.close()

    # Kilitsiz okuyan bir uygulama burada ESKİ anlık görüntüyü (REVIEW) görür,
    # geçişi geçerli sayar ve oturumu IN_PROGRESS'e çeker — hareketleri
    # yazılmış ama "uygulanmamış" görünen bir oturum. `for_update` + taze okuma
    # bunu imkânsız kılar: B, A'nın commit'inden SONRA APPLIED görüp 409 verir.
    with pytest.raises(Exception) as exc:
        await gorev
    assert getattr(exc.value, "status_code", None) == 409, (
        f"yeniden sayım bayat durumla geçti (kayıp güncelleme): {exc.value!r}"
    )

    async with AsyncSessionLocal() as db:
        durum = (
            await db.execute(
                text("SELECT status FROM stock_count_sessions WHERE id = :i"),
                {"i": sid},
            )
        ).scalar_one()
    assert durum == "APPLIED", "uygulanmış oturum yeniden sayımla geri sarılmış"


# ── Çift 5: yeniden sayım ↔ uygulama ───────────────────────────────────────

@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize(
    "sayim_once", [True, False], ids=["yeniden-sayim-once", "apply-once"]
)
async def test_YENIDEN_SAYIM_ve_apply_yarisi(fab, tur, sayim_once):
    """İkisi aynı anda çalışırsa ya uygulama kazanır (oturum APPLIED olur) ya
    yeniden sayım kazanır (oturum IN_PROGRESS'e döner ve apply 409 alır).
    **Asla ikisi birden** olamaz: yarım uygulanmış, sonradan değiştirilmiş bir
    oturum defteri açıklanamaz hâle getirirdi.
    """
    pid = await fab.urun(stock=20)
    sid = await _hazir_oturum(pid, 18)
    a, b = (0.02, 0.0) if sayim_once else (0.0, 0.02)
    sonuclar = await asyncio.gather(
        _uygula(sid, a, f"s5-{tur}-{_uniq()}"),
        _yeniden_say(sid, 15, b),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    await _zincir_saglam(pid)

    async with AsyncSessionLocal() as db:
        durum = (
            await db.execute(
                text("SELECT status FROM stock_count_sessions WHERE id = :i"),
                {"i": sid},
            )
        ).scalar_one()
        hareket = (
            await db.execute(
                text(
                    "SELECT count(*) FROM stock_movements WHERE product_id = :i "
                    "AND movement_type = 'COUNT_ADJUSTMENT'"
                ),
                {"i": pid},
            )
        ).scalar_one()
    if durum == "APPLIED":
        assert hareket == 1
        assert await fab.stok(pid) == 18
    else:
        assert durum == "IN_PROGRESS"
        assert hareket == 0, "uygulanmamış oturum hareket yazmış"
        assert await fab.stok(pid) == 20
