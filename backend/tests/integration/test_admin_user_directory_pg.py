"""Admin dizini ve operasyon projeksiyonlarını gerçek PostgreSQL'de doğrular."""
from __future__ import annotations

import datetime
import uuid

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.audit_log import AuditLog
from models.booking import Booking, BookingStatus
from models.client import Client
from models.demand import Demand, DemandStatus
from models.demand_response import DemandResponse
from models.report import Report, ReportReason, ReportStatus
from models.tutor import Tutor, TutorStatus
from services import admin_service, audit_service, demand_service, report_service


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


@pytest.mark.asyncio
async def test_user_directory_pages_searches_and_projects_detail(pg):
    suffix = _uniq()
    tutor_id = client_id = 0
    try:
        async with AsyncSessionLocal() as session:
            tutor = Tutor(
                email=f"aranan-{suffix}@admin-directory.test",
                hashed_password="test-only",
                first_name="Aranan",
                last_name="Egitmen",
                role_id=2,
                status=TutorStatus.APPROVED,
            )
            client = Client(
                email=f"ogrenci-{suffix}@admin-directory.test",
                hashed_password="test-only",
                first_name="Diger",
                last_name="Ogrenci",
                role_id=3,
            )
            session.add_all([tutor, client])
            await session.flush()
            tutor_id, client_id = tutor.id, client.id
            await session.commit()

        async with AsyncSessionLocal() as session:
            items, total = await admin_service.list_users(
                session,
                q=f"aranan-{suffix}",
                role="TUTOR",
                limit=10,
                offset=0,
                sort="email",
                order="asc",
            )
            assert total == 1
            assert [item.id for item in items] == [tutor_id]
            assert items[0].role == "TUTOR"
            detail = await admin_service.get_user_detail(
                session, role="tutor", user_id=tutor_id
            )
            assert detail.email == f"aranan-{suffix}@admin-directory.test"
            assert detail.tutor_status == "APPROVED"
            assert detail.booking_count == detail.review_count == 0
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(text("DELETE FROM tutors WHERE id = :id"), {"id": tutor_id})
            await session.execute(text("DELETE FROM clients WHERE id = :id"), {"id": client_id})
            await session.commit()


@pytest.mark.asyncio
async def test_audit_and_report_admin_lists_return_filtered_totals(pg):
    suffix = _uniq()
    audit_id = report_id = 0
    try:
        async with AsyncSessionLocal() as session:
            audit = AuditLog(
                actor_id=987654,
                actor_role=1,
                action=f"test.{suffix}",
                target_type="test_target",
                target_id=123,
                details=f"benzersiz {suffix}",
            )
            report = Report(
                reporter_role=3,
                reporter_id=987654,
                target_type="TUTOR",
                target_id=123,
                reason=ReportReason.OTHER,
                status=ReportStatus.OPEN,
                description=f"benzersiz {suffix}",
            )
            session.add_all([audit, report])
            await session.flush()
            audit_id, report_id = audit.id, report.id
            await session.commit()

        async with AsyncSessionLocal() as session:
            logs, log_total = await audit_service.list_logs(
                session, q=suffix, limit=10, offset=0
            )
            assert log_total == 1
            assert [log.id for log in logs] == [audit_id]
            reports, report_total = await report_service.list_for_admin(
                session,
                status_filter=ReportStatus.OPEN,
                target_type="TUTOR",
                limit=100,
                offset=0,
            )
            assert report_total >= 1
            assert any(item.id == report_id for item in reports)
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(text("DELETE FROM audit_logs WHERE id = :id"), {"id": audit_id})
            await session.execute(text("DELETE FROM reports WHERE id = :id"), {"id": report_id})
            await session.commit()


@pytest.mark.asyncio
async def test_dashboard_runs_as_single_real_postgres_projection(pg):
    suffix = _uniq()
    client_id = 0
    try:
        async with AsyncSessionLocal() as session:
            client = Client(
                email=f"dashboard-{suffix}@admin-directory.test",
                hashed_password="test-only",
                first_name="Pano",
                last_name="Ogrenci",
                role_id=3,
            )
            session.add(client)
            await session.flush()
            client_id = client.id
            await session.commit()

        async with AsyncSessionLocal() as session:
            dashboard = await admin_service.get_dashboard(session, range_name="day")
            assert dashboard.range == "day"
            assert dashboard.new_clients >= 1
            assert dashboard.open_reports >= 0
            assert dashboard.open_demands >= 0
            assert dashboard.period_audit_logs >= 0
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(text("DELETE FROM clients WHERE id = :id"), {"id": client_id})
            await session.commit()


