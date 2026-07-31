"""F29 — stok sayımı, düzeltme ve hasarlı stok modelleri.

Bu dosya envanterin **operasyon** tarafını taşır; stok bakiyesinin kendisi
`products.stock` / `products.damaged_stock` kolonlarında, değişim geçmişi ise
`stock_movements` defterinde durur (`models/store.py`). Buradaki tablolar
"kim, ne zaman, neyi saydı/hasarlı ilan etti ve bunun sonucunda deftere ne
yazıldı" sorusunu cevaplar.

## Üç büyüklük karıştırılmaz

* `products.stock` = **satılabilir** miktar (fiziksel mevcut DEĞİL).
* `products.damaged_stock` = işletmede duran, **satılamaz** miktar.
* `reserved_on_premise` = ödenmiş ama henüz işletmeden çıkmamış kalemler.
  **Kolon değildir**, sipariş tablolarından türetilir.

Sayım anında beklenen fiziksel mevcut:

    beklenen = system_qty_snapshot + coalesce(reserved_qty_snapshot, 0)

`system_qty_snapshot` satırın **kendi kovasına karşılık gelen sistem kolonunun**
o andaki değeridir (SALEABLE → `products.stock`, DAMAGED →
`products.damaged_stock`); `reserved_qty_snapshot` yalnız SALEABLE satırda
doludur ve DAMAGED satırda `NULL` olmak zorundadır (CHECK ile). Üç değer tek
belirsiz sayıya toplanmaz — hangi büyüklüğün ne olduğu kolon adıyla sabittir.

## `difference` neden kolon değil

Fark `counted_qty − (system_qty_snapshot + coalesce(reserved_qty_snapshot,0))`
olarak **her okumada türetilir**. Kalıcı kolon ikinci bir doğruluk kaynağı
yaratır: yeniden sayım `counted_qty`'yi değiştirir, `difference` güncellenmezse
ekran ile defter sessizce ayrışır. Maliyeti yok — üç kolon da aynı satırda,
ek JOIN veya alt sorgu gerekmez; API katmanı bunu okurken hesaplar.

## Değiştirilemezlik politikası (append-only)

* `stock_count_line_events` ve `stock_damage_events` **append-only**'dir:
  UPDATE/DELETE trigger'la reddedilir (`stock_movements` ile aynı duruş —
  gizlenebilen bir iz, iz değildir).
* `stock_count_sessions` ve `stock_count_lines` **durum taşır**, dolayısıyla
  UPDATE edilir; ama miktar değişikliğinin geçmişi `stock_count_line_events`'e
  düşer, yani "kim önce kaç saymıştı" bilgisi kaybolmaz.

## Parasal değerleme yoktur

Direktif gereği bu katman tutar, maliyet veya zarar taşımaz — yalnız miktar ve
iz. Kural bir kaynak sözleşmesi testiyle korunur
(`tests/acceptance/test_inventory_contract.py`).
"""
from __future__ import annotations

import datetime
import enum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin
from models.store import StockBucket


class CountSessionStatus(str, enum.Enum):
    """Sayım oturumunun durumu.

    DRAFT → IN_PROGRESS → REVIEW → APPLIED (terminal)
                 ▲          │
                 └──────────┘  (düzeltme için geri dönüş; onay temizlenir)

    DRAFT | IN_PROGRESS | REVIEW → CANCELLED (terminal)
    """

    #: Kapsam belirleniyor; satırlar üretildi ama sayım başlamadı.
    DRAFT = "DRAFT"
    #: Sayım sürüyor; miktar yalnız bu durumda girilebilir.
    IN_PROGRESS = "IN_PROGRESS"
    #: Sayım bitti, farklar gözden geçiriliyor. Değişiklik gerekirse
    #: IN_PROGRESS'e dönülür ve önceki onay geçersizleşir.
    REVIEW = "REVIEW"
    #: Farklar deftere yazıldı. Terminal — geri alma yoktur, düzeltme yeni
    #: bir sayımla yapılır.
    APPLIED = "APPLIED"
    #: Vazgeçildi. Terminal; hiçbir hareket yazılmaz.
    CANCELLED = "CANCELLED"


class CountLineStatus(str, enum.Enum):
    """Sayım satırının çözüm durumu."""

    #: Henüz sayılmadı.
    PENDING = "PENDING"
    #: Sayıldı, miktar girildi.
    COUNTED = "COUNTED"
    #: Sayımdan sonra fiziksel etkisi **belirsiz** bir olay geçti; satır
    #: yeniden sayılmadan ya da açıkça çözülmeden oturum uygulanamaz.
    STALE = "STALE"
    #: Belirsizlik, gözden geçiren kişi tarafından gerekçesiyle giderildi.
    RESOLVED = "RESOLVED"
    #: Bilinçli olarak sayılmadı (ör. hasarlı kovası olmayan ürün). Fark
    #: üretmez, hareket yazılmaz.
    SKIPPED = "SKIPPED"


