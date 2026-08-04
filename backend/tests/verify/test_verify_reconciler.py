"""Escrow mutabakatı (reconciler) — gerçek DB + gerçek servis katmanı.

Neden bu yüzey ayrıca doğrulanıyor: reconciler, para yolundaki **sessiz**
hataların son savunma hattıdır. Buradaki bir kusur ekrana hata basmaz — para
emanette süresiz kilitli kalır ya da tersine ikinci kez iade edilir. İkisi de
ancak muhasebe tutmadığında fark edilir.

Kapsanan iki ayrı iddia var:

1. **Kapsam** — her escrow yüzeyi taranıyor mu? Raporun P0-2 bulgusu tam olarak
   buydu: reconciler `Order`'ı taramıyordu ve kaybolan bir callback siparişi
   sonsuza dek PENDING bırakıyordu. Yeni bir para yüzeyi eklenip listeye
   yazılmazsa aynı hata sessizce geri gelir.
2. **Karar** — sarkan bir REFUNDING kaydında hangi adımın atıldığı. Kritik
   asimetri: "iade görünmüyor" bir kanıt DEĞİLDİR (sınırlı retry), "iade
   görünüyor" ise kanıttır (yazma çağrısı yapmadan finalize).
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.config import settings
from core.payments.base import RefundState
from services import escrow, escrow_reconciler

pytestmark = pytest.mark.asyncio


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# ── 1. Kapsam ───────────────────────────────────────────────────────────────────


def test_her_escrow_spec_reconciler_hedeflerinde():
    """Regresyon (P0-2): bir para yüzeyi tarama listesine yazılmazsa, o yüzeyde
    sarkan iade sonsuza dek çözülmez ve hata tamamen sessiz olur."""
    tanimli = {
        spec
        for name, spec in vars(escrow).items()
        if name.endswith("_SPEC") and isinstance(spec, escrow.EscrowSpec)
    }
    taranan = {spec for _model, spec in escrow_reconciler._REFUNDING_TARGETS}
    eksik = {s.reference_prefix for s in tanimli - taranan}
    assert not eksik, f"escrow yüzeyi reconciler'da taranmıyor: {eksik}"


def test_hedeflerdeki_kolonlar_modellerde_gercekten_var():
    """`status_attr`/`amount_attr` yanlış yazılırsa tarama çalışma anında patlar
    — ve bu kod yalnız arka plan döngüsünde koştuğu için hata kullanıcıya değil
    log'a gider."""
    for model, spec in escrow_reconciler._REFUNDING_TARGETS:
        assert hasattr(model, spec.status_attr), f"{model.__name__}.{spec.status_attr}"
        assert hasattr(model, spec.amount_attr), f"{model.__name__}.{spec.amount_attr}"
        assert hasattr(model, "refund_attempts"), model.__name__
        assert hasattr(model, "refund_requested_at"), model.__name__


# ── 2. Karar ────────────────────────────────────────────────────────────────────


@pytest.fixture
async def refunding_order(db, factory):
    """İade sağlayıcı çağrısında süreç ölmüş gibi REFUNDING'de asılı bir sipariş."""
    client = await factory.client(db)
    p = await factory.product(db, price="100.00")
    o = await factory.order(
        db,
        client=client,
        items=[(p, 1)],
        payment_status="REFUNDING",
        status="CANCELLED",
        provider_ref="tx-123",
    )
    # Karantina süresi dolmuş sayılsın (aksi halde her senaryo WAIT olurdu).
    o.refund_requested_at = _now() - datetime.timedelta(
        minutes=settings.REFUND_RECONCILE_MIN_AGE_MINUTES + 5
    )
    o.refund_attempts = 0
    await db.commit()
    return o


async def _reload(db, obj):
    await db.refresh(obj)
    return obj


async def test_karantina_dolmadan_dokunulmaz(db, factory, fake_provider):
    """Yeni başlamış bir iade, sağlayıcı yanıtı gecikiyor olabilir diye beklenir;
    erken retry çift iade riskidir."""
    client = await factory.client(db)
    p = await factory.product(db, price="50.00")
    o = await factory.order(
        db, client=client, items=[(p, 1)], payment_status="REFUNDING",
        provider_ref="tx-yeni",
    )
    o.refund_requested_at = _now()
    await db.commit()

    await escrow_reconciler.reconcile_refunding(db)

    assert fake_provider.refunds == [], "karantinadaki kayda iade çağrısı yapıldı"
    assert (await _reload(db, o)).payment_status == "REFUNDING"


async def test_saglayicida_iade_gorunuyorsa_yazma_cagrisi_YAPILMAZ(
    db, refunding_order, fake_provider
):
    """Pozitif kanıt: iade zaten olmuş. Tekrar `refund` çağırmak ikinci bir para
    hareketi denemesidir — yalnız yerel durum kapatılır."""
    fake_provider.state = RefundState.REFUNDED

    handled = await escrow_reconciler.reconcile_refunding(db)

    assert handled >= 1
    assert fake_provider.refunds == [], "sağlayıcıda görünen iade yeniden istendi"
    assert (await _reload(db, refunding_order)).payment_status == "REFUNDED"


