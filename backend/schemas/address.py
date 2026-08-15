from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# İl/ilçe YAPISALDIR ve zorunludur (İP-19 K-10 + bağımsız denetim B-3):
# kendi-filo teslimat bölgesinin otoritesi artık ilçe listesidir, harita pin'i
# değil. Boş bırakılan ilçe, siparişi sessizce "bölge dışı" yapar ve düşeceği
# dış kargo kuyruğu henüz yazılmadı (İP-20). Yalnız beyaz boşluktan ibaret
# değer de reddedilir — `"   "` bölge eşleşmesinde boşla aynı şeydir.
ZorunluYer = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
OpsiyonelYer = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]


class AddressCreate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    recipient_name: str | None = Field(default=None, max_length=150)
    phone: str | None = Field(default=None, max_length=30)
    address_line: str = Field(min_length=1, max_length=2000)
    city: ZorunluYer
    district: ZorunluYer
    door_no: str | None = Field(default=None, max_length=20)
    apt_no: str | None = Field(default=None, max_length=20)
    directions: str | None = Field(default=None, max_length=2000)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    is_default: bool = False


class AddressUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    recipient_name: str | None = Field(default=None, max_length=150)
    phone: str | None = Field(default=None, max_length=30)
    address_line: str | None = Field(default=None, min_length=1, max_length=2000)
    # Kısmi güncelleme kipi korunur: alan gönderilmezse (`None`) dokunulmaz.
    # Gönderilirse BOŞ OLAMAZ — dolu bir adresin bölge sınıfı silinemesin.
    city: OpsiyonelYer | None = None
    district: OpsiyonelYer | None = None
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
    recipient_name: str | None = None
    phone: str | None = None
    address_line: str
    city: str | None = None
    district: str | None = None
    door_no: str | None = None
    apt_no: str | None = None
    directions: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    is_default: bool
