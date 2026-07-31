"""F29 envanter uçlarının istek/yanıt şemaları.

## Sözleşme

* **Parasal kavram yoktur.** F29 miktar ve iz tutar, değerleme yapmaz; bir
  kabul testi bu katmanı AST üzerinden tarar.
* **İç DB modeli doğrudan dönmez.** Her yanıt açık alan listesiyle kurulur;
  modele alan eklemek uçtan sızdırmaz.
* **`difference` saklanmaz, türetilir.** `counted_qty − (sistem + rezerve)`
  her okumada hesaplanır; kalıcı kolon ikinci bir doğruluk kaynağı olurdu.
* **İstemci zaman damgası gönderemez.** İstek şemaları `extra="forbid"`
  taşır, dolayısıyla `counted_at` gibi bir alan 422 ile reddedilir — sunucu
  zamanı uzlaştırmanın güven kaynağıdır.
* **Sayfalama zorunlu ve tavanlı.** Liste yanıtları `limit`/`offset`/`total`
  taşır; tavan `stock_ledger.LIST_MAX_LIMIT` ile aynı disiplindedir.
"""
from __future__ import annotations

import datetime
import enum

from pydantic import BaseModel, ConfigDict, Field

#: Liste uçlarının tek istekte dönebileceği EN FAZLA satır.
MAX_LIMIT = 200

#: `offset` tavanı. Sınırsız offset, her istekte tam tarama maliyeti üretir
#: ve hiçbir gerçek operasyon senaryosuna karşılık gelmez.
MAX_OFFSET = 100_000


class Bucket(str, enum.Enum):
    """Miktarın durduğu kova. Serbest metin kabul edilmez."""

    SALEABLE = "SALEABLE"
    DAMAGED = "DAMAGED"


class CountScope(str, enum.Enum):
    ALL = "ALL"
    CATEGORY = "CATEGORY"
    MANUAL = "MANUAL"


class DamageKind(str, enum.Enum):
    TRANSFER = "TRANSFER"
    RECOVERY = "RECOVERY"
    DISPOSAL = "DISPOSAL"
    SUPPLIER_RETURN = "SUPPLIER_RETURN"


class DamageReason(str, enum.Enum):
    """Hasar gerekçeleri. `DIGER` seçilirse açıklama notu zorunludur —
    kural servis ve veritabanı seviyesinde de zorlanır."""

    KIRIK = "KIRIK"
    ISLAK = "ISLAK"
    BASKI_HATASI = "BASKI_HATASI"
    MUSTERI_IADESI_HASARLI = "MUSTERI_IADESI_HASARLI"
    DIGER = "DIGER"


class _Istek(BaseModel):
    """Bütün istek gövdelerinin ortak tabanı.

    `extra="forbid"`: bilinmeyen alan 422 ile reddedilir. Asıl amacı
    `counted_at`, `actor` ya da `applied_at` gibi **sunucuya ait** alanların
    istemciden gelmesini imkânsız kılmaktır.
    """

    model_config = ConfigDict(extra="forbid")


# ════════════════════════ İstek şemaları ════════════════════════


class CountSessionCreate(_Istek):
    scope: CountScope
    #: `MANUAL` kapsamda sayılacak ürünler. Diğer kapsamlarda boş bırakılır.
    product_ids: list[int] = Field(default_factory=list, max_length=MAX_LIMIT)
    category_id: int | None = None
    note: str | None = Field(default=None, max_length=1000)


class CountSessionProducts(_Istek):
    product_ids: list[int] = Field(min_length=1, max_length=MAX_LIMIT)


class CountLineQty(_Istek):
    """Sayım miktarı. **`counted_at` alınmaz** — zaman sunucudan gelir."""

    counted_qty: int = Field(ge=0)


class CountLineResolve(_Istek):
    """Belirsizliğin açıklamayla kayda geçirilmesi.

    Miktar ALMAZ: rastgele bir sayı girerek `STALE` bayrağını kaldırmak
    belirsizliği çözmek değil gizlemek olurdu. Satır bu işlemden sonra da
    uygulanamaz; tek çıkış yeniden sayımdır.
    """

    note: str = Field(min_length=1, max_length=1000)


class CountSessionApply(_Istek):
    idempotency_key: str = Field(min_length=1, max_length=80)


