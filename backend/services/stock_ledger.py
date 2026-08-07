"""Stok hareket defteri — `products.stock`'un TEK yazma noktası.

Ayrıntılı gerekçe ve kararlar: `docs/stok-hareket-defteri-plani.md`.

## Sözleşme (kısa)

* **Tek yazıcı.** `products.stock`'a atama yapan tek dosya burasıdır; her
  değişim AYNI transaction'da bir `stock_movements` satırı üretir. Kural bir AST
  kabul testiyle korunur (`tests/acceptance/test_stock_ledger_contract.py`).
* **Transaction sınırı ÇAĞIRANDA.** Bu modül `commit()` ve genel `rollback()`
  ÇAĞIRMAZ; yalnız `flush()` ve gerektiğinde **savepoint** (`begin_nested`)
  kullanır. Böylece defter, çağıranın iş transaction'ının bir parçası olur —
  stok ile hareketin ayrışması yapısal olarak imkânsızdır.
* **Kırpma yok.** `mevcut + qty_delta < 0` ise hareket yazılmaz, stok
  değişmez, `InsufficientStock` yükselir. `max(0, …)` YASAKTIR.
* **Idempotency anlamlıdır.** Anahtar ticari kaynaktan deterministik türetilir.
  Aynı anahtar + aynı payload → mevcut hareket döner (retry'ın doğru cevabı);
  aynı anahtar + farklı payload → `IdempotencyConflict`. Sessiz yutma yok.
* **Batch ya hep ya hiç.** `apply_many` bir batch'in yarısını uygulayıp devam
  etmez; kısmi durumda `PartialIdempotencyState` yükselir.
* **Domain istisnaları HTTP bilmez.** FastAPI/starlette import edilmez; 409/400
  dönüşümü `core/exceptions.py` handler katmanındadır (`RoutingUnavailable`
  deseninin aynısı).

## Eşzamanlılık kurgusu

Üç fazlı ve sırası kritiktir:

1. **Doğrula + kilitle.** Batch içi yinelenen anahtar baştan reddedilir (aynı
   anahtarla iki satır yazma niyeti bir kod hatasıdır). Ürünler **artan
   `product_id`** sırasıyla, her ürün **bir kez**, `FOR UPDATE` +
   `populate_existing` ile kilitlenir.
2. **Kararı kilitten SONRA ver.** Idempotency kayıtları ürün kilitleri
   alındıktan sonra sorgulanır. Sıra tersine olsa iki transaction aynı anda
   "yok" görüp ikisi de yazmaya girişirdi.
3. **Yaz.** Kilit elde iken, deterministik sırada, `qty_after` zincir hâlinde.

`populate_existing` neden zorunlu: session `expire_on_commit=False` ile kurulu;
ürün kimlik haritasındaysa `FOR UPDATE` satırı kilitler ama ORM **bayat**
nesneyi döndürür (backend/CLAUDE.md'de `_load_run`/`_load_stop` tuzağı olarak
kayıtlı). Bayat `stock` üzerinden hesaplanan `qty_after` sessizce yanlış olurdu.

UNIQUE yarışı yine oluşursa (kilit penceresinin dışında kalan bir yol) INSERT
bir **savepoint** içinde yapıldığı için 500'e dönüşmez: savepoint geri alınır,
batch bütün olarak yeniden okunur ve replay / kısmi durum / çatışma kararı
verilir.
"""
from __future__ import annotations

import dataclasses
import logging
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.observability import request_id_ctx
from models.store import (
    ADMIN_ADJUSTMENT_REASONS,
    Product,
    ProductKind,
    StockBucket,
    StockMovement,
    StockMovementType,
)
from models.inventory import COUNT_ADJUSTMENT_REASONS, DAMAGE_REASONS

logger = logging.getLogger("adana.stock")

__all__ = [
    "ADMIN_ADJUSTMENT_REASONS",
    "IDEMPOTENCY_PAYLOAD_FIELDS",
    "ChainCheck",
    "IdempotencyConflict",
    "InsufficientStock",
    "AUDIT_MAX_LIMIT",
    "LedgerAudit",
    "LedgerProblem",
    "LedgerVerification",
    "audit_ledger",
    "audit_products",
    "LIST_MAX_LIMIT",
    "MovementPage",
    "MovementRow",
    "PartialIdempotencyState",
    "StockLedgerError",
    "StockMovementType",
    "StockNotTracked",
    "apply_many",
    "apply_movement",
    "has_shortage",
    "idempotency_key_for",
    "RESTORE_TYPES",
    "list_movements",
    "lock_products",
    "restored_quantity_by_order_item",
    "make_sku",
    "payload_differences",
    "sku_prefix",
    "validate_reason",
    "verify_chain",
    "verify_ledger",
]


# ════════════════════════════ İstisnalar ════════════════════════════
#
# Hiçbiri HTTP bilmez (FastAPI import EDİLMEZ). 409/400 dönüşümü
# `core/exceptions.py::register_exception_handlers` içindedir.


class StockLedgerError(Exception):
    """Defter alan istisnalarının tabanı."""


class StockNotTracked(StockLedgerError):
    """Ürünün stoğu takip edilmiyor (`products.stock IS NULL`).

    Bu "stoğu 0" DEĞİLDİR. Buraya bir dijital kalem gelmesi, çağıranın
    fiziksel/dijital filtresinin bozulduğunu gösterir; sessizce atlamak o hatayı
    gizlerdi.
    """

    def __init__(self, product_id: int) -> None:
        self.product_id = product_id
        super().__init__(
            f"ürün {product_id} stok yönetimine tabi değil (stock IS NULL); "
            "stok hareketi yazılamaz"
        )


class InsufficientStock(StockLedgerError):
    """`mevcut + qty_delta < 0` — hareket yazılmadı, stok değişmedi."""

    def __init__(self, product_id: int, current: int, qty_delta: int) -> None:
        self.product_id = product_id
        self.current = current
        self.qty_delta = qty_delta
        super().__init__(
            f"ürün {product_id} için stok yetersiz: mevcut {current}, "
            f"istenen değişim {qty_delta}"
        )


class IdempotencyConflict(StockLedgerError):
    """Aynı anahtar, FARKLI payload. Sessizce yutulmaz."""

    def __init__(
        self, idempotency_key: str, conflicting_fields: Mapping[str, tuple[Any, Any]]
    ) -> None:
        self.idempotency_key = idempotency_key
        self.conflicting_fields = dict(conflicting_fields)
        ayrinti = ", ".join(
            f"{alan}: kayıtlı={eski!r} gelen={yeni!r}"
            for alan, (eski, yeni) in self.conflicting_fields.items()
        )
        super().__init__(
            f"idempotency anahtarı {idempotency_key} farklı bir payload ile "
            f"yeniden kullanıldı ({ayrinti})"
        )


class PartialIdempotencyState(StockLedgerError):
    """Batch'in bir kısmı yazılmış, bir kısmı yazılmamış.

    Eksikleri tamamlamak KABUL EDİLMEZ: bu durum ya bir kod hatasıdır ya da
    yarıda kesilmiş bir yazımın izidir, ikisi de insan kararı ister. "Yarısı
    uygulanmış batch" defterin en tehlikeli hâlidir — her ürünün kendi zinciri
    sağlam görünür ama sipariş ile defter arasındaki ilişki bozuktur.
    """

    def __init__(self, found_keys: Sequence[str], missing_keys: Sequence[str]) -> None:
        self.found_keys = list(found_keys)
        self.missing_keys = list(missing_keys)
        super().__init__(
            f"toplu stok hareketi kısmen mevcut: {len(self.found_keys)} kayıtlı, "
            f"{len(self.missing_keys)} eksik. Eksikler uygulanmadı. "
            f"Eksik anahtarlar: {', '.join(self.missing_keys)}"
        )


# ════════════════════════════ SKU (saf) ════════════════════════════

_SKU_PREFIXES = {
    ProductKind.PHYSICAL.value: "FZK",
    ProductKind.DIGITAL.value: "DIJ",
}


