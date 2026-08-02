"""F30 paketleme iş mantığı — paket açma, tarama, tamamlama, çözme, geri dönüş.

Sözleşme: `docs/f30-paketleme-sozlesmesi.md`. Karar gerekçeleri orada; burada
yalnız **uygulamanın** neden böyle olduğu yazılıdır.

## Kanonik kilit sırası — istisnasız

    StockCountSession → Product → Order → OrderPackage → DeliveryStop

Bu modüldeki her yazan yol **önce `Order`'ı** `FOR UPDATE` ile alır, sonra
paketi. `void`/`repack`/`return_in` yalnız paket satırını değiştirdiği hâlde
sipariş kilidini de alır (sözleşme §3.6b) ve bunun üç somut sebebi vardır:

1. Üçü de sipariş durumuna **bakar** ya da `prepared_at`'i yazar/siler.
   Kilitsiz okunan durum bayattır: iptal edilmiş bir sipariş `repack` ile
   yeniden dağıtıma verilebilirdi. Bu, `mark_prepared`'ın kilitsiz deseninin
   (boşluk G7) aynısıdır ve kopyalanmaz.
2. **Karşı taraf zaten `Order` kilidiyle gelir**: `order_fsm` sipariş
   iptal/iade olurken canlı paketi çözer. Paket tarafı `Order`'ı atlarsa iki
   yol farklı kilit kümeleriyle aynı satır çiftine yazar ve sıra garantisi tek
   taraflı kaldığı için deadlock'u önlemez.
3. Tek kural, sıfır istisna. "Hangi işlem `Order` kilidi alır" sorusunun cevabı
   bir liste olursa, listeye girmeyi unutan bir sonraki fonksiyon sessizce
   yarışır.

Kilitler iki yardımcıda toplanır (`_lock_order`, `_lock_package` /
`_lock_live_package`) ve bu adlar `tests/acceptance/lock_contract.py::
LOCK_HELPERS` sözlüğünde **kayıtlıdır**. Kabul testi
(`test_packing_service_KILIT_SIRASI_kanonik`) fonksiyonların gerçek çağrı
sırasını AST'den ölçer; kayıtsız bir yardımcıya taşınan kilit "hiç kilit
alınmamış" sayılır ve test kırılır. Yani kilidi gizlemenin sessiz bir yolu yok.

## Idempotency

İki ayrı mekanizma vardır ve karıştırılmamalıdır:

* **Anahtarlı** (`idempotency_key`) — `scan` **ve** `undo_scan`: ağ tekrarı/
  çift tıklama. Aynı anahtar aynı yükle gelirse ilk sonuç **aynen** döner ve
  adet DEĞİŞMEZ; farklı yükle gelirse 409 (F29 `payload_differences` deseniyle
  aynı gerekçe: sessizce ilk sonucu döndürmek veriyi bozar). Son söz
  `uq_package_scan_idem` kısmi unique index'inindir. Yük içinde `op` alanı
  vardır, yani bir taramanın anahtarı bir geri almaya verilemez.
  `undo_scan`'in bu listeye girmesi commit 3 denetiminin P2-D bulgusudur:
  geri alma **durum-idempotan değildir** (aynı istek iki kez ulaşırsa adet iki
  kez düşer) ve tek koruması anahtardır.
* **Durum-idempotansı** (durum değiştiren diğer bütün işlemler: `open_package`,
  `complete`, `void`, `unpack`, `return_in`, `repack`, `mark_handed_over`):
  işlem hedef duruma zaten ulaşmışsa **ikinci bir olay ve yan etki üretilmez**,
  mevcut hâl döner. Çift tıklama ikinci bir `packed_at` damgası ya da ikinci
  bir `SHIPPED` geçişi yaratamaz. Bu işlemler adet aritmetiği yapmadığı için
  anahtara ihtiyaç duymazlar; `undo_scan` yapar, o yüzden ayrıdır.

## Stok defteri ÇAĞRILMAZ

Paketleme fiziksel bir **konum/doğrulama** olayıdır; satış hareketi ödeme
anında yazıldı ve F29 `PHYSICAL_EFFECT["ORDER_PREPARED"]` zaten `(0,0,0,0)`
diyor. Bu modül `products.stock` / `damaged_stock` kolonlarına da dokunmaz —
tek yazıcı defter katmanıdır. İki kabul testi bunu AST'den korur.
"""
from __future__ import annotations

import dataclasses
import datetime
import secrets
from collections.abc import Awaitable, Callable

from fastapi import HTTPException, status as http
from sqlalchemy import func, select, true as sa_true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.courier import Courier
from models.packing import (
    QR_TOKEN_BYTES,
    OrderPackage,
    OrderPackageItem,
    PackageScanEvent,
)
from models.role import ROLE_IDS, RoleType
from models.store import Order, Product
from services import audit_service, packing_events, packing_rules

#: Paketleme uçlarına yalnız ADMIN erişir (sözleşme §6: kurye paketleme
#: uçlarının HİÇBİRİNE erişemez). Olay izinin aktör çifti bu rolle yazılır.
_ADMIN_ROLE = ROLE_IDS[RoleType.ADMIN]

#: Fiziksel kalem: yalnız bunlar raftan toplanır. Dijital ürün paket satırı
#: üretmez (indirme bağlantısıdır, kutuya konmaz).
PHYSICAL_KIND = "PHYSICAL"

#: Paket işlemlerinin audit aksiyonları (sözleşme §6). Sıradan başarılı tarama
#: audit'e YAZILMAZ (gürültü); izi `package_scan_events`'tedir.
_AUDIT_TARGET = "order_package"

#: 422 literal: Starlette sürümleri arasında sabit adı değişti
#: (UNPROCESSABLE_ENTITY→CONTENT) — `delivery_feedback_service` ile aynı karar.
_HTTP_422 = 422


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _hata(kod: int, mesaj: str) -> HTTPException:
    return HTTPException(status_code=kod, detail=mesaj)


@dataclasses.dataclass(frozen=True, slots=True)
class _Aktor:
    """`audit_service.record` yalnız `id` ve `role_id` okur (F29 deseni)."""

    id: int
    role_id: int = 1


# ══════════════════ Dışa dönük görünümler ═══════════════════════════════════


@dataclasses.dataclass(frozen=True, slots=True)
class PackageItemView:
    id: int
    order_item_id: int
    product_id: int | None
    sku: str | None
    barcode: str | None
    title: str
    expected_qty: int
    scanned_qty: int

    @property
    def remaining(self) -> int:
        return self.expected_qty - self.scanned_qty


@dataclasses.dataclass(frozen=True, slots=True)
class PackageView:
    """Paketin okunabilir hâli.

    ORM nesnesi yerine dondurulmuş bir görünüm dönmenin sebebi: çağıran
    (commit 4'teki router, testler) commit'ten sonra da güvenle okuyabilsin ve
    `code`/`qr_payload` gibi **türetilmiş** alanlar tek yerde üretilsin.
    """

    id: int
    order_id: int
    package_no: int
    code: str
    status: str
    qr_token: str
    qr_payload: str
    items_fingerprint: str
    packed_at: datetime.datetime | None
    packed_by_admin_id: int | None
    handed_over_at: datetime.datetime | None
    handed_to_courier_id: int | None
    handed_over_by_actor: str | None
    delivered_at: datetime.datetime | None
    returned_at: datetime.datetime | None
    returned_by_admin_id: int | None
    return_note: str | None
    void_at: datetime.datetime | None
    void_by_admin_id: int | None
    void_reason: str | None
    unpacked_at: datetime.datetime | None
    unpacked_by_admin_id: int | None
    created_at: datetime.datetime | None
    items: tuple[PackageItemView, ...]

    @property
    def is_on_premise(self) -> bool:
        return packing_rules.is_on_premise(self.status)


@dataclasses.dataclass(frozen=True, slots=True)
class ScanResult:
    """Tarama sonucu. `result` bir İŞ sonucudur (200 + `result`), hata değil —
    red de bir olaydır ve ize yazılabilmesi için transaction commit edilir."""

    result: str
    qty_delta: int
    order_item_id: int | None
    replayed: bool
    package: PackageView


@dataclasses.dataclass(frozen=True, slots=True)
class ReturnQueueRow:
    """Geri dönüş bekleyen paket (sözleşme §3.5 / TB-7).

    Görünmezlik tek başına tehlikelidir: hiçbir yerde görünmeyen paket kimse
    tarafından aranmaz ve süresiz kaybolur. Bu satır paketi, siparişi, **hangi
    kuryede olduğunu** ve kaç gündür beklediğini taşır.
    """

    package_id: int
    package_code: str
    order_id: int
    courier_id: int | None
    courier_name: str | None
    handed_over_at: datetime.datetime | None
    waiting_days: int


