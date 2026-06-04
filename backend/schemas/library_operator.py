from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class OperatorCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=75)
    last_name: str = Field(min_length=1, max_length=75)


class OperatorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    library_id: int
    is_active: bool
    created_at: datetime.datetime
    # Operatör girişinde (whoami) hangi kütüphaneyi yönettiğini göstermek için.
    library_name: str | None = None