def sku_prefix(kind: str) -> str:
    """Ürün türünün SKU öneği. Bilinmeyen türde sessizce bir önek uydurmak,
    SKU'nun anlamını kaybettirir → hata."""
    try:
        return _SKU_PREFIXES[str(kind)]
    except KeyError:
        raise ValueError(f"bilinmeyen ürün türü: {kind!r}") from None


def make_sku(kind: str, product_id: int) -> str:
    """`FZK-000042` / `DIJ-000007`.

    Değer tamamen `(kind, id)`'nin fonksiyonudur: sequence yok, boşluk kaygısı
    yok, backfill idempotent. Altı haneyi aşan id'lerde dolgu doğal olarak
    büyür — KIRPILMAZ (kırpma iki ürüne aynı SKU'yu verirdi).

    NOT: üretimde bu değeri **`products_sku_autofill` BEFORE INSERT trigger'ı**
    yazar; buradaki fonksiyon aynı formülün Python karşılığıdır (testler ve
    beklenen değer hesabı için).
    """
    if not product_id or product_id < 1:
        raise ValueError(
            "SKU ürün id'sine bağlıdır; satır INSERT edilmeden üretilemez "
            f"(product_id={product_id!r})"
        )
    return f"{sku_prefix(kind)}-{product_id:06d}"


# ═══════════════════ Stok yeterliliği ve gerekçe (saf) ═══════════════════


def has_shortage(current_stock: int | None, needed: int) -> bool:
    """Bu ürün için `needed` adet ayrılabilir mi?

    Defter ve `_finalize_paid`'in claim öncesi ön kontrolü AYNI aritmetiği
    kullansın diye buradadır; ayrışırlarsa biri "yeter" derken diğeri patlar.

    `current_stock is None` = "stok takip edilmiyor" → eksik SAYILMAZ (aksi
    hâlde satılabilir dijital ürün kilitlenirdi). Defter tarafında aynı durum
    `StockNotTracked` ile reddedilir: iki farklı soru, iki farklı cevap.
    """
    if current_stock is None:
        return False
    return current_stock < needed


#: Sistem tiplerinin taşıyabileceği gerekçe kodları. Her hareket kendini
#: açıklar (`reason_code` NOT NULL); sistem tipleri sabit kod taşır.
_SYSTEM_REASONS: dict[StockMovementType, frozenset[str]] = {
    StockMovementType.OPENING_BALANCE: frozenset({"MIGRATION_OPENING"}),
    StockMovementType.INITIAL: frozenset({"PRODUCT_CREATE", "CSV_IMPORT"}),
    StockMovementType.SALE: frozenset({"ORDER_PAID"}),
    StockMovementType.SALE_CANCEL: frozenset({"ORDER_CANCELLED", "ORDER_REFUNDED"}),
    StockMovementType.RETURN: frozenset({"RETURN_ACCEPTED"}),
    # F29 — sayım ve hasarlı stok. Sözlükler `models/inventory.py`'de ve
    # `ADMIN_ADJUSTMENT_REASONS`'tan AYRI: elle düzeltmenin gerekçeleriyle
    # sayım/hasar gerekçeleri farklı iş kavramlarıdır.
    StockMovementType.COUNT_ADJUSTMENT: COUNT_ADJUSTMENT_REASONS,
    StockMovementType.DAMAGE_TRANSFER: DAMAGE_REASONS,
    StockMovementType.DAMAGE_RECOVERY: DAMAGE_REASONS,
    StockMovementType.DAMAGE_DISPOSAL: DAMAGE_REASONS,
    StockMovementType.SUPPLIER_RETURN: DAMAGE_REASONS,
}

#: `DIGER` gerekçesinde açıklama notu ZORUNLU olan türler. `DIGER` tek başına
#: hiçbir şey açıklamaz; DB'de `ck_stock_movements_note` de aynı kuralı zorlar.
_NOTE_REQUIRED_FOR_DIGER = frozenset(
    {
        StockMovementType.ADMIN_ADJUSTMENT,
        StockMovementType.DAMAGE_TRANSFER,
        StockMovementType.DAMAGE_RECOVERY,
        StockMovementType.DAMAGE_DISPOSAL,
        StockMovementType.SUPPLIER_RETURN,
    }
)


def validate_reason(
    movement_type: StockMovementType | str,
    reason_code: str | None,
    note: str | None = None,
) -> None:
    """Gerekçe kodunun türle uyumlu olduğunu doğrular; değilse `ValueError`."""
    tip = StockMovementType(movement_type)
    if not reason_code:
        raise ValueError(f"{tip.value} için gerekçe kodu zorunlu")
    if tip is StockMovementType.ADMIN_ADJUSTMENT:
        if reason_code not in ADMIN_ADJUSTMENT_REASONS:
            raise ValueError(
                f"geçersiz düzeltme gerekçesi: {reason_code!r} "
                f"(geçerli: {sorted(ADMIN_ADJUSTMENT_REASONS)})"
            )
        # "DIGER" tek başına hiçbir şey açıklamaz; açıklamayı not taşır.
        if reason_code == "DIGER" and not (note or "").strip():
            raise ValueError("'DIGER' gerekçesinde açıklama notu zorunlu")
        return
    izinli = _SYSTEM_REASONS[tip]
    if reason_code not in izinli:
        raise ValueError(
            f"{tip.value} için geçersiz gerekçe kodu: {reason_code!r} "
            f"(geçerli: {sorted(izinli)})"
        )
    if reason_code == "DIGER" and tip in _NOTE_REQUIRED_FOR_DIGER:
        if not (note or "").strip():
            raise ValueError("'DIGER' gerekçesinde açıklama notu zorunlu")


# ═══════════════════ Idempotency anahtarları (saf) ═══════════════════


def idempotency_key_for(
    movement_type: StockMovementType | str,
    *,
    product_id: int | None = None,
    order_item_id: int | None = None,
    return_item_id: int | None = None,
    revision: str | None = None,
) -> str | None:
    """Ticari kaynaktan deterministik anahtar. `ADMIN_ADJUSTMENT`'ta `None`.

    Granülerlik **satır bazlıdır** ve bu bilinçli:

      * `SALE` / `SALE_CANCEL` → **`order_items.id`**. Sipariş+ürün bazlı bir
        anahtar, aynı ürünün iki sipariş satırında geçmesi hâlinde adetleri
        TOPLAMAYI zorunlu kılıyordu; satır bazlı anahtar hem bu toplamayı
        gereksiz kılar hem de "hangi satır ne kadar düştü/geri geldi" sorusunu
        deftere cevaplattırır (fazla geri yükleme guard'ının de temeli budur —
        bkz. `restored_quantity_by_order_item`).
      * `RETURN` → **`order_return_items.id`**. Aynı üründen iki iade satırı
        İKİ geçerli harekettir.
      * `INITIAL` → ürün başına (ürün bir kez oluşur).
      * `ADMIN_ADJUSTMENT` → anahtarsız; her elle düzeltme ayrı bir olaydır.
        Çift tıklama doğal olarak idempotenttir: hedef mutlak verilir, delta
        kilit altında hesaplanır, ikinci istekte 0 çıkar ve çağıran ledger'ı
        hiç çağırmaz.

    Eksik parametre sessizce kabul edilmez: `order_item:None:SALE` gibi bir
    anahtar iki farklı işlemi çakıştırabilirdi.
    """
    tip = StockMovementType(movement_type)
    if tip is StockMovementType.ADMIN_ADJUSTMENT:
        return None
    if tip in (StockMovementType.SALE, StockMovementType.SALE_CANCEL):
        _require(order_item_id=order_item_id)
        return f"order_item:{order_item_id}:{tip.value}"
    if tip is StockMovementType.RETURN:
        _require(return_item_id=return_item_id)
        return f"return_line:{return_item_id}:RETURN"
    if tip is StockMovementType.INITIAL:
        _require(product_id=product_id)
        return f"product:{product_id}:INITIAL"
    _require(revision=revision, product_id=product_id)
    return f"migration:{revision}:product:{product_id}"


#: Stoğu GERİ YÜKLEYEN hareket türleri (fazla geri yükleme guard'ının kapsamı).
RESTORE_TYPES = (
    StockMovementType.SALE_CANCEL.value,
    StockMovementType.RETURN.value,
)


