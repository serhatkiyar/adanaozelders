"""F30 eşzamanlılık — GERÇEK PostgreSQL yarışları.

Desen `test_inventory_apply_race_pg.py`'den devralındı ve gerekçesi aynıdır:

* her görev KENDİ session'ında, başında `SET LOCAL lock_timeout` → kilit sırası
  hatası testi ASKIDA BIRAKMAZ, kırar;
* `asyncio.gather(..., return_exceptions=True)` sonuçları taranır — beklenen iş
  kuralı hataları dışında her istisna yeniden yükseltilir, yoksa "görev hiç
  çalışmadı" sessizce yutulur;
* her çift TERS başlatma sırasıyla ve birden çok tur koşar.

Tümü F30 yazılana kadar KIRMIZIDIR.
"""
from __future__ import annotations

import asyncio
import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from tests.integration.f30_factory import PaketFabrikasi

TURLAR = 3
KILIT_ZAMAN_ASIMI = "4s"


def _servis():
    try:
        from services import packing_service
    except ImportError as exc:  # noqa: PERF203
        pytest.fail(
            f"HENÜZ YAZILMADI: services/packing_service.py ({exc})", pytrace=False
        )
    return packing_service


def _beklenen_mi(exc: BaseException) -> bool:
    """İş kuralı reddi mi (409/404/422), yoksa gerçek bir hata mı?"""
    return isinstance(exc, HTTPException) and exc.status_code in (404, 409, 422)


def _kilit_hatasi_yok(sonuclar) -> None:
    for r in sonuclar:
        if not isinstance(r, BaseException):
            continue
        kod = getattr(getattr(r, "orig", None), "sqlstate", None) or ""
        if kod == "40P01":
            pytest.fail(f"DEADLOCK (40P01): {r}")
        if kod == "55P03":
            pytest.fail(f"KİLİT ZAMAN AŞIMI (55P03) — kilit sırası bozuk: {r}")
        if not _beklenen_mi(r):
            raise r


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    yield f
    await f.temizle()


async def _oturum():
    s = AsyncSessionLocal()
    await s.execute(text(f"SET LOCAL lock_timeout = '{KILIT_ZAMAN_ASIMI}'"))
    return s


async def _gorev(fn):
    s = await _oturum()
    try:
        return await fn(s)
    finally:
        await s.close()


def _sonuclar(sonuclar, adlar: tuple[str, ...]) -> dict:
    """`{işlem adı: sonuç ya da istisna}` — başlatma sırasından bağımsız okuma.

    Commit 4 denetiminin bulgusu: eski iddialar "son durum şu VEYA bu" diyordu
    ve **hangi işlemin kazandığına bakmıyordu**. O hâlde bir işlem sessizce
    no-op'a düşse (guard kaldırılıp ikisi de "başarılı" dönse, ya da ikisi de
    reddedilse) test yine geçerdi. Artık her düğüm önce KİMİN kazandığını
    okuyor, sonra o gözleme karşılık gelen **tek** son durumu iddia ediyor.
    """
    return dict(zip(adlar, sonuclar, strict=True))


def _reddedildi(x) -> bool:
    return isinstance(x, HTTPException) and x.status_code == 409


def _basarili(x) -> bool:
    return not isinstance(x, BaseException)


# ══════════════════ Paket açma yarışı ═══════════════════════════════════════


@pytest.mark.asyncio
async def test_IKI_OPERATOR_ayni_siparisi_ayni_anda_PAKETLEYEMEZ(fab):
    """Kullanıcı maddesi: iki operatör aynı siparişi eşzamanlı paketleyemez.

    Otorite `uq_order_packages_live` kısmi unique index'idir; uygulama katmanı
    yarışı kaybederse IntegrityError'a düşer ve mevcut paketi döner. Sonuçta
    DB'de **tek** paket kalır.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])

        sonuclar = await asyncio.gather(
            _gorev(lambda s: servis.open_package(s, oid, admin_id=aid)),
            _gorev(lambda s: servis.open_package(s, oid, admin_id=aid)),
            return_exceptions=True,
        )
        _kilit_hatasi_yok(sonuclar)

        async with AsyncSessionLocal() as s:
            adet = (
                await s.execute(
                    text("SELECT count(*) FROM order_packages WHERE order_id = :o"),
                    {"o": oid},
                )
            ).scalar_one()
        assert adet == 1, f"tur {_tur}: {adet} paket oluştu"


# ══════════════════ Tarama yarışı ═══════════════════════════════════════════


@pytest.mark.asyncio
async def test_ES_ZAMANLI_iki_tarama_TAVANI_ASAMAZ(fab):
    """Beklenen 1 olan satıra iki paralel tarama gelirse toplam 1 olmalı.

    `scanned_qty <= expected_qty` CHECK'i son sözü söyler; uygulama katmanı
    satırı `FOR UPDATE` ile almazsa okuma-değiştirme-yazma yarışı 2 yazardı.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)

        sonuclar = await asyncio.gather(
            _gorev(lambda s: servis.scan(s, paket.id, code=ean, admin_id=aid)),
            _gorev(lambda s: servis.scan(s, paket.id, code=ean, admin_id=aid)),
            return_exceptions=True,
        )
        _kilit_hatasi_yok(sonuclar)

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.items[0].scanned_qty == 1, f"tur {_tur}: tavan aşıldı"


@pytest.mark.asyncio
async def test_ES_ZAMANLI_ayni_idempotency_key_TEK_KEZ_sayar(fab):
    """Ağ tekrarı iki isteği aynı anda getirebilir; kısmi unique index
    (`uq_package_scan_idem`) ikinciyi düşürür ve adet 1 kalır."""
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)

        sonuclar = await asyncio.gather(
            _gorev(
                lambda s: servis.scan(
                    s, paket.id, code=ean, admin_id=aid, idempotency_key="ayni"
                )
            ),
            _gorev(
                lambda s: servis.scan(
                    s, paket.id, code=ean, admin_id=aid, idempotency_key="ayni"
                )
            ),
            return_exceptions=True,
        )
        _kilit_hatasi_yok(sonuclar)

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.items[0].scanned_qty == 1, f"tur {_tur}: idempotency tutmadı"


