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
from services import escrow, escrow_reconciler, order_service
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
    # PK-α: stok fiziksel kabulde döner — nöbetçinin ölçtüğü "ikinci hareket
    # üretilemez" iddiası için önce MEŞRU birinci hareket kurulur.
    await fab.teslim_al(talep["id"])

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
    """R-01a · İP2A-01: reconciler RETRY ile parayı tamamladığında **para
    telafilerinin tamamı** da uygulanmalıdır.

    Tarihsel hâli "stok geri konmalı" diyordu; PK-α kararıyla stok artık
    reconciler'ın işi DEĞİLDİR (mal hâlâ müşterinin elinde olabilir).
    Sözleşme buna göre güncellendi ve test GÜÇLENDİ: eskiden yalnız tek bir
    defter hareketi sayılıyordu, şimdi reconciler'ın tamamlaması gereken HER
    telafi tek tek ölçülüyor — ve stoğu geri koymadığı ayrıca doğrulanıyor.

    Bugünkü kusur olsaydı: para provider'dan döner, kayıt REFUNDED olur,
    `refunded_amount`/kupon/FSM/bildirim SONSUZA DEK eksik kalırdı — sipariş
    artık PAID olmadığı için hiçbir uç telafiyi tamamlayamazdı.
    """
    pid = await fab.urun(stock=5)
    kupon = await fab.kupon(discount_type="FIXED", value="20.00")
    sip = await fab.siparis(
        items=[(pid, 2)], coupon_id=kupon, coupon_redeemed=True, discount="20.00"
    )  # stok 3, total 180
    cid = sip.client_id
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _cayma_talebi(sip.order_id)
    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert talep["refund_status"] == "REFUNDING"  # ön koşul: sarkan iade
    assert await fab.bildirim_sayisi(cid, icinde="iade edildi") == 0

    provider.refund_result = True
    await _requested_at_geri_cek(talep["id"])
    await _reconcile()

    son = (await fab.iade_satirlari(sip.order_id))[0]
    assert son["refund_status"] == "REFUNDED", (
        "ön koşul: reconciler parayı tamamladı (fake provider kabul etti)"
    )
    o = await fab.siparis_satiri(sip.order_id)
    assert o["refunded_amount"] == sip.total, (
        f"İP2A-01: para iade edildi ama refunded_amount={o['refunded_amount']} — "
        "ciro raporu ve kümülatif tavan bayat kalır"
    )
    assert o["payment_status"] == "REFUNDED", (
        "İP2A-01: tam iade tamamlandı ama sipariş ödeme durumu güncellenmedi"
    )
    assert o["status"] == "REFUNDED", (
        "İP2A-01: sipariş yaşam döngüsü PAID'de asılı kaldı"
    )
    assert (await fab.kupon_satiri(kupon))["used_count"] == 0, (
        "İP2A-01: tam iade tamamlandı ama kupon kullanımı geri açılmadı"
    )
    assert await fab.bildirim_sayisi(cid, icinde="iade edildi") == 1, (
        "İP2A-01: reconciler iadeyi tamamladı ama müşteri hiç bilgilendirilmedi"
    )
    # PK-α: para yolu stok ÜRETMEZ — mal hâlâ müşteride olabilir.
    assert await fab.hareketler(pid, "RETURN") == [], (
        "PK-α: reconciler fiziksel kabul olmadan stok geri koyamaz"
    )
    assert await fab.stok(pid) == 3
    await fab.teslim_al(son["id"])
    donen = await fab.hareketler(pid, "RETURN")
    assert len(donen) == 1 and donen[0][2] == 2, (
        "fiziksel kabul sonrası stok TAM BİR KEZ dönmeli"
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
    # Referans GERÇEK olmalı: talebe kaydedilen ve tahsilatın yapıldığı
    # `paymentTransactionId`. "None değil" yetmez — yanlış ama dolu bir
    # referans da iyzico'da reddedilir ve kusur görünmez kalırdı.
    son = (await fab.iade_satirlari(sip.order_id))[0]
    async with AsyncSessionLocal() as s:
        siparis_ref = (
            await s.execute(
                text("SELECT provider_ref FROM orders WHERE id = :i"),
                {"i": sip.order_id},
            )
        ).scalar_one()
    assert son["provider_ref"] == siparis_ref, (
        "talebin provider_ref'i tahsilatın referansı olmalı"
    )
    assert kullanilan_ref == siparis_ref, (
        f"reconciler '{kullanilan_ref}' ile denedi, tahsilat referansı "
        f"'{siparis_ref}'"
    )
    # Reconciler'ın pozitif-kanıt sorgusu da TAHSİLATIN conversationId'siyle
    # yapılmalı (`order:{order_id}`); `return:{id}` iyzico'da hiç eşleşmez.
    assert (
        f"{escrow.RETURN_SPEC.reference_prefix}:{sip.order_id}" == f"order:{sip.order_id}"
    )


async def test_r02b_canli_iade_de_talebin_provider_refini_kaydeder(fab, provider):
    """İP2A-02: `provider_ref` reconciler'a kalmadan, İLK denemede yazılır.

    Sarkan kaydı kurtarma yeteneği niyetin commit'lendiği ANDA doğmalıdır:
    süreç sağlayıcı çağrısında ölürse artık hiçbir yerden referans
    türetilemez ve iade kalıcı olarak askıda kalır.
    """
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 1)])
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _cayma_talebi(sip.order_id)

    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert talep["refund_status"] == "REFUNDING"
    assert talep["provider_ref"], (
        "sarkan iade niyeti provider_ref'siz commit edildi — reconciler bu "
        "kaydı gerçek sağlayıcıda asla tamamlayamaz"
    )
    assert provider.refund_calls[0][0] == talep["provider_ref"]


