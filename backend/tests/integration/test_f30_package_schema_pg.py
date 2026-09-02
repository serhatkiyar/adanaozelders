"""F30 paket ŞEMASININ invariant'ları — GERÇEK PostgreSQL, SERVİSSİZ.

## Bu dosya neden ayrı

Kırmızı matristeki paket testlerinin hemen hepsi `packing_service` üzerinden
geçer ve servis yazılana kadar (commit 3) kırmızı kalır. Oysa commit 2'nin
teslim ettiği şey **veritabanının kendisidir**: kısıtlar, kısmi index'ler ve
append-only trigger'ı. Bunlar servis olmadan da doğrulanabilir — ve
doğrulanmalıdır, çünkü asıl soruları şu: *uygulama katmanı atlanırsa
veritabanı hâlâ hayır diyor mu?*

Her düğüm bu yüzden **ham SQL** ile yazar. Bir ORM/servis çağrısı kullanmak,
tam da ölçülmek istenen "son savunma hattı"nı atlardı.

Karşılık gelen davranış testleri (servis geldiğinde yeşile dönecek):
`test_f30_packing_pg.py::test_paket_QR_TEKILDIR`,
`::test_ayni_siparise_ikinci_paket_ACILMAZ`,
`::test_fazla_adet_DB_CHECK_ile_de_engellenir`,
`::test_tarama_izi_APPEND_ONLY`.
"""
from __future__ import annotations

import datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from core.database import AsyncSessionLocal
from tests.integration.f30_factory import PaketFabrikasi, now, uniq

#: Paket satırı yazmanın en kısa hâli; testler yalnız ilgilendikleri alanı ezer.
_PAKET_SQL = """
INSERT INTO order_packages (order_id, package_no, status, qr_token,
                            items_fingerprint, packed_at, handed_over_at,
                            delivered_at, returned_at, void_at, void_reason,
                            unpacked_at)
VALUES (:order_id, :package_no, :status, :qr_token, :fp, :packed_at,
        :handed_over_at, :delivered_at, :returned_at, :void_at, :void_reason,
        :unpacked_at)
RETURNING id
"""


async def _paket(
    s,
    order_id: int,
    *,
    package_no: int = 1,
    status: str = "OPEN",
    qr_token: str | None = None,
    packed_at: datetime.datetime | None = None,
    handed_over_at: datetime.datetime | None = None,
    delivered_at: datetime.datetime | None = None,
    returned_at: datetime.datetime | None = None,
    void_at: datetime.datetime | None = None,
    void_reason: str | None = None,
    unpacked_at: datetime.datetime | None = None,
) -> int:
    return (
        await s.execute(
            text(_PAKET_SQL),
            {
                "order_id": order_id,
                "package_no": package_no,
                "status": status,
                "qr_token": qr_token or uniq() + uniq(),
                "fp": "0" * 64,
                "packed_at": packed_at,
                "handed_over_at": handed_over_at,
                "delivered_at": delivered_at,
                "returned_at": returned_at,
                "void_at": void_at,
                "void_reason": void_reason,
                "unpacked_at": unpacked_at,
            },
        )
    ).scalar_one()


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    yield f
    await f.temizle()


@pytest.fixture
async def siparis(fab) -> tuple[PaketFabrikasi, int, int]:
    """(fabrika, order_id, order_item_id) — gerçek ödenmiş fiziksel sipariş."""
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])
    kalem = (await fab.kalem_idleri(oid))[0]
    return fab, oid, kalem


# ══════════════════ QR tekilliği ════════════════════════════════════════════


@pytest.mark.asyncio
async def test_AYNI_QR_TOKEN_ikinci_kez_yazilamaz(siparis):
    """Basılı etiket paketin ömrü boyunca geçerlidir (sözleşme §3.3); iki paketin
    aynı token'ı taşıması, kuryenin yanlış paketi teslim etmesi demektir."""
    _fab, oid, _kalem = siparis
    token = "cakisan-" + uniq()
    async with AsyncSessionLocal() as s:
        await _paket(s, oid, qr_token=token, status="VOID", void_at=now(),
                     void_reason="test")
        await s.commit()

    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _paket(s, oid, package_no=2, qr_token=token)
            await s.commit()
    assert "uq_order_packages_qr_token" in str(hata.value)


