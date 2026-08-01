"""F30 — paketleme semasi: order_packages, order_package_items, package_scan_events

Revision ID: f30_paketleme_semasi
Revises: f29c_damage_idem_actor_scope
Create Date: 2026-08-01

Ayrintili gerekce: docs/f30-paketleme-sozlesmesi.md (§3, §5, §6).

## Uc tablo, uc ayri is

* `order_packages`       — paketin kimligi, FSM durumu, kalici QR token'i,
                           aktor + zaman damgalari
* `order_package_items`  — paket satiri: beklenen/taranan adet + SKU/barkod
                           SNAPSHOT'i (OrderItem'a kolon EKLENMEZ, §3.6)
* `package_scan_events`  — append-only iz: taramalar (RED DAHIL) + durum
                           gecisleri

## Yeni siparis durumu YOK

`OrderStatus`'e `PACKED`/`PREPARED` eklenmez (§3.2). Sebep koddan: yeni bir ara
statu `reserved_on_premise` formulunu (yalniz `status='PAID'` sayar),
`ix_orders_fulfillment_queue` kismi index'ini ve dort kuyruk sorgusunu birden
SESSIZCE bozardi. Paket FSM'i ayri yasar.

## Stok defteri genisletilmez

Yeni `StockMovementType` yok, yeni `PHYSICAL_EFFECT` girdisi yok,
`products.stock` / `damaged_stock`'a dokunulmaz. Paketleme fiziksel bir
konum/dogrulama olayidir; `SALE` odemede zaten yazilmistir.

## Kismi index'ler = yaris otoritesi

    uq_order_packages_live : (order_id) WHERE status NOT IN ('DELIVERED','VOID')

"Bir siparisin ayni anda TEK canli paketi olur" garantisinin veritabanindaki
yeri budur. Yuklemin tek dogruluk kaynagi `models/packing.py::LIVE_PACKAGE_SQL`
sabitidir; bu dosya onu METIN olarak tekrar eder (migration'lar calisma
zamaninda modele bagli olmamalidir — model degistiginde gecmis migration'in
uygulanmis semasi degismemelidir). Ikisinin ayrismasi `alembic check` ile
yakalanir.

    uq_package_scan_idem   : (package_id, idempotency_key) WHERE key IS NOT NULL

F29 `uq_stock_movements_idem` deseni: ayni anahtarla gelen tekrar istegi ikinci
bir olay yazamaz.

## Append-only iz

`package_scan_events` UPDATE/DELETE trigger'iyla reddedilir — F29'un
`stock_count_line_events` / `stock_damage_events` durusuyla ayni. Fonksiyon
BILINCLI olarak F29'un `inventory_append_only()`'sinden ayri yazildi
(`packing_append_only()`): downgrade'in F29'a ait bir nesneyi silmesi ya da
silmemeye guvenmesi gerekmesin. TRUNCATE engellenmiyor — ORM'den erisilemez ve
tablo sahibi gerektirir (F29 ile ayni bilincli karar).

`package_scan_events.package_id` FK'si CASCADE DEGIL **RESTRICT**'tir: gecmis
iz, paketin ya da siparisin silinmesiyle sessizce yok olamaz. Testler bu yuzden
paketleri `tests/integration/db_guard.py::purge_packages` ile temizler (trigger
YALNIZ test veritabaninda, yalniz o islem icin gecici kapatilir).

## Izinler

`packing.view` / `packing.pack` / `packing.manage` katalog (`core/
admin_permissions.py`) ile AYNI commit'te DB'ye yazilir (§7 S6): katalog + DB +
rol ucgeninden biri eksikse izin ise yaramaz ve hata SESSIZ olur (403 + gizli
menu). Rol dagitimi F29'un gerekcesiyle ayni: paketleme bir TICARET
operasyonudur; operasyon yoneticisi depoda paketler ama paketi cozme / geri
donus onaylama (`packing.manage`) yetkisi ticaret yoneticisinde ve super
admin'de kalir.

## Downgrade

Paket kaydi VARSA downgrade acikca REDDEDILIR. Sebep F29 ile ayni: iz tablosu
append-only'dir ve tablo drop'u o izi sessizce yok ederdi — "paketi kim, ne
zaman, hangi kodla dogruladi" sorusu bir daha cevaplanamaz. Hicbir paket yoksa
sema temiz sekilde geri doner (upgrade → downgrade → upgrade dogrulandi).

Mevcut veriye uygulanabilirlik: uc tablo da YENIDIR, hicbir mevcut tabloya
kolon eklenmez ve hicbir mevcut satir okunmaz/yazilmaz. Bu yuzden backfill
gerekmez ve upgrade dolu bir uretim veritabaninda da anlik calisir. Yeni NOT
NULL kolonlarin tamami yeni tablolardadir.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f30_paketleme_semasi"
down_revision: Union[str, Sequence[str], None] = "f29c_damage_idem_actor_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: Paket FSM'inin butun durumlari (`models/packing.py::PACKAGE_STATUSES`).
_STATUSES = (
    "OPEN",
    "PACKED",
    "HANDED_OVER",
    "RETURN_PENDING",
    "RETURNED",
    "DELIVERED",
    "VOID",
)
_EVENT_TYPES = (
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
_RESULTS = (
    "OK",
    "OK_MANUAL",
    "WRONG_SKU",
    "OVER_QTY",
    "ALREADY_COMPLETE",
    "UNSCANNABLE",
)

#: "Canli paket" yuklemi — kismi unique index'in predicate'i.
_LIVE = "status NOT IN ('DELIVERED', 'VOID')"

_APPEND_ONLY_TABLES = ("package_scan_events",)


def _liste(kodlar) -> str:
    return ", ".join(f"'{k}'" for k in kodlar)


NEW_PERMISSIONS = [
    ("packing.view", "Paketleme kuyruğu ve paket görüntüleme", "Ticaret"),
    ("packing.pack", "Paket açma, kalem tarama ve tamamlama", "Ticaret"),
    ("packing.manage", "Paket çözme ve geri dönüş yönetimi", "Ticaret"),
]

#: Gorev ayriligi: paketi TOPLAYAN kisi onu tek basina COZEMEZ.
ROLE_GRANTS = {
    "SUPER_ADMIN": ["packing.view", "packing.pack", "packing.manage"],
    "COMMERCE_MANAGER": ["packing.view", "packing.pack", "packing.manage"],
    "OPERATIONS_MANAGER": ["packing.view", "packing.pack"],
}


def _izinleri_ekle() -> None:
    for code, name, group in NEW_PERMISSIONS:
        op.execute(
            sa.text(
                """
                INSERT INTO admin_permissions (code, name, "group")
                SELECT :code, :name, :grp
                WHERE NOT EXISTS (
                    SELECT 1 FROM admin_permissions
                    WHERE code = :code AND deleted_at IS NULL
                )
                """
            ).bindparams(code=code, name=name, grp=group)
        )
    for role_code, codes in ROLE_GRANTS.items():
        op.execute(
            sa.text(
                f"""
                INSERT INTO admin_role_permissions (admin_role_id, permission_id)
                SELECT r.id, p.id
                FROM admin_roles r
                CROSS JOIN admin_permissions p
                WHERE r.code = :rol
                  AND r.deleted_at IS NULL
                  AND p.code IN ({_liste(codes)})
                  AND p.deleted_at IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM admin_role_permissions rp
                      WHERE rp.admin_role_id = r.id
                        AND rp.permission_id = p.id
                        AND rp.deleted_at IS NULL
                  )
                """
            ).bindparams(rol=role_code)
        )


def _izinleri_kaldir() -> None:
    kodlar = _liste(c for c, _n, _g in NEW_PERMISSIONS)
    op.execute(
        f"""
        DELETE FROM admin_role_permissions
        WHERE permission_id IN (
            SELECT id FROM admin_permissions WHERE code IN ({kodlar})
        )
        """
    )
    op.execute(f"DELETE FROM admin_permissions WHERE code IN ({kodlar})")


def upgrade() -> None:
    # ══ 1. Paket ══
    op.create_table(
        "order_packages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column(
            "package_no", sa.Integer(), server_default=sa.text("1"), nullable=False
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'OPEN'"),
            nullable=False,
        ),
        sa.Column("qr_token", sa.String(length=64), nullable=False),
        sa.Column("items_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("packed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("packed_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("handed_over_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("handed_to_courier_id", sa.Integer(), nullable=True),
        sa.Column("handed_over_by_actor", sa.String(length=60), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("returned_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("return_note", sa.Text(), nullable=True),
        sa.Column("void_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("void_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("unpacked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unpacked_by_admin_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        # Paket siparisin bir parcasidir (CASCADE); ama izi RESTRICT'lidir, yani
        # olay kaydi olan bir paket zinciri sessizce silinemez.
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["packed_by_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        # Kurye profili silinebilir; zimmet aktorunun metin izi
        # (`handed_over_by_actor`) kaldigi icin SET NULL iz kaybettirmez.
        sa.ForeignKeyConstraint(
            ["handed_to_courier_id"], ["couriers.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["returned_by_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["void_by_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["unpacked_by_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint("order_id", "package_no", name="uq_order_packages_no"),
        sa.CheckConstraint(
            f"status IN ({_liste(_STATUSES)})", name="ck_order_packages_status"
        ),
        sa.CheckConstraint("package_no > 0", name="ck_order_packages_no_sign"),
        # Fiziksel bir olayin gerceklestigini soyleyen durum, o olayin ZAMANI
        # olmadan yazilamaz.
        sa.CheckConstraint(
            "status NOT IN ('PACKED','HANDED_OVER','RETURN_PENDING','RETURNED',"
            "'DELIVERED') OR packed_at IS NOT NULL",
            name="ck_order_packages_packed_at",
        ),
        sa.CheckConstraint(
            "status NOT IN ('HANDED_OVER','RETURN_PENDING','DELIVERED') "
            "OR handed_over_at IS NOT NULL",
            name="ck_order_packages_handover_at",
        ),
        sa.CheckConstraint(
            "status <> 'DELIVERED' OR delivered_at IS NOT NULL",
            name="ck_order_packages_delivered_at",
        ),
        sa.CheckConstraint(
            "status <> 'RETURNED' OR returned_at IS NOT NULL",
            name="ck_order_packages_returned_at",
        ),
        sa.CheckConstraint(
            "status <> 'VOID' OR (void_at IS NOT NULL "
            "AND void_reason IS NOT NULL AND length(btrim(void_reason)) > 0)",
            name="ck_order_packages_void",
        ),
        sa.CheckConstraint(
            "unpacked_at IS NULL OR status = 'VOID'",
            name="ck_order_packages_unpacked_void",
        ),
    )
    op.create_index(
        "uq_order_packages_qr_token", "order_packages", ["qr_token"], unique=True
    )
    op.create_index(
        "uq_order_packages_live",
        "order_packages",
        ["order_id"],
        unique=True,
        postgresql_where=sa.text(_LIVE),
    )
    op.create_index(
        "ix_order_packages_status",
        "order_packages",
        ["status", sa.literal_column("created_at DESC")],
    )
    op.create_index(
        "ix_order_packages_return_queue",
        "order_packages",
        ["handed_over_at"],
        postgresql_where=sa.text("status = 'RETURN_PENDING'"),
    )
    op.create_index(
        "ix_order_packages_unpack_queue",
        "order_packages",
        ["void_at"],
        postgresql_where=sa.text("status = 'VOID' AND unpacked_at IS NULL"),
    )

    # ══ 2. Paket satiri (SKU/barkod snapshot'i) ══
    op.create_table(
        "order_package_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("package_id", sa.Integer(), nullable=False),
        sa.Column("order_item_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=True),
        sa.Column("sku", sa.String(length=20), nullable=True),
        sa.Column("barcode", sa.String(length=32), nullable=True),
        sa.Column("title", sa.String(length=250), nullable=False),
        sa.Column("expected_qty", sa.Integer(), nullable=False),
        sa.Column(
            "scanned_qty", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["package_id"], ["order_packages.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["order_item_id"], ["order_items.id"], ondelete="CASCADE"
        ),
        # `order_items.product_id` ile ayni davranis: urun silinince snapshot
        # yerinde kalir, satir yalniz TARANAMAZ olur.
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "package_id", "order_item_id", name="uq_order_package_items_line"
        ),
        sa.CheckConstraint("expected_qty > 0", name="ck_order_package_items_expected"),
        # Fazla adet uygulamada reddedilir; burada DB de reddeder.
        sa.CheckConstraint(
            "scanned_qty >= 0 AND scanned_qty <= expected_qty",
            name="ck_order_package_items_scanned",
        ),
        sa.CheckConstraint(
            "product_id IS NOT NULL OR (sku IS NULL AND barcode IS NULL)",
            name="ck_order_package_items_scannable",
        ),
    )
    op.create_index(
        "ix_order_package_items_package", "order_package_items", ["package_id", "id"]
    )

    # ══ 3. Append-only olay izi ══
    op.create_table(
        "package_scan_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("package_id", sa.Integer(), nullable=False),
        sa.Column("package_item_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("result", sa.String(length=16), nullable=True),
        sa.Column("code_scanned", sa.String(length=64), nullable=True),
        sa.Column(
            "qty_delta", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column("from_status", sa.String(length=16), nullable=True),
        sa.Column("to_status", sa.String(length=16), nullable=True),
        sa.Column("manual_reason", sa.String(length=200), nullable=True),
        sa.Column("actor_role", sa.SmallInteger(), nullable=True),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("idempotency_key", sa.String(length=80), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        # RESTRICT: iz, paketin/siparisin silinmesiyle sessizce yok olamaz.
        sa.ForeignKeyConstraint(
            ["package_id"], ["order_packages.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["package_item_id"], ["order_package_items.id"], ondelete="RESTRICT"
        ),
        sa.CheckConstraint(
            f"event_type IN ({_liste(_EVENT_TYPES)})",
            name="ck_package_scan_events_type",
        ),
        sa.CheckConstraint(
            f"result IS NULL OR result IN ({_liste(_RESULTS)})",
            name="ck_package_scan_events_result",
        ),
        sa.CheckConstraint(
            "event_type NOT IN ('SCAN','UNDO_SCAN') OR result IS NOT NULL",
            name="ck_package_scan_events_scan_result",
        ),
        sa.CheckConstraint(
            "result <> 'OK_MANUAL' OR (manual_reason IS NOT NULL "
            "AND length(btrim(manual_reason)) > 0)",
            name="ck_package_scan_events_manual_reason",
        ),
        sa.CheckConstraint(
            f"from_status IS NULL OR from_status IN ({_liste(_STATUSES)})",
            name="ck_package_scan_events_from_status",
        ),
        sa.CheckConstraint(
            f"to_status IS NULL OR to_status IN ({_liste(_STATUSES)})",
            name="ck_package_scan_events_to_status",
        ),
        sa.CheckConstraint(
            "(actor_id IS NULL) = (actor_role IS NULL)",
            name="ck_package_scan_events_actor",
        ),
    )
    op.create_index(
        "ix_package_scan_events_package", "package_scan_events", ["package_id", "id"]
    )
    op.create_index(
        "uq_package_scan_idem",
        "package_scan_events",
        ["package_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )

    # ══ 4. Append-only trigger'lari ══
    op.execute(
        """
        CREATE FUNCTION packing_append_only() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION '% append-only tablodur: % reddedildi',
            TG_TABLE_NAME, TG_OP;
        END; $$ LANGUAGE plpgsql
        """
    )
    for tablo in _APPEND_ONLY_TABLES:
        for islem in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER trg_{tablo}_no_{islem.lower()} "
                f"BEFORE {islem} ON {tablo} "
                "FOR EACH ROW EXECUTE FUNCTION packing_append_only()"
            )

    # ══ 5. Izinler ══
    _izinleri_ekle()


def _downgrade_engeli() -> None:
    """Geri alinmasi IZ KAYBI olacak durum varsa acikca durdurur."""
    conn = op.get_bind()
    engeller: list[str] = []
    for tablo in ("package_scan_events", "order_package_items", "order_packages"):
        n = conn.execute(sa.text(f"SELECT count(*) FROM {tablo}")).scalar_one()
        if n:
            engeller.append(f"{tablo} tablosunda {n} kayit")
    if engeller:
        raise RuntimeError(
            "f30_paketleme_semasi geri alinamaz — su veriler kaybolurdu: "
            + "; ".join(engeller)
            + ". Paket olay izi append-only'dir; tablo drop'u 'paketi kim, ne "
            "zaman, hangi kodla dogruladi' sorusunu cevapsiz birakirdi. Geri "
            "alma KOD seviyesinde yapilmali, sema yerinde kalmalidir."
        )


def downgrade() -> None:
    _downgrade_engeli()

    _izinleri_kaldir()

    for tablo in _APPEND_ONLY_TABLES:
        for islem in ("update", "delete"):
            op.execute(f"DROP TRIGGER IF EXISTS trg_{tablo}_no_{islem} ON {tablo}")
    op.execute("DROP FUNCTION IF EXISTS packing_append_only()")

    op.drop_index(
        "uq_package_scan_idem",
        table_name="package_scan_events",
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )
    op.drop_index("ix_package_scan_events_package", table_name="package_scan_events")
    op.drop_table("package_scan_events")

    op.drop_index("ix_order_package_items_package", table_name="order_package_items")
    op.drop_table("order_package_items")

    op.drop_index(
        "ix_order_packages_unpack_queue",
        table_name="order_packages",
        postgresql_where=sa.text("status = 'VOID' AND unpacked_at IS NULL"),
    )
    op.drop_index(
        "ix_order_packages_return_queue",
        table_name="order_packages",
        postgresql_where=sa.text("status = 'RETURN_PENDING'"),
    )
    op.drop_index("ix_order_packages_status", table_name="order_packages")
    op.drop_index(
        "uq_order_packages_live",
        table_name="order_packages",
        postgresql_where=sa.text(_LIVE),
    )
    op.drop_index("uq_order_packages_qr_token", table_name="order_packages")
    op.drop_table("order_packages")
