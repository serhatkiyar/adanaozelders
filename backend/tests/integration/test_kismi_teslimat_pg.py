"""Kısmi teslimat (bölünmüş gönderi) kabul matrisi — GERÇEK PostgreSQL.

Bu dosya ÜRETİM KODUNDAN ÖNCE yazıldı ve tamamı KIRMIZIDIR. Ölçtüğü şey bir
ürün kararının davranışa çevrilmiş hâlidir:

    "Hazırlama sırasında stok eksik çıkarsa operatör eldekini bugün gönderip
     kalanı temin edilince gönderebilmeli — ama bunu KENDİ SEÇMELİ, sistem
     kendiliğinden bölmemeli."

Sektör dayanağı (araştırma, 2 Eyl 2026): Trendyol "Paket Bölme" manuel bir
operatör aksiyonudur ve yalnız `Created`/`Picking` (bizde: hazırlanıyor)
penceresinde açıktır; ana sipariş numarası değişmez, her paket kendi kimliğini
alır ve `createdBy`/`originPackageIds` ile kökeni izlenir. Shopify aynı işi
`Fulfillment` + satır bazlı `remainingQuantity` ile yapar. Amazon'da bölme ayrı
bir buton değildir: bir paketi onaylarsın, kalan kalemler yeni pakete düşer.

## Bu matris üç mevcut kapıyı bilerek DEĞİŞTİRİR

1. `uq_order_packages_live` — "bir siparişin tek canlı paketi olur". Bölme tam
   olarak bunu ihlal eder. Kaldırılır, yerine DB seviyesinde GERÇEK invariant
   gelir (bölüm A): `Σ (canlı + teslim edilmiş) expected_qty ≤ sipariş adedi`.
   Bu, kaldırılan index'ten güçlüdür — index adedi hiç kontrol etmiyordu.
2. `uq_delivery_stop_open` — "bir siparişin tek açık durağı olur". Paket bazına
   iner; paketsiz (F30 öncesi) sipariş için sipariş bazında KALIR (bölüm C).
3. `add_stops`'un `order.status != "PAID"` kapısı — birinci paket zimmetlenince
   sipariş `SHIPPED` olur ve ikinci paket için durak açılamaz hâle gelir. Kapı
   `PAID`/`SHIPPED` kabul eder (bölüm C).

Değişen her kapının yeni davranışı aşağıda AYRI bir testle yazılıdır; eski
davranışı koruyan nöbetçiler de (C2, C3) burada durur — kapı gevşedi diye
tamamen açılmadığının kanıtı onlardır.
"""
from __future__ import annotations

import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from core.database import AsyncSessionLocal
from tests.integration.f30_factory import PaketFabrikasi


def _packing():
    from services import packing_service

    if not hasattr(packing_service, "split_package"):
        pytest.fail(
            "HENÜZ YAZILMADI: packing_service.split_package", pytrace=False
        )
    return packing_service


def _delivery():
    from services import delivery_service

    return delivery_service


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    yield f
    await f.temizle()


async def _token(order_id: int) -> str:
    """Siparişin oturumsuz takip token'ı — müşteri yüzeyi bu yoldan okunur."""
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text("SELECT track_token FROM orders WHERE id = :i"),
                {"i": order_id},
            )
        ).scalar_one()


async def _izin_serbest(_action: str) -> None:
    """`void` izin kancası — testte izin katmanı ölçülmüyor."""
    return None


async def _hazir_paket(fab: PaketFabrikasi, servis, oid: int, aid: int):
    """Siparişin paketini açar, tüm kalemleri okutur ve PACKED yapar."""
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
        for satir in paket.items:
            for _ in range(satir.expected_qty):
                await servis.scan(s, paket.id, code=satir.sku, admin_id=aid)
        return await servis.complete(s, paket.id, admin_id=aid)


