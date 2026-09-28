from sqlalchemy import union_all
from sqlalchemy.dialects import postgresql

from schemas.admin import AdminDashboardOut, AdminUserDetailOut
from services.admin_service import _user_directory_selects


def test_user_directory_uses_all_three_role_tables():
    statements = _user_directory_selects(role=None, q=None)
    assert len(statements) == 3
    sql = str(
        union_all(*statements).compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "UNION ALL" in sql
    assert "admins.deleted_at IS NULL" in sql
    assert "tutors.deleted_at IS NULL" in sql
    assert "clients.deleted_at IS NULL" in sql


def test_user_directory_role_and_search_are_applied_in_sql():
    statements = _user_directory_selects(role="TUTOR", q="ali")
    assert len(statements) == 1
    sql = str(
        statements[0].compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "FROM tutors" in sql
    assert "ILIKE" in sql
    assert "%ali%" in sql
    assert "FROM admins" not in sql


def test_admin_user_detail_schema_contains_only_projected_summary_fields():
    fields = set(AdminUserDetailOut.model_fields)
    assert {"booking_count", "review_count", "demand_count", "order_count"} <= fields
    assert "hashed_password" not in fields
    assert "verification_tckn" not in fields


def test_dashboard_schema_exposes_only_decision_support_metrics():
    fields = set(AdminDashboardOut.model_fields)
    assert {"new_clients", "open_reports", "low_stock_products", "period_audit_logs"} <= fields
    assert "support_ticket_count" not in fields


def test_admin_name_change_and_payout_history_carry_person_name():
    # Güncel ad YALNIZ admin şemasında; kullanıcının kendi uçları paylaşılan
    # `NameChangeRequestOut`u kullanır ve bu alanları taşımaz.
    from api.routers.payouts import PayoutRecordOut
    from schemas.user import AdminNameChangeRequestOut, NameChangeRequestOut

    assert {"current_first_name", "current_last_name"} <= set(
        AdminNameChangeRequestOut.model_fields
    )
    assert "current_first_name" not in NameChangeRequestOut.model_fields
    assert "payee_name" in PayoutRecordOut.model_fields
