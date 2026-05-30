import datetime
from sqlalchemy import Integer, ForeignKey, Text, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class BookingPrivateNote(Base):
    __tablename__ = "booking_private_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    booking_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    # Hangi role sahip kullanıcının notu? (RoleType.TUTOR veya RoleType.CLIENT'in veritabanı ID'si)
    owner_role: Mapped[int] = mapped_column(Integer, nullable=False)
    # Kullanıcının ID'si (Client veya Tutor ID)
    owner_id: Mapped[int] = mapped_column(Integer, nullable=False)
    
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Migration'da server_default yok; değeri ORM tarafı sağlar. Diğer tablolarla
    # tutarlı olması için timezone-aware (UTC) üretiriz (naive utcnow kullanmayız).
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
    )

    booking: Mapped["Booking"] = relationship(
        "Booking", back_populates="private_notes"
    )
