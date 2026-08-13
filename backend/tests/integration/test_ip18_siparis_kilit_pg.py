"""İP-18 — sipariş ödeme kesinleştirmesi ↔ iptal yarışı (GERÇEK PostgreSQL).

## Doğrulanmış kusur (Faz 1 ölçümü, deterministik olarak üretildi)

`order_service.complete_checkout` (`:614`) sipariş satırını **kilitlemez** ve
`_finalize_paid`'in atomik PAID claim'i (`:770-777`) yalnız `payment_status`'ü
koşullar. Aradaki pencerede iptal commit ederse:

1. ölü-varlık guard'ı (`:654`) **bayat anlık görüntüyü** kontrol eder,
2. `escrow.claim` `payment_status IN (PENDING, FAILED)` gördüğü için başarılı olur,
3. `transition_order` bayat ORM nesnesinin `PENDING`'ini okur ve satır
   `CANCELLED` iken `PAID` yazılır (**kayıp güncelleme**).

Ölçülen sonuç: `('PAID','PAID')`, geçmiş
`[('PENDING','CANCELLED','client'), ('PENDING','PAID','system:payment')]`,
sağlayıcı iade çağrısı **0**, üstelik deftere `SALE −3` yazılıyor. Para
tahsil edilmiş, iade edilmemiş ve sonuç `PAID/PAID` olduğu için **anomali
hiçbir sorgudan görünmüyor** — kayıp güncelleme kendi kanıtını siliyor.

Aynı kusuru **üç giriş noktası** taşır ve üçü de burada ölçülür:
`complete_checkout` (tarayıcı callback'i) · `pay()` → `_charge` →
`_finalize_paid` · `escrow_reconciler.reconcile_stale_checkouts`.

## Determinizm — `asyncio.gather` YOK

Pencere elle zorlanır: `stock_ledger.lock_products` kancası, checkout'un
ölü-varlık guard'ından SONRA ve atomik claim'inden ÖNCE iptali koşturur;
`pay()` yolunda pencere sağlayıcı `charge` kapısıyla (asyncio.Event) açılır.
`sleep` kullanılmaz, hiçbir düğüm zamanlamaya bahis oynamaz.

Gerekçe (TB-36): bu yarışı bugün ölçebilen TEK mevcut test
`callback::test_yesil_iptal_callback_yarisinda_cift_durum_yok` ve o
`asyncio.gather` ile kurulu — 13 Ağu'da CI'da düştü, bu makinede **10
koşumun 10'unda yeşil**. `races::test_yesil_cift_musteri_iptali_tek_kazanan`
ise bu yarışa yapısal olarak **hiç erişemiyor**: ölçüldü, `complete_checkout`
çağrı sayısı **0** (İP-18 Faz 1, çağrı sayacı eklentisi).

⚠️ **Açık karar (Faz 5'te sözleşmeye bağlanacak):** o `gather` testi
`59afdac` turunda kusurlu kodda 10 koşumda yalnız 2 kez kırılıyordu (%20) ve
bugünkü yarışı %0 yakalıyor. Yanına deterministik ikiz konmasına rağmen
kendisine DOKUNULMADI (İP-2b'nin kararı). Bunun bilinçli bir "ucuz ek
kapsam" kararı mı yoksa borç mu olduğu **karara bağlanmalıdır**; bu dosya
kararı vermez, yalnız ölçümü kaydeder.

## Sözleşme (bu dosyanın çivilediği davranış)

**I-18/1 (yasak bileşim):** `orders.status IN (CANCELLED, REFUNDED)` iken
`payment_status = 'PAID'` OLAMAZ — hiçbir giriş noktasından, hiçbir
sıralamada.

**I-18/2 (para kaybolmaz):** İptal edilmiş siparişe gelen doğrulanmış
tahsilat **aynen iade edilir** (İP-2b R10 sözleşmesi); sessizce yutulmaz.

**I-18/3 (stok):** İptal edilmiş siparişe **hiç** stok hareketi yazılmaz —
ne `SALE` ne `SALE_CANCEL`. Satış hiç gerçekleşmedi; PK-α gereği stok yalnız
fiziksel teslim/kabulle hareket eder. "Yanlış yaz + tersini yaz" bir telafi
DEĞİLDİR: defter append-only'dir, iki kayıt kalıcı gürültü bırakır ve
`SALE_CANCEL` "satılmış mal geri geldi" anlamına gelir.

**I-18/4 (kilit sırası):** Düzeltme kilit ile YAPILMAZ. Kanonik sıra
`Product → Order → OrderReturn`'dür; `complete_checkout` yoluna Order satır
kilidi eklemek bu yolu `Order → Product` yapar.
"""
from __future__ import annotations

