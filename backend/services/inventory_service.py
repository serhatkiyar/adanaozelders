"""F29 sayım servisi — oturum FSM'i, fiziksel uzlaştırma, atomik uygulama.

Kapsam (commit 5): oturum açma, satır üretme, miktar girme/yeniden sayma,
`REVIEW`/`IN_PROGRESS` geçişleri, `STALE` tespiti ve çözümü, atomik uygulama,
idempotent retry, `ON_PREMISE` hesabı, kilit sırası, audit + append-only iz.
**Hasar işlemleri, HTTP uçları ve arayüz bu modülde YOKTUR** (commit 6/7/8).

## Neden `products.stock` tek başına yetmiyor

`products.stock` **satılabilir** miktardır, işletmedeki kitap sayısı değil.
Ödeme (`SALE`) satılabilirden düşer ama kitap tur başlayana kadar işletmededir.
Bu yüzden sayımın karşılaştırdığı büyüklük:

    beklenen_fiziksel = system_qty_snapshot + reserved_qty_snapshot

`reserved` yalnız satılabilir kovada anlamlıdır; hasarlı ürün siparişe ayrılamaz.

## Fark neden sayım anına ait

Fark `counted - beklenen` olarak **sayıldığı anda** hesaplanabilir bir gerçektir.
Sayımla uygulama arasında geçen olaylar, otomatik uzlaştırılabilir oldukları
sürece beklenen ile gerçek tarafı AYNI miktarda değiştirir ve farkı taşımaz
(`inventory_rules.PHYSICAL_EFFECT`). Fiziksel etkisi belirsiz bir olay geçtiyse
satır `STALE` olur — matematiksel olarak bir sayı üretilebiliyor olması, fiziksel
gerçeğin bilindiği anlamına gelmez.

## Kilit sırası

    StockCountSession → Product → Order → OrderReturn → ...

`apply_session` **önce oturumu koşullu UPDATE ile claim eder**, sonra ürünleri
`stock_ledger.lock_products` ile kilitler. Ters sıra `Product → StockCountSession`
yolunu açar ve satışla döngü kurar. Ürün kilidi alan tek yer `lock_products`'tır;
bu modül kendi `with_for_update`'ini AÇMAZ.

## Atomiklik

Kısmi uygulama yoktur. Tüm satırlar önce doğrulanır, ürünler deterministik
sırada kilitlenir, hareketler **tek** `apply_many` batch'iyle yazılır, ancak
flush başarılı olduktan sonra oturum `APPLIED` olur. Bir satır hata verirse
hiçbir hareket ve hiçbir durum değişikliği kalmaz.
"""
from __future__ import annotations

import dataclasses
import datetime
import logging
import uuid
from typing import Any, Sequence

from fastapi import HTTPException, status
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.inventory import (
    CountLineStatus,
    CountSessionStatus,
    StockCountLine,
    StockCountLineEvent,
    StockCountSession,
)
from models.store import Product, ProductKind, StockBucket, StockMovement
from services import audit_service, inventory_rules, stock_ledger

logger = logging.getLogger("adana.inventory")

SALEABLE = StockBucket.SALEABLE.value
DAMAGED = StockBucket.DAMAGED.value
BUCKETS: tuple[str, ...] = (SALEABLE, DAMAGED)

#: Sayım farkının deftere yazılırken taşıdığı gerekçe kodları.
REASON_SURPLUS = "SAYIM_FAZLA"
REASON_SHORTAGE = "SAYIM_EKSIK"

#: `STALE` sebep kodları. Arayüz metni bu kodlara bağlanır; serbest metne
#: bağlanan bir ekran, mesaj değişince sessizce bozulur.
STALE_UNCERTAIN_EVENT = "UNCERTAIN_EVENT"
STALE_PRODUCT_UNTRACKED = "PRODUCT_UNTRACKED"
STALE_LEDGER_INCONSISTENT = "LEDGER_INCONSISTENT"

#: Bir oturumun tek istekte kapsayabileceği EN FAZLA ürün. Sınırsız kapsam,
#: tek transaction'da binlerce ürünü kilitler ve satışı bloke ederdi; plan
#: "büyük operasyon → küçük oturumlar" diyor.
MAX_SESSION_PRODUCTS = 200


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _hata(code: int, mesaj: str) -> HTTPException:
    return HTTPException(status_code=code, detail=mesaj)


@dataclasses.dataclass(frozen=True, slots=True)
class _Aktor:
    """`audit_service.record` yalnız `id` ve `role_id` okur. Admin satırını
    yeniden yüklemek her aksiyona bir sorgu eklerdi."""

    id: int
    role_id: int = 1


@dataclasses.dataclass(frozen=True, slots=True)
class OnPremise:
    """Bir ürünün işletmedeki **fiziksel** mevcudunun dökümü."""

    product_id: int
    saleable: int
    damaged: int
    #: Ödenmiş ama işletmeden çıkmamış kalemler (kolon değil, türetilir).
    reserved: int

    @property
    def total(self) -> int:
        return self.saleable + self.damaged + self.reserved


# ════════════════════════ ON_PREMISE / rezerve ════════════════════════

#: Rezerve sayılan sipariş durumu. Tek değer, ama **anlamıyla** seçildi:
#: `PAID` = ödeme kesinleşti ve sipariş henüz işletmeden ÇIKMADI.
#:
#: * `SHIPPED` hariç — tur başlarken yazılır, kurye kontrolüne geçiş demektir.
#: * `DELIVERED` hariç — müşteride.
#: * `CANCELLED` / `REFUNDED` hariç — `SALE_CANCEL` zaten stoğu geri yükledi;
#:   burada da saymak aynı kitabı iki kez sayardı.
#: * `PENDING` hariç — ödeme yok, stoktan da düşmedi.
#:
#: Teslim edilemeyen paket `PAID`'e geri döner (`order_service`
#: `_restore_after_failed_delivery`) ve işletmeye FİZİKSEL olarak geri gelmiştir
#: → doğru tarafta sayılır. Hazırlanmış (`prepared_at` dolu) ama tura girmemiş
#: sipariş de `PAID`'dir → dâhil.
_RESERVED_ORDER_STATUS = "PAID"

_RESERVED_SQL = text(
    """
    SELECT oi.product_id, sum(oi.quantity) AS adet
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.deleted_at IS NULL
      AND o.payment_status = 'PAID'
      AND o.status = :durum
      AND oi.product_id = ANY(:ids)
    GROUP BY oi.product_id
    """
)


