"""F29a — stock_movements.bucket sunucu varsayilanini kaldir

Revision ID: f29a_bucket_default_kaldir
Revises: f29_sayim_hasarli_stok
Create Date: 2026-07-31

## Neden ayri bir revizyon

`f29_sayim_hasarli_stok` kolonu `NOT NULL DEFAULT 'SALEABLE'` ile ekliyor.
Bu, mevcut satirlari **UPDATE etmeden** doldurmanin tek dogru yoluydu: defter
append-only'dir ve `trg_stock_movements_no_update` migration'in kendi backfill
UPDATE'ini de reddeder (prova sirasinda gercek hatayla yakalandi).

Ama varsayilanin KALICI kalmasi bir tuzaktir: ham SQL, seed ya da hatali bir
yazici `bucket` gondermeden bir DAMAGED hareket yazdiginda PostgreSQL onu
SESSIZCE `SALEABLE` kaydeder ve defter iki kovayi da yalan soyler. Varsayilan
yalnizca **backfill icin** vardi; isi bitince kalkmali.

Bu duzeltme neden `f29_sayim_hasarli_stok` govdesine yazilmadi: gelistirme
veritabani (`ceyhandb`) o revizyona **zaten yukseltilmisti**. Uygulanmis bir
revizyonun govdesini degistirmek, o DB'nin duzeltmeyi hicbir zaman almamasi
demektir — migration gecmisi yeniden yazilmaz, duzeltici revizyon eklenir.
Sifir bir veritabaninda `f29` + `f29a` birlikte kosar ve net sonuc aynidir:
kolon NOT NULL, varsayilan YOK.

## Downgrade

Varsayilani geri koyar. Guvenlidir: `f29_sayim_hasarli_stok`'un downgrade'i
kolonu tamamen dusurur ve oraya inebilmek icin kolonun varsayilanli hali
beklenir.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f29a_bucket_default_kaldir"
down_revision: Union[str, Sequence[str], None] = "f29_sayim_hasarli_stok"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Varsayilani kaldirmadan ONCE backfill'in gercekten tamamlandigini dogrula.
    # NULL kalmis ya da beklenmedik degerli bir satir varsa varsayilanin
    # kalkmasi sorunu GORUNMEZ yapardi; burada acikca durulur.
    kalinti = conn.execute(
        sa.text(
            "SELECT count(*) FROM stock_movements "
            "WHERE bucket IS NULL OR bucket NOT IN ('SALEABLE','DAMAGED')"
        )
    ).scalar_one()
    if kalinti:
        raise RuntimeError(
            f"f29a: {kalinti} stock_movements satirinda bucket eksik/gecersiz — "
            "varsayilan kaldirilmadan once backfill tamamlanmali"
        )

    op.alter_column(
        "stock_movements",
        "bucket",
        existing_type=sa.String(length=10),
        existing_nullable=False,
        server_default=None,
    )


def downgrade() -> None:
    op.alter_column(
        "stock_movements",
        "bucket",
        existing_type=sa.String(length=10),
        existing_nullable=False,
        server_default=sa.text("'SALEABLE'"),
    )