class DamageEventKind(str, enum.Enum):
    """Hasar olayının türü — hangi kovadan hangi kovaya."""

    #: Satılabilir → hasarlı (iki hareket, tek transaction).
    TRANSFER = "TRANSFER"
    #: Hasarlı → satılabilir (kurtarıldı).
    RECOVERY = "RECOVERY"
    #: Hasarlı kovadan fiziksel çıkış (imha).
    DISPOSAL = "DISPOSAL"
    #: Seçilen kovadan tedarikçiye fiziksel çıkış.
    SUPPLIER_RETURN = "SUPPLIER_RETURN"


#: Hasar olayları ve hasar kaynaklı hareketler için geçerli gerekçe kodları.
#: `ADMIN_ADJUSTMENT_REASONS` bilinçli olarak **bozulmadan** bırakıldı: elle
#: düzeltmenin gerekçe sözlüğü ile hasar sözlüğü farklı iş kavramlarıdır.
DAMAGE_REASONS = frozenset(
    {"KIRIK", "ISLAK", "BASKI_HATASI", "MUSTERI_IADESI_HASARLI", "DIGER"}
)

#: Sayım farkı hareketleri için gerekçe kodları (yön bilgisi taşır).
COUNT_ADJUSTMENT_REASONS = frozenset({"SAYIM_FAZLA", "SAYIM_EKSIK"})

_BUCKET_SQL = "('SALEABLE','DAMAGED')"


class StockCountSession(Base, TimestampMixin, SoftDeleteMixin):
    """Bir sayım turu: kapsam + durum + kim ne zaman ne yaptı.

    ## Maker-checker hazır, zorunlu değil

    `created_by` / `counted_by` (satırda) / `reviewed_by` / `applied_by`
    **ayrı** alanlardır. Varsayılan işletme kuralı tek yetkili adminin süreci
    baştan sona tamamlamasına izin verir; `INVENTORY_REQUIRE_SEPARATE_APPROVER`
    açıldığında servis katmanı aynı aktörü reddeder. Alanların ayrılığı bu
    kararı **veri kaybetmeden** ertelenebilir kılar — sonradan eklenmiş bir
    ayrım geçmişi açıklayamazdı.

    ## `apply_idempotency_key`

    Uygulama isteği ağ hatasıyla tekrarlanırsa aynı anahtar **replay** döndürür
    (yeni hareket yazılmaz). Farklı/eksik anahtarla ikinci istek 409'dur —
    "zaten uygulandı" sessizce yutulmaz.
    """

    __tablename__ = "stock_count_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: İnsan okur kimlik (SAYIM-2026-0001). Ekranlarda ve audit'te referans.
    code: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, server_default=text("'DRAFT'")
    )
    #: ALL (tüm takip edilen ürünler) | CATEGORY | MANUAL (seçili ürünler).
    scope: Mapped[str] = mapped_column(String(10), nullable=False)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_categories.id", ondelete="RESTRICT"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Aktörler ──
    # RESTRICT: admin hesapları soft-delete edilir, bu yüzden pratikte hiç
    # tetiklenmez; niyeti belgeler — bir sayım kararı aktörünü kaybedemez.
    created_by_admin_id: Mapped[int] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=False
    )
    started_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    submitted_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewed_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=True
    )
    reviewed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    applied_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=True
    )
    applied_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    apply_idempotency_key: Mapped[str | None] = mapped_column(
        String(80), nullable=True
    )
    cancelled_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=True
    )
    cancelled_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT','IN_PROGRESS','REVIEW','APPLIED','CANCELLED')",
            name="ck_stock_count_sessions_status",
        ),
        CheckConstraint(
            "scope IN ('ALL','CATEGORY','MANUAL')",
            name="ck_stock_count_sessions_scope",
        ),
        # Kategori kapsamı kategorisiz olamaz; diğer kapsamlar kategori taşımaz.
        CheckConstraint(
            "(scope = 'CATEGORY') = (category_id IS NOT NULL)",
            name="ck_stock_count_sessions_category",
        ),
        # APPLIED bir para/envanter kararıdır: aktörü ve zamanı olmadan yazılamaz.
        CheckConstraint(
            "status <> 'APPLIED' OR "
            "(applied_at IS NOT NULL AND applied_by_admin_id IS NOT NULL)",
            name="ck_stock_count_sessions_applied",
        ),
        CheckConstraint(
            "status <> 'CANCELLED' OR "
            "(cancelled_at IS NOT NULL AND cancelled_by_admin_id IS NOT NULL)",
            name="ck_stock_count_sessions_cancelled",
        ),
        Index("uq_stock_count_sessions_code", "code", unique=True),
        Index("ix_stock_count_sessions_status", "status", text("created_at DESC")),
    )


