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

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.observability import request_id_ctx
from models.store import (
    ADMIN_ADJUSTMENT_REASONS,
    Product,
    ProductKind,
    StockMovement,
    StockMovementType,
)

logger = logging.getLogger("adana.stock")

__all__ = [
    "ADMIN_ADJUSTMENT_REASONS",
    "IDEMPOTENCY_PAYLOAD_FIELDS",
    "ChainCheck",
    "IdempotencyConflict",
    "InsufficientStock",
    "LedgerVerification",
    "MovementPage",
    "PartialIdempotencyState",
    "StockLedgerError",
    "StockMovementType",
    "StockNotTracked",
    "apply_many",
    "apply_movement",
    "has_shortage",
    "idempotency_key_for",
    "list_movements",
    "lock_products",
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
}


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


# ═══════════════════ Idempotency anahtarları (saf) ═══════════════════


def idempotency_key_for(
    movement_type: StockMovementType | str,
    *,
    product_id: int | None = None,
    order_id: int | None = None,
    return_item_id: int | None = None,
    revision: str | None = None,
) -> str | None:
    """Ticari kaynaktan deterministik anahtar. `ADMIN_ADJUSTMENT`'ta `None`.

    Granülerlikler bilinçli:
      * `SALE`/`SALE_CANCEL` **sipariş + ürün** → aynı ürün iki sipariş
        satırında geçiyorsa adetler TOPLANMAK zorunda;
      * `RETURN` **iade satırı** → aynı üründen iki iade satırı İKİ geçerli
        harekettir;
      * `ADMIN_ADJUSTMENT` anahtarsız → her elle düzeltme ayrı bir olaydır.
        Çift tıklama zaten doğal olarak idempotenttir: hedef mutlak verilir,
        delta kilit altında hesaplanır, ikinci istekte 0 çıkar ve çağıran
        ledger'ı hiç çağırmaz.

    Eksik parametre sessizce kabul edilmez: `order:None:product:5` gibi bir
    anahtar iki farklı işlemi çakıştırabilirdi.
    """
    tip = StockMovementType(movement_type)
    if tip is StockMovementType.ADMIN_ADJUSTMENT:
        return None
    if tip in (StockMovementType.SALE, StockMovementType.SALE_CANCEL):
        _require(order_id=order_id, product_id=product_id)
        return f"order:{order_id}:product:{product_id}:{tip.value}"
    if tip is StockMovementType.RETURN:
        _require(return_item_id=return_item_id)
        return f"return_line:{return_item_id}:RETURN"
    if tip is StockMovementType.INITIAL:
        _require(product_id=product_id)
        return f"product:{product_id}:INITIAL"
    _require(revision=revision, product_id=product_id)
    return f"migration:{revision}:product:{product_id}"


def _require(**alanlar: Any) -> None:
    eksik = [ad for ad, deger in alanlar.items() if deger in (None, "")]
    if eksik:
        raise ValueError(
            f"idempotency anahtarı için zorunlu alan(lar) eksik: {', '.join(eksik)}"
        )


#: Idempotency payload karşılaştırmasına giren TÜM alanlar. `reason_code` ve
#: aktör de dâhil: aynı anahtarla farklı bir gerekçe veya farklı bir aktör
#: gelmesi de bir çelişkidir.
IDEMPOTENCY_PAYLOAD_FIELDS: tuple[str, ...] = (
    "product_id",
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
            )
        return ChainCheck(True)

    onceki = 0
    for satir_id, delta, after in rows:
        if after != onceki + delta:
            problems.append(
                f"hareket {satir_id}: qty_after {after}, beklenen {onceki + delta}"
            )
            return ChainCheck(False, satir_id, tuple(problems))
        onceki = after

    son = rows[-1][2]
    if son != current_stock:
        problems.append(
            f"defter son bakiyesi {son}, products.stock {current_stock} "
            "(stok defter dışında değiştirilmiş)"
        )
        return ChainCheck(False, None, tuple(problems))
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


