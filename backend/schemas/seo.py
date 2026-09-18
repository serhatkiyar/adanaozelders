"""Kök SEO sayfaları (Modül 6) — public şemalar.

Ders/ilçe sayfası ve ilan sayfasının başlığı, açıklaması, yapısal verisi ve
sık sorulan soruları SUNUCUDA üretilir; hem ön-çizilmiş HTML hem React
sayfası aynı yanıtı kullanır. Böylece arama motoruna ve kullanıcıya giden
içerik iki ayrı yerde yazılıp ayrışamaz.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from schemas.tutor import TutorSearchOut


class SeoBaglanti(BaseModel):
    ad: str
    yol: str
    egitmen_sayisi: int | None = None


class SeoSss(BaseModel):
    soru: str
    cevap: str


class DersIstatistik(BaseModel):
    """Sayfadaki bütün sayılar yayındaki eğitmenlerden sunucuda hesaplanır."""

    egitmen_sayisi: int
    ucretli_sayisi: int
    en_dusuk_ucret: int | None = None
    en_yuksek_ucret: int | None = None
    ortalama_ucret: int | None = None
    yuz_yuze_sayisi: int
    online_sayisi: int
    ilk_ders_ucretsiz_sayisi: int
    yorum_sayisi: int
    ortalama_puan: float | None = None


class DersSayfasiOut(BaseModel):
    tur: Literal["ders", "ilce"]
    yol: str
    ders_adi: str
    ders_slug: str
    ilce_adi: str | None = None
    ilce_slug: str | None = None
    baslik: str
    h1: str
    aciklama: str
    ozet: str
    istatistik: DersIstatistik
    egitmenler: list[TutorSearchOut]
    ilceler: list[SeoBaglanti]
    ilgili_dersler: list[SeoBaglanti]
    sss: list[SeoSss]
    kirintilar: list[SeoBaglanti]
    #: Aynı süzgeçle açılan arama sayfası ("tüm öğretmenleri gör").
    arama_yolu: str
    json_ld: list[dict[str, Any]]


class IlanSayfasiOut(BaseModel):
    tur: Literal["ilan"] = "ilan"
    yol: str
    tutor_id: int
    url_slug: str
    baslik: str
    aciklama: str
    kirintilar: list[SeoBaglanti]
    json_ld: list[dict[str, Any]]


class YonlendirmeOut(BaseModel):
    tur: Literal["yonlendir"] = "yonlendir"
    hedef: str


SeoSayfaOut = Annotated[
    DersSayfasiOut | IlanSayfasiOut | YonlendirmeOut, Field(discriminator="tur")
]


class PopulerDersOut(BaseModel):
    ad: str
    yol: str
    egitmen_sayisi: int
