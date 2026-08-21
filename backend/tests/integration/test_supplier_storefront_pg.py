"""Vitrin uygunluğu tedarikçi stoğunu hesaba katar — GERÇEK Postgres + HTTP.

D-2'nin davranış nöbetçisi. Ölçülen şey müşterinin gördüğü sonuçtur: kart
"stokta" mı diyor, `?in_stock=true` filtresi ürünü listede tutuyor mu, varyant
grubu kartı doğru davranıyor mu.

## Neden SQL ve Python ikizi AYNI testte ölçülüyor

Arama listesi SQL yüklemiyle (`bool_or` penceresi), detay ve tekil listelemeler
Python yüklemiyle (`_in_stock`) karar veriyor. İkisi ayrışırsa sonuç şudur:
**liste "stokta" der, detay "tükendi" der** — ve hiçbiri hata vermez. Bu yüzden
her senaryo iki yüzeyde birden doğrulanır.

D-6 de burada: maliyet ve marj **public** yanıtta görünmemeli.
"""
from __future__ import annotations

from decimal import Decimal

import httpx
import pytest

from tests.integration.supplier_factory import Fabrika


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    yield f
    await f.temizle()


async def _kart(client, product_id: int, **params) -> dict | None:
    r = await client.get("/api/v1/store/products", params={"limit": 100, **params})
    assert r.status_code == 200, r.text
    for kart in r.json():
        if kart["id"] == product_id:
            return kart
    return None


async def _detay(client, product_id: int) -> dict:
    r = await client.get(f"/api/v1/store/products/{product_id}")
    assert r.status_code == 200, r.text
    return r.json()


# ═══════════════ Temel matris ═══════════════


async def test_kendi_stogu_bitmis_ama_tedarikciden_temin_ediliyor(fab, client):
    """Paketin ana vaadi: raf boş, tedarikçide var → ürün SATILABİLİR."""
    sid = await fab.tedarikci(is_enabled=True)
    pid = await fab.urun(stock=0, supplier_backed=True)
    await fab.tedarikci_urunu(sid, product_id=pid, link_source="AUTO", stock_qty="3")

    kart = await _kart(client, pid)
    assert kart is not None
    assert kart["in_stock"] is True
    assert (await _detay(client, pid))["in_stock"] is True

    # `?in_stock=true` filtresi de aynı kararı vermeli.
    assert await _kart(client, pid, in_stock=True) is not None


async def test_temin_kapaliysa_tedarikci_stogu_sayilmaz(fab, client):
    """S1 mutasyonunun hedefi. `supplier_backed` yöneticinin açık kararıdır;
    bağ kurulmuş olması tek başına satışa yetmez."""
    sid = await fab.tedarikci(is_enabled=True)
    pid = await fab.urun(stock=0, supplier_backed=False)
    await fab.tedarikci_urunu(sid, product_id=pid, link_source="AUTO", stock_qty="3")

    assert (await _kart(client, pid))["in_stock"] is False
    assert (await _detay(client, pid))["in_stock"] is False
    assert await _kart(client, pid, in_stock=True) is None


async def test_tedarikci_kapaliysa_stogu_sayilmaz(fab, client):
    """Yönetici senkronu durdurduysa veriler BAYATTIR; bayat stoğa güvenip
    satmak, karşılayamayacağımız sipariş almaktır."""
    sid = await fab.tedarikci(is_enabled=False)
    pid = await fab.urun(stock=0, supplier_backed=True)
    await fab.tedarikci_urunu(sid, product_id=pid, link_source="AUTO", stock_qty="3")

    assert (await _kart(client, pid))["in_stock"] is False
    assert (await _detay(client, pid))["in_stock"] is False


async def test_favoriden_cikan_urunun_stogu_sayilmaz(fab, client):
    """Favoriden çıkan ürün artık senkronlanmıyor → değeri donmuş demektir."""
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=0, supplier_backed=True)
    await fab.tedarikci_urunu(
        sid, product_id=pid, link_source="AUTO", stock_qty="9", is_favorite=False
    )

    assert (await _kart(client, pid))["in_stock"] is False
    assert (await _detay(client, pid))["in_stock"] is False


async def test_kesirli_stok_birin_altinda_satilabilir_saymaz(fab, client):
    """S2 mutasyonunun hedefi. 0,5 düzine "yarım paket" demektir; sipariş
    karşılanamaz. Eşik `>= 1`, `> 0` DEĞİL."""
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=0, supplier_backed=True)
    await fab.tedarikci_urunu(sid, product_id=pid, link_source="AUTO", stock_qty="0.5")

    assert (await _kart(client, pid))["in_stock"] is False
    assert (await _detay(client, pid))["in_stock"] is False


async def test_tam_bir_birim_satilabilir(fab, client):
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=0, supplier_backed=True)
    await fab.tedarikci_urunu(sid, product_id=pid, link_source="AUTO", stock_qty="1.0")

    assert (await _kart(client, pid))["in_stock"] is True


