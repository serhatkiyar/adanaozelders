"""E — İPTAL ve MUTABAKAT (gerçek DB, gerçek servis).

BEKLENEN DAVRANIŞ:

E1. Müşteri ödenmiş siparişini (kargolanmadan önce) iptal edebilir: para iade
    edilir, stok geri yüklenir, sipariş CANCELLED olur.
    — Bu yol `_lock_order` + `order.items` kullanır; ilişki yeniden
      yüklenmezse async oturumda lazy-load 500 üretir.
E2. Kargolanmış sipariş iptal edilemez (iade talebi gerekir).
E3. Kayıp callback: müşteri ödedi ama callback hiç gelmedi → sipariş PENDING
    kaldı. Reconciler sağlayıcıdan doğrulayıp siparişi kesinleştirmelidir.
E3a. Yaş eşiğinin ALTINDAKİ checkout'a dokunulmaz (kullanıcı hâlâ 3DS'te olabilir).
E3b. Eşiğin ÜSTÜNDEKİ checkout işlenir — E3a ile birlikte eşiğin gerçekten
     ayırt edici olduğunu gösterir.
E4. Sarkan REFUNDING iade talebi reconciler kapsamındadır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.config import settings

pytestmark = pytest.mark.asyncio

#: Sınır testlerinde yaş eşiğinin iki yanına konan pay. Ölçülen şey eşiğin
#: AYIRT EDİCİLİĞİ olduğundan dar tutulur; testin kendi süresi kadar zaman
#: geçse bile taraf değiştirmeyecek kadar da geniştir.
_SINIR_PAYI = datetime.timedelta(minutes=2)


async def _stock(db, product_id: int) -> int:
    return (
        await db.execute(
            text("SELECT stock FROM products WHERE id = :i"), {"i": product_id}
        )
    ).scalar()


async def _sale_hareketleri(db, order_id: int) -> int:
    """Bu siparişe yazılmış SALE stok hareketi sayısı (defter append-only)."""
    return (
        await db.execute(
            text(
                "SELECT count(*) FROM stock_movements "
                "WHERE ref_type = 'order' AND ref_id = :o AND movement_type = 'SALE'"
            ),
            {"o": order_id},
        )
    ).scalar()


def _simdi() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _yas_esigi() -> datetime.timedelta:
    """Bir checkout'un 'bayat' sayılması için gereken en küçük yaş (AYARDAN)."""
    esik = datetime.timedelta(minutes=settings.CHECKOUT_RECONCILE_MIN_AGE_MINUTES)
    assert esik > _SINIR_PAYI, (
        "CHECKOUT_RECONCILE_MIN_AGE_MINUTES sınır payından küçük — eşiğin iki "
        "yanına örnek konamıyor"
    )
    return esik


def _bayat_an(pay: datetime.timedelta = _SINIR_PAYI) -> datetime.datetime:
    """Reconciler'ın işlemesi gereken bir `updated_at` — eşik AYARINDAN türetilir.

    Sabit bir "2 saat" yazmak, eşik ayarı değiştiğinde testi sessizce yalancı
    kırmızıya çevirirdi; ayrıca üst yaş sınırı küçültülürse fark edilmezdi.
    """
    now = _simdi()
    an = now - (_yas_esigi() + pay)
    ust = datetime.timedelta(hours=settings.CHECKOUT_RECONCILE_MAX_AGE_HOURS)
    assert an > now - ust, (
        "örnek kayıt üst yaş sınırının dışında kalıyor — reconciler kapsamı dışı"
    )
    return an


def _taze_an(pay: datetime.timedelta = _SINIR_PAYI) -> datetime.datetime:
    """Reconciler'ın DOKUNMAMASI gereken bir `updated_at` (eşiğin hemen altı)."""
    return _simdi() - (_yas_esigi() - pay)


async def _updated_at_ayarla(db, order_id: int, an: datetime.datetime) -> None:
    """`updated_at`'i doğrudan yaz — ORM `onupdate`'i bu alanı geri ezer."""
    await db.execute(
        text("UPDATE orders SET updated_at = :t WHERE id = :i"),
        {"t": an, "i": order_id},
    )
    await db.commit()


def _tarama_kapisini_ac(monkeypatch) -> None:
    """Bayat-checkout taramasının hız sınırını ORTAMDAN BAĞIMSIZ biçimde aç.

    Üretimde tarama ``CHECKOUT_RECONCILE_INTERVAL_SECONDS``ta bir koşar ve
    sayaç ``time.monotonic()`` ile karşılaştırılır. Sayacı ``0.0``a çekmek
    "en son AÇILIŞ anında tarandı" demektir: kapı yalnız makine eşik kadar
    süredir açıksa açılır. Uzun süredir açık geliştirme makinesinde geçen,
    TAZE başlatılmış bir CI runner'ında (monotonic ~ birkaç yüz saniye)
    ``handled == 0`` ile kırılan test buradan doğar. Aralığın kendisini
    sıfırlamak monotonic'in değerinden bağımsızdır ve aynı testte arka arkaya
    tarama yapılmasına da izin verir.
    """
    from services import escrow_reconciler

    monkeypatch.setattr(
        escrow_reconciler.settings, "CHECKOUT_RECONCILE_INTERVAL_SECONDS", 0
    )
    # Modül global'i: elle atama testten sızardı, monkeypatch geri alır.
    monkeypatch.setattr(escrow_reconciler, "_last_checkout_scan", 0.0)


