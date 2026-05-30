from __future__ import annotations

import datetime

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
    created_at: datetime.datetime
