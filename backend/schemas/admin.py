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