class _CheckoutSaglayici:
    """`retrieve_checkout` çağrılarını KAYDEDEN sahte sağlayıcı.

    Paketin genel `fake_provider`'ında bu metot yoktur (reconciler orada
    bilerek no-op'tur), bu yüzden bayat-checkout senaryoları kendi
    sağlayıcısını takar.
    """

    def __init__(self, *, provider_ref: str, paid_price: str) -> None:
        self.provider_ref = provider_ref
        self.paid_price = Decimal(paid_price)
        self.calls: list[str] = []

    async def retrieve_checkout(self, *, token: str):
        self.calls.append(token)
        return SimpleNamespace(
            success=True, provider_ref=self.provider_ref, paid_price=self.paid_price
        )

    async def refund(self, **kw):  # pragma: no cover
        raise AssertionError("bu senaryoda iade beklenmiyor")

    async def refund_state(self, **kw):  # pragma: no cover
        from core.payments.base import RefundState

        return RefundState.UNKNOWN


def _saglayiciyi_tak(monkeypatch, provider) -> None:
    """Ödeme sağlayıcısını değiştir.

    `escrow_reconciler`, `order_service` ve `escrow` üçü de ``from core import
    payments`` ile AYNI modül nesnesini tutar; tek yerde değiştirmek üçünü de
    kapsar.
    """
    from core import payments

    monkeypatch.setattr(payments, "get_payment_provider", lambda: provider)


# ── E1: müşteri iptali (ödenmiş sipariş) ─────────────────────────────────────


async def test_E1_musteri_odenmis_siparisi_iptal_edebilir(db, factory, fake_provider):
    """Ekspertiz ÖNCESİ de var olan lazy-load hatasını yakalar.

    `cancel_by_client` → `_lock_order` (refresh) → `_refund_payment` →
    `_restock` (order.items). İlişki geri yüklenmezse burada MissingGreenlet
    fırlar ve müşteri siparişini hiç iptal edemez.
    """
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="150.00", stock=4)
    order = await factory.order(
        db,
        client=client,
        items=[(product, 2)],
        payment_status="PAID",
        status="PAID",
        provider_ref="txn-e1",
    )
    await db.commit()
    full = await order_service._load_full(db, order.id)

    out = await order_service.cancel_by_client(db, full)

    assert out.status == "CANCELLED"
    assert await _stock(db, product.id) == 6, "stok geri yüklenmeli"
    assert fake_provider.refunds, "ödeme iade edilmeli"


# ── E2: kargolanmış sipariş iptal edilemez ───────────────────────────────────


async def test_E2_kargolanmis_siparis_iptal_edilemez(db, factory, fake_provider):
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="150.00", stock=4)
    order = await factory.order(
        db,
        client=client,
        items=[(product, 1)],
        payment_status="PAID",
        status="SHIPPED",
        provider_ref="txn-e2",
    )
    await db.commit()
    full = await order_service._load_full(db, order.id)

    with pytest.raises(HTTPException) as exc:
        await order_service.cancel_by_client(db, full)
    assert exc.value.status_code == 409
    assert fake_provider.refunds == [], "iptal edilemeyen siparişte para hareketi olmamalı"


# ── E3: kayıp callback → reconciler ──────────────────────────────────────────


