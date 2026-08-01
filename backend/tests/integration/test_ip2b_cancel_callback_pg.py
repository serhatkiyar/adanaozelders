"""İP-2b — sipariş iptali ↔ ödeme callback'i etkileşimi (GERÇEK PostgreSQL).

Sözleşme: docs/ip2b-siparis-iptal-telafi-sozlesme.md §6.3

Doğrulanmış kusur (kırmızıların kökü): `order_service.complete_checkout`
sipariş yaşam döngüsüne (`order.status`) hiç bakmaz. CANCELLED siparişin
doğrulanmış tahsilatı `_finalize_paid`'e girer, atomik PAID claim'i başarılı
olur, ardından FSM `CANCELLED→PAID` geçişini 409 ile reddeder → istisna
callback/reconciler katmanında YAKALANMAZ: para tahsil edilmiş, iade YOK,
kayıt sonsuza dek PENDING. Diğer üç ödeme yüzeyinde (ör.
`library_exam_service`) bu senaryo açıkça 'ölü varlık → otomatik iade' olarak
ele alınmıştır; mağaza yolunda eşdeğeri yoktur.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.payments.base import CheckoutResult
from services import escrow_reconciler, order_service
from tests.integration.conftest import StubProvider

pytestmark = pytest.mark.asyncio


async def _iptal(oid: int):
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        return await order_service.cancel_by_client(s, order)


class CheckoutSaglayici(StubProvider):
    """`retrieve_checkout` destekli stub — reconciler bayat-checkout taraması
    yalnız bu yeteneği olan sağlayıcıda çalışır (iyzico'nun test ikizi)."""

    def __init__(self) -> None:
        super().__init__()
        self.checkouts: dict[str, CheckoutResult] = {}
        self.retrieve_tokens: list[str] = []

    async def retrieve_checkout(self, *, token: str) -> CheckoutResult:
        self.retrieve_tokens.append(token)
        return self.checkouts.get(token, CheckoutResult(success=False))


@pytest.fixture
def checkout_provider(monkeypatch) -> CheckoutSaglayici:
    stub = CheckoutSaglayici()
    from core import payments

    monkeypatch.setattr(payments, "get_payment_provider", lambda: stub)
    return stub


# ── Kırmızı: iptal edilen siparişin doğrulanmış tahsilatı ───────────────────────


async def test_kirmizi_iptal_edilen_siparise_gec_callback_iade(fab, provider):
    """[IP2B-R10] Müşteri iyzico sayfasındayken siparişi iptal etti; ödeme yine
    de doğrulandı. Sözleşme (deneme bileti emsali): tahsilat varlığa
    bağlanamıyorsa OTOMATİK iade edilir; sipariş CANCELLED kalır, ödeme kaydı
    askıda kalmaz.

    Bugün: `transition_order` 409 fırlatır, callback 500/409 olur, para NE
    siparişe bağlanır NE iade edilir."""
    pid = await fab.urun(stock=5)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(
        items=[(pid, 2, "PHYSICAL", "100.00")],
        client_id=cid, status="PENDING", payment_status="PENDING",
        provider_ref="ip2b-cf-token-1",
    )
    await _iptal(oid)
    assert (await fab.siparis_durumu(oid))[0] == "CANCELLED"

    hata: HTTPException | None = None
    try:
        async with AsyncSessionLocal() as s:
            await order_service.complete_checkout(
                s, order_id=oid, success=True,
                provider_ref="ip2b-pay-1", token="ip2b-cf-token-1",
                paid_price=Decimal("200.00"),
            )
    except HTTPException as exc:
        hata = exc

    assert hata is None, (
        f"iptal edilmiş siparişin doğrulanmış tahsilatı {hata.status_code} "
        f"({hata.detail!r}) ile patladı — para askıda"
    )
    assert len(provider.refund_calls) == 1, (
        "tahsilat ölü siparişe bağlanamazken sağlayıcı iadesi de yapılmadı — "
        "müşterinin parası sessizce kayıp"
    )
    durum, payment = await fab.siparis_durumu(oid)
    assert durum == "CANCELLED"
    assert payment != "PAID", "iptal edilmiş sipariş sonradan ödenmiş gösterildi"
    # Stok/kupon yan etkisi uygulanmamalı: SALE hareketi yazılmamalı.
    assert await fab.hareketler(pid, "SALE") == []


async def test_kirmizi_reconciler_partisi_zehirlenmez(fab, checkout_provider):
    """[IP2B-R11] Bayat-checkout taramasında iptal edilmiş sipariş 409 fırlatınca
    döngü ORADA ölür: partideki SONRAKİ meşru siparişler o turda (ve iptal kaydı
    durdukça hiçbir turda) işlenmez — kayıp callback'li gerçek müşteri sonsuza
    dek PENDING kalır.

    Sözleşme: bir kaydın hatası diğer kayıtların mutabakatını engellememeli
    (reconciler docstring'i 'her kayıt kendi commit'iyle' der — sipariş dalında
    per-kayıt hata izolasyonu yoktur)."""
    pid = await fab.urun(stock=6)
    cid1 = await fab.musteri()
    cid2 = await fab.musteri()
    # 1) İptal edilmiş ama sağlayıcıda ödenmiş görünecek sipariş (küçük id önce).
    oid_iptal, _ = await fab.siparis(
        items=[(pid, 1, "PHYSICAL", "100.00")],
        client_id=cid1, status="PENDING", payment_status="PENDING",
        provider_ref="ip2b-tok-iptal",
    )
    await _iptal(oid_iptal)
    # 2) Sağlıklı kayıp-callback siparişi.
    oid_saglikli, _ = await fab.siparis(
        items=[(pid, 1, "PHYSICAL", "100.00")],
        client_id=cid2, status="PENDING", payment_status="PENDING",
        provider_ref="ip2b-tok-saglikli",
    )
    checkout_provider.checkouts["ip2b-tok-iptal"] = CheckoutResult(
        success=True, provider_ref="pay-a", paid_price=Decimal("100.00")
    )
    checkout_provider.checkouts["ip2b-tok-saglikli"] = CheckoutResult(
        success=True, provider_ref="pay-b", paid_price=Decimal("100.00")
    )
    # Karantina: kayıtlar 'yeterince eski' olmalı (updated_at ORM'siz yazılır).
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE orders SET updated_at = now() - interval '1 hour' "
                "WHERE id = ANY(:ids)"
            ),
            {"ids": [oid_iptal, oid_saglikli]},
        )
        await s.commit()
    # Tarama hız sınırını aç (modül global'i monotonic ile karşılaştırılıyor).
    escrow_reconciler._last_checkout_scan = 0.0
    from core.config import settings

    eski = settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS
    settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS = 0
    try:
        hata: Exception | None = None
        try:
            async with AsyncSessionLocal() as s:
                await escrow_reconciler.reconcile_stale_checkouts(s)
        except HTTPException as exc:
            hata = exc
    finally:
        settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS = eski

    assert hata is None, (
        f"reconciler, iptal edilmiş siparişin kaydında {hata.status_code} ile "
        "öldü — partinin kalanı işlenmedi"
    )
    assert (await fab.siparis_durumu(oid_saglikli)) == ("PAID", "PAID"), (
        "meşru kayıp-callback siparişi mutabakattan geçemedi (parti zehirlendi)"
    )


