"""F30 paket olay defteri + sipariş/teslimat kancaları — **ince** modül.

Sözleşme §3.7 (modül bağımlılık yönü). F30 iki yönlü bir ihtiyaç doğuruyor:
`packing_service` sipariş durumunu okur; `order_fsm` ise sipariş
`CANCELLED`/`REFUNDED` olurken canlı paketi çözmek zorunda. Naif çözüm
karşılıklı `import` — modül düzeyinde ImportError, fonksiyon içinde gizli bir
bağımlılık döngüsü. Karar:

    packing_service ──import──▶ packing_events        (izinli)
    order_fsm       ──import──▶ packing_events        (izinli)
    delivery_service──import──▶ packing_events        (izinli)
    packing_events  ─X─▶ packing_service                        (YASAK)
    packing_events  ─X─▶ delivery_service                       (YASAK)

Bu modülde **iş mantığı yoktur**: `open_package`, `scan`, `complete` burada
değildir. Yalnız (a) append-only olay yazıcısı ve (b) "sipariş/teslimat şu oldu,
paket konumuna göre şu duruma geçmeli" kancaları durur. Sınır bir kabul
testiyle korunur (`test_packing_events_SERVISI_IMPORT_ETMEZ`).

## Kancalar hiçbir zaman commit ETMEZ

Hepsi çağıranın transaction'ının içinde çalışır: sipariş iptali ile paketin
çözülmesi **aynı** transaction'da olmalıdır, yoksa iptal kalıcı olurken paket
canlı kalabilir (ve `uq_order_packages_live` yüzünden sipariş bir daha
paketlenemez).
"""
from __future__ import annotations

import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.packing import OrderPackage, PackageScanEvent
from models.store import Order
from services import packing_rules

#: Sistem kaynaklı olayın aktörü YOKTUR (`ck_package_scan_events_actor`:
#: ya ikisi de dolu ya ikisi de NULL). Kanca sipariş/teslimat olayının
#: yankısıdır; asıl aktör `order_status_history` ve `delivery_stops`tadır.
_SISTEM_AKTOR: tuple[None, None] = (None, None)

#: `record()`'ta "durumu ben doldurayım" ile "açıkça NULL yaz"ı ayıran nöbetçi.
#: Varsayılan olarak `None` kullanılsaydı paket AÇILIRKEN (`from_status` gerçekten
#: yok) NULL yazmanın yolu kalmazdı.
MEVCUT_DURUM = "__mevcut__"


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def record(
    db: AsyncSession,
    package: OrderPackage,
    *,
    event_type: str,
    result: str | None = None,
    code_scanned: str | None = None,
    qty_delta: int = 0,
    from_status: str | None = MEVCUT_DURUM,
    to_status: str | None = MEVCUT_DURUM,
    package_item_id: int | None = None,
    manual_reason: str | None = None,
    actor_role: int | None = None,
    actor_id: int | None = None,
    meta: dict | None = None,
    idempotency_key: str | None = None,
) -> PackageScanEvent:
    """Append-only iz satırı ekler (flush ETMEZ, commit ETMEZ).

    `from_status`/`to_status` verilmezse paketin O ANKİ durumu her ikisine de
    yazılır. Durum değiştirmeyen olaylarda (SCAN/UNDO_SCAN/UNPACK) bu bilinçli
    bir tercihtir: izi okuyan insan "bu tarama hangi durumdayken yapıldı"
    sorusunu satırın kendisinden cevaplayabilmelidir. NULL bırakmak o bilgiyi
    yalnız komşu satırlardan çıkarılabilir kılardı. Açıkça `None` vermek NULL
    yazar (paket AÇILIRKEN önceki durum gerçekten yoktur).
    """
    if from_status == MEVCUT_DURUM:
        from_status = package.status
    if to_status == MEVCUT_DURUM:
        to_status = package.status
    olay = PackageScanEvent(
        package_id=package.id,
        package_item_id=package_item_id,
        event_type=event_type,
        result=result,
        code_scanned=code_scanned,
        qty_delta=qty_delta,
        from_status=from_status,
        to_status=to_status,
        manual_reason=manual_reason,
        actor_role=actor_role,
        actor_id=actor_id,
        meta=meta,
        idempotency_key=idempotency_key,
    )
    db.add(olay)
    return olay