import asyncio
import datetime
from decimal import Decimal

import pytest
from sqlalchemy import event, text

from core.config import settings
from core.database import AsyncSessionLocal, engine
from core.payments.base import CheckoutResult
from models.booking import BookingStatus
from models.payment import PaymentStatus
from services import (
    escrow,
    escrow_reconciler,
    order_service,
    payment_service,
    stock_ledger,
)
from tests.integration.conftest import StubProvider
from tests.integration.ip1a_factory import ip1a  # noqa: F401 — fixture kaydı

pytestmark = pytest.mark.asyncio

BEKLEME = 30  # saniye; kapılar SÜRELİDİR (sonuçlanmayan test kırmızıdır)


# ── Ortak yardımcılar ────────────────────────────────────────────────────────


async def _iptal(oid: int) -> None:
    """Müşteri iptali — AYRI session, kendi transaction'ı, commit eder."""
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        await order_service.cancel_by_client(s, order)


async def _satir(oid: int) -> tuple[str, str]:
    async with AsyncSessionLocal() as s:
        return tuple(
            (
                await s.execute(
                    text("SELECT status, payment_status FROM orders WHERE id = :o"),
                    {"o": oid},
                )
            ).one()
        )


def _iptal_penceresi(monkeypatch, oid: int) -> dict:
    """Checkout'un içine BİR KEZ açılan deterministik iptal penceresi.

    Kanca `stock_ledger.lock_products`'tadır: `_finalize_paid` onu ölü-varlık
    guard'ından SONRA, atomik PAID claim'inden ÖNCE çağırır — yani tam olarak
    kusurun penceresinde. Sağlayıcı kapısı kullanılamaz, çünkü başarı yolunda
    `complete_checkout` ile claim arasında hiçbir sağlayıcı çağrısı yoktur.

    Dönen sözlüğün `oldu` alanı testte ASSERT EDİLİR: kanca çalışmadıysa
    pencere hiç kurulmamıştır ve test yeşil görünse bile hiçbir şey
    kanıtlamamıştır (yalancı yeşil kapısı).
    """
    tetik = {"oldu": False}
    orijinal = stock_ledger.lock_products

    async def kancali(db, product_ids):
        if not tetik["oldu"]:
            tetik["oldu"] = True
            await _iptal(oid)
        return await orijinal(db, product_ids)

    monkeypatch.setattr(stock_ledger, "lock_products", kancali)
    return tetik


BIRIM_FIYAT = Decimal("100.00")


async def _odenmemis_siparis(fab, *, adet: int = 3, stok: int = 10):
    """PENDING/PENDING fiziksel sipariş + müşteri. (pid, cid, oid, tutar) döner."""
    pid = await fab.urun(stock=stok)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(
        items=[(pid, adet, "PHYSICAL", str(BIRIM_FIYAT))],
        client_id=cid,
        status="PENDING",
        payment_status="PENDING",
        provider_ref="ip18-cf-token",
    )
    return pid, cid, oid, BIRIM_FIYAT * adet


async def _callback(oid: int, tutar: Decimal) -> None:
    """Sunucuda doğrulanmış iyzico callback'i.

    `paid_price` sipariş toplamına EŞİT verilir; eşit olmazsa `complete_checkout`
    tahsilatı "beklenmeyen" sayıp iade eder ve test ölçmek istediği yola hiç
    varmaz (bu tuzağa bir kez düşüldü: sabit 300.00 ile kurulan iki düğüm,
    kusuru değil `paidPrice` uyuşmazlığı dalını ölçüyordu).
    """
    async with AsyncSessionLocal() as s:
        await order_service.complete_checkout(
            s,
            order_id=oid,
            success=True,
            provider_ref="ip18-pay-ref",
            token="ip18-cf-token",
            paid_price=tutar,
        )


async def _event_bekle(ev: asyncio.Event, ne: str) -> None:
    """Kapıyı SÜRELİ bekler — açılmazsa test kırmızı olur, sonsuza asılmaz."""
    try:
        await asyncio.wait_for(ev.wait(), timeout=BEKLEME)
    except TimeoutError:  # pragma: no cover — kurgu bozulduğunda
        pytest.fail(f"kurgu bozuldu: '{ne}' {BEKLEME} sn içinde gerçekleşmedi")