# ── Yeşil nöbetçiler ────────────────────────────────────────────────────────────


async def test_yesil_callback_replay_yan_etkisiz(fab, provider):
    """PAID siparişe ikinci başarılı callback: no-op — SALE hareketi ve kupon
    kullanımı ÇOĞALMAZ, payment PAID kalır."""
    pid = await fab.urun(stock=5)
    cid = await fab.musteri()
    kupon = await fab.kupon(value="10.00")
    oid, _ = await fab.siparis(
        items=[(pid, 2, "PHYSICAL", "100.00")],
        client_id=cid, coupon=kupon, discount="10.00",
        provider_ref="ip2b-cf-replay",
    )
    await fab.kupon_kullanimi(coupon_id=kupon[0], client_id=cid, order_id=oid)

    async with AsyncSessionLocal() as s:
        await order_service.complete_checkout(
            s, order_id=oid, success=True,
            provider_ref="pay-x", token="ip2b-cf-replay",
            paid_price=Decimal("190.00"),
        )

    assert await fab.hareketler(pid, "SALE") == [("SALE", -2)]
    assert await fab.kupon_durumu(kupon[0]) == (1, 1)
    assert (await fab.siparis_durumu(oid))[1] == "PAID"
    assert provider.refund_calls == []


async def test_yesil_cift_callback_tek_yan_etki(fab, provider):
    """İki EŞZAMANLI başarılı callback: atomik PAID claim'i tek kazanan seçer —
    kupon kullanımı BİR kez sayılır, SALE hareketi tek, geçmişte tek PAID satırı.

    (Sıralı replay'i üstteki test çivili; bu test claim'in kendisinin
    nöbetçisidir: `escrow.claim` koşulsuz True yapılırsa kupon iki kez sayılır.)
    """
    pid = await fab.urun(stock=5)
    cid = await fab.musteri()
    kupon = await fab.kupon(value="10.00")
    oid, _ = await fab.siparis(
        items=[(pid, 2, "PHYSICAL", "100.00")],
        client_id=cid, status="PENDING", payment_status="PENDING",
        coupon=kupon, discount="10.00",
        provider_ref="ip2b-cf-dual", sale_yaz=False,
    )

    async def _cb():
        async with AsyncSessionLocal() as s:
            await order_service.complete_checkout(
                s, order_id=oid, success=True,
                provider_ref="pay-d", token="ip2b-cf-dual",
                paid_price=Decimal("190.00"),
            )

    await asyncio.gather(_cb(), _cb())

    assert (await fab.siparis_durumu(oid)) == ("PAID", "PAID")
    assert await fab.hareketler(pid, "SALE") == [("SALE", -2)]
    assert await fab.kupon_durumu(kupon[0]) == (1, 1), (
        "eşzamanlı çift callback kuponu iki kez saydı (claim tekliği bozuk)"
    )
    paid_gecmis = [h for h in await fab.history(oid) if h[1] == "PAID"]
    assert len(paid_gecmis) == 1


