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
import logging
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.config import settings
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
    yalnız bu yeteneği olan sağlayıcıda çalışır (iyzico'nun test ikizi).

    `patlayan_tokenlar`: bu token'larda sağlayıcı **beklenmeyen** bir istisna
    (RuntimeError) fırlatır — ağ/SDK/serileştirme sınıfı arıza taklidi. İptal
    veya FSM ile hiçbir ilgisi yoktur; parti izolasyonunu R10'dan bağımsız
    ölçmek için gerekir.
    """

    def __init__(self) -> None:
        super().__init__()
        self.checkouts: dict[str, CheckoutResult] = {}
        self.retrieve_tokens: list[str] = []
        self.patlayan_tokenlar: set[str] = set()

    async def retrieve_checkout(self, *, token: str) -> CheckoutResult:
        self.retrieve_tokens.append(token)
        if token in self.patlayan_tokenlar:
            raise RuntimeError(f"saglayici beklenmeyen hata (token={token})")
        return self.checkouts.get(token, CheckoutResult(success=False))


@pytest.fixture
def checkout_provider(monkeypatch) -> CheckoutSaglayici:
    stub = CheckoutSaglayici()
    from core import payments

    monkeypatch.setattr(payments, "get_payment_provider", lambda: stub)
    return stub


async def _bayatlat(oids: list[int]) -> None:
    """Kayıtları karantina penceresinin dışına taşır (ORM'siz UPDATE)."""
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE orders SET updated_at = now() - interval '1 hour' "
                "WHERE id = ANY(:ids)"
            ),
            {"ids": oids},
        )
        await s.commit()


async def _bir_tur_mutabakat() -> Exception | None:
    """Bayat-checkout taramasını BİR kez koşturur; dışarı kaçan istisnayı döndürür.

    Tarama hız sınırı (modül global'i) ve aralık ayarı her turda sıfırlanır ki
    ikinci tur gerçekten koşsun (idempotency ölçümü buna bağlı)."""
    escrow_reconciler._last_checkout_scan = 0.0
    eski = settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS
    settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS = 0
    try:
        async with AsyncSessionLocal() as s:
            await escrow_reconciler.reconcile_stale_checkouts(s)
    except Exception as exc:  # noqa: BLE001 — kaçan HER istisna bulgudur
        return exc
    finally:
        settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS = eski
    return None


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


