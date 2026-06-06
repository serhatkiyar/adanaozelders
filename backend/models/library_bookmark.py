from __future__ import annotations

import datetime

from sqlalchemy import DateTime, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class LibraryBookmark(Base):
    """Bir öğrencinin favorilediği kütüphane (Bookmark'ın kütüphane kardeşi).
    Composite PK (client_id, library_id) ile öğrenci başına kütüphane başına tek."""

    __tablename__ = "library_bookmarks"

    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True
    )
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("ix_library_bookmarks_library", "library_id"),)
