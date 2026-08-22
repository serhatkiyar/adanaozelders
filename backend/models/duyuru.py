"""Duyuru şeridi — storefront'un tepesindeki tek yatay duyuru/kampanya şeridi.

Seçim mantığı DB'de değil serviste yaşar (`services/duyuru_service.py`); bu
model yalnız veriyi taşır. Rotasyon YOKTUR: birden fazla uygun kayıt olursa
`sira ASC, id DESC` ile en üsttekinin gösterilmesi serviste kararlaştırılır.
"""
from __future__ import annotations

import datetime
import enum

from sqlalchemy import CheckConstraint, DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy import Boolean, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class DuyuruVaryant(str, enum.Enum):
    # Üye adı == değer (repodaki enum kuralı): PG enum etiketi SQLAlchemy'de
    # `.name`den türer, `.value`den DEĞİL. Bu ikisi ayrışırsa (ör. BILGI="bilgi")
    # `server_default=text("'bilgi'")` ile DB tipi ("BILGI") eşleşmez ve
    # `CREATE TABLE` "invalid input value for enum" ile patlar — ölçüldü.
    bilgi = "bilgi"
    dikkat = "dikkat"


class DuyuruSeridi(Base, TimestampMixin):
    """Tek satır duyuru. Soft-delete YOKTUR: silinen kayıt fiziksel kalkar
    (panel listesi zaten küçük ve arşiv ihtiyacı belirtilmedi)."""

    __tablename__ = "duyuru_seridi"

    id: Mapped[int] = mapped_column(primary_key=True)
    metin: Mapped[str] = mapped_column(String(160), nullable=False)
    link_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    link_metni: Mapped[str | None] = mapped_column(String(40), nullable=True)
    varyant: Mapped[DuyuruVaryant] = mapped_column(
        SAEnum(DuyuruVaryant, name="duyuru_varyant"),
        nullable=False,
        server_default=text("'bilgi'"),
    )
    aktif: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    baslangic_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    bitis_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sira: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    __table_args__ = (
        # Seçim sorgusu `aktif = true AND (baslangic_at <= now()) AND
        # (bitis_at > now()) ORDER BY sira ASC, id DESC LIMIT 1` şeklinde
        # çalışır (services/duyuru_service.py); bu index onu destekler.
        Index("ix_duyuru_seridi_aktif_sira", "aktif", "sira"),
        CheckConstraint(
            "(link_url IS NULL AND link_metni IS NULL) OR "
            "(link_url IS NOT NULL AND link_metni IS NOT NULL)",
            name="ck_duyuru_seridi_link_metni_link_url_birlikte",
        ),
        CheckConstraint(
            "bitis_at IS NULL OR baslangic_at IS NULL OR bitis_at > baslangic_at",
            name="ck_duyuru_seridi_bitis_sonra",
        ),
    )