# ══════════════════ A. Adet tavanı (DB invariant'ı) ═════════════════════════
#
# Kaldırılan `uq_order_packages_live`'ın yerine geçen koruma. Uygulama katmanı
# (`_tuketilen_adetler`) zaten sayıyor; buradaki testler DB'nin de saydığını
# ölçer — "tek katmanlı koruma koruma değildir" (F30 sözleşmesi §4.1/2).


@pytest.mark.asyncio
async def test_A1_ayni_kalem_iki_pakette_siparis_adedini_ASAMAZ(fab):
    """3 adetlik kalem, 2 + 2 = 4 istenirse DB reddeder."""
    servis = _packing()
    aid = await fab.admin()
    p1, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 3)])
    kalem_id = (await fab.kalem_idleri(oid))[0]

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)

    async with AsyncSessionLocal() as s:
        # İkinci paketi ham SQL ile kurmak bilinçlidir: servis kapısını atlayıp
        # SON SÖZÜN DB'de olduğunu ölçüyoruz.
        await s.execute(
            text(
                "INSERT INTO order_packages (order_id, package_no, status, "
                "qr_token, items_fingerprint, created_at, updated_at) "
                "VALUES (:o, 99, 'OPEN', :t, 'x', now(), now())"
            ),
            {"o": oid, "t": f"tavan-{oid}"},
        )
        yeni_id = (
            await s.execute(
                text(
                    "SELECT id FROM order_packages WHERE order_id = :o "
                    "AND package_no = 99"
                ),
                {"o": oid},
            )
        ).scalar_one()
        with pytest.raises(DBAPIError) as exc:
            await s.execute(
                text(
                    "INSERT INTO order_package_items (package_id, order_item_id, "
                    "product_id, title, expected_qty, scanned_qty, created_at, "
                    "updated_at) VALUES (:p, :k, :u, 'Tavan', 2, 0, now(), now())"
                ),
                {"p": yeni_id, "k": kalem_id, "u": p1},
            )
            await s.commit()
    assert "tavan" in str(exc.value).lower() or "ceiling" in str(exc.value).lower()
    assert paket.id  # açılan ilk paket 3 adedin tamamını istemişti


@pytest.mark.asyncio
async def test_A2_tavan_TAM_SINIRDA_kabul_edilir(fab):
    """3 adetlik kalem 2 + 1 olarak bölünebilir — sınır aşılmıyor."""
    servis = _packing()
    aid = await fab.admin()
    p1, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 3)])
    kalem_id = (await fab.kalem_idleri(oid))[0]

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
        yeni = await servis.split_package(
            s, paket.id, {kalem_id: 1}, admin_id=aid
        )
    assert yeni.id != paket.id

    async with AsyncSessionLocal() as s:
        toplam = (
            await s.execute(
                text(
                    "SELECT sum(i.expected_qty) FROM order_package_items i "
                    "JOIN order_packages p ON p.id = i.package_id "
                    "WHERE p.order_id = :o AND p.status <> 'VOID'"
                ),
                {"o": oid},
            )
        ).scalar_one()
    assert toplam == 3


@pytest.mark.asyncio
async def test_A3_VOID_paket_satirlari_tavana_SAYILMAZ(fab):
    """Bozulan paketten sonra yenisi tam adetle açılabilmeli."""
    servis = _packing()
    aid = await fab.admin()
    p1, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 2)])

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
        await servis.void(
            s,
            paket.id,
            admin_id=aid,
            reason="test bozma",
            izin_dogrula=_izin_serbest,
        )

    async with AsyncSessionLocal() as s:
        yeni = await servis.open_package(s, oid, admin_id=aid)
    assert sum(r.expected_qty for r in yeni.items) == 2


