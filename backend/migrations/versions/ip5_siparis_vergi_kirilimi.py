"""İP-5: siparişe matrah/vergi kırılımı kolonları

Revision ID: ip5_siparis_vergi_kirilimi
Revises: ip1b_bilet_kodu_tekilligi
Create Date: 2026-08-07

## Ne ekliyor

`orders` tablosuna beş kolon: `net_total`, `tax_total`, `tax_breakdown`
(JSONB), `shipping_tax_rate`, `shipping_tax_amount`.

## Neden hepsi NULLABLE ve neden server_default YOK

`0` ile `NULL` burada FARKLI şeylerdir:

* `tax_total = 0` → "bu siparişte vergi yok" (ör. tamamen %0 oranlı sepet).
* `tax_total = NULL` → "kırılım hiç hesaplanmadı".

`server_default 0` verilseydi, İP-5 öncesi bütün siparişler "vergisi sıfır
hesaplanmış" görünürdü. `products.tax_rate`'in `server_default 0`'ı P1-7'nin
kök nedeniydi (her ürün sessizce %0); aynı hatayı sipariş tarafında
tekrarlamıyoruz.

## Neden BACKFILL YOK (S-4)

Mevcut siparişlerin vergi kırılımı **geriye dönük hesaplanmaz**. Ölçüm: bu
kararın alındığı tarihte katalogdaki 28 sipariş kaleminin tamamı
`tax_rate = 0` ve `tax_amount = 0` durumundaydı — yani doğru oranlar zaten
kayıtlı değil, uydurulması gerekirdi. Tarihsel bir siparişin vergisini
sonradan hesaplamak muhasebe açısından risklidir ve o siparişler KDV dahil
fiyatla, kırılımsız kesilmiştir.

Sonuç: eski siparişlerde `tax_breakdown IS NULL` kalır ve fatura ucu onları
409 ile reddeder (uydurma belge üretmez).

Downgrade beş kolonu düşürür; veri kaybı bilinçlidir (kolonlar İP-5 ile
doğdu, öncesinde karşılıkları yoktu).
"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ip5_siparis_vergi_kirilimi"
down_revision: Union[str, Sequence[str], None] = "ip1b_bilet_kodu_tekilligi"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "orders", sa.Column("net_total", sa.Numeric(precision=10, scale=2), nullable=True)
    )
    op.add_column(
        "orders", sa.Column("tax_total", sa.Numeric(precision=10, scale=2), nullable=True)
    )
    op.add_column(
        "orders",
        sa.Column("tax_breakdown", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "orders",
        sa.Column("shipping_tax_rate", sa.Numeric(precision=5, scale=4), nullable=True),
    )
    op.add_column(
        "orders",
        sa.Column("shipping_tax_amount", sa.Numeric(precision=10, scale=2), nullable=True),
    )
    # Kırılımı EKSİK siparişleri sayan kuyruk sorgusu için kısmi index
    # (`GET /store/admin/tax-health`). Kısmi: sağlıklı siparişler indekste yer
    # kaplamasın — ayar girildikten sonra bu küme küçülüp boşalmalıdır.
    op.create_index(
        "ix_orders_tax_breakdown_missing",
        "orders",
        ["created_at"],
        postgresql_where=sa.text(
            "deleted_at IS NULL AND ("
            "tax_breakdown IS NULL "
            "OR (shipping_fee > 0 AND shipping_tax_rate IS NULL))"
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_orders_tax_breakdown_missing", table_name="orders")
    op.drop_column("orders", "shipping_tax_amount")
    op.drop_column("orders", "shipping_tax_rate")
    op.drop_column("orders", "tax_breakdown")
    op.drop_column("orders", "tax_total")
    op.drop_column("orders", "net_total")