#: Sayım anının **TEK İFADEDE** alınan kesiti.
#:
#: ## Neden tek ifade, neden kilit değil
#:
#: READ COMMITTED'da **her ifade yeni bir anlık görüntü** görür. Bileşenleri ayrı
#: sorgularla okumak "karışık kesit" üretir ve bu sessizce yanlış fark yazar:
#: bakiye okundu (8) → sipariş `PAID→SHIPPED` oldu → rezerve okundu (0) →
#: beklenen 8 çıkar, oysa personel paket işletmedeyken 10 saymıştır.
#:
#: Ürün satır kilidi bu yarışı **KAPATMAZ**: sipariş durumunu değiştiren üretim
#: yollarının hiçbiri `Product` kilidi almaz ve hiçbiri defter hareketi yazmaz
#: (`delivery_service.start_run` · `add_stops` · `remove_stop` ·
#: `order_service.mark_shipped` · `mark_delivered` · `fail_stop` · `cancel_run` ·
#: `expire_stale_runs` · `postpone_delivery`). `delivery_service` `stock_ledger`'ı
#: hiç import etmez. Dolayısıyla ürünü kilitlemek yalnız satışı bloke eder,
#: rezerveyi korumaz.
#:
#: Siparişleri kilitlemek de çözüm değil: bir ürüne değen sipariş kümesi sınırsız
#: ve açık uçludur (kilit alındıktan sonra yeni sipariş gelebilir), üstelik elle
#: sayım süresince mağazayı durdururdu.
#:
#: **Seçilen mekanizma: tek ifadelik kesit.** Tek `SELECT` tek anlık görüntüde
#: çalıştığı için karışık kesit *yapısal olarak imkânsızdır*. Sonuç ya tamamen
#: olay öncesi (aradaki olay sonradan uzlaştırılır ya da `STALE` yapar) ya da
#: tamamen olay sonrasıdır. Yeni kilit eklenmediği için kilit grafiği de
#: büyümez — `Order → Product` ters yönü hiç doğmaz.
_SNAPSHOT_SQL = text(
    """
    SELECT p.stock                                   AS saleable,
           p.damaged_stock                           AS damaged,
           coalesce((
               SELECT sum(oi.quantity)
               FROM order_items oi
               JOIN orders o ON o.id = oi.order_id
               WHERE o.deleted_at IS NULL
                 AND o.payment_status = 'PAID'
                 AND o.status = :durum
                 AND oi.product_id = p.id
           ), 0)                                     AS reserved,
           (SELECT max(m.id) FROM stock_movements m
             WHERE m.product_id = p.id AND m.bucket = :kova) AS high_water,
           clock_timestamp()                         AS anda
    FROM products p
    WHERE p.id = :pid
    """
)


async def snapshot_for_line(db: AsyncSession, product_id: int, bucket: str):
    """Sayım satırının kesiti — **tek sorgu** (bkz. `_SNAPSHOT_SQL`).

    Sorgu sayısı bir davranış testiyle sabitlenmiştir
    (`test_snapshot_TEK_IFADEDE_alinir`): ikiye bölünmesi karışık kesit
    yarışını geri getirir ve testte görünür.
    """
    satir = (
        await db.execute(
            _SNAPSHOT_SQL,
            {"pid": product_id, "kova": bucket, "durum": _RESERVED_ORDER_STATUS},
        )
    ).first()
    if satir is None:
        raise _hata(status.HTTP_400_BAD_REQUEST, "ürün bulunamadı")
    return satir


async def reserved_on_premise(
    db: AsyncSession, product_ids: Sequence[int]
) -> dict[int, int]:
    """Ürün başına "ödenmiş ama işletmeden çıkmamış" adet — **tek sorgu**.

    Ürün başına sorgu N+1 üretirdi; sayım oturumu yüzlerce ürün taşıyabilir.
    """
    ids = [int(i) for i in dict.fromkeys(product_ids)]
    if not ids:
        return {}
    satirlar = (
        await db.execute(_RESERVED_SQL, {"ids": ids, "durum": _RESERVED_ORDER_STATUS})
    ).all()
    return {int(r.product_id): int(r.adet) for r in satirlar}


async def expected_on_premise(
    db: AsyncSession, product_ids: Sequence[int]
) -> dict[int, OnPremise]:
    """Ürün başına fiziksel mevcut dökümü. İki sorgu (ürünler + rezerve)."""
    ids = [int(i) for i in dict.fromkeys(product_ids)]
    if not ids:
        return {}
    urunler = (
        await db.execute(
            select(Product.id, Product.stock, Product.damaged_stock).where(
                Product.id.in_(ids)
            )
        )
    ).all()
    rezerve = await reserved_on_premise(db, ids)
    return {
        int(r.id): OnPremise(
            product_id=int(r.id),
            saleable=int(r.stock or 0),
            damaged=int(r.damaged_stock or 0),
            reserved=rezerve.get(int(r.id), 0),
        )
        for r in urunler
    }


# ════════════════════════ Yükleme ve doğrulama ════════════════════════


async def _oturum(
    db: AsyncSession, session_id: int, *, for_update: bool = False
) -> StockCountSession:
    """Oturumu getirir; durum DEĞİŞTİREN her yol `for_update=True` ister.

    Kilitsiz okuma READ COMMITTED'da **kayıp güncelleme** üretir: uygulama
    oturumu claim etmişken (henüz commit etmemişken) gelen bir "yeniden say"
    isteği eski anlık görüntüde `REVIEW` görür, geçişi geçerli sayar ve
    uygulamanın commit'ini bekledikten sonra oturumu `IN_PROGRESS`'e çeker —
    sonuç: hareketleri yazılmış ama "uygulanmamış" görünen bir oturum. Gerçek
    yarış testinde (`test_inventory_apply_race_pg.py`) bu yalnız zamanlama
    sayesinde görünmüyordu.

    `populate_existing=True`: kilit alındıktan sonra ORM kimlik haritasındaki
    **bayat** nesne değil, tazelenmiş satır döner (defter servisiyle aynı tuzak).
    """
    sorgu = select(StockCountSession).where(
        StockCountSession.id == session_id,
        StockCountSession.deleted_at.is_(None),
    )
    if for_update:
        sorgu = sorgu.with_for_update().execution_options(populate_existing=True)
    oturum = (await db.execute(sorgu)).scalars().first()
    if oturum is None:
        raise _hata(status.HTTP_404_NOT_FOUND, "sayım oturumu bulunamadı")
    return oturum


