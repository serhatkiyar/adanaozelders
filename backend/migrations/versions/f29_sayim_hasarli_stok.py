"""F29 — stok sayimi, duzeltme ve hasarli stok semasi

Revision ID: f29_sayim_hasarli_stok
Revises: tb1_order_returns_reason_default
Create Date: 2026-07-31

Ayrintili gerekce: docs/arsiv/stok/f29-sayim-hasarli-stok-plani.md

## Sira kritiktir

1. `products.damaged_stock` (nullable) -> backfill -> CHECK'ler -> pairing trigger
2. `stock_movements.bucket` (nullable) -> 'SALEABLE' backfill -> NOT NULL -> CHECK'ler
3. Yeni turler icin `ck_stock_movements_type` yeniden yaratilir
4. Yeni tablolar + index'ler + append-only / turetme trigger'lari
5. Izin katalogu (idempotent) + rol dagitimi

Trigger'lar backfill'den SONRA kurulur: `products_damaged_pairing` backfill'in
kendi UPDATE'ini bozmazdi ama ayni disiplin (stok defteri migration'i) burada da
korunuyor.

## Sifir OPENING_BALANCE uretilmez

Hasarli kova bos dogar. `damaged_stock = 0` + hic hareket olmamasi GECERLI bir
durumdur; deftere anlamsiz sifir satiri yazmak zincirin okunurlugunu bozardi.

## Downgrade

Yeni turde hareket, DAMAGED kovada hareket, sifirdan farkli `damaged_stock` veya
herhangi bir sayim/hasar kaydi varsa downgrade **acikca reddedilir**. Defter
append-only oldugu icin bu satirlar silinemez; sessizce kirik sema birakmaktansa
durmak dogru davranistir. Hicbiri yoksa 5->1 ters sirayla temiz doner.

## Uretim rollback stratejisi

Uygulanmis sayim farklari GERCEK envanter olaylaridir; veri geri alinmaz. Geri
alma yalniz kod seviyesinde yapilir. Eski kod `bucket`/`damaged_stock`
kolonlarini hic okumadigi icin bozulmaz -> dagitim sirasi "once migration, sonra
kod" olmak zorundadir.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f29_sayim_hasarli_stok"
down_revision: Union[str, Sequence[str], None] = "tb1_order_returns_reason_default"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: Defterin bugunku alti turu + F29'un bes yeni turu.
_MOVEMENT_TYPES_OLD = (
    "OPENING_BALANCE",
    "INITIAL",
    "SALE",
    "SALE_CANCEL",
    "RETURN",
    "ADMIN_ADJUSTMENT",
)
_MOVEMENT_TYPES_NEW = (
    "COUNT_ADJUSTMENT",
    "DAMAGE_TRANSFER",
    "DAMAGE_RECOVERY",
    "DAMAGE_DISPOSAL",
    "SUPPLIER_RETURN",
)


def _liste(kodlar) -> str:
    return ", ".join(f"'{k}'" for k in kodlar)


NEW_PERMISSIONS = [
    ("inventory.view", "Envanter ve sayım görüntüleme", "Ticaret"),
    ("inventory.count", "Sayım oturumu açma ve miktar girme", "Ticaret"),
    ("inventory.apply", "Sayım farkı uygulama ve hasar işlemi", "Ticaret"),
]

#: Envanter ticaret operasyonudur. OPERATIONS_MANAGER gorur ama degistiremez —
#: sayim ve fark uygulama ticaret yoneticisinin (ve super admin'in) isidir.
ROLE_GRANTS = {
    "SUPER_ADMIN": ["inventory.view", "inventory.count", "inventory.apply"],
    "COMMERCE_MANAGER": ["inventory.view", "inventory.count", "inventory.apply"],
    "OPERATIONS_MANAGER": ["inventory.view"],
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
    # ══ 1. products.damaged_stock ══
    op.add_column(
        "products", sa.Column("damaged_stock", sa.Integer(), nullable=True)
    )
    # Takip edilen her urun sifir hasarli ile baslar; takip edilmeyen (dijital)
    # urun NULL kalir — "takip edilmiyor" ile "sifir hasarli" ayri gerceklerdir.
    op.execute("UPDATE products SET damaged_stock = 0 WHERE stock IS NOT NULL")
    op.create_check_constraint(
        "ck_products_damaged_pairing",
        "products",
        "(stock IS NULL) = (damaged_stock IS NULL)",
    )
    op.create_check_constraint(
        "ck_products_damaged_sign",
        "products",
        "damaged_stock IS NULL OR damaged_stock >= 0",
    )

    # ══ 2. stock_movements.bucket ══
    #
    # DIKKAT — "nullable ekle, UPDATE ile backfill et, sonra NOT NULL yap"
    # standart deseni BU TABLODA CALISMAZ: `stock_movements` append-only'dir ve
    # `trg_stock_movements_no_update` migration'in KENDI backfill UPDATE'ini de
    # reddeder (prova sirasinda gercek hatayla yakalandi). Trigger'i gecici
    # kapatmak, defterin degistirilemezlik sozunu uretim migration'i icinde
    # delmek olurdu.
    #
    # Dogrusu: kolonu DOGRUDAN varsayilanla eklemek. PostgreSQL 11+ mevcut
    # satirlari tablo yeniden yazmadan ve SATIR TRIGGER'I CALISTIRMADAN
    # doldurur — backfill DDL'in kendi isidir. Deger bir tahmin degil: defterin
    # bugune kadarki tamami satilabilir kovanin hareketleridir.
    op.add_column(
        "stock_movements",
        sa.Column(
            "bucket",
            sa.String(length=10),
            nullable=False,
            server_default=sa.text("'SALEABLE'"),
        ),
    )
    op.create_check_constraint(
        "ck_stock_movements_bucket", "stock_movements", "bucket IN ('SALEABLE','DAMAGED')"
    )
    op.create_check_constraint(
        "ck_stock_movements_bucket_type",
        "stock_movements",
        "bucket = 'SALEABLE' OR movement_type IN ("
        f"{_liste(_MOVEMENT_TYPES_NEW)}, 'OPENING_BALANCE')",
    )

    # ══ 3. Tur ve referans CHECK'leri yeniden ══
    op.drop_constraint("ck_stock_movements_type", "stock_movements", type_="check")
    op.create_check_constraint(
        "ck_stock_movements_type",
        "stock_movements",
        f"movement_type IN ({_liste(_MOVEMENT_TYPES_OLD + _MOVEMENT_TYPES_NEW)})",
    )
    op.drop_constraint("ck_stock_movements_ref", "stock_movements", type_="check")
    op.create_check_constraint(
        "ck_stock_movements_ref",
        "stock_movements",
        "movement_type NOT IN ('SALE','SALE_CANCEL','RETURN', "
        f"{_liste(_MOVEMENT_TYPES_NEW)}) "
        "OR (ref_type IS NOT NULL AND ref_id IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_stock_movements_count_reason",
        "stock_movements",
        "movement_type <> 'COUNT_ADJUSTMENT' OR reason_code IN "
        "('SAYIM_FAZLA','SAYIM_EKSIK')",
    )
    op.create_check_constraint(
        "ck_stock_movements_damage_reason",
        "stock_movements",
        f"movement_type NOT IN ({_liste(_MOVEMENT_TYPES_NEW[1:])}) OR reason_code IN "
        "('KIRIK','ISLAK','BASKI_HATASI','MUSTERI_IADESI_HASARLI','DIGER')",
    )

    # ══ 4. Zincir index'i kova boyutunu kazanir ══
    op.drop_index("ix_stock_movements_product", table_name="stock_movements")
    op.create_index(
        "ix_stock_movements_product",
        "stock_movements",
        ["product_id", "bucket", sa.text("created_at DESC"), sa.text("id DESC")],
    )

    # ══ 5. Sayim oturumlari ══
    op.create_table(
        "stock_count_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=24), nullable=False),
        sa.Column(
            "status",
            sa.String(length=12),
            server_default=sa.text("'DRAFT'"),
            nullable=False,
        ),
        sa.Column("scope", sa.String(length=10), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_admin_id", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("apply_idempotency_key", sa.String(length=80), nullable=True),
        sa.Column("cancelled_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["category_id"], ["product_categories.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["created_by_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["applied_by_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["cancelled_by_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.CheckConstraint(
            "status IN ('DRAFT','IN_PROGRESS','REVIEW','APPLIED','CANCELLED')",
            name="ck_stock_count_sessions_status",
        ),
        sa.CheckConstraint(
            "scope IN ('ALL','CATEGORY','MANUAL')",
            name="ck_stock_count_sessions_scope",
        ),
        sa.CheckConstraint(
            "(scope = 'CATEGORY') = (category_id IS NOT NULL)",
            name="ck_stock_count_sessions_category",
        ),
        sa.CheckConstraint(
            "status <> 'APPLIED' OR "
            "(applied_at IS NOT NULL AND applied_by_admin_id IS NOT NULL)",
            name="ck_stock_count_sessions_applied",
        ),
        sa.CheckConstraint(
            "status <> 'CANCELLED' OR "
            "(cancelled_at IS NOT NULL AND cancelled_by_admin_id IS NOT NULL)",
            name="ck_stock_count_sessions_cancelled",
        ),
    )
    op.create_index(
        "uq_stock_count_sessions_code", "stock_count_sessions", ["code"], unique=True
    )
    op.create_index(
        "ix_stock_count_sessions_status",
        "stock_count_sessions",
        ["status", sa.text("created_at DESC")],
    )

    # ══ 6. Sayim satirlari ══
    op.create_table(
        "stock_count_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("bucket", sa.String(length=10), nullable=False),
        sa.Column("system_qty_snapshot", sa.Integer(), nullable=False),
        sa.Column("reserved_qty_snapshot", sa.Integer(), nullable=True),
        sa.Column("snapshot_movement_id", sa.Integer(), nullable=True),
        sa.Column("counted_qty", sa.Integer(), nullable=True),
        sa.Column("counted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("counted_by_admin_id", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=10),
            server_default=sa.text("'PENDING'"),
            nullable=False,
        ),
        sa.Column("stale_reason", sa.String(length=40), nullable=True),
        sa.Column("resolved_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("applied_movement_id", sa.Integer(), nullable=True),
        sa.Column(
            "is_open", sa.Boolean(), server_default=sa.text("true"), nullable=False
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
            ["session_id"], ["stock_count_sessions.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["counted_by_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.CheckConstraint(
            "bucket IN ('SALEABLE','DAMAGED')", name="ck_stock_count_lines_bucket"
        ),
        sa.CheckConstraint(
            "status IN ('PENDING','COUNTED','STALE','RESOLVED','SKIPPED')",
            name="ck_stock_count_lines_status",
        ),
        sa.CheckConstraint(
            "(bucket = 'SALEABLE') = (reserved_qty_snapshot IS NOT NULL)",
            name="ck_stock_count_lines_reserved",
        ),
        sa.CheckConstraint(
            "system_qty_snapshot >= 0 AND "
            "(reserved_qty_snapshot IS NULL OR reserved_qty_snapshot >= 0)",
            name="ck_stock_count_lines_snapshot_sign",
        ),
        sa.CheckConstraint(
            "counted_qty IS NULL OR counted_qty >= 0",
            name="ck_stock_count_lines_counted_sign",
        ),
        sa.CheckConstraint(
            "counted_qty IS NULL OR "
            "(counted_at IS NOT NULL AND counted_by_admin_id IS NOT NULL)",
            name="ck_stock_count_lines_counted_actor",
        ),
        sa.CheckConstraint(
            "status NOT IN ('COUNTED','RESOLVED') OR counted_qty IS NOT NULL",
            name="ck_stock_count_lines_counted_status",
        ),
        sa.CheckConstraint(
            "(status = 'STALE') = (stale_reason IS NOT NULL)",
            name="ck_stock_count_lines_stale",
        ),
        sa.CheckConstraint(
            "status <> 'RESOLVED' OR (resolved_by_admin_id IS NOT NULL "
            "AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL)",
            name="ck_stock_count_lines_resolved",
        ),
    )
    op.create_index(
        "uq_stock_count_lines_slot",
        "stock_count_lines",
        ["session_id", "product_id", "bucket"],
        unique=True,
    )
    # Bir urun+kova AYNI ANDA yalniz bir acik oturumda olabilir.
    op.create_index(
        "uq_stock_count_lines_open",
        "stock_count_lines",
        ["product_id", "bucket"],
        unique=True,
        postgresql_where=sa.text("is_open"),
    )
    op.create_index(
        "ix_stock_count_lines_session", "stock_count_lines", ["session_id", "status"]
    )

    # ══ 7. Yeniden sayim izi (append-only) ══
    op.create_table(
        "stock_count_line_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("line_id", sa.Integer(), nullable=False),
        sa.Column("old_qty", sa.Integer(), nullable=True),
        sa.Column("new_qty", sa.Integer(), nullable=False),
        sa.Column("actor_admin_id", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["line_id"], ["stock_count_lines.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["actor_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.CheckConstraint(
            "new_qty >= 0 AND (old_qty IS NULL OR old_qty >= 0)",
            name="ck_stock_count_line_events_sign",
        ),
    )
    op.create_index(
        "ix_stock_count_line_events_line", "stock_count_line_events", ["line_id", "id"]
    )

    # ══ 8. Hasar olaylari (append-only) ══
    op.create_table(
        "stock_damage_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("source_bucket", sa.String(length=10), nullable=False),
        sa.Column("reason_code", sa.String(length=30), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("actor_admin_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["actor_admin_id"], ["admins.id"], ondelete="RESTRICT"
        ),
        sa.CheckConstraint(
            "kind IN ('TRANSFER','RECOVERY','DISPOSAL','SUPPLIER_RETURN')",
            name="ck_stock_damage_events_kind",
        ),
        sa.CheckConstraint(
            "source_bucket IN ('SALEABLE','DAMAGED')",
            name="ck_stock_damage_events_bucket",
        ),
        sa.CheckConstraint("qty > 0", name="ck_stock_damage_events_qty"),
        sa.CheckConstraint(
            "(kind = 'TRANSFER' AND source_bucket = 'SALEABLE') "
            "OR (kind IN ('RECOVERY','DISPOSAL') AND source_bucket = 'DAMAGED') "
            "OR kind = 'SUPPLIER_RETURN'",
            name="ck_stock_damage_events_kind_bucket",
        ),
        sa.CheckConstraint(
            "reason_code IN ('KIRIK','ISLAK','BASKI_HATASI',"
            "'MUSTERI_IADESI_HASARLI','DIGER')",
            name="ck_stock_damage_events_reason",
        ),
        sa.CheckConstraint(
            "reason_code <> 'DIGER' OR (note IS NOT NULL AND length(btrim(note)) > 0)",
            name="ck_stock_damage_events_note",
        ),
    )
    op.create_index(
        "ix_stock_damage_events_product",
        "stock_damage_events",
        ["product_id", sa.text("id DESC")],
    )

    # ══ 9. Trigger'lar ══
    # 9a. Hasarli kova, satilabilir kovanin takip semantigine baglanir. Kolonu
    #     bilmeyen her yazici (urun olusturma, CSV, seed, ham SQL) dogru degeri
    #     otomatik alir; `ck_products_damaged_pairing` bunu tek basina saglayamaz
    #     (sadece reddeder). Stok takibi kapatilirken hasarli bakiye sifir
    #     degilse SESSIZCE silinmez, hata verilir.
    op.execute(
        """
        CREATE FUNCTION products_damaged_pairing() RETURNS trigger AS $$
        BEGIN
          IF NEW.stock IS NULL THEN
            IF TG_OP = 'UPDATE'
               AND OLD.damaged_stock IS NOT NULL AND OLD.damaged_stock <> 0 THEN
              RAISE EXCEPTION
                'hasarli bakiye sifirlanmadan stok takibi kapatilamaz (urun %, hasarli %)',
                NEW.id, OLD.damaged_stock;
            END IF;
            NEW.damaged_stock := NULL;
          ELSE
            NEW.damaged_stock := COALESCE(NEW.damaged_stock, 0);
          END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_products_damaged_pairing "
        "BEFORE INSERT OR UPDATE ON products "
        "FOR EACH ROW EXECUTE FUNCTION products_damaged_pairing()"
    )

    # 9b. `stock_count_lines.is_open` TURETILMIS bir kolondur: tek dogruluk
    #     kaynagi oturumun durumudur. Satira elle yazilan deger EZILIR, boylece
    #     "urun basina tek acik sayim" kismi unique index'i ikinci bir dogruluk
    #     kaynagi yaratmadan calisir.
    op.execute(
        """
        CREATE FUNCTION stock_count_lines_derive_open() RETURNS trigger AS $$
        BEGIN
          SELECT (s.status NOT IN ('APPLIED','CANCELLED') AND s.deleted_at IS NULL)
            INTO NEW.is_open
          FROM stock_count_sessions s
          WHERE s.id = NEW.session_id;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_stock_count_lines_derive_open "
        "BEFORE INSERT OR UPDATE ON stock_count_lines "
        "FOR EACH ROW EXECUTE FUNCTION stock_count_lines_derive_open()"
    )
    op.execute(
        """
        CREATE FUNCTION stock_count_sessions_sync_lines() RETURNS trigger AS $$
        DECLARE
          acik boolean := (NEW.status NOT IN ('APPLIED','CANCELLED')
                           AND NEW.deleted_at IS NULL);
        BEGIN
          UPDATE stock_count_lines
             SET is_open = acik
           WHERE session_id = NEW.id
             AND is_open IS DISTINCT FROM acik;
          RETURN NULL;
        END; $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_stock_count_sessions_sync_lines "
        "AFTER UPDATE OF status, deleted_at ON stock_count_sessions "
        "FOR EACH ROW EXECUTE FUNCTION stock_count_sessions_sync_lines()"
    )

    # 9c. Iz tablolari append-only (`stock_movements` ile ayni durus). TRUNCATE
    #     bilincli olarak engellenmiyor: ORM'den erisilemez ve tablo sahibi
    #     gerektirir.
    op.execute(
        """
        CREATE FUNCTION inventory_append_only() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION '% append-only tablodur: % reddedildi',
            TG_TABLE_NAME, TG_OP;
        END; $$ LANGUAGE plpgsql
        """
    )
    for tablo in ("stock_count_line_events", "stock_damage_events"):
        for islem in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER trg_{tablo}_no_{islem.lower()} "
                f"BEFORE {islem} ON {tablo} "
                "FOR EACH ROW EXECUTE FUNCTION inventory_append_only()"
            )

    # ══ 10. Izinler ══
    _izinleri_ekle()


