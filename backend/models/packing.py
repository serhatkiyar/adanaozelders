"""F30 — sipariş paketi, paket satırı ve paket olay izi.

Sözleşme: `docs/f30-paketleme-sozlesmesi.md` (§3.1-§3.6, §5).

## Paket neden ayrı bir varlık

`Order`'a kolon eklemek üç sebeple yetmez (sözleşme §3.1):

1. **Ömür farkı.** Bir siparişin ömrü boyunca birden çok paket olabilir (paket
   bozulur → yeni paket açılır). Kolon tek örneği tutar, geçmişi kaybeder;
   `package_no` o geçmişi sipariş içinde sıralı ve okunur kılar.
2. **Yarış otoritesi.** "İki operatör aynı siparişi paketleyemez" garantisinin
   veritabanında bir yeri olmalı — `uq_order_packages_live` kısmi unique
   index'i bunu yapar, kolon yapamaz.
3. **Kalem bazlı iz.** Toplanan adet satır bazlıdır; kolona sığmaz.

## Canlı paket tanımı — TEK YERDE

    canlı  ⇔  status NOT IN ('DELIVERED', 'VOID')

Bu yüklem yalnız burada, `uq_order_packages_live` kısmi index'inin
`postgresql_where`'inde yazılıdır ve `LIVE_PACKAGE_SQL` sabitinden gelir.
Migration da aynı sabitin metnini kullanır. İkinci bir kopya (servis içinde
elle yazılmış bir filtre) er ya da geç index ile ayrışır: index "ikinci paket
açılamaz" derken sorgu "canlı paket yok" diyebilir ve hata 500 olarak görünür.

## Durum kümesi ve FSM

`PACKAGE_STATUSES` bu dosyada **veri olarak** durur; DB CHECK'i (`ck_order_
packages_status`) doğrudan ondan üretilir. Geçiş grafiği (`PACKAGE_TRANSITIONS`)
ve fiziksel konum tablosu (`PACKAGE_LOCATION`) commit 3'te `services/
packing_rules.py` içinde, **saf** bir modülde tanımlanacaktır (o modül
`models`'i import EDEMEZ — bir kabul testi bunu korur). İki taraf aynı durum
adlarını kullanır; bir kabul testi kümelerin eşitliğini denetler.

## Optimistic locking kolonu YOK — bilinçli

Yarış otoritesi bu tasarımda **pesimist**tir: her yazan yol `Order`'ı
`FOR UPDATE` ile kilitler (kanonik sıra: … → Order → OrderPackage →
DeliveryStop) ve kısmi unique index son sözü söyler. Buna ek bir `version`
kolonu koymak üçüncü bir eşzamanlılık mekanizması olurdu; hangisinin
bağlayıcı olduğu belirsizleşir. Kalem listesinin sipariş altında değişmesi
ise `items_fingerprint` ile yakalanır (STALE) — o, satır kilidiyle değil
içerik özetiyle çözülen ayrı bir sorudur.

## Stok defterine dokunulmaz

Bu tabloların hiçbiri `products.stock` / `damaged_stock` ya da `stock_movements`
ile ilgili değildir. Paketleme fiziksel bir **konum/doğrulama** olayıdır; satış
hareketi (`SALE`) ödeme anında zaten yazılmıştır (sözleşme §5).
"""
from __future__ import annotations

import datetime
import secrets

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import TimestampMixin

#: Paket FSM'inin bütün durumları (sözleşme §3.2). Terminal: DELIVERED, VOID.
PACKAGE_STATUSES: tuple[str, ...] = (
    "OPEN",
    "PACKED",
    "HANDED_OVER",
    "RETURN_PENDING",
    "RETURNED",
    "DELIVERED",
    "VOID",
)

#: Terminal durumlar — paket artık hiçbir yola girmez, QR'ı geçersizdir.
TERMINAL_PACKAGE_STATUSES: tuple[str, ...] = ("DELIVERED", "VOID")

