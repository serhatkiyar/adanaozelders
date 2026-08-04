"""Sipariş iadesi iki fazlıdır (ekspertiz P0-4).

Eski akış: önce sağlayıcı iadesi, sonra durum yazımı. Sağlayıcı iadesi başarılı
olup commit düşerse para gitmiş, sipariş PAID görünür, stok geri yüklenmemiş ve
hiçbir iz kalmamış olurdu — yönetici tekrar denediğinde İKİNCİ iade giderdi.

Yeni akış (ders/bilet/rezervasyon yollarıyla aynı):
  Faz 1  begin_refund : PAID→REFUNDING + niyet damgası, HEMEN commit
  Faz 2  perform_refund: sağlayıcı iadesi → REFUNDING→REFUNDED
  Faz 2b telafiler     : stok (defter) + kupon — YALNIZ Faz 2 başarılıysa

Stok defteri paketi (commit 5) telafilerin yerini değiştirdi: eskiden sağlayıcı
çağrısından ÖNCE yapılıyorlardı, yani sağlayıcı reddettiğinde para dönmemişken
stok artmış oluyordu. Ürün kilitleri yine sağlayıcıdan ÖNCE alınır (kanonik
kilit sırası Product → Order; ayrıntı: docs/stok-hareket-defteri-plani.md §4e).

Süreç nerede ölürse ölsün kayıt sarkan REFUNDING olarak kalır ve reconciler
devralır; HELD/PAID'e geri dönüş yoktur.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException

from models.store import OrderPaymentStatus
from services import escrow, order_service


class _FakeOrder:
    def __init__(
        self,
        *,
        total: str = "300.00",
        coupon_id: int | None = None,
        refund_reserved: str = "0.00",
        refunded_amount: str = "0.00",
    ) -> None:
        self.id = 5
        self.client_id = 42
        self.payment_status = OrderPaymentStatus.PAID.value
        self.total = Decimal(total)
        self.provider_ref = "txn-abc"
        self.refunded_at = None
        self.refund_requested_at = None
        self.refund_attempts = 0
        self.coupon_id = coupon_id
        # İP-2b R17: telafi kararı sağlayıcı sonrası TAZE duruma bakar.
        self.status = "PAID"
        self.refunded_amount = Decimal(refunded_amount)
        # İP-2a: iade para tavanının otoritesi — sağlayıcı çağrısından ÖNCE
        # rezerve edilen toplam (bkz. order_service.reserve_refund).
        self.refund_reserved = Decimal(refund_reserved)
        self.items: list = []


class _FakeResult:
    """`db.execute` dönüşünün saf birim testte ihtiyaç duyulan kadarı."""

    def __init__(self, scalar=None, rowcount: int = 1) -> None:
        self._scalar = scalar
        self.rowcount = rowcount

    def scalar_one_or_none(self):
        return self._scalar

    def scalar_one(self):
        return self._scalar


class _FakeDb:
    """Saf birim testi için asgari oturum.

    İade yolu artık para tavanını (`total - refund_reserved`) ve kesinleşen
    tutarı SQL üzerinden okur/yazar — tavan kararı Python'daki bayat nesneye
    bırakılamaz (İP2A-03/04). Bu yüzden `execute` artık `None` değil,
    okunabilir bir sonuç döndürür.
    """

    def __init__(self, *, kalan: str = "300.00") -> None:
        self.commits = 0
        self.rollbacks = 0
        self.kalan = Decimal(kalan)
        self.statements: list[str] = []

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    async def refresh(self, obj, attribute_names=None) -> None:
        return None

    async def execute(self, stmt, params=None, *a, **kw):
        sql = str(getattr(stmt, "text", stmt))
        self.statements.append(sql)
        if "total - refund_reserved" in sql:
            return _FakeResult(scalar=self.kalan)
        if "SET refund_reserved" in sql:
            return _FakeResult(rowcount=1)
        # `_lock_order`'ın `SELECT ... FOR UPDATE`'i (İP-2b R17) ve
        # `refunded_amount` UPDATE'i. Saf birim testinde satır kilidi anlamlı
        # değil; çağrı kaydedilip yutulur.
        return _FakeResult()


@pytest.fixture
def akis(monkeypatch):
    """begin_refund / perform_refund / _restock / kupon sınırlarını kaydeder."""
    log: dict = {
        "begin": [], "perform": [], "restock": [], "coupon_release": [], "lock": [],
        "transition": [],
    }

    async def fake_restock(db, order, *, reason_code):
        log["restock"].append(order.id)

    async def fake_release(db, *, coupon_id, order_id):
        log["coupon_release"].append(coupon_id)

    monkeypatch.setattr(order_service, "_restock", fake_restock)

    # Ürün kilidi artık sağlayıcı çağrısından ÖNCE alınıyor (kanonik kilit
    # sırası; bkz. plan §4e). Sahte DB gerçek sorgu çalıştıramaz.
    async def fake_lock(db, order):
        log["lock"].append(order.id)

    monkeypatch.setattr(order_service, "_lock_order_products", fake_lock)
    monkeypatch.setattr(order_service.coupon_service, "release", fake_release)

    # İP-2b: telafi kuyruğu artık siparişi TERMİNALE de taşıyor
    # (`settle_refunded_order`). Gerçek `transition_order` durak/paket
    # sorguları çalıştırır; saf birim testinde sınır burada kaydedilir.
    async def fake_transition(db, order, new_status, *, changed_by, reason=None):
        log["transition"].append((order.id, new_status, changed_by))
        order.status = new_status

    monkeypatch.setattr(order_service.order_fsm, "transition_order", fake_transition)
    return log


def _patch_phases(monkeypatch, log, *, begin_ok: bool, perform_ok: bool) -> None:
    async def fake_begin(
        db,
        obj,
        spec,
        *,
        from_statuses=None,
        provider_ref=None,
        extra_values=None,
        extra_where=(),
        refresh_attrs=(),
    ):
        # `extra_values` İP-2a'nın çekirdeği: para rezervasyonu niyetle AYNI
        # atomik UPDATE'e biner. Sınır burada kaydedilir ki "rezervasyon ayrı
        # bir yazıma kaydı" regresyonu görünür olsun.
        log["begin"].append(
            {
                "spec": spec,
                "from_statuses": from_statuses,
                "extra_values": extra_values,
                "extra_where": extra_where,
            }
        )
        if begin_ok:
            obj.payment_status = spec.refunding
        return begin_ok

    async def fake_perform(db, obj, spec, *, notify=None, amount=None):
        log["perform"].append((obj.id, amount))
        if perform_ok:
            obj.payment_status = spec.refunded
        return perform_ok

    monkeypatch.setattr(order_service.escrow, "begin_refund", fake_begin)
    monkeypatch.setattr(order_service.escrow, "perform_refund", fake_perform)


@pytest.mark.asyncio
async def test_basarili_iade_iki_fazi_da_kosar(monkeypatch, akis) -> None:
    _patch_phases(monkeypatch, akis, begin_ok=True, perform_ok=True)
    order = _FakeOrder(coupon_id=9)

    await order_service._refund_payment(
        _FakeDb(), order, reason_code="ORDER_REFUNDED",
        terminal_status="REFUNDED", changed_by="admin",
    )

    assert len(akis["begin"]) == 1
    assert akis["begin"][0]["spec"] is escrow.ORDER_SPEC
    # İP2A-03: sağlayıcıya `total` DEĞİL, henüz rezerve edilmemiş KALAN gider.
    assert akis["perform"] == [(5, Decimal("300.00"))]
    # Rezervasyon niyetle aynı atomik UPDATE'e bindi (ayrı yazım = tavan
    # penceresi = İP2A-04).
    assert akis["begin"][0]["extra_values"] is not None
    assert "refund_reserved" in akis["begin"][0]["extra_values"]
    assert akis["begin"][0]["extra_where"], "rezerv değeri compare-and-swap'siz"
    assert akis["restock"] == [5]          # stok geri yüklendi
    assert akis["coupon_release"] == [9]   # kupon serbest bırakıldı
    assert order.payment_status == OrderPaymentStatus.REFUNDED.value


@pytest.mark.asyncio
async def test_kismi_iade_sonrasi_yalniz_kalan_tutar_gonderilir(
    monkeypatch, akis
) -> None:
    """İP2A-03: kısmen iade edilmiş siparişte tam iade `total`'ı GÖNDERMEZ.

    300 TL'lik siparişten 100 TL rezerve edilmişse sağlayıcıya 200 TL gider.
    Eskiden `ORDER_SPEC.amount_attr='total'` yüzünden 300 TL daha gidiyor,
    toplam 400 TL oluyordu — tek koruma sağlayıcının aşırı-iade reddiydi ve o
    da kısmi tutarları ayırt edemez.
    """
    _patch_phases(monkeypatch, akis, begin_ok=True, perform_ok=True)
    order = _FakeOrder(refund_reserved="100.00", refunded_amount="100.00")

    await order_service._refund_payment(
        _FakeDb(kalan="200.00"), order, reason_code="ORDER_REFUNDED",
        terminal_status="REFUNDED", changed_by="admin",
    )

    assert akis["perform"] == [(5, Decimal("200.00"))]


@pytest.mark.asyncio
async def test_kalan_tutar_yoksa_saglayiciya_hic_gitmez(monkeypatch, akis) -> None:
    """M1: tavanı dolmuş siparişte iade denemesi 409'dur, para hareketi YOK."""
    _patch_phases(monkeypatch, akis, begin_ok=True, perform_ok=True)
    order = _FakeOrder(refund_reserved="300.00", refunded_amount="300.00")

    with pytest.raises(HTTPException) as exc:
        await order_service._refund_payment(
            _FakeDb(kalan="0.00"), order, reason_code="ORDER_REFUNDED",
            terminal_status="REFUNDED", changed_by="admin",
        )

    assert exc.value.status_code == 409
    assert akis["begin"] == [] and akis["perform"] == []
    assert akis["restock"] == []


