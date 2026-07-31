"""F29c — hasar idempotency kapsami AKTOR bazli

Revision ID: f29c_damage_idem_actor_scope
Revises: f29b_damage_event_idempotency
Create Date: 2026-07-31

## Neden bu duzeltme

`f29b` anahtari **global** tekil yapmisti (`uq_stock_damage_events_idem`,
yalniz `idempotency_key`). Bu iki sorun uretiyor:

1. **Aktorler birbirini bloke ediyor.** Iki yonetici ayni metinsel anahtari
   ("gunluk-hasar-1") bagimsiz olarak kullanamiyor; ikincisi catisma aliyor.
   Idempotency anahtari **istegi gonderenin** kendi alanidir; kuresel bir isim
   alani degildir.
2. **Kapsam belirsiz.** "Ayni anahtar farkli urun icin kullanildi" hali ile
   "baska bir yonetici ayni ismi secti" hali ayirt edilemiyordu.

Yeni kapsam **`(actor_admin_id, idempotency_key)`**. Ayni aktorun ayni anahtari
farkli urun, farkli miktar ya da farkli islem turu icin kullanmasi **catismadir**
(payload karsilastirmasi 409 verir); farkli aktorlerin ayni metni kullanmasi
serbesttir.

`actor_admin_id` NOT NULL oldugu icin kapsam her zaman tam tanimlidir.
`idempotency_key` NULL kalabilir (anahtarsiz ic cagri/betik); PostgreSQL unique
index'te NULL'lari birbirinden farkli saydigi icin bu satirlar kisitlanmaz.

## Uygulama seviyesindeki SELECT tek basina yeterli DEGIL

Iki eszamanli istek SELECT'te birbirini goremez (commit edilmemis satir gorunmez)
ve ikisi de INSERT'e gider. Yarisa dayanikli garanti **DB unique index'idir**;
servis catismayi savepoint icinde yakalayip yeniden okuyarak kontrollu 409/replay
sonucuna cevirir.

## Downgrade

Eski global index geri konur. Uyari: global kapsamda ayni anahtari farkli
aktorlerde tasiyan satirlar varsa downgrade tekillik ihlali verir; bu bilincli
olarak sessizce cozulmez.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "f29c_damage_idem_actor_scope"
down_revision: Union[str, Sequence[str], None] = "f29b_damage_event_idempotency"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("uq_stock_damage_events_idem", table_name="stock_damage_events")
    op.create_index(
        "uq_stock_damage_events_idem",
        "stock_damage_events",
        ["actor_admin_id", "idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_stock_damage_events_idem", table_name="stock_damage_events")
    op.create_index(
        "uq_stock_damage_events_idem",
        "stock_damage_events",
        ["idempotency_key"],
        unique=True,
    )
