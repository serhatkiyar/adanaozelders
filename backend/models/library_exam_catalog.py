from __future__ import annotations

import enum

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class ExamType(str, enum.Enum):
    """Deneme sınavı türü (bilgi amaçlı; net cezası bundan türetilir)."""

    TYT = "TYT"
    AYT = "AYT"
    YKS = "YKS"
    YDT = "YDT"
    LGS = "LGS"
    KPSS = "KPSS"
    OTHER = "OTHER"


class LibraryExamCatalog(Base, TimestampMixin, SoftDeleteMixin):
    """Deneme sınavının *içeriği* (blueprint) — fiziksel oturumdan (``LibraryExamSession``)
    ayrıştırılmıştır. Aynı "Türkiye Geneli Özdebir YKS-1" denemesini birden çok kütüphane
    kendi oturumunda uygulayabilir; ortak cevap anahtarı + (ileride) çapraz-kütüphane
    sıralama bu kök kayda bağlanır. Admin küratörlüğünde yönetilir.

    Oturum ile bağ **opsiyoneldir**: katalog seçilmeyen oturum bugünkü gibi tek-seferlik
    çalışır (``LibraryExamSession.catalog_id`` nullable).
    """

    __tablename__ = "library_exam_catalogs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Yayıncı/kurum: "Özdebir", "Töder", "Kurum Yayını"… (opsiyonel).
    publisher_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    exam_name: Mapped[str] = mapped_column(String(200), nullable=False)
    exam_type: Mapped[str] = mapped_column(String(20), nullable=False)  # TYT/AYT/YKS…
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    question_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Tüm kütüphaneler oturumlarında kullanabilir mi (true) yoksa yalnız küratör mü.
    is_public: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    # "Türkiye Geneli" ortak deneme rozeti (listede öne çıkarmak için).
    is_nationwide: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    # Cevap anahtarı: PDF/görsel (MinIO) veya yapılandırılmış JSON (oto-değerlendirme,
    # ileride). İkisi de opsiyonel; JSON kolonu Faz B için baştan ayrıldı.
    answer_key_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    answer_key_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    created_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_library_exam_catalogs_public", "is_public"),
        Index("ix_library_exam_catalogs_type", "exam_type"),
    )
