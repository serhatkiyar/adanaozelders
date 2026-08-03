"""F30 paketleme davranışı — GERÇEK PostgreSQL.

Ölçülen: paket açma, kalem doğrulama (barkod/SKU/kontrollü manuel), eksik-yanlış-
fazla reddi, idempotency, STALE, iptal etkileşimi ve **F29 stoğuna dokunmama**.

Bu dosyadaki her düğüm F30 üretim kodu yazılana kadar KIRMIZIDIR. Yükleyici
`pytest.fail(pytrace=False)` kullanır: çıplak import tüm dosyayı collection'da
düşürür ve 20 ayrı kabul kriteri tek satıra iner.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from core.database import AsyncSessionLocal
from tests.integration.f30_factory import PaketFabrikasi


def _servis():
    try:
        from services import packing_service
    except ImportError as exc:  # noqa: PERF203
        pytest.fail(
            f"HENÜZ YAZILMADI: services/packing_service.py ({exc})", pytrace=False
        )
    return packing_service


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    yield f
    await f.temizle()


async def _admin(fab: PaketFabrikasi) -> int:
    return await fab.admin()


# ══════════════════ Paket açma ve kalem görünürlüğü ═════════════════════════


@pytest.mark.asyncio
async def test_pakette_DOGRU_kalemler_SKU_ve_adetle_gorunur(fab):
    """Kullanıcı maddesi 2: operatör siparişe girecek ürünleri, SKU'ları ve
    adetleri görür. Snapshot paket satırında alınır (sözleşme §3.6)."""
    servis = _servis()
    aid = await _admin(fab)
    p1, sku1, ean1 = await fab.barkodlu_urun(stock=10)
    p2, sku2, _ean2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 2), (p2, 1)])

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)

    satirlar = {r.sku: r for r in paket.items}
    assert set(satirlar) == {sku1, sku2}
    assert satirlar[sku1].expected_qty == 2
    assert satirlar[sku1].scanned_qty == 0
    assert satirlar[sku1].barcode == ean1
    assert paket.status == "OPEN"
    assert paket.code.startswith("PKT-")


@pytest.mark.asyncio
async def test_DIJITAL_kalem_pakete_GIRMEZ(fab):
    """Dijital ürün fiziksel olarak toplanmaz; paket satırı üretmez."""
    servis = _servis()
    aid = await _admin(fab)
    fiziksel, sku, _e = await fab.barkodlu_urun(stock=5)
    dijital = await fab.urun(stock=None, kind="DIGITAL")
    oid = await fab.fiziksel_siparis(kalemler=[(fiziksel, 1)])
    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        await s.execute(
            text(
                "INSERT INTO order_items (order_id, product_id, title, unit_price, "
                "quantity, kind, seller_type, created_at, updated_at) VALUES "
                "(:o, :p, 'Dijital', 50, 1, 'DIGITAL', 'PLATFORM', now(), now())"
            ),
            {"o": oid, "p": dijital},
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    assert [r.sku for r in paket.items] == [sku]


@pytest.mark.asyncio
async def test_ayni_siparise_ikinci_paket_ACILMAZ(fab):
    """Kullanıcı ilkesi: paket–sipariş ilişkisi tekil ve izlenebilir olmalı.
    İkinci çağrı yeni paket yaratmaz; mevcut canlı paketi döner (idempotent)."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, _e = await fab.barkodlu_urun(stock=5)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])

    async with AsyncSessionLocal() as s:
        birinci = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        ikinci = await servis.open_package(s, oid, admin_id=aid)
    assert birinci.id == ikinci.id

    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        adet = (
            await s.execute(
                text("SELECT count(*) FROM order_packages WHERE order_id = :o"),
                {"o": oid},
            )
        ).scalar_one()
    assert adet == 1