#: **Canlı paket** yüklemi. Tek doğruluk kaynağı; kısmi index ve migration
#: aynı metni kullanır (bkz. modül docstring'i).
LIVE_PACKAGE_SQL = "status NOT IN ('DELIVERED', 'VOID')"

#: Paket olay izinin tür sözlüğü. Dar tutulur: yazım hatası (`HANDOVR`) sessiz
#: bir "iz yok" üretir ve ancak operasyon analizi yapılırken fark edilirdi.
PACKAGE_EVENT_TYPES: tuple[str, ...] = (
    "OPEN",
    "SCAN",
    "UNDO_SCAN",
    "COMPLETE",
    "HANDOVER",
    "DELIVER",
    "RETURN_PENDING",
    "RETURN_IN",
    "REPACK",
    "VOID",
    "UNPACK",
)

#: Tarama sonucu sözlüğü (sözleşme §6 — hepsi 200 + `result` ile döner).
SCAN_RESULTS: tuple[str, ...] = (
    "OK",
    "OK_MANUAL",
    "WRONG_SKU",
    "OVER_QTY",
    "ALREADY_COMPLETE",
    "UNSCANNABLE",
)

#: QR token'ının bit uzunluğu. `secrets.token_urlsafe(24)` ≈ 32 karakter,
#: 192 bit entropi — basılı etiket paketin ömrü boyunca geçerli olduğu için
#: (sözleşme §3.3) tahmin edilebilir olmamalıdır. Sıralı `id` tek başına ASLA
#: QR yükü değildir; yük `PKG1:{id}:{token}` biçimindedir.
QR_TOKEN_BYTES = 24


def _sql_list(degerler) -> str:
    return ", ".join(f"'{d}'" for d in degerler)


def new_qr_token() -> str:
    """Yeni paket QR token'ı. Saf yardımcı — DB'ye dokunmaz."""
    return secrets.token_urlsafe(QR_TOKEN_BYTES)