async def restored_quantity_by_order_item(
    db: AsyncSession, order_item_ids: Sequence[int]
) -> dict[int, int]:
    """Sipariş kalemi başına **şimdiye kadar geri yüklenmiş** toplam adet.

    ## Neden gerekli

    Tam iptal ve kısmi iade **farklı** idempotency anahtarları kullanır
    (`order_item:*:SALE_CANCEL` ve `return_line:*:RETURN`). İkisi de kendi
    başına geçerlidir; anahtar tekilliği bu yüzden "aynı satır iki kez geri
    yüklenmesin"i korur ama **"toplam geri yükleme satışı aşmasın"**ı KORUMAZ:
    4 adetlik bir kalemden 2 adet iade edildikten sonra sipariş tam iptal
    edilirse 4 daha eklenir ve stok 6 artar — satılan 4'tü.

    Bu yüzden geri yükleme yollarında tavan iş kuralı olarak uygulanır:
    `geri_yüklenebilir = satılan − şimdiye kadar geri yüklenen`.

    `RETURN` hareketleri `ref_line_id`'de **iade satırı** kimliğini taşıdığı
    için sipariş kalemine `order_return_items` üzerinden bağlanır; `SALE_CANCEL`
    doğrudan `order_items.id` taşır.
    """
    ids = [int(i) for i in set(order_item_ids)]
    if not ids:
        return {}
    sql = text(
        """
        SELECT oi_id, coalesce(sum(qty_delta), 0) AS geri
        FROM (
            SELECT m.ref_line_id AS oi_id, m.qty_delta
            FROM stock_movements m
            WHERE m.movement_type = 'SALE_CANCEL'
              AND m.ref_type = 'order_item'
              AND m.ref_line_id = ANY(:ids)
            UNION ALL
            SELECT ori.order_item_id AS oi_id, m.qty_delta
            FROM stock_movements m
            JOIN order_return_items ori ON ori.id = m.ref_line_id
            WHERE m.movement_type = 'RETURN'
              AND m.ref_type = 'order_return'
              AND ori.order_item_id = ANY(:ids)
        ) x
        GROUP BY oi_id
        """
    )
    rows = (await db.execute(sql, {"ids": ids})).all()
    return {int(r.oi_id): int(r.geri) for r in rows}


async def sold_quantity_by_order_item(
    db: AsyncSession, order_item_ids: Sequence[int]
) -> dict[int, int]:
    """Sipariş kalemi başına deftere yazılmış **SATIŞ** adedi (pozitif).

    ## Neden gerekli (TB-15(a))

    Geri yükleme tavanı `satılan − geri yüklenen` idi, ama "satılan" olarak
    **sipariş kalemindeki adet** kullanılıyordu. Bu, siparişin gerçekten PAID
    olduğu varsayımını taşır. Oversell iadesinde varsayım BOZULUR: orada
    sipariş hiç PAID olmamıştır, hiç `SALE` yazılmamıştır — ama `order_items`
    satırları vardır. Telafi kancası o adetleri "satılmış" sayıp `SALE_CANCEL`
    yazarsa **hiç satılmamış mal için stok artar**.

    Tavan kontrolü bunu engellemez: `restored_quantity_by_order_item` yalnız
    SALE_CANCEL/RETURN sayar; satılan 0 iken "geri yüklenen 0" görülür ve tam
    adet verilir.

    Bu yüzden gerçek satış adedi DEFTERDEN okunur. `qty_delta` satışta
    negatiftir; işaret burada çevrilir ki çağıran "adet" ile düşünsün.
    """
    ids = [int(i) for i in set(order_item_ids)]
    if not ids:
        return {}
    rows = (
        await db.execute(
            text(
                "SELECT ref_line_id AS oi_id, coalesce(sum(-qty_delta), 0) AS satilan "
                "FROM stock_movements "
                "WHERE movement_type = 'SALE' AND ref_type = 'order' "
                "  AND ref_line_id = ANY(:ids) "
                "GROUP BY ref_line_id"
            ),
            {"ids": ids},
        )
    ).all()
    return {int(r.oi_id): int(r.satilan) for r in rows}


def _require(**alanlar: Any) -> None:
    eksik = [ad for ad, deger in alanlar.items() if deger in (None, "")]
    if eksik:
        raise ValueError(
            f"idempotency anahtarı için zorunlu alan(lar) eksik: {', '.join(eksik)}"
        )


#: Idempotency payload karşılaştırmasına giren TÜM alanlar. `reason_code` ve
#: aktör de dâhil: aynı anahtarla farklı bir gerekçe veya farklı bir aktör
#: gelmesi de bir çelişkidir.
#: `bucket` de dâhildir (F29): aynı anahtarla gelen bir istek yalnız kovada
#: farklıysa bu **çelişkidir**, sessiz bir replay değil — aksi hâlde bir hasar
#: transferinin iki bacağından biri diğerinin kaydını "aynı işlem" sanardı.
IDEMPOTENCY_PAYLOAD_FIELDS: tuple[str, ...] = (
    "product_id",
    "bucket",
    "qty_delta",
    "movement_type",
    "reason_code",
    "ref_type",
    "ref_id",
    "ref_line_id",
    "actor_type",
    "actor_id",
)


def _field(obj: Any, alan: str) -> Any:
    """Hem mapping'den hem ORM nesnesinden okur (tek karşılaştırma fonksiyonu
    iki yolda kullanılabilsin)."""
    if isinstance(obj, Mapping):
        return obj.get(alan)
    return getattr(obj, alan, None)


def payload_differences(existing: Any, spec: Any) -> dict[str, tuple[Any, Any]]:
    """Kayıtlı hareket ile gelen isteğin çelişen alanları.

    `apply_movement` ve `apply_many` AYNI fonksiyonu kullanır; ayrışırlarsa biri
    çelişkiyi görürken diğeri görmez.
    """
    farklar: dict[str, tuple[Any, Any]] = {}
    for alan in IDEMPOTENCY_PAYLOAD_FIELDS:
        eski = _field(existing, alan)
        yeni = _field(spec, alan)
        if eski != yeni:
            farklar[alan] = (eski, yeni)
    return farklar


# ═══════════════════ Zincir doğrulaması (saf) ═══════════════════


@dataclasses.dataclass(frozen=True, slots=True)
class ChainCheck:
    consistent: bool
    first_divergent_id: int | None = None
    problems: tuple[str, ...] = ()
    #: Kopukluk/sapma anında "ne olmalıydı / ne var" — operatörün bir cümleyi
    #: ayrıştırmadan cevaplaması gereken soru.
    expected: int | None = None
    actual: int | None = None


def verify_chain(
    rows: Sequence[tuple[int, int, int]], current_stock: int | None
) -> ChainCheck:
    """`(id, qty_delta, qty_after)` üçlülerinin zincirini doğrular.

    Kurallar:
      * ilk satır `qty_delta == qty_after` (öncesi yok);
      * her satır `qty_after[i] == qty_after[i-1] + qty_delta[i]`;
      * son `qty_after == products.stock`.

    Defteri olmayan bir bakiye, açıklanamayan bakiyedir → tutarsız.
    """
    problems: list[str] = []
    if not rows:
        if current_stock:
            return ChainCheck(
                False,
                None,
                ("defter boş ama ürün stoğu sıfır değil (açıklanamayan bakiye)",),
                expected=0,
                actual=current_stock,
            )
        return ChainCheck(True)

    onceki = 0
    for satir_id, delta, after in rows:
        if after != onceki + delta:
            problems.append(
                f"hareket {satir_id}: qty_after {after}, beklenen {onceki + delta}"
            )
            return ChainCheck(
                False, satir_id, tuple(problems),
                expected=onceki + delta, actual=after,
            )
        onceki = after

    son = rows[-1][2]
    if son != current_stock:
        problems.append(
            f"defter son bakiyesi {son}, products.stock {current_stock} "
            "(stok defter dışında değiştirilmiş)"
        )
        return ChainCheck(
            False, None, tuple(problems), expected=son, actual=current_stock
        )
    return ChainCheck(True)