class StockCountLine(Base, TimestampMixin):
    """Sayım satırı = **(oturum, ürün, kova)**.

    ## Neden kova bazlı

    Tek satırda `counted_saleable` + `counted_damaged` tutmak, yalnız hasarlıyı
    saymayı modelleyemez ve `STALE` durumunu kova bazında ayrıştıramaz. Tek bir
    `counted_qty` alıp farkı otomatik satılabilir kovaya yazmak ise **tahmindir**
    ve direktifle yasaklanmıştır. Defter zinciri de kova bazlı olduğu için satır
    ↔ hareket eşlemesi birebirdir.

    ## `is_open` türetilmiş bir kolondur

    "Bir ürün aynı anda birden fazla açık sayımda olamaz" kuralı **veritabanı
    seviyesinde** korunur: `(product_id, bucket) WHERE is_open` kısmi unique
    index'i. Ancak açıklık bilgisi oturumun durumundadır; bunu servise
    kopyalamak ikinci bir doğruluk kaynağı yaratırdı. Bu yüzden `is_open`
    **trigger tarafından** oturumun `status`/`deleted_at` değerinden türetilir
    (`stock_count_lines_derive_open`); satıra elle yazılan değer EZİLİR.
    """

    __tablename__ = "stock_count_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("stock_count_sessions.id", ondelete="RESTRICT"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    bucket: Mapped[str] = mapped_column(String(10), nullable=False)

    # ── Sayım anının fotoğrafı ──
    #: Satırın kovasına karşılık gelen sistem kolonunun o andaki değeri:
    #: SALEABLE → `products.stock`, DAMAGED → `products.damaged_stock`.
    system_qty_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Ödenmiş ama işletmeden çıkmamış miktar. YALNIZ SALEABLE satırda anlamlı;
    #: DAMAGED satırda NULL olmak ZORUNDA (CHECK). Hasarlı kitap siparişe
    #: ayrılamayacağı için orada bir sayı yazmak yanlış olurdu.
    reserved_qty_snapshot: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    #: Snapshot anındaki son `stock_movements.id` (o ürün+kova için). Sonrasında
    #: hangi olayların geçtiğini bulmanın başlangıç noktası. FK DEĞİL: defter
    #: satırı polimorfik referans deseniyle bağlanır ve testte fiziksel
    #: temizlik yapılabilir kalmalıdır. Hiç hareketi olmayan kovada NULL.
    snapshot_movement_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ── Sayım sonucu ──
    counted_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: SUNUCU zamanı. İstemciden saat/saat dilimi kabul edilmez.
    counted_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    counted_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=True
    )

    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'PENDING'")
    )
    #: STALE gerekçesi — serbest metin değil, kod (`RETURN_WITHOUT_RECEIPT`,
    #: `ADMIN_ADJUSTMENT`, `CHAIN_BREAK`, `PRODUCT_UNTRACKED`…). Arayüz metni
    #: koda bağlanır; mesaja bağlanan ekran mesaj değişince sessizce bozulur.
    stale_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)
    resolved_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=True
    )
    resolved_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: Uygulama sonunda yazılan defter satırı. FK DEĞİL (yukarıdaki gerekçe).
    #: Fark 0 ise hareket yazılmaz ve bu alan NULL kalır — "sayıldı, fark yok"
    #: geçerli ve değerli bir sonuçtur.
    applied_movement_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    #: TÜRETİLMİŞ — trigger yazar, servis yazmaz (sınıf açıklamasına bakınız).
    is_open: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        CheckConstraint(f"bucket IN {_BUCKET_SQL}", name="ck_stock_count_lines_bucket"),
        CheckConstraint(
            "status IN ('PENDING','COUNTED','STALE','RESOLVED','SKIPPED')",
            name="ck_stock_count_lines_status",
        ),
        # Rezerve YALNIZ satılabilir kovada anlamlıdır.
        CheckConstraint(
            "(bucket = 'SALEABLE') = (reserved_qty_snapshot IS NOT NULL)",
            name="ck_stock_count_lines_reserved",
        ),
        CheckConstraint(
            "system_qty_snapshot >= 0 AND "
            "(reserved_qty_snapshot IS NULL OR reserved_qty_snapshot >= 0)",
            name="ck_stock_count_lines_snapshot_sign",
        ),
        # Negatif sayım fiziksel olarak imkânsızdır.
        CheckConstraint(
            "counted_qty IS NULL OR counted_qty >= 0",
            name="ck_stock_count_lines_counted_sign",
        ),
        # Miktar varsa kim ve ne zaman saydığı da vardır.
        CheckConstraint(
            "counted_qty IS NULL OR "
            "(counted_at IS NOT NULL AND counted_by_admin_id IS NOT NULL)",
            name="ck_stock_count_lines_counted_actor",
        ),
        # Sayılmamış satır COUNTED/RESOLVED olamaz.
        CheckConstraint(
            "status NOT IN ('COUNTED','RESOLVED') OR counted_qty IS NOT NULL",
            name="ck_stock_count_lines_counted_status",
        ),
        CheckConstraint(
            "(status = 'STALE') = (stale_reason IS NOT NULL)",
            name="ck_stock_count_lines_stale",
        ),
        # Belirsizliğin elle giderilmesi kim/ne zaman/gerekçe olmadan yazılamaz.
        CheckConstraint(
            "status <> 'RESOLVED' OR (resolved_by_admin_id IS NOT NULL "
            "AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL)",
            name="ck_stock_count_lines_resolved",
        ),
        Index(
            "uq_stock_count_lines_slot",
            "session_id",
            "product_id",
            "bucket",
            unique=True,
        ),
        # Bir ürün+kova aynı anda YALNIZ BİR açık oturumda olabilir.
        Index(
            "uq_stock_count_lines_open",
            "product_id",
            "bucket",
            unique=True,
            postgresql_where=text("is_open"),
        ),
        Index("ix_stock_count_lines_session", "session_id", "status"),
    )


