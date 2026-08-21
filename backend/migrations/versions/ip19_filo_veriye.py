"""İP-19: filo veriye taşınır — vehicles + pickup_points, enum ve depo sabiti kalkar.

Üç adım (sözleşme §2.4), VERİ KAYBI YOK:

1. `vehicles` ve `pickup_points` kurulur; yalnız LADA/COROLLA satırları seed
   edilir (eşleme adımının kendisi onlara dayanır). Başlangıç noktası
   SEED'LENMEZ — uydurma koordinat müşteriye gösterilen varış penceresini de
   bozardı; operatör Dağıtım > Araçlar ekranından gerçek noktasını girer.
2. `delivery_runs.vehicle_id` eklenir (önce nullable), eski serbest
   `vehicle` string'i `vehicles.code` üzerinden eşlenir, NOT NULL yapılır,
   `uq_delivery_run_planned` index'i `vehicle_id`'ye taşınır (K-8: semantik
   değişmez), eski kolon düşürülür.
3. `couriers.vehicle_plate` düşürülür (K-5: plaka araca aittir). Kuryelerde
   TEK bir ayrık plaka varsa LADA'ya taşınır; birden çoksa hangisinin hangi
   araca ait olduğu bilinemez — taşınmaz (elle girilir), veri yine de
   `vehicles.plate`'e admin tarafından yazılabilir.

`downgrade` şemayı geri kurar ama **veriyi geri getirmez**: düşürülen
`vehicle_plate` değerleri ve `vehicles`/`pickup_points` içerikleri kaybolur;
`delivery_runs.vehicle` kolonu `vehicles.code`'dan geri doldurulur (bu kadarı
mümkündür çünkü eşleme hâlâ tablodadır). Yedeği olmayan downgrade bir
geri-alma değil şema provasıdır (İP-19 D-9 bunu dolu tabloda ölçer).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ip19_filo_veriye"
down_revision = "sm2_flashcard_kaldirma"
branch_labels = None
depends_on = None

# Başlangıç noktası SEED'LENMEZ (bağımsız denetim B-9). İlk hâl "Merkez
# (geçici — gerçek başlangıç noktanızla değiştirin)" adıyla uydurma bir
# koordinat yazıyordu; panelde düzenleme yolu olmadığı için o sahte nokta
# kalıcı hâle gelebiliyordu. Koordinat yalnız rotanın başlangıcı değil,
# MÜŞTERİYE GÖSTERİLEN varış penceresinin de başlangıcıdır — sessizce yanlış
# olması, hiç olmamasından kötüdür. Nokta tanımlı değilken "Günü Optimize Et"
# açık bir 409 döner: "Başlangıç noktası tanımlı değil — Dağıtım ayarlarından
# bir BASE noktası ekleyin".


def upgrade() -> None:
    # ── 1) yeni tablolar ────────────────────────────────────────────────────
    op.create_table(
        "pickup_points",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "vehicles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(20), nullable=False, unique=True),
        sa.Column("label", sa.String(50), nullable=False),
        sa.Column("plate", sa.String(20), nullable=True),
        sa.Column(
            "profile", sa.String(20), nullable=False, server_default=sa.text("'car'")
        ),
        sa.Column("max_stops", sa.Integer(), nullable=True),
        sa.Column("shift_start", sa.Time(), nullable=True),
        sa.Column("shift_end", sa.Time(), nullable=True),
        sa.Column(
            "fixed_cost", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "start_point_id",
            sa.Integer(),
            sa.ForeignKey("pickup_points.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Seed: yalnız mevcut iki araç (veri taşıma eşlemesinin kendisi).
    #
    # COROLLA'nın `fixed_cost=1800`'ü eski "COROLLA yalnız yoğun günlerde"
    # kuralının ekonomik karşılığıdır (K-3): VROOM maliyeti saniye cinsinden
    # tartar, 1800 ≈ "ikinci aracı çıkarmak yarım saatlik sürüşe bedel".
    # Küçük günlerde tek araç plana girer, kazanç yarım saati aşınca COROLLA
    # devreye girer. Eşik artık kodda bir sabit değil, admin panelinden
    # araç başına ayarlanabilir bir SAYIDIR.
    op.execute(
        "INSERT INTO vehicles (code, label, sort_order, fixed_cost) "
        "VALUES ('LADA', 'Lada', 0, 0), ('COROLLA', 'Corolla', 1, 1800)"
    )

    # ── 2) delivery_runs.vehicle → vehicle_id ───────────────────────────────
    op.add_column(
        "delivery_runs", sa.Column("vehicle_id", sa.Integer(), nullable=True)
    )
    # Eşleşmeyen her DISTINCT kod için ARAÇ SATIRI AÇILIR (denetim B-4).
    # Eski kolon FK'siz/CHECK'siz serbest bir String(20) idi (§0.1'in
    # şikâyeti), yani "KANGOO" gibi elle yazılmış bir değer gerçekten
    # bulunabilir. Onu LADA'ya düşürmek, `fk_delivery_runs_vehicle_id`'nin
    # RESTRICT olma gerekçesini — geçmiş turun hangi araçla koştuğu
    # kaybolmasın — daha migration anında çiğnerdi.
    op.execute(
        "INSERT INTO vehicles (code, label, sort_order, fixed_cost) "
        "SELECT DISTINCT upper(trim(r.vehicle)), "
        "       initcap(lower(trim(r.vehicle))), 100, 0 "
        "  FROM delivery_runs r "
        " WHERE r.vehicle IS NOT NULL AND trim(r.vehicle) <> '' "
        "   AND NOT EXISTS ("
        "       SELECT 1 FROM vehicles v WHERE v.code = upper(trim(r.vehicle))"
        "   )"
    )
    op.execute(
        "UPDATE delivery_runs r SET vehicle_id = v.id "
        "FROM vehicles v WHERE v.code = upper(trim(r.vehicle))"
    )
    # Yalnız `vehicle` alanı BOŞ olan tarihsel satırlar varsayılana düşer;
    # dolu ama tanınmayan bir kod artık buraya hiç gelmez.
    op.execute(
        "UPDATE delivery_runs SET vehicle_id = "
        "(SELECT id FROM vehicles WHERE code = 'LADA') WHERE vehicle_id IS NULL"
    )
    op.alter_column("delivery_runs", "vehicle_id", nullable=False)
    op.create_foreign_key(
        "fk_delivery_runs_vehicle_id",
        "delivery_runs",
        "vehicles",
        ["vehicle_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.drop_index("uq_delivery_run_planned", table_name="delivery_runs")
    op.create_index(
        "uq_delivery_run_planned",
        "delivery_runs",
        ["run_date", "vehicle_id"],
        unique=True,
        postgresql_where=sa.text("status = 'PLANNED' AND deleted_at IS NULL"),
    )
    op.drop_column("delivery_runs", "vehicle")

    # ── 3) plaka araca taşınır (K-5) ────────────────────────────────────────
    op.execute(
        "UPDATE vehicles SET plate = ("
        "  SELECT MIN(vehicle_plate) FROM couriers"
        "  WHERE vehicle_plate IS NOT NULL AND deleted_at IS NULL"
        ") WHERE code = 'LADA' AND ("
        "  SELECT COUNT(DISTINCT vehicle_plate) FROM couriers"
        "  WHERE vehicle_plate IS NOT NULL AND deleted_at IS NULL"
        ") = 1"
    )
    op.drop_column("couriers", "vehicle_plate")


def downgrade() -> None:
    """Şemayı geri kurar — VERİ GERİ GELMEZ (docstring'deki uyarı)."""
    op.add_column(
        "couriers", sa.Column("vehicle_plate", sa.String(20), nullable=True)
    )

    op.add_column(
        "delivery_runs",
        sa.Column(
            "vehicle", sa.String(20), nullable=True, server_default=sa.text("'LADA'")
        ),
    )
    # Geri doldurma mümkün: eşleme hâlâ vehicles tablosunda.
    op.execute(
        "UPDATE delivery_runs r SET vehicle = v.code "
        "FROM vehicles v WHERE v.id = r.vehicle_id"
    )
    op.alter_column("delivery_runs", "vehicle", nullable=False)
    op.drop_index("uq_delivery_run_planned", table_name="delivery_runs")
    op.create_index(
        "uq_delivery_run_planned",
        "delivery_runs",
        ["run_date", "vehicle"],
        unique=True,
        postgresql_where=sa.text("status = 'PLANNED' AND deleted_at IS NULL"),
    )
    op.drop_constraint(
        "fk_delivery_runs_vehicle_id", "delivery_runs", type_="foreignkey"
    )
    op.drop_column("delivery_runs", "vehicle_id")

    op.drop_table("vehicles")
    op.drop_table("pickup_points")
