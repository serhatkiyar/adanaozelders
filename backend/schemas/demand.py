from __future__ import annotations

import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.demand import DemandStatus


class DemandCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    subject: str = Field(min_length=1, max_length=150)
    level: str | None = Field(default=None, max_length=100)
    budget_min: Decimal | None = Field(
        default=None, ge=0, max_digits=10, decimal_places=2
    )
    budget_max: Decimal | None = Field(
        default=None, ge=0, max_digits=10, decimal_places=2
    )

    @model_validator(mode="after")
    def _check_budget_range(self) -> "DemandCreate":
        if (
            self.budget_min is not None
            and self.budget_max is not None
            and self.budget_max < self.budget_min
        ):
            raise ValueError("budget_max must be >= budget_min")
        return self


class DemandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    client_id: int
    title: str
    description: str | None = None
    subject: str
    level: str | None = None
    budget_min: Decimal | None = None
    budget_max: Decimal | None = None
    status: DemandStatus
    created_at: datetime.datetime
