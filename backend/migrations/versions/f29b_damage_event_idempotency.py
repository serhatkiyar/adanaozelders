"""F29b — stock_damage_events.idempotency_key

Revision ID: f29b_damage_event_idempotency
Revises: f29a_bucket_default_kaldir
Create Date: 2026-07-31

## Neden bu kolon ZORUNLU (gecmis yeniden yazilmadi, duzeltici revizyon eklendi)

Commit 6 sozlesmesi hasar servisinden **istek duzeyinde** idempotency istiyor:
ayni anahtar + ayni payload -> replay; ayni anahtar + farkli payload -> catisma;
yeni anahtar -> yeni is.

Defterin (`stock_movements.idempotency_key`) kendi idempotency'si bunu
KARSILAYAMAZ, cunku hasar hareketlerinin anahtari **olay kimliginden** turetilir
(`damage:{event_id}:{bucket}`, plan §5.4). Her istek yeni bir
`stock_damage_events` satiri uretirse yeni bir `event_id` ve dolayisiyla yeni
anahtarlar dogar; defter bunlari "farkli is" sayar ve **ayni hasar iki kez
yazilir**. Yani tekrar edilen bir istegi tanimanin tek yolu olayin KENDI
anahtarina bakmaktir.

Kolon commit 3'te gozden kacti: plan §5.2'deki `stock_damage_events` alan
listesi olayin dogal anahtarini (`damage:{event_id}:{bucket}`) tarif ediyor ama
istegin anahtarini icermiyordu. Bu, tasarim degisikligi degil **eksik alanin
tamamlanmasidir**.

## NULL bilincli

Anahtarsiz cagri (ic servis, betik) hala mumkundur; PostgreSQL unique index'te
NULL'lari birbirinden farkli saydigi icin bu satirlar tekillik kisitina takilmaz.

## Downgrade

Kolon ve index temiz dusurulur; hicbir olay satiri silinmez.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f29b_damage_event_idempotency"
down_revision: Union[str, Sequence[str], None] = "f29a_bucket_default_kaldir"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "stock_damage_events",
        sa.Column("idempotency_key", sa.String(length=80), nullable=True),
    )
    op.create_index(
        "uq_stock_damage_events_idem",
        "stock_damage_events",
        ["idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_stock_damage_events_idem", table_name="stock_damage_events"
    )
    op.drop_column("stock_damage_events", "idempotency_key")