async def test_kirmizi_reconciler_partisi_zehirlenmez(fab, checkout_provider, caplog):
    """[IP2B-R11] Bir kaydın BEKLENMEYEN hatası, aynı reconciler partisindeki
    diğer kayıtların mutabakatını engellememeli.

    Sözleşme: `escrow_reconciler` docstring'i "her kayıt kendi commit'iyle —
    bir kayıttaki hata diğerlerini geciktirmez" der; sipariş dalında per-kayıt
    hata izolasyonu YOKTUR, döngü ilk istisnada ölür.

    ── Bu testin R10'dan BAĞIMSIZ olması neden şart? ─────────────────────────
    Önceki hâlinde partiyi bozan tek kayıt R10 senaryosuydu (CANCELLED→PAID
    409'u). FSM'e o geçiş eklenirse — kayıt-başı izolasyon HİÇ yazılmadan —
    test yeşile dönerdi; yani ölçtüğü invariant izolasyon değil FSM'di. Artık
    partide **iptal/FSM ile hiçbir ilgisi olmayan** bir arıza var: sağlayıcı
    yalnız tek bir token'da RuntimeError fırlatıyor.

    ── Sıralama neden ID'ye çivilenmedi? ─────────────────────────────────────
    Üretim sorgusunda (`escrow_reconciler.reconcile_stale_checkouts`) ORDER BY
    YOKTUR; satır sırası PostgreSQL yığın (heap) düzenidir ve suite'in sürekli
    INSERT/DELETE ettiği bir tabloda id sırasıyla aynı OLMAK ZORUNDA DEĞİLDİR.
    "Bozuk kayıt önce gelsin" varsayımına yaslanmak testi tesadüfe bağlardı.
    Onun yerine parti bütünlüğü SIRADAN BAĞIMSIZ ölçülür: ölen bir döngü,
    kendisinden sonraki kayda `retrieve_checkout` çağrısını HİÇ yapamaz — bu
    yüzden "partideki her kaydın sağlayıcıya sorulmuş olması" + "hiçbir istisna
    dışarı kaçmaması" birlikte, hangi sırada gelirse gelsin izolasyonu ölçer.
    """
    caplog.set_level(logging.ERROR)
    TOK_BOZUK = "ip2b-tok-bozuk"
    TOK_SAGLIKLI = "ip2b-tok-saglikli"
    TOK_IPTAL = "ip2b-tok-iptal"
    # Tutarlar bilerek AYRIK (100/200/300): sağlayıcıya giden her iade çağrısı
    # tutarından kime ait olduğu kesin okunur.
    pid_bozuk = await fab.urun(stock=6)
    pid_saglikli = await fab.urun(stock=6)
    pid_iptal = await fab.urun(stock=6)

    # A) Bağımsız bozuk kayıt: sıradan bir bayat PENDING checkout; hatası
    #    sağlayıcı katmanında doğar (iptal/FSM ile ilgisi yok).
    oid_bozuk, _ = await fab.siparis(
        items=[(pid_bozuk, 1, "PHYSICAL", "100.00")],
        client_id=await fab.musteri(), status="PENDING", payment_status="PENDING",
        provider_ref=TOK_BOZUK,
    )
    # B) Sağlıklı kayıp-callback siparişi: mutabakattan PAID/PAID çıkmalı.
    oid_saglikli, _ = await fab.siparis(
        items=[(pid_saglikli, 2, "PHYSICAL", "100.00")],
        client_id=await fab.musteri(), status="PENDING", payment_status="PENDING",
        provider_ref=TOK_SAGLIKLI,
    )
    # C) R10 senaryosu: iptal edilmiş ama sağlayıcıda ödenmiş görünen sipariş.
    oid_iptal, _ = await fab.siparis(
        items=[(pid_iptal, 3, "PHYSICAL", "100.00")],
        client_id=await fab.musteri(), status="PENDING", payment_status="PENDING",
        provider_ref=TOK_IPTAL,
    )
    await _iptal(oid_iptal)
    assert (await fab.siparis_durumu(oid_iptal))[0] == "CANCELLED"

    checkout_provider.patlayan_tokenlar.add(TOK_BOZUK)
    checkout_provider.checkouts[TOK_SAGLIKLI] = CheckoutResult(
        success=True, provider_ref="pay-saglikli", paid_price=Decimal("200.00")
    )
    checkout_provider.checkouts[TOK_IPTAL] = CheckoutResult(
        success=True, provider_ref="pay-iptal", paid_price=Decimal("300.00")
    )
    await _bayatlat([oid_bozuk, oid_saglikli, oid_iptal])

    hata1 = await _bir_tur_mutabakat()
    tutarlar1 = [a for _ref, a in checkout_provider.refund_calls]
    okunan1 = list(checkout_provider.retrieve_tokens)

    # ── 1) Döngü ölmemeli ────────────────────────────────────────────────────
    assert hata1 is None, (
        f"reconciler partisi tek kayıtta öldü: {hata1!r} — sipariş dalında "
        f"kayıt-başı hata izolasyonu yok (sağlayıcıya sorulanlar: {okunan1})"
    )
    # ── 2) Partideki HER kayda ulaşılmalı (sıradan bağımsız izolasyon ölçüsü) ─
    assert {TOK_BOZUK, TOK_SAGLIKLI, TOK_IPTAL} <= set(okunan1), (
        "partideki bazı kayıtlar sağlayıcıya hiç sorulmadı — döngü bir kaydın "
        f"hatasında kesildi (sorulanlar: {okunan1})"
    )
    # ── 3) Sağlam kayıt GERÇEKTEN işlenmeli (yalnız durum değil, yan etki de) ─
    assert (await fab.siparis_durumu(oid_saglikli)) == ("PAID", "PAID"), (
        "meşru kayıp-callback siparişi mutabakattan geçemedi (parti zehirlendi)"
    )
    assert await fab.hareketler(pid_saglikli, "SALE") == [("SALE", -2)], (
        "sağlam kayıt PAID göründü ama satışın defter hareketi yazılmadı"
    )
    # ── 4) Bozuk kayıt güvenli önceki durumda, yan etkisiz ───────────────────
    assert (await fab.siparis_durumu(oid_bozuk)) == ("PENDING", "PENDING"), (
        "sağlayıcısı patlayan kayıt yarım bir duruma yazıldı"
    )
    assert await fab.hareketler(pid_bozuk, "SALE") == []
    assert await fab.stok(pid_bozuk) == 6
    assert Decimal("100.00") not in tutarlar1, (
        "sağlayıcısı patlayan kayıt için iade tetiklendi (yanlış yan etki)"
    )
    assert Decimal("200.00") not in tutarlar1, (
        "sağlam kayıt tahsil edilirken bir de iade edildi"
    )
    # ── 5) R10 kaydı sessizce kaybolmamalı ───────────────────────────────────
    durum_iptal, odeme_iptal = await fab.siparis_durumu(oid_iptal)
    assert durum_iptal == "CANCELLED"
    assert odeme_iptal != "PAID", "iptal edilmiş sipariş sonradan ödenmiş gösterildi"
    assert tutarlar1.count(Decimal("300.00")) <= 1, (
        f"ölü siparişin tahsilatı birden çok kez iade edildi: {tutarlar1}"
    )
    iade_edildi = (
        tutarlar1.count(Decimal("300.00")) == 1 and odeme_iptal == "REFUNDED"
    )
    gorunur = any(
        r.levelno >= logging.ERROR and str(oid_iptal) in r.getMessage()
        for r in caplog.records
    )
    assert iade_edildi or gorunur, (
        "iptal edilmiş siparişin doğrulanmış tahsilatı SESSİZCE kayboldu: ne "
        "otomatik iade edildi ne de görünür bir hata kaydı bıraktı "
        "(sözleşme §6: otomatik tam iade YA DA MANUAL_REVIEW görünürlüğü)"
    )
    # ── 6) İkinci tur: çift para/stok hareketi üretmemeli ────────────────────
    hata2 = await _bir_tur_mutabakat()
    tutarlar2 = [a for _ref, a in checkout_provider.refund_calls]
    assert hata2 is None, f"ikinci mutabakat turu da öldü: {hata2!r}"
    assert tutarlar2 == tutarlar1, (
        f"ikinci tur yeni para hareketi üretti: {tutarlar1} → {tutarlar2}"
    )
    assert await fab.hareketler(pid_saglikli, "SALE") == [("SALE", -2)], (
        "ikinci tur sağlam siparişin satışını yeniden işledi (çift stok düşümü)"
    )
    assert (await fab.siparis_durumu(oid_saglikli)) == ("PAID", "PAID")
    assert (await fab.siparis_durumu(oid_bozuk)) == ("PENDING", "PENDING")


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
