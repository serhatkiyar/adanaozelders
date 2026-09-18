"""Kök SEO adres kaydı — kökteki bütün dinamik adresler TEK tabloda.

Kök yola (`/lgs-yks-matematik-seyhan`, `/matematik-ozel-ders`, `/seyhan`)
üç ayrı tür oturur: ilan, ders ve ilçe. Aynı ad iki türe verilemesin diye
hepsi burada durur ve `slug` GLOBAL benzersizdir — eski (tarihçe) satırlar
dahil. Böylece bir kez yayınlanmış adres başka bir kayda asla geçmez; eski
adres her zaman yeni adrese kalıcı yönlenir.

Kural özeti (ayrıntı: `core/seo_adres.py`):
  * `ilan`: eğitmenin ilan adresi. İLK YAYINDA başlıktan üretilir ve
    sabitlenir; başlık sonradan düzeltilince adres DEĞİŞMEZ.
  * `ders`: `<ders-slug>-ozel-ders`. Ders slug'ı değişirse eski satır
    tarihçeye düşer (`is_current = false`) ve yeni adrese yönlenir.
  * `ilce`: Adana ilçesi (`seyhan`). İlçe sayfası `/<ilce>/<ders>-ozel-ders`.

`is_current = false` satır TARİHÇEDİR: aynı hedefin güncel satırına 301 verir.
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin

SEO_TURLERI = ("ilan", "ders", "ilce")


class SeoSlug(Base, TimestampMixin):
    __tablename__ = "seo_slugs"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    #: ilan | ders | ilce
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    tutor_id: Mapped[int | None] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=True
    )
    subject_id: Mapped[int | None] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), nullable=True
    )
    #: İlçe satırında kanonik ilçe adı ("Çukurova").
    district: Mapped[str | None] = mapped_column(String(80), nullable=True)
    #: false = tarihçe (eski adres); güncel adrese kalıcı yönlenir.
    is_current: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index("uq_seo_slugs_slug", "slug", unique=True),
        CheckConstraint(
            "kind IN ('ilan', 'ders', 'ilce')", name="ck_seo_slugs_kind"
        ),
        CheckConstraint(
            "(kind = 'ilan' AND tutor_id IS NOT NULL)"
            " OR (kind = 'ders' AND subject_id IS NOT NULL)"
            " OR (kind = 'ilce' AND district IS NOT NULL)",
            name="ck_seo_slugs_hedef",
        ),
        # Bir hedefin EN FAZLA bir güncel adresi olur.
        Index(
            "uq_seo_slugs_ilan_guncel",
            "tutor_id",
            unique=True,
            postgresql_where=text("kind = 'ilan' AND is_current"),
        ),
        Index(
            "uq_seo_slugs_ders_guncel",
            "subject_id",
            unique=True,
            postgresql_where=text("kind = 'ders' AND is_current"),
        ),
        Index("ix_seo_slugs_tutor_id", "tutor_id"),
        Index("ix_seo_slugs_subject_id", "subject_id"),
    )


