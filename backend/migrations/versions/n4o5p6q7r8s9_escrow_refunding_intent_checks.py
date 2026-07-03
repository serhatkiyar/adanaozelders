"""escrow: REFUNDING durumu + iade intent kolonları + conservation CHECK'leri

Para yolu denetimi (money-path-audit) kapsamında:
- payments.status enum'una REFUNDING eklenir (iki fazlı iade — intent kalıcı).
  Exam/study status kolonları String olduğundan enum değişikliği gerekmez.
- Üç escrow modeline iade intent alanları: refund_requested_at, refund_attempts
  (reconciler karantina penceresi + deneme sınırı bunlardan yürür).
- M1: conservation invariant'ı DB'ye iner — amount = commission + earning; ayrıca
  commission_rate [0, 1] aralığına kilitlenir.

Revision ID: n4o5p6q7r8s9
Revises: 36b23ff9b9a8
Create Date: 2026-07-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "n4o5p6q7r8s9"
down_revision: Union[str, Sequence[str], None] = "36b23ff9b9a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("payments", "exam_registrations", "study_reservations")
_RATE_CK_NAMES = {
    "payments": "ck_payments_commission_rate_range",
    "exam_registrations": "ck_exam_reg_commission_rate_range",
    "study_reservations": "ck_study_res_commission_rate_range",
}


def upgrade() -> None:
    # PG 12+ transaction içinde ADD VALUE'ya izin verir (değer aynı transaction'da
    # KULLANILAMAZ — burada kullanılmıyor). IF NOT EXISTS: yeniden koşuya dayanıklı.
    op.execute("ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'REFUNDING'")

    for table in _TABLES:
        op.add_column(
            table,
            sa.Column(
                "refund_requested_at", sa.DateTime(timezone=True), nullable=True
            ),
        )
        op.add_column(
            table,
            sa.Column(
                "refund_attempts",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )
        op.create_check_constraint(
            _RATE_CK_NAMES[table],
            table,
            "commission_rate >= 0 AND commission_rate <= 1",
        )

    op.create_check_constraint(
        "ck_payments_conservation",
        "payments",
        "amount = commission_amount + tutor_earning",
    )
    op.create_check_constraint(
        "ck_exam_reg_conservation",
        "exam_registrations",
        "amount = commission_amount + library_earning",
    )
    op.create_check_constraint(
        "ck_study_res_conservation",
        "study_reservations",
        "amount = commission_amount + library_earning",
    )


def downgrade() -> None:
    op.drop_constraint("ck_study_res_conservation", "study_reservations")
    op.drop_constraint("ck_exam_reg_conservation", "exam_registrations")
    op.drop_constraint("ck_payments_conservation", "payments")
    op.drop_constraint("ck_study_res_commission_rate_range", "study_reservations")
    op.drop_constraint("ck_exam_reg_commission_rate_range", "exam_registrations")
    op.drop_constraint("ck_payments_commission_rate_range", "payments")
    for table in _TABLES:
        op.drop_column(table, "refund_attempts")
        op.drop_column(table, "refund_requested_at")
    # NOT: PG enum'undan değer düşürmek desteklenmez; 'REFUNDING' enum'da kalır
    # (kullanılmadığı sürece zararsız).