# ══════════════════ Canlı paket tekilliği ═══════════════════════════════════


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mevcut",
    ["OPEN", "PACKED", "HANDED_OVER", "RETURN_PENDING", "RETURNED"],
)
async def test_IKINCI_CANLI_PAKET_ARTIK_KABUL_EDILIR(siparis, mevcut):
    """DEĞİŞTİ (kısmi teslimat): ikinci canlı paket artık yasak DEĞİL.

    Eskiden `uq_order_packages_live` "bir siparişin tek canlı paketi olur"
    diyordu ve bu test onu kilitliyordu. Kısmi teslimat ("eldekini bugün
    gönder, kalanı temin edilince") tam olarak birden çok canlı paket
    demektir — index kaldırıldı (migration e8b3c1d95a47).

    Korunan asıl şey — "aynı ürünü ikinci kez raftan alma" — kaybolmadı, YER
    DEĞİŞTİRDİ: artık paket sayısı değil ADET sınırlanıyor
    (`order_package_items_ceiling` trigger'ı). Buradaki paketlerin satırı
    olmadığı için tavan hiç devreye girmez; tavanın kendisi
    `test_kismi_teslimat_pg.py` A1-A4'te ve aşağıdaki
    `test_TAVAN_TRIGGERI_YALNIZ_VOID_HARIC_TUTAR`da ölçülür.

    Beş durum ayrı düğüm olarak KALIR: kaldırma yanlışlıkla daraltılıp bazı
    durumlar için başka bir kısıt eklenirse tek örnekle sessizce geçerdi.
    """
    _fab, oid, _kalem = siparis
    async with AsyncSessionLocal() as s:
        await _paket(
            s,
            oid,
            status=mevcut,
            packed_at=now() if mevcut != "OPEN" else None,
            handed_over_at=(
                now() if mevcut in ("HANDED_OVER", "RETURN_PENDING") else None
            ),
            returned_at=now() if mevcut == "RETURNED" else None,
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        ikinci = await _paket(s, oid, package_no=2)
        await s.commit()
    assert ikinci


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal", ["DELIVERED", "VOID"])
async def test_TERMINAL_paket_sonrasi_YENI_PAKET_ACILABILIR(siparis, terminal):
    """Ters prova: kısmi index fazla geniş yazılırsa (`WHERE true`) iptal edilen
    paketin yerine yenisi AÇILAMAZDI ve `repack` akışı ölürdü."""
    _fab, oid, _kalem = siparis
    async with AsyncSessionLocal() as s:
        await _paket(
            s,
            oid,
            status=terminal,
            packed_at=now(),
            handed_over_at=now() if terminal == "DELIVERED" else None,
            delivered_at=now() if terminal == "DELIVERED" else None,
            void_at=now() if terminal == "VOID" else None,
            void_reason="paket bozuldu" if terminal == "VOID" else None,
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        yeni = await _paket(s, oid, package_no=2)
        await s.commit()
    assert yeni


@pytest.mark.asyncio
async def test_ayni_sipariste_PAKET_NO_TEKRARLANAMAZ(siparis):
    """`package_no` sipariş içinde tekildir — "2. paket" tek bir şeye işaret eder."""
    _fab, oid, _kalem = siparis
    async with AsyncSessionLocal() as s:
        await _paket(s, oid, package_no=1, status="VOID", void_at=now(),
                     void_reason="ilk deneme")
        await s.commit()
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _paket(s, oid, package_no=1, status="VOID", void_at=now(),
                         void_reason="ikinci deneme")
            await s.commit()
    assert "uq_order_packages_no" in str(hata.value)


# ══════════════════ Durum ↔ zaman tutarlılığı ═══════════════════════════════


@pytest.mark.asyncio
async def test_GECERSIZ_DURUM_reddedilir(siparis):
    """FSM dışı bir durum (ör. `OrderStatus`'ten kopyalanmış `PAID`) yazılamaz."""
    _fab, oid, _kalem = siparis
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _paket(s, oid, status="PAID")
            await s.commit()
    assert "ck_order_packages_status" in str(hata.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "durum,alanlar,kisit",
    [
        ("PACKED", {}, "ck_order_packages_packed_at"),
        (
            "HANDED_OVER",
            {"packed_at": now()},
            "ck_order_packages_handover_at",
        ),
        (
            "DELIVERED",
            {"packed_at": now(), "handed_over_at": now()},
            "ck_order_packages_delivered_at",
        ),
        ("RETURNED", {"packed_at": now()}, "ck_order_packages_returned_at"),
        ("VOID", {}, "ck_order_packages_void"),
    ],
)
async def test_ZAMANSIZ_DURUM_reddedilir(siparis, durum, alanlar, kisit):
    """"Kuryede" diyen ama ne zaman verildiği bilinmeyen paket üretilemez."""
    _fab, oid, _kalem = siparis
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _paket(s, oid, status=durum, **alanlar)
            await s.commit()
    assert kisit in str(hata.value)


@pytest.mark.asyncio
async def test_VOID_GEREKCESIZ_yazilamaz(siparis):
    """Gerekçe boş dizgi olarak da geçemez (`btrim` uzunluğu denetlenir)."""
    _fab, oid, _kalem = siparis
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _paket(s, oid, status="VOID", void_at=now(), void_reason="   ")
            await s.commit()
    assert "ck_order_packages_void" in str(hata.value)


@pytest.mark.asyncio
async def test_VOID_OLMAYAN_paket_BOZULMUS_damgalanamaz(siparis):
    """`unpacked_at` yalnız `VOID` pakette anlamlıdır (bozulacak paket kuyruğu, G8)."""
    _fab, oid, _kalem = siparis
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _paket(s, oid, status="OPEN", unpacked_at=now())
            await s.commit()
    assert "ck_order_packages_unpacked_void" in str(hata.value)


# ══════════════════ Paket satırı adetleri ══════════════════════════════════


async def _satir(s, package_id: int, order_item_id: int, **kw) -> int:
    veri = {
        "p": package_id,
        "oi": order_item_id,
        "pid": kw.get("product_id"),
        "sku": kw.get("sku"),
        "barcode": kw.get("barcode"),
        "title": kw.get("title", "Test Kitabı"),
        "exp": kw.get("expected_qty", 2),
        "sc": kw.get("scanned_qty", 0),
    }
    return (
        await s.execute(
            text(
                "INSERT INTO order_package_items (package_id, order_item_id, "
                "product_id, sku, barcode, title, expected_qty, scanned_qty) "
                "VALUES (:p, :oi, :pid, :sku, :barcode, :title, :exp, :sc) "
                "RETURNING id"
            ),
            veri,
        )
    ).scalar_one()


@pytest.mark.asyncio
@pytest.mark.parametrize("adet", [0, -1])
async def test_SIFIR_VE_NEGATIF_beklenen_adet_reddedilir(siparis, adet):
    """`expected_qty > 0`: sıfır adetlik paket satırı bir iş üretmez, yalnız
    "tamamlandı" sanılan boş bir paket üretirdi."""
    fab, oid, kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await s.commit()
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _satir(s, pkt, kalem, expected_qty=adet)
            await s.commit()
    assert "ck_order_package_items_expected" in str(hata.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("taranan", [3, -1])
async def test_TARANAN_ADET_beklenen_disina_cikamaz(siparis, taranan):
    """Fazla ürün de eksi adet de reddedilir (kullanıcı maddesi 4). Uygulama
    katmanı atlansa bile."""
    _fab, oid, kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await s.commit()
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _satir(s, pkt, kalem, expected_qty=2, scanned_qty=taranan)
            await s.commit()
    assert "ck_order_package_items_scanned" in str(hata.value)


@pytest.mark.asyncio
async def test_AYNI_KALEM_pakette_IKI_SATIR_uretemez(siparis):
    """Aynı sipariş kalemi bir pakette iki kez sayılamaz — beklenen adet
    sessizce ikiye katlanırdı."""
    _fab, oid, kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await _satir(s, pkt, kalem)
        await s.commit()
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _satir(s, pkt, kalem)
            await s.commit()
    assert "uq_order_package_items_line" in str(hata.value)


@pytest.mark.asyncio
async def test_URUNSUZ_SATIR_KOD_TASIYAMAZ(siparis):
    """`product_id IS NULL` satır taranamaz (§3.6). SKU/barkod taşırsa
    "okuttum, eşleşti" güveni silinmiş bir ürünün bayat koduna dayanırdı."""
    _fab, oid, kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await s.commit()
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _satir(s, pkt, kalem, product_id=None, sku="FZK-000042")
            await s.commit()
    assert "ck_order_package_items_scannable" in str(hata.value)


# ══════════════════ Append-only olay izi ═══════════════════════════════════


async def _olay(s, package_id: int, **kw) -> int:
    return (
        await s.execute(
            text(
                "INSERT INTO package_scan_events (package_id, event_type, result, "
                "code_scanned, qty_delta, manual_reason, actor_role, actor_id, "
                "idempotency_key) VALUES (:p, :et, :r, :c, :q, :mr, :ar, :ai, :ik) "
                "RETURNING id"
            ),
            {
                "p": package_id,
                "et": kw.get("event_type", "SCAN"),
                "r": kw.get("result", "OK"),
                "c": kw.get("code_scanned", "FZK-000042"),
                "q": kw.get("qty_delta", 1),
                "mr": kw.get("manual_reason"),
                "ar": kw.get("actor_role", 1),
                "ai": kw.get("actor_id", 1),
                "ik": kw.get("idempotency_key"),
            },
        )
    ).scalar_one()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "sorgu",
    [
        "UPDATE package_scan_events SET result = 'OK' WHERE package_id = :p",
        "DELETE FROM package_scan_events WHERE package_id = :p",
    ],
)
async def test_OLAY_IZI_APPEND_ONLY(siparis, sorgu):
    """Gizlenebilen bir iz, iz değildir. F29'un `stock_damage_events` duruşu."""
    _fab, oid, _kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await _olay(s, pkt)
        await s.commit()

    with pytest.raises((DBAPIError, IntegrityError)) as hata:
        async with AsyncSessionLocal() as s:
            await s.execute(text(sorgu), {"p": pkt})
            await s.commit()
    assert "append-only" in str(hata.value)


@pytest.mark.asyncio
async def test_IZI_OLAN_PAKET_SILINEMEZ(siparis):
    """FK `RESTRICT`: paketi (ya da siparişi) silmek izi sessizce yok edemez.

    Ters prova için not: FK `CASCADE` olsaydı bu silme başarılı olur ve "kim,
    ne zaman, hangi kodla doğruladı" sorusu bir daha cevaplanamazdı.
    """
    _fab, oid, _kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await _olay(s, pkt)
        await s.commit()

    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM order_packages WHERE id = :i"), {"i": pkt}
            )
            await s.commit()
    assert "package_scan_events" in str(hata.value)


@pytest.mark.asyncio
async def test_MANUEL_SONUC_GEREKCESIZ_yazilamaz(siparis):
    """`OK_MANUAL` kaçış kapısıdır; izsiz/gerekçesiz olamaz (§3.6)."""
    _fab, oid, _kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await s.commit()
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _olay(s, pkt, result="OK_MANUAL", manual_reason=None)
            await s.commit()
    assert "ck_package_scan_events_manual_reason" in str(hata.value)


@pytest.mark.asyncio
async def test_TARAMA_OLAYI_SONUCSUZ_yazilamaz(siparis):
    _fab, oid, _kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await s.commit()
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _olay(s, pkt, event_type="SCAN", result=None)
            await s.commit()
    assert "ck_package_scan_events_scan_result" in str(hata.value)


@pytest.mark.asyncio
async def test_YARIM_AKTOR_kaydi_yazilamaz(siparis):
    """Ya (rol, kimlik) çifti tam, ya da sistem olayı — arası yoktur."""
    _fab, oid, _kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await s.commit()
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _olay(s, pkt, actor_role=1, actor_id=None)
            await s.commit()
    assert "ck_package_scan_events_actor" in str(hata.value)


@pytest.mark.asyncio
async def test_AYNI_IDEMPOTENCY_ANAHTARI_ikinci_olay_yazamaz(siparis):
    """F29 `uq_stock_movements_idem` deseni: ağ tekrarı ikinci iz üretmez."""
    _fab, oid, _kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await _olay(s, pkt, idempotency_key="tarama-1")
        await s.commit()
    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await _olay(s, pkt, idempotency_key="tarama-1")
            await s.commit()
    assert "uq_package_scan_idem" in str(hata.value)


@pytest.mark.asyncio
async def test_ANAHTARSIZ_OLAYLAR_birbirini_ENGELLEMEZ(siparis):
    """Sistem kancası (sipariş iptali) anahtarsız olay yazar ve ikincisi de yazılır.

    ⚠️ Bu testin ESKİ gerekçesi YANLIŞTI ve commit 2 denetiminde düzeltildi
    (P2-3). Eskiden "kısmi `WHERE idempotency_key IS NOT NULL` kalkarsa bu
    ikinci satır yazılamazdı" deniyordu. Yanlış: PostgreSQL'de UNIQUE index
    **birden çok NULL'ı zaten kabul eder** (NULL'lar birbirine eşit sayılmaz),
    yani `WHERE` kalksa da bu iki satır yine yazılırdı. Yani iddia hem eski hem
    yeni şemada geçen, **hiçbir şeyi ayırt etmeyen** bir mutasyon provasıydı.

    Testin gerçek ve dar iddiası şudur: sistem kaynaklı olaylar anahtar
    taşımak ZORUNDA değildir ve anahtarsız olmaları birbirlerini bloklamaz —
    yani `packing_events.on_order_terminal` gibi kancalar aynı pakete birden
    çok iz yazabilir. Kısmi index'in kendi varlığı ayrı bir üründür ve ayrıca
    doğrulanır: `test_IDEM_INDEXI_GERCEKTEN_KISMIDIR`.
    """
    _fab, oid, _kalem = siparis
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await _olay(s, pkt, idempotency_key=None)
        await _olay(s, pkt, idempotency_key=None)
        await s.commit()

    async with AsyncSessionLocal() as s:
        adet = (
            await s.execute(
                text("SELECT count(*) FROM package_scan_events WHERE package_id = :p"),
                {"p": pkt},
            )
        ).scalar_one()
    assert adet == 2


# ══════════════════ Kısmi index yüklemleri (gerçek katalog) ═════════════════


async def _index_yuklemi(ad: str) -> str | None:
    """Uygulanmış index'in GERÇEK predicate'i (`pg_get_expr`); kısmi değilse None.

    Kaynak dosyada metin aramak yerine katalog okunur: ölçülen şey, migration'ın
    veritabanında ne bıraktığıdır — dosyada ne yazdığı değil.
    """
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT pg_get_expr(i.indpred, i.indrelid) "
                    "FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                    "WHERE c.relname = :ad"
                ),
                {"ad": ad},
            )
        ).scalar_one()