@pytest.mark.asyncio
async def test_paket_QR_TEKILDIR(fab):
    """Kullanıcı maddesi: paket QR'si tekildir. DB'de UNIQUE ile korunur."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _s1, _e = await fab.barkodlu_urun(stock=10)
    o1 = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    o2 = await fab.fiziksel_siparis(kalemler=[(pid, 1)])

    async with AsyncSessionLocal() as s:
        a = await servis.open_package(s, o1, admin_id=aid)
    async with AsyncSessionLocal() as s:
        b = await servis.open_package(s, o2, admin_id=aid)
    assert a.qr_payload != b.qr_payload

    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        indeks = (
            await s.execute(
                text(
                    "SELECT indexdef FROM pg_indexes WHERE tablename='order_packages' "
                    "AND indexdef ILIKE '%qr_token%'"
                )
            )
        ).scalars().all()
    assert any("UNIQUE" in i.upper() for i in indeks), "qr_token UNIQUE değil"


# ══════════════════ Tarama: kabul ve red ════════════════════════════════════


@pytest.mark.asyncio
async def test_dogru_barkod_taramasi_adedi_ARTIRIR(fab):
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        sonuc = await servis.scan(s, paket.id, code=ean, admin_id=aid)
    assert sonuc.result == "OK"

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.items[0].scanned_qty == 1


@pytest.mark.asyncio
async def test_YANLIS_SKU_taramasi_REDDEDILIR(fab):
    """Kullanıcı maddesi 4: yanlış ürün sisteme kabul edilmez.

    Red bir OLAYDIR: `result` döner, adet artmaz ve iz `package_scan_events`'e
    yazılır (operasyon analizi için — "hangi rafta yanlış kitap duruyor").
    """
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    yabanci, yabanci_sku, _ye = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        sonuc = await servis.scan(s, paket.id, code=yabanci_sku, admin_id=aid)
    assert sonuc.result == "WRONG_SKU"

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.items[0].scanned_qty == 0

    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        izler = (
            await s.execute(
                text(
                    "SELECT event_type, result FROM package_scan_events "
                    "WHERE package_id = :p ORDER BY id"
                ),
                {"p": paket.id},
            )
        ).all()
    # İz tablosu YALNIZ taramaların değil, paket yaşam döngüsünün TAMAMININ
    # kaydıdır (sözleşme §5): paket açılışı da bir olaydır. Bu yüzden iddia
    # "tek satır var" değil, "tarama satırı redle yazıldı"dır — ve açılış
    # olayının varlığı da ayrıca doğrulanır (aksi hâlde OPEN olayı sessizce
    # kaldırılsa bu test hiçbir şey söylemezdi).
    assert [e for e, _r in izler] == ["OPEN", "SCAN"]
    assert [r for e, r in izler if e == "SCAN"] == ["WRONG_SKU"], (
        "red taraması ize yazılmamış"
    )


@pytest.mark.asyncio
async def test_FAZLA_ADET_taramasi_REDDEDILIR(fab):
    """Kullanıcı maddesi 4: fazla ürün kabul edilmez. 2 beklenen kalemde
    3. tarama adedi artırmaz."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    for _ in range(2):
        async with AsyncSessionLocal() as s:
            assert (await servis.scan(s, paket.id, code=ean, admin_id=aid)).result == "OK"
    async with AsyncSessionLocal() as s:
        sonuc = await servis.scan(s, paket.id, code=ean, admin_id=aid)
    assert sonuc.result == "OVER_QTY"

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.items[0].scanned_qty == 2


