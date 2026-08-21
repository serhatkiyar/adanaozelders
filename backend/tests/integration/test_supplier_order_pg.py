"""Tedarikçi destekli siparişin PARA ve DEFTER davranışı — gerçek uç, gerçek PG.

D-8'in nöbetçisi. Kural: **tedarikçiden karşılanan adet deftere hiç girmez.**
Gerekçe ticari değil muhasebi — o mal hiçbir zaman rafımızda olmadı; `SALE`
yazmak stoğu eksiye iter (`stock_ledger` kırpmayı yasakladığı için doğrudan
`InsufficientStock`), yazmamak ama iptalde geri yüklemek ise **hiç satılmamış
malı rafa ekler**.

## Bu dosyanın kırdığı iki gerçek risk

* **S5** — `_finalize_paid` tedarikçi kapsamasını görmezse, temin açık bir ürün
  ödendikten sonra "stok yok" diye TAM İADE edilir. Müşteri parasını geri alır,
  satış kaybedilir ve kimse hata görmez (akış "başarılı" bir iadedir).
* **S6** — `_restock` tavanı `supplier_quantity`'yi düşmezse, tamamen
  tedarikçiden karşılanmış bir sipariş iptal edildiğinde raf stoğu HAYALİ
  olarak artar. Sayım bunu bir sonraki turda fark eder, ama arada satılır.

Mevcut oversell/iade davranışı (`test_ip5_oversell_refund_pg`,
`test_ip2b_cancel_stock_coupon_pg`) DEĞİŞMEMELİDİR; burada onun tedarikçili
karşılığı ölçülür.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from tests.integration.supplier_factory import Fabrika

pytestmark = pytest.mark.asyncio

D = Decimal


@pytest.fixture
async def sfab(pg):
    f = Fabrika()
    yield f
    await f.temizle()


async def _temin_ac(sfab: Fabrika, product_id: int, *, stok: str) -> int:
    """Ürünü tedarikçiye bağlar ve "tedarikçiden temin" anahtarını açar."""
    sid = await sfab.tedarikci(is_enabled=True)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET supplier_backed = true WHERE id = :i"),
            {"i": product_id},
        )
        await s.commit()
    return await sfab.tedarikci_urunu(
        sid, product_id=product_id, link_source="AUTO", stock_qty=stok
    )


async def _kalem(order_id: int) -> dict:
    async with AsyncSessionLocal() as s:
        row = (
            await s.execute(
                text(
                    "SELECT id, quantity, supplier_quantity FROM order_items "
                    "WHERE order_id = :i"
                ),
                {"i": order_id},
            )
        ).mappings().one()
    return dict(row)


async def _siparis_durumu(order_id: int) -> tuple[str, str]:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text("SELECT status, payment_status FROM orders WHERE id = :i"),
                {"i": order_id},
            )
        ).one()


# ═══════════════ Sepet doğrulaması ═══════════════


async def test_tedarikci_stogu_sepet_dogrulamasinda_sayilir(http, fab5, sfab):
    """Raf boş ama tedarikçide var → sepet geçerli olmalı."""
    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=0)
    sfab.product_ids.append(pid)
    await _temin_ac(sfab, pid, stok="5")

    r = await http.post(
        "/api/v1/store/cart/validate",
        json={"items": [{"product_id": pid, "quantity": 2}]},
        headers=m.headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["issues"] == []


async def test_tedarikci_stogunun_da_ustunde_istek_reddedilir(http, fab5, sfab):
    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=0)
    sfab.product_ids.append(pid)
    await _temin_ac(sfab, pid, stok="2")

    r = await http.post(
        "/api/v1/store/cart/validate",
        json={"items": [{"product_id": pid, "quantity": 3}]},
        headers=m.headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["issues"], "3 adet için ne rafta ne tedarikçide yeterli mal var"


async def test_kesirli_tedarikci_stogu_asagi_yuvarlanir(http, fab5, sfab):
    """2,5 düzine = 2 satılabilir düzine. Yukarı yuvarlamak, karşılanamayacak
    siparişi kabul etmektir."""
    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=0)
    sfab.product_ids.append(pid)
    await _temin_ac(sfab, pid, stok="2.5")

    iyi = await http.post(
        "/api/v1/store/cart/validate",
        json={"items": [{"product_id": pid, "quantity": 2}]},
        headers=m.headers,
    )
    kotu = await http.post(
        "/api/v1/store/cart/validate",
        json={"items": [{"product_id": pid, "quantity": 3}]},
        headers=m.headers,
    )
    assert iyi.json()["issues"] == []
    assert kotu.json()["issues"]


# ═══════════════ Ödeme: defter davranışı (D-8) ═══════════════


async def test_tamamen_tedarikciden_karsilanan_siparis_deftere_yazmaz(
    http, fab5, sfab
):
    """S5'in birinci yarısı: sipariş İADE EDİLMEMELİ."""
    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=0)
    sfab.product_ids.append(pid)
    await _temin_ac(sfab, pid, stok="5")

    veri = await fab5.siparis_ver(http, m, items=[(pid, 2)], beklenen_durum=201)

    durum, odeme = await _siparis_durumu(veri["id"])
    assert odeme == "PAID", f"tedarikçili sipariş iade edilmiş: {durum}/{odeme}"
    assert durum != "CANCELLED"

    assert await fab5.hareketler(pid, movement_type="SALE") == [], (
        "rafımızda olmayan mal için SALE hareketi yazılmış (D-8)"
    )
    assert await sfab.stok(pid) == 0, "raf stoğu eksiye itilmemeli"

    kalem = await _kalem(veri["id"])
    assert kalem["supplier_quantity"] == 2