@pytest.mark.asyncio
async def test_TAVAN_TRIGGERI_YALNIZ_VOID_HARIC_TUTAR(pg):
    """Adet tavanı trigger'ı var mı ve neyi hariç tutuyor?

    `uq_order_packages_live`'ın yerini alan koruma budur (migration
    e8b3c1d95a47) ve `alembic check` bir trigger'ın GÖVDESİNİ karşılaştırmaz.

    Hariç tutulan küme tam olarak `{VOID}` olmalıdır:
      * `DELIVERED` de hariç tutulursa (V1'deki `_tuketilen_adetler` kusuru),
        teslim edilmiş bir paketin ürünleri "hiç istenmemiş" sayılır ve ikinci
        teslimat için açılan paket aynı ürünleri YENİDEN ister — depodan ikinci
        kez toplanır.
      * `VOID` hariç tutulmazsa bozulan paketin satırları tavanı yer ve
        `repack` akışı ölür.

    Davranış eşi: `test_kismi_teslimat_pg.py::test_A3/test_A4`.
    """
    from sqlalchemy import text as sa_text

    async with AsyncSessionLocal() as s:
        govde = (
            await s.execute(
                sa_text(
                    "SELECT prosrc FROM pg_proc "
                    "WHERE proname = 'order_package_items_ceiling'"
                )
            )
        ).scalar_one_or_none()
        tetik = (
            await s.execute(
                sa_text(
                    "SELECT count(*) FROM pg_trigger t "
                    "JOIN pg_class c ON c.oid = t.tgrelid "
                    "WHERE c.relname = 'order_package_items' "
                    "AND t.tgname = 'order_package_items_ceiling_trg'"
                )
            )
        ).scalar_one()

    assert govde, "adet tavanı fonksiyonu YOK — ikinci paket sınırsız ürün isterdi"
    assert tetik == 1, "tavan trigger'ı order_package_items üzerinde bağlı değil"
    haric = {
        d
        for d in ("OPEN", "PACKED", "HANDED_OVER", "RETURN_PENDING", "RETURNED",
                  "DELIVERED", "VOID")
        if f"'{d}'" in govde
    }
    assert haric == {"VOID"}, (
        f"tavan yükleminde hariç tutulan küme {sorted(haric)} — beklenen ['VOID']"
    )


