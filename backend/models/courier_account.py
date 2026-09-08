from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import (
    AuthVersionMixin,
    EmailVerificationMixin,
    LastSeenMixin,
    NameMixin,
    PasswordMixin,
    SoftDeleteMixin,
    TimestampMixin,
)


class CourierAccount(
    Base,
    NameMixin,
    PasswordMixin,
    TimestampMixin,
    SoftDeleteMixin,
    LastSeenMixin,
    EmailVerificationMixin,
    AuthVersionMixin,
):
    """Kurye giriş hesabı (role_id=5) — LibraryOperator deseninin birebiri.

    Auth kimliği ile müşteriye görünen kurye kartı AYRIDIR: ``Courier`` profili
    (isim/foto/plaka) operasyon kimliğidir, bu tablo yalnız girişi taşır ve
    ``courier_id`` ile profile bağlanır. Admin oluşturur (self-servis yok).

    ``auth_version`` artık ortak mixin'den gelir (İP-3 §6: bütün rollerde
    denetlenir); kurye burada öncü olmuştu, istisna olmaktan çıktı.
    """

    __tablename__ = "courier_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    # NULL = parolasız hesap (Google ile açıldı). Gerekçe ve üç akışın
    # korunması: models/mixins.py::PasswordMixin.
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )
    courier_id: Mapped[int] = mapped_column(
        ForeignKey("couriers.id", ondelete="CASCADE"), nullable=False
    )

    courier: Mapped["Courier"] = relationship()

    __table_args__ = (
        Index(
            "uq_courier_accounts_email_active",
            "email",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Profil başına tek aktif hesap (işten ayrılan soft-delete edilir,
        # yeniden işe alımda YENİ satır açılır — eski token'lar dirilmez).
        Index(
            "uq_courier_accounts_courier_active",
            "courier_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