def _write_one(db: AsyncSession, product: Product, spec: Mapping[str, Any]) -> StockMovement:
    """Tek hareketi kilit altında yazar. `qty_after` = gerçekten yazılan stok."""
    if product.stock is None:
        raise StockNotTracked(product.id)
    yeni = product.stock + spec["qty_delta"]
    if yeni < 0:
        raise InsufficientStock(product.id, product.stock, spec["qty_delta"])
    mv = StockMovement(
        product_id=product.id,
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
    # Aynı değişkenden: qty_after ile yazılan stok tanım gereği eşittir.
    product.stock = yeni
    return mv


def _write_order(specs: Sequence[Mapping[str, Any]]) -> list[int]:
    """Deterministik yazım sırası: `(product_id, batch içindeki sıra)`.

    Aynı ürüne birden çok hareket varsa bunlar ardışık işlenir ve `qty_after`
    zincir hâlinde hesaplanır (ürün nesnesi kilit altında mutasyona uğradığı
    için zincirleme doğal olarak kurulur).
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


@dataclasses.dataclass(frozen=True, slots=True)
class LedgerVerification:
    consistent: bool
    product_id: int
    current_stock: int | None
    ledger_stock: int | None
    first_divergent_id: int | None
    problems: tuple[str, ...]
    movement_count: int


async def verify_ledger(db: AsyncSession, product_id: int) -> LedgerVerification:
    """Bir ürünün defterini denetler (ürün bazlı; tam tablo taraması YOK).

    Denetlenenler:
      1. zincir sürekliliği (`verify_chain`);
      2. son `qty_after` == `products.stock`;
      3. açılış bakiyesi kuralları — en çok BİR `OPENING_BALANCE` ve varsa
         zincirin İLK satırı olmalı; sıfır delta yalnız o türde meşrudur;
      4. stok takip edilmeyen (dijital) üründe hiç hareket bulunmamalı.
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
            )
            .where(StockMovement.product_id == product_id)
            .order_by(StockMovement.id)
        )
    ).all()

    problems: list[str] = []

    # 4. Dijital / takip edilmeyen ürün: hiç hareket olmamalı.
    if product.stock is None:
        if rows:
            problems.append(
                f"stok takip edilmeyen üründe {len(rows)} hareket var "
                "(dijital ürün stok yönetimine tabi değildir)"
            )
        return LedgerVerification(
            consistent=not problems,
            product_id=product_id,
            current_stock=None,
            ledger_stock=None,
            first_divergent_id=rows[0][0] if rows else None,
            problems=tuple(problems),
            movement_count=len(rows),
        )

    # 3. Açılış bakiyesi kuralları.
    acilislar = [r for r in rows if r[3] == StockMovementType.OPENING_BALANCE.value]
    if len(acilislar) > 1:
        problems.append(f"{len(acilislar)} adet OPENING_BALANCE var (en çok bir olmalı)")
    if acilislar and rows and acilislar[0][0] != rows[0][0]:
        problems.append("OPENING_BALANCE zincirin ilk satırı değil")
    for satir_id, delta, _after, tip in rows:
        if delta == 0 and tip != StockMovementType.OPENING_BALANCE.value:
            problems.append(f"hareket {satir_id}: {tip} türünde sıfır delta")

    # 1-2. Zincir + son bakiye.
    zincir = verify_chain([(r[0], r[1], r[2]) for r in rows], product.stock)
    problems.extend(zincir.problems)

    return LedgerVerification(
        consistent=zincir.consistent and not problems,
        product_id=product_id,
        current_stock=product.stock,
        ledger_stock=rows[-1][2] if rows else 0,
        first_divergent_id=zincir.first_divergent_id,
        problems=tuple(problems),
        movement_count=len(rows),
    )


@dataclasses.dataclass(frozen=True, slots=True)
class MovementPage:
    rows: list[StockMovement]
    total: int


async def list_movements(
    db: AsyncSession,
    product_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    movement_type: str | None = None,
    date_from: Any = None,
    date_to: Any = None,
) -> MovementPage:
    """Ürün bazlı hareket geçmişi (en yeni önce), sayfalı.

    `ix_stock_movements_product` index'i `(product_id, created_at DESC, id DESC)`
    olduğu için sıralama ve tarih filtresi index'ten karşılanır.
    """
    kosullar = [StockMovement.product_id == product_id]
    if movement_type:
        kosullar.append(StockMovement.movement_type == movement_type)
    if date_from is not None:
        kosullar.append(StockMovement.created_at >= date_from)
    if date_to is not None:
        kosullar.append(StockMovement.created_at <= date_to)

    total = (
        await db.execute(select(func.count()).select_from(StockMovement).where(*kosullar))
    ).scalar_one()
    rows = (
        await db.execute(
            select(StockMovement)
            .where(*kosullar)
            .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return MovementPage(rows=list(rows), total=total)
