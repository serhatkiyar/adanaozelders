from __future__ import annotations

import datetime
import enum

from pydantic import BaseModel, ConfigDict, Field


class HabitPeriod(str, enum.Enum):
    DAILY = "daily"
    WEEKLY = "weekly"


class HabitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=8)
    period: HabitPeriod = HabitPeriod.DAILY
    target_per_period: int = Field(default=1, ge=1, le=50)


class HabitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=8)
    period: HabitPeriod | None = None
    target_per_period: int | None = Field(default=None, ge=1, le=50)


class HabitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str | None = None
    icon: str | None = None
    period: HabitPeriod
    target_per_period: int
    created_at: datetime.datetime

    # Servis katmanında hesaplanıp instance'a iliştirilen geçici alanlar.
    current_streak: int = 0
    longest_streak: int = 0
    total_completions: int = 0
    # İçinde bulunulan periyodun ilerlemesi (günlük=bugün, haftalık=bu hafta).
    period_count: int = 0
    today_count: int = 0
    done: bool = False
    # Isı haritası için son ~17 haftanın günlük sayaçları: {"YYYY-MM-DD": count}.
    recent: dict[str, int] = Field(default_factory=dict)


class HabitCheckIn(BaseModel):
    # İşaretlenecek/güncellenecek gün (kullanıcının yerel günü).
    entry_date: datetime.date
    # +1 işaretle/artır, -1 geri al/azalt. Sayaç [0, 99] aralığında tutulur.
    delta: int = Field(default=1, ge=-50, le=50)
    # Seri/ilerleme hesabının referans aldığı "bugün" (yerel). Yoksa entry_date.
    on: datetime.date | None = None