async def test_r03_kismi_sonrasi_tam_iade_odeneni_asamaz(fab, provider):
    """R-03 · KNOWN-RED(İP2A-03): provider'a giden iade toplamı fiilen ödenen
    tutarı aşamaz.

    Bugün: `refund_order` yalnız `payment_status=='PAID'` kontrol eder ve
    `escrow.perform_refund` ORDER_SPEC ile daima `order.total`'ı iade eder.
    100 TL'lik kısmi iade sonrası tam iade → 300 TL sipariş için sağlayıcıya
    toplam 400 TL gider.
    """
    # Sipariş SHIPPED: teslim edilmiş sipariş `refund_order`'dan zaten 409 alır
    # (İP-2b R4) ve tavan iddiası hiç ölçülmezdi — senaryo, ucun GERÇEKTEN
    # koştuğu duruma kurulur.
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 3)], status="SHIPPED")  # total 300
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
    # (`reason` ZORUNLUDUR — İP-2b R3; gerekçesiz para hareketi kabul edilmez.)
    async with AsyncSessionLocal() as db:
        await order_service.refund_order(db, sip.order_id, reason="kalan mal iadesi")

    toplam = sum(a for _, a in provider.refund_calls)
    assert toplam <= sip.total, (
        f"KNOWN-RED(İP2A-03): sağlayıcıya giden iade toplamı {toplam} TL — "
        f"fiilen ödenen {sip.total} TL'yi aşıyor; tam iade refunded_amount'a "
        "bakmadan order.total'ı ikinci kez gönderdi (çifte ödeme)"
    )
    # Tavan yalnız aşılmamakla kalmaz, tam olarak ödenene kapanır: ikinci
    # çağrı KALAN tutarı ister (300 − 100), fazlasını değil.
    assert toplam == sip.total, f"kalan tutar eksik iade edildi: {toplam}"
    assert provider.refund_calls[-1][1] == Decimal("200.00")
    o = await fab.siparis_satiri(sip.order_id)
    assert o["refunded_amount"] == sip.total
    assert o["payment_status"] == "REFUNDED"