# ── D1 · Callback girişi: iptal commit'inden sonra PAID yazılamaz ────────────


async def test_kirmizi_callback_iptal_sonrasi_paid_yazamaz(fab, provider, monkeypatch):
    """[I-18/1] Ölçülen kusur: satır `CANCELLED` iken `PAID` yazılıyor.

    Bugün: `('PAID','PAID')` — iptal geçmişte duruyor ama satırda izi yok.
    """
    _pid, _cid, oid, tutar = await _odenmemis_siparis(fab)
    tetik = _iptal_penceresi(monkeypatch, oid)

    await _callback(oid, tutar)

    assert tetik["oldu"], "kurgu bozuldu — iptal penceresi hiç açılmadı"
    durum, odeme = await _satir(oid)
    gecmis = await fab.history(oid)
    assert durum == "CANCELLED", (
        f"iptal edilmiş sipariş '{durum}' oldu (ödeme {odeme}); geçmiş: {gecmis}"
    )
    assert not (durum in ("CANCELLED", "REFUNDED") and odeme == "PAID"), (
        f"yasak bileşim: {durum}/{odeme}"
    )
    assert [h for h in gecmis if h[1] == "PAID"] == [], (
        f"iptal edilmiş siparişe PAID geçişi yazıldı: {gecmis}"
    )


# ── D3 · Para kaybolmaz: geç tahsilat iade edilir ────────────────────────────


async def test_kirmizi_iptal_sonrasi_tahsilat_iade_edilir(fab, provider, monkeypatch):
    """[I-18/2] Tahsilat varlığa bağlanamıyorsa aynen iade edilir (R10).

    Bugün: iade dalı HİÇ çalışmıyor — `provider.refund_calls == []`, yani
    müşterinin parası alınmış ve hiçbir yere bağlanmamış.
    """
    _pid, _cid, oid, tutar = await _odenmemis_siparis(fab)
    tetik = _iptal_penceresi(monkeypatch, oid)

    await _callback(oid, tutar)

    assert tetik["oldu"], "kurgu bozuldu — iptal penceresi hiç açılmadı"
    assert len(provider.refund_calls) == 1, (
        f"geç tahsilat iade edilmedi (çağrılar: {provider.refund_calls})"
    )
    assert provider.refund_calls[0][1] == Decimal("300.00")
    _durum, odeme = await _satir(oid)
    assert odeme == "REFUNDED", f"ödeme kaydı askıda kaldı: {odeme}"
    assert await fab.audit_kayitlari(
        action="order.late_charge_refunded", target_id=oid
    ), "iade audit izine yazılmadı"


# ── D4 · Stok: ne SALE ne SALE_CANCEL ────────────────────────────────────────


async def test_kirmizi_iptal_edilmis_siparise_stok_hareketi_yazilmaz(
    fab, provider, monkeypatch
):
    """[I-18/3] Doğru davranış "hiç hareket yok"tur.

    Bugün: `SALE −3` yazılıyor ve stok 10 → 7 düşüyor. Bu satış hiç olmadı.

    Tersinin de yasak olduğunu ölçmek gerekiyor: düzeltme "önce SALE yaz,
    sonra SALE_CANCEL ile geri al" biçiminde yapılırsa satır sayısı sıfırlanmaz
    — defter append-only'dir, iki kalıcı gürültü satırı kalır ve `SALE_CANCEL`
    "satılmış mal geri geldi" anlamına gelir (PK-α ile çelişir).
    """
    pid, _cid, oid, tutar = await _odenmemis_siparis(fab, adet=3, stok=10)
    # Taban çizgisi: ürünün kuruluş hareketi (`INITIAL`) zaten defterdedir.
    # "Hiç hareket yok" iddiası mutlak sıfır DEĞİL, **delta sıfır**dır; mutlak
    # yazmak testi fabrikanın uygulama ayrıntısına bağlardı.
    onceki = await fab.hareketler(pid)
    tetik = _iptal_penceresi(monkeypatch, oid)

    await _callback(oid, tutar)

    assert tetik["oldu"], "kurgu bozuldu — iptal penceresi hiç açılmadı"
    sonraki = await fab.hareketler(pid)
    yeni = sonraki[len(onceki):]
    assert yeni == [], f"iptal edilmiş siparişe stok hareketi yazıldı: {yeni}"
    assert await fab.stok(pid) == 10, "stok değişti — satış hiç gerçekleşmedi"


