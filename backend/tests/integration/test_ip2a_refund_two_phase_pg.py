"""İP-2a · İki fazlı refund güvenliği ve reconciler görünürlüğü — GERÇEK PG.

Sözleşme: docs/ip2a-magaza-iade-sozlesme.md (§2 M1-M3, S3; §3 İP2A-01/02/03).

KIRMIZI testler bugün bilinen üretim kusurlarını ölçer ve FAIL etmeleri
BEKLENİR (assert mesajları ``KNOWN-RED(İP2A-XX)`` işaretlidir); İP-2b
düzeltmeleri sonrasında değiştirilmeden yeşile dönmelidirler. YEŞİL nöbetçiler
bugün geçen meşru davranışı korur.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.payments.base import RefundState
from services import escrow_reconciler, order_service
from tests.integration.ip2a_factory import IadeFabrikasi


@pytest.fixture
async def fab(pg):
    f = IadeFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


async def _cayma_talebi(order_id: int, items=None):
    """Gerçek servis yolundan CAYMA iade talebi (otomatik onay + anında iade)."""
    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, order_id)
        assert order is not None
        return await order_service.request_return(
            db, order, "", return_type="CAYMA", items=items
        )


async def _requested_at_geri_cek(return_id: int, *, saat: int = 2) -> None:
    """Sarkan talebi reconciler karantina penceresinin gerisine taşır."""
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE order_returns SET refund_requested_at = "
                "now() - make_interval(hours => :h) WHERE id = :i"
            ),
            {"h": saat, "i": return_id},
        )
        await s.commit()


async def _reconcile() -> int:
    async with AsyncSessionLocal() as s:
        return await escrow_reconciler.reconcile_refunding(s)


# ── YEŞİL NÖBETÇİLER ─────────────────────────────────────────────────────────


async def test_g01_saglayici_reddi_para_ve_stok_uretmez(fab, provider):
    """G-01: Provider başarısızken hiçbir şey REFUNDED görünmez, stok artmaz.

    İki fazlı akışın bugün DOĞRU çalışan çekirdeği: intent (REFUNDING) kalıcı,
    para durumu geri alınmaz ama iade edilmiş de gösterilmez.
    """
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 2)])  # stok 5-2=3
    provider.refund_result = False

    with pytest.raises(HTTPException) as exc:
        await _cayma_talebi(sip.order_id)
    assert exc.value.status_code == 502

    iadeler = await fab.iade_satirlari(sip.order_id)
    assert len(iadeler) == 1
    talep = iadeler[0]
    assert talep["refund_status"] == "REFUNDING", (
        "intent kalıcı olmalı: sarkan iade REFUNDING'de beklemeli"
    )
    assert talep["refund_attempts"] == 1
    o = await fab.siparis_satiri(sip.order_id)
    assert o["payment_status"] == "PAID", "para dönmedi — sipariş PAID kalmalı"
    assert o["refunded_at"] is None
    assert await fab.hareketler(pid, "RETURN") == [], (
        "para dönmeden stok geri konamaz"
    )
    assert await fab.stok(pid) == 3
    assert len(provider.refund_calls) == 1


async def test_g02_sonuclanmis_talebe_ikinci_onay_noop(fab, provider):
    """G-02: Sonuçlanmış (REFUNDED) talebe admin approve'u 409'dur; provider ve
    defter tekrarı yok.

    Kurulum CAYMA yolundan gider (otomatik onay + anında iade tamamlanır);
    AYIPLI onayın başarılı yolu bugün İP2A-18 yüzünden 500 verdiğinden burada
    kullanılamaz — o kusur R-18'de ayrıca kırmızıdır.
    """
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 2)])
    await _cayma_talebi(sip.order_id)
    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert talep["refund_status"] == "REFUNDED"  # ön koşul: iade tamamlandı

    with pytest.raises(HTTPException) as exc:
        async with AsyncSessionLocal() as db:
            await order_service.approve_return(db, talep["id"], admin_note="tekrar")
    assert exc.value.status_code == 409

    assert len(provider.refund_calls) == 1, "duplicate onay ikinci para hareketi üretemez"
    donen = await fab.hareketler(pid, "RETURN")
    assert len(donen) == 1, "duplicate onay ikinci stok hareketi üretemez"
    assert donen[0][2] == 2  # qty_delta: yalnız satılan adet


# ── KIRMIZI KABUL TESTLERİ ───────────────────────────────────────────────────


async def test_r01a_reconciler_retry_stogu_geri_koymali(fab, provider):
    """R-01a · KNOWN-RED(İP2A-01): reconciler RETRY ile parayı tamamladığında
    stok telafisi de uygulanmalıdır.

    Bugün: `reconcile_refunding` yalnız `escrow.perform_refund/finalize_refund`
    çağırır (escrow_reconciler.py:132); `_restock_items` hiç koşmaz. Para
    provider'dan döner, kayıt REFUNDED olur, stok SONSUZA DEK eksik kalır —
    ve sipariş artık hiçbir yoldan telafi edilemez.
    """
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 2)])  # stok 3
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _cayma_talebi(sip.order_id)
    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert talep["refund_status"] == "REFUNDING"  # ön koşul: sarkan iade

    provider.refund_result = True
    await _requested_at_geri_cek(talep["id"])
    await _reconcile()

    son = (await fab.iade_satirlari(sip.order_id))[0]
    assert son["refund_status"] == "REFUNDED", (
        "ön koşul: reconciler parayı tamamladı (fake provider kabul etti)"
    )
    donen = await fab.hareketler(pid, "RETURN")
    assert len(donen) == 1 and donen[0][2] == 2, (
        "KNOWN-RED(İP2A-01): para iade edildi ama stok geri konmadı — "
        "reconciler telafileri (RETURN hareketi) uygulamıyor; 2 kitap defterden "
        "kalıcı olarak kayıp"
    )


async def test_r01b_reconciler_finalize_siparis_butunlugunu_tamamlamali(fab, provider):
    """R-01b · KNOWN-RED(İP2A-01): provider'da POZİTİF görünen iade yerelde
    finalize edilirken sipariş bütünlüğü (refunded_amount + FSM) de tamamlanmalı.

    Bugün: FINALIZE yalnız `refund_status`+`refunded_at` yazar; tam-kapsamlı
    bir iade talebi REFUNDED olsa bile sipariş PAID + refunded_amount=0 kalır —
    kümülatif iade tavanı (`remaining_refundable`) bayatlar ve aynı sipariş
    üzerinden yeniden iade açılabilir.
    """
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 2)])
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _cayma_talebi(sip.order_id)
    talep = (await fab.iade_satirlari(sip.order_id))[0]

    async def _pozitif(*, provider_ref, reference):
        return RefundState.REFUNDED

    provider.refund_state = _pozitif  # sağlayıcıda iade kanıtlı
    await _requested_at_geri_cek(talep["id"])
    await _reconcile()

    son = (await fab.iade_satirlari(sip.order_id))[0]
    assert son["refund_status"] == "REFUNDED"  # ön koşul: finalize gerçekleşti
    o = await fab.siparis_satiri(sip.order_id)
    assert o["refunded_amount"] == son["refund_amount"], (
        "KNOWN-RED(İP2A-01): reconciler finalize'ı order.refunded_amount'u "
        "artırmıyor — kümülatif iade tavanı bayat kalıyor, sipariş üzerinden "
        "total'i aşan yeni iade açılabilir"
    )


async def test_r02_reconciler_talebin_kendi_provider_refiyle_denemeli(fab, provider):
    """R-02 · KNOWN-RED(İP2A-02): sarkan iadeyi reconciler, iade talebine
    KAYDEDİLMİŞ sağlayıcı referansıyla denemelidir.

    Bugün: `order_returns.provider_ref` hiçbir yerde yazılmaz; reconciler
    `provider.refund(provider_ref=None, ...)` çağırır. Fake sağlayıcı ref'e
    bakmadığından CI'da görünmez; iyzico'da None anında False döner ve sarkan
    kısmi iade 3 denemede kalıcı ALERT'e düşer — 'reconciler devralır'
    güvencesi gerçek sağlayıcıda ölüdür.
    """
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 2)])
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _cayma_talebi(sip.order_id)
    talep = (await fab.iade_satirlari(sip.order_id))[0]

    provider.refund_result = True
    provider.refund_calls.clear()
    await _requested_at_geri_cek(talep["id"])
    await _reconcile()

    assert provider.refund_calls, "ön koşul: reconciler RETRY provider'a gitti"
    kullanilan_ref = provider.refund_calls[-1][0]
    assert kullanilan_ref is not None, (
        "KNOWN-RED(İP2A-02): reconciler iade denemesini provider_ref=None ile "
        "yaptı — order_returns.provider_ref hiç doldurulmuyor; gerçek "
        "sağlayıcıda bu çağrı asla başarılı olamaz ve iade kalıcı sarkar"
    )


async def test_r03_kismi_sonrasi_tam_iade_odeneni_asamaz(fab, provider):
    """R-03 · KNOWN-RED(İP2A-03): provider'a giden iade toplamı fiilen ödenen
    tutarı aşamaz.

    Bugün: `refund_order` yalnız `payment_status=='PAID'` kontrol eder ve
    `escrow.perform_refund` ORDER_SPEC ile daima `order.total`'ı iade eder.
    100 TL'lik kısmi iade sonrası tam iade → 300 TL sipariş için sağlayıcıya
    toplam 400 TL gider.
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 3)])  # total 300
    assert sip.total == Decimal("300.00")

    # Kısmi iade CAYMA yolundan (anında tamamlanır; AYIPLI onayı İP2A-18/500).
    async with AsyncSessionLocal() as db:
        from schemas.store import OrderReturnItemIn

        order = await order_service._load_full(db, sip.order_id)
        await order_service.request_return(
            db,
            order,
            "",
            return_type="CAYMA",
            items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=1)],
        )
    assert sum(a for _, a in provider.refund_calls) == Decimal("100.00")

    # Admin, kalan malın da iadesi için siparişi komple iade eder.
    async with AsyncSessionLocal() as db:
        await order_service.refund_order(db, sip.order_id)

    toplam = sum(a for _, a in provider.refund_calls)
    assert toplam <= sip.total, (
        f"KNOWN-RED(İP2A-03): sağlayıcıya giden iade toplamı {toplam} TL — "
        f"fiilen ödenen {sip.total} TL'yi aşıyor; tam iade refunded_amount'a "
        "bakmadan order.total'ı ikinci kez gönderdi (çifte ödeme)"
    )