async def test_r09_tam_iade_refunded_amount_yazmali(fab, provider):
    """R-09 · KNOWN-RED(İP2A-09): admin tam iadesi `orders.refunded_amount`'u
    doldurmalıdır (`payment_status=REFUNDED ⇒ refunded_amount=total`).

    Bugün yalnız `_settle_return` yazar; `refund_order`/`cancel_by_client`/
    reconciler yazmaz → gelir raporundaki 'iade edilen ciro' (revenue_service)
    tam iadeleri hiç görmez ve migration 75676a6e5a81'in kurduğu invariant
    çalışma zamanında kırılır.
    """
    # SHIPPED: `refund_order` teslim edilmiş siparişi RMA'ya yollar (İP-2b R4),
    # bu yüzden uç ancak burada gerçekten koşar.
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 2)], status="SHIPPED")
    async with AsyncSessionLocal() as db:
        await order_service.refund_order(db, sip.order_id, reason="yonetici iadesi")

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
    """R-08c · İP2A-01 / PK-δ: deneme tavanı dolan iade **MANUAL_REVIEW**'a geçer.

    Onaylanan ürün kararı (PK-δ) tarihsel assert'i kesinleştirdi: eskiden
    yalnız "REFUNDING olmasın" deniyordu — bu, kaydı REFUNDED yazan yanlış bir
    uygulamayı da geçirirdi. Artık ölçülen sözleşme tam olarak şudur:

    * durum **MANUAL_REVIEW** (sorgulanabilir, admin kuyruğunda görünür),
    * **REFUNDED YAZILMAZ** (para gerçekten döndü mü bilinmiyor),
    * otomatik reconciler kaydı bir daha SAĞLAYICIYA GÖNDERMEZ,
    * "başarı" yan etkileri (stok, kupon, refunded_amount) oluşmaz,
    * geçiş denetim izi bırakır.
    """
    pid = await fab.urun(stock=5)
    kupon = await fab.kupon(discount_type="FIXED", value="20.00")
    sip = await fab.siparis(
        items=[(pid, 2)], coupon_id=kupon, coupon_redeemed=True, discount="20.00"
    )
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _cayma_talebi(sip.order_id)
    talep = (await fab.iade_satirlari(sip.order_id))[0]

    # Tavana kadar (ve iki tur fazladan) reconciler koştur; provider hep ret.
    for _ in range(5):
        await _requested_at_geri_cek(talep["id"])
        await _reconcile()
    tavanda_cagri = len(provider.refund_calls)

    son = (await fab.iade_satirlari(sip.order_id))[0]
    assert son["refund_attempts"] >= 3, "ön koşul: deneme tavanına ulaşıldı"
    assert son["refund_status"] == "MANUAL_REVIEW", (
        f"İP2A-01/PK-δ: tavan (REFUND_MAX_ATTEMPTS=3) aşıldıktan sonra durum "
        f"'{son['refund_status']}' — kayıt sorgulanabilir bir manuel inceleme "
        "durumuna geçmeliydi; sessiz logger.error müşterinin parasını askıda "
        "bırakır (sözleşme §5/PK-δ)"
    )

    # Otomatik retry DURDU: yeni turlar sağlayıcıya bir daha gitmez.
    for _ in range(2):
        await _requested_at_geri_cek(talep["id"])
        await _reconcile()
    assert len(provider.refund_calls) == tavanda_cagri, (
        "MANUAL_REVIEW kaydı otomatik retry'a yeniden dahil edildi"
    )
    en_son = (await fab.iade_satirlari(sip.order_id))[0]
    assert en_son["refund_status"] == "MANUAL_REVIEW"
    assert en_son["refund_attempts"] == son["refund_attempts"], (
        "manuel incelemedeki kayıt deneme sayacını artırmaya devam ediyor"
    )

    # Hiçbir "başarı" yan etkisi yok.
    o = await fab.siparis_satiri(sip.order_id)
    assert o["payment_status"] == "PAID" and o["refunded_amount"] == Decimal("0.00")
    assert await fab.hareketler(pid, "RETURN") == []
    assert (await fab.kupon_satiri(kupon))["used_count"] == 1
    assert await fab.audit_sayisi(
        action="refund.manual_review",
        target_type="order_return",
        target_id=talep["id"],
    ) == 1, "manuel incelemeye geçiş denetim izi bırakmalı (tam bir kez)"


async def test_r08d_manual_review_admin_kuyrugunda_listelenir(fab, provider):
    """PK-δ: manuel inceleme kaydı admin kuyruğundan SORGULANABİLİR olmalı.

    Kalıcı bir durum yazmak tek başına yetmez: kimsenin bakamadığı bir durum,
    sessiz log'dan yalnız biraz iyidir. Kuyruk mevcut admin iade listesinin
    `refund_status` filtresidir — ikinci bir admin sistemi kurulmadı.
    """
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 2)])
    provider.refund_result = False
    with pytest.raises(HTTPException):
        await _cayma_talebi(sip.order_id)
    talep = (await fab.iade_satirlari(sip.order_id))[0]
    for _ in range(4):
        await _requested_at_geri_cek(talep["id"])
        await _reconcile()
    assert (await fab.iade_satirlari(sip.order_id))[0]["refund_status"] == "MANUAL_REVIEW"

    async with AsyncSessionLocal() as db:
        kuyruk = await order_service.list_returns_admin(
            db, refund_status_filter="MANUAL_REVIEW"
        )
        temiz = await order_service.list_returns_admin(
            db, refund_status_filter="REFUNDED"
        )
    assert any(r.id == talep["id"] for r in kuyruk), (
        "manuel inceleme kaydı MANUAL_REVIEW kuyruğunda görünmüyor"
    )
    assert all(r.id != talep["id"] for r in temiz), (
        "filtre çalışmıyor: askıdaki kayıt 'iade edildi' kuyruğuna sızdı"
    )
