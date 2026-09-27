from __future__ import annotations

import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.storage_types import PublicAsset
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
    # Eğitmen browse'ında öğrencinin görünen adı (eşleşen taleplerde doldurulur).
    client_name: str | None = None
    # Eğitmen browse'ında: bu eğitmen talebe daha önce yanıt verdi mi.
    responded: bool = False
    # Öğrenci kendi talebinde: gelen yanıt sayısı.
    response_count: int = 0


class DemandResponseCreate(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class DemandResponseOut(BaseModel):
    """Öğrencinin kendi talebinde gördüğü yanıtlayan eğitmen kartı."""

    tutor_id: int
    tutor_name: str
    tutor_avatar_url: PublicAsset | None = None
    headline: str | None = None
    responded_at: datetime.datetime


class DemandRespondResult(BaseModel):
    """Eğitmen yanıt verince dönen sonuç — frontend sohbete yönlendirir."""

    conversation_id: int
    client_id: int
    client_name: str
