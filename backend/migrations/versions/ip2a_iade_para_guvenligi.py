"""ip2a: iade para rezervasyonu, MANUAL_REVIEW ve fiziksel kabul

İP-2a mağaza iade para güvenliği uygulaması (docs/ip2a-magaza-iade-sozlesme.md
"Üretim uygulaması kapanışı"). Üç ayrı yapı ekler:

1. **Para tavanı otoritesi** — `orders.refund_reserved`. `refunded_amount`
   yalnız sağlayıcı BAŞARISINDAN sonra artar; tavan kararı ise sağlayıcı
   çağrısından ÖNCE verilmek zorundadır. İkisi aynı kolondan okunduğu için iki
   eşzamanlı iade de "hiç iade yok" görüp tam tutarı istiyordu (İP2A-03/04).

2. **PK-δ / MANUAL_REVIEW** — `orders.payment_status` ve
   `order_returns.refund_status` String(10) → String(20). 13 karakterlik yeni
   değer eskisine SIĞMIYOR; genişletme bu yüzden veri değil şema kararıdır.

3. **PK-α / fiziksel kabul** — `order_returns.received_at/received_by` ve
   `order_return_items.accepted_quantity/damaged_quantity`. Stok artık para
   iadesiyle değil, malın işletmeye ULAŞMASIYLA döner.

Ayrıca `order_returns.shipping_refund`: kargo payı kalem satırlarından ayrılır
(İP2A-15 dekont özdeşliği).

Revision ID: ip2a_iade_para_guvenligi
Revises: ip2b_terminal_history_guard
Create Date: 2026-08-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "ip2a_iade_para_guvenligi"
down_revision: Union[str, Sequence[str], None] = "ip2b_terminal_history_guard"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Para rezervasyonu ────────────────────────────────────────────────
    op.add_column(
        "orders",
        sa.Column(
            "refund_reserved",
            sa.Numeric(precision=10, scale=2),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )

    # ── 2. MANUAL_REVIEW için kolon genişletme ──────────────────────────────
    op.alter_column(
        "orders",
        "payment_status",
        existing_type=sa.String(length=10),
        type_=sa.String(length=20),
        existing_nullable=False,
        existing_server_default=sa.text("'PENDING'"),
    )
    op.alter_column(
        "order_returns",
        "refund_status",
        existing_type=sa.String(length=10),
        type_=sa.String(length=20),
        existing_nullable=False,
        existing_server_default=sa.text("'NONE'"),
    )

    # ── 3. Kargo payının ayrıştırılması ─────────────────────────────────────
    op.add_column(
        "order_returns",
        sa.Column(
            "shipping_refund",
            sa.Numeric(precision=10, scale=2),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )

    # ── 4. Fiziksel kabul (PK-α) ────────────────────────────────────────────
    op.add_column(
        "order_returns",
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "order_returns", sa.Column("received_by", sa.String(length=120), nullable=True)
    )
    op.add_column(
        "order_return_items",
        sa.Column(
            "accepted_quantity",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.add_column(
        "order_return_items",
        sa.Column(
            "damaged_quantity",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )

    # ── 5. Geriye dönük veri ────────────────────────────────────────────────
    #
    # (a) Rezervasyon = kesinleşen iade + HÂLÂ UÇUŞTA olan iade niyetleri.
    #     Yalnız `refunded_amount`'a eşitlemek, sarkan REFUNDING kayıtların
    #     tutarını serbest bırakır ve tavanı o kadar deler.
    op.execute(
        """
        UPDATE orders o
           SET refund_reserved = LEAST(
                 o.total,
                 o.refunded_amount
                 + COALESCE((
                     SELECT SUM(r.refund_amount) FROM order_returns r
                      WHERE r.order_id = o.id AND r.refund_status = 'REFUNDING'
                   ), 0)
                 + CASE WHEN o.payment_status = 'REFUNDING'
                        THEN GREATEST(o.total - o.refunded_amount, 0) ELSE 0 END
               )
        """
    )
    # (b) Tamamlanmış eski iadelerde stok ESKİ kuralla (para iadesinde) zaten
    #     geri konmuştu. Kabul damgası geriye dönük yazılır ki yeni kabul ucu
    #     o kayıtlara ikinci kez uygulanmasın ve defter ile kabul kaydı
    #     birbirini tutsun. (İkinci savunma hattı `return_line:{id}:RETURN`
    #     idempotency anahtarıdır; bu satır kaydı GÖRÜNÜR kılar.)
    op.execute(
        "UPDATE order_returns SET received_at = COALESCE(refunded_at, resolved_at), "
        "received_by = 'system:ip2a-backfill' "
        "WHERE refund_status = 'REFUNDED' AND received_at IS NULL"
    )
    op.execute(
        "UPDATE order_return_items ri SET accepted_quantity = ri.quantity "
        "FROM order_returns r "
        "WHERE r.id = ri.return_id AND r.received_at IS NOT NULL"
    )

    # ── 6. Kabul adedi tavanı (backfill'den SONRA) ──────────────────────────
    op.create_check_constraint(
        "ck_order_return_items_received",
        "order_return_items",
        "accepted_quantity >= 0 AND damaged_quantity >= 0 "
        "AND accepted_quantity + damaged_quantity <= quantity",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_order_return_items_received", "order_return_items", type_="check"
    )
    op.drop_column("order_return_items", "damaged_quantity")
    op.drop_column("order_return_items", "accepted_quantity")
    op.drop_column("order_returns", "received_by")
    op.drop_column("order_returns", "received_at")
    op.drop_column("order_returns", "shipping_refund")

    # String(20) → String(10) daraltması, MANUAL_REVIEW taşıyan satırlarda
    # veri kaybıyla PATLAR. Downgrade uygulanabilir kalsın diye bu kayıtlar
    # önceki anlamlarına (sarkan iade niyeti) geri alınır — bilgi kaybı
    # bilinçlidir ve downgrade'in doğası gereğidir.
    op.execute(
        "UPDATE order_returns SET refund_status = 'REFUNDING' "
        "WHERE refund_status = 'MANUAL_REVIEW'"
    )
    op.execute(
        "UPDATE orders SET payment_status = 'REFUNDING' "
        "WHERE payment_status = 'MANUAL_REVIEW'"
    )
    op.alter_column(
        "order_returns",
        "refund_status",
        existing_type=sa.String(length=20),
        type_=sa.String(length=10),
        existing_nullable=False,
        existing_server_default=sa.text("'NONE'"),
    )
    op.alter_column(
        "orders",
        "payment_status",
        existing_type=sa.String(length=20),
        type_=sa.String(length=10),
        existing_nullable=False,
        existing_server_default=sa.text("'PENDING'"),
    )
    op.drop_column("orders", "refund_reserved")
