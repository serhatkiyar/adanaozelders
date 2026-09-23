"""ogretmen puan sayaclarini gercek degerlendirmelerden yeniden hesapla

Revision ID: e4b8d2f6a1c3
Revises: d7a3c1e5b902
Create Date: 2026-09-23 14:00:00.000000

`tutors.rating_count` / `rating_sum` servis tarafından artımlı güncellenir.
Kod dışından yazılan değerler bu sayaçları gerçeklikten koparabiliyor: örneğin
`backend/seed_test.py`, hiç değerlendirmesi olmayan bir test öğretmenini
doğrudan `rating_count=5` ile ekliyordu (yerelde tutor 12: 5 sayaç, 0 yorum).

Bu migration sayaçları tek doğruluk kaynağından, yani silinmemiş VE
gizlenmemiş değerlendirmelerden, yeniden hesaplar. İdempotenttir: tekrar
çalışması sonucu değiştirmez; zaten doğru olan satıra dokunmaz.

Downgrade eski (yanlış) değerleri geri getiremez; no-op'tur.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e4b8d2f6a1c3'
down_revision: Union[str, Sequence[str], None] = 'd7a3c1e5b902'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        UPDATE tutors t
        SET rating_count = g.adet,
            rating_sum = g.toplam
        FROM (
            SELECT t2.id,
                   count(r.id) AS adet,
                   coalesce(sum(r.rating), 0) AS toplam
            FROM tutors t2
            LEFT JOIN reviews r
              ON r.tutor_id = t2.id
             AND r.deleted_at IS NULL
             AND r.hidden_at IS NULL
            GROUP BY t2.id
        ) g
        WHERE t.id = g.id
          AND (t.rating_count IS DISTINCT FROM g.adet
               OR t.rating_sum IS DISTINCT FROM g.toplam)
        """
    )


def downgrade() -> None:
    """Downgrade schema — veri düzeltmesi geri alınamaz, bilinçli no-op."""