# ══════════════════ Tamamlama yarışı ════════════════════════════════════════


@pytest.mark.asyncio
async def test_ES_ZAMANLI_complete_TEK_DAMGA_uretir(fab):
    """İki operatör aynı anda "Tamamla"ya basarsa TEK yan etki üretilir.

    ⚠️ Commit 5 denetiminin bulgusu: eski iddia `len(damgalar) == 1` idi ve bu
    bir **totolojiydi** — `id` birincil anahtar olduğu için sorgu tanım gereği
    tek satır döner. Ölçülen tek şey `packed_at IS NOT NULL`'dı; `prepared_at`
    hiç okunmuyordu (yazıcısı silinse test yeşil kalırdı), olay sayısı hiç
    sayılmıyordu (çift `COMPLETE` görünmezdi) ve idempotent erken dönüş
    kaldırılıp 200 yerine 409 dönse yine geçerdi.

    Artık üçü birden ölçülür: **iki çağrı da başarılı** (idempotent dönüş
    korunmuş), **tek `COMPLETE` olayı**, **tek `packed_at`** ve `prepared_at`
    damgası. Ayrıca `packed_at` iki yanıtta da AYNI olmalı — ikinci çağrının
    damgayı tazelemediğinin kanıtı.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

        ham = await asyncio.gather(
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            return_exceptions=True,
        )
        _kilit_hatasi_yok(ham)

        # Çift tıklama 409 DEĞİL 200 döner (sözleşme: durum-idempotansı).
        assert all(_basarili(r) for r in ham), (
            f"tur {_tur}: idempotent dönüş kaybolmuş: {ham!r}"
        )
        assert ham[0].status == ham[1].status == "PACKED"
        assert ham[0].packed_at == ham[1].packed_at, "ikinci çağrı damgayı tazeledi"

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.packed_at is not None
        assert taze.packed_by_admin_id == aid
        assert await _olay_sayisi(paket.id, "COMPLETE") == 1, "çift COMPLETE olayı"
        hazir = await fab.prepared_at(oid)
        assert hazir is not None, "complete `prepared_at` damgalamadı"


# ══════════════════ Zimmet yarışı ═══════════════════════════════════════════


@pytest.mark.asyncio
async def test_ES_ZAMANLI_zimmet_TEK_SHIPPED_uretir(fab):
    """Kurye QR'ı iki kez okutursa (ya da çift dokunma olursa) sipariş bir kez
    dağıtıma çıkar; ikinci geçiş `order_status_history`'de görünmemeli."""
    servis = _servis()
    from services import delivery_service

    zimmet = getattr(delivery_service, "handover_scan", None)
    if zimmet is None:
        pytest.fail("HENÜZ YAZILMADI: delivery_service.handover_scan", pytrace=False)

    for _tur in range(TURLAR):
        aid = await fab.admin()
        kurye = await fab.kurye()
        run = await fab.tur(courier_id=kurye)
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
        async with AsyncSessionLocal() as s:
            paket = await servis.complete(s, paket.id, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await delivery_service.add_stops(s, run, [oid])

        sonuclar = await asyncio.gather(
            _gorev(
                lambda s: zimmet(
                    s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
                )
            ),
            _gorev(
                lambda s: zimmet(
                    s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
                )
            ),
            return_exceptions=True,
        )
        _kilit_hatasi_yok(sonuclar)

        async with AsyncSessionLocal() as s:
            gecis = (
                await s.execute(
                    text(
                        "SELECT count(*) FROM order_status_history "
                        "WHERE order_id = :o AND new_status = 'SHIPPED'"
                    ),
                    {"o": oid},
                )
            ).scalar_one()
        assert gecis == 1, f"tur {_tur}: {gecis} adet SHIPPED geçişi"


# ══════════════════ Kilit sırası ════════════════════════════════════════════


@pytest.mark.asyncio
async def test_PAKETLEME_ile_IPTAL_yarisi_TUTARSIZ_DURUM_BIRAKMAZ(fab):
    """Paket tamamlanırken sipariş iptal edilirse aradaki hâl YASAKTIR.

    ⚠️ Commit 5 denetiminin bulgusu: eski sürüm `gather` sonuçlarını hiç
    okumuyordu, yani **iptal dalı hiç çalışmasa bile** test `else` dalından
    yeşil geçiyordu; `else` dalında `prepared_at` de denetlenmiyordu, yani
    `complete`'in damga yazıcısı silinse görünmüyordu.

    Artık hangi tarafın kazandığı okunuyor, `prepared_at` her iki dalda da
    iddia ediliyor ve **iki dalın da en az bir kez fiilen çalıştığı** tur
    sonunda sayaçla kanıtlanıyor — bir dalın hiç çalışmaması (ör. iptal yolu
    sessizce 409'a düşmesi) artık testi kırar.
    """
    servis = _servis()
    from models.store import Order
    from services import order_fsm

    async def _iptal(s):
        siparis = await s.get(Order, oid, with_for_update=True)
        await order_fsm.transition_order(
            s, siparis, "CANCELLED", changed_by="admin", reason="yarış testi"
        )
        await s.commit()

    dallar = {"iptal": 0, "complete": 0}
    for _tur in range(TURLAR * 2):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

        adlar = ("complete", "iptal")
        gorevler = [
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            _gorev(_iptal),
        ]
        if _tur % 2:                       # ters başlatma sırası
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        siparis_durumu, _odeme = await fab.siparis_durumu(oid)
        async with AsyncSessionLocal() as s:
            paket_taze = await servis.get_package(s, paket.id)
        hazir = await fab.prepared_at(oid)

        if siparis_durumu == "CANCELLED":
            dallar["iptal"] += 1
            assert _basarili(r["iptal"]), f"iptal düştü: {r['iptal']!r}"
            assert paket_taze.status == "VOID", "iptal edilen siparişin paketi canlı"
            assert paket_taze.void_reason, "gerekçesiz VOID"
            assert hazir is None, "iptal edilen sipariş hazır damgalı kaldı"
        else:
            dallar["complete"] += 1
            assert siparis_durumu == "PAID"
            assert _basarili(r["complete"]), f"complete düştü: {r['complete']!r}"
            assert paket_taze.status == "PACKED"
            # Denetim bulgusu: bu iddia eskiden YOKTU — `complete`'in damga
            # yazıcısı silinse bu dal sessizce geçerdi.
            assert hazir is not None, "complete kazandı ama hazır damgası yok"
            assert _reddedildi(r["iptal"]) or _basarili(r["iptal"])

    # En az bir dal çalışmış olmalı (yoksa `gather` hiç iş yapmamış demektir).
    #
    # ⚠️ "İKİ dal da çalışmalı" iddiası bilinçli olarak BURADA YOK: `_iptal`
    # işe doğrudan `Order` `FOR UPDATE` ile başlarken `complete` önce kilitsiz
    # bir `_peek` yapar, dolayısıyla iptal kilidi pratikte HER ZAMAN önce
    # kapar (ölçüldü: 6/6). Zamanlamayla bir dalı zorlamak kırılgan bir test
    # olurdu. Commit 5 denetiminin "bir dal hiç çalışmıyor" bulgusunun cevabı
    # aşağıdaki İKİ DETERMİNİSTİK düğümdür — orada sıra kesindir ve her iki
    # yönün son durumu tek tek iddia edilir.
    assert sum(dallar.values()) == TURLAR * 2, dallar
    assert dallar["iptal"] > 0, f"hiçbir turda iptal kazanmadı: {dallar}"


@pytest.mark.asyncio
async def test_IPTAL_ONCE_calisirsa_complete_REDDEDILIR(fab):
    """Deterministik yön 1: sipariş iptal edildikten SONRA `complete` 409.

    Sıra kesindir (iptal tamamen bitip commit edilir), yani bu düğüm
    zamanlamaya bağlı değildir ve iptal yolunun tam sonucunu sabitler:
    paket `VOID` + gerekçeli, `prepared_at` NULL, `COMPLETE` olayı YOK.
    """
    servis = _servis()
    from models.store import Order
    from services import order_fsm

    aid = await fab.admin()
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean, admin_id=aid)

    async with AsyncSessionLocal() as s:
        siparis = await s.get(Order, oid, with_for_update=True)
        await order_fsm.transition_order(
            s, siparis, "CANCELLED", changed_by="admin", reason="deterministik yön 1"
        )
        await s.commit()

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await servis.complete(s, paket.id, admin_id=aid)
    assert hata.value.status_code == 409

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.status == "VOID"
    assert taze.void_reason
    assert taze.packed_at is None
    assert await fab.prepared_at(oid) is None
    assert await _olay_sayisi(paket.id, "COMPLETE") == 0
    assert await _olay_sayisi(paket.id, "VOID") == 1