# ── D5 · İkinci giriş: pay() → _charge → _finalize_paid ──────────────────────


class KapiliSaglayici(StubProvider):
    """`charge` çağrısını kapıda bekleten sağlayıcı.

    `StubProvider` yalnız `refund` kapısı taşıyor; onu DEĞİŞTİRMİYORUZ (yedi
    paketin ortak fixture'ı — sessiz davranış kayması riski). Kapı burada, İP-18
    kapsamında, alt sınıfta ekleniyor.
    """

    def __init__(self) -> None:
        super().__init__()
        self.charge_gate: asyncio.Event | None = None
        self.charge_entered: asyncio.Event = asyncio.Event()

    async def charge(self, **kw):
        self.charge_entered.set()
        if self.charge_gate is not None:
            await self.charge_gate.wait()
        return await super().charge(**kw)


@pytest.fixture
def kapili_provider(monkeypatch) -> KapiliSaglayici:
    stub = KapiliSaglayici()
    from core import payments

    monkeypatch.setattr(payments, "get_payment_provider", lambda: stub)
    return stub


async def test_kirmizi_pay_yolu_da_ayni_kosula_tabi(fab, kapili_provider):
    """[I-18/1] `pay()` yolunun kendi guard'ı (`order.status == 'CANCELLED'`,
    `:577`) da kilitsiz ve bayat okunur.

    Gerçekçi senaryo: müşteri "Öde"ye basar; sağlayıcıdayken sipariş başka bir
    yüzeyden (ikinci sekme, yönetici) iptal edilir. Pencere sağlayıcı `charge`
    kapısıyla açılır — kanca değil, gerçek dış çağrı sınırı.
    """
    _pid, _cid, oid, tutar = await _odenmemis_siparis(fab)
    kapili_provider.charge_gate = asyncio.Event()

    async def _ode() -> None:
        async with AsyncSessionLocal() as s:
            order = await order_service._load_full(s, oid)
            await order_service.pay(s, order)

    gorev = asyncio.create_task(_ode())
    try:
        await _event_bekle(kapili_provider.charge_entered, "sağlayıcı charge kapısı")
        await _iptal(oid)
        assert (await _satir(oid))[0] == "CANCELLED", "kurgu bozuldu — iptal olmadı"
    finally:
        kapili_provider.charge_gate.set()
        await asyncio.wait_for(gorev, timeout=BEKLEME)

    durum, odeme = await _satir(oid)
    assert not (durum in ("CANCELLED", "REFUNDED") and odeme == "PAID"), (
        f"yasak bileşim (pay yolu): {durum}/{odeme}"
    )
    assert durum == "CANCELLED", f"iptal edilmiş sipariş '{durum}' oldu"


# ── D6 · Üçüncü giriş: reconciler (bayat checkout taraması) ──────────────────


class CheckoutSaglayici(StubProvider):
    """`retrieve_checkout` destekli stub — bayat-checkout taraması yalnız bu
    yeteneği olan sağlayıcıda koşar (iyzico'nun test ikizi)."""

    def __init__(self) -> None:
        super().__init__()
        self.checkouts: dict[str, CheckoutResult] = {}

    async def retrieve_checkout(self, *, token: str) -> CheckoutResult:
        return self.checkouts.get(token, CheckoutResult(success=False))


@pytest.fixture
def checkout_provider(monkeypatch) -> CheckoutSaglayici:
    stub = CheckoutSaglayici()
    from core import payments

    monkeypatch.setattr(payments, "get_payment_provider", lambda: stub)
    return stub


async def _bayatlat(oid: int) -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE orders SET updated_at = now() - interval '1 hour' "
                "WHERE id = :o"
            ),
            {"o": oid},
        )
        await s.commit()


async def _bir_tur_mutabakat() -> None:
    escrow_reconciler._last_checkout_scan = 0.0
    eski = settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS
    settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS = 0
    try:
        async with AsyncSessionLocal() as s:
            await escrow_reconciler.reconcile_stale_checkouts(s)
    finally:
        settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS = eski


