"""sifreli iban kolonlarini genislet (VARCHAR(34) -> 255)

**Hiç tetiklenmemiş bir para-yolu hatasının düzeltmesi.**

`EncryptedString` DB'de Fernet ile şifrelenmiş metin saklar; kendi docstring'i
"``length`` şifreli metni tutacak kadar geniş olmalı (kısa girdiler ~100+
karaktere şişer)" diyor. Modeller `EncryptedString(255)` tanımlıyor, ama
baseline migration bu üç kolonu **VARCHAR(34)** açmış (düz IBAN uzunluğu):

    tutors.iban · libraries.iban · payout_records.iban_snapshot

Sonuç: ilk eğitmen/kütüphane IBAN'ını kaydettiğinde
`value too long for type character varying(34)` ile 500 alırdı. Geliştirme
veritabanında hiç IBAN kaydedilmediği (0 satır) için fark edilmemişti; sahada
ilk hakediş onboarding'inde patlardı.

Genişletme Postgres'te **tablo yeniden yazımı gerektirmez** ve veri kaybı
yoktur (varchar uzunluğunu artırmak metadata değişikliğidir).

`downgrade` bilinçli olarak **daraltmayı denemez**: 34'e daraltmak, o sırada
kaydedilmiş şifreli değerler varsa hata verir ya da veriyi keser.

Revision ID: 2df064134f6c
Revises: 195ffdb6fb1b
Create Date: 2026-07-30 10:47:47.920171

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import core.crypto

# revision identifiers, used by Alembic.
revision: str = '2df064134f6c'
down_revision: Union[str, Sequence[str], None] = '195ffdb6fb1b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS = [
    ("tutors", "iban"),
    ("libraries", "iban"),
    ("payout_records", "iban_snapshot"),
]


def upgrade() -> None:
    for table, column in _COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.VARCHAR(length=34),
            type_=core.crypto.EncryptedString(length=255),
            existing_nullable=True,
        )


def downgrade() -> None:
    # Bilinçli no-op: 34'e daraltmak kaydedilmiş şifreli değerleri kesebilir.
    pass
