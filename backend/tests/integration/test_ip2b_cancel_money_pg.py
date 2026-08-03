"""İP-2b — ödenmiş sipariş iptali: refund intent, sağlayıcı başarısızlığı ve
reconciler telafisi (GERÇEK PostgreSQL, gerçek servis katmanı).

Sözleşme: docs/ip2b-siparis-iptal-telafi-sozlesme.md §6

Doğrulanmış üretim kusuru (bu dosyanın kırmızıları):
`escrow_reconciler.reconcile_refunding` mağaza siparişi için yalnız
`escrow.perform_refund/finalize_refund` çağırır — `order_service._refund_payment`
İÇİNDEKİ telafiler (`_restock`, `coupon_service.release`, CANCELLED geçişi,
müşteri bildirimi) reconciler yolunda HİÇ koşmaz. `order_service.py:1364-1366`
yorumu ("reconciler ... bu fonksiyonu tekrar çağırdığında") kodla çelişir.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import escrow_reconciler, order_service

pytestmark = pytest.mark.asyncio


async def _iptal(oid: int):
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        return await order_service.cancel_by_client(s, order)


async def _refunding_bayatlat(oid: int) -> None:
    """Reconciler karantina penceresini (REFUND_RECONCILE_MIN_AGE_MINUTES)
    geçmiş gibi damgalar — bekleme yerine deterministik yaş."""
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE orders SET refund_requested_at = "
                "now() - interval '2 hours' WHERE id = :o"
            ),
            {"o": oid},
        )
        await s.commit()


async def _kur(fab, *, kuponlu: bool = True):
    pid = await fab.urun(stock=10)
    cid = await fab.musteri()
    kupon = await fab.kupon(value="50.00") if kuponlu else None
    oid, _ = await fab.siparis(
        items=[(pid, 3, "PHYSICAL", "100.00")],
        client_id=cid,
        coupon=kupon,
        discount="50.00" if kuponlu else "0",
    )
    if kupon:
        await fab.kupon_kullanimi(coupon_id=kupon[0], client_id=cid, order_id=oid)
    return pid, cid, kupon, oid


# ── Yeşil: intent doğru kurulur, başarısızlıkta yalan söylenmez ─────────────────


async def test_yesil_saglayici_reddi_refunding_dogru(fab, provider):
    """Sağlayıcı reddederse: 502; sipariş 'iade edildi' GÖSTERİLMEZ
    (payment=REFUNDING, status=PAID); stok ARTMAZ; kupon AÇILMAZ; niyet damgası
    (refund_requested_at + attempts) kalıcıdır; müşteri bildirimi atılmaz."""
    pid, cid, kupon, oid = await _kur(fab)
    provider.refund_result = False

    with pytest.raises(HTTPException) as exc:
        await _iptal(oid)
    assert exc.value.status_code == 502
    assert len(provider.refund_calls) == 1

    assert await fab.siparis_durumu(oid) == ("PAID", "REFUNDING")
    assert await fab.hareketler(pid, "SALE_CANCEL") == []
    assert await fab.stok(pid) == 7  # 10 - 3 satış; telafi YOK (para dönmedi)
    assert await fab.kupon_durumu(kupon[0]) == (1, 1)
    assert await fab.bildirim_sayisi(cid, icerik="iptal edildi") == 0
    async with AsyncSessionLocal() as s:
        row = (
            await s.execute(
                text(
                    "SELECT refund_attempts, refund_requested_at IS NOT NULL "
                    "FROM orders WHERE id = :o"
                ),
                {"o": oid},
            )
        ).one()
    assert row[0] == 1 and row[1] is True


# ── Kırmızı: reconciler telafi boşluğu ──────────────────────────────────────────


async def test_kirmizi_reconciler_stok_ve_kupon_telafisi(fab, provider):
    """[IP2B-R6] Sağlayıcı ilk denemede düştü, reconciler iadeyi tamamladı →
    payment REFUNDED olur. Sözleşme: stok telafisi (SALE_CANCEL) ve kupon
    serbest bırakma da AYNI kesinlikle uygulanmalıdır; iade edilen paranın malı
    rafta sayılmalı, kupon kotası geri açılmalıdır.

    Bugün reconciler yalnız escrow katmanını çağırır: para döner, stok/kupon
    telafisi SONSUZA DEK kaybolur (elle tetiklenecek başka yol da yoktur —
    payment artık PAID olmadığından cancel/refund uçları 409 verir).
    """
    pid, _cid, kupon, oid = await _kur(fab)
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _iptal(oid)
    assert await fab.siparis_durumu(oid) == ("PAID", "REFUNDING")

    provider.refund_result = True
    await _refunding_bayatlat(oid)
    async with AsyncSessionLocal() as s:
        await escrow_reconciler.reconcile_refunding(s)

    # Para gerçekten döndü (reconciler retry sağlayıcıyı çağırdı ve finalize etti).
    assert len(provider.refund_calls) == 2
    _durum, payment = await fab.siparis_durumu(oid)
    assert payment == "REFUNDED"

    # Sözleşme: telafi de tamamlanmalı. (Bugün ikisi de KAYIP → kırmızı.)
    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 3)], (
        "para iade edildi ama stok defterine SALE_CANCEL yazılmadı — "
        "3 kitap kalıcı olarak 'satılmış' görünüyor"
    )
    assert await fab.kupon_durumu(kupon[0]) == (0, 0), (
        "para iade edildi ama kupon kullanımı geri açılmadı"
    )


async def test_kirmizi_reconciler_sonrasi_durum_ve_bildirim(fab, provider):
    """[IP2B-R7] Reconciler'ın tamamladığı iadede sipariş yaşam döngüsü de
    sonuçlanmalı: sipariş PAID'de asılı KALMAMALI (CANCELLED'a geçmeli, geçmiş
    satırı yazılmalı) ve müşteri iadeden haberdar edilmeli.

    Bugün: order.status=PAID + payment_status=REFUNDED kalır (panelde 'ödenmiş
    açık sipariş' görünür, geçmişe hiçbir satır düşmez), bildirim/e-posta gitmez.
    """
    _pid, cid, _kupon, oid = await _kur(fab)
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _iptal(oid)

    provider.refund_result = True
    await _refunding_bayatlat(oid)
    async with AsyncSessionLocal() as s:
        await escrow_reconciler.reconcile_refunding(s)

    durum, payment = await fab.siparis_durumu(oid)
    assert payment == "REFUNDED"
    assert durum == "CANCELLED", (
        f"iade tamamlandı ama sipariş '{durum}' durumunda asılı kaldı"
    )
    assert any(h[1] == "CANCELLED" for h in await fab.history(oid)), (
        "durum geçmişine CANCELLED satırı yazılmadı"
    )
    assert await fab.bildirim_sayisi(cid, icerik="iade") >= 1, (
        "iade tamamlandı ama müşteriye hiçbir bildirim üretilmedi"
    )


async def test_kirmizi_502_sonrasi_retry_telafisiz_iptal(fab, provider):
    """[IP2B-R8] 502 sonrası müşteri iptali TEKRAR dener: bugün ikinci deneme
    `payment_status != PAID` olduğundan telafi bloğunu atlayıp siparişi
    CANCELLED'a geçirir — müşteriye 'iptal edildi' denir, ama stok telafisi
    hiçbir yolda kalmaz (reconciler da yazmaz → IP2B-R6).

    Sözleşme: iptal hangi sırayla tamamlanırsa tamamlansın, iade kesinleştiğinde
    stok telafisi TAM ve TEK olmalıdır.
    """
    pid, _cid, _kupon, oid = await _kur(fab, kuponlu=False)
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _iptal(oid)

    # Müşteri sayfayı yenileyip yeniden iptal etti — bugün 200 döner.
    await _iptal(oid)
    assert (await fab.siparis_durumu(oid))[0] == "CANCELLED"

    # İade sonunda reconciler'la kesinleşir...
    provider.refund_result = True
    await _refunding_bayatlat(oid)
    async with AsyncSessionLocal() as s:
        await escrow_reconciler.reconcile_refunding(s)
    assert (await fab.siparis_durumu(oid))[1] == "REFUNDED"

    # ...ama stok telafisi hiçbir aşamada yazılmadı → kırmızı.
    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 3)], (
        "sipariş CANCELLED + payment REFUNDED, fakat SALE_CANCEL yok: "
        "stok kalıcı olarak eksik"
    )


async def test_kirmizi_tam_iade_refunded_amount_gunceller(fab, provider):
    """[IP2B-R9] Tam iptal iadesi `orders.refunded_amount`'a yazılmalı: ciro
    raporu (`revenue_service`) iade sütununu bu kolondan okur ve kısmi-iade
    tavanı (`remaining_refundable`) bu kolona bakar. Bugün yalnız RMA yolu
    yazar; tam iptal/iade iadeleri raporda 0 TL görünür."""
    pid, _cid, _kupon, oid = await _kur(fab, kuponlu=False)

    await _iptal(oid)
    assert (await fab.siparis_durumu(oid)) == ("CANCELLED", "REFUNDED")
    assert len(provider.refund_calls) == 1

    async with AsyncSessionLocal() as s:
        tutar = (
            await s.execute(
                text("SELECT COALESCE(refunded_amount, 0) FROM orders WHERE id = :o"),
                {"o": oid},
            )
        ).scalar_one()
    assert str(tutar) == "300.00", (
        f"tam iade sağlayıcıda kesinleşti ama refunded_amount={tutar} — "
        "ciro raporu bu iadeyi görmeyecek"
    )