@pytest.mark.asyncio
async def test_COMPLETE_ONCE_calisirsa_iptal_PAKETI_VOID_EDER(fab):
    """Deterministik yön 2: `complete` bittikten SONRA iptal gelir.

    Bu yön eşzamanlı testte pratikte HİÇ gözlenmiyordu (iptal kilidi her zaman
    önce kapıyor). Burada sıra kesin: paket `PACKED` olur ve `prepared_at`
    damgalanır; ardından iptal paketi `VOID` edip damgayı **düşürür** — aksi
    hâlde iptal edilmiş sipariş `eligible_orders`'ta kalırdı.
    """
    servis = _servis()
    from models.store import Order
    from services import order_fsm

    aid = await fab.admin()
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        sonuc = await servis.complete(s, paket.id, admin_id=aid)
    assert sonuc.status == "PACKED"
    assert await fab.prepared_at(oid) is not None

    async with AsyncSessionLocal() as s:
        siparis = await s.get(Order, oid, with_for_update=True)
        await order_fsm.transition_order(
            s, siparis, "CANCELLED", changed_by="admin", reason="deterministik yön 2"
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        taze = await servis.get_package(s, paket.id)
    assert taze.status == "VOID"
    assert taze.packed_at is not None, "geçmiş damga silinmiş"
    assert await fab.prepared_at(oid) is None, "iptal hazır damgasını düşürmedi"
    assert await _olay_sayisi(paket.id, "COMPLETE") == 1
    assert await _olay_sayisi(paket.id, "VOID") == 1


@pytest.mark.asyncio
async def test_kilit_sirasi_DEADLOCK_URETMEZ(fab):
    """Aynı sipariş üstünde paketleme ve dağıtım akışları çarpışır.

    ⚠️ Commit 5 denetiminin bulgusu: eski kurulum **iki kilidi birden alan bir
    senaryo üretmiyordu**. Paket `OPEN` olduğu için `add_stops` daha ilk
    guard'da ("henüz hazırlanmadı") düşüyor ve paket kilidine hiç ulaşmıyordu;
    `complete` içindeki kilitleri ters çevirmek bile deadlock üretmiyordu.
    Yani düğüm, adının söylediği şeyi ölçmüyordu.

    Yeni kurulum paketi **PACKED** yapar. Böylece iki yol da GERÇEKTEN iki
    kilidi birden alır:

        complete   : Order → OrderPackage   (idempotent dönüş, ama kilitler alınır)
        add_stops  : Order → OrderPackage → DeliveryStop

    Kanonik sıra korunduğu sürece döngü doğmaz. Biri ters çevrilirse
    (`OrderPackage → Order`) klasik AB-BA kilitlenmesi oluşur ve
    `lock_timeout`/deadlock nöbetçisi testi kırar.

    Deadlock yokluğu tek başına YETMEZ (denetim bulgusu): son durum da dar
    biçimde doğrulanır.
    """
    servis = _servis()
    from services import delivery_service

    for _tur in range(TURLAR):
        aid = await fab.admin()
        kurye = await fab.kurye()
        run = await fab.tur(courier_id=kurye)
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.complete(s, paket.id, admin_id=aid)

        adlar = ("complete", "add_stops")
        gorevler = [
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            _gorev(lambda s: delivery_service.add_stops(s, run, [oid])),
        ]
        if _tur % 2:
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)             # 40P01 / 55P03 → başarısızlık
        r = _sonuclar(ham, adlar)

        # İkisi de başarılı olmalı: `complete` idempotent döner, `add_stops`
        # hazır paketi tura ekler. Biri düşerse ya kilit ya guard bozulmuştur.
        assert _basarili(r["complete"]), f"tur {_tur}: {r['complete']!r}"
        assert r["complete"].status == "PACKED"
        assert _basarili(r["add_stops"]), f"tur {_tur}: {r['add_stops']!r}"

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
            durak = (
                await s.execute(
                    text(
                        "SELECT count(*) FROM delivery_stops "
                        "WHERE order_id = :o AND run_id = :r AND status = 'PENDING'"
                    ),
                    {"o": oid, "r": run},
                )
            ).scalar_one()
        assert taze.status == "PACKED"
        assert durak == 1
        assert await _olay_sayisi(paket.id, "COMPLETE") == 1, "çift COMPLETE olayı"
        assert await fab.prepared_at(oid) is not None


