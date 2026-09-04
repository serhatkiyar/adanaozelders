"""iki head birlesimi: ders taksonomisi + kismi teslimat

NEDEN VAR: 4 Eylül sabahı iki zincir aynı anda main'e girdi —
`kismi teslimat` dalı (c5a1b9e7d3f2 → d7e2f4a6c918 → e8b3c1d95a47) merge ile,
`ders taksonomisi` (c7f1a2d84b93 → b27db6c5d4b6 → e4a91c37f2d8 → c424a7682128)
doğrudan. Sonuç iki ayrı head oldu ve `alembic upgrade head` "Multiple head
revisions are present" ile DURDU.

Bu ciddiydi: `core/migrations.ensure_schema` uygulama açılışında `upgrade head`
koşuyor — yani backend yeniden başlatıldığında hiç açılmazdı.

Bu revizyon ŞEMAYA DOKUNMAZ; yalnız iki dalı tek head'de birleştirir. İki
zincir farklı tablolara dokunduğu için (biri `subjects`/`tutor_subjects`,
diğeri `order_packages`/`delivery_stops`) çakışan bir DDL yok — birleşimin
gövdesinin boş olması bu yüzden doğru, eksik değil.

Revision ID: 31b82914cbe3
Revises: c424a7682128, e8b3c1d95a47
Create Date: 2026-09-04

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = '31b82914cbe3'
down_revision: Union[str, Sequence[str], None] = ('c424a7682128', 'e8b3c1d95a47')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Yalnız birleşim — şema değişikliği yok."""


def downgrade() -> None:
    """Yalnız birleşim — şema değişikliği yok."""