class OrderPackage(Base, TimestampMixin):
    """Bir siparişin fiziksel paketi: kimlik + FSM durumu + aktör/zaman damgaları.

    Soft-delete **yoktur**: paket fiziksel bir izdir, "silinmiş paket" diye bir
    fiziksel gerçek yoktur. Vazgeçilen paketin karşılığı `VOID`'dir ve fiziksel
    olarak bozulması ayrı bir damgadır (`unpacked_at`).
    """

    __tablename__ = "order_packages"

    id: Mapped[int] = mapped_column(primary_key=True)
    # CASCADE: paket siparişin bir parçasıdır, onsuz anlamı yoktur. Üretimde
    # sipariş soft-delete edilir, yani bu yol pratikte tetiklenmez; tetiklendiği
    # anda da olay izi (`package_scan_events.package_id` → RESTRICT) silinmeye
    # DİRENİR, yani geçmiş sessizce kaybolamaz.
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    #: Sipariş içindeki sıra (1, 2, 3…). `VOID` sonrası açılan ikinci paket
    #: 2 alır; etikette ve operasyon konuşmasında "2. paket" budur.
    package_no: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1")
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'OPEN'")
    )
    #: Kalıcı QR token'ı (sözleşme §3.3). Durağa değil PAKETE aittir; tur
    #: iptali/durak silme onu geçersizleştirmez. Yalnız paket terminal olunca ölür.
    qr_token: Mapped[str] = mapped_column(
        String(64), nullable=False, default=new_qr_token
    )
    #: Paket açılırken siparişin kalem listesinin sha256 özeti — `complete`
    #: sırasında liste değişmişse STALE tespiti için.
    items_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)

    # ── Aktör + zaman damgaları ──
    # RESTRICT: admin hesapları soft-delete edilir, bu yüzden pratikte hiç
    # tetiklenmez; niyeti belgeler — bir paketleme kararı aktörünü kaybedemez.
    packed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    packed_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=True
    )
    handed_over_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # SET NULL: kurye profili silinebilir (işten ayrılma). Zimmetin KİM
    # tarafından yapıldığı bilgisi `handed_over_by_actor` metninde kalır, bu
    # yüzden FK'nin boşalması izi yok etmez. Bu sebeple hiçbir CHECK bu kolonun
    # doluluğuna dayanmaz — zaman damgalarına dayanır.
    handed_to_courier_id: Mapped[int | None] = mapped_column(
        ForeignKey("couriers.id", ondelete="SET NULL"), nullable=True
    )
    #: "courier:12" / "admin:3" — zimmeti yapan aktörün metin izi.
    handed_over_by_actor: Mapped[str | None] = mapped_column(String(60), nullable=True)
    delivered_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    returned_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    returned_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=True
    )
    return_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    void_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    void_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=True
    )
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Paketin fiziksel olarak bozulduğu an. "Bozulmayı bekleyen paketler"
    #: kuyruğu = `status='VOID' AND unpacked_at IS NULL` (sözleşme §3.5, G8).
    unpacked_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    unpacked_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="RESTRICT"), nullable=True
    )

    items: Mapped[list["OrderPackageItem"]] = relationship(
        back_populates="package",
        cascade="all, delete-orphan",
        order_by="OrderPackageItem.id",
    )

    __table_args__ = (
        CheckConstraint(
            f"status IN ({_sql_list(PACKAGE_STATUSES)})",
            name="ck_order_packages_status",
        ),
        CheckConstraint("package_no > 0", name="ck_order_packages_no_sign"),
        # Zaman damgası ↔ durum tutarlılığı. Fiziksel bir olayın gerçekleştiğini
        # söyleyen durum, o olayın ZAMANI olmadan yazılamaz — aksi hâlde
        # "kuryede" diyen ama ne zaman verildiği bilinmeyen paket üretilirdi.
        CheckConstraint(
            "status NOT IN ('PACKED','HANDED_OVER','RETURN_PENDING','RETURNED',"
            "'DELIVERED') OR packed_at IS NOT NULL",
            name="ck_order_packages_packed_at",
        ),
        CheckConstraint(
            "status NOT IN ('HANDED_OVER','RETURN_PENDING','DELIVERED') "
            "OR handed_over_at IS NOT NULL",
            name="ck_order_packages_handover_at",
        ),
        CheckConstraint(
            "status <> 'DELIVERED' OR delivered_at IS NOT NULL",
            name="ck_order_packages_delivered_at",
        ),
        CheckConstraint(
            "status <> 'RETURNED' OR returned_at IS NOT NULL",
            name="ck_order_packages_returned_at",
        ),
        # VOID bir karardır: gerekçesiz yazılamaz (sözleşme §6).
        CheckConstraint(
            "status <> 'VOID' OR (void_at IS NOT NULL "
            "AND void_reason IS NOT NULL AND length(btrim(void_reason)) > 0)",
            name="ck_order_packages_void",
        ),
        # Fiziksel bozma yalnız VOID pakette anlamlıdır.
        CheckConstraint(
            "unpacked_at IS NULL OR status = 'VOID'",
            name="ck_order_packages_unpacked_void",
        ),
        # ── Yarış otoritesi + tekillik ──
        Index("uq_order_packages_qr_token", "qr_token", unique=True),
        # Bir siparişin aynı anda TEK canlı paketi olur. Servisteki kontrol
        # UX içindir; iki eşzamanlı "Paketle" isteğinde son sözü bu index söyler.
        Index(
            "uq_order_packages_live",
            "order_id",
            unique=True,
            postgresql_where=text(LIVE_PACKAGE_SQL),
        ),
        UniqueConstraint("order_id", "package_no", name="uq_order_packages_no"),
        Index("ix_order_packages_status", "status", text("created_at DESC")),
        # Geri dönüş kuyruğu (§3.5): kuryede kalan paketler, en eskisi başta —
        # "kaç gündür bekliyor" sorusunun sorgusu bu kısmi index'te kalır.
        Index(
            "ix_order_packages_return_queue",
            "handed_over_at",
            postgresql_where=text("status = 'RETURN_PENDING'"),
        ),
        # "Bozulmayı bekleyen paketler" kuyruğu (G8).
        Index(
            "ix_order_packages_unpack_queue",
            "void_at",
            postgresql_where=text("status = 'VOID' AND unpacked_at IS NULL"),
        ),
    )