@pytest.mark.asyncio
async def test_fazla_adet_DB_CHECK_ile_de_engellenir(fab):
    """Uygulama katmanı atlansa bile `scanned_qty <= expected_qty` CHECK'i
    tutar. Tek katmanlı koruma, koruma değildir."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, _e = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)

    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        async with AsyncSessionLocal() as s:
            from sqlalchemy import text

            await s.execute(
                text(
                    "UPDATE order_package_items SET scanned_qty = 5 "
                    "WHERE package_id = :p"
                ),
                {"p": paket.id},
            )
            await s.commit()


@pytest.mark.asyncio
async def test_urunu_SILINMIS_kalem_yalniz_MANUEL_gecer(fab):
    """Sözleşme §3.6: `product_id` SET NULL olmuş geçmiş kalem taranamaz;
    gerekçeli manuel doğrulama ile kapanır ve iz bırakır."""
    servis = _servis()
    aid = await _admin(fab)
    pid, sku, _e = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        await s.execute(
            text("UPDATE order_items SET product_id = NULL WHERE order_id = :o"),
            {"o": oid},
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    kalem_id = paket.items[0].order_item_id

    async with AsyncSessionLocal() as s:
        assert (await servis.scan(s, paket.id, code=sku, admin_id=aid)).result == (
            "WRONG_SKU"
        )
    async with AsyncSessionLocal() as s:
        sonuc = await servis.scan(
            s, paket.id, code=sku, admin_id=aid, manual=True,
            manual_reason="Ürün kataloğdan silinmiş, künye elden doğrulandı",
            order_item_id=kalem_id,
        )
    assert sonuc.result == "OK_MANUAL"

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.items[0].scanned_qty == 1


@pytest.mark.asyncio
async def test_manuel_dogrulama_GEREKCESIZ_REDDEDILIR(fab):
    """Kaçış kapısı akışın içindedir ama izsiz değildir."""
    servis = _servis()
    aid = await _admin(fab)
    pid, sku, _e = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.scan(
                s, paket.id, code=sku, admin_id=aid, manual=True, manual_reason="",
                order_item_id=paket.items[0].order_item_id,
            )
    assert hata.value.status_code in (400, 422)


@pytest.mark.asyncio
async def test_tarama_izi_APPEND_ONLY(fab):
    """F29 üç iz tablosunu trigger'la kilitledi; F30 aynı duruşu sürdürür."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean, admin_id=aid)

    from sqlalchemy.exc import DBAPIError, IntegrityError

    for sorgu in (
        "UPDATE package_scan_events SET result = 'OK' WHERE package_id = :p",
        "DELETE FROM package_scan_events WHERE package_id = :p",
    ):
        with pytest.raises((DBAPIError, IntegrityError)):
            async with AsyncSessionLocal() as s:
                from sqlalchemy import text

                await s.execute(text(sorgu), {"p": paket.id})
                await s.commit()


# ══════════════════ Idempotency ═════════════════════════════════════════════


@pytest.mark.asyncio
async def test_CIFT_TARAMA_ayni_key_ile_adedi_IKI_KEZ_ARTIRMAZ(fab):
    """Kullanıcı ilkesi: aynı tarama tekrarı ikinci işlem üretmemeli.

    Ağ tekrarı/çift tıklama senaryosu: istemci aynı `idempotency_key` ile
    yeniden gönderir; adet 1 kalır ve iz tekrarlanmaz.
    """
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)

    anahtar = "tarama-1"
    for _ in range(3):
        async with AsyncSessionLocal() as s:
            sonuc = await servis.scan(
                s, paket.id, code=ean, admin_id=aid, idempotency_key=anahtar
            )
        assert sonuc.result == "OK"

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.items[0].scanned_qty == 1, "aynı anahtar adedi birden fazla artırdı"

    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        iz = (
            await s.execute(
                text(
                    "SELECT count(*) FROM package_scan_events "
                    "WHERE package_id = :p AND event_type = 'SCAN'"
                ),
                {"p": paket.id},
            )
        ).scalar_one()
    # Yalnız TARAMA olayları sayılır: paket açılışı da ize yazılır (§5) ve
    # onu saymak "üç tekrar tek olay üretti" iddiasını bulanıklaştırırdı.
    assert iz == 1, "aynı anahtarla gelen tekrar ikinci bir tarama izi yazdı"


