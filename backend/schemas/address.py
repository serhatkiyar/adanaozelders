from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class AddressCreate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    address_line: str = Field(min_length=1, max_length=2000)
    door_no: str | None = Field(default=None, max_length=20)
    apt_no: str | None = Field(default=None, max_length=20)
    directions: str | None = Field(default=None, max_length=2000)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    is_default: bool = False


class AddressUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    address_line: str | None = Field(default=None, min_length=1, max_length=2000)
    door_no: str | None = Field(default=None, max_length=20)
    apt_no: str | None = Field(default=None, max_length=20)
    directions: str | None = Field(default=None, max_length=2000)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    is_default: bool | None = None


class AddressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    address_line: str
    door_no: str | None = None
    apt_no: str | None = None
    directions: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    is_default: bool