async def _satirlar(db: AsyncSession, session_id: int) -> list[StockCountLine]:
    return list(
        (
            await db.execute(
                select(StockCountLine)
                .where(StockCountLine.session_id == session_id)
                .order_by(StockCountLine.product_id, StockCountLine.bucket)
            )
        ).scalars()
    )


def _gecis_dogrula(oturum: StockCountSession, hedef: str) -> None:
    if not inventory_rules.can_transition(oturum.status, hedef):
        raise _hata(
            status.HTTP_409_CONFLICT,
            f"sayım oturumu {oturum.status} durumundan {hedef} durumuna geçemez",
        )


async def _sayilabilir_urunler(
    db: AsyncSession, product_ids: Sequence[int]
) -> list[Product]:
    """Sayıma girebilecek ürünleri döndürür; giremeyeni **açıkça reddeder**.

    Dijital ürün ve `stock IS NULL` olan ürün sayılamaz: ikisi de "stok takip
    edilmiyor" demektir ve sayım onlara bir bakiye UYDURURDU.
    """
    ids = [int(i) for i in dict.fromkeys(product_ids)]
    if not ids:
        raise _hata(status.HTTP_400_BAD_REQUEST, "sayım kapsamı boş olamaz")
    if len(ids) > MAX_SESSION_PRODUCTS:
        raise _hata(
            status.HTTP_400_BAD_REQUEST,
            f"tek oturumda en fazla {MAX_SESSION_PRODUCTS} ürün sayılabilir "
            f"(istenen: {len(ids)}); kapsamı küçük oturumlara bölün",
        )
    urunler = list(
        (
            await db.execute(
                select(Product).where(
                    Product.id.in_(ids), Product.deleted_at.is_(None)
                )
            )
        ).scalars()
    )
    bulunan = {p.id for p in urunler}
    eksik = [i for i in ids if i not in bulunan]
    if eksik:
        raise _hata(status.HTTP_400_BAD_REQUEST, f"ürün bulunamadı: {eksik}")
    izlenmeyen = [
        p.id
        for p in urunler
        if p.stock is None or p.kind == ProductKind.DIGITAL.value
    ]
    if izlenmeyen:
        raise _hata(
            status.HTTP_400_BAD_REQUEST,
            "stok takip edilmeyen ürün sayıma eklenemez (dijital ya da "
            f"stoğu izlenmeyen): {izlenmeyen}",
        )
    return urunler


async def _son_hareket_idleri(
    db: AsyncSession, product_ids: Sequence[int]
) -> dict[tuple[int, str], int]:
    """`(ürün, kova)` başına son `stock_movements.id` — snapshot'ın çapası."""
    ids = [int(i) for i in dict.fromkeys(product_ids)]
    if not ids:
        return {}
    satirlar = (
        await db.execute(
            text(
                "SELECT product_id, bucket, max(id) AS son "
                "FROM stock_movements WHERE product_id = ANY(:ids) "
                "GROUP BY product_id, bucket"
            ),
            {"ids": ids},
        )
    ).all()
    return {(int(r.product_id), r.bucket): int(r.son) for r in satirlar}


async def _satir_uret(
    db: AsyncSession, oturum: StockCountSession, urunler: Sequence[Product]
) -> list[StockCountLine]:
    """Ürün başına İKİ satır (satılabilir + hasarlı) üretir.

    Hasarlı satırın da açılması bilinçli: "hasarlı var mı?" sorusunu sayım
    ekranı sorar; yoksa satır `SKIPPED` kalır ve `damaged_stock` DEĞİŞMEZ.
    Satırı hiç açmamak, hasarlı kovanın hiç sayılamaması demek olurdu.
    """
    ids = [p.id for p in urunler]
    rezerve = await reserved_on_premise(db, ids)
    son_hareket = await _son_hareket_idleri(db, ids)
    yeni: list[StockCountLine] = []
    for p in urunler:
        for kova in BUCKETS:
            satir = StockCountLine(
                session_id=oturum.id,
                product_id=p.id,
                bucket=kova,
                system_qty_snapshot=int(
                    (p.stock if kova == SALEABLE else p.damaged_stock) or 0
                ),
                # Rezerve YALNIZ satılabilir kovada anlamlı (DB CHECK de zorlar).
                reserved_qty_snapshot=(
                    rezerve.get(p.id, 0) if kova == SALEABLE else None
                ),
                snapshot_movement_id=son_hareket.get((p.id, kova)),
                status=CountLineStatus.PENDING.value,
            )
            db.add(satir)
            yeni.append(satir)
    await db.flush()
    return yeni


# ════════════════════════ Oturum yaşam döngüsü ════════════════════════


async def create_session(
    db: AsyncSession,
    *,
    scope: str,
    admin_id: int,
    product_ids: Sequence[int] | None = None,
    category_id: int | None = None,
    note: str | None = None,
) -> StockCountSession:
    """`DRAFT` oturum + kapsamdaki her ürün için iki satır üretir.

    `commit` YAPMAZ — transaction sınırı çağıranındır (defter servisiyle aynı
    disiplin; oturum açma ile satır üretimi bölünemez).
    """
    if scope not in ("ALL", "CATEGORY", "MANUAL"):
        raise _hata(status.HTTP_400_BAD_REQUEST, f"geçersiz kapsam: {scope!r}")
    if scope == "CATEGORY" and category_id is None:
        raise _hata(
            status.HTTP_400_BAD_REQUEST, "CATEGORY kapsamı kategori kimliği ister"
        )
    if scope != "CATEGORY" and category_id is not None:
        raise _hata(
            status.HTTP_400_BAD_REQUEST,
            "kategori kimliği yalnız CATEGORY kapsamında verilebilir",
        )

    if scope == "MANUAL":
        hedef_ids = list(product_ids or [])
    else:
        kosul = [Product.deleted_at.is_(None), Product.stock.is_not(None)]
        if scope == "CATEGORY":
            kosul.append(Product.category_id == category_id)
        hedef_ids = list(
            (
                await db.execute(
                    select(Product.id).where(*kosul).order_by(Product.id)
                )
            ).scalars()
        )
    urunler = await _sayilabilir_urunler(db, hedef_ids)

    oturum = StockCountSession(
        # `code` `id`'nin fonksiyonudur ama `id` flush'tan önce bilinmez;
        # geçici benzersiz değer konur ve flush'tan sonra kesin değere çevrilir.
        # Sayaç sorgusu (`max+1`) yarışta çakışırdı.
        code=f"GECICI-{uuid.uuid4().hex[:16]}",
        status=CountSessionStatus.DRAFT.value,
        scope=scope,
        category_id=category_id,
        note=note,
        created_by_admin_id=admin_id,
    )
    db.add(oturum)
    await db.flush()
    oturum.code = f"SAYIM-{_now().year}-{oturum.id:04d}"
    await _satir_uret(db, oturum, urunler)
    await _audit(
        db, admin_id, "inventory.count_session_create", oturum,
        meta={"scope": scope, "product_count": len(urunler)},
    )
    return oturum