async def test_bagsiz_temin_acik_urun_satilabilir_degil(fab, client):
    """"Temin açık ama hiçbir tedarikçi satırına bağlı değil" → stok bilgisi
    YOKTUR; varsayılan "satılabilir" olsaydı her açık anahtar ürünü sonsuz
    stoklu gösterirdi."""
    await fab.tedarikci()
    pid = await fab.urun(stock=0, supplier_backed=True)

    assert (await _kart(client, pid))["in_stock"] is False


async def test_kendi_stogu_varsa_tedarikciye_bakilmaz(fab, client):
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=4, supplier_backed=True)
    await fab.tedarikci_urunu(sid, product_id=pid, link_source="AUTO", stock_qty="0")

    kart = await _kart(client, pid)
    assert kart["in_stock"] is True
    assert kart["stock"] == 4, "kendi stoğu tedarikçi sayısıyla karıştırılmamalı"


async def test_tukenmis_urun_listeden_dusmez_isaretlenir(fab, client):
    """Mevcut davranış korunmalı: stoksuz ürün listede kalır, `in_stock=false`
    ile işaretlenir (`store_service` sözleşmesi)."""
    await fab.tedarikci()
    pid = await fab.urun(stock=0)

    kart = await _kart(client, pid)
    assert kart is not None and kart["in_stock"] is False


# ═══════════════ Varyant grubu ═══════════════


async def test_grup_karti_tedarikciden_temin_edilen_kardesi_sayar(fab, client):
    """Grup kartının stok durumu ÜYELERİN birleşimidir. Kardeşlerden biri
    yalnız tedarikçiden temin ediliyorsa kart "Tükendi" diyemez."""
    sid = await fab.tedarikci()
    gid = await fab.varyant_grubu()
    from tests.integration.supplier_factory import GECERLI_BARKODLAR

    kirmizi = await fab.urun(
        stock=0,
        variant_group_id=gid,
        option1_value="Kırmızı",
        barcode=GECERLI_BARKODLAR[0],
    )
    mavi = await fab.urun(
        stock=0,
        supplier_backed=True,
        variant_group_id=gid,
        option1_value="Mavi",
        barcode=GECERLI_BARKODLAR[1],
    )
    await fab.tedarikci_urunu(sid, product_id=mavi, link_source="AUTO", stock_qty="7")

    r = await client.get("/api/v1/store/products", params={"limit": 100})
    kartlar = [k for k in r.json() if k["id"] in {kirmizi, mavi}]
    assert len(kartlar) == 1, "grup tek kartla temsil edilmeli"
    assert kartlar[0]["in_stock"] is True
    assert kartlar[0]["variant_count"] == 2


async def test_detayda_kardes_seciciler_kendi_durumunu_gosterir(fab, client):
    sid = await fab.tedarikci()
    gid = await fab.varyant_grubu()
    from tests.integration.supplier_factory import GECERLI_BARKODLAR

    kirmizi = await fab.urun(
        stock=0,
        variant_group_id=gid,
        option1_value="Kırmızı",
        barcode=GECERLI_BARKODLAR[0],
    )
    mavi = await fab.urun(
        stock=0,
        supplier_backed=True,
        variant_group_id=gid,
        option1_value="Mavi",
        barcode=GECERLI_BARKODLAR[1],
    )
    await fab.tedarikci_urunu(sid, product_id=mavi, link_source="AUTO", stock_qty="7")

    detay = await _detay(client, kirmizi)
    uyeler = {u["id"]: u for u in detay["variants"]["members"]}
    assert uyeler[kirmizi]["in_stock"] is False
    assert uyeler[mavi]["in_stock"] is True


# ═══════════════ D-6: maliyet public yanıta sızmaz ═══════════════


async def test_public_yanit_maliyet_tasimaz(fab, client):
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=0, supplier_backed=True)
    await fab.tedarikci_urunu(
        sid,
        product_id=pid,
        link_source="AUTO",
        stock_qty="5",
        cost_net="51.02",
        cost_gross="61.23",
    )

    kart = await _kart(client, pid)
    detay = await _detay(client, pid)

    for govde in (kart, detay):
        metin = str(govde)
        assert "61.23" not in metin and "51.02" not in metin, (
            "tedarikçi maliyeti public yanıtta görünüyor (D-6)"
        )
        assert govde.get("supplier") is None
        for anahtar in govde:
            assert "cost" not in anahtar, f"public şemada maliyet alanı: {anahtar}"


