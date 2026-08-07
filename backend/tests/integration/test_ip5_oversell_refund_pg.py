"""İP-5 · O-1…O-4 — TB-15(a): oversell iadesi merkezi para sözleşmesinde.

Borç kaydı (`docs/teknik-borc.md` TB-15(a)): `_out_of_stock_refund` İP-2a'nın
üç bileşenini de atlıyor — `reserve_refund` (tavan kapısı), `apply_refunded_
amount` (tek yazıcı, M6) ve `settle_refunded_order` (ortak telafi kancası).
Sonuçları:

1. Mutlu yolda bile `orders.refunded_amount` **0 kalır** → `revenue_service`
   iade sütununu bu kolondan okuduğu için oversell iadeleri ciroda görünmez.
2. `refund_reserved` hiç artmaz.
3. Sağlayıcı düşerse sipariş REFUNDING'de kalır; reconciler onu **Order**
   olarak devralıp `settle_refunded_order` → `_restock` çalıştırır. Oysa bu
   yolda sipariş hiç PAID olmamış, `SALE` hareketi hiç yazılmamıştır →
   **hiç satılmamış mal için SALE_CANCEL** (hayali stok artışı).

## Yarış penceresi nasıl DETERMİNİSTİK kuruluyor

Gerçek yol şudur: `create_order` → `_charge` → `provider.charge()` →
`_finalize_paid` → stok kilitli kontrol. Oversell tam olarak "para alındı,
sonra stok yetmedi" penceresidir.

Test bu pencereyi taklit etmez, **gerçekten açar**: sağlayıcının `charge`
çağrısı sırasında (yani ödeme alınırken) stok AYRI bir bağlantıdan düşürülür.
`_finalize_paid` kilit altında okuduğunda eksiği görür ve gerçek oversell
dalına girer. `asyncio.sleep` ile zamanlamaya bahis oynanmaz.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.payments.fake import FakePaymentProvider
from services import escrow_reconciler

pytestmark = pytest.mark.asyncio

D = Decimal


class StokYiyenSaglayici(FakePaymentProvider):
    """Ödeme anında stoğu tüketen sağlayıcı — oversell penceresini açar.

    `refund_result=False` verilirse iade sağlayıcıda düşer ve sipariş
    REFUNDING'de kalır (reconciler senaryosu, O-4).
    """

    def __init__(self, *, product_id: int, hedef_stok: int = 0) -> None:
        self.product_id = product_id
        self.hedef_stok = hedef_stok
        self.refund_result = True
        self.refund_calls: list[tuple[str | None, Decimal]] = []

    async def charge(self, **kwargs):
        # AYRI bağlantı: çağıranın transaction'ından bağımsız COMMIT eder,
        # tıpkı eşzamanlı ikinci bir müşterinin ödemesi gibi.
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE products SET stock = :st WHERE id = :i"),
                {"st": self.hedef_stok, "i": self.product_id},
            )
            await s.commit()
        return await super().charge(**kwargs)

    async def refund(self, *, provider_ref: str | None, amount: Decimal) -> bool:
        self.refund_calls.append((provider_ref, D(str(amount))))
        return self.refund_result


async def _oversell_siparisi(http, fab5, monkeypatch, *, refund_ok: bool = True):
    """Gerçek uçtan oversell'e düşen sipariş kurar; (order_id, product_id, sağlayıcı)."""
    from core import payments

    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=5)

    saglayici = StokYiyenSaglayici(product_id=pid, hedef_stok=0)
    saglayici.refund_result = refund_ok
    monkeypatch.setattr(payments, "get_payment_provider", lambda: saglayici)

    # Ön kontrol (kilitsiz) stoğu YETERLİ görür; sağlayıcı charge sırasında
    # stoğu sıfırlar; `_finalize_paid` kilit altında eksiği görür.
    veri = await fab5.siparis_ver(http, m, items=[(pid, 2)], beklenen_durum=201)
    return veri["id"], pid, saglayici


async def _sale_hareketleri(fab5, pid: int) -> list[tuple]:
    return await fab5.hareketler(pid, movement_type="SALE")


async def _sale_cancel_hareketleri(fab5, pid: int) -> list[tuple]:
    return await fab5.hareketler(pid, movement_type="SALE_CANCEL")


# ── O-1 · Merkezi hattan geçiyor ────────────────────────────────────────────


async def test_o1_oversell_iadesi_merkezi_hattan_geciyor(http, fab5, monkeypatch):
    """`reserve_refund` → `perform_refund` → `settle_refunded_order`.

    Gözlemlenebilir kanıt: iade tavanı REZERVE edilmiş (`refund_reserved`
    dolu) ve iade tutarı TEK YAZICI üzerinden yazılmış (`refunded_amount`
    dolu, `refunded_at` damgalı). Bugün ikisi de 0/NULL kalıyor.
    """
    order_id, pid, saglayici = await _oversell_siparisi(http, fab5, monkeypatch)
    satir = await fab5.siparis_satiri(order_id)

    assert satir["status"] == "CANCELLED", satir
    assert saglayici.refund_calls, "sağlayıcıya iade çağrısı hiç gitmedi"
    assert satir["refund_reserved"] > 0, (
        "iade tavanı rezerve edilmemiş — merkezi kapı atlanmış"
    )
    assert satir["refunded_at"] is not None, "refunded_at damgalanmamış"