async def add_products(
    db: AsyncSession, session_id: int, product_ids: Sequence[int], *, admin_id: int
) -> list[StockCountLine]:
    """Kapsama ürün ekler. Yalnız `DRAFT` ve `IN_PROGRESS`'te serbesttir.

    Aynı ürün+kova zaten varsa `uq_stock_count_lines_slot` unique index'i
    reddeder — kontrol servis katmanında da yapılır ama son savunma DB'dedir.
    """
    oturum = await _oturum(db, session_id, for_update=True)
    if oturum.status not in (
        CountSessionStatus.DRAFT.value,
        CountSessionStatus.IN_PROGRESS.value,
    ):
        raise _hata(
            status.HTTP_409_CONFLICT,
            f"{oturum.status} durumundaki oturuma ürün eklenemez",
        )
    urunler = await _sayilabilir_urunler(db, product_ids)
    mevcut = {
        (s.product_id, s.bucket) for s in await _satirlar(db, session_id)
    }
    cakisan = [p.id for p in urunler if (p.id, SALEABLE) in mevcut]
    if cakisan:
        raise _hata(
            status.HTTP_409_CONFLICT,
            f"ürün oturumda zaten var: {cakisan}",
        )
    yeni = await _satir_uret(db, oturum, urunler)
    await _audit(
        db, admin_id, "inventory.count_session_add_products", oturum,
        meta={"product_ids": [p.id for p in urunler]},
    )
    return yeni


async def start_session(
    db: AsyncSession, session_id: int, *, admin_id: int
) -> StockCountSession:
    """`DRAFT → IN_PROGRESS`. Miktar yalnız bu durumda girilebilir."""
    oturum = await _oturum(db, session_id, for_update=True)
    _gecis_dogrula(oturum, CountSessionStatus.IN_PROGRESS.value)
    oturum.status = CountSessionStatus.IN_PROGRESS.value
    oturum.started_at = _now()
    await _audit(db, admin_id, "inventory.count_session_start", oturum)
    return oturum


async def reopen_session(
    db: AsyncSession, session_id: int, *, admin_id: int
) -> StockCountSession:
    """`REVIEW → IN_PROGRESS`. Önceki onayı **ve yarım kalmış sahiplenmeyi** temizler.

    Eski gözden geçirme yeni sayıyı kapsamaz; onayı taşımak, gözden geçirilmemiş
    bir farkın onaylanmış gibi uygulanmasına yol açardı.

    `apply_idempotency_key` de temizlenir. Aksi hâlde bir kez sahiplenilmiş ama
    uygulanamamış oturum **kalıcı olarak kilitli** kalırdı: claim koşulu
    `apply_idempotency_key IS NULL` olduğundan, oturum yeniden sayılıp
    gönderilse bile hiçbir uygulama isteği onu bir daha sahiplenemezdi.
    Adversarial denetimde bulundu ve kapatıldı — sahiplenmeyi geri alabilecek
    tek yer, oturumu zaten sayıma geri açan bu geçiştir.
    """
    oturum = await _oturum(db, session_id, for_update=True)
    _gecis_dogrula(oturum, CountSessionStatus.IN_PROGRESS.value)
    oturum.status = CountSessionStatus.IN_PROGRESS.value
    oturum.reviewed_by_admin_id = None
    oturum.reviewed_at = None
    oturum.submitted_at = None
    oturum.apply_idempotency_key = None
    oturum.applied_by_admin_id = None
    oturum.applied_at = None
    await _audit(db, admin_id, "inventory.count_session_reopen", oturum)
    return oturum


async def cancel_session(
    db: AsyncSession, session_id: int, *, admin_id: int, reason: str
) -> StockCountSession:
    """Oturumu iptal eder (terminal). Hiçbir hareket yazılmaz."""
    if not (reason or "").strip():
        raise _hata(status.HTTP_400_BAD_REQUEST, "iptal gerekçesi zorunlu")
    oturum = await _oturum(db, session_id, for_update=True)
    _gecis_dogrula(oturum, CountSessionStatus.CANCELLED.value)
    oturum.status = CountSessionStatus.CANCELLED.value
    oturum.cancelled_by_admin_id = admin_id
    oturum.cancelled_at = _now()
    oturum.cancel_reason = reason
    await _audit(
        db, admin_id, "inventory.count_session_cancel", oturum, reason=reason
    )
    return oturum


# ════════════════════════ Miktar girme ════════════════════════


async def _satir(db: AsyncSession, line_id: int) -> StockCountLine:
    satir = (
        await db.execute(select(StockCountLine).where(StockCountLine.id == line_id))
    ).scalars().first()
    if satir is None:
        raise _hata(status.HTTP_404_NOT_FOUND, "sayım satırı bulunamadı")
    return satir


def _iz(
    db: AsyncSession,
    satir: StockCountLine,
    *,
    admin_id: int,
    old_qty: int | None,
    new_qty: int,
    note: str | None = None,
) -> None:
    """Append-only yeniden sayım izi. `counted_qty` üzerine yazılır ama
    "önce 12 demişti, sonra 8 yaptı" bilgisi kaybolamaz."""
    db.add(
        StockCountLineEvent(
            line_id=satir.id,
            old_qty=old_qty,
            new_qty=new_qty,
            actor_admin_id=admin_id,
            note=note,
        )
    )