async def test_r09_tam_iade_refunded_amount_yazmali(fab, provider):
    """R-09 · KNOWN-RED(İP2A-09): admin tam iadesi `orders.refunded_amount`'u
    doldurmalıdır (`payment_status=REFUNDED ⇒ refunded_amount=total`).

    Bugün yalnız `_settle_return` yazar; `refund_order`/`cancel_by_client`/
    reconciler yazmaz → gelir raporundaki 'iade edilen ciro' (revenue_service)
    tam iadeleri hiç görmez ve migration 75676a6e5a81'in kurduğu invariant
    çalışma zamanında kırılır.
    """
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 2)])
    async with AsyncSessionLocal() as db:
        await order_service.refund_order(db, sip.order_id)

    o = await fab.siparis_satiri(sip.order_id)
    assert o["payment_status"] == "REFUNDED"  # ön koşul: iade tamamlandı
    assert o["refunded_amount"] == sip.total, (
        f"KNOWN-RED(İP2A-09): tam iade sonrası refunded_amount="
        f"{o['refunded_amount']} — {sip.total} olmalıydı; iade cirosu raporda "
        "görünmez ve kümülatif tavan hesabı bayat kalır"
    )


async def test_r08c_uc_deneme_sonrasi_sarkan_iade_sorgulanabilir_iz_birakmali(
    fab, provider
):
    """R-08c · KNOWN-RED(İP2A-01/PK-δ): `REFUND_MAX_ATTEMPTS` aşan iade sessiz
    log'da kalamaz — veritabanında sorgulanabilir bir işaret taşımalıdır.

    Bugün ALERT yalnız `logger.error`dur; kayıt süresiz REFUNDING'de kalır ve
    hiçbir admin görünümü/kolonu onu listelemez. Bu test 'terminal iade ama
    para hâlâ bekliyor' durumunun kaybolmadığını ölçer: deneme tavanı aşıldıktan
    sonra kayıt ya kalıcı bir duruma (ör. MANUAL_REVIEW) geçmeli ya da en
    azından REFUNDING'de olduğu deneme sayacından belli olmalıdır — sayaç artık
    ARTMAMALI (reconciler döngüsü her turda sonsuz retry üretmemeli).
    """
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 2)])
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _cayma_talebi(sip.order_id)
    talep = (await fab.iade_satirlari(sip.order_id))[0]

    # Tavana kadar (ve iki tur fazladan) reconciler koştur; provider hep ret.
    for _ in range(5):
        await _requested_at_geri_cek(talep["id"])
        await _reconcile()

    son = (await fab.iade_satirlari(sip.order_id))[0]
    assert son["refund_attempts"] >= 3, "ön koşul: deneme tavanına ulaşıldı"
    assert son["refund_status"] != "REFUNDING", (
        "KNOWN-RED(İP2A-01/PK-δ): tavan (REFUND_MAX_ATTEMPTS=3) aşıldıktan "
        "sonra kayıt hâlâ REFUNDING'de — sarkan iade yalnız logger.error'a "
        "düşüyor; veritabanında sorgulanabilir hiçbir kalıcı işaret "
        "(MANUAL_REVIEW benzeri) yok, müşterinin parası sessizce askıda "
        "(bkz. sözleşme §5/PK-δ)"
    )