@pytest.mark.asyncio
async def test_A4_TESLIM_EDILMIS_paket_satirlari_tavana_SAYILIR(fab):
    """Bugünkü kusur: `_tuketilen_adetler` yalnız CANLI paketleri sayıyor.

    Tek paketliyken zararsızdı (teslim edilmiş siparişe yeni paket açılmaz).
    Bölmede zararlı: 3 üründen 2'si teslim edildikten sonra açılan paket
    3 ürünün hepsini yeniden isteyebilirdi — depodan ikinci kez toplanırdı.
    """
    servis = _packing()
    aid = await fab.admin()
    p1, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 3)])
    kalem_id = (await fab.kalem_idleri(oid))[0]

    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
        await servis.split_package(s, paket.id, {kalem_id: 1}, admin_id=aid)
        # İlk paket (2 adet) teslim edilmiş sayılsın.
        await s.execute(
            text(
                "UPDATE order_packages SET status='DELIVERED', "
                "packed_at=now(), handed_over_at=now(), delivered_at=now() "
                "WHERE id = :p"
            ),
            {"p": paket.id},
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        tuketilen = await servis._tuketilen_adetler(s, oid)
    # 2 (teslim edilmiş) + 1 (canlı) = 3; kalan 0 olmalı.
    assert tuketilen.get(kalem_id) == 3


# ══════════════════ B. Bölme (split_package) ════════════════════════════════


@pytest.mark.asyncio
async def test_B1_bolme_yeni_paket_uretir_ve_kokeni_kaydeder(fab):
    """Kaynak pakette kalan, yeni pakette ayrılan kalemler olur.

    Trendyol deseni: yeni paket `createdBy=split` ve `originPackageIds` taşır.
    """
    servis = _packing()
    aid = await fab.admin()
    p1, _s1, _e1 = await fab.barkodlu_urun(stock=10)
    p2, _s2, _e2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    k1, k2 = await fab.kalem_idleri(oid)

    async with AsyncSessionLocal() as s:
        kaynak = await servis.open_package(s, oid, admin_id=aid)
        yeni = await servis.split_package(s, kaynak.id, {k2: 1}, admin_id=aid)

    assert yeni.status == "OPEN"
    assert yeni.package_no > kaynak.package_no
    assert yeni.created_by == "SPLIT"
    assert yeni.origin_package_id == kaynak.id
    assert [r.order_item_id for r in yeni.items] == [k2]

    async with AsyncSessionLocal() as s:
        kalanlar = (
            await s.execute(
                text(
                    "SELECT order_item_id FROM order_package_items "
                    "WHERE package_id = :p"
                ),
                {"p": kaynak.id},
            )
        ).scalars().all()
    assert list(kalanlar) == [k1]


@pytest.mark.asyncio
async def test_B2_kaynaktakinden_FAZLA_adet_ayrilamaz(fab):
    servis = _packing()
    aid = await fab.admin()
    p1, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 2)])
    kalem_id = (await fab.kalem_idleri(oid))[0]

    async with AsyncSessionLocal() as s:
        kaynak = await servis.open_package(s, oid, admin_id=aid)
        with pytest.raises(HTTPException) as exc:
            await servis.split_package(s, kaynak.id, {kalem_id: 5}, admin_id=aid)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_B3_kaynagi_TAMAMEN_bosaltan_bolme_reddedilir(fab):
    """Her kalemi yeni pakete taşımak bölme değil taşımadır; iki paketten biri
    boş kalırdı ve operatör "neden boş paket var" sorusuyla baş başa kalırdı."""
    servis = _packing()
    aid = await fab.admin()
    p1, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 2)])
    kalem_id = (await fab.kalem_idleri(oid))[0]

    async with AsyncSessionLocal() as s:
        kaynak = await servis.open_package(s, oid, admin_id=aid)
        with pytest.raises(HTTPException) as exc:
            await servis.split_package(s, kaynak.id, {kalem_id: 2}, admin_id=aid)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_B4_KURYEDEKI_paket_bolunemez(fab):
    """Bölme penceresi hazırlama evresidir (Trendyol: Created/Picking).

    Araçtaki paketi bölmek, kuryenin elindeki fiziksel kutuyu ekrandan ikiye
    ayırmaktır — karşılığı olmayan bir iddia.
    """
    servis = _packing()
    aid = await fab.admin()
    p1, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 2)])
    kalem_id = (await fab.kalem_idleri(oid))[0]
    paket = await _hazir_paket(fab, servis, oid, aid)

    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE order_packages SET status='HANDED_OVER', "
                "packed_at=coalesce(packed_at, now()), handed_over_at=now() "
                "WHERE id = :p"
            ),
            {"p": paket.id},
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await servis.split_package(s, paket.id, {kalem_id: 1}, admin_id=aid)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_B5_OKUTULMUS_adedin_altina_dusuren_bolme_reddedilir(fab):
    """2 adetten 2'si okutulmuşken 1'ini ayırmak, okutulmuş sayıyı yalanlar."""
    servis = _packing()
    aid = await fab.admin()
    p1, sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 2)])
    kalem_id = (await fab.kalem_idleri(oid))[0]

    async with AsyncSessionLocal() as s:
        kaynak = await servis.open_package(s, oid, admin_id=aid)
        await servis.scan(s, kaynak.id, code=sku, admin_id=aid)
        await servis.scan(s, kaynak.id, code=sku, admin_id=aid)
        with pytest.raises(HTTPException) as exc:
            await servis.split_package(s, kaynak.id, {kalem_id: 1}, admin_id=aid)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_B6_ikinci_teslimatin_tarihi_OPSIYONELDIR(fab):
    """Tedarik tarihi biliniyorsa yazılır, bilinmiyorsa NULL kalır ve müşteriye
    "temin ediliyor" denir. Tutturulamayan tarih şikâyet üretir."""
    servis = _packing()
    aid = await fab.admin()
    p1, _s1, _e1 = await fab.barkodlu_urun(stock=10)
    p2, _s2, _e2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    _k1, k2 = await fab.kalem_idleri(oid)
    yarin = datetime.date.today() + datetime.timedelta(days=1)

    async with AsyncSessionLocal() as s:
        kaynak = await servis.open_package(s, oid, admin_id=aid)
        tarihli = await servis.split_package(
            s, kaynak.id, {k2: 1}, admin_id=aid, promised_date=yarin
        )
    assert tarihli.promised_delivery_date == yarin

    oid2 = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    _m1, m2 = await fab.kalem_idleri(oid2)
    async with AsyncSessionLocal() as s:
        kaynak2 = await servis.open_package(s, oid2, admin_id=aid)
        tarihsiz = await servis.split_package(s, kaynak2.id, {m2: 1}, admin_id=aid)
    assert tarihsiz.promised_delivery_date is None