async def test_iade_gorunmuyorsa_sinirli_retry(db, refunding_order, fake_provider):
    """`NOT_REFUNDED`/`UNKNOWN` "iade yok" KANITI DEĞİLDİR; sınırlı retry yapılır
    ve güvenlik, sağlayıcının aşırı-iadeyi reddetmesine yaslanır."""
    fake_provider.state = RefundState.UNKNOWN

    await escrow_reconciler.reconcile_refunding(db)

    assert len(fake_provider.refunds) == 1
    ref, amount = fake_provider.refunds[0]
    assert ref == "tx-123"
    assert amount == Decimal("100.00"), "iade tutarı sipariş toplamı olmalı"
    o = await _reload(db, refunding_order)
    assert o.payment_status == "REFUNDED"
    assert o.refund_attempts == 1, "deneme sayacı ilerlemedi — sonsuz retry riski"


async def test_deneme_siniri_asilinca_MANUAL_REVIEW_isaretlenir(
    db, refunding_order, fake_provider
):
    """Sınır aşıldığında sessizce denemeye devam etmek de, iade edildi demek de
    yanlış: kayıt SORGULANABİLİR biçimde insana bırakılır.

    ## Davranış DEĞİŞTİ (İP-2a / PK-δ, bilinçli ürün kararı)

    Bu testin adı ve iddiası eskiden "durum DEĞİŞMEZ" idi: kayıt süresiz
    `REFUNDING`'de kalıyor, ALERT yalnız `logger.error`'a düşüyordu. Onaylanan
    karara göre (docs/ip2a-magaza-iade-sozlesme.md §5/PK-δ) log tek başına
    kabul edilemez — kimsenin sorgulayamadığı bir kayıt, müşterinin parasını
    sessizce askıda tutar. Kayıt artık kalıcı ve filtrelenebilir bir
    `MANUAL_REVIEW` durumuna geçer.

    Değişmeyen çekirdek — ve burada asıl korunan şey: **`REFUNDED` YAZILMAZ**
    ve sağlayıcıya bir daha gidilmez.
    """
    fake_provider.state = RefundState.UNKNOWN
    refunding_order.refund_attempts = settings.REFUND_MAX_ATTEMPTS
    await db.commit()

    await escrow_reconciler.reconcile_refunding(db)

    assert fake_provider.refunds == []
    o = await _reload(db, refunding_order)
    assert o.payment_status == "MANUAL_REVIEW", (
        "deneme tavanı dolan iade sorgulanabilir bir duruma geçmeliydi"
    )
    assert o.payment_status != "REFUNDED", "para dönmemişken iade edildi yazıldı"
    assert o.refund_attempts == settings.REFUND_MAX_ATTEMPTS
    assert o.refunded_at is None, "kesinleşmemiş iadeye tamamlanma damgası atıldı"

    # Otomatik döngü bu kaydı bir daha sağlayıcıya göndermez.
    await escrow_reconciler.reconcile_refunding(db)
    assert fake_provider.refunds == []
    assert (await _reload(db, refunding_order)).payment_status == "MANUAL_REVIEW"


async def test_saglayici_iadeyi_reddederse_kayit_REFUNDING_kalir(
    db, refunding_order, fake_provider
):
    """Başarısız iade "iade edildi" diye kapatılamaz — bir sonraki turda tekrar
    denenmeli."""
    fake_provider.state = RefundState.UNKNOWN
    fake_provider.refund_ok = False

    await escrow_reconciler.reconcile_refunding(db)

    assert len(fake_provider.refunds) == 1
    o = await _reload(db, refunding_order)
    assert o.payment_status == "REFUNDING"
    assert o.refund_attempts == 1


async def test_silinmis_kayit_taranmaz(db, refunding_order, fake_provider):
    fake_provider.state = RefundState.UNKNOWN
    await db.execute(
        text("UPDATE orders SET deleted_at = now() WHERE id = :i"),
        {"i": refunding_order.id},
    )
    await db.commit()

    await escrow_reconciler.reconcile_refunding(db)

    assert fake_provider.refunds == []


async def test_referans_saglayiciya_dogru_onekle_sorulur(
    db, refunding_order, fake_provider
):
    """Sağlayıcıda kaydı bulmanın tek yolu `conversationId` referansıdır; yanlış
    önek "iade görünmüyor" sonucunu üretir ve gereksiz ikinci iade denenir."""
    fake_provider.state = RefundState.REFUNDED

    await escrow_reconciler.reconcile_refunding(db)

    assert fake_provider.state_queries, "sağlayıcıya hiç sorulmadı"
    _ref, reference = fake_provider.state_queries[0]
    assert reference == f"order:{refunding_order.id}"