class OrderPackageItem(Base, TimestampMixin):
    """Paket satırı: beklenen/taranan adet + SKU/barkod **snapshot'ı**.

    Snapshot neden burada (sözleşme §3.6): `OrderItem` mali snapshot'tır
    (fatura tutarlılığı) ve geçmiş yüz binlerce satırı geriye dönük
    dolduramayız — dolduramadığımız satır yalancı güven üretir. Paket satırı
    ise paket açılırken doğar, o anki üründen okunur ve bir daha değişmez:
    ürün sonradan yeniden adlandırılsa/silinse de paketin neyi beklediği
    kaybolmaz.

    `product_id IS NULL` (ürün kataloğdan silinmiş) satırda `sku`/`barcode` da
    NULL'dır; bu satır **taranamaz** ve yalnız gerekçeli manuel doğrulamayla
    kapanır.
    """

    __tablename__ = "order_package_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    package_id: Mapped[int] = mapped_column(
        ForeignKey("order_packages.id", ondelete="CASCADE"), nullable=False
    )
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False
    )
    # SET NULL: `order_items.product_id` ile aynı davranış. Snapshot alanları
    # (sku/barcode/title) yerinde kalır, satır yalnız TARANAMAZ hâle gelir.
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    sku: Mapped[str | None] = mapped_column(String(20), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    title: Mapped[str] = mapped_column(String(250), nullable=False)
    expected_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    scanned_qty: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    package: Mapped["OrderPackage"] = relationship(back_populates="items")

    __table_args__ = (
        # Aynı sipariş kalemi bir pakette İKİ satır üretemez. (Bir sipariş = bir
        # paket varsayımı gereği kalem bölünmesi V1 kapsamı dışıdır — sözleşme
        # §4.2; bölünme geldiğinde bu kısıt bilinçli olarak gevşetilecektir.)
        UniqueConstraint(
            "package_id", "order_item_id", name="uq_order_package_items_line"
        ),
        CheckConstraint("expected_qty > 0", name="ck_order_package_items_expected"),
        # Fazla adet UYGULAMADA reddedilir; burada DB de reddeder. Tek katmanlı
        # koruma koruma değildir (sözleşme §4.1/2).
        CheckConstraint(
            "scanned_qty >= 0 AND scanned_qty <= expected_qty",
            name="ck_order_package_items_scanned",
        ),
        # Taranamaz satır: ürün silinmişse kod da yoktur. Ters yön serbest —
        # ürünü duran ama barkodu girilmemiş kalem normaldir.
        CheckConstraint(
            "product_id IS NOT NULL OR (sku IS NULL AND barcode IS NULL)",
            name="ck_order_package_items_scannable",
        ),
        Index("ix_order_package_items_package", "package_id", "id"),
    )


class PackageScanEvent(Base):
    """Paket yaşam döngüsünün **append-only** izi: tarama + durum geçişleri.

    F29'un duruşu sürdürülür (`stock_count_line_events`, `stock_damage_events`):
    UPDATE ve DELETE veritabanı trigger'ıyla reddedilir — gizlenebilen bir iz,
    iz değildir. `TimestampMixin` bilinçli olarak KULLANILMAZ: `updated_at`
    kolonu, hiçbir zaman güncellenmeyecek bir tabloda yanlış bir söz verir.

    ## `audit_logs` ile ilişkisi — ikisi de gerekli

    `audit_logs` **admin aksiyonunu** kaydeder (kim, neden, öncesi/sonrası) ve
    gürültüden korunmalıdır: sıradan başarılı tarama oraya yazılmaz. Bu tablo
    ise **operasyonel gerçeği** kaydeder — reddedilen taramalar dahil, çünkü
    "hangi rafta yanlış kitap duruyor" sorusunun cevabı tam da o redlerdedir.
    Aktör her zaman admin değildir (zimmeti kurye yapar), bu yüzden aktör
    `audit_logs` deseniyle aynı biçimde **(actor_role, actor_id)** çiftidir;
    tekil bir `admins.id` FK'si kuryeyi dışarıda bırakırdı.
    """

    __tablename__ = "package_scan_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    # RESTRICT (paket CASCADE değil): geçmiş iz, paketin ya da siparişin
    # silinmesiyle SESSİZCE yok olamaz. Silme girişimi FK ile açıkça reddedilir.
    package_id: Mapped[int] = mapped_column(
        ForeignKey("order_packages.id", ondelete="RESTRICT"), nullable=False
    )
    #: Reddedilen taramada (WRONG_SKU) satır yoktur → NULL.
    package_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("order_package_items.id", ondelete="RESTRICT"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    #: Yalnız tarama olaylarında dolu.
    result: Mapped[str | None] = mapped_column(String(16), nullable=True)
    code_scanned: Mapped[str | None] = mapped_column(String(64), nullable=True)
    qty_delta: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    from_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: `OK_MANUAL`'da ZORUNLU (DB CHECK) — kaçış kapısı akışın içindedir ama
    #: gerekçesiz değildir.
    manual_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    #: 1=ADMIN, 5=COURIER (`role_id`). Sistem kaynaklı olayda (sipariş iptali
    #: kancası) ikisi de NULL'dır.
    actor_role: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Ek bağlam. "metadata" adı SQLAlchemy'de rezerve; kolon adı `meta` kalır.
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        CheckConstraint(
            f"event_type IN ({_sql_list(PACKAGE_EVENT_TYPES)})",
            name="ck_package_scan_events_type",
        ),
        CheckConstraint(
            f"result IS NULL OR result IN ({_sql_list(SCAN_RESULTS)})",
            name="ck_package_scan_events_result",
        ),
        # Tarama olayı sonuçsuz yazılamaz; sonuçsuz tarama izi "ne oldu"
        # sorusunu cevaplamaz.
        CheckConstraint(
            "event_type NOT IN ('SCAN','UNDO_SCAN') OR result IS NOT NULL",
            name="ck_package_scan_events_scan_result",
        ),
        CheckConstraint(
            "result <> 'OK_MANUAL' OR (manual_reason IS NOT NULL "
            "AND length(btrim(manual_reason)) > 0)",
            name="ck_package_scan_events_manual_reason",
        ),
        CheckConstraint(
            f"from_status IS NULL OR from_status IN ({_sql_list(PACKAGE_STATUSES)})",
            name="ck_package_scan_events_from_status",
        ),
        CheckConstraint(
            f"to_status IS NULL OR to_status IN ({_sql_list(PACKAGE_STATUSES)})",
            name="ck_package_scan_events_to_status",
        ),
        # Yarım aktör kaydı yoktur: ya ikisi de var ya hiçbiri (sistem olayı).
        CheckConstraint(
            "(actor_id IS NULL) = (actor_role IS NULL)",
            name="ck_package_scan_events_actor",
        ),
        Index("ix_package_scan_events_package", "package_id", "id"),
        # Aynı anahtarla gelen tekrar isteği ikinci bir olay YAZAMAZ (F29
        # `uq_stock_movements_idem` deseni). Kısmi: anahtarsız olaylar
        # (sistem kancaları) index'te yer kaplamaz.
        Index(
            "uq_package_scan_idem",
            "package_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )
