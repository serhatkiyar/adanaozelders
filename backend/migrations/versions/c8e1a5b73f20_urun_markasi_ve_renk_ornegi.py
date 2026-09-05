"""urun markasi ve nitelik degeri renk ornegi

İki bağımsız ama aynı pakete ait ekleme:

1. ``products.brand`` — marka/üretici. Kitapta yayınevi ayrı bir alandır ve
   marka onun yerine geçmez; kırtasiye ve eğitim materyalinde marka satın alma
   kararının doğrudan girdisidir ve bugüne dek yalnız tedarikçi kataloğunda
   vardı. schema.org ``Product.brand`` da buradan beslenir.

2. ``product_attribute_values.swatch_hex`` / ``swatch_image_url`` — varyant
   seçicisindeki "Renk" ekseninin metin butonu yerine gerçek bir renk örneği
   gösterebilmesi için. Örnek DEĞERE bağlanır, varyanta değil: "Kırmızı" bir
   kez tanımlanır ve o renkteki bütün bedenler aynı örneği gösterir.

Üç kolon da NULL doğar; doldurulana kadar davranış bugünküyle birebir aynıdır
(marka satırı çizilmez, seçici metin butonuna düşer).

Revision ID: c8e1a5b73f20
Revises: a3f7c21d9e04
Create Date: 2026-09-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8e1a5b73f20'
down_revision: Union[str, Sequence[str], None] = 'a3f7c21d9e04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('products', sa.Column('brand', sa.String(length=120), nullable=True))
    op.create_index('ix_products_brand', 'products', ['brand'])

    op.add_column(
        'product_attribute_values',
        sa.Column('swatch_hex', sa.String(length=7), nullable=True),
    )
    op.add_column(
        'product_attribute_values',
        sa.Column('swatch_image_url', sa.String(length=500), nullable=True),
    )
    # ELLE EKLENDİ: mevcut tabloya eklenen CHECK'leri autogenerate görmez.
    # Tanımlar models/store_merchandising.py::ProductAttributeValue ile birebir.
    op.create_check_constraint(
        'ck_product_attribute_values_swatch_tek',
        'product_attribute_values',
        'swatch_hex IS NULL OR swatch_image_url IS NULL',
    )
    op.create_check_constraint(
        'ck_product_attribute_values_swatch_hex',
        'product_attribute_values',
        "swatch_hex IS NULL OR swatch_hex ~ '^#[0-9A-Fa-f]{6}$'",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'ck_product_attribute_values_swatch_hex',
        'product_attribute_values',
        type_='check',
    )
    op.drop_constraint(
        'ck_product_attribute_values_swatch_tek',
        'product_attribute_values',
        type_='check',
    )
    op.drop_column('product_attribute_values', 'swatch_image_url')
    op.drop_column('product_attribute_values', 'swatch_hex')

    op.drop_index('ix_products_brand', table_name='products')
    op.drop_column('products', 'brand')