@pytest.mark.asyncio
async def test_admin_demand_queue_pages_searches_counts_and_cancels(pg):
    suffix = _uniq()
    client_id = tutor_id = demand_id = response_id = 0
    try:
        async with AsyncSessionLocal() as session:
            client = Client(
                email=f"demand-client-{suffix}@admin-directory.test",
                hashed_password="test-only",
                first_name="Talep",
                last_name="Sahibi",
                role_id=3,
            )
            tutor = Tutor(
                email=f"demand-tutor-{suffix}@admin-directory.test",
                hashed_password="test-only",
                first_name="Yanıt",
                last_name="Veren",
                role_id=2,
                status=TutorStatus.APPROVED,
            )
            session.add_all([client, tutor])
            await session.flush()
            demand = Demand(
                client_id=client.id,
                title=f"Matematik desteği {suffix}",
                subject="Matematik",
                description="Haftalık ders talebi",
            )
            session.add(demand)
            await session.flush()
            response = DemandResponse(demand_id=demand.id, tutor_id=tutor.id)
            session.add(response)
            await session.flush()
            client_id, tutor_id = client.id, tutor.id
            demand_id, response_id = demand.id, response.id
            await session.commit()

        async with AsyncSessionLocal() as session:
            items, total = await demand_service.list_admin_demands(
                session,
                q=suffix,
                status_filter=DemandStatus.OPEN,
                limit=10,
                offset=0,
                sort="response_count",
                order="desc",
            )
            assert total == 1
            assert items[0].id == demand_id
            assert items[0].client_name == "Talep Sahibi"
            assert items[0].response_count == 1
            await demand_service.cancel_demand_for_admin(session, demand_id)
            await session.commit()

        async with AsyncSessionLocal() as session:
            items, total = await demand_service.list_admin_demands(
                session, demand_id=demand_id, limit=1, offset=0
            )
            assert total == 1
            assert items[0].status == DemandStatus.CANCELLED.value
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(text("DELETE FROM demand_responses WHERE id = :id"), {"id": response_id})
            await session.execute(text("DELETE FROM demands WHERE id = :id"), {"id": demand_id})
            await session.execute(text("DELETE FROM tutors WHERE id = :id"), {"id": tutor_id})
            await session.execute(text("DELETE FROM clients WHERE id = :id"), {"id": client_id})
            await session.commit()


@pytest.mark.asyncio
async def test_admin_booking_queue_filters_and_returns_total(pg):
    suffix = _uniq()
    client_id = tutor_id = booking_id = 0
    try:
        async with AsyncSessionLocal() as session:
            client = Client(
                email=f"booking-client-{suffix}@admin-directory.test",
                hashed_password="test-only",
                first_name="Ders",
                last_name="Alan",
                role_id=3,
            )
            tutor = Tutor(
                email=f"booking-tutor-{suffix}@admin-directory.test",
                hashed_password="test-only",
                first_name="Ders",
                last_name="Veren",
                role_id=2,
                status=TutorStatus.APPROVED,
            )
            session.add_all([client, tutor])
            await session.flush()
            start = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30)
            booking = Booking(
                client_id=client.id,
                tutor_id=tutor.id,
                status=BookingStatus.PENDING,
                start_at=start,
                end_at=start + datetime.timedelta(hours=1),
                price=450,
                is_disputed=True,
            )
            session.add(booking)
            await session.flush()
            client_id, tutor_id, booking_id = client.id, tutor.id, booking.id
            await session.commit()

        async with AsyncSessionLocal() as session:
            items, total = await admin_service.list_bookings(
                session,
                q=suffix,
                status_filter=BookingStatus.PENDING,
                is_disputed=True,
                limit=10,
                offset=0,
                sort="price",
                order="desc",
            )
            assert total == 1
            assert items[0].id == booking_id
            assert items[0].tutor_name == "Ders Veren"
            assert items[0].client_name == "Ders Alan"
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(text("DELETE FROM bookings WHERE id = :id"), {"id": booking_id})
            await session.execute(text("DELETE FROM tutors WHERE id = :id"), {"id": tutor_id})
            await session.execute(text("DELETE FROM clients WHERE id = :id"), {"id": client_id})
            await session.commit()