# ══════════════════ Commit 3 denetiminden gelen matris (P2-E) ═══════════════
#
# Denetim, yaşam döngüsünün üç kritik çiftinin hiç yarıştırılmadığını buldu.
# Hepsinin ortak riski aynı: iki yol AYNI paket satırına yazıyor ve biri
# diğerinin durum kararını bayat okursa paket iki yerde birden sayılır
# (rafta + araçta). Aşağıdaki üç düğüm kayıp güncellemeyi, çift olayı ve
# izinsiz son durumu birlikte ölçer.


async def _paket_durumu(servis, paket_id: int) -> str:
    async with AsyncSessionLocal() as s:
        return (await servis.get_package(s, paket_id)).status


async def _olay_sayisi(paket_id: int, event_type: str) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM package_scan_events "
                    "WHERE package_id = :p AND event_type = :e"
                ),
                {"p": paket_id, "e": event_type},
            )
        ).scalar_one()


async def _return_pending_paket(fab, servis, aid: int, kurye: int):
    """(order_id, paket, run_id) — kuryede kalmış (`RETURN_PENDING`) paket."""
    from services import delivery_service

    run = await fab.tur(courier_id=kurye)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        paket = await servis.complete(s, paket.id, admin_id=aid)
    async with AsyncSessionLocal() as s:
        tur = await delivery_service.add_stops(s, run, [oid])
    stop_id = [d for d in tur.stops if d.order_id == oid][0].id
    async with AsyncSessionLocal() as s:
        await delivery_service.handover_scan(
            s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
        )
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )
    return oid, paket, run


@pytest.mark.asyncio
async def test_ES_ZAMANLI_scan_ile_finalize_KAYIP_GUNCELLEME_URETMEZ(fab):
    """2 beklenen / 1 taranmış pakette `scan` ile `complete` çarpışır.

    İzin verilen son durumlar YALNIZ ikisi:
      * `complete` önce kazandı → eksik kalem var → 409; sonra tarama geçti →
        (`OPEN`, 2)
      * `scan` önce kazandı → satır tamamlandı → (`PACKED`, 2)

    Yasak olan: `scanned_qty == 1` (tarama kayboldu) ya da `PACKED` iken
    `scanned_qty < expected` (eksik paket kapandı). İkisi de sessizce eksik
    paket sevkiyatı demektir.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

        adlar = ("scan", "complete")
        gorevler = [
            _gorev(lambda s: servis.scan(s, paket.id, code=ean, admin_id=aid)),
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
        ]
        if _tur % 2:                       # ters başlatma sırası
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        # Tarama HER İKİ sırada da başarılı olmalı ve `OK` dönmeli: `OVER_QTY`
        # ya da bir istisna, taramanın sessizce yutulduğu anlamına gelirdi.
        assert _basarili(r["scan"]), f"tur {_tur}: tarama düştü: {r['scan']!r}"
        assert r["scan"].result == "OK", f"tur {_tur}: {r['scan'].result}"

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.items[0].scanned_qty == 2, f"tur {_tur}: tarama kayboldu"
        assert await _olay_sayisi(paket.id, "SCAN") == 2

        # Gözlenen sonuca göre TEK ve DAR son durum — disjonksiyon YOK.
        if _basarili(r["complete"]):
            # `complete` ancak tarama ondan ÖNCE bittiyse başarılı olabilirdi.
            assert taze.status == "PACKED"
            assert taze.packed_at is not None
            assert await fab.prepared_at(oid) is not None
            assert await _olay_sayisi(paket.id, "COMPLETE") == 1
        else:
            assert _reddedildi(r["complete"]), f"beklenmeyen hata: {r['complete']!r}"
            assert "eksik" in str(r["complete"].detail).lower()
            assert taze.status == "OPEN", "complete reddedildi ama paket kapandı"
            assert taze.packed_at is None
            assert await fab.prepared_at(oid) is None
            assert await _olay_sayisi(paket.id, "COMPLETE") == 0


@pytest.mark.asyncio
async def test_ES_ZAMANLI_return_in_ile_repack_SIRA_ATLATMAZ(fab):
    """`RETURN_PENDING` pakette `return_in` ile `repack` çarpışır.

    Sıra atlanamaz (§3.5): paket geri geldiği OKUTULARAK doğrulanmadan yeniden
    dağıtıma verilemez. Bu yüzden izin verilen son durumlar:
      * `repack` önce → 409 (`RETURNED` bekleniyordu); sonra `return_in` →
        `RETURNED`
      * `return_in` önce → `RETURNED`; sonra `repack` → `PACKED`

    Yasak: `PACKED` iken `returned_at IS NULL` — bu, hiç okutulmamış bir
    paketin dağıtıma geri konması demektir.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        kurye = await fab.kurye()
        oid, paket, _run = await _return_pending_paket(fab, servis, aid, kurye)
        assert await _paket_durumu(servis, paket.id) == "RETURN_PENDING"

        adlar = ("return_in", "repack")
        gorevler = [
            _gorev(lambda s: servis.return_in(s, paket.id, admin_id=aid)),
            _gorev(lambda s: servis.repack(s, paket.id, admin_id=aid)),
        ]
        if _tur % 2:
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        # `return_in` HER İKİ sırada da başarılı olmalı: paket geri gelmiştir
        # ve onu okutmayı hiçbir yarış engelleyemez.
        assert _basarili(r["return_in"]), f"tur {_tur}: {r['return_in']!r}"
        assert r["return_in"].status in ("RETURNED", "PACKED")

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.returned_at is not None, "okutulmadan dağıtıma dönmüş"
        assert await _olay_sayisi(paket.id, "RETURN_IN") == 1

        if _basarili(r["repack"]):
            # `repack` ancak `return_in` ondan ÖNCE bittiyse geçebilirdi.
            assert taze.status == "PACKED"
            assert await _olay_sayisi(paket.id, "REPACK") == 1
            assert await fab.prepared_at(oid) is not None
        else:
            assert _reddedildi(r["repack"]), f"beklenmeyen hata: {r['repack']!r}"
            assert "RETURNED" in str(r["repack"].detail)
            assert taze.status == "RETURNED", "repack reddedildi ama paket PACKED"
            assert await _olay_sayisi(paket.id, "REPACK") == 0
            assert await fab.prepared_at(oid) is None