class StockCountLineEvent(Base):
    """Yeniden sayım izi — **append-only**.

    `counted_qty` üzerine yazılır (son sayım geçerlidir); ama "önce 12 demişti,
    sonra 8 yaptı" bilgisi kaybolamaz. Her miktar yazımı buraya bir satır düşer.
    """

    __tablename__ = "stock_count_line_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int] = mapped_column(
        ForeignKey("stock_count_lines.id", ondelete="RESTRICT"), nullable=False
    )
    #: İlk sayımda NULL (öncesi yok).
    old_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_admin_id: Mapped[int] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        CheckConstraint(
            "new_qty >= 0 AND (old_qty IS NULL OR old_qty >= 0)",
            name="ck_stock_count_line_events_sign",
        ),
        Index("ix_stock_count_line_events_line", "line_id", "id"),
    )


class StockDamageEvent(Base):
    """Hasar işleminin ticari kaynağı — **append-only**.

    Defterdeki iki hareket (ör. satılabilir −3 / hasarlı +3) bu olayın `id`'siyle
    bağlanır (`ref_type='damage_event'`) ve idempotency anahtarları buradan
    türetilir: `damage:{event_id}:{bucket}`. Böylece bir retry **çiftin
    tamamını** replay eder; yarısı yazılmış bir transfer imkânsızdır.
    """

    __tablename__ = "stock_damage_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Miktarın ÇIKTIĞI kova. Hedef kova türden belirlidir.
    source_bucket: Mapped[str] = mapped_column(String(10), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(30), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_admin_id: Mapped[int] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        CheckConstraint(
            "kind IN ('TRANSFER','RECOVERY','DISPOSAL','SUPPLIER_RETURN')",
            name="ck_stock_damage_events_kind",
        ),
        CheckConstraint(
            f"source_bucket IN {_BUCKET_SQL}", name="ck_stock_damage_events_bucket"
        ),
        # Sıfır miktarlı olay yazılmaz: iz üretmeyen bir kayıt gürültüdür.
        CheckConstraint("qty > 0", name="ck_stock_damage_events_qty"),
        # Tür ↔ kaynak kova uyumu: transfer satılabilirden çıkar, kurtarma ve
        # imha hasarlıdan; tedarikçi iadesi her iki kovadan olabilir.
        CheckConstraint(
            "(kind = 'TRANSFER' AND source_bucket = 'SALEABLE') "
            "OR (kind IN ('RECOVERY','DISPOSAL') AND source_bucket = 'DAMAGED') "
            "OR kind = 'SUPPLIER_RETURN'",
            name="ck_stock_damage_events_kind_bucket",
        ),
        CheckConstraint(
            "reason_code IN ('KIRIK','ISLAK','BASKI_HATASI',"
            "'MUSTERI_IADESI_HASARLI','DIGER')",
            name="ck_stock_damage_events_reason",
        ),
        # "DIGER" tek başına hiçbir şey açıklamaz; açıklamayı not taşır.
        CheckConstraint(
            "reason_code <> 'DIGER' OR (note IS NOT NULL AND length(btrim(note)) > 0)",
            name="ck_stock_damage_events_note",
        ),
        Index("ix_stock_damage_events_product", "product_id", text("id DESC")),
    )


__all__ = [
    "COUNT_ADJUSTMENT_REASONS",
    "DAMAGE_REASONS",
    "CountLineStatus",
    "CountSessionStatus",
    "DamageEventKind",
    "StockBucket",
    "StockCountLine",
    "StockCountLineEvent",
    "StockCountSession",
    "StockDamageEvent",
]