@pytest.mark.asyncio
async def test_claim_edilemezse_para_hareketi_yok(monkeypatch, akis) -> None:
    """Eşzamanlı ikinci iade/iptal: kaybeden taraf sağlayıcıya HİÇ gitmemeli."""
    _patch_phases(monkeypatch, akis, begin_ok=False, perform_ok=True)
    order = _FakeOrder()

    with pytest.raises(HTTPException) as exc:
        await order_service._refund_payment(
        _FakeDb(), order, reason_code="ORDER_REFUNDED",
        terminal_status="REFUNDED", changed_by="admin",
    )

    assert exc.value.status_code == 409
    assert akis["perform"] == []   # sağlayıcı çağrılmadı
    assert akis["restock"] == []   # stok iki kez geri yüklenmedi
    assert order.payment_status == OrderPaymentStatus.PAID.value


@pytest.mark.asyncio
async def test_saglayici_reddederse_refunding_de_kalir(monkeypatch, akis) -> None:
    """PAID'e geri dönüş YOK — kayıt sarkan REFUNDING kalır, reconciler devralır."""
    _patch_phases(monkeypatch, akis, begin_ok=True, perform_ok=False)
    order = _FakeOrder()
    db = _FakeDb()

    with pytest.raises(HTTPException) as exc:
        await order_service._refund_payment(
            db, order, reason_code="ORDER_REFUNDED",
            terminal_status="REFUNDED", changed_by="admin",
        )

    assert exc.value.status_code == 502
    assert order.payment_status == OrderPaymentStatus.REFUNDING.value

    # ⚠️ DAVRANIŞ DEĞİŞTİ (stok defteri paketi, commit 5).
    #
    # ÖNCEKİ kural: sağlayıcı reddetse bile stok geri yüklenirdi. Gerekçesi
    # "iade eninde sonunda tamamlanacak; bu arada stoğun kayıp görünmesi
    # müşteriye satış kaybettirir" idi.
    #
    # YENİ kural: **para dönmeden mal geri gelmiş sayılmaz.** Sağlayıcı
    # reddettiğinde stok ARTMAZ. Gerekçe: iyimser geri yükleme, tamamlanmamış
    # bir iadeyi satılabilir stok gibi gösteriyordu; iade hiç tamamlanmazsa
    # (ör. kalıcı sağlayıcı hatası, elle iptal) stok kalıcı olarak şişiyordu ve
    # bunun defterde hiçbir izi yoktu. Artık telafi yalnız Faz 2 başarılıysa
    # uygulanır; başarısızlıkta kayıt REFUNDING'de kalır ve reconciler tekrar
    # dener — retry aynı `order_item:{id}:SALE_CANCEL` anahtarını ürettiği için
    # hareket TEK KEZ uygulanır (gerçek PG testi:
    # `test_stock_writers_pg.py::test_saglayici_basarili_ama_ikinci_faz_coktu_retry_tek_uygular`).
    assert akis["restock"] == []
    assert db.commits >= 1