@pytest.mark.asyncio
async def test_ayni_key_FARKLI_KOD_ile_CATISIR(fab):
    """F29 deseni (`stock_ledger.payload_differences`): aynı anahtar farklı
    yükle gelirse sessizce ilk sonucu döndürmek veriyi bozar → 409."""
    servis = _servis()
    aid = await _admin(fab)
    p1, sku1, ean1 = await fab.barkodlu_urun(stock=10)
    p2, sku2, _e2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)

    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean1, admin_id=aid, idempotency_key="k1")
    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=sku2, admin_id=aid, idempotency_key="k1")
    assert hata.value.status_code == 409


@pytest.mark.asyncio
async def test_ANAHTARSIZ_iki_tarama_iki_kez_sayar(fab):
    """Nöbetçi: idempotency, anahtar VERİLDİĞİNDE çalışır. Anahtarsız iki ayrı
    okutma gerçekten iki kalemdir (2 adetlik satırda meşru davranış). Aksi hâlde
    test, idempotency'i "her tekrar yutulur" diye yanlış sabitlerdi."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    for _ in range(2):
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.items[0].scanned_qty == 2


# ══════════════════ Tamamlama ═══════════════════════════════════════════════


@pytest.mark.asyncio
async def test_EKSIK_KALEMLE_paket_TAMAMLANAMAZ(fab):
    """Kullanıcı maddesi 5: sipariş ancak bütün kalemler doğru tamamlanınca
    paketlenmiş sayılır."""
    servis = _servis()
    aid = await _admin(fab)
    p1, _s1, ean1 = await fab.barkodlu_urun(stock=10)
    p2, _s2, _e2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean1, admin_id=aid)

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.complete(s, paket.id, admin_id=aid)
    assert hata.value.status_code == 409

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.status == "OPEN"
    assert await fab.prepared_at(oid) is None


@pytest.mark.asyncio
async def test_TAM_paket_PACKED_olur_ve_PREPARED_damgalanir(fab):
    """`prepared_at` artık elle değil, doğrulanmış paketle damgalanır
    (sözleşme §3.5). Böylece sipariş `eligible_orders`'a geçer."""
    servis = _servis()
    from services import delivery_service

    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    for _ in range(2):
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        sonuc = await servis.complete(s, paket.id, admin_id=aid)

    assert sonuc.status == "PACKED"
    assert sonuc.packed_at is not None
    assert await fab.prepared_at(oid) is not None

    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
        kuyruk = {o.order_id for o in await delivery_service.prep_queue(s)}
    assert oid in uygun and oid not in kuyruk


@pytest.mark.asyncio
async def test_complete_IDEMPOTENT(fab):
    """Çift tıklama ikinci bir damga/geçiş üretmez."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        birinci = await servis.complete(s, paket.id, admin_id=aid)
    async with AsyncSessionLocal() as s:
        ikinci = await servis.complete(s, paket.id, admin_id=aid)
    assert birinci.packed_at == ikinci.packed_at


@pytest.mark.asyncio
async def test_paket_tamamlaninca_DEFTERE_HAREKET_YAZILMAZ(fab):
    """Tasarım ilkesi 1-3 ve denetçi notu 2: F30 stoğu ikinci kez düşürmez.

    `SALE` ödeme anında yazıldı; paketleme fiziksel konum olayıdır
    (`PHYSICAL_EFFECT["ORDER_PREPARED"] = (0,0,0,0)`).
    """
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 3)])

    stok_once = await fab.stok(pid)
    hareket_once = await fab.hareket_sayisi(pid)

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    for _ in range(3):
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.complete(s, paket.id, admin_id=aid)

    assert await fab.stok(pid) == stok_once, "paketleme satılabilir stoğu değiştirdi"
    assert await fab.hareket_sayisi(pid) == hareket_once, "paketleme defter satırı yazdı"


@pytest.mark.asyncio
async def test_paketlenmis_siparis_ON_PREMISE_sayilir(fab):
    """F29 muhasebesi: `PACKED` paket hâlâ işletmenin kontrolündedir
    (sözleşme §3.2). `reserved` üzerinden `on_premise`'a dâhildir."""
    servis = _servis()
    from services import inventory_service

    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    for _ in range(2):
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.complete(s, paket.id, admin_id=aid)
        dokum = (await inventory_service.expected_on_premise(s, [pid]))[pid]

    assert dokum.reserved == 2
    assert dokum.total == 10, "paketleme fiziksel mevcudu değiştirdi"