def _item_view(satir: OrderPackageItem) -> PackageItemView:
    return PackageItemView(
        id=satir.id,
        order_item_id=satir.order_item_id,
        product_id=satir.product_id,
        sku=satir.sku,
        barcode=satir.barcode,
        title=satir.title,
        expected_qty=satir.expected_qty,
        scanned_qty=satir.scanned_qty,
    )


def _view(paket: OrderPackage) -> PackageView:
    return PackageView(
        id=paket.id,
        order_id=paket.order_id,
        package_no=paket.package_no,
        code=packing_rules.package_code(paket.id),
        status=paket.status,
        qr_token=paket.qr_token,
        qr_payload=packing_rules.build_package_qr(paket.id, paket.qr_token),
        items_fingerprint=paket.items_fingerprint,
        packed_at=paket.packed_at,
        packed_by_admin_id=paket.packed_by_admin_id,
        handed_over_at=paket.handed_over_at,
        handed_to_courier_id=paket.handed_to_courier_id,
        handed_over_by_actor=paket.handed_over_by_actor,
        delivered_at=paket.delivered_at,
        returned_at=paket.returned_at,
        returned_by_admin_id=paket.returned_by_admin_id,
        return_note=paket.return_note,
        void_at=paket.void_at,
        void_by_admin_id=paket.void_by_admin_id,
        void_reason=paket.void_reason,
        unpacked_at=paket.unpacked_at,
        unpacked_by_admin_id=paket.unpacked_by_admin_id,
        created_at=paket.created_at,
        items=tuple(_item_view(s) for s in paket.items),
    )


def view_of(paket: OrderPackage) -> PackageView:
    """`_view`'in dışa açık adı — `delivery_service.handover_scan` kullanır.

    Zimmet paket ayağını bu modüle bırakır (bağımlılık yönü §3.7) ama yanıtı
    kendisi döndürür; iki modülün aynı görünümü iki kez kurması, alan eklenince
    birinin sessizce eksik kalması demekti.
    """
    return _view(paket)


def _lines(paket: OrderPackage) -> list[packing_rules.ScanLine]:
    """ORM satırlarını saf karar nesnelerine çevirir."""
    return [
        packing_rules.ScanLine(
            order_item_id=s.order_item_id,
            product_id=s.product_id,
            sku=s.sku,
            barcode=s.barcode,
            expected_qty=s.expected_qty,
            scanned_qty=s.scanned_qty,
        )
        for s in paket.items
    ]


# ══════════════════ Kilit yardımcıları ══════════════════════════════════════


async def _lock_order(db: AsyncSession, order_id: int) -> Order:
    """Kanonik sıranın ilk halkası. Siparişi `FOR UPDATE` ile alır ve **TAZE**
    durumla döner (`populate_existing`).

    `populate_existing` şart: session `expire_on_commit=False` ile kurulur, yani
    daha önce okunmuş bir `Order` nesnesi bellekte BAYAT kalabilir. Kilidi alıp
    bayat durumu okumak, kilidi hiç almamakla aynı kapıya çıkardı.
    """
    order = (
        await db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(Order.id == order_id, Order.deleted_at.is_(None))
            .with_for_update(of=Order)
            .execution_options(populate_existing=True)
        )
    ).scalars().first()
    if order is None:
        raise _hata(http.HTTP_404_NOT_FOUND, f"Sipariş #{order_id} bulunamadı")
    return order


async def _peek(db: AsyncSession, package_id: int) -> OrderPackage:
    """Paketi KİLİTSİZ okur — tek amacı `order_id`'yi öğrenmektir.

    Kilit sırası `Order → OrderPackage` olduğundan paketi kilitlemeden önce
    siparişi kilitlemek gerekir; siparişin kimliği de pakette durur. Bu okuma
    hiçbir karara dayanak DEĞİLDİR: bütün guard'lar kilitli okumadan sonra
    çalışır.
    """
    paket = await db.get(OrderPackage, package_id)
    if paket is None:
        raise _hata(http.HTTP_404_NOT_FOUND, f"Paket #{package_id} bulunamadı")
    return paket


async def _lock_package(db: AsyncSession, package_id: int) -> OrderPackage:
    """Kanonik sıranın ikinci halkası — `Order` kilidinden SONRA çağrılır.

    `populate_existing`: `_peek` paketi kilitsiz okumuş olabilir; kilidi alıp
    o bayat nesneyi kullanmak kilidi hiç almamakla aynı kapıya çıkardı.
    """
    paket = (
        await db.execute(
            select(OrderPackage)
            .options(selectinload(OrderPackage.items))
            .where(OrderPackage.id == package_id)
            .with_for_update(of=OrderPackage)
            .execution_options(populate_existing=True)
        )
    ).scalars().first()
    if paket is None:
        raise _hata(http.HTTP_404_NOT_FOUND, f"Paket #{package_id} bulunamadı")
    return paket