async def test_yesil_iptal_callback_yarisinda_cift_durum_yok(fab, provider):
    """İptal ↔ callback eşzamanlı: sipariş hem CANCELLED hem PAID OLAMAZ ve
    PAID kazandıysa CANCELLED geçmişi olamaz (tek kazanan)."""
    pid = await fab.urun(stock=5)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(
        items=[(pid, 1, "PHYSICAL", "100.00")],
        client_id=cid, status="PENDING", payment_status="PENDING",
        provider_ref="ip2b-cf-race",
    )

    async def _cb():
        async with AsyncSessionLocal() as s:
            try:
                await order_service.complete_checkout(
                    s, order_id=oid, success=True,
                    provider_ref="pay-r", token="ip2b-cf-race",
                    paid_price=Decimal("100.00"),
                )
                return "paid"
            except HTTPException:
                return None

    async def _cancel():
        try:
            await _iptal(oid)
            return "cancel"
        except HTTPException:
            return None

    sonuc = await asyncio.gather(_cb(), _cancel())
    durum, payment = await fab.siparis_durumu(oid)
    assert not (durum == "CANCELLED" and payment == "PAID"), (
        f"çift durum: {durum}/{payment} (yarış sonucu {sonuc})"
    )
    if durum == "PAID":
        assert all(h[1] != "CANCELLED" for h in await fab.history(oid))
