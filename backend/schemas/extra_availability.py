from __future__ import annotations

import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from schemas.time_off import _Aralik


class ExtraAvailabilityIn(_Aralik):
    pass


class ExtraAvailabilityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    start_at: datetime.datetime
    end_at: datetime.datetime


class ExtraAvailabilityCreatedOut(BaseModel):
    extra: ExtraAvailabilityOut
    # MIN_NOTICE: aralığın 24 saatten yakın kısmı öğrencilere kapalı.
    warnings: list[Literal["MIN_NOTICE"]] = []