# ══════════════════ C. Dağıtım paket bazına iner ════════════════════════════


@pytest.mark.asyncio
async def test_C1_bir_siparisin_IKI_paketi_ayni_anda_acik_durakta_olabilir(fab):
    """Eski `uq_delivery_stop_open` bunu reddediyordu; kısmi teslimatın ta kendisi."""
    servis = _packing()
    teslimat = _delivery()
    aid = await fab.admin()
    p1, _s1, _e1 = await fab.barkodlu_urun(stock=10)
    p2, _s2, _e2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    _k1, k2 = await fab.kalem_idleri(oid)

    async with AsyncSessionLocal() as s:
        kaynak = await servis.open_package(s, oid, admin_id=aid)
        yeni = await servis.split_package(s, kaynak.id, {k2: 1}, admin_id=aid)

    # İki paketi de hazır hâle getir.
    for pid in (kaynak.id, yeni.id):
        async with AsyncSessionLocal() as s:
            paket = await servis.get_package(s, pid)
            for satir in paket.items:
                for _ in range(satir.expected_qty):
                    await servis.scan(s, pid, code=satir.sku, admin_id=aid)
            await servis.complete(s, pid, admin_id=aid)

    run_id = await fab.tur()
    async with AsyncSessionLocal() as s:
        await teslimat.add_stops(s, run_id, [oid])

    async with AsyncSessionLocal() as s:
        duraklar = (
            await s.execute(
                text(
                    "SELECT package_id FROM delivery_stops WHERE order_id = :o "
                    "AND status = 'PENDING' ORDER BY package_id"
                ),
                {"o": oid},
            )
        ).scalars().all()
    assert sorted(duraklar) == sorted([kaynak.id, yeni.id])