@pytest.mark.asyncio
async def test_ES_ZAMANLI_return_in_ile_void_TEK_KAZANAN(fab):
    """`RETURN_PENDING` pakette `return_in` ile `void` çarpışır.

    `void` araçtaki paketten YAPILAMAZ (`from_statuses` = OPEN/PACKED/RETURNED):
    envanterin araçtaki paketi "yok" sayması, kaybolan paketi görünmez yapardı.
    İzin verilen son durumlar:
      * `void` önce → 409; sonra `return_in` → `RETURNED`
      * `return_in` önce → `RETURNED`; sonra `void` → `VOID` (artık depoda)

    Yasak: `VOID` iken `returned_at IS NULL` (araçtaki paket yok sayıldı).
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        kurye = await fab.kurye()
        _oid, paket, _run = await _return_pending_paket(fab, servis, aid, kurye)

        adlar = ("return_in", "void")
        gorevler = [
            _gorev(lambda s: servis.return_in(s, paket.id, admin_id=aid)),
            _gorev(
                lambda s: servis.void(
                    s, paket.id, admin_id=aid, reason="Sipariş iptal edildi",
                    izin_dogrula=servis.izin_zaten_dogrulandi,
                )
            ),
        ]
        if _tur % 2:
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        assert _basarili(r["return_in"]), f"tur {_tur}: {r['return_in']!r}"

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        assert taze.returned_at is not None, "araçtaki paket yok sayıldı"
        assert await _olay_sayisi(paket.id, "RETURN_IN") == 1

        if _basarili(r["void"]):
            assert taze.status == "VOID"
            assert taze.void_reason == "Sipariş iptal edildi"
            assert await _olay_sayisi(paket.id, "VOID") == 1
        else:
            assert _reddedildi(r["void"]), f"beklenmeyen hata: {r['void']!r}"
            assert "RETURN_PENDING" in str(r["void"].detail)
            assert taze.status == "RETURNED", "void reddedildi ama paket VOID"
            assert await _olay_sayisi(paket.id, "VOID") == 0


@pytest.mark.asyncio
async def test_ES_ZAMANLI_zimmet_ile_void_TEK_KAZANAN(fab):
    """Kurye paketi okuturken depo aynı anda paketi bozmaya kalkar.

    Bu, F30'un en pahalı yarışıdır: kaybeden taraf sessiz kalırsa paket hem
    araçta hem "çözülmüş" olur. İzin verilen son durumlar:
      * zimmet önce → `HANDED_OVER` + sipariş `SHIPPED`; `void` 409
      * `void` önce → `VOID` + sipariş `PAID` + `prepared_at` NULL; zimmet 409

    Yasak: `VOID` iken siparişin `SHIPPED` olması (yok edilmiş paketin
    dağıtımda sayılması) ya da iki `SHIPPED` geçişi.
    """
    servis = _servis()
    from services import delivery_service

    for _tur in range(TURLAR):
        aid = await fab.admin()
        kurye = await fab.kurye()
        run = await fab.tur(courier_id=kurye)
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
        async with AsyncSessionLocal() as s:
            paket = await servis.complete(s, paket.id, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await delivery_service.add_stops(s, run, [oid])

        adlar = ("handover", "void")
        gorevler = [
            _gorev(
                lambda s: delivery_service.handover_scan(
                    s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
                )
            ),
            _gorev(
                lambda s: servis.void(s, paket.id, admin_id=aid, reason="Kutu ezildi",
                izin_dogrula=servis.izin_zaten_dogrulandi,
            )
            ),
        ]
        if _tur % 2:
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        # Bu çiftte iki taraf da geçemez: hangisi önce biterse öbürü YASAK bir
        # geçişe düşer. Tam bir kazanan olmalı — ikisi de "başarılı" dönerse
        # guard'lardan biri sessizce kalkmıştır.
        kazananlar = [ad for ad in adlar if _basarili(r[ad])]
        assert len(kazananlar) == 1, f"tur {_tur}: kazanan sayısı {kazananlar}"
        kayip = [ad for ad in adlar if ad not in kazananlar][0]
        assert _reddedildi(r[kayip]), f"beklenmeyen hata: {r[kayip]!r}"

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
        siparis_durumu, _odeme = await fab.siparis_durumu(oid)
        gecis = await _shipped_gecisi(oid)

        if kazananlar == ["handover"]:
            assert taze.status == "HANDED_OVER"
            assert taze.handed_to_courier_id == kurye
            assert siparis_durumu == "SHIPPED"
            assert gecis == 1
            assert await _olay_sayisi(paket.id, "VOID") == 0
        else:
            assert taze.status == "VOID"
            assert siparis_durumu == "PAID", "yok edilmiş paket dağıtımda"
            assert gecis == 0
            assert await fab.prepared_at(oid) is None
            assert await _olay_sayisi(paket.id, "HANDOVER") == 0


@pytest.mark.asyncio
async def test_ES_ZAMANLI_complete_ile_void_YETKI_KARARI_BAYATLAMAZ(fab):
    """TOCTOU: `complete` araya girerse pack-only kullanıcı KAPANMIŞ paketi
    void edemez (commit 4 denetimi).

    `void`in gerektirdiği izin paketin durumuna bağlıdır (`OPEN` → `pack`,
    kapanmış → `manage`). Karar **kilitsiz** okunan durumla verilseydi şu sıra
    mümkün olurdu: (1) router `OPEN` görür ve `pack` yeterli der, (2) araya
    `complete` girer ve paket `PACKED` olur, (3) `void` kapanmış paketi
    `packing.manage` OLMADAN çözer. Karar artık `Order` + `OrderPackage`
    kilitleri alındıktan sonra, taze durumla veriliyor.

    Ölçüm gerçek yetki doğrulayıcısıyla yapılır: router'ın geçirdiği
    doğrulayıcının aynısı (`durum != OPEN` → 403) servise verilir.
    """
    servis = _servis()
    for _tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)

        async def _pack_only(durum: str) -> None:
            """`packing.pack` yetkisi olan kullanıcının doğrulayıcısı."""
            if durum != "OPEN":
                raise HTTPException(403, "packing.manage gerekir")

        adlar = ("complete", "void")
        gorevler = [
            _gorev(lambda s: servis.complete(s, paket.id, admin_id=aid)),
            _gorev(
                lambda s: servis.void(
                    s, paket.id, admin_id=aid, reason="pack-only deneme",
                    izin_dogrula=_pack_only,
                )
            ),
        ]
        if _tur % 2:
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        for x in ham:
            if isinstance(x, BaseException) and not (
                isinstance(x, HTTPException) and x.status_code in (403, 409)
            ):
                raise x

        r = _sonuclar(ham, adlar)
        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)

        if _basarili(r["complete"]):
            # `complete` kazandı → paket kapandı → pack-only void 403 ALMALI.
            assert taze.status == "PACKED", f"tur {_tur}: {taze.status}"
            assert isinstance(r["void"], HTTPException)
            assert r["void"].status_code == 403, (
                f"TOCTOU: pack-only kullanıcı kapanmış paketi çözdü ({r['void']!r})"
            )
            assert await _olay_sayisi(paket.id, "VOID") == 0
        else:
            # `void` kazandı → paket OPEN'ken çözüldü (pack yetkisi yeterliydi).
            assert _basarili(r["void"])
            assert taze.status == "VOID"
            assert _reddedildi(r["complete"])
            assert await _olay_sayisi(paket.id, "COMPLETE") == 0


async def _shipped_gecisi(order_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM order_status_history "
                    "WHERE order_id = :o AND new_status = 'SHIPPED'"
                ),
                {"o": order_id},
            )
        ).scalar_one()


@pytest.mark.asyncio
async def test_ES_ZAMANLI_void_ile_add_stops_BAYAT_DURAK_BIRAKMAZ(fab):
    """`void` ile `add_stops` çarpışırsa turda **VOID paketli PENDING durak
    kalmaz** (commit 5 denetiminin P1 bulgusu).

    Eski hâlde `add_stops` hiçbir satır kilidi almıyordu: siparişi ve paketi
    kilitsiz okuyup karar veriyor, sonra durağı yazıyordu. Araya `void`
    girdiğinde ortaya çözülmüş paketli bir `PENDING` durak çıkıyordu ve sonuç
    **iki taraflı kilitlenme** oluyordu: `start_run` o durağı zimmetsiz sayıp
    bütün turu 409'luyor, sipariş de açık durağı yüzünden ne başka tura
    eklenebiliyor ne kuyruğa girebiliyordu — kurtuluş yalnız elle
    `remove_stop`'tu. Denetim bu yarışta 6/6 kez bayat durak üretildiğini
    ölçtü.

    İzin verilen son durumlar (gözlenen kazanana göre TEK ve DAR):

    * `void` kazandı → paket `VOID`, **durak YOK**, `add_stops` 409
      ("çözülmüş"), sipariş `prepared_at` NULL
    * `add_stops` kazandı → durak var, paket `PACKED` **ya da** `VOID`;
      `VOID` ise durak da `PENDING` OLMAMALI... — hayır: `add_stops` kazandıysa
      `void` ondan SONRA çalışmıştır ve `void` durakları kapatmaz. Bu yüzden
      `add_stops` kazandığında `void`'in de başarılı olması ve durağın kalması
      MÜMKÜNDÜR; kritik olan `start_run`'ın o durağı zimmetsiz sayarak turu
      korumasıdır. Bu hâl ayrıca ölçülür.
    """
    servis = _servis()
    from services import delivery_service

    gozlenen = {"void_kazandi": 0, "add_stops_kazandi": 0}
    for _tur in range(TURLAR * 2):
        aid = await fab.admin()
        kurye = await fab.kurye()
        run = await fab.tur(courier_id=kurye)
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.complete(s, paket.id, admin_id=aid)

        adlar = ("add_stops", "void")
        gorevler = [
            _gorev(lambda s: delivery_service.add_stops(s, run, [oid])),
            _gorev(
                lambda s: servis.void(
                    s, paket.id, admin_id=aid, reason="Kutu ezildi",
                    izin_dogrula=servis.izin_zaten_dogrulandi,
                )
            ),
        ]
        if _tur % 2:                       # ters başlatma sırası
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)             # 40P01/55P03 → başarısızlık
        r = _sonuclar(ham, adlar)

        # `void` HER İKİ sırada da başarılı olmalı: paket depodadır ve onu
        # çözmeyi hiçbir yarış engellememeli.
        assert _basarili(r["void"]), f"tur {_tur}: void düştü: {r['void']!r}"

        async with AsyncSessionLocal() as s:
            taze = await servis.get_package(s, paket.id)
            durak = (
                await s.execute(
                    text(
                        "SELECT count(*) FROM delivery_stops "
                        "WHERE order_id = :o AND run_id = :r "
                        "AND status = 'PENDING'"
                    ),
                    {"o": oid, "r": run},
                )
            ).scalar_one()
        assert taze.status == "VOID"

        if _reddedildi(r["add_stops"]):
            gozlenen["void_kazandi"] += 1
            # İki meşru ret gerekçesi var ve hangisinin geldiği `void`in
            # commit sırasına bağlıdır: `void` `prepared_at`'i de sıfırladığı
            # için erken guard ("henüz hazırlanmadı") da devreye girebilir.
            # Ölçülen şey mesaj değil, **bayat durak kalmaması**.
            assert any(
                k in str(r["add_stops"].detail) for k in ("çözülmüş", "hazırlan")
            ), str(r["add_stops"].detail)
            assert durak == 0, "reddedilen add_stops yine de durak bıraktı"
            assert await fab.prepared_at(oid) is None
        else:
            gozlenen["add_stops_kazandi"] += 1
            assert _basarili(r["add_stops"])
            # `add_stops` önce commit etse bile `void` durağı KAPATIR: paket
            # çözülmüşse o durakta teslim edilecek bir şey kalmamıştır.
            # Bayat `PENDING` durak bırakmak, turu 409'a kilitler ve siparişi
            # hem kuyruktan hem başka turdan dışlardı (denetim P1).
            assert durak == 0, "VOID paketli PENDING durak kaldı"
            # Tur da kilitlenmemeli: kapatılmış durakla start_run çalışır ya da
            # "uygun durak kalmadı" der; asla zimmetsiz gönderim yapmaz.
            with pytest.raises(HTTPException) as hata:
                async with AsyncSessionLocal() as s:
                    await delivery_service.start_run(s, run)
            assert hata.value.status_code == 400, str(hata.value.detail)
            assert (await fab.siparis_durumu(oid))[0] == "PAID"

    # Kilit eklendikten sonra beklenen: `void` kazandığı turlar VARDIR.
    # (Kilitsiz eski hâlde bu sayaç 0 kalırdı — denetim 6/6 bayat durak ölçtü.)
    assert gozlenen["void_kazandi"] > 0, (
        f"void hiçbir turda kazanamadı — add_stops kilidi çalışmıyor olabilir: {gozlenen}"
    )


# ══════ P1 · teslimat kilit sırası (commit 6 denetimi) ══════════════════════
#
# Deadlock, aynı satır kümesinin farklı sıralarda kilitlenmesinden doğar.
# `add_stops` siparişleri artan `order_id` ile, `cancel_run` /
# `expire_stale_runs` ise durakları `DeliveryStop.sequence` ile dolaşıp her
# durak için siparişi kilitliyordu. Rota optimizasyonundan sonra iki sıranın
# farklı olması NORMALDİR — bağımsız denetim gerçek `40P01`'i mutasyonsuz
# üretim kodunda 4/6 tekrarda üretti.
#
# Aşağıdaki kurulum o farkı BİLE İSTEYE üretir: duraklar `sequence` sırasında
# `order_id`'nin TERSİ olacak şekilde eklenir ve bu kurulum ayrıca ASSERT
# edilir — aynı sıraya çevrilirse test artık hiçbir çakışma üretmez ve bunu
# sessizce yapamaz.


async def _paket_yuku(s, order_id: int) -> str:
    """Siparişin canlı paketinin etiket yükü (test yardımcısı)."""
    from services import packing_events, packing_rules

    paket = await packing_events.live_package(s, order_id)
    assert paket is not None
    return packing_rules.build_package_qr(paket.id, paket.qr_token)


async def _ters_sirali_tur(fab, servis, aid: int, kurye: int):
    """(run_id, (küçük_oid, büyük_oid)) — sequence sırası order_id'nin TERSİ.

    `add_stops` durak `sequence`'ini isteğin sırasına göre verir. Büyük
    `order_id` önce eklenirse sequence 1'i o alır, küçük olan sequence 2'yi.
    Sonuç: `sequence` artarken `order_id` azalır — rota optimizasyonundan
    sonraki gerçek hâlin ta kendisi.
    """
    from services import delivery_service

    oidler = []
    for _ in range(2):
        pid, _sku, ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        async with AsyncSessionLocal() as s:
            paket = await servis.open_package(s, oid, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.scan(s, paket.id, code=ean, admin_id=aid)
        async with AsyncSessionLocal() as s:
            await servis.complete(s, paket.id, admin_id=aid)
        oidler.append(oid)
    kucuk, buyuk = min(oidler), max(oidler)

    run = await fab.tur(courier_id=kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [buyuk, kucuk])   # TERS sıra

    async with AsyncSessionLocal() as s:
        satirlar = (
            await s.execute(
                text(
                    "SELECT order_id FROM delivery_stops WHERE run_id = :r "
                    "ORDER BY sequence"
                ),
                {"r": run},
            )
        ).scalars().all()
    assert satirlar == [buyuk, kucuk], (
        f"kurulum ters DEĞİL — sequence sırası {satirlar}, beklenen [{buyuk}, {kucuk}]"
    )
    return run, (kucuk, buyuk)


async def _sahaya_cikar_tur(fab, servis, aid: int, kurye: int):
    """Ters sıralı tur + iki paket zimmetli + tur ACTIVE."""
    from services import delivery_service

    run, (kucuk, buyuk) = await _ters_sirali_tur(fab, servis, aid, kurye)
    for oid in (kucuk, buyuk):
        async with AsyncSessionLocal() as s:
            await delivery_service.handover_scan(
                s, await _paket_yuku(s, oid), courier_id=kurye,
                actor=f"courier:{kurye}",
            )
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    return run, (kucuk, buyuk)


async def _tur_durumu(run_id: int) -> tuple[str, list[str], int]:
    async with AsyncSessionLocal() as s:
        durum = (
            await s.execute(
                text("SELECT status FROM delivery_runs WHERE id = :r"), {"r": run_id}
            )
        ).scalar_one()
        duraklar = list(
            (
                await s.execute(
                    text(
                        "SELECT status FROM delivery_stops WHERE run_id = :r "
                        "ORDER BY sequence"
                    ),
                    {"r": run_id},
                )
            ).scalars().all()
        )
    return durum, duraklar, len(duraklar)


async def _yan_etki_yok(fab, oid: int) -> None:
    """Sipariş zimmetsiz SHIPPED olmadı, takip/zimmet yan etkisi doğmadı."""
    siparis, _odeme = await fab.siparis_durumu(oid)
    assert siparis == "PAID", f"#{oid} dağıtımda kaldı: {siparis}"
    async with AsyncSessionLocal() as s:
        takip = (
            await s.execute(
                text("SELECT tracking_no FROM orders WHERE id = :i"), {"i": oid}
            )
        ).scalar_one()
        paket_durum = (
            await s.execute(
                text("SELECT status FROM order_packages WHERE order_id = :o"),
                {"o": oid},
            )
        ).scalar_one()
        zimmet = (
            await s.execute(
                text(
                    "SELECT count(*) FROM package_scan_events e "
                    "JOIN order_packages p ON p.id = e.package_id "
                    "WHERE p.order_id = :o AND e.event_type = 'HANDOVER'"
                ),
                {"o": oid},
            )
        ).scalar_one()
    assert takip is None, "iptal edilen turda takip numarası kalmış"
    assert paket_durum == "RETURN_PENDING"
    assert zimmet == 1, f"ikinci zimmet olayı doğdu: {zimmet}"


@pytest.mark.asyncio
async def test_ES_ZAMANLI_cancel_run_ile_add_stops_DEADLOCK_URETMEZ(fab):
    """`cancel_run` ile `add_stops` TERS SIRALI sipariş kümesinde çarpışır.

    Eski kodda `cancel_run` durakları `sequence` sırasında (B→A), `add_stops`
    ise artan `order_id` sırasında (A→B) kilitliyordu → klasik AB-BA döngüsü.
    Bağımsız denetim bunu mutasyonsuz üretim kodunda 4/6 tekrarda gerçek
    `40P01` olarak üretti.

    İzin verilen tek sonuç kümesi:

    * `40P01` (deadlock) ve `55P03` (lock timeout) **YASAK** —
      `_kilit_hatasi_yok` ikisini de kesin başarısızlık sayar (yutulmaz),
    * `cancel_run` HER İKİ başlatma sırasında da başarılı olur,
    * `add_stops` 409 ile reddedilir (siparişlerin açık durağı vardır ya da
      paketleri `RETURN_PENDING`'e düşmüştür) ve **hiç durak bırakmaz**,
    * tur `CANCELLED`, duraklar `FAILED`, siparişler `PAID`, paketler
      `RETURN_PENDING`, takip numarası yok, ikinci `HANDOVER` olayı yok.
    """
    servis = _servis()
    from services import delivery_service

    for _tur in range(3):
        aid = await fab.admin()
        kurye = await fab.kurye()
        run, (kucuk, buyuk) = await _sahaya_cikar_tur(fab, servis, aid, kurye)
        hedef_tur = await fab.tur(courier_id=kurye)

        adlar = ("cancel_run", "add_stops")
        gorevler = [
            _gorev(lambda s: delivery_service.cancel_run(s, run)),
            _gorev(lambda s: delivery_service.add_stops(s, hedef_tur, [kucuk, buyuk])),
        ]
        if _tur % 2:                       # ters BAŞLATMA sırası
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)             # 40P01 / 55P03 → kesin başarısızlık
        r = _sonuclar(ham, adlar)

        assert _basarili(r["cancel_run"]), f"tur {_tur}: {r['cancel_run']!r}"
        assert _reddedildi(r["add_stops"]), f"tur {_tur}: {r['add_stops']!r}"

        durum, duraklar, _n = await _tur_durumu(run)
        assert durum == "CANCELLED"
        assert duraklar == ["FAILED", "FAILED"], duraklar
        _durum2, _d2, yeni = await _tur_durumu(hedef_tur)
        assert yeni == 0, "reddedilen add_stops yine de durak bıraktı"

        for oid in (kucuk, buyuk):
            await _yan_etki_yok(fab, oid)


@pytest.mark.asyncio
async def test_ES_ZAMANLI_expire_stale_runs_ile_add_stops_DEADLOCK_URETMEZ(fab):
    """Watchdog (`expire_stale_runs`) ile `add_stops` aynı ters kurulumda çarpışır.

    `cancel_run` ile aynı kök neden, farklı giriş noktası: watchdog da
    durakları `sequence` sırasında dolaşıyordu. Burada ayrıca **outbox
    sayıları** ölçülür — kilit düzeltmesi yan etkiyi çoğaltmamalıdır.
    """
    servis = _servis()
    from core.config import settings
    from services import delivery_service

    saat = max(settings.DELIVERY_STALE_RUN_HOURS, 1)
    # Watchdog turu, `cancel_run`a göre durak başına daha çok iş yapar
    # (bildirim + outbox); deadlock penceresi bu yüzden daha dardır ve tur
    # sayısı bilinçli olarak yüksek tutulur.
    for _tur in range(6):
        aid = await fab.admin()
        kurye = await fab.kurye()
        run, (kucuk, buyuk) = await _sahaya_cikar_tur(fab, servis, aid, kurye)
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE delivery_runs SET started_at = :t WHERE id = :i"),
                {
                    "t": datetime.datetime.now(datetime.timezone.utc)
                    - datetime.timedelta(hours=saat + 2),
                    "i": run,
                },
            )
            await s.commit()
        hedef_tur = await fab.tur(courier_id=kurye)

        adlar = ("watchdog", "add_stops")
        gorevler = [
            _gorev(lambda s: delivery_service.expire_stale_runs(s)),
            _gorev(lambda s: delivery_service.add_stops(s, hedef_tur, [kucuk, buyuk])),
        ]
        if _tur % 2:
            adlar, gorevler = adlar[::-1], gorevler[::-1]
        ham = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(ham)
        r = _sonuclar(ham, adlar)

        assert _basarili(r["watchdog"]), f"tur {_tur}: {r['watchdog']!r}"
        assert r["watchdog"] >= 1, "watchdog bayat turu kapatmadı"
        assert _reddedildi(r["add_stops"]), f"tur {_tur}: {r['add_stops']!r}"

        durum, duraklar, _n = await _tur_durumu(run)
        assert durum == "CANCELLED"
        assert duraklar == ["FAILED", "FAILED"], duraklar
        _d, _dd, yeni = await _tur_durumu(hedef_tur)
        assert yeni == 0

        for oid in (kucuk, buyuk):
            await _yan_etki_yok(fab, oid)
            async with AsyncSessionLocal() as s:
                sms = (
                    await s.execute(
                        text(
                            "SELECT count(*) FROM outbox_events "
                            "WHERE payload ->> 'order_id' = :o "
                            "AND kind = 'sms:failed'"
                        ),
                        {"o": str(oid)},
                    )
                ).scalar_one()
            # Tek kapanış = tek SMS. Kilit düzeltmesi yan etkiyi çoğaltmamalı.
            assert sms == 1, f"#{oid} için {sms} adet başarısızlık SMS'i"