@pytest.mark.asyncio
async def test_kuponsuz_siparis_release_cagirmaz(monkeypatch, akis) -> None:
    _patch_phases(monkeypatch, akis, begin_ok=True, perform_ok=True)
    await order_service._refund_payment(
        _FakeDb(), _FakeOrder(coupon_id=None), reason_code="ORDER_REFUNDED",
        terminal_status="REFUNDED", changed_by="admin",
    )
    assert akis["coupon_release"] == []


# ── ORDER_SPEC sözleşmesi ────────────────────────────────────────────────────


def test_order_spec_dogru_kolonlari_isaret_eder() -> None:
    spec = escrow.ORDER_SPEC
    # Para durumu `payment_status`'ta; `status` sipariş yaşam döngüsüdür.
    assert spec.status_attr == "payment_status"
    # Sipariş toplamı `total` (escrow modellerinde `amount`).
    assert spec.amount_attr == "total"
    # Mağaza doğrudan satıştır: hak ediş dağıtımı yok → released_at guard'ı yok.
    assert spec.has_released_guard is False
    assert spec.held == OrderPaymentStatus.PAID.value
    assert spec.refunding == OrderPaymentStatus.REFUNDING.value
    assert spec.refunded == OrderPaymentStatus.REFUNDED.value
    assert spec.reference_prefix == "order"


def test_diger_specler_varsayilanlari_korur() -> None:
    """Genelleştirme mevcut üç yüzeyin davranışını değiştirmemeli."""
    for spec in (escrow.PAYMENT_SPEC, escrow.EXAM_SPEC, escrow.STUDY_SPEC):
        assert spec.status_attr == "status"
        assert spec.amount_attr == "amount"
        assert spec.has_released_guard is True