async def set_counted(
    db: AsyncSession, line_id: int, counted_qty: int, *, admin_id: int
) -> StockCountLine:
    """Sayım miktarını yazar. **`counted_at` parametresi YOKTUR.**

    Zaman sunucudan gelir: istemci saatini kabul etmek, geçmişe tarih atarak
    uzlaştırmayı istenen yöne çevirmeye izin verirdi.

    Yeniden sayım **snapshot'ı da tazeler**: personel rafa ŞİMDİ baktı, dolayısıyla
    karşılaştırılacak sistem değeri de şimdiki değerdir. Snapshot bayat kalsaydı,
    aradaki olaylar farka ikinci kez yansırdı.
    """
    if int(counted_qty) < 0:
        raise _hata(status.HTTP_400_BAD_REQUEST, "sayım miktarı negatif olamaz")
    satir = await _satir(db, line_id)
    # Kilit sırası: önce OTURUM (ürün kilidi alınmaz).
    oturum = await _oturum(db, satir.session_id, for_update=True)
    if oturum.status != CountSessionStatus.IN_PROGRESS.value:
        raise _hata(
            status.HTTP_409_CONFLICT,
            f"{oturum.status} durumundaki oturumda miktar girilemez "
            "(önce oturumu sayıma geri açın)",
        )

    # ── Kesitin BEŞ bileşeni TEK İFADEDE okunur ──
    #
    # Satılabilir bakiye · hasarlı bakiye · rezerve · hareket yüksek-su işareti ·
    # DB saati. Beşi de aynı anlık görüntüden gelir; "karışık kesit" yapısal
    # olarak imkânsızdır (gerekçe: `_SNAPSHOT_SQL`).
    #
    # ÜRÜN KİLİDİ BİLİNÇLİ OLARAK ALINMAZ. Denemesi yapıldı ve **işe yaramadığı**
    # görüldü: sipariş durumunu değiştiren üretim yollarının hiçbiri `Product`
    # kilidi almıyor, dolayısıyla kilit rezerve yarışını kapatmıyor; yalnız
    # sayım süresince satışı bloke ediyordu. Kilit yerine tutarlı kesit.
    kesit = await snapshot_for_line(db, satir.product_id, satir.bucket)
    if kesit.saleable is None:
        raise _hata(
            status.HTTP_400_BAD_REQUEST,
            "ürünün stoğu artık izlenmiyor; satır sayılamaz",
        )

    onceki = satir.counted_qty
    satir.system_qty_snapshot = int(
        (kesit.saleable if satir.bucket == SALEABLE else kesit.damaged) or 0
    )
    # Rezerve YALNIZ satılabilir kovada anlamlı: hasarlı ürün siparişe ayrılamaz.
    satir.reserved_qty_snapshot = (
        int(kesit.reserved) if satir.bucket == SALEABLE else None
    )
    satir.snapshot_movement_id = kesit.high_water
    satir.counted_qty = int(counted_qty)
    # VERİTABANI saati — uygulama sunucusunun saati değil ve aynı kesitten.
    # `clock_timestamp()` bilinçli olarak `now()` YERİNE: `now()` transaction
    # BAŞLANGICINA sabittir, yani aynı transaction'da art arda sayılan satırlar
    # aynı damgayı alır ve uzun transaction'da damga sayım anından eski olur.
    #
    # NOT: uzlaştırma bu damgaya **dayanmaz** — "sayımdan sonraki olay" tespiti
    # `snapshot_movement_id` yüksek-su işaretiyle yapılır. Zaman
    # karşılaştırmasının eş-damga/mikro saniye yarışları uzlaştırmayı etkilemez.
    satir.counted_at = kesit.anda
    satir.counted_by_admin_id = admin_id
    # Yeniden sayım belirsizliği giderir: STALE satır COUNTED'a döner.
    satir.status = CountLineStatus.COUNTED.value
    satir.stale_reason = None
    satir.resolved_by_admin_id = None
    satir.resolved_at = None
    satir.resolution_note = None
    _iz(db, satir, admin_id=admin_id, old_qty=onceki, new_qty=int(counted_qty))
    await db.flush()
    # SQL ifadesiyle yazılan damgayı Python tarafında da okunur kıl.
    await db.refresh(satir, ["counted_at"])
    await _audit(
        db, admin_id, "inventory.count_line_set", oturum,
        meta={
            "line_id": satir.id,
            "bucket": satir.bucket,
            "old_qty": onceki,
            "new_qty": int(counted_qty),
        },
    )
    return satir


async def resolve_line(
    db: AsyncSession, line_id: int, *, admin_id: int, note: str
) -> StockCountLine:
    """Belirsizliği **açıklama/denetim kaydı** olarak yazar. Satırı ÇÖZMEZ.

    ## Ne yapar, ne yapmaz

    * Yapar: gerekçeyi, çözen aktörü ve zamanı kalıcı olarak kaydeder;
      append-only satır olayına yazar; audit'e düşer.
    * **Yapmaz:** satırı uygulanabilir hâle GETİRMEZ. `RESOLVED` bir satır
      uygulamayı `STALE` gibi **engellemeye devam eder**.

    Sebebi kesin: satır `STALE` olduysa sayımdan sonra fiziksel etkisi bilinmeyen
    bir olay geçmiştir; o andan itibaren eski `counted_qty` hangi fiziksel
    gerçeği anlattığı bilinmeyen bir sayıdır. Serbest metin bir gerekçe onu
    yeniden güvenilir yapmaz — ve o satırı atlayıp oturumu `APPLIED` yapmak,
    fiziksel belirsizliği sessizce kapsam dışına atmak olurdu.

    Güvenli tek çıkış `set_counted` ile yeni fiziksel sayımdır: o yol kesiti
    (bakiye · rezerve · yüksek-su işareti · DB saati) **tek ifadede** tazeler ve
    satırı `COUNTED`'a döndürür.

    Bilinçli olarak miktar parametresi ALMAZ.
    """
    if not (note or "").strip():
        raise _hata(
            status.HTTP_400_BAD_REQUEST, "belirsizliğin çözümü gerekçe ister"
        )
    satir = await _satir(db, line_id)
    if satir.status != CountLineStatus.STALE.value:
        raise _hata(
            status.HTTP_409_CONFLICT,
            f"{satir.status} durumundaki satır için çözüm gerekmez",
        )
    oturum = await _oturum(db, satir.session_id, for_update=True)
    if oturum.status not in (
        CountSessionStatus.IN_PROGRESS.value,
        CountSessionStatus.REVIEW.value,
    ):
        raise _hata(
            status.HTTP_409_CONFLICT,
            f"{oturum.status} durumundaki oturumda satır çözülemez",
        )
    onceki_durum = satir.status
    satir.status = CountLineStatus.RESOLVED.value
    satir.stale_reason = None
    satir.resolved_by_admin_id = admin_id
    satir.resolved_at = _now()
    satir.resolution_note = note
    _iz(
        db, satir, admin_id=admin_id,
        old_qty=satir.counted_qty, new_qty=satir.counted_qty or 0,
        note=f"{onceki_durum} → RESOLVED: {note}",
    )
    await db.flush()
    await _audit(
        db, admin_id, "inventory.count_line_resolve", oturum,
        reason=note,
        meta={"line_id": satir.id, "old_status": onceki_durum},
    )
    return satir


