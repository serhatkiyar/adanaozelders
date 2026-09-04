"""brans aramasi icin normalize fonksiyonel indeksi

Arama filtresi `tutor_subjects.subject` üzerinde ham eşitlikten
`tr_normalize(subject)` karşılaştırmasına geçti (branşını "Fen Bilgisi" diye
bildiren eğitmen "Fen" aramasında çıkmıyordu). Mevcut `ix_tutor_subjects_subject`
indeksi ham kolona bağlı olduğu için yeni ifadeyi KARŞILAMIYOR — ölçüldü,
sorgu Seq Scan'e düşüyor.

Bu indeks o ifadeyi karşılar. Bugün tabloda 14 satır var ve fark görünmez;
eğitmen sayısı büyüdüğünde her arama isteğinin `tutor_subjects`'i baştan sona
taraması anlamına gelirdi. Eski indeks DURUYOR: `subject` kolonu hâlâ
doğrudan sorgulanıyor (admin listeleri, profil yazımı).

Revision ID: e4a91c37f2d8
Revises: b27db6c5d4b6
Create Date: 2026-09-04

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e4a91c37f2d8'
down_revision: Union[str, Sequence[str], None] = 'b27db6c5d4b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # `tr_normalize` IMMUTABLE olarak tanımlıdır (bkz. dd737c387ff5); aksi hâlde
    # ifade indeksi kurulamazdı.
    op.execute(
        "CREATE INDEX ix_tutor_subjects_subject_norm "
        "ON tutor_subjects (tr_normalize(subject))"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS ix_tutor_subjects_subject_norm")