async def test_kirmizi_reconciler_yolu_da_ayni_kosula_tabi(
    fab, checkout_provider, monkeypatch
):
    """[I-18/1] Reconciler `complete_checkout`'un İKİNCİ çağıranıdır
    (`escrow_reconciler.py:575`) ve üretimde tarayıcı callback'inden daha
    güvenilir biçimde koşar — aynı pencereyi o da taşır.
    """
    _pid, _cid, oid, tutar = await _odenmemis_siparis(fab)
    checkout_provider.checkouts["ip18-cf-token"] = CheckoutResult(
        success=True, provider_ref="ip18-pay-ref", paid_price=Decimal("300.00")
    )
    await _bayatlat(oid)
    tetik = _iptal_penceresi(monkeypatch, oid)

    await _bir_tur_mutabakat()

    assert tetik["oldu"], "kurgu bozuldu — reconciler siparişi hiç işlemedi"
    durum, odeme = await _satir(oid)
    assert not (durum in ("CANCELLED", "REFUNDED") and odeme == "PAID"), (
        f"yasak bileşim (reconciler yolu): {durum}/{odeme}"
    )
    assert durum == "CANCELLED", f"iptal edilmiş sipariş '{durum}' oldu"


async def test_yesil_reconciler_taramasi_olu_siparisi_de_kapsar(
    fab, checkout_provider
):
    """[D11 · YEŞİL NÖBETÇİ] Bayat-checkout taraması ÖLÜ siparişi de görmeli.

    İP-18 `escrow_reconciler`'a "buraya `orders.status` filtresi EKLEME" kuralı
    koydu (yorumla). Kuralın nöbetçisi paketin KENDİ içinde olmalı: bu tarama
    iki iş birden yapar — canlı siparişi kesinleştirmek **ve** ölü siparişe
    gelmiş tahsilatı iade ettirmek (İP-2b R10). Seçimi
    `PARA_BAGLANABILIR_DURUMLAR` ile daraltmak, iptal edilmiş siparişlerin
    kayıp callback'lerini taramanın görüş alanından çıkarır ve parayı
    sağlayıcıda öksüz bırakır.

    ⚠️ Bu davranışı ölçen ikinci bir test daha var ve BAŞKA PAKETTEDİR:
    `test_ip2b_cancel_callback_pg::test_kirmizi_reconciler_partisi_zehirlenmez`
    (C) kaydı. Mutasyon provası IP18-7 ilk turda YALNIZ onu kırdı — yani
    İP-18'in kuralı komşu paketin testine yaslanıyordu. Bu düğüm o bağımlılığı
    kapatır; öteki test yarın daraltılırsa kural nöbetsiz kalmaz.

    D6'dan farkı: orada sipariş tarama anında hâlâ `PENDING`'dir (iptal
    `complete_checkout`'un içinde commit eder), bu yüzden bir status filtresi
    D6'yı hiç etkilemez.
    """
    _pid, _cid, oid, tutar = await _odenmemis_siparis(fab)
    await _iptal(oid)
    assert (await _satir(oid))[0] == "CANCELLED", "kurgu bozuldu — iptal olmadı"

    checkout_provider.checkouts["ip18-cf-token"] = CheckoutResult(
        success=True, provider_ref="ip18-pay-ref", paid_price=tutar
    )
    await _bayatlat(oid)

    await _bir_tur_mutabakat()

    durum, odeme = await _satir(oid)
    assert (durum, odeme) == ("CANCELLED", "REFUNDED"), (
        f"ölü siparişin bayat checkout'u taranmadı/iade edilmedi: {durum}/{odeme}"
    )
    assert len(checkout_provider.refund_calls) == 1, (
        f"iade tam bir kez olmalı: {checkout_provider.refund_calls}"
    )


# ── D7 · Deterministik ikiz: iki sıralamada da çift durum yok ────────────────


async def test_yesil_iptal_once_callback_sonra_cift_durum_yok(fab, provider):
    """[D7a · YEŞİL NÖBETÇİ] İptal callback'ten ÖNCE tamamen biterse:
    ölü-varlık guard'ı taze veriyi görür ve tahsilat iade edilir (İP-2b R10,
    bugün çalışıyor). Bu sıralamanın regresyona uğramadığını çiviler."""
    _pid, _cid, oid, tutar = await _odenmemis_siparis(fab)
    await _iptal(oid)

    await _callback(oid, tutar)

    durum, odeme = await _satir(oid)
    assert (durum, odeme) == ("CANCELLED", "REFUNDED")
    assert len(provider.refund_calls) == 1


