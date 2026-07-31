"""Özellik bayrakları — işletme kararlarının çalışma zamanı anahtarları.

Neden `.env` değil DB: ödeme kolları lansman sırasında **operatör kararıyla** ve
sürecin yeniden başlatılmasına gerek kalmadan açılıp kapanabilmelidir; her açma/
kapama denetim kaydına düşmelidir (kim, ne zaman). `.env` bunların hiçbirini
vermez.

Katalog (hangi anahtarlar var, varsayılanları ne) **kodda** tutulur
(`core/flags.py::FLAG_SPECS`) — tek doğruluk kaynağı odur. Bu tablo yalnız
"operatör bu anahtarı ne yaptı" bilgisini taşır; satırı olmayan bayrak katalog
varsayılanıyla çalışır. Aynı disiplin admin izin kataloğunda da kullanılıyor
(`core/admin_permissions.py`).

Soft-delete YOKTUR: bayrak silinmez, kapatılır.
"""
from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class FeatureFlag(Base, TimestampMixin):
    __tablename__ = "feature_flags"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # Son değişikliği yapan admin (hesap silinirse bayrak kalır → SET NULL).
    updated_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)

    __table_args__ = (Index("ix_feature_flags_key", "key", unique=True),)