async def test_public_yanit_karsilanma_kaynagini_soyler(fab, client):
    """`fulfillment` müşteriye güvenli bilgidir: "bizde var" ile "tedarikçiden
    getirilir" teslim süresi açısından farklı sözlerdir."""
    sid = await fab.tedarikci()
    kendi = await fab.urun(stock=3)
    tedarikciden = await fab.urun(stock=0, supplier_backed=True)
    tukenmis = await fab.urun(stock=0)
    dijital = await fab.urun(stock=None, kind="DIGITAL")
    await fab.tedarikci_urunu(
        sid, product_id=tedarikciden, link_source="AUTO", stock_qty="5"
    )

    assert (await _detay(client, kendi))["fulfillment"] == "OWN"
    assert (await _detay(client, tedarikciden))["fulfillment"] == "SUPPLIER"
    assert (await _detay(client, tukenmis))["fulfillment"] == "NONE"
    assert (await _detay(client, dijital))["fulfillment"] == "DIGITAL"


# ═══════════════ Admin listesi ═══════════════


async def test_admin_listesi_maliyet_ve_marji_gosterir(fab, client):
    token = await fab.admin_token(izinler=["products.view"])
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=0, supplier_backed=True, price="100.00")
    await fab.tedarikci_urunu(
        sid,
        product_id=pid,
        link_source="AUTO",
        stock_qty="5",
        cost_net="50.00",
        cost_gross="60.00",
    )

    r = await client.get(
        "/api/v1/store/admin/products",
        params={"limit": 100},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    kart = next(k for k in r.json() if k["id"] == pid)
    assert kart["supplier"] is not None
    assert Decimal(kart["supplier"]["cost_gross"]) == Decimal("60.00")
    assert Decimal(kart["supplier"]["margin_percent"]) == Decimal("40.00")
    assert kart["supplier"]["below_cost"] is False
    assert kart["supplier"]["stock_qty"] == "5.000"
    assert kart["supplier"]["unit_name"] == "Adet"


async def test_admin_listesi_zararina_satisi_isaretler(fab, client):
    token = await fab.admin_token(izinler=["products.view"])
    sid = await fab.tedarikci()
    pid = await fab.urun(stock=1, supplier_backed=True, price="50.00")
    await fab.tedarikci_urunu(
        sid,
        product_id=pid,
        link_source="AUTO",
        stock_qty="5",
        cost_net="60.00",
        cost_gross="72.00",
    )

    r = await client.get(
        "/api/v1/store/admin/products",
        params={"limit": 100, "supplier": "below_cost"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    idler = [k["id"] for k in r.json()]
    assert pid in idler
    kart = next(k for k in r.json() if k["id"] == pid)
    assert kart["supplier"]["below_cost"] is True


async def test_yanit_temin_anahtarinin_MEVCUT_degerini_tasir(fab, client):
    """SESSİZ VERİ KAYBI nöbetçisi.

    Yönetim formu düzenleme modunda "Tedarikçiden temin" kutusunu bu alandan
    ön-doldurur. Alan dönmezse kutu her açılışta BOŞ görünür ve kaydeden
    yönetici `supplier_backed: false` gönderir — AÇIK olan anahtarı farkında
    olmadan kapatır ve ürün vitrinde sessizce "tükendi"ye düşer.

    Kusur gerçekti: alan ilk sürümde şemada YOKTU ve frontend
    `initial?.supplier_backed ?? false` okuyordu.
    """
    token = await fab.admin_token(izinler=["products.view"])
    sid = await fab.tedarikci()
    acik = await fab.urun(stock=0, supplier_backed=True)
    kapali = await fab.urun(stock=1, supplier_backed=False)
    await fab.tedarikci_urunu(sid, product_id=acik, link_source="AUTO", stock_qty="3")

    r = await client.get(
        "/api/v1/store/admin/products",
        params={"limit": 100},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    kartlar = {k["id"]: k for k in r.json()}
    assert kartlar[acik]["supplier_backed"] is True
    assert kartlar[kapali]["supplier_backed"] is False

    # Public yanıt da taşır — vitrin "tedarikçiden temin" notunu buna bakarak
    # basmıyor (`fulfillment` yeterli) ama alan güvenlidir: bir sır değil,
    # ürün özniteliğidir.
    detay = await _detay(client, acik)
    assert detay["supplier_backed"] is True


async def test_admin_tedarikci_filtresi(fab, client):
    token = await fab.admin_token(izinler=["products.view"])
    sid = await fab.tedarikci()
    bagli = await fab.urun(stock=1)
    temin_acik = await fab.urun(stock=1, supplier_backed=True)
    ilgisiz = await fab.urun(stock=1)
    await fab.tedarikci_urunu(sid, product_id=bagli, link_source="AUTO", stock_qty="2")

    async def _idler(deger: str) -> set[int]:
        r = await client.get(
            "/api/v1/store/admin/products",
            params={"limit": 100, "supplier": deger},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        return {k["id"] for k in r.json()}

    bagli_kume = await _idler("linked")
    assert bagli in bagli_kume and temin_acik not in bagli_kume and ilgisiz not in bagli_kume

    temin_kume = await _idler("backed")
    assert temin_acik in temin_kume and ilgisiz not in temin_kume