# ════════════════════════ STALE tespiti ════════════════════════


async def _sayimdan_sonraki_olaylar(
    db: AsyncSession, satirlar: Sequence[StockCountLine]
) -> dict[int, list[str]]:
    """Satır başına, sayımdan SONRA geçen olay adları — **tek sorgu**.

    Defter satırı olmayan olaylar (`ORDER_SHIPPED`, `DELIVERY_FAILED`) burada
    aranmaz: hepsi otomatik uzlaştırılabilir olduğundan `STALE` üretemezler ve
    farkı taşımazlar. `STALE` üretebilen tek kayıtlı kaynak defterdir.

    Tek istisna `SALE_CANCEL`: üretimde iki AYRI akış aynı hareketi yazıyor ve
    fiziksel anlamları farklı (`order_service._restock` ← `_refund_payment`):

    * `cancel_by_client` → `reason_code='ORDER_CANCELLED'`. Bu yol `SHIPPED` ve
      `DELIVERED` siparişi **409 ile reddeder** (`order_service.py:1412`), yani
      mal yapısı gereği hiç çıkmamıştır → otomatik uzlaştırılabilir.
    * `refund_order` → `reason_code='ORDER_REFUNDED'`. Bu yolda `order.status`
      üzerinde **hiçbir guard yoktur** (`order_service.py:1385-1394`) ve FSM
      `SHIPPED → REFUNDED` ile `DELIVERED → REFUNDED`'a izin verir
      (`order_fsm.py:27-28`). Yani kitap kuryede ya da müşterideyken de stok
      artabilir.

    Bu yüzden `ORDER_REFUNDED` için **pozitif kanıt** aranır: siparişin durum
    geçmişinde `SHIPPED` satırı YOKSA *ve* geçmiş boş değilse mal çıkmamış
    sayılır. Geçmiş hiç yoksa kanıt da yoktur → belirsiz (`SALE_CANCEL_SHIPPED`)
    → satır `STALE`. Kanıtın yokluğunu "çıkmamış" saymak fail-open olurdu.
    """
    sayilan = [s for s in satirlar if s.counted_qty is not None]
    if not sayilan:
        return {}
    ids = sorted({s.product_id for s in sayilan})
    taban = min((s.snapshot_movement_id or 0) for s in sayilan)
    hareketler = (
        await db.execute(
            select(
                StockMovement.id,
                StockMovement.product_id,
                StockMovement.bucket,
                StockMovement.movement_type,
                StockMovement.reason_code,
                StockMovement.ref_id,
            )
            .where(
                StockMovement.product_id.in_(ids),
                StockMovement.id > taban,
            )
            .order_by(StockMovement.id)
        )
    ).all()
    if not hareketler:
        return {}

    # `ORDER_REFUNDED` iptalleri için POZİTİF kanıt topla: siparişin durum
    # geçmişinde `SHIPPED` var mı, geçmiş hiç var mı?
    iptal_ref = [
        int(h.ref_id)
        for h in hareketler
        if h.movement_type == stock_ledger.StockMovementType.SALE_CANCEL.value
        and h.reason_code == REASON_REFUND_UNGUARDED
        and h.ref_id is not None
    ]
    cikmamis_kaniti: set[int] = set()
    if iptal_ref:
        for r in (
            await db.execute(
                text(
                    "SELECT order_id, "
                    "count(*) FILTER (WHERE new_status = 'SHIPPED') AS cikis "
                    "FROM order_status_history WHERE order_id = ANY(:ids) "
                    "GROUP BY order_id"
                ),
                {"ids": sorted(set(iptal_ref))},
            )
        ).all():
            # FAIL-SAFE'in mekanizması `GROUP BY`'ın kendisidir: geçmişi hiç
            # olmayan sipariş bu sonuç kümesinde **hiç görünmez**, dolayısıyla
            # kanıt kümesine de giremez ve belirsiz kalır. Buraya ayrıca bir
            # "kayıt > 0" koşulu yazmak ölü koddur — mutasyon provasında
            # kaldırıldığında hiçbir test kırılmadı, çünkü hiçbir şey yapmıyordu.
            if int(r.cikis) == 0:
                cikmamis_kaniti.add(int(r.order_id))

    sonuc: dict[int, list[str]] = {}
    for satir in sayilan:
        esik = satir.snapshot_movement_id or 0
        olaylar = [
            _olay_adi(h, cikmamis_kaniti)
            for h in hareketler
            if h.product_id == satir.product_id
            and h.bucket == satir.bucket
            and int(h.id) > esik
        ]
        if olaylar:
            sonuc[satir.id] = olaylar
    return sonuc


#: `refund_order` yolunun gerekçe kodu — sipariş durumu üzerinde guard'ı YOKTUR
#: (`order_service.py:1385-1394`), dolayısıyla çıkmış siparişte de yazılabilir.
REASON_REFUND_UNGUARDED = "ORDER_REFUNDED"


def _olay_adi(hareket: Any, cikmamis_kaniti: set[int]) -> str:
    """Defter satırını olay tablosundaki ada eşler — **fail-safe**.

    `ORDER_CANCELLED` gerekçeli iptal yapısı gereği çıkış öncesidir. Diğer
    (`ORDER_REFUNDED`) iptalde, malın çıkmadığına dair POZİTİF kanıt yoksa olay
    belirsiz sayılır. Kanıtın yokluğunu "çıkmamış" saymak, kuryedeki kitabı
    rafta varmış gibi göstermek olurdu.
    """
    tip = hareket.movement_type
    if tip != stock_ledger.StockMovementType.SALE_CANCEL.value:
        return tip
    if hareket.reason_code != REASON_REFUND_UNGUARDED:
        return tip
    if hareket.ref_id is not None and int(hareket.ref_id) in cikmamis_kaniti:
        return tip
    return "SALE_CANCEL_SHIPPED"