async def live_package(
    db: AsyncSession, order_id: int, *, lock: bool = False
) -> OrderPackage | None:
    """Siparişin CANLI paketi (en fazla bir tane — `uq_order_packages_live`).

    Yüklem `packing_rules.LIVE_STATUSES`'ten üretilir; servis içinde elle
    yazılmış ikinci bir filtre er ya da geç kısmi index'ten ayrışırdı.
    """
    stmt = select(OrderPackage).where(
        OrderPackage.order_id == order_id,
        OrderPackage.status.in_(packing_rules.LIVE_STATUSES),
    )
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return (await db.execute(stmt)).scalars().first()


async def _lock_order(db: AsyncSession, order_id: int) -> None:
    """Kanonik kilit sırasının ilk halkası: Order → OrderPackage.

    Kanca `order_fsm`/`delivery_service` içinden, bazen sipariş satırı zaten
    kilitliyken çağrılır — satır kilidi yeniden giriş yapılabilir olduğundan
    maliyeti yoktur. Buradaki asıl kazanç, kilidi ALMAYAN bir çağıranın da
    (ör. `transition_order`'a kilitsiz gelen bir yol) sırayı bozmamasıdır.
    """
    await db.execute(select(Order.id).where(Order.id == order_id).with_for_update())


async def _gecis(
    db: AsyncSession,
    package: OrderPackage,
    *,
    islem: str,
    reason: str,
    zaman: datetime.datetime,
) -> bool:
    """Saf kural tablosuna göre paket durumunu ilerletir; olayı yazar.

    Geçiş izinli değilse **sessizce hiçbir şey yapmaz ve False döner**: kanca
    bir sipariş/teslimat olayının yankısıdır, sipariş yolunu 409'la kesmek
    yanlış olurdu (iptal edilemeyen sipariş diye bir şey doğardı). Yasak geçiş
    zaten "bu paket o konumda değil" demektir ve doğru cevap işlem yapmamaktır.
    """
    kural = packing_rules.action_rule(islem)
    onceki = package.status
    if not packing_rules.allows(islem, onceki):
        return False
    hedef = kural.to_status
    if hedef is None or not packing_rules.can_transition(onceki, hedef):
        return False
    package.status = hedef
    if hedef == "VOID":
        package.void_at = zaman
        package.void_reason = reason
    elif hedef == "DELIVERED":
        package.delivered_at = zaman
    record(
        db,
        package,
        event_type=kural.event_type,
        from_status=onceki,
        to_status=hedef,
        manual_reason=None,
        actor_role=_SISTEM_AKTOR[0],
        actor_id=_SISTEM_AKTOR[1],
        meta={"reason": reason},
    )
    return True


async def on_order_terminal(db: AsyncSession, order: Order, *, reason: str) -> None:
    """Sipariş `CANCELLED`/`REFUNDED` oldu — canlı paket konumuna göre çözülür.

    Sözleşme §3.5, boşluk G8. Tek kural: **paket, konumu neyse ona uygun yola
    girer.**

    * ON_PREMISE (`OPEN`/`PACKED`/`RETURNED`) → `VOID`. Sipariş yok, paket de
      olmamalı; "bozulmayı bekleyen paketler" kuyruğuna düşer
      (`status='VOID' AND unpacked_at IS NULL`). `prepared_at` da sıfırlanır —
      aksi hâlde iptal edilmiş sipariş `eligible_orders`'ta durmaya devam eder.
    * OFF_PREMISE (`HANDED_OVER`) → `RETURN_PENDING`. Araçtaki paketi doğrudan
      VOID etmek, envanterin onu yok sayması demekti; önce kurye getirecek.
    * `RETURN_PENDING` → dokunulmaz (zaten geri bekleniyor).

    Stok hareketi YAZILMAZ: iptal/iade yolunda `order_service._restock` zaten
    `SALE_CANCEL` yazdı; paketi çözmek muhasebesel değil fiziksel bir iştir.
    """
    await _lock_order(db, order.id)
    package = await live_package(db, order.id, lock=True)
    if package is None:
        return
    zaman = _now()
    if packing_rules.is_on_premise(package.status):
        if await _gecis(db, package, islem="void", reason=reason, zaman=zaman):
            order.prepared_at = None
            order.prepared_by = None
        return
    await _gecis(db, package, islem="return_pending", reason=reason, zaman=zaman)