async def _acik_duraklari_kapat(db: AsyncSession, order_id: int, *, note: str) -> int:
    """Siparişin BEKLEYEN duraklarını `CANCELLED`'a kapatır; sayısını döner.

    Kanonik sıranın son halkası (`… → OrderPackage → DeliveryStop`) ve
    `order_fsm._close_open_stops` ile aynı desen: durak satırı `FOR UPDATE` ile
    alınır ki eşzamanlı `verify`/`fail` sonuçlanmış bir durağı EZMESİN.

    `CANCELLED` seçilir, `FAILED` değil: kimse teslim denemedi, dolayısıyla
    kurye performans metriğine yazılmamalıdır (mevcut ayrım korunur).

    Model import'u fonksiyon içindedir: `packing_service` `delivery_service`i
    import EDEMEZ (sözleşme §3.7) ama `models.delivery` saf bir model modülüdür
    ve döngü kurmaz — yine de modül düzeyine çıkarmayıp burada tutmak, sınırın
    bilinçli olduğunu okuyan kişiye söyler.
    """
    from models.delivery import DeliveryStop, DeliveryStopStatus

    duraklar = (
        await db.execute(
            select(DeliveryStop)
            .where(
                DeliveryStop.order_id == order_id,
                DeliveryStop.status == DeliveryStopStatus.PENDING.value,
            )
            .with_for_update(of=DeliveryStop)
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    for durak in duraklar:
        durak.status = DeliveryStopStatus.CANCELLED.value
        durak.courier_note = durak.courier_note or note
    return len(duraklar)


async def _lock_live_package(db: AsyncSession, order_id: int) -> OrderPackage | None:
    """Siparişin canlı paketini kilitleyerek getirir (en fazla bir tane).

    Yüklem `packing_rules.LIVE_STATUSES`'ten üretilir; elle yazılmış ikinci bir
    filtre er ya da geç `uq_order_packages_live` kısmi index'inden ayrışır ve
    hata 500 olarak görünürdü.
    """
    return (
        await db.execute(
            select(OrderPackage)
            .options(selectinload(OrderPackage.items))
            .where(
                OrderPackage.order_id == order_id,
                OrderPackage.status.in_(packing_rules.LIVE_STATUSES),
            )
            .with_for_update(of=OrderPackage)
            .execution_options(populate_existing=True)
        )
    ).scalars().first()


# ══════════════════ Ortak guard'lar ═════════════════════════════════════════


def _require_open_order(order: Order) -> None:
    """Sipariş paketlenebilir mi? (kilitli, taze durumla çağrılmalı)"""
    if not order.has_physical:
        raise _hata(
            http.HTTP_409_CONFLICT,
            f"Sipariş #{order.id} fiziksel ürün içermiyor — paketlenemez",
        )
    if order.payment_status != "PAID" or order.status != "PAID":
        raise _hata(
            http.HTTP_409_CONFLICT,
            f"Sipariş #{order.id} paketlenemez: durum {order.status}/"
            f"{order.payment_status} (ödenmiş ve açıkta olmalı)",
        )


def _require_action(paket: OrderPackage, islem: str) -> packing_rules.ActionRule:
    kural = packing_rules.action_rule(islem)
    if not packing_rules.allows(islem, paket.status):
        raise _hata(
            http.HTTP_409_CONFLICT,
            f"Paket {packing_rules.package_code(paket.id)} bu işleme uygun değil: "
            f"durum {paket.status}, beklenen {' / '.join(kural.from_statuses)}",
        )
    return kural


def _require_reason(reason: str | None, islem: str) -> str:
    temiz = (reason or "").strip()
    if not temiz:
        raise _hata(
            _HTTP_422,
            f"{islem} işlemi gerekçe ister — gerekçesiz kayıt iz sayılmaz",
        )
    return temiz


async def _audit(
    db: AsyncSession,
    paket: OrderPackage,
    *,
    admin_id: int,
    action: str,
    reason: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    meta: dict | None = None,
) -> None:
    await audit_service.record(
        db,
        actor=_Aktor(id=admin_id),
        action=action,
        target_type=_AUDIT_TARGET,
        target_id=paket.id,
        details=packing_rules.package_code(paket.id),
        reason=reason,
        before=before,
        after=after,
        meta=meta,
    )


# ══════════════════ Okuma ═══════════════════════════════════════════════════


async def get_package(db: AsyncSession, package_id: int) -> PackageView:
    paket = (
        await db.execute(
            select(OrderPackage)
            .options(selectinload(OrderPackage.items))
            .where(OrderPackage.id == package_id)
            .execution_options(populate_existing=True)
        )
    ).scalars().first()
    if paket is None:
        raise _hata(http.HTTP_404_NOT_FOUND, f"Paket #{package_id} bulunamadı")
    return _view(paket)


async def get_package_by_qr(db: AsyncSession, payload: str) -> PackageView | None:
    """Etiket payload'undan paket. Paket uzayına ait değilse **None** döner
    (çağıran mevcut durak yoluna düşer — geriye uyum, sözleşme §3.3)."""
    cozum = packing_rules.parse_package_qr(payload)
    if cozum is None:
        return None
    package_id, token = cozum
    paket = (
        await db.execute(
            select(OrderPackage)
            .options(selectinload(OrderPackage.items))
            .where(OrderPackage.id == package_id, OrderPackage.qr_token == token)
        )
    ).scalars().first()
    if paket is None:
        raise _hata(http.HTTP_404_NOT_FOUND, "Bu etikete ait paket bulunamadı")
    return _view(paket)


#: Liste ucunun tavanı. Router `Query(le=...)` ile de sınırlar; servis kendi
#: tavanını AYRICA uygular — tek katmanlı koruma koruma değildir ve servisi
#: doğrudan çağıran bir arka plan işi de tabloyu tek istekte çekememelidir.
LIST_MAX_LIMIT = 200


async def list_packages(
    db: AsyncSession,
    *,
    status_filter: str | None = None,
    order_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[PackageView], int]:
    """Sayfalı paket listesi (yeni → eski), toplamla birlikte.

    Sıralama `(created_at DESC, id DESC)`'dir: yalnız `created_at` ile
    sıralamak aynı saniyede açılan iki paketi **belirsiz** sırada döndürür ve
    sayfalar arasında kayıt tekrarı/kayması üretir (F29'da bir kez yaşandı).
    """
    kosullar = []
    if status_filter:
        kosullar.append(OrderPackage.status == status_filter)
    if order_id is not None:
        kosullar.append(OrderPackage.order_id == order_id)

    toplam = int(
        (
            await db.execute(
                select(func.count()).select_from(OrderPackage).where(*kosullar)
            )
        ).scalar_one()
    )
    satirlar = (
        await db.execute(
            select(OrderPackage)
            .options(selectinload(OrderPackage.items))
            .where(*kosullar)
            .order_by(OrderPackage.created_at.desc(), OrderPackage.id.desc())
            .limit(min(max(int(limit), 1), LIST_MAX_LIMIT))
            .offset(max(int(offset), 0))
        )
    ).scalars().all()
    return [_view(p) for p in satirlar], toplam


def _deneme_hakki_var():
    """Üç-deneme kuralı: hakkı DOLMAMIŞ siparişler için SQL koşulu.

    `delivery_service._within_attempt_cap` ile aynı kural, ama **kopya değil
    zorunluluk**: sözleşme §3.7 `packing_service`in `delivery_service`i import
    etmesini YASAKLAR (döngü sınırı). İki tarafın ayrışmaması bir kabul
    testiyle korunur (`test_DENEME_TAVANI_KURALI_AYNI`).
    """
    cap = settings.DELIVERY_MAX_DELIVERY_ATTEMPTS
    if cap <= 0:
        return sa_true()
    return Order.failed_delivery_count < cap


@dataclasses.dataclass(frozen=True, slots=True)
class PackageSummary:
    """Kuyruk satırındaki paketin ÖZETİ — bilinçli olarak `qr_token` YOK.

    Etiket yükü (`qr_payload`) yalnız paket DETAYINDA döner. Kalıcı QR'ın
    bedeli çalınabilir etikettir (sözleşme §7 S4); token'ı bir liste ekranında
    onlarca satır hâlinde yaymak o riski gereksizce büyütürdü.
    """

    id: int
    code: str
    status: str


#: Kuyruk satırının operatöre önerdiği eylemler. Ekran bu değere bakar; durum
#: dizgisinden iş akışı ÇIKARMAZ.
NEXT_ACTION_OPEN = "OPEN_NEW_PACKAGE"        # paket yok → yeni paket aç
NEXT_ACTION_CONTINUE = "CONTINUE_PACKING"    # `OPEN` paket → yarım işe devam
NEXT_ACTION_REPACK = "REPACK_RETURNED"       # `RETURNED` paket → yeniden paketle

#: Canlı paket durumundan eyleme. **Kapalı sözlüktür**: burada olmayan her durum
#: eylemsizdir. `PACKED`/`HANDED_OVER`/`RETURN_PENDING` kuyruğa zaten girmez;
#: girebilseydi doğru cevap "bir eylem uydur" değil "hiçbir şey önerme"dir.
_PAKET_DURUM_EYLEMI: dict[str, str] = {
    "OPEN": NEXT_ACTION_CONTINUE,
    "RETURNED": NEXT_ACTION_REPACK,
}


def next_action_for(package_status: str | None) -> str | None:
    """Kuyruk satırının TEK doğru eylemi; bilinmeyen durumda **None**.

    Fail-closed olması bilinçlidir. Varsayılanı `NEXT_ACTION_OPEN` yapmak
    kolaydı ve tam olarak commit 5 denetiminin bulduğu çıkmazı geri getirirdi:
    tanınmayan bir durumda ekran "Paketle" der, operatör aynı ürünleri ikinci
    kez raftan toplar. Eylemsiz satır ise görünür kalır ve insanı çağırır.
    """
    if package_status is None:
        return NEXT_ACTION_OPEN
    return _PAKET_DURUM_EYLEMI.get(package_status)


async def _canli_paket_ozetleri(
    db: AsyncSession, order_ids: list[int]
) -> dict[int, PackageSummary]:
    """Sipariş → canlı paket özeti, **TEK sorguda** (N+1 yok).

    Eskiden kuyruk satır başına `packing_events.live_package` çağırıyordu ve 25
    satır 29 sorgu ediyordu; `eligible_orders`'ta aynı hata bir kez düzeltilmişti
    (`delivery_service` anti-join'i), burada tekrarlanmıştı.

    Sipariş başına en fazla bir canlı paket vardır — bunu uygulama değil
    `uq_order_packages_live` kısmi unique index'i garanti eder; sözlüğe yazarken
    "hangisini seçeyim" sorusu bu yüzden doğmaz. Yüklem yine
    `packing_rules.LIVE_STATUSES`'ten gelir: elle yazılmış ikinci bir filtre er
    ya da geç o index'ten ayrışırdı.

    Yalnız ihtiyaç duyulan üç kolon çekilir; `selectinload(items)` ile paketin
    satırlarını da getirmek özet için gereksiz ikinci bir sorgu olurdu (kuyruk
    ekranı kalem adetlerini SİPARİŞTEN gösterir).
    """
    if not order_ids:
        return {}
    rows = (
        await db.execute(
            select(OrderPackage.order_id, OrderPackage.id, OrderPackage.status).where(
                OrderPackage.order_id.in_(order_ids),
                OrderPackage.status.in_(packing_rules.LIVE_STATUSES),
            )
        )
    ).all()
    return {
        order_id: PackageSummary(
            id=paket_id,
            code=packing_rules.package_code(paket_id),
            status=durum,
        )
        for order_id, paket_id, durum in rows
    }


@dataclasses.dataclass(frozen=True, slots=True)
class QueueRow:
    """Paketleme istasyonu kuyruğunun bir satırı.

    `package` alanı olmadan ekran **yanlış eylemi** önerir: paketi `RETURNED`
    olan sipariş için "Paketle" (yeni paket aç) demek, operatörü `open_package`
    → mevcut paketi geri al → `complete` → 409 döngüsüne sokar (commit 5
    denetiminin bulduğu çıkmaz). Doğru eylem `repack`'tir ve ancak paketin
    durumu satırda taşınırsa gösterilebilir.
    """

    order_id: int
    recipient: str | None
    phone: str | None
    address: str | None
    city: str | None
    district: str | None
    item_count: int
    items: tuple[tuple[str, int], ...]
    promised_delivery_date: datetime.date | None
    created_at: datetime.datetime | None
    prepared_at: datetime.datetime | None
    package: PackageSummary | None
    #: Ekranın sunacağı TEK eylem; `None` = eylemsiz satır (fail-closed).
    next_action: str | None


#: Kuyruğun servis tarafı tavanı — `list_packages` ile AYNI değer ve aynı
#: gerekçe: router `Query(le=...)` ile sınırlar ama tek katmanlı koruma koruma
#: değildir; servisi doğrudan çağıran bir arka plan işi de tabloyu tek istekte
#: çekememelidir.
QUEUE_MAX_LIMIT = LIST_MAX_LIMIT


async def packing_queue(
    db: AsyncSession, *, limit: int = 50, offset: int = 0
) -> tuple[list[QueueRow], int]:
    """Paketleme istasyonu kuyruğu: **işlem bekleyen** siparişler.

    `delivery_service.prep_queue`'dan farkı bilinçlidir. O kuyruk "henüz
    hazırlanmamış" siparişleri gösterir ve `RETURNED` paketlileri artık
    dışarıda bırakır (bkz. `packing_events.first_packing_blocked_condition`).
    Bu kuyruk ise **paketleme ekranının** kuyruğudur ve üç işi birden gösterir:

    * paketi hiç olmayan sipariş  → "Paketle" (yeni paket aç)
    * `OPEN` paketi olan sipariş  → "Devam et" (yarım kalmış iş)
    * `RETURNED` paketi olan sipariş → "Yeniden paketle" (`repack`)

    Dışarıda kalanlar: `PACKED` (iş bitti, dağıtım kuyruğunda), araçtaki
    paketler (`HANDED_OVER`/`RETURN_PENDING` — onlar geri dönüş kuyruğunda) ve
    paketi hiç olmadığı hâlde zaten bir turda bekleyen F30 ÖNCESİ siparişler
    (`packing_events.open_stop_without_package_exists`).

    ## Sayfalama ve sıra

    Kardeş uç `/packing/packages` ile aynı sözleşme: `total` **süzülmüş toplam**
    kayıt sayısıdır (sayfa uzunluğu değil), `items` yalnız istenen sayfadır.
    Sıralama `(promised_delivery_date, created_at, id)` üçlüsüdür ve son
    bağlayıcı ŞART: aynı güne söz verilmiş, aynı anda oluşmuş iki sipariş
    belirsiz sırada dönseydi `limit`/`offset` ile gezen ekran aynı kaydı iki
    sayfada gösterip bir başkasını hiç göstermezdi (F29'da bir kez yaşandı).
    """
    hazir_paket = (
        select(OrderPackage.id)
        .where(OrderPackage.order_id == Order.id, OrderPackage.status == "PACKED")
        .exists()
    )
    kosullar = (
        Order.deleted_at.is_(None),
        Order.has_physical.is_(True),
        Order.payment_status == "PAID",
        Order.status == "PAID",
        Order.ship_in_zone.is_(True),
        ~hazir_paket,
        ~packing_events.off_premise_package_exists(),
        ~packing_events.open_stop_without_package_exists(),
        _deneme_hakki_var(),
    )
    toplam = int(
        (
            await db.execute(
                select(func.count()).select_from(Order).where(*kosullar)
            )
        ).scalar_one()
    )
    orders = (
        await db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(*kosullar)
            .order_by(
                Order.promised_delivery_date.asc().nulls_last(),
                Order.created_at.asc(),
                Order.id.asc(),
            )
            .limit(min(max(int(limit), 1), QUEUE_MAX_LIMIT))
            .offset(max(int(offset), 0))
        )
    ).scalars().all()

    paketler = await _canli_paket_ozetleri(db, [o.id for o in orders])
    satirlar: list[QueueRow] = []
    for order in orders:
        paket = paketler.get(order.id)
        fiziksel = [it for it in order.items if it.kind == PHYSICAL_KIND]
        satirlar.append(
            QueueRow(
                order_id=order.id,
                recipient=order.ship_recipient,
                phone=order.ship_phone,
                address=order.ship_address,
                city=order.ship_city,
                district=order.ship_district,
                item_count=sum(it.quantity for it in fiziksel),
                items=tuple((it.title, it.quantity) for it in fiziksel),
                promised_delivery_date=order.promised_delivery_date,
                created_at=order.created_at,
                prepared_at=order.prepared_at,
                package=paket,
                next_action=next_action_for(paket.status if paket else None),
            )
        )
    return satirlar, toplam


async def return_queue(db: AsyncSession) -> list[ReturnQueueRow]:
    """"Geri dönüş bekleniyor" kuyruğu — en eskisi başta.

    `ix_order_packages_return_queue` kısmi index'i tam bu sorgu için var.
    """
    rows = (
        await db.execute(
            select(OrderPackage, Courier)
            .outerjoin(Courier, Courier.id == OrderPackage.handed_to_courier_id)
            .where(OrderPackage.status == "RETURN_PENDING")
            .order_by(OrderPackage.handed_over_at.asc().nulls_last())
        )
    ).all()
    simdi = _now()
    return [
        ReturnQueueRow(
            package_id=paket.id,
            package_code=packing_rules.package_code(paket.id),
            order_id=paket.order_id,
            courier_id=paket.handed_to_courier_id,
            courier_name=kurye.name if kurye is not None else None,
            handed_over_at=paket.handed_over_at,
            waiting_days=(
                (simdi - paket.handed_over_at).days
                if paket.handed_over_at is not None
                else 0
            ),
        )
        for paket, kurye in rows
    ]


# ══════════════════ Paket açma ══════════════════════════════════════════════


async def _tuketilen_adetler(db: AsyncSession, order_id: int) -> dict[int, int]:
    """Kalem başına, CANLI paketlerin şimdiden talep ettiği toplam adet.

    V1'de sipariş başına tek canlı paket olduğu için bu toplam pratikte her
    zaman sıfırdır (yeni paket ancak öncekiler terminal olunca açılır) — ve
    tam olarak bu yüzden yazılmıştır: `VOID` / `DELIVERED` geçmiş paketlerin
    satırları **sayılmaz**, yoksa bozulan bir paketten sonra açılan yenisi
    "hepsi zaten paketlenmiş" diye boş doğardı. V2'de bir sipariş birden çok
    kutuya bölündüğünde aynı toplam gerçek bir tavana dönüşür ve invariant
    (`Σ aktif expected_qty ≤ order_item.quantity`) kendiliğinden korunur.
    """
    rows = (
        await db.execute(
            select(
                OrderPackageItem.order_item_id,
                func.coalesce(func.sum(OrderPackageItem.expected_qty), 0),
            )
            .join(OrderPackage, OrderPackage.id == OrderPackageItem.package_id)
            .where(
                OrderPackage.order_id == order_id,
                OrderPackage.status.in_(packing_rules.LIVE_STATUSES),
            )
            .group_by(OrderPackageItem.order_item_id)
        )
    ).all()
    return {order_item_id: int(toplam) for order_item_id, toplam in rows}


def _fingerprint(order: Order) -> str:
    return packing_rules.items_fingerprint(
        (it.id, it.product_id, it.quantity)
        for it in order.items
        if it.kind == PHYSICAL_KIND
    )


async def open_package(
    db: AsyncSession, order_id: int, *, admin_id: int
) -> PackageView:
    """Siparişe paket açar (idempotent) — sözleşme §3.1, §3.5, §3.6.

    * Siparişin **canlı** paketi varsa yeni paket AÇILMAZ. Depodaki bir paket
      (`OPEN`/`PACKED`/`RETURNED`) olduğu gibi döner — operatör ekranı yeniden
      açmış demektir. Araçtaki paket (`HANDED_OVER`/`RETURN_PENDING`) ise 409
      verir ve gövde **mevcut durumu bildirir**: ikinci paket açmak, aynı
      ürünleri ikinci kez raftan almak demektir ve operatör "neden açamıyorum"
      sorusunun cevabını ekranda görmelidir.
    * Kalem satırları o anki üründen **snapshot** alır (§3.6); `OrderItem`'a
      kolon EKLENMEZ.
    * Son söz `uq_order_packages_live` kısmi unique index'inindir: uygulama
      katmanı yarışı kaybederse ham `IntegrityError` sızmaz, kazanan paket
      yeniden okunup döner.
    """
    order = await _lock_order(db, order_id)
    _require_open_order(order)

    mevcut = await _lock_live_package(db, order_id)
    if mevcut is not None:
        return _mevcut_paketi_dondur(mevcut)

    fiziksel = [it for it in order.items if it.kind == PHYSICAL_KIND]
    if not fiziksel:
        raise _hata(
            http.HTTP_409_CONFLICT,
            f"Sipariş #{order_id} paketlenecek fiziksel kalem içermiyor",
        )
    tuketilen = await _tuketilen_adetler(db, order_id)
    urunler = await _urun_snapshotlari(db, fiziksel)

    sonraki_no = int(
        (
            await db.execute(
                select(func.coalesce(func.max(OrderPackage.package_no), 0)).where(
                    OrderPackage.order_id == order_id
                )
            )
        ).scalar_one()
    ) + 1

    paket = OrderPackage(
        order_id=order_id,
        package_no=sonraki_no,
        status="OPEN",
        qr_token=secrets.token_urlsafe(QR_TOKEN_BYTES),
        items_fingerprint=_fingerprint(order),
    )
    for kalem in fiziksel:
        kalan = kalem.quantity - tuketilen.get(kalem.id, 0)
        if kalan <= 0:
            raise _hata(
                http.HTTP_409_CONFLICT,
                f"Sipariş kalemi #{kalem.id} zaten canlı bir pakette tamamen "
                "talep edilmiş",
            )
        urun = urunler.get(kalem.product_id)
        paket.items.append(
            OrderPackageItem(
                order_item_id=kalem.id,
                product_id=kalem.product_id,
                # Ürün okunamıyorsa kod da yazılmaz: `ck_order_package_items_
                # scannable` bunu zaten dayatır ve satır yalnız gerekçeli
                # manuel doğrulamayla kapanır (§3.6).
                sku=urun.sku if urun is not None else None,
                barcode=urun.barcode if urun is not None else None,
                title=kalem.title,
                expected_qty=kalan,
                scanned_qty=0,
            )
        )

    try:
        async with db.begin_nested():
            db.add(paket)
            await db.flush()
            packing_events.record(
                db,
                paket,
                event_type="OPEN",
                from_status=None,
                to_status="OPEN",
                actor_role=_ADMIN_ROLE,
                actor_id=admin_id,
                meta={"package_no": sonraki_no, "item_count": len(fiziksel)},
            )
            await db.flush()
    except IntegrityError:
        # Kısmi unique index yarışı: başka bir istek aynı anda paketi açtı.
        # Savepoint geri alındı; kazananı yeniden oku ve ONU döndür — ham
        # IntegrityError'ı çağırana sızdırmak 500 üretirdi.
        kazanan = await _lock_live_package(db, order_id)
        if kazanan is None:
            raise
        return _mevcut_paketi_dondur(kazanan)

    await _audit(
        db,
        paket,
        admin_id=admin_id,
        action="package.open",
        after={"status": "OPEN", "package_no": sonraki_no},
    )
    await db.commit()
    return _view(paket)


def _mevcut_paketi_dondur(paket: OrderPackage) -> PackageView:
    """Canlı paket zaten varken `open_package`'ın cevabı.

    ON_PREMISE ise idempotent olarak döner; OFF_PREMISE ise 409 — ve gövde
    durumu **adıyla** söyler ki ekran "RETURN_PENDING" diyebilsin.
    """
    if packing_rules.is_on_premise(paket.status):
        return _view(paket)
    raise _hata(
        http.HTTP_409_CONFLICT,
        f"Sipariş #{paket.order_id} için zaten bir paket var ve depoda değil: "
        f"{packing_rules.package_code(paket.id)} durumu {paket.status}. "
        "İkinci paket açmak aynı ürünleri ikinci kez raftan almak olurdu — "
        "önce paketin geri dönmesi okutulmalı.",
    )


async def _urun_snapshotlari(db: AsyncSession, kalemler) -> dict[int, Product]:
    """Kalemlerin ürünlerini tek sorguda getirir (N+1 yok).

    Ürünü olmayan kalem (`product_id IS NULL`) sözlükte yer almaz ve satır
    kodsuz doğar. Ürünün **sert silinmesi** diye bir yol yoktur: snapshot dolu
    bir satırda `DELETE` `ck_order_package_items_scannable`'a takılır ve
    reddedilir; üretimde ürün soft-delete edilir. Bu yüzden burada "silinmiş
    ürün" varsayımı KURULMAZ — sorgu `deleted_at` süzmez, çünkü soft-delete
    edilmiş bir ürünün SKU'su hâlâ rafın üstündeki fiziksel kalemin koduysa
    tarama çalışmalıdır.
    """
    idler = {it.product_id for it in kalemler if it.product_id is not None}
    if not idler:
        return {}
    rows = (
        await db.execute(select(Product).where(Product.id.in_(idler)))
    ).scalars().all()
    return {p.id: p for p in rows}


# ══════════════════ Tarama ══════════════════════════════════════════════════


async def _idem_olayi(
    db: AsyncSession, package_id: int, key: str | None
) -> PackageScanEvent | None:
    if not key:
        return None
    return (
        await db.execute(
            select(PackageScanEvent).where(
                PackageScanEvent.package_id == package_id,
                PackageScanEvent.idempotency_key == key,
            )
        )
    ).scalars().first()


def _idem_yuku(
    *, op: str, code: str | None, manual: bool, order_item_id: int | None
) -> dict:
    """Anahtarın **neyi** temsil ettiği. Aynı anahtar farklı yükle gelirse
    sessizce ilk sonucu döndürmek veriyi bozar (F29 `payload_differences`).

    `op` (SCAN / UNDO_SCAN) yükün parçasıdır ve olmazsa olmazdır: idempotency
    anahtarı `(package_id, key)` üzerinde tekildir, yani bir taramanın
    anahtarı yanlışlıkla bir geri almaya verilirse kısmi unique index onu
    "aynı istek" sanıp **sessizce yutardı** — adet azalmaz ve istemci bunu
    başarı sanardı. `op` farkı bu durumu 409'a çevirir.
    """
    return {
        "op": op,
        "code": packing_rules.normalize_code(code),
        "manual": bool(manual),
        "order_item_id": order_item_id,
    }


def _yuk_catismasi(olay: PackageScanEvent, yuk: dict) -> list[str]:
    kayitli = dict(olay.meta or {})
    return [
        alan
        for alan, deger in yuk.items()
        if kayitli.get(alan) != deger
    ]


async def _idem_tekrari(
    db: AsyncSession,
    paket: OrderPackage,
    idempotency_key: str | None,
    yuk: dict,
) -> ScanResult | None:
    """Anahtarlı tekrar kontrolü — `scan` ve `undo_scan` için ORTAK.

    Ağ tekrarı/çift tıklama: aynı anahtar **aynı yükle** gelirse ilk sonuç
    aynen döner ve hiçbir yan etki üretilmez (adet değişmez, ikinci olay
    yazılmaz). Aynı anahtar **farklı yükle** gelirse 409 — sessizce ilk sonucu
    döndürmek, istemcinin gönderdiği ikinci işlemin yapıldığını sanmasına yol
    açar ve veriyi bozar (F29 `payload_differences` gerekçesi).

    Kontrol durum guard'larından ÖNCE çalışır: tekrarın doğru cevabı, paket o
    arada başka bir duruma geçmiş olsa bile ilk sonucun kendisidir.
    """
    if not idempotency_key:
        return None
    onceki = await _idem_olayi(db, paket.id, idempotency_key)
    if onceki is None:
        return None
    farklar = _yuk_catismasi(onceki, yuk)
    if farklar:
        raise _hata(
            http.HTTP_409_CONFLICT,
            f"'{idempotency_key}' anahtarı farklı bir işlem için kullanılmış "
            f"(çakışan alanlar: {', '.join(farklar)})",
        )
    return ScanResult(
        result=onceki.result or "OK",
        qty_delta=0,
        order_item_id=_olay_kalemi(paket, onceki),
        replayed=True,
        package=_view(paket),
    )


def _olay_kalemi(paket: OrderPackage, olay: PackageScanEvent) -> int | None:
    """Kayıtlı olayın işaret ettiği **sipariş kalemi**.

    Tekrar yanıtı hangi satırın okutulduğunu KAYBETMEMELİDİR: ekran "şu kalem
    tamam" bandını tekrar yanıtında da çizer. Kaynak `package_item_id`
    kolonudur — istek yükündeki `order_item_id` yalnız MANUEL doğrulamada
    doludur, kod taramasında `None`'dır ve oradan okumak tekrarda satırı
    sessizce kaybettirirdi (commit 4 denetimi, P2 temizliği).
    """
    if olay.package_item_id is None:
        return (olay.meta or {}).get("order_item_id")
    for satir in paket.items:
        if satir.id == olay.package_item_id:
            return satir.order_item_id
    return None


async def scan(
    db: AsyncSession,
    package_id: int,
    *,
    code: str | None = None,
    admin_id: int,
    manual: bool = False,
    manual_reason: str | None = None,
    order_item_id: int | None = None,
    idempotency_key: str | None = None,
) -> ScanResult:
    """Kalem doğrulama (sözleşme §3.6, §4.1/2).

    İş sonucu (`OK` · `OK_MANUAL` · `WRONG_SKU` · `OVER_QTY`) **istisna değil,
    dönüş değeridir** ve transaction commit edilir: red de bir olaydır ve ize
    yazılabilmesi için kalıcı olmalıdır ("hangi rafta yanlış kitap duruyor"
    sorusunun cevabı redlerdedir). Yapısal hatalar (paket yok, paket `OPEN`
    değil, gerekçesiz manuel, idempotency çakışması) 4xx'tir.
    """
    on = await _peek(db, package_id)
    await _lock_order(db, on.order_id)
    paket = await _lock_package(db, package_id)

    yuk = _idem_yuku(
        op="SCAN", code=code, manual=manual, order_item_id=order_item_id
    )
    tekrar = await _idem_tekrari(db, paket, idempotency_key, yuk)
    if tekrar is not None:
        return tekrar

    _require_action(paket, "scan")

    satirlar = _lines(paket)
    if manual:
        hedef = _manuel_satir(satirlar, order_item_id=order_item_id, code=code)
        temiz_gerekce = _require_reason(manual_reason, "Manuel doğrulama")
        try:
            karar = packing_rules.manual_outcome(hedef, reason=temiz_gerekce)
        except ValueError as exc:  # pragma: no cover — _require_reason önce yakalar
            raise _hata(_HTTP_422, str(exc)) from exc
    else:
        temiz_gerekce = None
        karar = packing_rules.scan_outcome(satirlar, code)

    return await _tarama_uygula(
        db,
        paket,
        karar=karar,
        code=code,
        admin_id=admin_id,
        manual_reason=temiz_gerekce,
        idempotency_key=idempotency_key,
        idem_yuku=yuk,
        event_type="SCAN",
    )


def _manuel_satir(
    satirlar, *, order_item_id: int | None, code: str | None
) -> packing_rules.ScanLine:
    if order_item_id is not None:
        for satir in satirlar:
            if satir.order_item_id == order_item_id:
                return satir
        raise _hata(
            http.HTTP_404_NOT_FOUND,
            f"Sipariş kalemi #{order_item_id} bu pakette yok",
        )
    eslesen = packing_rules.match_code(satirlar, code)
    if eslesen is None:
        raise _hata(
            _HTTP_422,
            "Manuel doğrulama hangi kalem için yapıldığını söylemeli "
            "(order_item_id ya da eşleşen bir kod)",
        )
    return eslesen


async def _tarama_uygula(
    db: AsyncSession,
    paket: OrderPackage,
    *,
    karar: packing_rules.ScanOutcome,
    code: str | None,
    admin_id: int,
    manual_reason: str | None,
    idempotency_key: str | None,
    idem_yuku: dict,
    event_type: str,
) -> ScanResult:
    """Kararı kalıcı kılar: adet + olay + (manuelse) audit, tek transaction.

    Adet güncellemesi **koşullu UPDATE**'tir (`scanned_qty + delta` tavan/taban
    içinde mi). Satır zaten `FOR UPDATE` altında; koşul ikinci bir savunma
    hattıdır ve DB CHECK'iyle birlikte üç katman eder. Tek katmanlı koruma
    koruma değildir.

    ## Savepoint YOK — ve neden olmadığı (commit 4 denetimi)

    Burada eskiden bir `begin_nested()` + `IntegrityError` kurtarma dalı vardı
    ve yorumu "adet güncellemesi de savepoint'in içindeydi" diyordu. **İki
    bakımdan yanlıştı:** güncelleme savepoint'ten önce yapılıyordu ve dal
    zaten **ULAŞILAMAZDI**. Ulaşılamazlığın kanıtı yapısaldır: anahtarlı olay
    yazan tek iki yol (`scan`, `undo_scan`) işe `Order`'ı `FOR UPDATE` ile
    alarak başlar, yani aynı paket üzerindeki iki istek **serileşir** ve
    ikincisi `_idem_tekrari` ön kontrolünde yakalanır — INSERT'e hiç varmaz.
    Mutasyon provası bunu doğruladı: kurtarma dalına `commit` eklemek hiçbir
    testi kırmadı, çünkü o dal hiç çalışmıyor.

    Test edilemeyen kurtarma kodu, koruma değil **gürültüdür** ve yanlış bir
    güvenlik hissi verir; bu yüzden kaldırıldı. Çift sayıma karşı üç gerçek
    katman kalır:

    1. `Order` satır kilidi — eşzamanlı istekleri serileştirir,
    2. `_idem_tekrari` ön kontrolü — asıl idempotency guard'ı (nöbetçisi
       `test_f30_guards_pg.py::test_C5_TEKRAR_DALI_ADET_KALICI_KILMAZ`),
    3. `uq_package_scan_idem` kısmi unique index — son savunma hattı; ihlali
       global `IntegrityError` işleyicisiyle **409**'a çevrilir, sessiz bir
       çift sayıma değil.

    Adet güncellemesi ayrıca **koşullu UPDATE**'tir (`scanned_qty + delta`
    tavan/taban içinde mi): satır zaten kilit altındadır, koşul ve DB CHECK'i
    ikinci ve üçüncü katmandır. Tek katmanlı koruma koruma değildir.
    """
    satir_id = _satir_id(paket, karar)
    if karar.qty_delta:
        sonuc = await db.execute(
            update(OrderPackageItem)
            .where(
                OrderPackageItem.id == satir_id,
                OrderPackageItem.scanned_qty + karar.qty_delta >= 0,
                OrderPackageItem.scanned_qty + karar.qty_delta
                <= OrderPackageItem.expected_qty,
            )
            .values(scanned_qty=OrderPackageItem.scanned_qty + karar.qty_delta)
            .execution_options(synchronize_session="fetch")
        )
        if sonuc.rowcount != 1:
            raise _hata(
                http.HTTP_409_CONFLICT,
                "Satır adedi bu arada değişti — ekranı yenile",
            )
    packing_events.record(
        db,
        paket,
        event_type=event_type,
        result=karar.result,
        code_scanned=(code or "")[:64] or None,
        qty_delta=karar.qty_delta,
        package_item_id=satir_id,
        manual_reason=manual_reason,
        actor_role=_ADMIN_ROLE,
        actor_id=admin_id,
        meta=idem_yuku,
        idempotency_key=idempotency_key,
    )
    await db.flush()

    if manual_reason:
        await _audit(
            db,
            paket,
            admin_id=admin_id,
            action=(
                "package.scan_manual" if event_type == "SCAN" else "package.undo_scan"
            ),
            reason=manual_reason,
            meta={"order_item_id": karar.line.order_item_id if karar.line else None},
        )
    await db.commit()
    return ScanResult(
        result=karar.result,
        qty_delta=karar.qty_delta,
        order_item_id=karar.line.order_item_id if karar.line else None,
        replayed=False,
        package=_view(paket),
    )


def _satir_id(paket: OrderPackage, karar: packing_rules.ScanOutcome) -> int | None:
    """Kararın işaret ettiği paket satırının kimliği; reddedilen taramada None.

    `WRONG_SKU` satır BULAMADIĞI için `package_item_id` NULL kalır — iz yine
    yazılır (kolon nullable, sözleşme §5).
    """
    if karar.line is None:
        return None
    for satir in paket.items:
        if satir.order_item_id == karar.line.order_item_id:
            return satir.id
    return None


async def undo_scan(
    db: AsyncSession,
    package_id: int,
    *,
    order_item_id: int,
    admin_id: int,
    reason: str,
    idempotency_key: str | None = None,
) -> ScanResult:
    """Yanlış okutmanın gerekçeli düzeltmesi — izsiz değil.

    Adet bir azalır ve `qty_delta = -1` olan bir `UNDO_SCAN` satırı yazılır;
    iz append-only olduğu için "yanlış tarama hiç olmamış gibi" yapılamaz.

    **`idempotency_key` alır** (commit 3 denetimi, P2-D). Sebep somut: geri
    alma `scan`'in aksine **durum-idempotan DEĞİLDİR** — aynı isteğin iki kez
    ulaşması adedi iki kez düşürür ve bu, eksik paketi "tam" sanmanın tersine,
    tam paketi eksik gösterir. Ağ tekrarı gerçek bir senaryodur (kablosuz el
    terminali), bu yüzden koruma anahtar tabanlıdır: aynı paket + aynı anahtar
    + aynı yük ikinci kez azaltmaz; aynı anahtar farklı yükle 409 verir.
    Anahtar verilmezse **iki ayrı geri alma iki ayrı düzeltmedir** (2 adetlik
    satırda meşru davranış) — `scan`'deki anahtarsız davranışın aynısı.
    """
    temiz = _require_reason(reason, "Tarama geri alma")
    on = await _peek(db, package_id)
    await _lock_order(db, on.order_id)
    paket = await _lock_package(db, package_id)

    yuk = _idem_yuku(
        op="UNDO_SCAN", code=None, manual=True, order_item_id=order_item_id
    )
    tekrar = await _idem_tekrari(db, paket, idempotency_key, yuk)
    if tekrar is not None:
        return tekrar

    _require_action(paket, "undo_scan")

    hedef = next(
        (s for s in _lines(paket) if s.order_item_id == order_item_id), None
    )
    if hedef is None:
        raise _hata(
            http.HTTP_404_NOT_FOUND, f"Sipariş kalemi #{order_item_id} bu pakette yok"
        )
    if hedef.scanned_qty <= 0:
        raise _hata(
            http.HTTP_409_CONFLICT, "Bu satırda geri alınacak tarama yok"
        )
    karar = packing_rules.ScanOutcome("OK", -1, hedef, temiz)
    return await _tarama_uygula(
        db,
        paket,
        karar=karar,
        code=None,
        admin_id=admin_id,
        manual_reason=temiz,
        idempotency_key=idempotency_key,
        idem_yuku=yuk,
        event_type="UNDO_SCAN",
    )


# ══════════════════ Tamamlama ═══════════════════════════════════════════════


async def complete(db: AsyncSession, package_id: int, *, admin_id: int) -> PackageView:
    """Paketi `PACKED` yapar ve siparişe `prepared_at` damgasını **kazandırır**.

    Sözleşme §3.5: `prepared_at` artık elle bir butonla değil, kalem kalem
    doğrulanmış bir paketle damgalanır. Sipariş ancak o zaman
    `eligible_orders`'a geçer.

    Üç kapı vardır ve sırası önemlidir:
      1. Paket `OPEN` mi (zaten `PACKED` ise idempotent dönüş),
      2. Sipariş hâlâ açık mı — **kilitli ve taze** okunur; iptal edilmiş
         sipariş `prepared_at` damgası alamaz, yoksa dağıtıma girerdi,
      3. Kalem listesi değişmemiş mi (STALE) ve bütün kalemler tam mı.
    """
    on = await _peek(db, package_id)
    order = await _lock_order(db, on.order_id)
    paket = await _lock_package(db, package_id)

    if paket.status == "PACKED":
        return _view(paket)          # çift tıklama ikinci damga üretmez
    _require_action(paket, "complete")
    _require_open_order(order)

    if _fingerprint(order) != paket.items_fingerprint:
        raise _hata(
            http.HTTP_409_CONFLICT,
            "STALE: paket açıldıktan sonra siparişin kalem listesi değişti — "
            "paketi bozup yeniden açmak gerekir",
        )
    satirlar = _lines(paket)
    if not packing_rules.is_complete(satirlar):
        eksik = packing_rules.missing_lines(satirlar)
        raise _hata(
            http.HTTP_409_CONFLICT,
            "Eksik kalem var, paket tamamlanamaz: "
            + ", ".join(
                f"kalem #{s.order_item_id} ({s.remaining} adet)" for s in eksik
            ),
        )

    simdi = _now()
    onceki_durum = paket.status
    paket.status = "PACKED"
    paket.packed_at = simdi
    paket.packed_by_admin_id = admin_id
    order.prepared_at = simdi
    order.prepared_by = f"packing:admin:{admin_id}"
    packing_events.record(
        db,
        paket,
        event_type="COMPLETE",
        from_status=onceki_durum,
        to_status="PACKED",
        actor_role=_ADMIN_ROLE,
        actor_id=admin_id,
        meta={"item_count": len(satirlar)},
    )
    await _audit(
        db,
        paket,
        admin_id=admin_id,
        action="package.complete",
        before={"status": onceki_durum},
        after={"status": "PACKED", "prepared_at": simdi},
    )
    await db.commit()
    return _view(paket)


# ══════════════════ Çözme ═══════════════════════════════════════════════════


#: `void`in yetki doğrulayıcısı olarak geçirilebilecek AÇIK "yetki zaten var"
#: işareti. Doğrulayıcıyı `None` bırakmak yerine bunu vermek, atlamanın
#: **bilinçli** olduğunu kodda görünür kılar (commit 5 denetimi — aşağı bakınız).
async def izin_zaten_dogrulandi(_durum: str) -> None:
    """Yetki kararı bu çağrının DIŞINDA verilmiştir (sistem yolu / test).

    Adı bilinçli olarak uzundur: `void(..., izin_dogrula=None)` sessiz bir
    fail-open'dı; `izin_zaten_dogrulandi` ise okunduğu anda "burada yetki
    kontrolü YOK" der ve gerekçesini çağıranın üstlenmesini zorunlu kılar.
    """
    return None


async def void(
    db: AsyncSession,
    package_id: int,
    *,
    admin_id: int,
    reason: str,
    izin_dogrula: "Callable[[str], Awaitable[None]]",
) -> PackageView:
    """Paketten vazgeçilir (`VOID`) — gerekçe ZORUNLU.

    `DELIVERED` paket void EDİLEMEZ (terminal): teslim edilmiş bir paketi
    "yok" saymak, envanteri ve müşteri kaydını aynı anda yalanlar. Araçtaki
    paket de doğrudan void edilemez — önce geri gelmesi okutulmalıdır.

    Stok hareketi YAZILMAZ: iptal/iade yolunda satış iptali zaten deftere
    işlendi; paketi bozmak muhasebesel değil fiziksel bir iştir. Fiziksel
    bozma ayrı bir damgadır (`unpack`), böylece "bozulmayı bekleyen paketler"
    kuyruğu (`status='VOID' AND unpacked_at IS NULL`) anlamlı kalır.

    ## `izin_dogrula` — yetki kararı KİLİTLİ durumla verilir (TOCTOU)

    `void`'in gerektirdiği izin **paketin durumuna** bağlıdır (`OPEN` →
    `packing.pack`, kapanmış → `packing.manage`; sözleşme §6). Commit 4
    denetiminin bulgusu: router bu kararı **kilitsiz** okunan durumla
    veriyordu, yani araya giren bir `complete` sonrası yalnız `packing.pack`
    yetkisi olan kullanıcı **kapanmış** paketi çözebiliyordu (check-then-act).

    Çözüm, kararı servise taşımak DEĞİL — izin kataloğu iş mantığı katmanına
    sızmamalı — kararın **ne zaman** verildiğini taşımaktır: router bir
    doğrulayıcı geçirir ve o, `Order` + `OrderPackage` kilitleri alındıktan
    SONRA, taze durumla çağrılır. Yetki kararı ile durum geçişi böylece aynı
    transaction penceresinde, aynı satır kilidi altında kalır.

    **Parametre ZORUNLUDUR (commit 5 denetimi).** Eskiden varsayılanı `None`'dı
    ve `None` geldiğinde hiçbir yetki kontrolü yapılmıyordu — yani ileride
    eklenecek ikinci bir çağıran, parametreyi geçirmeyi unuttuğunda `PACKED`
    bir paketi `packing.manage` OLMADAN çözebilirdi ve bunu kıran hiçbir şey
    yoktu (sessiz fail-open). Artık atlamak isteyen çağıran bunu **adıyla**
    yazmak zorundadır: `izin_dogrula=izin_zaten_dogrulandi`.
    """
    temiz = _require_reason(reason, "Paket çözme")
    on = await _peek(db, package_id)
    order = await _lock_order(db, on.order_id)
    paket = await _lock_package(db, package_id)

    # Kilitten SONRA, TAZE durumla. Kilitten önce çağrılsaydı eşzamanlı
    # `complete` yetki kararını bayat bırakırdı.
    await izin_dogrula(paket.status)

    if paket.status == "VOID":
        return _view(paket)
    _require_action(paket, "void")

    onceki_durum = paket.status
    paket.status = "VOID"
    paket.void_at = _now()
    paket.void_by_admin_id = admin_id
    paket.void_reason = temiz
    # Paket yoksa sipariş "hazır" değildir; damga kalsaydı sipariş paketsiz
    # biçimde `eligible_orders`ta durur ve tura eklenirdi.
    order.prepared_at = None
    order.prepared_by = None
    # ...ve turda BEKLEYEN durağı da kalamaz (commit 5 denetimi, P1).
    #
    # Kilitler `add_stops` ile yarışı **kararsızlıktan** kurtarır ama tek
    # başına yetmez: `add_stops` yarışı kazanıp durağı yazdıktan sonra `void`
    # çalışırsa ortada çözülmüş paketli bir `PENDING` durak kalır. Sonuç iki
    # taraflı kilitlenmedir — `start_run` o durağı zimmetsiz sayıp bütün turu
    # 409'lar, sipariş de açık durağı yüzünden ne başka tura eklenebilir ne
    # kuyruğa girebilir; kurtuluş yalnız elle `remove_stop` olurdu.
    #
    # `order_fsm._close_open_stops` iptal/iade yolunda aynı işi yapıyor; paketin
    # çözülmesi de fiziksel olarak aynı anlama gelir: bu durakta teslim edilecek
    # bir şey kalmadı. Durak `CANCELLED` olur (`FAILED` DEĞİL — kurye
    # performansına yazılmaz, kimse teslim denemedi). Kanonik kilit sırası
    # korunur: Order → OrderPackage → DeliveryStop.
    kapatilan = await _acik_duraklari_kapat(
        db, order.id, note=f"Paket çözüldü ({packing_rules.package_code(paket.id)})"
    )
    packing_events.record(
        db,
        paket,
        event_type="VOID",
        from_status=onceki_durum,
        to_status="VOID",
        actor_role=_ADMIN_ROLE,
        actor_id=admin_id,
        meta={"reason": temiz},
    )
    await _audit(
        db,
        paket,
        admin_id=admin_id,
        action="package.void",
        reason=temiz,
        before={"status": onceki_durum},
        after={"status": "VOID", "kapatilan_durak": kapatilan},
    )
    await db.commit()
    return _view(paket)


async def unpack(db: AsyncSession, package_id: int, *, admin_id: int) -> PackageView:
    """Fiziksel bozma damgası — içerik rafa döndü (boşluk G8).

    Ayrı bir adımdır çünkü `VOID` bir KARAR, `unpacked_at` bir İŞtir; ikisini
    birleştirmek "bozulmayı bekleyen paketler" kuyruğunu yok ederdi. Stok
    hareketi yazılmaz.
    """
    on = await _peek(db, package_id)
    await _lock_order(db, on.order_id)
    paket = await _lock_package(db, package_id)

    if paket.unpacked_at is not None:
        return _view(paket)
    _require_action(paket, "unpack")

    paket.unpacked_at = _now()
    paket.unpacked_by_admin_id = admin_id
    packing_events.record(
        db,
        paket,
        event_type="UNPACK",
        actor_role=_ADMIN_ROLE,
        actor_id=admin_id,
    )
    await _audit(db, paket, admin_id=admin_id, action="package.unpack")
    await db.commit()
    return _view(paket)


# ══════════════════ Geri dönüş ══════════════════════════════════════════════


async def return_in(
    db: AsyncSession, package_id: int, *, admin_id: int, note: str | None = None
) -> PackageView:
    """Kuryeden dönen paket depoda OKUTULARAK kabul edilir (`RETURNED`).

    Sözleşme §3.5 / boşluk G5: "paket depoya geri döndü" bugüne kadar bir
    VARSAYIMDI (`fail_stop` yalnız `prepared_at`'i sıfırlıyordu). Artık fiziksel
    bir kabul adımı vardır; araçta unutulan paket `RETURN_PENDING` kuyruğunda
    görünür kalır. Defter hareketi YAZILMAZ — konum olayıdır, satış hareketi
    ödemede yazıldı ve sipariş hâlâ `PAID`.
    """
    on = await _peek(db, package_id)
    order = await _lock_order(db, on.order_id)
    paket = await _lock_package(db, package_id)

    if paket.status == "RETURNED":
        return _view(paket)
    _require_action(paket, "return_in")

    # Paket depoya döndü ama YENİDEN DAĞITIMA ONAYLANMADI: `prepared_at`
    # düşer, `repack` onu yeniden damgalar (sözleşme §3.5: "repack yalnız
    # RETURNED'dan sonra"). Damgayı bırakmak, operatör onayı olmadan siparişin
    # `eligible_orders`'ta durmasına yol açardı — `fail_stop` yolunda damga
    # zaten düşüyordu, `cancel_run` yolunda düşmüyordu ve iki yol aynı fiziksel
    # gerçeği anlatmasına rağmen farklı davranıyordu.
    order.prepared_at = None
    order.prepared_by = None

    onceki_durum = paket.status
    paket.status = "RETURNED"
    paket.returned_at = _now()
    paket.returned_by_admin_id = admin_id
    paket.return_note = (note or "").strip() or None
    packing_events.record(
        db,
        paket,
        event_type="RETURN_IN",
        from_status=onceki_durum,
        to_status="RETURNED",
        actor_role=_ADMIN_ROLE,
        actor_id=admin_id,
    )
    await _audit(
        db,
        paket,
        admin_id=admin_id,
        action="package.return_in",
        reason=paket.return_note,
        before={"status": onceki_durum},
        after={"status": "RETURNED"},
    )
    await db.commit()
    return _view(paket)


async def repack(db: AsyncSession, package_id: int, *, admin_id: int) -> PackageView:
    """Geri gelmiş paketi yeniden dağıtıma verir (`RETURNED` → `PACKED`).

    Sıra atlanamaz: `RETURN_PENDING`'ten doğrudan `repack` YOKTUR — paketin
    geri geldiği önce okutularak doğrulanmalıdır (§3.5, "belirsiz fiziksel
    olayda tahmin yok"). `prepared_at` yeniden damgalanır, sipariş tekrar
    `eligible_orders`'a girer.

    `packed_at` **tazelenmez**: o damga "içeriğin kalem kalem doğrulandığı an"
    demektir ve repack içeriği yeniden doğrulamaz (kutu açılmadı). Yeni
    kararın aktörü ve zamanı `REPACK` olayında durur.

    NOT: Sözleşmenin "eski paketi bozup yenisini aç" yolu bu fonksiyon DEĞİLDİR;
    o yol `void` + `open_package`'tır (yeni `package_no`, yeni QR). Buradaki
    repack aynı fiziksel paketi ve **aynı basılı etiketi** korur — G3'ün
    kazancı tam olarak budur.
    """
    on = await _peek(db, package_id)
    order = await _lock_order(db, on.order_id)
    paket = await _lock_package(db, package_id)

    if paket.status == "PACKED":
        return _view(paket)
    _require_action(paket, "repack")
    _require_open_order(order)
    # STALE — `complete` ile AYNI kural (commit 3 denetimi, P2-F kararı).
    # Gerekçe: `repack` `prepared_at`'i yeniden damgalar, yani paketi
    # `eligible_orders` kuyruğuna GERİ SOKAR. Paket araçtayken siparişin kalem
    # listesi değişmişse kutunun içindekiler artık siparişe karşılık gelmez ve
    # bu kutu yeniden dağıtıma verilirse müşteriye YANLIŞ içerik gider. Bugün
    # kalem düzenleme ucu yoktur (`order_service` tek yazıcı), yani bu kontrol
    # bir NÖBETÇİDİR: yarın kalem düzenleme eklendiğinde `complete` korunur
    # ama `repack` sessizce korumasız kalırdı.
    if _fingerprint(order) != paket.items_fingerprint:
        raise _hata(
            http.HTTP_409_CONFLICT,
            "STALE: paket hazırlandıktan sonra siparişin kalem listesi değişti — "
            "yeniden dağıtıma verilemez, paketi bozup yeniden açmak gerekir",
        )

    simdi = _now()
    onceki_durum = paket.status
    paket.status = "PACKED"
    order.prepared_at = simdi
    order.prepared_by = f"repack:admin:{admin_id}"
    packing_events.record(
        db,
        paket,
        event_type="REPACK",
        from_status=onceki_durum,
        to_status="PACKED",
        actor_role=_ADMIN_ROLE,
        actor_id=admin_id,
    )
    await _audit(
        db,
        paket,
        admin_id=admin_id,
        action="package.repack",
        before={"status": onceki_durum},
        after={"status": "PACKED", "prepared_at": simdi},
    )
    await db.commit()
    return _view(paket)


# ══════════════════ Zimmet (teslimat tarafından çağrılır) ═══════════════════


async def mark_handed_over(
    db: AsyncSession,
    paket: OrderPackage,
    *,
    courier_id: int | None,
    actor: str,
    actor_role: int | None = None,
    actor_id: int | None = None,
) -> bool:
    """Paketi `HANDED_OVER` yapar; **commit ETMEZ**.

    Zimmetin kendisi `delivery_service.handover_scan`'dedir (durak/tur/kurye
    bilgisi orada) — sözleşme §3.7'ye göre bağımlılık yönü
    `delivery_service → packing_service`'tir ve tersi YASAKTIR. Bu fonksiyon o
    akışın paket ayağıdır ve çağıranın transaction'ı içinde kalır: paketin
    zimmetlenmesiyle siparişin `SHIPPED` olması ya birlikte kalıcı olur ya
    hiçbiri.

    Dönüş `False` = paket zaten zimmetli (çift okutma) → çağıran ikinci bir
    `SHIPPED` geçişi üretmemelidir.
    """
    if paket.status == "HANDED_OVER":
        return False
    _require_action(paket, "handover")
    onceki_durum = paket.status
    paket.status = "HANDED_OVER"
    paket.handed_over_at = _now()
    paket.handed_to_courier_id = courier_id
    paket.handed_over_by_actor = actor[:60]
    packing_events.record(
        db,
        paket,
        event_type="HANDOVER",
        from_status=onceki_durum,
        to_status="HANDED_OVER",
        actor_role=actor_role,
        actor_id=actor_id,
        meta={"courier_id": courier_id, "actor": actor},
    )
    return True