async def _stale_isaretle(
    db: AsyncSession, satirlar: Sequence[StockCountLine]
) -> list[StockCountLine]:
    """Sayımdan sonra **fiziksel etkisi belirsiz** olay geçen satırları işaretler.

    `RESOLVED` satırlara dokunulmaz: gözden geçiren kişi belirsizliği açıkça
    üstlenmiştir; her doğrulamada onu geri `STALE` yapmak kararı yok sayardı.
    """
    olaylar = await _sayimdan_sonraki_olaylar(db, satirlar)
    bozulan: list[StockCountLine] = []
    for satir in satirlar:
        if satir.status not in (
            CountLineStatus.COUNTED.value,
            CountLineStatus.STALE.value,
        ):
            continue
        belirsiz = [
            o for o in olaylar.get(satir.id, [])
            if not inventory_rules.is_auto_reconcilable(o)
        ]
        if belirsiz:
            satir.status = CountLineStatus.STALE.value
            satir.stale_reason = STALE_UNCERTAIN_EVENT
            satir.note = (
                "sayımdan sonra fiziksel etkisi belirsiz olay: "
                + ", ".join(sorted(set(belirsiz)))
            )
            bozulan.append(satir)
        elif satir.status == CountLineStatus.STALE.value:
            # Belirsizlik kalmadı (ör. satır yeniden sayıldı ve snapshot tazelendi).
            satir.status = CountLineStatus.COUNTED.value
            satir.stale_reason = None
    await db.flush()
    return bozulan


# ════════════════════════ REVIEW ════════════════════════


async def submit_session(
    db: AsyncSession, session_id: int, *, admin_id: int
) -> StockCountSession:
    """`IN_PROGRESS → REVIEW`.

    * Sayılmamış (`PENDING`) satırlar `SKIPPED` olur — "bu kovada hasarlı yok"
      geçerli bir cevaptır ve `damaged_stock`'a DOKUNMAZ.
    * Hiç sayılmış satır yoksa geçiş **reddedilir**: boş bir oturumu gözden
      geçirmenin anlamı yok.
    * `STALE` satırlar burada işaretlenir ve REVIEW'da GÖRÜNÜR; uygulamayı
      engellerler ama gözden geçirmeyi engellemezler.
    """
    oturum = await _oturum(db, session_id, for_update=True)
    _gecis_dogrula(oturum, CountSessionStatus.REVIEW.value)
    satirlar = await _satirlar(db, session_id)

    sayilan = [s for s in satirlar if s.counted_qty is not None]
    if not sayilan:
        raise _hata(
            status.HTTP_400_BAD_REQUEST,
            "hiç sayılmamış oturum gözden geçirmeye alınamaz",
        )
    for s in satirlar:
        if s.status == CountLineStatus.PENDING.value:
            s.status = CountLineStatus.SKIPPED.value

    bozulan = await _stale_isaretle(db, satirlar)

    oturum.status = CountSessionStatus.REVIEW.value
    oturum.submitted_at = _now()
    oturum.reviewed_by_admin_id = admin_id
    oturum.reviewed_at = _now()
    await _audit(
        db, admin_id, "inventory.count_session_submit", oturum,
        meta={
            "counted_lines": len(sayilan),
            "skipped_lines": sum(
                1 for s in satirlar if s.status == CountLineStatus.SKIPPED.value
            ),
            "stale_lines": len(bozulan),
        },
    )
    return oturum


# ════════════════════════ Uygulama ════════════════════════


def _idempotency_key(satir: StockCountLine) -> str:
    """Deterministik anahtar: oturum + satır + kova.

    Satır kimliği zaten `(session, product, bucket)` üçlüsünü temsil eder; üçü
    de anahtara yazılır ki defter satırına bakan insan kaynağı okuyabilsin.
    """
    return f"count:{satir.session_id}:{satir.id}:{satir.bucket}"


async def _claim_session(
    db: AsyncSession, session_id: int, *, admin_id: int, idempotency_key: str
) -> bool:
    """Oturumu **koşullu UPDATE** ile sahiplenir (`escrow.claim` deseni).

    Kilit sırası gereği ürünlerden ÖNCE çağrılır. İki eşzamanlı uygulama
    isteğinden yalnız biri satırı sahiplenebilir; ikincisi `WHERE` koşulunu
    artık sağlamadığı için 0 satır günceller.

    `status` burada APPLIED YAPILMAZ: uygulama, hareketler yazılıp flush
    edildikten sonra tamamlanmış sayılır. Sahiplenme `apply_idempotency_key`
    üzerinden yapılır — böylece "yarım APPLIED" durumu hiç oluşamaz.
    """
    sonuc = await db.execute(
        update(StockCountSession)
        .where(
            StockCountSession.id == session_id,
            StockCountSession.status == CountSessionStatus.REVIEW.value,
            StockCountSession.apply_idempotency_key.is_(None),
        )
        .values(
            apply_idempotency_key=idempotency_key,
            applied_by_admin_id=admin_id,
            applied_at=_now(),
        )
    )
    return bool(sonuc.rowcount)