async def on_package_returning(
    db: AsyncSession, order_id: int, *, reason: str
) -> bool:
    """Paket kuryede kaldı: `HANDED_OVER` → `RETURN_PENDING` (sözleşme §3.5).

    **Dört yol** buraya varır ve hepsi aynı fiziksel gerçeği anlatır —
    `fail_stop` · `cancel_run` · `expire_stale_runs` (watchdog) ·
    `postpone_delivery`. "Paket depoya geri döndü" bir VARSAYIMDIR (boşluk G5);
    bu yüzden paket doğrudan `RETURNED` yapılmaz, geri geldiği depoda
    **okutularak** doğrulanır (`packing_service.return_in`).
    """
    await _lock_order(db, order_id)
    package = await live_package(db, order_id, lock=True)
    if package is None:
        return False
    return await _gecis(
        db, package, islem="return_pending", reason=reason, zaman=_now()
    )


async def on_package_delivered(db: AsyncSession, order_id: int) -> bool:
    """Durak teslim edildi: `HANDED_OVER` → `DELIVERED` (terminal).

    Paket terminal olunca QR'ı da geçersizleşir (sözleşme §3.3) — aynı etiketle
    ikinci bir teslim akışı açılamaz.
    """
    await _lock_order(db, order_id)
    package = await live_package(db, order_id, lock=True)
    if package is None:
        return False
    return await _gecis(
        db, package, islem="deliver", reason="Teslim edildi", zaman=_now()
    )


def dispatchable_package_condition():
    """"Paket geçmişi varsa, CANLI ve HAZIR (`PACKED`) bir paketi olmalı" — SQL.

    `eligible_orders` bunu kullanır. Tek başına `prepared_at` yetmez: damga
    üretimde yalnız `complete`/`repack`'ten doğsa da (yapısal nöbetçi bunu
    korur) F30 ÖNCESİNDEN kalan ya da elle sızmış bir damga, paketi çözülmüş
    (`VOID`) veya yeniden onaylanmamış (`RETURNED`) bir siparişi dağıtım
    kuyruğuna sokabilirdi. Paketi HİÇ olmamış siparişler bilinçli olarak
    dışarıda tutulmaz — onlar F30 öncesi akıştan gelir ve commit 5'te
    kilitlenmemelidir.
    """
    herhangi = (
        select(OrderPackage.id).where(OrderPackage.order_id == Order.id).exists()
    )
    hazir = (
        select(OrderPackage.id)
        .where(
            OrderPackage.order_id == Order.id,
            OrderPackage.status == "PACKED",
        )
        .exists()
    )
    return ~herhangi | hazir


def first_packing_blocked_condition():
    """"Bu sipariş İLK paketleme kuyruğuna girmemeli" — SQL `EXISTS`.

    Commit 5 denetiminin bulduğu çıkmaz: `return_in` paketi `RETURNED` yapıp
    `prepared_at`'i sıfırlıyor, sipariş de normal "topla ve paketle" kuyruğuna
    düşüyordu. Oysa paket **rafta hazır duruyor**; doğru işlem `repack`'tir.
    Operatör kuyrukta "Paketle" görüp `open_package` çağırınca mevcut
    `RETURNED` paketi geri alıyor, `complete` ise 409 veriyordu — ekranda
    hiçbir yere varmayan bir döngü.

    Buraya giren durumlar (hepsi "yeni paket AÇILMAMALI" demektir):

    * `RETURNED`  — depoda, `repack` bekliyor (ayrı kuyruk / ayrı eylem)
    * `HANDED_OVER` / `RETURN_PENDING` — araçta, `return_in` bekliyor

    `OPEN` bilinçli olarak DIŞARIDADIR: yarım kalmış paket zaten o siparişin
    işidir ve kuyrukta "devam et" olarak görünmelidir. `VOID` de dışarıdadır:
    paket çözülmüştür, sipariş gerçekten yeniden toplanmalıdır.
    """
    engelli = [s for s in packing_rules.LIVE_STATUSES if s != "OPEN"]
    return (
        select(OrderPackage.id)
        .where(
            OrderPackage.order_id == Order.id,
            OrderPackage.status.in_(engelli),
        )
        .exists()
    )


