"""TB-1: order_returns.reason kolonuna DDL varsayilani ekle

`models/store.py::OrderReturn.reason` `server_default=text("''")` bildiriyor ama
kolonu yaratan migration (`0479d46ac604_order_returns_rma.py:28`) varsayilani
yazmamis. Sapma **calisma zamaninda gorunmez** — uygulama yolu iade talebini her
zaman `reason` ile olusturur. Modele bakip "varsayilani var" varsayan bir
migration/script ise `NotNullViolation` alir ve sebep modelde gorunmez.

Yon secimi (bkz. docs/teknik-borc.md TB-1): modeldeki `server_default`
kaldirilmak yerine DB'ye varsayilan eklenir. Cayma hakkinda gerekce ZORUNLU
DEGILDIR (kosulsuz cayma), dolayisiyla bos dizgi gecerli bir degerdir.

**Davranis degismez**: mevcut satirlar zaten NOT NULL ve dolu; varsayilan yalniz
`reason` HIC verilmeyen INSERT'lerde devreye girer, ki bugun oyle bir cagiran yok.

Revision ID: tb1_order_returns_reason_default
Revises: stok_hareket_defteri_sku
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "tb1_order_returns_reason_default"
down_revision = "stok_hareket_defteri_sku"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "order_returns",
        "reason",
        existing_type=sa.Text(),
        existing_nullable=False,
        server_default=sa.text("''"),
    )


def downgrade() -> None:
    op.alter_column(
        "order_returns",
        "reason",
        existing_type=sa.Text(),
        existing_nullable=False,
        server_default=None,
    )