async def test_o2_refunded_amount_doluyor(http, fab5, monkeypatch):
    """TB-15(a)/1: bugün 0 kalıyor ve oversell iadeleri ciroda görünmüyor."""
    order_id, _pid, _s = await _oversell_siparisi(http, fab5, monkeypatch)
    satir = await fab5.siparis_satiri(order_id)

    async with AsyncSessionLocal() as s:
        total = D(
            str(
                (
                    await s.execute(
                        text("SELECT total FROM orders WHERE id = :i"),
                        {"i": order_id},
                    )
                ).scalar_one()
            )
        )
    assert satir["refunded_amount"] == total, (
        f"refunded_amount={satir['refunded_amount']} ≠ total={total}"
    )


# ── O-3 · Hiç PAID olmamış siparişe SALE_CANCEL YAZILMIYOR ──────────────────


async def test_o3_satilmamis_mala_sale_cancel_yazilmiyor(http, fab5, monkeypatch):
    """Bu yolda SALE hiç yazılmadı; SALE_CANCEL hayali stok artışı olurdu.

    Tavan kontrolü bunu engellemez: `restored_quantity_by_order_item` yalnız
    SALE_CANCEL/RETURN sayar; satılan 0 iken tavan tam adedi verir.
    """
    order_id, pid, _s = await _oversell_siparisi(http, fab5, monkeypatch)

    assert await _sale_hareketleri(fab5, pid) == [], "bu yolda SALE olmamalıydı"
    assert await _sale_cancel_hareketleri(fab5, pid) == [], (
        "hiç satılmamış mal için SALE_CANCEL yazılmış (hayali stok artışı)"
    )
    assert await fab5.stok(pid) == 0, "stok hayali biçimde artmış"
    assert order_id  # kullanılmayan değişken uyarısı değil, sipariş kuruldu


# ── O-4 · Sağlayıcı düştü → reconciler devralıyor, O-3 hâlâ geçerli ─────────


async def test_o4_reconciler_devralinca_da_sale_cancel_yok(
    http, fab5, monkeypatch
):
    """Sağlayıcı ilk denemede düşer → REFUNDING; reconciler tamamlar.

    TB-15(a)/3'ün tam senaryosu. Reconciler'ın `Order` dalı koşulsuz
    `settle_refunded_order` çağırır; telafi kancasına "SALE yazılmamışsa
    restock yok" koşulu eklenmedikçe burada SALE_CANCEL doğar.
    """
    order_id, pid, saglayici = await _oversell_siparisi(
        http, fab5, monkeypatch, refund_ok=False
    )

    satir = await fab5.siparis_satiri(order_id)
    assert satir["payment_status"] == "REFUNDING", satir

    # Karantina penceresinin gerisine taşı (reconciler taze kayda dokunmaz).
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE orders SET refund_requested_at = "
                "now() - make_interval(hours => 2) WHERE id = :i"
            ),
            {"i": order_id},
        )
        await s.commit()

    saglayici.refund_result = True
    async with AsyncSessionLocal() as s:
        islenen = await escrow_reconciler.reconcile_refunding(s)
    assert islenen >= 1, "reconciler sarkan iadeyi devralmadı"

    sonra = await fab5.siparis_satiri(order_id)
    assert sonra["payment_status"] == "REFUNDED", sonra
    assert sonra["refunded_amount"] > 0, "reconciler yolunda iade tutarı yazılmadı"
    assert await _sale_cancel_hareketleri(fab5, pid) == [], (
        "reconciler hiç satılmamış mal için SALE_CANCEL yazdı"
    )
    assert await fab5.stok(pid) == 0


async def test_o4b_gercek_satista_restock_hala_calisiyor(http, fab5, monkeypatch):
    """Nöbetçi: "SALE yazılmamışsa restock yok" koşulu MEVCUT yolu bozmamalı.

    PAID olmuş (SALE yazılmış) bir siparişin iptalinde stok GERİ DÖNMEYE
    devam etmeli. Bu test olmadan O-3'ün düzeltmesi, sessizce bütün iptal
    yolunun stok geri yüklemesini kapatabilirdi.
    """
    from services import order_service

    m = await fab5.musteri()
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=10)
    o = await fab5.siparis_ver(http, m, items=[(pid, 3)])

    assert await _sale_hareketleri(fab5, pid), "PAID yolunda SALE yazılmalıydı"
    assert await fab5.stok(pid) == 7

    _, ah = await fab5.admin(izinler=["orders.view", "orders.manage"])
    r = await http.post(
        f"/api/v1/store/admin/orders/{o['id']}/refund",
        headers=ah,
        json={"reason": "IP5 restock nöbetçisi"},
    )
    assert r.status_code == 200, r.text

    assert await _sale_cancel_hareketleri(fab5, pid), (
        "gerçek satışın iptalinde SALE_CANCEL yazılmadı — restock kapanmış"
    )
    assert await fab5.stok(pid) == 10
    assert order_service  # modül gerçekten yüklendi (import nöbetçisi)