def open_stop_without_package_exists():
    """"Paketi HİÇ olmamış ama zaten bir turda bekleyen" sipariş — SQL `EXISTS`.

    Paketleme kuyruğu bunu DIŞARIDA bırakır. Somut hata (bağımsız denetim,
    P2-4): F30 öncesinden kalan bir sipariş elle "Hazır" damgalanıp tura
    eklenmişti; paket geçmişi olmadığı için kuyrukta "Paketle" olarak görünüyor,
    operatör paketleyip `complete` diyor, ama durak ZATEN vardı ve zimmetsiz
    kaldığı için `start_run` bütün turu 409'luyordu. Yani ekran, sonu 409 olan
    bir iş öneriyordu.

    Kural yalnız **paket geçmişi olmayan** siparişe uygulanır; yeni siparişlerin
    paket zorunluluğu GEVŞETİLMEZ (paketi olan sipariş zaten `add_stops`
    guard'larından geçmiştir ve kuyruktaki yeri paketinin durumuna bağlıdır).

    ## Neden burada, neden SQL

    Anlam `delivery_service._has_open_stop` ile aynıdır ama sözleşme §3.7
    `packing_service`in `delivery_service`i import etmesini YASAKLAR (döngü
    sınırı). Bu yüzden koşul, yalnız modellere dokunan bu ince modülde SQL
    olarak yazılır. Kopya olduğu için ayrışabilir; nöbetçisi
    `test_f30_guards_pg.py::test_C7_LEGACY_ACIK_DURAKLI_SIPARIS_KUYRUKTA_GORUNMEZ`
    içinde iki tarafın aynı sipariş için aynı cevabı verdiğini doğrulayan
    iddiadır.
    """
    from models.delivery import (
        DeliveryRun,
        DeliveryRunStatus,
        DeliveryStop,
        DeliveryStopStatus,
    )

    acik_durak = (
        select(DeliveryStop.id)
        .join(DeliveryRun, DeliveryStop.run_id == DeliveryRun.id)
        .where(
            DeliveryStop.order_id == Order.id,
            DeliveryStop.status == DeliveryStopStatus.PENDING.value,
            DeliveryRun.status.in_(
                (DeliveryRunStatus.PLANNED.value, DeliveryRunStatus.ACTIVE.value)
            ),
            DeliveryRun.deleted_at.is_(None),
        )
        .exists()
    )
    paket_gecmisi = (
        select(OrderPackage.id).where(OrderPackage.order_id == Order.id).exists()
    )
    return acik_durak & ~paket_gecmisi


def off_premise_package_exists():
    """"Bu siparişin paketi ARAÇTA" koşulu — SQL `EXISTS` alt sorgusu (saf yapı).

    `prep_queue` / `eligible_orders` / `add_stops` bunu paylaşır: depoda olmayan
    paket için "topla ve paketle" görevi üretmek ya da onu yeni bir tura
    yüklemek yanlış iştir (personel ikinci bir kopya toplamaya kalkar —
    sözleşme §3.5).
    """
    disarida = [
        s for s in packing_rules.LIVE_STATUSES if not packing_rules.is_on_premise(s)
    ]
    return (
        select(OrderPackage.id)
        .where(
            OrderPackage.order_id == Order.id,
            OrderPackage.status.in_(disarida),
        )
        .exists()
    )