@pytest.mark.asyncio
async def test_IDEM_INDEXI_GERCEKTEN_KISMIDIR(pg):
    """`uq_package_scan_idem` yalnız anahtarlı satırları indeksler.

    Bu, `test_ANAHTARSIZ_OLAYLAR_birbirini_ENGELLEMEZ`'in **yapamadığı**
    ölçümdür: PostgreSQL çok NULL'a zaten izin verdiğinden davranış testi
    kısmi yüklemin varlığını kanıtlayamaz. Yüklem ürün kararıdır (iz tablosu
    büyürken sistem olayları index'i şişirmesin) ve ancak katalogdan okunarak
    doğrulanabilir.
    """
    yuklem = await _index_yuklemi("uq_package_scan_idem")
    assert yuklem is not None, "uq_package_scan_idem kısmi değil"
    assert "idempotency_key" in yuklem and "NOT NULL" in yuklem.upper(), yuklem


# ══════════════════ Ürün sert silme (gerçek politika) ═══════════════════════


@pytest.mark.asyncio
async def test_URUN_SERT_SILINMESI_TARANABILIR_PAKET_SATIRINDA_REDDEDILIR(fab):
    """Ürünün sert silinmesi `SET NULL` ile SESSİZCE geçmez — DELETE reddedilir.

    Commit 2 denetiminin P2-1 bulgusu: sözleşme ve model docstring'i "ürün
    silinince `product_id` NULL olur, snapshot kalır, satır yalnız TARANAMAZ
    olur" diyordu. Gerçek davranış bu DEĞİL:

      * FK `SET NULL` `product_id`'yi boşaltmaya çalışır,
      * ama `ck_order_package_items_scannable` (`product_id IS NOT NULL OR
        (sku IS NULL AND barcode IS NULL)`) dolu SKU snapshot'ı yüzünden
        ihlal edilir,
      * sonuç: **sert silme tamamen reddedilir**.

    Bu, istenen sonuçtur (paket satırı bayat bir koda dayanamaz) ama servis
    tasarımı "product_id NULL olacaktır" varsayımı KURMAMALIDIR — üretimde
    ürün zaten soft-delete edilir (`store_service`), sert silme yolu yoktur.
    """
    pid, _sku, _ean = await fab.barkodlu_urun(stock=0)   # defter hareketi yok
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)], sale_yaz=False)
    kalem = (await fab.kalem_idleri(oid))[0]
    async with AsyncSessionLocal() as s:
        pkt = await _paket(s, oid)
        await _satir(s, pkt, kalem, product_id=pid, sku="FZK-000042", expected_qty=1)
        await s.commit()

    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as s:
            await s.execute(text("DELETE FROM products WHERE id = :i"), {"i": pid})
            await s.commit()
    assert "ck_order_package_items_scannable" in str(hata.value)

    # Satır olduğu gibi durur: ne product_id boşaldı ne snapshot kayboldu.
    async with AsyncSessionLocal() as s:
        satir = (
            await s.execute(
                text(
                    "SELECT product_id, sku FROM order_package_items "
                    "WHERE package_id = :p"
                ),
                {"p": pkt},
            )
        ).one()
    assert satir.product_id == pid and satir.sku == "FZK-000042"