def _downgrade_engeli() -> None:
    """Geri alinmasi VERI KAYBI olacak durumlar varsa acikca durdurur."""
    conn = op.get_bind()
    engeller: list[str] = []

    n = conn.execute(
        sa.text(
            "SELECT count(*) FROM stock_movements WHERE movement_type IN "
            f"({_liste(_MOVEMENT_TYPES_NEW)}) OR bucket <> 'SALEABLE'"
        )
    ).scalar_one()
    if n:
        engeller.append(f"{n} adet yeni tur/kova defter hareketi")

    n = conn.execute(
        sa.text(
            "SELECT count(*) FROM products "
            "WHERE damaged_stock IS NOT NULL AND damaged_stock <> 0"
        )
    ).scalar_one()
    if n:
        engeller.append(f"{n} urunde sifirdan farkli hasarli bakiye")

    for tablo in (
        "stock_count_sessions",
        "stock_count_lines",
        "stock_count_line_events",
        "stock_damage_events",
    ):
        n = conn.execute(sa.text(f"SELECT count(*) FROM {tablo}")).scalar_one()
        if n:
            engeller.append(f"{tablo} tablosunda {n} kayit")

    if engeller:
        raise RuntimeError(
            "f29_sayim_hasarli_stok geri alinamaz — su veriler kaybolurdu: "
            + "; ".join(engeller)
            + ". Defter append-only oldugu icin bu satirlar silinemez; "
            "geri alma KOD seviyesinde yapilmali, sema yerinde kalmalidir."
        )