# ════════════════════════ Spec doğrulama ════════════════════════

_REF_REQUIRED = {
    StockMovementType.SALE,
    StockMovementType.SALE_CANCEL,
    StockMovementType.RETURN,
}
_ACTOR_TYPES = frozenset({"SYSTEM", "ADMIN"})


def _normalize_spec(spec: Mapping[str, Any], *, allow_keyless: bool) -> dict[str, Any]:
    """Saf doğrulama + kanonik sözlük. Kilit ALMADAN ÖNCE çalışır (hızlı hata).

    Sıfır delta yalnız `OPENING_BALANCE`'ta serbesttir: 0 stoklu ürünün de
    zincir tabanı olmalı. Diğer türlerde gürültü satırı yazılmaz — "aynı değeri
    tekrar kaydetme" hâlini ÇAĞIRAN eler (delta 0 ise ledger hiç çağrılmaz).
    """
    tip = StockMovementType(spec["movement_type"])
    product_id = int(spec["product_id"])
    qty_delta = int(spec["qty_delta"])
    if qty_delta == 0 and tip is not StockMovementType.OPENING_BALANCE:
        raise ValueError(
            f"{tip.value} için sıfır delta geçersiz (gürültü satırı yazılmaz); "
            "değişim yoksa defter çağrılmamalıdır"
        )

    # Kova YAPISAL bir alandır → gerekçe/aktör doğrulamalarından ÖNCE gelir ve
    # **ZORUNLUDUR**. Sessiz `None → SALEABLE` varsayımı bilinçli olarak
    # KALDIRILDI: kovayı yazmayı unutan yeni bir çağıran (ör. hasar servisi)
    # sessizce satılabilir kovayı bozardı. Eksik kova bir domain doğrulama
    # hatasıdır; DB tarafında da varsayılan yoktur (`f29a_bucket_default_kaldir`).
    ham_kova = spec.get("bucket")
    if ham_kova in (None, ""):
        raise ValueError(
            "stok hareketi `bucket` olmadan yazılamaz "
            f"(geçerli: {sorted(b.value for b in StockBucket)})"
        )
    bucket = ham_kova.value if isinstance(ham_kova, StockBucket) else str(ham_kova)
    if bucket not in {b.value for b in StockBucket}:
        raise ValueError(f"geçersiz bucket: {bucket!r}")

    reason_code = spec.get("reason_code")
    note = spec.get("note")
    validate_reason(tip, reason_code, note)

    actor_type = str(spec.get("actor_type") or "SYSTEM")
    if actor_type not in _ACTOR_TYPES:
        raise ValueError(f"geçersiz actor_type: {actor_type!r}")
    actor_id = spec.get("actor_id")
    if actor_type == "ADMIN" and actor_id is None:
        raise ValueError("actor_type='ADMIN' için actor_id zorunlu")

    ref_type = spec.get("ref_type")
    ref_id = spec.get("ref_id")
    ref_line_id = spec.get("ref_line_id")
    if tip in _REF_REQUIRED and (ref_type is None or ref_id is None):
        raise ValueError(f"{tip.value} için ref_type ve ref_id zorunlu")
    if tip is StockMovementType.RETURN and ref_line_id is None:
        raise ValueError("RETURN için ref_line_id zorunlu (iade satırı kimliği)")

    key = spec.get("idempotency_key")
    if not key and not allow_keyless:
        raise ValueError(
            "toplu stok hareketi idempotency anahtarı olmadan uygulanamaz "
            "(batch bütünlüğü anahtarla kurulur)"
        )

    return {
        "product_id": product_id,
        "bucket": bucket,
        "qty_delta": qty_delta,
        "movement_type": tip,
        "reason_code": reason_code,
        "ref_type": ref_type,
        "ref_id": ref_id,
        "ref_line_id": ref_line_id,
        "idempotency_key": key or None,
        "actor_type": actor_type,
        "actor_id": actor_id,
        "note": note,
        "request_id": spec.get("request_id") or _current_request_id(),
    }


def _current_request_id() -> str | None:
    """İstek bağlamındaki request-id (audit_logs ile korelasyon). HTTP dışı
    bağlamda ("-") kaydedilmez."""
    rid = request_id_ctx.get()
    return rid if rid and rid != "-" else None


# ════════════════════════ Kilit ve yazım ════════════════════════


