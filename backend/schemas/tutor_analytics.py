from __future__ import annotations

import datetime
from typing import Literal

from pydantic import BaseModel

Period = Literal["week", "month", "quarter"]


class MetricTrend(BaseModel):
    value: float
    previous: float
    # Önceki dönem 0 ise yüzde anlamsızdır → None.
    trend_pct: int | None = None


class TutorOverviewOut(BaseModel):
    period: Period
    current_start: datetime.datetime
    current_end: datetime.datetime
    previous_start: datetime.datetime
    previous_end: datetime.datetime
    earnings: MetricTrend
    lessons: MetricTrend
    active_students: MetricTrend
    new_students: MetricTrend


class SuccessGoalOut(BaseModel):
    code: Literal["CANCEL_RATE", "MISSED_LESSONS", "RESPONSE_24H", "RATING"]
    # None → veri yetersiz (örneklem eşiğin altında).
    value: float | None = None
    target: float
    comparator: Literal["lte", "gte", "eq"]
    achieved: bool | None = None
    sample: int
    live: bool = False
