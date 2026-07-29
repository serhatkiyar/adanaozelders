"""iban at-rest sifreleme

TCKN şifreli saklanırken IBAN düz metin duruyordu. Oysa IBAN da ad-soyadla
birlikte doğrudan finansal kimlik verisidir ve bir veritabanı sızıntısında
"parayı nereye göndereceğiz" bilgisini tek başına verir.

Üç kolon şifrelenir: tutors.iban, libraries.iban (PayoutMixin) ve
payout_records.iban_snapshot — kaynağı şifreleyip snapshot'ı düz bırakmak
şifrelemeyi anlamsız kılardı, aynı IBAN orada okunurdu.

VERİ TAŞIMA: kolonlar genişletilir (Fernet token'ı ~150 karaktere şişer) ve
mevcut düz metin değerler yerinde şifrelenir. Şifreleme mantığı bu dosyaya
KOPYALANMIŞTIR; migration uygulama koduna bağlı olmamalıdır — core.crypto
yarın değişirse bu migration yine de bugünkü sonucu üretmelidir. Anahtar
türetmesi core.crypto ile birebir aynıdır (FIELD_ENCRYPTION_KEY, yoksa
JWT_SECRET_KEY). Anahtar değişirse eski veri çözülemez.

Revision ID: 3fe0fd1ed73b
Revises: fe604508a162
Create Date: 2026-07-29 10:16:06.825860

"""
import base64
import hashlib
import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from cryptography.fernet import Fernet

# revision identifiers, used by Alembic.
revision: str = '3fe0fd1ed73b'
down_revision: Union[str, Sequence[str], None] = 'fe604508a162'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (tablo, kolon) — hepsi nullable String; sabit liste (SQL'e enterpolasyon
# yalnız buradan gelir, kullanıcı girdisi değildir).
_TARGETS = [
    ("tutors", "iban"),
    ("libraries", "iban"),
    ("payout_records", "iban_snapshot"),
]

# Fernet token'ları bu ön ekle başlar; yeniden çalıştırmada çift şifrelemeyi önler.
_TOKEN_PREFIX = "gAAAAA"


def _fernet() -> Fernet:
    raw = os.getenv("FIELD_ENCRYPTION_KEY") or os.getenv("JWT_SECRET_KEY") or "dev"
    key = base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest())
    return Fernet(key)


def _rows(conn, table: str, column: str):
    return conn.execute(
        sa.text(
            f"SELECT id, {column} FROM {table} "  # noqa: S608 - sabit liste
            f"WHERE {column} IS NOT NULL AND {column} <> ''"
        )
    ).fetchall()


def _write(conn, table: str, column: str, row_id: int, value: str | None) -> None:
    conn.execute(
        sa.text(f"UPDATE {table} SET {column} = :v WHERE id = :i"),  # noqa: S608
        {"v": value, "i": row_id},
    )


def upgrade() -> None:
    for table, column in _TARGETS:
        op.alter_column(
            table,
            column,
            existing_type=sa.String(length=34),
            type_=sa.String(length=255),
            existing_nullable=True,
        )

    conn = op.get_bind()
    f = _fernet()
    for table, column in _TARGETS:
        for row_id, value in _rows(conn, table, column):
            if str(value).startswith(_TOKEN_PREFIX):
                continue  # zaten şifreli
            _write(conn, table, column, row_id, f.encrypt(str(value).encode()).decode())


def downgrade() -> None:
    """Şifreyi çözüp kolonu daraltır.

    Çözülemeyen değer (anahtar değişmiş) NULL'lanır: düz metin gibi görünen bir
    çöp bırakmak, sonradan yanlış IBAN'a ödeme yapılmasına yol açabilir.
    """
    conn = op.get_bind()
    f = _fernet()
    for table, column in _TARGETS:
        for row_id, value in _rows(conn, table, column):
            try:
                plain = f.decrypt(str(value).encode()).decode()
            except Exception:  # noqa: BLE001 - bozuk/eski anahtar
                plain = None
            _write(conn, table, column, row_id, plain)

    for table, column in _TARGETS:
        op.alter_column(
            table,
            column,
            existing_type=sa.String(length=255),
            type_=sa.String(length=34),
            existing_nullable=True,
        )