@pytest.mark.asyncio
async def test_C2_AYNI_paket_icin_ikinci_acik_durak_HALA_reddedilir(fab):
    """Kapı gevşedi, tamamen açılmadı: tekillik paket bazında sürüyor."""
    servis = _packing()
    aid = await fab.admin()
    p1, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1)])
    paket = await _hazir_paket(fab, servis, oid, aid)
    run_id = await fab.tur()

    async with AsyncSessionLocal() as s:
        await _delivery().add_stops(s, run_id, [oid])

    run2 = await fab.tur()
    async with AsyncSessionLocal() as s:
        with pytest.raises(IntegrityError):
            await s.execute(
                text(
                    "INSERT INTO delivery_stops (run_id, order_id, package_id, "
                    "sequence, status, qr_token, created_at, updated_at) "
                    "VALUES (:r, :o, :p, 1, 'PENDING', :t, now(), now())"
                ),
                {"r": run2, "o": oid, "p": paket.id, "t": f"ikinci-{oid}"},
            )
            await s.commit()


@pytest.mark.asyncio
async def test_C3_PAKETSIZ_siparis_icin_ikinci_acik_durak_HALA_reddedilir(fab):
    """F30 öncesi (paketsiz) sipariş eski kuralda kalır: tek açık durak."""
    teslimat = _delivery()
    p1, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1)], prepared=True)
    run_id = await fab.tur()

    async with AsyncSessionLocal() as s:
        await teslimat.add_stops(s, run_id, [oid])

    run2 = await fab.tur()
    async with AsyncSessionLocal() as s:
        with pytest.raises(IntegrityError):
            await s.execute(
                text(
                    "INSERT INTO delivery_stops (run_id, order_id, package_id, "
                    "sequence, status, qr_token, created_at, updated_at) "
                    "VALUES (:r, :o, NULL, 1, 'PENDING', :t, now(), now())"
                ),
                {"r": run2, "o": oid, "t": f"legacy-{oid}"},
            )
            await s.commit()


@pytest.mark.asyncio
async def test_C4_birinci_paket_ARACTAYKEN_ikinci_paket_kuyrukta_gorunur(fab):
    """`off_premise_package_exists` bugün tüm siparişi kuyruktan çıkarıyor;
    ikinci paket bu yüzden hiç dağıtıma çıkamazdı."""
    servis = _packing()
    teslimat = _delivery()
    aid = await fab.admin()
    p1, _s1, _e1 = await fab.barkodlu_urun(stock=10)
    p2, _s2, _e2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    _k1, k2 = await fab.kalem_idleri(oid)

    async with AsyncSessionLocal() as s:
        kaynak = await servis.open_package(s, oid, admin_id=aid)
        yeni = await servis.split_package(s, kaynak.id, {k2: 1}, admin_id=aid)
    for pid in (kaynak.id, yeni.id):
        async with AsyncSessionLocal() as s:
            paket = await servis.get_package(s, pid)
            for satir in paket.items:
                for _ in range(satir.expected_qty):
                    await servis.scan(s, pid, code=satir.sku, admin_id=aid)
            await servis.complete(s, pid, admin_id=aid)

    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE order_packages SET status='HANDED_OVER', "
                "packed_at=coalesce(packed_at, now()), handed_over_at=now() "
                "WHERE id = :p"
            ),
            {"p": kaynak.id},
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        kuyruk = await teslimat.eligible_orders(s)
    assert oid in [o.order_id for o in kuyruk]