async def test_kirmizi_callback_once_iptal_sonra_cift_durum_yok(
    fab, provider, monkeypatch
):
    """[D7b · KIRMIZI] `callback::test_yesil_iptal_callback_yarisinda_cift_durum_yok`
    ile AYNI invariant, ama pencere deterministik açılıyor.

    Mevcut `gather` testine DOKUNULMADI (İP-2b'nin `59afdac` kararı: nöbetçi
    yanına konur, mevcut olan değiştirilmez). Ölçüm: o test bu makinede 10/10
    yeşil; bu ikiz 1/1 kırmızı.
    """
    _pid, _cid, oid, tutar = await _odenmemis_siparis(fab)
    tetik = _iptal_penceresi(monkeypatch, oid)

    await _callback(oid, tutar)

    assert tetik["oldu"], "kurgu bozuldu — iptal penceresi hiç açılmadı"
    durum, odeme = await _satir(oid)
    assert not (durum == "CANCELLED" and odeme == "PAID"), (
        f"çift durum: {durum}/{odeme}"
    )
    if durum == "PAID":
        pytest.fail(
            "PAID kazandı ama geçmişte CANCELLED var — iptal EZİLDİ: "
            f"{await fab.history(oid)}"
        )


# ── D8 · Mutlu yol bozulmamalı ───────────────────────────────────────────────


async def test_yesil_iptalsiz_checkout_bozulmaz(fab, provider):
    """[D8 · YEŞİL NÖBETÇİ] Düzeltme, normal ödemeyi kesmemelidir.

    Yaşam döngüsü koşulu fazla dar yazılırsa (ör. `FAILED` payment_status'lü
    yeniden denemeyi dışlarsa) bu test kırılır — düzeltmenin bedeli burada
    ölçülür.
    """
    pid, _cid, oid, tutar = await _odenmemis_siparis(fab, adet=2, stok=8)

    await _callback(oid, tutar)

    assert (await _satir(oid)) == ("PAID", "PAID")
    assert await fab.hareketler(pid, "SALE") == [("SALE", -2)]
    assert await fab.stok(pid) == 6
    assert [h[1] for h in await fab.history(oid)] == ["PAID"]
    assert provider.refund_calls == []


# ── D9 · Kilit sırası nöbetçisi (gerçek SQL gözlemi) ─────────────────────────


async def test_yesil_checkout_yolu_order_kilidini_urunden_once_almaz(fab, provider):
    """[I-18/4 · YEŞİL NÖBETÇİ] Kanonik sıra `Product → Order` korunmalı.

    ## Neden kaynak taraması DEĞİL

    Gerçek `before_cursor_execute` olayıyla, gerçek bir checkout koşumunda
    **gönderilen SQL** gözlenir: `FOR UPDATE ... products` ile `UPDATE orders` /
    `FOR UPDATE ... orders` ifadelerinin sırası ölçülür. AST taraması "kilit
    hangi satırda alınıyor" sorusunu yanıtlar; bu nöbetçi "kilit hangi sırada
    ALINDI" sorusunu yanıtlar.

    ## Neden bu nöbetçi kırmızı BAŞLAMIYOR

    Bugünkü kod zaten doğru sırada. Bu, kusurun nöbetçisi değil **yanlış
    düzeltmenin** nöbetçisidir: en bariz çözüm (`complete_checkout`'un başına
    `_lock_order`) sırayı tersine çevirir. Gücü Faz 4'te mutasyonla
    kanıtlanacaktır (kilit ekle → bu test kırılmalı).

    ## Faz 1 düzeltmesi — dürüstlük notu

    Faz 1'de bu ters sırayı "gerçek deadlock döngüsü" diye raporlamıştım; sonra
    ölçtüm ve **bugünkü FSM'de erişilebilir bir döngü üretilemiyor**: döngü,
    aynı sipariş satırının hem `PENDING` (checkout) hem `PAID` (iade faz-2)
    olmasını gerektiriyor. Yani risk teorik/yapısaldır, bugün tetiklenebilir
    değildir — bu yüzden düğüm "deadlock üretimi" olarak değil "sıra gözlemi"
    olarak kuruldu. `_lock_order_products`'ın kendi gerekçe yorumu da aynı
    yapısal iddiaya dayanır.
    """
    _pid, _cid, oid, tutar = await _odenmemis_siparis(fab, adet=1, stok=4)
    kayit: list[str] = []

    def dinle(conn, cursor, statement, parameters, context, executemany):
        s = " ".join(statement.split()).lower()
        if "for update" in s and "from products" in s:
            kayit.append("product")
        elif s.startswith("update orders") or (
            "for update" in s and "from orders" in s
        ):
            kayit.append("order")

    event.listen(engine.sync_engine, "before_cursor_execute", dinle)
    try:
        await _callback(oid, tutar)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", dinle)

    assert "product" in kayit, f"ürün kilidi hiç alınmadı — kurgu bozuk: {kayit}"
    assert "order" in kayit, f"sipariş yazımı hiç olmadı — kurgu bozuk: {kayit}"
    assert kayit.index("product") < kayit.index("order"), (
        "checkout yolu Order kilidini Product'tan ÖNCE aldı — kanonik sıra "
        f"(Product → Order) bozuldu: {kayit}"
    )