def downgrade() -> None:
    _downgrade_engeli()

    _izinleri_kaldir()

    for tablo in ("stock_count_line_events", "stock_damage_events"):
        for islem in ("update", "delete"):
            op.execute(f"DROP TRIGGER IF EXISTS trg_{tablo}_no_{islem} ON {tablo}")
    op.execute("DROP FUNCTION IF EXISTS inventory_append_only()")
    op.execute(
        "DROP TRIGGER IF EXISTS trg_stock_count_sessions_sync_lines "
        "ON stock_count_sessions"
    )
    op.execute("DROP FUNCTION IF EXISTS stock_count_sessions_sync_lines()")
    op.execute(
        "DROP TRIGGER IF EXISTS trg_stock_count_lines_derive_open ON stock_count_lines"
    )
    op.execute("DROP FUNCTION IF EXISTS stock_count_lines_derive_open()")
    op.execute("DROP TRIGGER IF EXISTS trg_products_damaged_pairing ON products")
    op.execute("DROP FUNCTION IF EXISTS products_damaged_pairing()")

    op.drop_index("ix_stock_damage_events_product", table_name="stock_damage_events")
    op.drop_table("stock_damage_events")
    op.drop_index(
        "ix_stock_count_line_events_line", table_name="stock_count_line_events"
    )
    op.drop_table("stock_count_line_events")
    op.drop_index("ix_stock_count_lines_session", table_name="stock_count_lines")
    op.drop_index("uq_stock_count_lines_open", table_name="stock_count_lines")
    op.drop_index("uq_stock_count_lines_slot", table_name="stock_count_lines")
    op.drop_table("stock_count_lines")
    op.drop_index(
        "ix_stock_count_sessions_status", table_name="stock_count_sessions"
    )
    op.drop_index("uq_stock_count_sessions_code", table_name="stock_count_sessions")
    op.drop_table("stock_count_sessions")

    op.drop_index("ix_stock_movements_product", table_name="stock_movements")
    op.create_index(
        "ix_stock_movements_product",
        "stock_movements",
        ["product_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.drop_constraint(
        "ck_stock_movements_damage_reason", "stock_movements", type_="check"
    )
    op.drop_constraint(
        "ck_stock_movements_count_reason", "stock_movements", type_="check"
    )
    op.drop_constraint("ck_stock_movements_ref", "stock_movements", type_="check")
    op.create_check_constraint(
        "ck_stock_movements_ref",
        "stock_movements",
        "movement_type NOT IN ('SALE','SALE_CANCEL','RETURN') "
        "OR (ref_type IS NOT NULL AND ref_id IS NOT NULL)",
    )
    op.drop_constraint("ck_stock_movements_type", "stock_movements", type_="check")
    op.create_check_constraint(
        "ck_stock_movements_type",
        "stock_movements",
        f"movement_type IN ({_liste(_MOVEMENT_TYPES_OLD)})",
    )
    op.drop_constraint(
        "ck_stock_movements_bucket_type", "stock_movements", type_="check"
    )
    op.drop_constraint("ck_stock_movements_bucket", "stock_movements", type_="check")
    op.drop_column("stock_movements", "bucket")

    op.drop_constraint("ck_products_damaged_sign", "products", type_="check")
    op.drop_constraint("ck_products_damaged_pairing", "products", type_="check")
    op.drop_column("products", "damaged_stock")