class CountSessionCancel(_Istek):
    reason: str = Field(min_length=1, max_length=1000)


class DamageEventCreate(_Istek):
    """Dört hasar işleminin ortak gövdesi; `kind` hangisi olduğunu söyler.

    `bucket` YALNIZ `SUPPLIER_RETURN`'de anlamlıdır ve orada zorunludur:
    miktarın hangi kovadan çıkacağı tahmin edilmez.
    """

    product_id: int = Field(gt=0)
    kind: DamageKind
    qty: int = Field(gt=0)
    reason_code: DamageReason
    bucket: Bucket | None = None
    note: str | None = Field(default=None, max_length=1000)
    #: İsteğe bağlı. Kapsam `(aktör, anahtar)`: aynı yöneticinin aynı anahtarı
    #: farklı bir iş için kullanması çatışmadır, farklı yöneticiler aynı metni
    #: bağımsız kullanabilir.
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=80)


# ════════════════════════ Yanıt şemaları ════════════════════════


class CountLineOut(BaseModel):
    id: int
    #: Teknik kimlik — arayüzde destekleyici bilgidir, ana metin DEĞİLDİR.
    product_id: int
    #: Ürünün okunabilir adı. Rafın başındaki kişi numaradan ürün tanıyamaz;
    #: bu alan olmadan yanlış ürün sayma riski doğar.
    product_name: str
    #: Stok kalemi kimliği. Fiziksel doğrulamanın kararlı anahtarı.
    product_sku: str
    bucket: Bucket
    status: str
    #: Satırın kovasına karşılık gelen sistem kolonunun sayım anındaki değeri.
    system_qty_snapshot: int
    #: Ödenmiş ama işletmeden çıkmamış adet; YALNIZ satılabilir kovada dolu.
    reserved_qty_snapshot: int | None
    counted_qty: int | None
    #: **TÜRETİLMİŞ** — saklanmaz. `counted − (sistem + rezerve)`.
    difference: int | None
    #: Sunucu (veritabanı) zamanı; istemciden alınmaz.
    counted_at: datetime.datetime | None
    counted_by_admin_id: int | None
    stale_reason: str | None
    resolved_by_admin_id: int | None
    resolved_at: datetime.datetime | None
    resolution_note: str | None
    note: str | None
    applied_movement_id: int | None


class CountSessionOut(BaseModel):
    id: int
    code: str
    status: str
    scope: CountScope
    category_id: int | None
    note: str | None
    created_by_admin_id: int
    created_at: datetime.datetime
    started_at: datetime.datetime | None
    submitted_at: datetime.datetime | None
    reviewed_by_admin_id: int | None
    reviewed_at: datetime.datetime | None
    applied_by_admin_id: int | None
    applied_at: datetime.datetime | None
    cancelled_by_admin_id: int | None
    cancelled_at: datetime.datetime | None
    cancel_reason: str | None
    #: Oturumdaki satır sayısı — **türetilmiş**, saklanmaz. Liste ekranı
    #: operatöre "bu oturum ne kadar iş" sorusunu açmadan cevaplayabilsin diye
    #: sunucuda toplu sorguyla hesaplanır.
    line_count: int = 0
    #: Henüz miktar girilmemiş satır sayısı.
    uncounted_line_count: int = 0
    #: Yeniden sayım gerektiren satır var mı (`STALE` veya `RESOLVED`).
    #: Listede dikkat işareti bunun üzerinden verilir; istemci uydurmaz.
    has_stale: bool = False


class CountSessionDetailOut(CountSessionOut):
    lines: list[CountLineOut]


class CountSessionPage(BaseModel):
    items: list[CountSessionOut]
    total: int
    limit: int
    offset: int


class DamageEventOut(BaseModel):
    id: int
    product_id: int
    kind: DamageKind
    qty: int
    source_bucket: Bucket
    reason_code: str
    note: str | None
    actor_admin_id: int
    created_at: datetime.datetime
    idempotency_key: str | None


class DamageEventPage(BaseModel):
    items: list[DamageEventOut]
    total: int
    limit: int
    offset: int


class OnPremiseOut(BaseModel):
    """Ürünün işletmedeki fiziksel mevcudunun dökümü (salt okunur)."""

    product_id: int
    saleable: int
    damaged: int
    reserved: int
    total: int
