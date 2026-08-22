"""Duyuru şeridi şemaları — kamuya açık tekil kayıt + admin CRUD."""
from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.duyuru import DuyuruVaryant


def _dolu_mu(deger: str | None) -> bool:
    """Boşluktan ibaret metin de "boş" sayılır — yalnız `None` değil."""
    return bool(deger and deger.strip())


def _link_tutarli_mi(link_url: str | None, link_metni: str | None) -> bool:
    return _dolu_mu(link_url) == _dolu_mu(link_metni)


class DuyuruAktifOut(BaseModel):
    """Public uç (`GET /duyuru-seridi/aktif`) — yalnız gösterime gereken alanlar."""

    metin: str
    link_url: str | None = None
    link_metni: str | None = None
    varyant: DuyuruVaryant


class DuyuruOut(BaseModel):
    """Admin liste/detay — tüm alanlar."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    metin: str
    link_url: str | None = None
    link_metni: str | None = None
    varyant: DuyuruVaryant
    aktif: bool
    baslangic_at: datetime.datetime | None = None
    bitis_at: datetime.datetime | None = None
    sira: int
    created_at: datetime.datetime
    updated_at: datetime.datetime


class DuyuruCreate(BaseModel):
    metin: str = Field(min_length=1, max_length=160)
    link_url: str | None = Field(default=None, max_length=2000)
    link_metni: str | None = Field(default=None, max_length=40)
    varyant: DuyuruVaryant = DuyuruVaryant.bilgi
    aktif: bool = False
    baslangic_at: datetime.datetime | None = None
    bitis_at: datetime.datetime | None = None
    sira: int = 0

    @model_validator(mode="after")
    def _check(self):
        if not _link_tutarli_mi(self.link_url, self.link_metni):
            raise ValueError(
                "link_url doluysa link_metni zorunludur; ikisi de boş ya da ikisi de dolu olmalı."
            )
        if (
            self.bitis_at is not None
            and self.baslangic_at is not None
            and self.bitis_at <= self.baslangic_at
        ):
            raise ValueError("bitis_at, baslangic_at'ten sonra olmalı")
        return self


class DuyuruUpdate(BaseModel):
    """PATCH — gönderilmeyen alan mevcut değeri korur (`exclude_unset`)."""

    metin: str | None = Field(default=None, min_length=1, max_length=160)
    link_url: str | None = Field(default=None, max_length=2000)
    link_metni: str | None = Field(default=None, max_length=40)
    varyant: DuyuruVaryant | None = None
    aktif: bool | None = None
    baslangic_at: datetime.datetime | None = None
    bitis_at: datetime.datetime | None = None
    sira: int | None = None

    @model_validator(mode="after")
    def _check(self):
        # Yalnız İKİSİ de bu istekte gönderildiyse burada doğrulanır; tek
        # taraflı PATCH'in (ör. yalnız link_metni) mevcut satırla birleşimi
        # servis katmanında + DB CHECK'inde (`ck_duyuru_seridi_*`) denetlenir.
        gonderilenler = self.model_fields_set
        if "link_url" in gonderilenler and "link_metni" in gonderilenler:
            if not _link_tutarli_mi(self.link_url, self.link_metni):
                raise ValueError(
                    "link_url doluysa link_metni zorunludur; ikisi de boş ya da ikisi de dolu olmalı."
                )
        if (
            "bitis_at" in gonderilenler
            and "baslangic_at" in gonderilenler
            and self.bitis_at is not None
            and self.baslangic_at is not None
            and self.bitis_at <= self.baslangic_at
        ):
            raise ValueError("bitis_at, baslangic_at'ten sonra olmalı")
        return self
