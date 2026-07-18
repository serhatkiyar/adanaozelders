from __future__ import annotations

import enum

from sqlalchemy import Enum as SAEnum
from sqlalchemy import SmallInteger
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class RoleType(str, enum.Enum):
    ADMIN = "ADMIN"
    TUTOR = "TUTOR"
    CLIENT = "CLIENT"
    # Kütüphane operatörü — bir kütüphaneye bağlı; deneme oturumlarında QR okutup
    # katılımı doğrular. Admin tarafından oluşturulur (self-servis kayıt yok).
    LIBRARY_OPERATOR = "LIBRARY_OPERATOR"
    # Kurye — kendi-filo teslimat saha hesabı. Admin oluşturur; yalnız kendi
    # atanmış turunun saha uçlarına erişir (minimum yetki; IDOR 404).
    COURIER = "COURIER"


ROLE_IDS: dict[RoleType, int] = {
    RoleType.ADMIN: 1,
    RoleType.TUTOR: 2,
    RoleType.CLIENT: 3,
    RoleType.LIBRARY_OPERATOR: 4,
    RoleType.COURIER: 5,
}

# role_id -> RoleType ters haritası (ör. booking comment/resource'ta rol adını yazarken).
ROLE_NAMES: dict[int, RoleType] = {v: k for k, v in ROLE_IDS.items()}


def role_name(role_id: int) -> str:
    """role_id'yi 'ADMIN'/'TUTOR'/'CLIENT' string adına çevirir."""
    return ROLE_NAMES[role_id].value


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[RoleType] = mapped_column(
        SAEnum(RoleType, name="role_type"), unique=True, nullable=False
    )
