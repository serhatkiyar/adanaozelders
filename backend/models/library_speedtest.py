from __future__ import annotations

from decimal import Decimal

from sqlalchemy import ForeignKey, Index, Integer, Numeric
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class LibrarySpeedTest(Base, TimestampMixin):
    """Kütüphanede yapılan internet (wifi) hız testi kaydı.

    Ölçüm tarayıcıda gerçek indirme/yükleme/ping ile yapılır (mock yok); sonuç
    buraya kaydedilir. Öğrenci (CLIENT) atıfıyla tutulur; ortalamalar kütüphane
    profilinde herkese açık gösterilir. Soft-delete yok — ham telemetri.
    """

    __tablename__ = "library_speedtests"

    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    download_mbps: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False)
    upload_mbps: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False)
    ping_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        Index("ix_library_speedtests_library", "library_id"),
    )