async def test_E3_kayip_callback_reconciler_tarafindan_kesinlestirilir(
    db, factory, monkeypatch
):
    """Müşteri iyzico'da ödedi, tarayıcıyı kapattı: callback hiç gelmedi.

    Sipariş PENDING kalırsa para çekilmiştir ama kitap gönderilmez ve kimse
    fark etmez. Reconciler bu durumu sağlayıcıdan doğrulayıp kapatmalıdır.

    Yalnız `handled` sayısına bakmak yeterli değildir (sipariş başka bir yoldan
    da PAID görünebilirdi): sağlayıcının GERÇEKTEN ve DOĞRU token'la
    sorgulandığı, siparişin sağlayıcı işlem kimliğiyle kesinleştiği ve stok
    hareketinin TAM BİR KEZ yazıldığı da doğrulanır.
    """
    from services import escrow_reconciler

    client = await factory.client(db)
    product = await factory.product(db, price="90.00", stock=5)
    order = await factory.order(
        db, client=client, items=[(product, 1)], provider_ref="cf-lost"
    )
    # Kaydı "bayat" yap: eşik + açık güvenlik payı (sabit süre DEĞİL).
    await _updated_at_ayarla(
        db, order.id, _bayat_an(pay=datetime.timedelta(minutes=30))
    )

    saglayici = _CheckoutSaglayici(provider_ref="txn-lost", paid_price="90.00")
    _saglayiciyi_tak(monkeypatch, saglayici)
    _tarama_kapisini_ac(monkeypatch)

    handled = await escrow_reconciler.reconcile_stale_checkouts(db)

    from models.store import Order

    o = await db.get(Order, order.id)
    await db.refresh(o)
    assert handled >= 1, "reconciler kaydı işlemeliydi"
    assert saglayici.calls.count("cf-lost") == 1, (
        f"sağlayıcı saklı CF token'ıyla tam bir kez sorgulanmalı: {saglayici.calls}"
    )
    assert o.payment_status == "PAID", f"sipariş {o.payment_status} kaldı"
    assert o.provider_ref == "txn-lost", (
        "sağlayıcı işlem kimliği yazılmalı — iade bu referansla yapılır"
    )
    assert o.paid_at is not None, "ödeme anı damgalanmalı"
    assert await _stock(db, product.id) == 4, "stok düşmeli (sipariş kesinleşti)"
    assert await _sale_hareketleri(db, order.id) == 1, (
        "stok hareketi tam bir kez yazılmalı"
    )


# ── E3a/E3b: yaş eşiği sınırı ────────────────────────────────────────────────


async def test_E3a_esikten_yeni_checkout_islenmez(db, factory, monkeypatch):
    """Eşiğin ALTINDAKİ checkout'a dokunulmaz.

    Kullanıcı hâlâ 3DS ekranında olabilir; erken "tamamlandı" demek gerçek
    callback ile yarışa girer. Sağlayıcıya gidilmemesi bunun kanıtıdır.
    """
    from services import escrow_reconciler

    client = await factory.client(db)
    product = await factory.product(db, price="90.00", stock=5)
    order = await factory.order(
        db, client=client, items=[(product, 1)], provider_ref="cf-taze"
    )
    await _updated_at_ayarla(db, order.id, _taze_an())

    saglayici = _CheckoutSaglayici(provider_ref="txn-taze", paid_price="90.00")
    _saglayiciyi_tak(monkeypatch, saglayici)
    _tarama_kapisini_ac(monkeypatch)

    await escrow_reconciler.reconcile_stale_checkouts(db)

    from models.store import Order

    o = await db.get(Order, order.id)
    await db.refresh(o)
    assert "cf-taze" not in saglayici.calls, (
        "eşikten yeni kayıt için sağlayıcıya gidilmemeli"
    )
    assert o.payment_status == "PENDING", f"sipariş {o.payment_status} oldu"
    assert o.paid_at is None
    assert await _stock(db, product.id) == 5, "stok değişmemeli"
    assert await _sale_hareketleri(db, order.id) == 0, "stok hareketi yazılmamalı"


async def test_E3b_esikten_eski_checkout_islenir(db, factory, monkeypatch):
    """Eşiği YENİ geçmiş checkout işlenir — E3a ile aynı ortamda karşıt kutup."""
    from services import escrow_reconciler

    client = await factory.client(db)
    product = await factory.product(db, price="90.00", stock=5)
    order = await factory.order(
        db, client=client, items=[(product, 1)], provider_ref="cf-esik"
    )
    await _updated_at_ayarla(db, order.id, _bayat_an())

    saglayici = _CheckoutSaglayici(provider_ref="txn-esik", paid_price="90.00")
    _saglayiciyi_tak(monkeypatch, saglayici)
    _tarama_kapisini_ac(monkeypatch)

    handled = await escrow_reconciler.reconcile_stale_checkouts(db)

    from models.store import Order

    o = await db.get(Order, order.id)
    await db.refresh(o)
    assert handled >= 1
    assert saglayici.calls.count("cf-esik") == 1, saglayici.calls
    assert o.payment_status == "PAID", f"sipariş {o.payment_status} kaldı"
    assert await _sale_hareketleri(db, order.id) == 1


# ── E4: sarkan REFUNDING talebi reconciler kapsamında ────────────────────────


async def test_E4_sarkan_iade_talebi_reconciler_hedeflerinde(db):
    """Kısmi iade sağlayıcı çağrısında süreç ölürse talep REFUNDING'de kalır."""
    from models.store import OrderReturn
    from services import escrow_reconciler

    models = [m for m, _spec in escrow_reconciler._REFUNDING_TARGETS]
    assert OrderReturn in models, (
        "OrderReturn reconciler hedefi değil — sarkan iadeler sonsuza dek kalır"
    )