@pytest.mark.asyncio
async def test_C5_SHIPPED_siparise_ikinci_paket_icin_durak_acilabilir(fab):
    """`add_stops`'un `status != PAID` kapısı ikinci paketi kilitliyordu."""
    servis = _packing()
    teslimat = _delivery()
    aid = await fab.admin()
    p1, _s1, _e1 = await fab.barkodlu_urun(stock=10)
    p2, _s2, _e2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    _k1, k2 = await fab.kalem_idleri(oid)

    async with AsyncSessionLocal() as s:
        kaynak = await servis.open_package(s, oid, admin_id=aid)
        yeni = await servis.split_package(s, kaynak.id, {k2: 1}, admin_id=aid)
    for pid in (kaynak.id, yeni.id):
        async with AsyncSessionLocal() as s:
            paket = await servis.get_package(s, pid)
            for satir in paket.items:
                for _ in range(satir.expected_qty):
                    await servis.scan(s, pid, code=satir.sku, admin_id=aid)
            await servis.complete(s, pid, admin_id=aid)

    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE order_packages SET status='HANDED_OVER', "
                "packed_at=coalesce(packed_at, now()), handed_over_at=now() "
                "WHERE id = :p"
            ),
            {"p": kaynak.id},
        )
        await s.execute(
            text("UPDATE orders SET status='SHIPPED' WHERE id = :o"), {"o": oid}
        )
        await s.commit()

    run_id = await fab.tur()
    async with AsyncSessionLocal() as s:
        await teslimat.add_stops(s, run_id, [oid])

    async with AsyncSessionLocal() as s:
        durak_paketi = (
            await s.execute(
                text(
                    "SELECT package_id FROM delivery_stops WHERE order_id = :o "
                    "AND status='PENDING'"
                ),
                {"o": oid},
            )
        ).scalars().all()
    assert list(durak_paketi) == [yeni.id]


# ══════════════════ D. Müşteri görünümü ═════════════════════════════════════


@pytest.mark.asyncio
async def test_D1_bolunmus_siparis_takipte_IKI_teslimat_gosterir(fab):
    servis = _packing()
    teslimat = _delivery()
    aid = await fab.admin()
    p1, _s1, _e1 = await fab.barkodlu_urun(stock=10)
    p2, _s2, _e2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    _k1, k2 = await fab.kalem_idleri(oid)

    async with AsyncSessionLocal() as s:
        kaynak = await servis.open_package(s, oid, admin_id=aid)
        await servis.split_package(s, kaynak.id, {k2: 1}, admin_id=aid)

    async with AsyncSessionLocal() as s:
        cikti = await teslimat.order_tracking(s, track_token=await _token(oid))
    assert [x.no for x in cikti.shipments] == [1, 2]
    assert sum(len(x.items) for x in cikti.shipments) == 2


@pytest.mark.asyncio
async def test_D2_biri_teslim_biri_beklerken_fulfillment_PARTIAL(fab):
    servis = _packing()
    teslimat = _delivery()
    aid = await fab.admin()
    p1, _s1, _e1 = await fab.barkodlu_urun(stock=10)
    p2, _s2, _e2 = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(p1, 1), (p2, 1)])
    _k1, k2 = await fab.kalem_idleri(oid)

    async with AsyncSessionLocal() as s:
        kaynak = await servis.open_package(s, oid, admin_id=aid)
        await servis.split_package(s, kaynak.id, {k2: 1}, admin_id=aid)
        await s.execute(
            text(
                "UPDATE order_packages SET status='DELIVERED', "
                "packed_at=now(), handed_over_at=now(), delivered_at=now() "
                "WHERE id = :p"
            ),
            {"p": kaynak.id},
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        cikti = await teslimat.order_tracking(s, track_token=await _token(oid))
    assert cikti.fulfillment_state == "PARTIAL"