# ══════════════════ İptal ve STALE ══════════════════════════════════════════


@pytest.mark.asyncio
async def test_IPTAL_EDILEN_siparis_PAKETLENEMEZ(fab):
    """Kullanıcı maddesi: iptal edilen sipariş paketlenemez."""
    servis = _servis()
    from services import order_fsm
    from models.store import Order

    aid = await _admin(fab)
    pid, _sku, _e = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        siparis = await s.get(Order, oid)
        await order_fsm.transition_order(
            s, siparis, "CANCELLED", changed_by="admin", reason="test"
        )
        await s.commit()

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.open_package(s, oid, admin_id=aid)
    assert hata.value.status_code == 409


@pytest.mark.asyncio
async def test_paketleme_SIRASINDA_iptal_gelirse_TAMAMLANAMAZ(fab):
    """Paket açıkken sipariş iptal edilirse `complete` 409 verir ve
    `prepared_at` damgalanmaz — yoksa iptal edilmiş sipariş dağıtıma girerdi."""
    servis = _servis()
    from services import order_fsm
    from models.store import Order

    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean, admin_id=aid)

    async with AsyncSessionLocal() as s:
        siparis = await s.get(Order, oid)
        await order_fsm.transition_order(
            s, siparis, "CANCELLED", changed_by="admin", reason="müşteri vazgeçti"
        )
        await s.commit()

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.complete(s, paket.id, admin_id=aid)
    assert hata.value.status_code == 409
    assert await fab.prepared_at(oid) is None


@pytest.mark.asyncio
async def test_IPTAL_acik_paketi_VOID_eder(fab):
    """Sözleşme §3.5 / G8: ON_PREMISE paket iptal edilince çözülür ve
    "bozulacak paketler" kuyruğuna düşer (`unpacked_at IS NULL`)."""
    servis = _servis()
    from services import order_fsm
    from models.store import Order

    aid = await _admin(fab)
    pid, _sku, _e = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)

    async with AsyncSessionLocal() as s:
        siparis = await s.get(Order, oid)
        await order_fsm.transition_order(
            s, siparis, "CANCELLED", changed_by="admin", reason="test"
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.status == "VOID"
    assert taze.unpacked_at is None


@pytest.mark.asyncio
async def test_VOID_paket_UNPACK_ile_fiziksel_olarak_cozulur(fab):
    """Fiziksel bozma ayrı bir damgadır; stok hareketi YAZILMAZ
    (`_restock` iptal yolunda `SALE_CANCEL`'ı zaten yazdı)."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, _e = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.void(s, paket.id, admin_id=aid, reason="Yanlış sipariş açıldı",
                izin_dogrula=servis.izin_zaten_dogrulandi,
            )

    hareket_once = await fab.hareket_sayisi(pid)
    async with AsyncSessionLocal() as s:
        sonuc = await servis.unpack(s, paket.id, admin_id=aid)
    assert sonuc.unpacked_at is not None
    assert await fab.hareket_sayisi(pid) == hareket_once


@pytest.mark.asyncio
async def test_VOID_sonrasi_YENI_paket_acilabilir(fab):
    """Kısmi unique index yalnız CANLI paketi tekilleştirir; bozulan paketten
    sonra sipariş yeniden paketlenebilmeli."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, _e = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        birinci = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.void(s, birinci.id, admin_id=aid, reason="Kutu yırtıldı",
                izin_dogrula=servis.izin_zaten_dogrulandi,
            )
    async with AsyncSessionLocal() as s:
        ikinci = await servis.open_package(s, oid, admin_id=aid)
    assert ikinci.id != birinci.id
    assert ikinci.status == "OPEN"


