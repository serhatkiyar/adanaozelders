"""coupons + order discount

Revision ID: bd6c2f21ea39
Revises: e8399a73174a
Create Date: 2026-06-25 12:24:20.516542

Not: autogenerate ilgisiz şema drift'ini de yakalamıştı (libraries/name_change_requests/
task_filters/çeşitli index'ler); bunlar bu özelliğe ait DEĞİL ve elle çıkarıldı. Bu
migration yalnız kupon sistemini + orders indirim/kupon kolonlarını içerir.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bd6c2f21ea39'
down_revision: Union[str, Sequence[str], None] = 'e8399a73174a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'coupons',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(length=40), nullable=False),
        sa.Column('discount_type', sa.String(length=10), nullable=False),
        sa.Column('discount_value', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('min_subtotal', sa.Numeric(precision=10, scale=2), server_default=sa.text('0'), nullable=False),
        sa.Column('max_uses', sa.Integer(), nullable=True),
        sa.Column('per_user_limit', sa.Integer(), server_default=sa.text('1'), nullable=True),
        sa.Column('used_count', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('valid_from', sa.DateTime(timezone=True), nullable=True),
        sa.Column('valid_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint('discount_value > 0', name='ck_coupons_discount_positive'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('uq_coupons_code_active', 'coupons', ['code'], unique=True, postgresql_where=sa.text('deleted_at IS NULL'))

    op.create_table(
        'coupon_redemptions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('coupon_id', sa.Integer(), nullable=False),
        sa.Column('client_id', sa.Integer(), nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['coupon_id'], ['coupons.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_coupon_redemptions_client_id'), 'coupon_redemptions', ['client_id'], unique=False)
    op.create_index(op.f('ix_coupon_redemptions_coupon_id'), 'coupon_redemptions', ['coupon_id'], unique=False)

    op.add_column('orders', sa.Column('discount', sa.Numeric(precision=10, scale=2), server_default=sa.text('0'), nullable=False))
    op.add_column('orders', sa.Column('coupon_id', sa.Integer(), nullable=True))
    op.add_column('orders', sa.Column('coupon_code', sa.String(length=40), nullable=True))
    op.create_foreign_key('fk_orders_coupon_id', 'orders', 'coupons', ['coupon_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_orders_coupon_id', 'orders', type_='foreignkey')
    op.drop_column('orders', 'coupon_code')
    op.drop_column('orders', 'coupon_id')
    op.drop_column('orders', 'discount')

    op.drop_index(op.f('ix_coupon_redemptions_coupon_id'), table_name='coupon_redemptions')
    op.drop_index(op.f('ix_coupon_redemptions_client_id'), table_name='coupon_redemptions')
    op.drop_table('coupon_redemptions')
    op.drop_index('uq_coupons_code_active', table_name='coupons', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_table('coupons')
