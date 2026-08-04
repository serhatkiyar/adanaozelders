"""auth_version kolonu tüm giriş hesabı tablolarına (İP-3 §6).

Şifre değişimi/sıfırlaması ve hesap kapatma oturum sürümünü artırır; access
token'daki ``auth_ver`` claim'i her istekte bu kolonla karşılaştırılır. Kolon
bugüne dek yalnız ``courier_accounts``'ta vardı (8590183c3cc1); diğer dört rol
tablosuna aynı tanımla eklenir. ``server_default=1`` mevcut satırları geçerli
sürümle doldurur — deploy sonrası eski access token'lar (claim'siz) düşer ama
refresh token'lar geçerli kaldığı için istemci sessiz yenilemeyle devam eder.

Revision ID: ip3_auth_version_all_roles
Revises: ip2b_terminal_history_guard
Create Date: 2026-08-01

## `down_revision` neden f29c DEĞİL

Bu revizyon İP-3 dalında `f29c_damage_idem_actor_scope` üzerine yazıldı. Güncel
main ise aynı revizyonun üstüne F30 (`f30_paketleme_semasi`) ve İP-2b
(`ip2b_terminal_history_guard`) zincirini koydu. İki dal birleşince zincir
`f29c`'de ÇATALLANDI ve `alembic upgrade head` boş bir veritabanında
"Multiple head revisions are present" ile DÜŞTÜ — yani hem uygulama açılışı
(`core/migrations.py::ensure_schema`) hem de entegrasyon testlerinin tek
kullanımlık DB kurulumu kırılıyordu.

Bu revizyon yalnızca dört rol tablosuna (`admins`/`tutors`/`clients`/
`library_operators`) bir kolon ekler; F30 paketleme ve İP-2b terminal-durum
şemalarıyla hiçbir nesneyi paylaşmaz. Bu yüzden güvenli çözüm, zinciri main
tarafının ucuna bağlayıp tek head'e dönmektir — merge revizyonu üretmeye veya
şemayı değiştirmeye gerek yoktur.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ip3_auth_version_all_roles"
down_revision = "ip2b_terminal_history_guard"
branch_labels = None
depends_on = None

_TABLES = ("admins", "tutors", "clients", "library_operators")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column(
                "auth_version",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("1"),
            ),
        )


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.drop_column(table, "auth_version")