@pytest.mark.asyncio
async def test_VOID_paketin_miktari_YENI_PAKETI_TUKETMEZ(fab):
    """Sipariş içi miktar invariant'ı yalnız CANLI paketleri sayar.

    Servis, `Σ aktif paket expected_qty ≤ order_item.quantity` kuralını korur.
    Bozulan (`VOID`) paketin satırları o toplama girseydi, yeni paket "hepsi
    zaten paketlenmiş" diye **boş** doğardı — ve boş bir paket
    `complete` edilemediği için sipariş sessizce dağıtıma çıkamaz hâle
    gelirdi. `package_no` de artmalıdır: operasyon "2. paket" diyebilmeli.
    """
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, _e = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 3)])

    async with AsyncSessionLocal() as s:
        birinci = await servis.open_package(s, oid, admin_id=aid)
    assert birinci.items[0].expected_qty == 3
    async with AsyncSessionLocal() as s:
        await servis.void(s, birinci.id, admin_id=aid, reason="Kutu yırtıldı",
                izin_dogrula=servis.izin_zaten_dogrulandi,
            )

    async with AsyncSessionLocal() as s:
        ikinci = await servis.open_package(s, oid, admin_id=aid)
    assert ikinci.items, "yeni paket BOŞ doğdu — VOID satırlar miktarı tüketmiş"
    assert ikinci.items[0].expected_qty == 3
    assert ikinci.package_no == birinci.package_no + 1

    # Eski paketin satırları ve izi olduğu gibi durur (append-only geçmiş).
    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        eski = (
            await s.execute(
                text(
                    "SELECT expected_qty FROM order_package_items "
                    "WHERE package_id = :p"
                ),
                {"p": birinci.id},
            )
        ).scalars().all()
    assert eski == [3]


@pytest.mark.asyncio
async def test_kalem_degisirse_complete_STALE_doner(fab):
    """Sözleşme §7 S5: paket açıldıktan sonra sipariş içeriği değişirse işlem
    STALE/conflict olur. Parmak izi (`items_fingerprint`) bunu yakalar."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean, admin_id=aid)

    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        await s.execute(
            text("UPDATE order_items SET quantity = 3 WHERE order_id = :o"), {"o": oid}
        )
        await s.commit()

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.complete(s, paket.id, admin_id=aid)
    assert hata.value.status_code == 409
    assert "STALE" in str(hata.value.detail).upper()


# ══════════════════ Düzeltme ════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_UNDO_SCAN_gerekceli_olarak_adedi_azaltir(fab):
    """Yanlış okutma düzeltilebilmeli — ama izsiz değil."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    for _ in range(2):
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

    async with AsyncSessionLocal() as s:
        await servis.undo_scan(
            s, paket.id, order_item_id=paket.items[0].order_item_id,
            admin_id=aid, reason="Kutuya yanlış kondu",
        )
    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.items[0].scanned_qty == 1

    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        son = (
            await s.execute(
                text(
                    "SELECT result, qty_delta FROM package_scan_events "
                    "WHERE package_id = :p ORDER BY id DESC LIMIT 1"
                ),
                {"p": paket.id},
            )
        ).one()
    assert son.qty_delta == -1


@pytest.mark.asyncio
async def test_PACKED_paket_TARANAMAZ(fab):
    """Kapanmış paket değiştirilemez; önce açıkça bozulmalı."""
    servis = _servis()
    aid = await _admin(fab)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.complete(s, paket.id, admin_id=aid)

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
    assert hata.value.status_code == 409