async def lock_products(
    db: AsyncSession, product_ids: Sequence[int]
) -> dict[int, Product]:
    """Ürün satırlarını **artan `id`** sırasıyla, her birini **bir kez** kilitler.

    **Ürün kilidi alan TEK yer burasıdır.** `apply_movement`/`apply_many` bunu
    kullanır; ön kontrolü için kilide ihtiyaç duyan çağıranlar (ör.
    `order_service._finalize_paid`'in oversell guard'ı) da **aynı** fonksiyonu
    çağırır. Böylece kilit sırası disiplini üç ayrı döngüde tekrarlanmaz ve
    biri unutulduğunda sessizce deadlock'a dönüşmez. Aynı transaction'da tekrar
    çağrılmak zararsızdır (yeniden girişli).

    Tasarım kararları:

    * **Tek sorgu + `ORDER BY id` + `FOR UPDATE`.** PostgreSQL satırları
      `ORDER BY`'a göre sıralayıp o sırada kilitler; bu, deadlock'tan kaçınmanın
      belgelenmiş deyimidir ve N ayrı sorgudan daha az gidiş-dönüş yapar. `id`
      değişmez bir kolon olduğu için sıralama yarışta kayamaz.
    * **Dar `SELECT Product`.** Hiçbir `join`/eager-load YOK: `joinedload` ile
      alınan bir `FOR UPDATE`, ilişkili tabloların satırlarını da kilitler ve
      kilit grafiğine görünmez kaynaklar sokardı. (`Product`'ın üç ilişkisi de
      `lazy="select"`; burada bilinçli olarak hiçbir loader option verilmiyor.)
    * **`populate_existing=True`.** Olmadan kilit alınır ama ORM kimlik
      haritasındaki **bayat** nesneyi döndürür ve delta bayat bakiye üzerinden
      hesaplanır (bkz. modül docstring'i).
    """
    istenen = sorted(set(product_ids))
    if not istenen:
        return {}
    rows = (
        await db.execute(
            select(Product)
            .where(Product.id.in_(istenen))
            .order_by(Product.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    kilitli = {p.id: p for p in rows}
    eksik = [pid for pid in istenen if pid not in kilitli]
    if eksik:
        raise ValueError(f"ürün bulunamadı: {eksik}")
    return kilitli


async def _fetch_by_keys(
    db: AsyncSession, keys: Sequence[str]
) -> dict[str, StockMovement]:
    if not keys:
        return {}
    rows = (
        await db.execute(
            select(StockMovement).where(StockMovement.idempotency_key.in_(list(keys)))
        )
    ).scalars().all()
    return {r.idempotency_key: r for r in rows if r.idempotency_key}


def _replay(
    specs: Sequence[Mapping[str, Any]], existing: Mapping[str, StockMovement]
) -> list[StockMovement]:
    """Hepsi kayıtlı: payload'ları doğrula ve MEVCUT sonuçları döndür.

    Stok DEĞİŞTİRİLMEZ — tekrarın doğru cevabı budur.
    """
    for spec in specs:
        key = spec["idempotency_key"]
        mevcut = existing[key]
        farklar = payload_differences(mevcut, spec)
        if farklar:
            raise IdempotencyConflict(key, farklar)
    return [existing[spec["idempotency_key"]] for spec in specs]


def _bucket_balance(product: Product, bucket: str) -> int:
    """Kovanın **o andaki** bakiyesi (kilit altındaki ürün nesnesinden).

    İki kova iki AYRI kolonda durur; bu yüzden zincirleri de birbirinden
    bağımsızdır. Bir kovadaki hareket diğerinin `qty_after` değerini
    etkileyemez — matematiksel olarak ayrı iki defterdir, aynı ürünü
    paylaşırlar.
    """
    if bucket == StockBucket.DAMAGED.value:
        if product.damaged_stock is None:
            # `ck_products_damaged_pairing` bunu imkânsız kılar (stok
            # izleniyorsa hasarlı da izlenir); yine de sessizce 0 varsaymayız —
            # o, bozuk bir değişmezi gizlemek olurdu.
            raise StockNotTracked(product.id)
        return int(product.damaged_stock)
    return int(product.stock)


def _set_bucket_balance(product: Product, bucket: str, value: int) -> None:
    if bucket == StockBucket.DAMAGED.value:
        product.damaged_stock = value
    else:
        product.stock = value


def _write_one(db: AsyncSession, product: Product, spec: Mapping[str, Any]) -> StockMovement:
    """Tek hareketi kilit altında yazar. `qty_after` = kovaya yazılan bakiye.

    `products.stock` ve `products.damaged_stock` kolonları AYRI güncellenir;
    hangisinin güncelleneceğini `spec["bucket"]` söyler.
    """
    if product.stock is None:
        # Takip semantiği kova bazlı DEĞİL ürün bazlıdır: dijital üründe hiçbir
        # kova izlenmez (`ck_products_damaged_pairing`).
        raise StockNotTracked(product.id)
    bucket = spec["bucket"]
    mevcut = _bucket_balance(product, bucket)
    yeni = mevcut + spec["qty_delta"]
    if yeni < 0:
        raise InsufficientStock(product.id, mevcut, spec["qty_delta"])
    mv = StockMovement(
        product_id=product.id,
        # AÇIKÇA verilir: kolonun ne ORM'de ne DB'de varsayılanı vardır.
        bucket=bucket,
        qty_delta=spec["qty_delta"],
        qty_after=yeni,
        movement_type=spec["movement_type"].value,
        reason_code=spec["reason_code"],
        ref_type=spec["ref_type"],
        ref_id=spec["ref_id"],
        ref_line_id=spec["ref_line_id"],
        idempotency_key=spec["idempotency_key"],
        actor_type=spec["actor_type"],
        actor_id=spec["actor_id"],
        note=spec["note"],
        request_id=spec["request_id"],
    )
    db.add(mv)
    # Aynı değişkenden: qty_after ile yazılan kova bakiyesi tanım gereği eşittir.
    _set_bucket_balance(product, bucket, yeni)
    return mv


def _write_order(specs: Sequence[Mapping[str, Any]]) -> list[int]:
    """Deterministik yazım sırası: `(product_id, batch içindeki sıra)`.

    Aynı ürüne birden çok hareket varsa bunlar ardışık işlenir ve `qty_after`
    zincir hâlinde hesaplanır (ürün nesnesi kilit altında mutasyona uğradığı
    için zincirleme doğal olarak kurulur).

    **Kova sıralamaya GİRMEZ ve girmemelidir.** İki kovanın bakiyesi iki ayrı
    kolonda durduğundan zincirleri de kendiliğinden bağımsızdır; kovayı anahtara
    eklemek yalnız satır kimliklerinin sırasını değiştirirdi. Bir hasar
    transferinin iki bacağı böylece **girildikleri sırada** yazılır — önce
    kaynak kovadan çıkış, sonra hedef kovaya giriş — ki defteri okuyan insan
    için doğal sıra budur.
    """
    return sorted(range(len(specs)), key=lambda i: (specs[i]["product_id"], i))


async def _apply_specs(
    db: AsyncSession,
    raw_specs: Sequence[Mapping[str, Any]],
    *,
    allow_keyless: bool,
) -> list[StockMovement]:
    """Defterin çekirdeği. `commit`/`rollback` YAPMAZ (bkz. modül docstring'i)."""
    if not raw_specs:
        return []
    specs = [_normalize_spec(s, allow_keyless=allow_keyless) for s in raw_specs]

    keys = [s["idempotency_key"] for s in specs if s["idempotency_key"]]
    # Batch içi yinelenen anahtar: aynı anahtarla iki satır yazma niyeti bir kod
    # hatasıdır ve UNIQUE ihlaline dönüşürdü. Baştan reddedilir.
    if len(set(keys)) != len(keys):
        yinelenen = sorted({k for k in keys if keys.count(k) > 1})
        raise ValueError(
            f"batch içinde yinelenen idempotency anahtarı: {', '.join(yinelenen)}"
        )

    # FAZ 1 — kilitle (artan product_id, her ürün bir kez).
    urunler = await lock_products(db, [s["product_id"] for s in specs])

    # FAZ 2 — kararı kilitten SONRA ver. Sıra tersine olsa iki transaction aynı
    # anda "yok" görüp ikisi de yazmaya girişirdi.
    karar = await _decide(db, specs, keys)
    if karar is not None:
        return karar

    # FAZ 3 — yaz. Savepoint: kilit penceresinin dışında kalan bir UNIQUE
    # yarışında 500 dönmek yerine batch'i bütün olarak yeniden okuyabilmek için.
    try:
        async with db.begin_nested():
            sonuc: dict[int, StockMovement] = {}
            for i in _write_order(specs):
                sonuc[i] = _write_one(db, urunler[specs[i]["product_id"]], specs[i])
            await db.flush()
        return [sonuc[i] for i in range(len(specs))]
    except IntegrityError:
        # Savepoint geri alındı; ORM nesneleri hâlâ bellekteki yeni değeri
        # taşıyabilir → tazelenmeleri gerekir.
        _expire(db, urunler.values())
        logger.warning(
            "stok defteri UNIQUE yarışı; batch yeniden okunuyor (anahtarlar=%s)",
            keys,
        )
        tekrar = await _decide(db, specs, keys)
        if tekrar is None:
            # Kayıtlar yok ama INSERT yine ihlal etti → başka bir kısıt ihlali.
            raise
        return tekrar
    except StockLedgerError:
        _expire(db, urunler.values())
        raise


async def _decide(
    db: AsyncSession, specs: Sequence[Mapping[str, Any]], keys: Sequence[str]
) -> list[StockMovement] | None:
    """Idempotency kararı. `None` = "hiçbiri kayıtlı değil, uygula".

    Kısmi durumda **eksikler uygulanmaz**; `PartialIdempotencyState` yükselir.
    """
    if not keys:
        return None
    mevcut = await _fetch_by_keys(db, keys)
    if not mevcut:
        return None
    bulunan = [k for k in keys if k in mevcut]
    eksik = [k for k in keys if k not in mevcut]
    if eksik:
        raise PartialIdempotencyState(bulunan, eksik)
    return _replay(specs, mevcut)


def _expire(db: AsyncSession, nesneler: Iterable[Product]) -> None:
    for n in nesneler:
        db.expire(n)


# ════════════════════════ Genel arayüz ════════════════════════


async def apply_movement(
    db: AsyncSession,
    product_id: int,
    *,
    qty_delta: int,
    movement_type: StockMovementType | str,
    reason_code: str,
    #: ZORUNLU. Varsayılanı YOKTUR — ne burada, ne modelde, ne DB'de. Kovayı
    #: vermeyi unutan bir çağıran `TypeError` alır (typecheck/çağrı anında),
    #: ham SQL yazan bir çağıran ise NOT NULL ihlali alır.
    bucket: StockBucket | str,
    ref_type: str | None = None,
    ref_id: int | None = None,
    ref_line_id: int | None = None,
    idempotency_key: str | None = None,
    actor_type: str = "SYSTEM",
    actor_id: int | None = None,
    note: str | None = None,
    request_id: str | None = None,
) -> StockMovement:
    """Tek stok hareketi uygular ve `products.stock`'u AYNI transaction'da yazar.

    `commit` YAPMAZ — transaction sınırı çağıranındır.

    Yükseltebilir: `StockNotTracked` (stok takip edilmiyor), `ValueError`
    (geçersiz spec / sıfır delta), `InsufficientStock` (kırpma yok),
    `IdempotencyConflict` (aynı anahtar, farklı payload).
    """
    sonuc = await _apply_specs(
        db,
        [
            {
                "product_id": product_id,
                "qty_delta": qty_delta,
                "bucket": bucket,
                "movement_type": movement_type,
                "reason_code": reason_code,
                "ref_type": ref_type,
                "ref_id": ref_id,
                "ref_line_id": ref_line_id,
                "idempotency_key": idempotency_key,
                "actor_type": actor_type,
                "actor_id": actor_id,
                "note": note,
                "request_id": request_id,
            }
        ],
        allow_keyless=True,
    )
    return sonuc[0]


async def apply_many(
    db: AsyncSession, specs: Sequence[Mapping[str, Any]]
) -> list[StockMovement]:
    """Çok ürünlü/çok satırlı stok hareketini **atomik** uygular.

    Sonuçlar **girdi sırasında** döner (yazım sırası deterministik ama farklıdır:
    `(product_id, batch sırası)`).

    Ya hep ya hiç: batch'in yarısı kayıtlıysa `PartialIdempotencyState` yükselir
    ve eksikler UYGULANMAZ. Her spec bir `idempotency_key` taşımak zorundadır.
    """
    return await _apply_specs(db, specs, allow_keyless=False)


# ════════════════════════ Doğrulama / okuma ════════════════════════
#
# DİKKAT: `verify_ledger` bir **operasyon/admin doğrulamasıdır**; stok
# mutasyonlarından ÇAĞRILMAZ. Her harekette defteri baştan okumak, sıcak yolu
# ürün geçmişi uzunluğuyla doğru orantılı yavaşlatırdı ve zaten transaction
# içindeki `qty_after` zincirlemesi doğruluğu garanti ediyor.


#: Doğrulama bulgusu kodları. Arayüz metinleri bu kodlara bağlanır; serbest
#: metne bağlanmak, mesaj değişince ekranı sessizce bozardı.
PROBLEM_CHAIN_BREAK = "CHAIN_BREAK"
PROBLEM_STOCK_MISMATCH = "STOCK_MISMATCH"
PROBLEM_OPENING_MISSING = "OPENING_MISSING"
PROBLEM_OPENING_DUPLICATE = "OPENING_DUPLICATE"
PROBLEM_OPENING_NOT_FIRST = "OPENING_NOT_FIRST"
PROBLEM_ZERO_DELTA = "ZERO_DELTA"
PROBLEM_UNTRACKED_HAS_MOVEMENTS = "UNTRACKED_HAS_MOVEMENTS"

#: Doğrulamanın gezdiği kovalar. Hareketi hiç olmayan kova da GEZİLİR: hasarlı
#: bakiye sıfırdan farklıyken zincirin hiç olmaması tam olarak yakalanması
#: gereken bulgudur (`STOCK_MISMATCH`, expected 0).
_BUCKETS: tuple[str, ...] = (StockBucket.SALEABLE.value, StockBucket.DAMAGED.value)


@dataclasses.dataclass(frozen=True, slots=True)
class LedgerProblem:
    """Tek bir doğrulama bulgusu.

    `expected`/`actual` bilinçli olarak ayrı alanlar: operatörün "ne olmalıydı,
    ne var" sorusunu bir cümleyi ayrıştırmadan cevaplaması gerekir.
    """

    code: str
    message: str
    product_id: int
    sku: str | None = None
    movement_id: int | None = None
    expected: int | None = None
    actual: int | None = None
    #: Bulgunun ait olduğu kova. `None` = kovadan bağımsız (ör. stok takip
    #: edilmeyen üründe hareket bulunması). Aynı ürünün iki kovası ayrı ayrı
    #: bulgu üretebilir; kod aynı olsa bile hangi defterin bozuk olduğu
    #: buradan okunur.
    bucket: str | None = None


@dataclasses.dataclass(frozen=True, slots=True)
class LedgerVerification:
    """Tek ürünün İKİ kovasının birlikte sonucu.

    `current_stock`/`ledger_stock` **SATILABİLİR** kovayı anlatır (adları
    bilinçli olarak korundu: mevcut şemalar, uçlar ve ekranlar bu adlara
    bağlı). Hasarlı kova ayrı alanlarda; `movement_count` iki kovanın
    TOPLAMIDIR.
    """

    consistent: bool
    product_id: int
    current_stock: int | None
    ledger_stock: int | None
    first_divergent_id: int | None
    problems: tuple[LedgerProblem, ...]
    movement_count: int
    sku: str | None = None
    product_title: str | None = None
    #: Hasarlı kova (F29). Stok takip edilmeyen üründe ikisi de `None`.
    current_damaged_stock: int | None = None
    ledger_damaged_stock: int | None = None


@dataclasses.dataclass(frozen=True, slots=True)
class LedgerAudit:
    """Sayfalı genel denetim sonucu.

    **Tam tablo taraması YOK:** her istek yalnız bir ürün SAYFASINI denetler
    (`limit`/`offset`) ve o sayfayı sabit sayıda toplu sorguyla çözer.
    """

    checked: int
    inconsistent: int
    problems: tuple[LedgerProblem, ...]
    next_offset: int | None
    scanned_product_ids: tuple[int, ...]


async def verify_ledger(db: AsyncSession, product_id: int) -> LedgerVerification:
    """TEK ürünün defterini satır satır denetler.

    Ürün bazlı yol satırları zaten okumak zorunda (detay ekranı onları
    gösteriyor), bu yüzden burada saf `verify_chain` kullanılır. Genel denetim
    satırları yükleyemez → `audit_products` toplu SQL kullanır. İki yolun
    ayrışmaması bir çapraz-kontrol testiyle korunur
    (`test_stock_audit_pg.py::test_iki_dogrulama_yolu_ayni_sonucu_verir`).

    **Hiçbir veriyi düzeltmez.** Yalnız teşhis üretir.
    """
    product = (
        await db.execute(select(Product).where(Product.id == product_id))
    ).scalars().first()
    if product is None:
        raise ValueError(f"ürün bulunamadı: {product_id}")

    rows = (
        await db.execute(
            select(
                StockMovement.id,
                StockMovement.qty_delta,
                StockMovement.qty_after,
                StockMovement.movement_type,
                StockMovement.bucket,
            )
            # Kova zincirleri BAĞIMSIZ doğrulandığı için sıralama
            # `(bucket, id)`: index `(product_id, bucket, created_at DESC,
            # id DESC)` ile aynı önekten yararlanır.
            .where(StockMovement.product_id == product_id)
            .order_by(StockMovement.bucket, StockMovement.id)
        )
    ).all()

    def _p(code, message, **kw):
        return LedgerProblem(
            code=code, message=message, product_id=product_id, sku=product.sku, **kw
        )

    problems: list[LedgerProblem] = []

    # Stok takip edilmeyen (dijital) ürün: hiç hareket olmamalı.
    if product.stock is None:
        if rows:
            problems.append(
                _p(
                    PROBLEM_UNTRACKED_HAS_MOVEMENTS,
                    f"stok takip edilmeyen üründe {len(rows)} hareket var "
                    "(dijital ürün stok yönetimine tabi değildir)",
                    movement_id=rows[0][0],
                    expected=0,
                    actual=len(rows),
                )
            )
        return LedgerVerification(
            consistent=not problems,
            product_id=product_id,
            current_stock=None,
            ledger_stock=None,
            first_divergent_id=rows[0][0] if rows else None,
            problems=tuple(problems),
            movement_count=len(rows),
            sku=product.sku,
            product_title=product.title,
        )

    # ── Kova bazlı doğrulama ──
    #
    # İki kova İKİ AYRI DEFTERDİR. Her biri kendi zincirini, kendi açılış
    # bakiyesi kuralını ve kendi son-bakiye karşılaştırmasını taşır. Bir
    # kovadaki kopukluk diğerini bozuk göstermez.
    bakiye_kolonu = {
        StockBucket.SALEABLE.value: int(product.stock),
        StockBucket.DAMAGED.value: int(product.damaged_stock or 0),
    }
    defter_bakiye: dict[str, int] = {}
    ilk_sapan: list[int] = []

    for satir_id, delta, _after, tip, kova in rows:
        if delta == 0 and tip != StockMovementType.OPENING_BALANCE.value:
            problems.append(
                _p(
                    PROBLEM_ZERO_DELTA,
                    f"{tip} türünde sıfır delta",
                    movement_id=satir_id,
                    expected=None,
                    actual=0,
                    bucket=kova,
                )
            )

    for kova, mevcut in bakiye_kolonu.items():
        kova_satirlari = [r for r in rows if r[4] == kova]

        # Açılış bakiyesi kuralları — kova BAŞINA.
        acilislar = [
            r for r in kova_satirlari
            if r[3] == StockMovementType.OPENING_BALANCE.value
        ]
        if len(acilislar) > 1:
            problems.append(
                _p(
                    PROBLEM_OPENING_DUPLICATE,
                    f"{kova} kovasında {len(acilislar)} adet açılış bakiyesi var "
                    "(en çok bir olmalı)",
                    movement_id=acilislar[1][0],
                    expected=1,
                    actual=len(acilislar),
                    bucket=kova,
                )
            )
        if acilislar and kova_satirlari and acilislar[0][0] != kova_satirlari[0][0]:
            problems.append(
                _p(
                    PROBLEM_OPENING_NOT_FIRST,
                    f"{kova} kovasında açılış bakiyesi zincirin ilk satırı değil",
                    movement_id=acilislar[0][0],
                    expected=kova_satirlari[0][0],
                    actual=acilislar[0][0],
                    bucket=kova,
                )
            )

        # Zincir + son bakiye. Hareketi olmayan kovada defter bakiyesi 0'dır;
        # `verify_chain` "hareket yok + bakiye 0" hâlini GEÇERLİ, "hareket yok +
        # bakiye <> 0" hâlini bulgu sayar — hasarlı kovanın boş doğması budur.
        zincir = verify_chain([(r[0], r[1], r[2]) for r in kova_satirlari], mevcut)
        defter_bakiye[kova] = kova_satirlari[-1][2] if kova_satirlari else 0
        if zincir.consistent:
            continue
        if zincir.first_divergent_id is not None:
            ilk_sapan.append(zincir.first_divergent_id)
            problems.append(
                _p(
                    PROBLEM_CHAIN_BREAK,
                    f"{kova} kovasında zincir kopuk: hareketin sonuç bakiyesi "
                    "bir öncekiyle tutmuyor",
                    movement_id=zincir.first_divergent_id,
                    expected=zincir.expected,
                    actual=zincir.actual,
                    bucket=kova,
                )
            )
        else:
            problems.append(
                _p(
                    PROBLEM_STOCK_MISMATCH,
                    f"{kova} kovasının defter son bakiyesi ürün kolonundan farklı "
                    "(bakiye defter dışında değiştirilmiş)",
                    expected=defter_bakiye[kova],
                    actual=mevcut,
                    bucket=kova,
                )
            )

    return LedgerVerification(
        consistent=not problems,
        product_id=product_id,
        current_stock=int(product.stock),
        ledger_stock=defter_bakiye[StockBucket.SALEABLE.value],
        first_divergent_id=min(ilk_sapan) if ilk_sapan else None,
        problems=tuple(problems),
        movement_count=len(rows),
        sku=product.sku,
        product_title=product.title,
        current_damaged_stock=int(product.damaged_stock or 0),
        ledger_damaged_stock=defter_bakiye[StockBucket.DAMAGED.value],
    )


async def audit_products(
    db: AsyncSession, product_ids: Sequence[int]
) -> list[LedgerVerification]:
    """Bir ürün KÜMESİNİ **sabit sayıda toplu sorguyla** denetler.

    Ürün başına `verify_ledger` çağırmak N+1 üretirdi (100 ürünlük bir sayfa =
    200 sorgu). Burada ürün sayısından BAĞIMSIZ **dört** sorgu kullanılır:

      1. ürün künyeleri (`sku`, başlık, stok),
      2. hareket özeti (sayı, ilk/son id, açılış sayısı ve konumu, sıfır-delta),
      3. ürün başına son `qty_after` (`DISTINCT ON`),
      4. zincirin ilk koptuğu hareket (`lag` penceresi).

    `verify_ledger` ile aynı kuralları uygular; ayrışmadıkları çapraz-kontrol
    testiyle korunur.
    """
    ids = [int(i) for i in dict.fromkeys(product_ids)]
    if not ids:
        return []

    urunler = {
        p.id: p
        for p in (
            await db.execute(select(Product).where(Product.id.in_(ids)))
        ).scalars()
    }

    # Üç toplu sorgu da `(product_id, bucket)` bazında gruplanır: iki kova iki
    # ayrı defterdir ve `verify_ledger` de onları böyle doğrular. `GROUP BY`
    # yalnız `product_id` kalsaydı, hasarlı kovanın hareketleri satılabilir
    # zinciri sahte kopuk gösterirdi.
    ozet = {
        (r.product_id, r.bucket): r
        for r in (
            await db.execute(
                text(
                    """
                    SELECT product_id, bucket,
                           count(*)                                   AS adet,
                           max(id)                                    AS son_id,
                           count(*) FILTER (
                               WHERE movement_type = 'OPENING_BALANCE') AS acilis,
                           min(id) FILTER (
                               WHERE movement_type = 'OPENING_BALANCE') AS acilis_id,
                           min(id)                                    AS ilk_id,
                           count(*) FILTER (
                               WHERE qty_delta = 0
                                 AND movement_type <> 'OPENING_BALANCE') AS sifir
                    FROM stock_movements
                    WHERE product_id = ANY(:ids)
                    GROUP BY product_id, bucket
                    """
                ),
                {"ids": ids},
            )
        ).all()
    }
    son_bakiye = {
        (r.product_id, r.bucket): r.qty_after
        for r in (
            await db.execute(
                text(
                    """
                    SELECT DISTINCT ON (product_id, bucket)
                           product_id, bucket, qty_after
                    FROM stock_movements
                    WHERE product_id = ANY(:ids)
                    ORDER BY product_id, bucket, id DESC
                    """
                ),
                {"ids": ids},
            )
        ).all()
    }
    kopukluk: dict[tuple[int, str], Any] = {}
    for r in (
        await db.execute(
            text(
                """
                SELECT product_id, bucket, id, beklenen, qty_after AS gorulen
                FROM (
                    SELECT product_id, bucket, id, qty_after,
                           coalesce(lag(qty_after) OVER (
                               PARTITION BY product_id, bucket ORDER BY id), 0)
                             + qty_delta AS beklenen
                    FROM stock_movements
                    WHERE product_id = ANY(:ids)
                ) x
                WHERE qty_after <> beklenen
                ORDER BY product_id, bucket, id
                """
            ),
            {"ids": ids},
        )
    ).all():
        # İlk kopukluk kova başına: sonrakiler aynı sapmanın devamıdır.
        kopukluk.setdefault((r.product_id, r.bucket), r)

    sonuc: list[LedgerVerification] = []
    for pid in ids:
        product = urunler.get(pid)
        if product is None:
            continue
        kova_ozet = {
            k: ozet[(pid, k)] for k in _BUCKETS if (pid, k) in ozet
        }
        adet = sum(int(o.adet) for o in kova_ozet.values())
        problems: list[LedgerProblem] = []

        def _p(code, message, **kw):
            return LedgerProblem(
                code=code, message=message, product_id=pid, sku=product.sku, **kw
            )

        if product.stock is None:
            if adet:
                ilk = min(int(o.ilk_id) for o in kova_ozet.values())
                problems.append(
                    _p(
                        PROBLEM_UNTRACKED_HAS_MOVEMENTS,
                        f"stok takip edilmeyen üründe {adet} hareket var",
                        movement_id=ilk,
                        expected=0,
                        actual=adet,
                    )
                )
            sonuc.append(
                LedgerVerification(
                    consistent=not problems,
                    product_id=pid,
                    current_stock=None,
                    ledger_stock=None,
                    first_divergent_id=(
                        min(int(o.ilk_id) for o in kova_ozet.values())
                        if kova_ozet else None
                    ),
                    problems=tuple(problems),
                    movement_count=adet,
                    sku=product.sku,
                    product_title=product.title,
                    current_damaged_stock=None,
                    ledger_damaged_stock=None,
                )
            )
            continue

        bakiye_kolonu = {
            StockBucket.SALEABLE.value: int(product.stock),
            StockBucket.DAMAGED.value: int(product.damaged_stock or 0),
        }
        defter_bakiye: dict[str, int] = {}
        ilk_sapan: list[int] = []

        for kova, mevcut in bakiye_kolonu.items():
            o = kova_ozet.get(kova)
            if o and int(o.acilis) > 1:
                problems.append(
                    _p(
                        PROBLEM_OPENING_DUPLICATE,
                        f"{kova} kovasında {int(o.acilis)} adet açılış bakiyesi var "
                        "(en çok bir olmalı)",
                        expected=1,
                        actual=int(o.acilis),
                        bucket=kova,
                    )
                )
            if o and o.acilis_id is not None and int(o.acilis_id) != int(o.ilk_id):
                problems.append(
                    _p(
                        PROBLEM_OPENING_NOT_FIRST,
                        f"{kova} kovasında açılış bakiyesi zincirin ilk satırı değil",
                        movement_id=int(o.acilis_id),
                        expected=int(o.ilk_id),
                        actual=int(o.acilis_id),
                        bucket=kova,
                    )
                )
            if o and int(o.sifir):
                problems.append(
                    _p(
                        PROBLEM_ZERO_DELTA,
                        f"{kova} kovasında {int(o.sifir)} harekette sıfır delta",
                        expected=0,
                        actual=int(o.sifir),
                        bucket=kova,
                    )
                )

            kirik = kopukluk.get((pid, kova))
            defter_bakiye[kova] = int(son_bakiye.get((pid, kova), 0))
            if kirik is not None:
                ilk_sapan.append(int(kirik.id))
                problems.append(
                    _p(
                        PROBLEM_CHAIN_BREAK,
                        f"{kova} kovasında zincir kopuk: hareketin sonuç bakiyesi "
                        "bir öncekiyle tutmuyor",
                        movement_id=int(kirik.id),
                        expected=int(kirik.beklenen),
                        actual=int(kirik.gorulen),
                        bucket=kova,
                    )
                )
            elif defter_bakiye[kova] != mevcut:
                problems.append(
                    _p(
                        PROBLEM_STOCK_MISMATCH,
                        f"{kova} kovasının defter son bakiyesi ürün kolonundan "
                        "farklı (bakiye defter dışında değiştirilmiş)",
                        expected=defter_bakiye[kova],
                        actual=mevcut,
                        bucket=kova,
                    )
                )

        sonuc.append(
            LedgerVerification(
                consistent=not problems,
                product_id=pid,
                current_stock=int(product.stock),
                ledger_stock=defter_bakiye[StockBucket.SALEABLE.value],
                first_divergent_id=min(ilk_sapan) if ilk_sapan else None,
                problems=tuple(problems),
                movement_count=adet,
                sku=product.sku,
                product_title=product.title,
                current_damaged_stock=int(product.damaged_stock or 0),
                ledger_damaged_stock=defter_bakiye[StockBucket.DAMAGED.value],
            )
        )
    return sonuc


#: Genel denetimin tek istekte bakabileceği EN FAZLA ürün sayısı.
AUDIT_MAX_LIMIT = 200


async def audit_ledger(
    db: AsyncSession, *, limit: int = 50, offset: int = 0
) -> LedgerAudit:
    """Defterin SAYFALI genel denetimi (sınırsız tam tarama YOK).

    Her istek en fazla `AUDIT_MAX_LIMIT` ürün denetler ve `next_offset` ile
    sonraki sayfayı söyler. Sayfa içindeki denetim `audit_products` ile sabit
    sayıda toplu sorguya indirgenir.

    **Hiçbir veriyi düzeltmez.**
    """
    limit = max(1, min(int(limit), AUDIT_MAX_LIMIT))
    offset = max(0, int(offset))
    ids = (
        await db.execute(
            select(Product.id).order_by(Product.id).limit(limit + 1).offset(offset)
        )
    ).scalars().all()
    devam = len(ids) > limit
    ids = list(ids[:limit])

    sonuclar = await audit_products(db, ids)
    bulgular = [pr for r in sonuclar for pr in r.problems]
    return LedgerAudit(
        checked=len(sonuclar),
        inconsistent=sum(1 for r in sonuclar if not r.consistent),
        problems=tuple(bulgular),
        next_offset=(offset + limit) if devam else None,
        scanned_product_ids=tuple(ids),
    )


@dataclasses.dataclass(frozen=True, slots=True)
class MovementRow:
    """Hareket + ürün künyesi (tek sorguda; N+1 YOK)."""

    movement: StockMovement
    sku: str
    product_title: str


@dataclasses.dataclass(frozen=True, slots=True)
class MovementPage:
    rows: list[MovementRow]
    total: int


#: Liste uçlarının tek istekte dönebileceği EN FAZLA satır. Zorunlu sayfalama:
#: defter büyüdükçe sınırsız bir sorgu hem DB'yi hem yanıtı şişirir.
LIST_MAX_LIMIT = 200


async def list_movements(
    db: AsyncSession,
    *,
    product_id: int | None = None,
    sku: str | None = None,
    #: Kova filtresi. `None` = **iki kovayı da göster** — varsayılan listenin
    #: hasarlı hareketleri gizlemesi, defteri okuyan kişiye eksik bir gerçek
    #: sunmak olurdu. Filtre yalnız operatör açıkça daraltmak istediğinde uygulanır.
    bucket: str | None = None,
    movement_type: str | None = None,
    reason_code: str | None = None,
    actor_type: str | None = None,
    actor_id: int | None = None,
    ref_type: str | None = None,
    ref_id: int | None = None,
    date_from: Any = None,
    date_to: Any = None,
    limit: int = 50,
    offset: int = 0,
) -> MovementPage:
    """Hareket geçmişi — **zorunlu sayfalı**, en yeni önce.

    Sıralama `created_at DESC, id DESC`: aynı `created_at`'e sahip satırlar
    (toplu yazımda sık) `id` ile deterministik sıralanır; yoksa sayfalar arası
    satır tekrarlanabilir/atlanabilirdi.

    Ürün künyesi (`sku`, başlık) **join ile aynı sorguda** gelir; satır başına
    ürün çekmek N+1 üretirdi. Toplam istek maliyeti satır sayısından bağımsız
    **2 sorgudur** (sayım + sayfa).

    Kova (`bucket`) her satırda `row.movement.bucket` olarak zaten döner;
    `bucket` parametresi yalnız DARALTMA içindir ve varsayılanı `None`'dır —
    yani liste öntanımlı olarak iki kovayı da dürüstçe gösterir.
    """
    limit = max(1, min(int(limit), LIST_MAX_LIMIT))
    offset = max(0, int(offset))

    kosullar = []
    if product_id is not None:
        kosullar.append(StockMovement.product_id == product_id)
    if sku:
        kosullar.append(Product.sku == sku)
    if bucket:
        if bucket not in _BUCKETS:
            raise ValueError(f"geçersiz bucket: {bucket!r}")
        kosullar.append(StockMovement.bucket == bucket)
    if movement_type:
        kosullar.append(StockMovement.movement_type == movement_type)
    if reason_code:
        kosullar.append(StockMovement.reason_code == reason_code)
    if actor_type:
        kosullar.append(StockMovement.actor_type == actor_type)
    if actor_id is not None:
        kosullar.append(StockMovement.actor_id == actor_id)
    if ref_type:
        kosullar.append(StockMovement.ref_type == ref_type)
    if ref_id is not None:
        kosullar.append(StockMovement.ref_id == ref_id)
    if date_from is not None:
        kosullar.append(StockMovement.created_at >= date_from)
    if date_to is not None:
        kosullar.append(StockMovement.created_at <= date_to)

    taban = select(StockMovement, Product.sku, Product.title).join(
        Product, Product.id == StockMovement.product_id
    )
    total = (
        await db.execute(
            select(func.count())
            .select_from(StockMovement)
            .join(Product, Product.id == StockMovement.product_id)
            .where(*kosullar)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            taban.where(*kosullar)
            .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return MovementPage(
        rows=[MovementRow(movement=r[0], sku=r[1], product_title=r[2]) for r in rows],
        total=total,
    )
