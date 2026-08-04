"""İP-2b — iptalde stok defteri ve kupon telafisi (GERÇEK PostgreSQL).

Sözleşme: docs/ip2b-siparis-iptal-telafi-sozlesme.md §4-§5

Yeşiller mevcut doğru davranışı çiviler (idempotent SALE_CANCEL, dijital ürün
hareketsizliği, kupon kotasının tam iptalde geri açılması). Kırmızı,
`coupon_service.release`'in koşulsuz `used_count--` yapmasının ürettiği sayaç
sızıntısını ölçer: kullanım SAYILAMAMIŞ (redeem False) bir siparişin iptali,
BAŞKA siparişin kullanımını serbest bırakır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import coupon_service, order_service

pytestmark = pytest.mark.asyncio


async def _iptal(oid: int):
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        return await order_service.cancel_by_client(s, order)


# ── Stok telafisi ───────────────────────────────────────────────────────────────


async def test_yesil_odenmemis_iptal_stok_hareketsiz(fab, provider):
    """PENDING iptal: SALE hiç yazılmamıştı → SALE_CANCEL de yazılmaz; defter
    yalnız açılış hareketini içerir; kupon kotasına dokunulmaz."""
    pid = await fab.urun(stock=5)
    kupon = await fab.kupon(value="10.00", used_count=0)
    oid, _ = await fab.siparis(
        items=[(pid, 2, "PHYSICAL", "100.00")],
        status="PENDING", payment_status="PENDING",
        coupon=kupon, discount="10.00",
    )
    await _iptal(oid)
    assert await fab.hareketler(pid) == [("INITIAL", 5)]
    assert await fab.stok(pid) == 5
    assert await fab.kupon_durumu(kupon[0]) == (0, 0)


async def test_yesil_karisik_sepette_dijital_kalem_hareketsiz(fab, provider):
    """Fiziksel + dijital karışık sepetin iptali: SALE_CANCEL yalnız fiziksel
    kaleme yazılır; dijital ürün stok defterine hiç girmez."""
    fiz = await fab.urun(stock=6)
    dij = await fab.urun(kind="DIGITAL", stock=None, price="40.00")
    oid, _ = await fab.siparis(
        items=[(fiz, 2, "PHYSICAL", "100.00"), (dij, 1, "DIGITAL", "40.00")],
    )
    await _iptal(oid)

    assert await fab.hareketler(fiz, "SALE_CANCEL") == [("SALE_CANCEL", 2)]
    assert await fab.stok(fiz) == 6
    assert await fab.hareketler(dij) == []  # dijital: ne INITIAL ne SALE(_CANCEL)
    assert len(provider.refund_calls) == 1  # 240 TL tek iade


async def test_yesil_iki_worker_ayni_stok_telafisi_tek_hareket(fab, provider):
    """'İki worker aynı telafiyi uyguluyor' — `_restock` aynı sipariş için iki
    ayrı session'dan koşsa da idempotency anahtarı (`order_item:{id}:SALE_CANCEL`)
    ve tavan (`satılan − geri yüklenen`) ikinci yazımı engeller; stok satılandan
    fazla ARTAMAZ."""
    pid = await fab.urun(stock=9)
    oid, _ = await fab.siparis(items=[(pid, 4, "PHYSICAL", "100.00")])
    assert await fab.stok(pid) == 5

    for _ in range(2):
        async with AsyncSessionLocal() as s:
            order = await order_service._load_full(s, oid)
            await order_service._restock(s, order, reason_code="ORDER_CANCELLED")
            await s.commit()

    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 4)]
    assert await fab.stok(pid) == 9  # 5 + 4; 13 DEĞİL


# ── Kupon telafisi ──────────────────────────────────────────────────────────────


async def test_yesil_iptal_kupon_kotasini_geri_acar(fab, provider):
    """Politika çivisi (§5.1): tam iptal kupon kullanımını geri açar —
    used_count azalır, redemption satırı silinir ve kupon (tek kullanımlıysa)
    YENİDEN kullanılabilir hâle gelir (`evaluate` geçer)."""
    pid = await fab.urun(stock=5)
    cid = await fab.musteri()
    kupon = await fab.kupon(value="30.00", max_uses=1, per_user_limit=1)
    oid, _ = await fab.siparis(
        items=[(pid, 1, "PHYSICAL", "100.00")],
        client_id=cid, coupon=kupon, discount="30.00",
    )
    await fab.kupon_kullanimi(coupon_id=kupon[0], client_id=cid, order_id=oid)

    # İptal öncesi: limit dolu — başka müşteri kullanamaz.
    baska = await fab.musteri()
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await coupon_service.evaluate(
                s, code=kupon[1], subtotal=Decimal("100"),
                client_id=baska,
            )
        assert exc.value.status_code == 409

    await _iptal(oid)
    assert await fab.kupon_durumu(kupon[0]) == (0, 0)
    async with AsyncSessionLocal() as s:
        c, indirim = await coupon_service.evaluate(
            s, code=kupon[1], subtotal=Decimal("100"),
            client_id=baska,
        )
        assert c.id == kupon[0] and str(indirim) == "30.00"


async def test_yesil_suresi_dolmus_kupon_iptalde(fab, provider):
    """Politika çivisi (§5.3): süresi DOLMUŞ kuponlu siparişin iptali kota geri
    açar (release tarih kontrolü yapmaz) ama kupon yeniden KULLANILAMAZ
    (`evaluate` 409 'süresi dolmuş'). Bu davranış değişecekse bilinçli karar +
    bu testin güncellenmesi gerekir."""
    pid = await fab.urun(stock=5)
    cid = await fab.musteri()
    kupon = await fab.kupon(
        value="20.00",
        valid_until=datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(hours=1),
    )
    oid, _ = await fab.siparis(
        items=[(pid, 1, "PHYSICAL", "100.00")],
        client_id=cid, coupon=kupon, discount="20.00",
    )
    await fab.kupon_kullanimi(coupon_id=kupon[0], client_id=cid, order_id=oid)
    # Kuponun süresi iptalden ÖNCE doldu.
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE coupons SET valid_until = now() - interval '1 day' WHERE id = :c"),
            {"c": kupon[0]},
        )
        await s.commit()

    await _iptal(oid)
    assert await fab.kupon_durumu(kupon[0]) == (0, 0)
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await coupon_service.evaluate(
                s, code=kupon[1], subtotal=Decimal("100"),
                client_id=cid,
            )
        assert exc.value.status_code == 409
        assert "süresi dolmuş" in str(exc.value.detail).lower()


async def test_kirmizi_sayilamamis_kupon_iptalde_sayaci_dusuremez(fab, provider):
    """[IP2B-R12] `redeem` limit dolu diye False döndüğünde sipariş `coupon_id`
    izini taşımaya devam eder (`_finalize_paid` yalnız log yazar). Bu siparişin
    iptali `release`'i çağırır ve `release` redemption satırı OLMASA BİLE
    koşulsuz `used_count--` yapar → BAŞKA siparişin saydığı kullanım serbest
    kalır; sayaç ile redemption satırları kalıcı ayrışır; max_uses=1 kampanya
    kuponu fiilen 2 kez kullanılabilir olur.

    Sözleşme: iptal, yalnız KENDİ siparişinin saydığı kullanımı geri açabilir
    (redemption satırı yoksa sayaç düşürülmez)."""
    pid = await fab.urun(stock=6)
    a_client = await fab.musteri()
    b_client = await fab.musteri()
    kupon = await fab.kupon(value="25.00", max_uses=1)

    # A siparişi kuponu gerçekten saydı (redemption satırı A'ya ait).
    a_oid, _ = await fab.siparis(
        items=[(pid, 1, "PHYSICAL", "100.00")],
        client_id=a_client, coupon=kupon, discount="25.00",
    )
    await fab.kupon_kullanimi(coupon_id=kupon[0], client_id=a_client, order_id=a_oid)

    # B siparişi: indirim uygulanmış ama redeem LİMİTTE kaldı → satır YOK,
    # coupon_id siparişte duruyor (üretimdeki redeem-False sonucu).
    b_oid, _ = await fab.siparis(
        items=[(pid, 1, "PHYSICAL", "100.00")],
        client_id=b_client, coupon=kupon, discount="25.00",
    )
    assert await fab.kupon_durumu(kupon[0]) == (1, 1)

    # B iptal edilir — B'nin sayılmamış kullanımı sayaçtan DÜŞMEMELİ.
    await _iptal(b_oid)

    uc, satir = await fab.kupon_durumu(kupon[0])
    assert satir == 1, "A'nın redemption satırı silinmemeliydi"
    assert uc == 1, (
        f"sayaç sızıntısı: used_count={uc} — B'nin hiç saymadığı kullanım geri "
        "açıldı, A'nın kullanımı fiilen serbest kaldı (max_uses aşılabilir)"
    )
