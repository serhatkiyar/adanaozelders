from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    message: str
    link: str | None = None
    is_read: bool
    created_at: datetime.datetime
