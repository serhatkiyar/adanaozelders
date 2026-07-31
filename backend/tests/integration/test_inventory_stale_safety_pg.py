"""F29 commit 5 — adversarial denetimde bulunan kusurların kabul testleri.

Buradaki her test, denetim sırasında **gerçekten var olan** bir kusuru
kapatıyor. Hepsi gerçek PostgreSQL üzerinde ve deterministiktir: yarış sonucu
`sleep` ile beklenmez, pencere kilitle açıkça tutulur.

1. `resolve_line` yalnız gerekçe yazarak eski sayımı uygulatıyordu.
2. `reopen_session` yarım kalmış sahiplenmeyi temizlemiyordu → oturum kalıcı
   olarak kilitlenebiliyordu.
3. `set_counted` snapshot'ın üç bileşenini ürün kilidi OLMADAN, üç ayrı
   ifadede okuyordu → bayat bakiye + görünmez olay.
4. `counted_at` uygulama sunucusunun saatinden geliyordu.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import inventory_service, stock_ledger
from tests.integration.inventory_factory import Fabrika

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


async def _satirlar(sid: int):
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                text(
                    "SELECT id, bucket, status, counted_qty, system_qty_snapshot, "
                    "reserved_qty_snapshot, snapshot_movement_id, counted_at "
                    "FROM stock_count_lines WHERE session_id = :s ORDER BY bucket"
                ),
                {"s": sid},
            )
        ).all()


async def _oturum_kur(pid: int) -> int:
    async with AsyncSessionLocal() as db:
        oturum = await inventory_service.create_session(
            db, scope="MANUAL", product_ids=[pid], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await inventory_service.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    return sid


async def _say(sid: int, satilabilir: int, hasarli: int = 0) -> None:
    async with AsyncSessionLocal() as db:
        for r in await _satirlar(sid):
            await inventory_service.set_counted(
                db, r.id, satilabilir if r.bucket == "SALEABLE" else hasarli,
                admin_id=ADMIN_ID,
            )
        await db.commit()


async def _sayim_hareketi(*pids: int) -> int:
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                text(
                    "SELECT count(*) FROM stock_movements WHERE product_id = ANY(:i) "
                    "AND movement_type = 'COUNT_ADJUSTMENT'"
                ),
                {"i": list(pids)},
            )
        ).scalar_one()


async def _stale_satir(sid: int) -> int:
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                text(
                    "SELECT id FROM stock_count_lines WHERE session_id = :s "
                    "AND status IN ('STALE','RESOLVED')"
                ),
                {"s": sid},
            )
        ).scalar_one()


async def _iki_urunlu_oturum(a: int, b: int, sayilan: int) -> int:
    async with AsyncSessionLocal() as db:
        oturum = await inventory_service.create_session(
            db, scope="MANUAL", product_ids=[a, b], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await inventory_service.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        for r in await _satirlar(sid):
            if r.bucket == "SALEABLE":
                await inventory_service.set_counted(
                    db, r.id, sayilan, admin_id=ADMIN_ID
                )
        await db.commit()
    return sid


async def _belirsiz_olay(pid: int) -> None:
    """Fiziksel etkisi BELİRSİZ bir olay: elle admin düzeltmesi."""
    async with AsyncSessionLocal() as db:
        await stock_ledger.apply_movement(
            db, pid, qty_delta=+1, bucket=SALEABLE,
            movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
            reason_code="HATALI_GIRIS", actor_type="ADMIN", actor_id=ADMIN_ID,
        )
        await db.commit()


# ══════════ 1. RESOLVED satır UYGULANMAZ ══════════

async def test_RESOLVE_yalniz_GEREKCE_ile_eski_sayimi_UYGULATAMAZ(fab):
    """Kusur: `resolve_line` satırı `RESOLVED` yapıyor, `apply_session` de
    `RESOLVED` satırları uyguluyordu → bir not yazarak, fiziksel etkisi
    bilinmeyen bir olaydan sonra ESKİ sayım deftere yazılabiliyordu.

    Doğru sözleşme: `RESOLVED` = "belirsizlik üstlenildi, satır uygulanmaz".
    Uygulanabilir hâle gelmenin tek yolu yeniden sayımdır.
    """
    pid = await fab.urun(stock=10)
    sid = await _oturum_kur(pid)
    await _say(sid, 7)                      # −3 fark
    await _belirsiz_olay(pid)               # stok 11, satır belirsizleşir
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    satirlar = {r.bucket: r for r in await _satirlar(sid)}
    assert satirlar["SALEABLE"].status == "STALE"

    async with AsyncSessionLocal() as db:
        await inventory_service.resolve_line(
            db, satirlar["SALEABLE"].id, admin_id=ADMIN_ID,
            note="depoda kontrol edildi, sorun yok",
        )
        await db.commit()

    hareket_once = await fab.hareket_sayisi(pid)

    # Gerekçe yazmak satırı çözmez: uygulama REDDEDİLİR ve hiçbir şey yazılmaz.
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await inventory_service.apply_session(
                db, sid, admin_id=ADMIN_ID, idempotency_key=f"r-{_uniq()}"
            )
            await db.commit()
    assert getattr(exc.value, "status_code", None) == 409

    assert await fab.hareket_sayisi(pid) == hareket_once, (
        "çözülmüş satır deftere yazdı — not yazarak eski sayım uygulandı"
    )
    assert await fab.stok(pid) == 11
    assert await _sayim_hareketi(pid) == 0


async def test_RESOLVE_edilen_satir_TUM_oturumu_ENGELLER(fab):
    """Sözleşme değişti (adversarial denetim, 2. tur).

    Önceki hâl: çözülmüş satır atlanıyor, diğer satırlar uygulanıyor ve oturum
    `APPLIED` oluyordu. Bu, "kısmi uygulama yok" sözleşmesini deliyordu: fiziksel
    belirsizlik içeren bir satır sessizce kapsam dışına atılıp oturum terminal
    duruma taşınıyordu.

    Doğru hâl: `RESOLVED` de en az `STALE` kadar engelleyicidir. Tek çıkış
    yeniden sayımdır.
    """
    temiz = await fab.urun(stock=10)
    belirsiz = await fab.urun(stock=10)
    sid = await _iki_urunlu_oturum(temiz, belirsiz, 8)
    await _belirsiz_olay(belirsiz)
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()

    async with AsyncSessionLocal() as db:
        await inventory_service.resolve_line(
            db, await _stale_satir(sid), admin_id=ADMIN_ID,
            note="depoda kontrol edildi",
        )
        await db.commit()

    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await inventory_service.apply_session(
                db, sid, admin_id=ADMIN_ID, idempotency_key=f"r2-{_uniq()}"
            )
            await db.commit()
    assert getattr(exc.value, "status_code", None) == 409

    assert await fab.stok(temiz) == 10, "temiz satır da yazılmamalıydı"
    assert await fab.stok(belirsiz) == 11
    assert await _sayim_hareketi(temiz, belirsiz) == 0
    async with AsyncSessionLocal() as db:
        durum = (
            await db.execute(
                text("SELECT status FROM stock_count_sessions WHERE id = :i"),
                {"i": sid},
            )
        ).scalar_one()
    assert durum == "REVIEW", "engellenen oturum APPLIED olmamalı"


async def test_RESOLVE_sonrasi_YENIDEN_SAYIM_oturumu_acar_ve_HEPSI_yazilir(fab):
    """Engellenen oturumun tek çıkışı yeniden sayımdır; sonra bütün satırlar
    atomik olarak uygulanır (hareketler TAM OLARAK BİR KEZ)."""
    temiz = await fab.urun(stock=10)
    belirsiz = await fab.urun(stock=10)
    sid = await _iki_urunlu_oturum(temiz, belirsiz, 8)
    await _belirsiz_olay(belirsiz)                 # belirsiz: stok 11
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()

    async with AsyncSessionLocal() as db:
        await inventory_service.reopen_session(db, sid, admin_id=ADMIN_ID)
        await inventory_service.set_counted(
            db, await _stale_satir(sid), 9, admin_id=ADMIN_ID
        )
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()

    async with AsyncSessionLocal() as db:
        await inventory_service.apply_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key="tekrar-1"
        )
        await db.commit()
    assert await fab.stok(temiz) == 8
    assert await fab.stok(belirsiz) == 9
    assert await _sayim_hareketi(temiz, belirsiz) == 2

    # Aynı anahtarla retry: EK hareket yazılmaz.
    async with AsyncSessionLocal() as db:
        await inventory_service.apply_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key="tekrar-1"
        )
        await db.commit()
    assert await _sayim_hareketi(temiz, belirsiz) == 2
    assert await fab.stok(temiz) == 8 and await fab.stok(belirsiz) == 9


async def test_BIR_SATIRDAKI_HATA_tum_oturumu_geri_alir(fab):
    """Atomikliğin "hiç" tarafı: ikinci satır bakiyeyi negatife çekiyorsa
    BİRİNCİ satırın hareketi de yazılmamalı.

    Kurgu: `az` ürünü sayımda 0 bulunuyor (fark −2). Sayımdan SONRA 2 adet
    satılıyor (bakiye 0'a düşüyor, `SALE` otomatik uzlaştırılabilir olduğu için
    satır `STALE` OLMUYOR). Uygulama anında 0 + (−2) = −2 → kırpma yasak,
    `InsufficientStock` → bütün oturum geri alınır.
    """
    saglam = await fab.urun(stock=10)
    az = await fab.urun(stock=2)
    async with AsyncSessionLocal() as db:
        oturum = await inventory_service.create_session(
            db, scope="MANUAL", product_ids=[saglam, az], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await inventory_service.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        for r in await _satirlar(sid):
            if r.bucket != "SALEABLE":
                continue
            urun_id = (
                await db.execute(
                    text("SELECT product_id FROM stock_count_lines WHERE id = :i"),
                    {"i": r.id},
                )
            ).scalar_one()
            await inventory_service.set_counted(
                db, r.id, 8 if urun_id == saglam else 0, admin_id=ADMIN_ID
            )
        await db.commit()

    await fab.siparis(product_id=az, quantity=2)      # bakiye 2 → 0
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()

    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await inventory_service.apply_session(
                db, sid, admin_id=ADMIN_ID, idempotency_key=f"neg-{_uniq()}"
            )
            await db.commit()
    assert getattr(exc.value, "status_code", None) == 409
    assert await _sayim_hareketi(saglam, az) == 0, "kısmi uygulama kaldı"
    assert await fab.stok(saglam) == 10, "sağlam satır da yazılmamalıydı"
    assert await fab.stok(az) == 0
    async with AsyncSessionLocal() as db:
        durum = (
            await db.execute(
                text("SELECT status FROM stock_count_sessions WHERE id = :i"),
                {"i": sid},
            )
        ).scalar_one()
    assert durum == "REVIEW"


# ══════════ 2. Yarım kalmış sahiplenme oturumu KİLİTLEMEZ ══════════

async def test_YARIM_KALAN_claim_reopen_ile_TEMIZLENIR(fab):
    """Kusur: `reopen_session` `apply_idempotency_key`'i temizlemiyordu.

    Claim koşulu `apply_idempotency_key IS NULL` olduğundan, bir kez
    sahiplenilmiş oturum yeniden sayılıp gönderilse bile bir daha ASLA
    uygulanamıyordu — kalıcı kilit.
    """
    pid = await fab.urun(stock=10)
    sid = await _oturum_kur(pid)
    await _say(sid, 8)
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()

    # Yarım kalmış uygulama: claim COMMIT edildi, hareket yazılmadı.
    async with AsyncSessionLocal() as db:
        assert await inventory_service._claim_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key="yarim"
        )
        await db.commit()

    # Kurtarma yolu: oturumu sayıma geri aç → sahiplenme temizlenir.
    async with AsyncSessionLocal() as db:
        await inventory_service.reopen_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        satir = (
            await db.execute(
                text(
                    "SELECT apply_idempotency_key, applied_at, applied_by_admin_id "
                    "FROM stock_count_sessions WHERE id = :i"
                ),
                {"i": sid},
            )
        ).one()
    assert satir.apply_idempotency_key is None
    assert satir.applied_at is None and satir.applied_by_admin_id is None

    await _say(sid, 8)
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await inventory_service.apply_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key=f"yeni-{_uniq()}"
        )
        await db.commit()
    assert await fab.stok(pid) == 8


# ══════════ 3. Snapshot ürün kilidi altında ══════════

async def test_snapshot_TEK_IFADEDE_alinir(fab):
    """Karışık kesitin **yapısal** kanıtı: kesit tek `SELECT` ile alınmalı.

    İkiye bölünürse READ COMMITTED'da iki ayrı anlık görüntü doğar ve
    `PAID→SHIPPED` gibi bir olay araya girip bakiye ile rezervenin farklı
    gerçekleri anlatmasına yol açar. Sorgu sayısını saymak bu sözleşmeyi
    davranışla sabitler; kod okumasıyla verilen söz sessizce bozulabilir.

    ⚠️ Ürün kilidi BİLİNÇLİ olarak alınmıyor: sipariş durumunu değiştiren
    üretim yollarının hiçbiri `Product` kilidi almadığı için kilit rezerve
    yarışını kapatmıyordu, yalnız sayım süresince satışı bloke ediyordu.
    """
    from tests.integration.test_stock_audit_pg import SorguSayaci

    pid = await fab.urun(stock=10)
    await fab.siparis(product_id=pid, quantity=2)
    async with AsyncSessionLocal() as db:
        with SorguSayaci() as sayac:
            await inventory_service.snapshot_for_line(db, pid, "SALEABLE")
    assert sayac.adet == 1, (
        "kesit birden fazla ifadeyle alınıyor → karışık kesit yarışı açık: "
        f"{[q.split()[0] for q in sayac.sorgular]}"
    )


async def test_snapshot_UC_BILESENI_ayni_gercegi_anlatir(fab):
    """Kilit altında okunan bakiye ile yüksek-su işareti uyumlu olmalı:
    snapshot'tan sonra yazılan HER hareket `snapshot_movement_id`'den büyük
    kimlik almalı, yani `STALE` tespitine görünür olmalı."""
    pid = await fab.urun(stock=10)
    sid = await _oturum_kur(pid)
    await _say(sid, 10)
    kova = {r.bucket: r for r in await _satirlar(sid)}
    hw = kova["SALEABLE"].snapshot_movement_id

    await _belirsiz_olay(pid)
    async with AsyncSessionLocal() as db:
        yeni = (
            await db.execute(
                text(
                    "SELECT max(id) FROM stock_movements WHERE product_id = :i "
                    "AND bucket = 'SALEABLE'"
                ),
                {"i": pid},
            )
        ).scalar_one()
    assert yeni > hw, "sayımdan sonraki hareket yüksek-su işaretinin ALTINDA kaldı"

    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    kova = {r.bucket: r for r in await _satirlar(sid)}
    assert kova["SALEABLE"].status == "STALE"


async def test_DAMAGED_satirinda_reserved_snapshot_DAIMA_NULL(fab):
    """Hasarlı ürün siparişe ayrılamaz; orada rezerve kavramı yoktur.
    Rezerve dolu olsaydı hasarlı fark rezerve kadar kayardı."""
    pid = await fab.urun(stock=10)
    await fab.siparis(product_id=pid, quantity=3)     # rezerve 3
    sid = await _oturum_kur(pid)
    await _say(sid, 10, hasarli=0)
    kova = {r.bucket: r for r in await _satirlar(sid)}
    assert kova["SALEABLE"].reserved_qty_snapshot == 3
    assert kova["DAMAGED"].reserved_qty_snapshot is None

    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await inventory_service.apply_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key=f"d-{_uniq()}"
        )
        await db.commit()
    async with AsyncSessionLocal() as db:
        hasarli = (
            await db.execute(
                text("SELECT damaged_stock FROM products WHERE id = :i"), {"i": pid}
            )
        ).scalar_one()
    assert hasarli == 0


# ══════════ 4. counted_at VERİTABANI saati ══════════

async def test_counted_at_VERITABANI_saatinden_gelir_ve_transaction_basina_DONMEZ(fab):
    """`now()` transaction BAŞLANGICINA sabittir: aynı transaction'da art arda
    sayılan iki satır aynı damgayı alırdı ve uzun bir transaction'da damga
    gerçek sayım anından dakikalarca eski olurdu. `clock_timestamp()` gerçek
    duvar saatidir.

    Ayrıca damganın uygulama sunucusunun saatinden GELMEDİĞİ, DB saatiyle
    karşılaştırılarak gösterilir.
    """
    pid = await fab.urun(stock=10)
    sid = await _oturum_kur(pid)
    satirlar = await _satirlar(sid)

    async with AsyncSessionLocal() as db:
        db_once = (await db.execute(text("SELECT clock_timestamp()"))).scalar_one()
        for r in satirlar:
            await inventory_service.set_counted(db, r.id, 1, admin_id=ADMIN_ID)
        db_sonra = (await db.execute(text("SELECT clock_timestamp()"))).scalar_one()
        await db.commit()

    damgalar = [r.counted_at for r in await _satirlar(sid)]
    assert all(db_once <= d <= db_sonra for d in damgalar), damgalar
    assert len(set(damgalar)) == len(damgalar), (
        "aynı transaction'daki iki satır AYNI damgayı aldı (now() donmuş)"
    )


# ══════════ 5. SALE_CANCEL'ın gerçek anlamı ══════════
#
# Üretimde tek yazıcı var: `order_service._restock` ← `_refund_payment`.
# İki akış, iki farklı fiziksel anlam:
#   * `cancel_by_client`  → ORDER_CANCELLED — SHIPPED/DELIVERED'ı 409 reddeder
#   * `refund_order`      → ORDER_REFUNDED  — `order.status` guard'ı YOK,
#                            FSM SHIPPED/DELIVERED → REFUNDED'a izin verir
# Bu yüzden ikincisinde POZİTİF kanıt aranır.

async def _sale_cancel(pid: int, oid: int, reason: str, adet: int = 2) -> None:
    async with AsyncSessionLocal() as db:
        await stock_ledger.apply_movement(
            db, pid, qty_delta=adet, bucket=SALEABLE,
            movement_type=stock_ledger.StockMovementType.SALE_CANCEL,
            reason_code=reason, ref_type="order_item", ref_id=oid,
            idempotency_key=f"sc-{_uniq()}",
        )
        await db.commit()


async def _gecmis(oid: int, *durumlar: str) -> None:
    async with AsyncSessionLocal() as db:
        for d in durumlar:
            await db.execute(
                text(
                    "INSERT INTO order_status_history "
                    "(order_id, old_status, new_status, changed_by, created_at, "
                    " updated_at) VALUES (:o, NULL, :d, 'test', now(), now())"
                ),
                {"o": oid, "d": d},
            )
        await db.commit()


async def _sayip_gonder(pid: int, sayilan: int) -> tuple[int, str]:
    sid = await _oturum_kur(pid)
    await _say(sid, sayilan)
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    kova = {r.bucket: r for r in await _satirlar(sid)}
    return sid, kova["SALEABLE"].status


async def test_ORDER_CANCELLED_iptali_cikis_ONCESIDIR_STALE_YAPMAZ(fab):
    """`cancel_by_client` SHIPPED/DELIVERED'ı reddeder → mal yapısı gereği
    işletmededir; sayım engellenmemeli."""
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2, sale_yaz=False)
    await _gecmis(oid, "PENDING", "PAID")
    sid = await _oturum_kur(pid)
    await _say(sid, 10)
    await _sale_cancel(pid, oid, "ORDER_CANCELLED")
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    kova = {r.bucket: r for r in await _satirlar(sid)}
    assert kova["SALEABLE"].status == "COUNTED"


async def test_SHIPPED_siparisin_ORDER_REFUNDED_iptali_STALE_YAPAR(fab):
    """Kusur: `refund_order` çıkmış siparişte de `SALE_CANCEL` yazıyor ve
    satılabilir stok, KURYEDEKİ kitapla birlikte artıyor. Sayım bunu 'fazla'
    diye düzeltirse hatayı kalıcı hâle getirir."""
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2, sale_yaz=False)
    await _gecmis(oid, "PAID", "SHIPPED")
    sid = await _oturum_kur(pid)
    await _say(sid, 10)
    await _sale_cancel(pid, oid, "ORDER_REFUNDED")
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    kova = {r.bucket: r for r in await _satirlar(sid)}
    assert kova["SALEABLE"].status == "STALE"
    assert kova["SALEABLE"].snapshot_movement_id is not None


async def test_DELIVERED_siparisin_ORDER_REFUNDED_iadesi_STALE_YAPAR(fab):
    """Teslim edilmiş sipariş: kitap müşteride. FSM DELIVERED → REFUNDED'a
    izin veriyor (`order_fsm.py:28`)."""
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2, sale_yaz=False)
    await _gecmis(oid, "PAID", "SHIPPED", "DELIVERED")
    sid = await _oturum_kur(pid)
    await _say(sid, 10)
    await _sale_cancel(pid, oid, "ORDER_REFUNDED")
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    kova = {r.bucket: r for r in await _satirlar(sid)}
    assert kova["SALEABLE"].status == "STALE"


async def test_GECMISI_OLMAYAN_ORDER_REFUNDED_iadesi_de_STALE_YAPAR(fab):
    """FAIL-SAFE: kanıtın YOKLUĞU "mal çıkmadı" anlamına gelmez.

    Durum geçmişi olmayan bir sipariş (eski veri, seed, dış içe aktarım) için
    çıkış yapılıp yapılmadığı bilinemez. Kanıtsız durumu otomatik uzlaştırmaya
    sokmak, sayımın tüm anlamını yok ederdi.
    """
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2, sale_yaz=False)
    # order_status_history BİLİNÇLİ olarak boş bırakıldı.
    sid = await _oturum_kur(pid)
    await _say(sid, 10)
    await _sale_cancel(pid, oid, "ORDER_REFUNDED")
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    kova = {r.bucket: r for r in await _satirlar(sid)}
    assert kova["SALEABLE"].status == "STALE"


async def test_CIKMAMIS_ORDER_REFUNDED_iadesi_STALE_YAPMAZ(fab):
    """Karşı prova: geçmiş VAR ve içinde `SHIPPED` YOK → mal çıkmamıştır.

    Bu test olmadan "bütün ORDER_REFUNDED'ları STALE yap" gibi aşırı-korumacı
    bir uygulama da yeşil kalır ve ödeme öncesi iptaller sayımı boşuna kilitlerdi.
    """
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2, sale_yaz=False)
    await _gecmis(oid, "PENDING", "PAID")
    sid = await _oturum_kur(pid)
    await _say(sid, 10)
    await _sale_cancel(pid, oid, "ORDER_REFUNDED")
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    kova = {r.bucket: r for r in await _satirlar(sid)}
    assert kova["SALEABLE"].status == "COUNTED"


# ══════════ 6. Çok satırlı uygulama TAM yazılır ══════════

async def test_COK_SATIRLI_oturum_BUTUN_hareketleri_yazar(fab):
    """Atomikliğin ikinci yüzü: "hiç ya da hep"in **hep** tarafı.

    Kapsam boşluğu olarak bulundu: mevcut testlerin hiçbiri iki farklı ürüne
    aynı anda hareket yazan bir oturumu uygulamıyordu. `apply_many(db, specs)`
    yerine `apply_many(db, specs[:1])` yazan bir mutasyon (yani ilk satırdan
    sonrasını yazmayan kısmi uygulama) hiçbir testi kırmıyordu.
    """
    a = await fab.urun(stock=10)
    b = await fab.urun(stock=20)
    async with AsyncSessionLocal() as db:
        oturum = await inventory_service.create_session(
            db, scope="MANUAL", product_ids=[a, b], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await inventory_service.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()

    beklenen = {a: 7, b: 15}          # ikisinde de SIFIRDAN FARKLI fark
    async with AsyncSessionLocal() as db:
        for r in (
            await db.execute(
                text(
                    "SELECT id, product_id, bucket FROM stock_count_lines "
                    "WHERE session_id = :s"
                ),
                {"s": sid},
            )
        ).all():
            if r.bucket == "SALEABLE":
                await inventory_service.set_counted(
                    db, r.id, beklenen[r.product_id], admin_id=ADMIN_ID
                )
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()

    async with AsyncSessionLocal() as db:
        await inventory_service.apply_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key=f"cok-{_uniq()}"
        )
        await db.commit()

    assert await fab.stok(a) == 7
    assert await fab.stok(b) == 15
    async with AsyncSessionLocal() as db:
        adet = (
            await db.execute(
                text(
                    "SELECT count(*) FROM stock_movements WHERE product_id = ANY(:i) "
                    "AND movement_type = 'COUNT_ADJUSTMENT'"
                ),
                {"i": [a, b]},
            )
        ).scalar_one()
        satirlar = (
            await db.execute(
                text(
                    "SELECT count(*) FROM stock_count_lines WHERE session_id = :s "
                    "AND applied_movement_id IS NOT NULL"
                ),
                {"s": sid},
            )
        ).scalar_one()
    assert adet == 2, "iki satırın ikisi de deftere yazılmalıydı"
    assert satirlar == 2, "uygulanan hareket kimliği her satıra bağlanmalı"


# ══════════ 7. Sipariş durumu yarışı — KARIŞIK KESİT OLMAZ ══════════
#
# Kanıt: sipariş durumunu değiştiren üretim yollarının HİÇBİRİ `Product` kilidi
# almaz ve hiçbiri defter hareketi yazmaz — `delivery_service` `stock_ledger`'ı
# hiç import etmez (`start_run` · `add_stops` · `remove_stop` · `fail_stop` ·
# `cancel_run` · `expire_stale_runs` · `mark_shipped` · `mark_delivered` ·
# `postpone_delivery`). Yani kilit bu ekseni koruyamaz; koruma **tek ifadelik
# kesitten** gelir.
#
# Testler `sleep` KULLANMAZ: pencere, commit edilmemiş bir transaction ile
# açıkça tutulur. PostgreSQL MVCC'de commit edilmemiş bir UPDATE okuyucuyu
# bloklamaz, bu yüzden sonuç deterministiktir.


async def _kesit(sid: int, bucket: str = "SALEABLE"):
    return {r.bucket: r for r in await _satirlar(sid)}[bucket]


async def test_ODEME_SEVKIYAT_gecisi_COMMIT_EDILMEDEN_kesit_TAMAMEN_ONCESI(fab):
    """`PAID→SHIPPED` başlamış ama commit etmemişken sayım yapılıyor.

    Beklenen: kesit **tamamen olay öncesi** — bakiye 8, rezerve 2, beklenen 10.
    Karışık kesitte bakiye 8 + rezerve 0 okunur ve +2'lik sahte bir fazla
    uydurulurdu.
    """
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2)   # stok 8, rezerve 2
    sid = await _oturum_kur(pid)
    satir_id = (await _kesit(sid)).id

    gecis = AsyncSessionLocal()
    try:
        await gecis.execute(
            text("UPDATE orders SET status = 'SHIPPED' WHERE id = :i"), {"i": oid}
        )
        # COMMIT YOK — sayım tam bu pencerede yapılıyor.
        async with AsyncSessionLocal() as db:
            await inventory_service.set_counted(db, satir_id, 10, admin_id=ADMIN_ID)
            await db.commit()
    finally:
        await gecis.rollback()
        await gecis.close()

    k = await _kesit(sid)
    assert k.system_qty_snapshot == 8
    assert k.reserved_qty_snapshot == 2, "karışık kesit: rezerve olay sonrası"
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await inventory_service.apply_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key=f"y1-{_uniq()}"
        )
        await db.commit()
    assert await fab.stok(pid) == 8, "fark uydurulmuş"
    assert await _sayim_hareketi(pid) == 0


async def test_ODEME_SEVKIYAT_gecisi_COMMIT_EDILINCE_kesit_TAMAMEN_SONRASI(fab):
    """Aynı olay sayımdan ÖNCE commit edilirse kesit tamamen olay sonrasıdır."""
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2)
    sid = await _oturum_kur(pid)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE orders SET status = 'SHIPPED' WHERE id = :i"), {"i": oid}
        )
        await db.commit()
    async with AsyncSessionLocal() as db:
        await inventory_service.set_counted(
            db, (await _kesit(sid)).id, 8, admin_id=ADMIN_ID
        )
        await db.commit()

    k = await _kesit(sid)
    assert k.system_qty_snapshot == 8
    assert k.reserved_qty_snapshot == 0, "karışık kesit: rezerve olay öncesi"


async def test_SEVKIYATTAN_GERI_DONUS_commit_edilmeden_kesit_TAMAMEN_ONCESI(fab):
    """`SHIPPED→PAID` (teslim edilemedi): paket işletmeye geri dönüyor."""
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE orders SET status = 'SHIPPED' WHERE id = :i"), {"i": oid}
        )
        await db.commit()
    sid = await _oturum_kur(pid)
    satir_id = (await _kesit(sid)).id

    geri = AsyncSessionLocal()
    try:
        await geri.execute(
            text("UPDATE orders SET status = 'PAID' WHERE id = :i"), {"i": oid}
        )
        async with AsyncSessionLocal() as db:
            await inventory_service.set_counted(db, satir_id, 8, admin_id=ADMIN_ID)
            await db.commit()
    finally:
        await geri.rollback()
        await geri.close()

    k = await _kesit(sid)
    assert k.system_qty_snapshot == 8
    assert k.reserved_qty_snapshot == 0, "karışık kesit: rezerve geri dönüş sonrası"


async def test_KESITTEN_SONRA_baslayan_sevkiyat_farki_TASIMAZ(fab):
    """Olay kesitten SONRA gerçekleşiyor: `ORDER_SHIPPED` otomatik
    uzlaştırılabilir olduğu için satır `STALE` olmaz ve fark taşınmaz."""
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2)
    sid = await _oturum_kur(pid)
    await _say(sid, 10)                      # beklenen 8+2=10 → fark 0
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE orders SET status = 'SHIPPED' WHERE id = :i"), {"i": oid}
        )
        await db.commit()
    async with AsyncSessionLocal() as db:
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    assert (await _kesit(sid)).status == "COUNTED"
    async with AsyncSessionLocal() as db:
        await inventory_service.apply_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key=f"y4-{_uniq()}"
        )
        await db.commit()
    assert await fab.stok(pid) == 8
    assert await _sayim_hareketi(pid) == 0


async def test_sayim_ve_siparis_gecisi_DEADLOCK_uretmez(fab):
    """Sayım hiçbir sipariş/ürün kilidi almadığı için sipariş durum geçişleriyle
    kilit döngüsü kuramaz. `lock_timeout` ile kanıtlanır: askıda kalma yok,
    beklenmeyen istisna yutulmaz."""
    pid = await fab.urun(stock=20)
    oid = await fab.siparis(product_id=pid, quantity=3)
    sid = await _oturum_kur(pid)
    satir_id = (await _kesit(sid)).id

    async def say():
        async with AsyncSessionLocal() as db:
            await db.execute(text("SET LOCAL lock_timeout = '4s'"))
            await inventory_service.set_counted(db, satir_id, 20, admin_id=ADMIN_ID)
            await db.commit()

    async def gecis():
        async with AsyncSessionLocal() as db:
            await db.execute(text("SET LOCAL lock_timeout = '4s'"))
            await db.execute(
                text("SELECT id FROM orders WHERE id = :i FOR UPDATE"), {"i": oid}
            )
            await db.execute(
                text("UPDATE orders SET status = 'SHIPPED' WHERE id = :i"), {"i": oid}
            )
            await db.commit()

    sonuclar = await asyncio.gather(say(), gecis(), return_exceptions=True)
    for r in sonuclar:
        if isinstance(r, BaseException):
            raise r
    k = await _kesit(sid)
    assert k.counted_qty == 20
    assert k.reserved_qty_snapshot in (0, 3), "kesit ara bir değer aldı"