async def test_karisik_karsilamada_yalniz_kendi_payi_deftere_yazilir(
    http, fab5, sfab
):
    """Rafta 1, tedarikçide bol, sipariş 3 → deftere yalnız −1 yazılır."""
    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=1)
    sfab.product_ids.append(pid)
    await _temin_ac(sfab, pid, stok="9")

    veri = await fab5.siparis_ver(http, m, items=[(pid, 3)], beklenen_durum=201)

    hareketler = await fab5.hareketler(pid, movement_type="SALE")
    assert len(hareketler) == 1
    assert await sfab.stok(pid) == 0

    kalem = await _kalem(veri["id"])
    assert kalem["quantity"] == 3
    assert kalem["supplier_quantity"] == 2, "3 − 1 (raf) = 2 tedarikçiden"


async def test_tamamen_raftan_karsilanan_siparis_degismez(http, fab5, sfab):
    """Regresyon kapısı: tedarikçi katmanı mevcut davranışa dokunmamalı."""
    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=5)
    sfab.product_ids.append(pid)
    await _temin_ac(sfab, pid, stok="9")

    veri = await fab5.siparis_ver(http, m, items=[(pid, 2)], beklenen_durum=201)

    assert len(await fab5.hareketler(pid, movement_type="SALE")) == 1
    assert await sfab.stok(pid) == 3
    assert (await _kalem(veri["id"]))["supplier_quantity"] == 0


async def test_temin_kapali_urunde_eski_oversell_yolu_calisir(http, fab5, sfab):
    """Tedarikçi bağı olsa bile `supplier_backed` kapalıysa hiçbir şey değişmez;
    stok yetmezse sipariş ucu reddeder."""
    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=1)
    sfab.product_ids.append(pid)
    sid = await sfab.tedarikci()
    await sfab.tedarikci_urunu(
        sid, product_id=pid, link_source="AUTO", stock_qty="50"
    )
    # supplier_backed AÇILMADI.

    r = await http.post(
        "/api/v1/store/cart/validate",
        json={"items": [{"product_id": pid, "quantity": 3}]},
        headers=m.headers,
    )
    assert r.json()["issues"]


# ═══════════════ İptal: geri yükleme tavanı (S6) ═══════════════


async def test_tamamen_tedarikciden_karsilanan_siparis_iptalinde_stok_artmaz(
    http, fab5, sfab
):
    """S6'nın hedefi. Hiç satılmamış mal rafa EKLENEMEZ."""
    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=0)
    sfab.product_ids.append(pid)
    await _temin_ac(sfab, pid, stok="5")

    veri = await fab5.siparis_ver(http, m, items=[(pid, 2)], beklenen_durum=201)
    r = await http.post(
        f"/api/v1/store/orders/{veri['id']}/cancel", headers=m.headers
    )
    assert r.status_code in (200, 204), r.text

    assert await sfab.stok(pid) == 0, (
        "tedarikçiden karşılanan iptal, raf stoğunu HAYALİ olarak artırdı"
    )
    assert await fab5.hareketler(pid, movement_type="SALE_CANCEL") == []


async def test_karisik_siparis_iptalinde_yalniz_kendi_payi_geri_doner(
    http, fab5, sfab
):
    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=1)
    sfab.product_ids.append(pid)
    await _temin_ac(sfab, pid, stok="9")

    veri = await fab5.siparis_ver(http, m, items=[(pid, 3)], beklenen_durum=201)
    assert await sfab.stok(pid) == 0

    r = await http.post(
        f"/api/v1/store/orders/{veri['id']}/cancel", headers=m.headers
    )
    assert r.status_code in (200, 204), r.text

    assert await sfab.stok(pid) == 1, "yalnız raftan çıkan 1 adet geri dönmeli"
    hareketler = await fab5.hareketler(pid, movement_type="SALE_CANCEL")
    assert len(hareketler) == 1


# ═══════════════ Yarış: ödeme anında tedarikçi kapanırsa ═══════════════


async def test_odeme_aninda_temin_kapanirsa_mevcut_iade_yolu_calisir(
    http, fab5, sfab, monkeypatch
):
    """Sepet doğrulaması ile ödeme arasında yönetici tedarikçiyi kapatabilir.
    Bu, klasik oversell penceresidir ve MEVCUT `_out_of_stock_refund` yolundan
    geçmelidir — yeni bir hata dalı icat edilmemeli."""
    from core import payments
    from core.payments.fake import FakePaymentProvider

    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=0)
    sfab.product_ids.append(pid)
    spid = await _temin_ac(sfab, pid, stok="5")

    class TeminKapatanSaglayici(FakePaymentProvider):
        async def charge(self, **kwargs):
            # Ayrı bağlantı → çağıranın transaction'ından bağımsız commit.
            async with AsyncSessionLocal() as s:
                await s.execute(
                    text("UPDATE supplier_products SET stock_qty = 0 WHERE id = :i"),
                    {"i": spid},
                )
                await s.commit()
            return await super().charge(**kwargs)

    monkeypatch.setattr(payments, "get_payment_provider", lambda: TeminKapatanSaglayici())

    veri = await fab5.siparis_ver(http, m, items=[(pid, 2)], beklenen_durum=201)

    durum, odeme = await _siparis_durumu(veri["id"])
    assert (durum, odeme) == ("CANCELLED", "REFUNDED"), (
        f"oversell penceresi mevcut iade yolundan geçmedi: {durum}/{odeme}"
    )
    # Hiç satılmamış mal için hareket yazılmamalı (TB-15(a) kuralı).
    assert await fab5.hareketler(pid) == []
    assert await sfab.stok(pid) == 0