async def apply_session(
    db: AsyncSession,
    session_id: int,
    *,
    admin_id: int,
    idempotency_key: str,
) -> StockCountSession:
    """Farkları **atomik** olarak deftere yazar ve oturumu `APPLIED` yapar.

    Sıra kritiktir:

    1. oturumu claim et (`StockCountSession` kilidi),
    2. satırları doğrula, `STALE` varsa DUR,
    3. ürünleri `stock_ledger.lock_products` ile kilitle (`Product` kilidi),
    4. farkları **kilit altındaki güncel bakiyeden** hesapla,
    5. hareketleri TEK batch'te yaz ve flush et,
    6. ancak bundan sonra `APPLIED`.

    Hiçbir yerde mutlak stok ataması yoktur; snapshot yalnız farkı ve
    belirsizliği belirlemek için kullanılır.
    """
    if not (idempotency_key or "").strip():
        raise _hata(
            status.HTTP_400_BAD_REQUEST, "uygulama için idempotency anahtarı zorunlu"
        )
    # Bilinçli olarak KİLİTSİZ okunur: uygulamanın karşılıklı dışlaması
    # `_claim_session`'ın **koşullu UPDATE**'inden gelir. Burada da `FOR UPDATE`
    # alınsaydı claim tamamen gereksizleşir ve "claim'i kaldır" mutasyonu hiçbir
    # testi kırmazdı — yani mekanizma korunuyor görünüp aslında korunmazdı.
    # (Bu, commit 5 mutasyon provasında ölçüldü.)
    oturum = await _oturum(db, session_id)

    # Retry: aynı anahtarla gelen ikinci istek KAYITLI SONUCU döndürür.
    if oturum.status == CountSessionStatus.APPLIED.value:
        if oturum.apply_idempotency_key == idempotency_key:
            return oturum
        raise _hata(
            status.HTTP_409_CONFLICT,
            "sayım oturumu zaten uygulandı (farklı idempotency anahtarı)",
        )
    _gecis_dogrula(oturum, CountSessionStatus.APPLIED.value)

    # Kilit sırasının İLK adımı — ürünlerden ÖNCE, ifade içine gömülmeden.
    sahiplenildi = await _claim_session(
        db, session_id, admin_id=admin_id, idempotency_key=idempotency_key
    )
    if not sahiplenildi:
        raise _hata(
            status.HTTP_409_CONFLICT,
            "sayım oturumu başka bir istek tarafından uygulanıyor ya da "
            "uygulanmış durumda",
        )

    satirlar = await _satirlar(db, session_id)
    await _stale_isaretle(db, satirlar)
    # `STALE` **ve** `RESOLVED` uygulamayı engeller.
    #
    # `RESOLVED`, "belirsizliği bir gerekçeyle kayda geçirdim" demektir; fiziksel
    # gerçeği yeniden ölçmez. Böyle bir satırı atlayıp oturumu `APPLIED` terminal
    # durumuna taşımak, "kısmi uygulama yok" sözleşmesini deler: fiziksel
    # belirsizlik içeren bir satır sessizce kapsam dışı bırakılmış olur.
    # Güvenli tek çıkış `set_counted` ile YENİ fiziksel sayımdır; o yol kesiti,
    # `counted_at`'i, aktörü ve yüksek-su işaretini tazeler ve satırı
    # `COUNTED`'a döndürür.
    engelleyen = [
        s
        for s in satirlar
        if s.status in (CountLineStatus.STALE.value, CountLineStatus.RESOLVED.value)
    ]
    if engelleyen:
        raise _hata(
            status.HTTP_409_CONFLICT,
            "belirsiz satırlar YENİDEN SAYILMADAN oturum uygulanamaz "
            f"(satır: {[s.id for s in engelleyen]})",
        )

    # YALNIZ `COUNTED`. `STALE`/`RESOLVED` zaten yukarıda uygulamayı
    # engelledi; `SKIPPED` ise hiç sayılmamıştır ve fark üretmez.
    uygulanacak = [
        s
        for s in satirlar
        if s.status == CountLineStatus.COUNTED.value and s.counted_qty is not None
    ]
    if not uygulanacak:
        raise _hata(
            status.HTTP_400_BAD_REQUEST,
            "uygulanacak sayılmış satır yok (belirsiz satırlar yeniden sayılmalı)",
        )

    # Ürünler deterministik sırada (artan id) TEK yerden kilitlenir.
    urunler = await stock_ledger.lock_products(
        db, sorted({s.product_id for s in uygulanacak})
    )

    specs: list[dict[str, Any]] = []
    hedef_satir: list[StockCountLine] = []
    for satir in uygulanacak:
        fark = inventory_rules.line_difference(
            counted=int(satir.counted_qty),
            expected=int(satir.system_qty_snapshot),
            reserved=int(satir.reserved_qty_snapshot or 0),
        )
        if fark == 0:
            # Sıfır fark gürültü satırı yazmaz; satır yine uygulanmış sayılır.
            continue
        urun = urunler[satir.product_id]
        if urun.stock is None:
            raise _hata(
                status.HTTP_409_CONFLICT,
                f"ürün {urun.id} artık stok takibinde değil; oturum uygulanamaz",
            )
        specs.append(
            {
                "product_id": satir.product_id,
                "bucket": satir.bucket,
                "qty_delta": fark,
                "movement_type": stock_ledger.StockMovementType.COUNT_ADJUSTMENT,
                "reason_code": REASON_SURPLUS if fark > 0 else REASON_SHORTAGE,
                "ref_type": "stock_count",
                "ref_id": session_id,
                "ref_line_id": satir.id,
                "idempotency_key": _idempotency_key(satir),
                "actor_type": "ADMIN",
                "actor_id": admin_id,
            }
        )
        hedef_satir.append(satir)

    if specs:
        try:
            hareketler = await stock_ledger.apply_many(db, specs)
        except stock_ledger.InsufficientStock as exc:
            # Sayım bakiyeyi negatife çekemez: fiziksel olarak imkânsız bir
            # sonuç, sessizce kırpılmak yerine açıkça reddedilir.
            raise _hata(
                status.HTTP_409_CONFLICT,
                f"sayım farkı ürün {exc.product_id} bakiyesini negatife "
                "çekiyor; satır yeniden sayılmalı",
            ) from exc
        for satir, hareket in zip(hedef_satir, hareketler, strict=True):
            satir.applied_movement_id = hareket.id

    # `APPLIED` yalnız hareketler yazıldıktan SONRA.
    await db.flush()
    oturum.status = CountSessionStatus.APPLIED.value
    await _audit(
        db, admin_id, "inventory.count_session_apply", oturum,
        meta={
            "applied_lines": len(uygulanacak),
            "movements": len(specs),
            "idempotency_key": idempotency_key,
        },
    )
    return oturum


# ════════════════════════ Okuma ════════════════════════


async def get_session(
    db: AsyncSession, session_id: int
) -> tuple[StockCountSession, list[StockCountLine]]:
    oturum = await _oturum(db, session_id)
    return oturum, await _satirlar(db, session_id)


async def list_sessions(
    db: AsyncSession, *, status_filter: str | None = None,
    limit: int = 50, offset: int = 0,
) -> tuple[list[StockCountSession], int]:
    """Zorunlu sayfalı oturum listesi (tavan `MAX_SESSION_PRODUCTS` değil,
    liste tavanı `stock_ledger.LIST_MAX_LIMIT` ile aynı disiplinde)."""
    limit = max(1, min(int(limit), stock_ledger.LIST_MAX_LIMIT))
    offset = max(0, int(offset))
    kosul = [StockCountSession.deleted_at.is_(None)]
    if status_filter:
        kosul.append(StockCountSession.status == status_filter)
    toplam = (
        await db.execute(
            select(text("count(*)")).select_from(StockCountSession).where(*kosul)
        )
    ).scalar_one()
    satirlar = list(
        (
            await db.execute(
                select(StockCountSession)
                .where(*kosul)
                .order_by(StockCountSession.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
    )
    return satirlar, int(toplam)


async def _audit(
    db: AsyncSession,
    admin_id: int,
    action: str,
    oturum: StockCountSession,
    *,
    reason: str | None = None,
    meta: dict | None = None,
) -> None:
    await audit_service.record(
        db,
        actor=_Aktor(id=admin_id),
        action=action,
        target_type="stock_count_session",
        target_id=oturum.id,
        details=oturum.code,
        reason=reason,
        meta=meta,
    )
