from __future__ import annotations

import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class AdminStats(BaseModel):
    total_clients: int
    total_tutors: int
    total_admins: int
    approved_tutors: int
    pending_tutors: int
    total_bookings: int
    active_bookings: int
    completed_bookings: int
    total_reviews: int


class AdminDashboardOut(BaseModel):
    range: str
    period_start: datetime.datetime
    previous_period_start: datetime.datetime
    new_clients: int
    previous_new_clients: int
    new_tutors: int
    previous_new_tutors: int
    new_orders: int
    previous_new_orders: int
    pending_tutors: int
    pending_diplomas: int
    active_bookings: int
    open_demands: int
    disputed_bookings: int
    open_reports: int
    paid_orders: int
    pending_returns: int
    low_stock_products: int
    pending_libraries: int
    active_delivery_runs: int
    period_audit_logs: int


class AdminRevenueOut(BaseModel):
    """Para metrikleri. Tutarlar Decimal (float yuvarlama hatası para raporunda
    kabul edilemez); istemci string olarak alır ve formatlar."""

    range: str
    period_start: datetime.datetime
    previous_period_start: datetime.datetime

    #: Brüt işlem hacmi (ders + kütüphane + mağaza).
    gmv: Decimal
    #: Platform geliri = pazaryeri komisyonu + kendi ürün cirosu.
    revenue: Decimal
    commission_revenue: Decimal
    direct_sales_revenue: Decimal
    #: Emanetteki para — HENÜZ GELİR DEĞİL (iade edilebilir).
    held: Decimal
    refunded: Decimal
    refund_rate: float
    orders: int
    aov: Decimal
    lesson_gmv: Decimal
    library_gmv: Decimal
    store_gmv: Decimal

    previous_gmv: Decimal
    previous_revenue: Decimal
    previous_commission_revenue: Decimal
    previous_direct_sales_revenue: Decimal
    previous_held: Decimal
    previous_refunded: Decimal
    previous_orders: int
    previous_aov: Decimal
    previous_lesson_gmv: Decimal
    previous_library_gmv: Decimal
    previous_store_gmv: Decimal


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str
    last_name: str
    username: str
    full_name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime.datetime


class AdminUserDetailOut(AdminUserOut):
    updated_at: datetime.datetime
    last_seen_at: datetime.datetime | None = None
    email_verified: bool
    tutor_status: str | None = None
    booking_count: int = 0
    review_count: int = 0
    demand_count: int = 0
    order_count: int = 0


class AdminDemandOut(BaseModel):
    id: int
    client_id: int
    client_name: str
    client_email: str
    title: str
    description: str | None = None
    subject: str
    level: str | None = None
    budget_min: Decimal | None = None
    budget_max: Decimal | None = None
    status: str
    response_count: int
    created_at: datetime.datetime


class AdminBookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tutor_id: int
    client_id: int
    status: str
    start_at: datetime.datetime
    end_at: datetime.datetime
    price: float | None = None
    notes: str | None = None
    cancel_reason: str | None = None
    is_disputed: bool
    admin_notes: str | None = None
    created_at: datetime.datetime

    tutor_name: str | None = None
    client_name: str | None = None


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: int
    actor_role: int
    action: str
    target_type: str
    target_id: int | None = None
    details: str | None = None
    reason: str | None = None
    before_values: dict | None = None
    after_values: dict | None = None
    meta: dict | None = None
    ip_address: str | None = None
    request_id: str | None = None
    created_at: datetime.datetime