# ── D10 · Booking yüzeyindeki aynı şekil: emniyet kemeri hâlâ yeterli mi? ────


async def test_yesil_booking_sahipsiz_emanet_kemeri_hala_yeterli(ip1a, provider):
    """[D10 · YEŞİL NÖBETÇİ — asimetri kaydı]

    `payment_service.complete_checkout:273-279` sipariş yüzeyiyle AYNI şekli
    taşır: `booking_dead` okuması kilitsizdir ve HELD claim'i booking
    durumunu koşullamaz. Fark, sonuçtadır — orada kayıp güncelleme değil
    **sahipsiz emanet** oluşur (`Payment=HELD`, `Booking=CANCELLED`) ve bunu
    yakalayan bir emniyet kemeri vardır: `reconcile_orphaned_escrow`.

    İP-18 booking yüzeyini kapsamına ALMIYOR (sipariş yüzeyi düzeltilecek).
    Bu nöbetçi asimetrinin sessizce kalmasını engeller: sipariş yüzeyi
    düzeltildikten sonra da booking'in kemeri gerçekten çalışıyor olmalı.
    Kemer düşerse burası kırmızıya döner ve booking yüzeyi kendi paketini
    hak eder.

    Kurgu: pencere `escrow.claim` kancasıyla deterministik açılır (yalnız
    `Payment` modeli için ve yalnız BİR kez — iptalin kendi claim'lerine
    dokunmaz).
    """
    ders = await ip1a.kabul_edilmis()
    tetik = {"oldu": False}
    orijinal = escrow.claim

    async def kancali(db, model, row_id, **kw):
        from models.payment import Payment as _Payment

        if model is _Payment and not tetik["oldu"]:
            tetik["oldu"] = True
            async with AsyncSessionLocal() as s2:
                from models.booking import Booking
                from models.client import Client
                from services import booking_service

                b = await s2.get(Booking, ders.booking_id)
                c = await s2.get(Client, ders.client_id)
                await booking_service.cancel(s2, b, cancelled_by=c)
                await s2.commit()
        return await orijinal(db, model, row_id, **kw)

    import unittest.mock

    with unittest.mock.patch.object(escrow, "claim", kancali):
        async with AsyncSessionLocal() as s:
            await payment_service.complete_checkout(
                s,
                booking_id=ders.booking_id,
                success=True,
                provider_ref="ip18-booking-ref",
            )
            await s.commit()

    assert tetik["oldu"], "kurgu bozuldu — pencere hiç açılmadı"
    durum, odeme = await ip1a.durumlar(ders.booking_id)
    if odeme is not PaymentStatus.HELD:
        pytest.skip(
            "sahipsiz emanet ÜRETİLEMEDİ (booking yüzeyi bu turda farklı "
            f"davrandı: {durum}/{odeme}) — kemer ölçülemedi"
        )
    assert durum is BookingStatus.CANCELLED

    # Kemer: karantina penceresi dolunca sahipsiz emanet otomatik iade edilir.
    await ip1a.eskit(ders.booking_id, delta=datetime.timedelta(hours=2))
    async with AsyncSessionLocal() as s:
        islenen = await escrow_reconciler.reconcile_orphaned_escrow(s)

    assert islenen == 1, "sahipsiz emanet kemeri kaydı görmedi"
    _durum2, odeme2 = await ip1a.durumlar(ders.booking_id)
    assert odeme2 is PaymentStatus.REFUNDED, (
        f"booking kemeri parayı iade etmedi: {odeme2}"
    )
    assert len(provider.refund_calls) == 1
