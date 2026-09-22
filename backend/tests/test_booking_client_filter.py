"""`GET /bookings` üzerindeki `client_id` süzgeci (Öğrenciler paneli).

Eğitmenin zaten görebildiği kümeyi tek öğrenciye daraltır. Kusur sınıfı:
süzgeç rol kapısının YERİNE geçerse (yani `tutor_id` koşulu düşerse) eğitmen
başkasının derslerini görebilirdi; öğrencide uygulanırsa da kendi kaydını
başkasının id'siyle sorgulayabilirdi. İkisi de sessizdir, SQL'den ölçülür.
"""

from __future__ import annotations

import pytest
from sqlalchemy.dialects import postgresql

from models.role import ROLE_IDS, RoleType
from services import booking_service


class _Sonuc:
    def unique(self):
        return self

    def scalars(self):
        return self

    def all(self):
        return []


class _KayitDb:
    def __init__(self) -> None:
        self.sorgular: list[str] = []

    async def execute(self, stmt):
        self.sorgular.append(
            str(
                stmt.compile(
                    dialect=postgresql.dialect(),
                    compile_kwargs={"literal_binds": True},
                )
            )
        )
        return _Sonuc()


async def _sql(role_id: int, client_id: int | None) -> str:
    db = _KayitDb()
    await booking_service.list_bookings(  # type: ignore[arg-type]
        db, role_id=role_id, user_id=42, client_id=client_id
    )
    assert len(db.sorgular) == 1
    return db.sorgular[0]


@pytest.mark.asyncio
async def test_egitmende_client_id_rol_kapisina_EKLENIR():
    sql = await _sql(ROLE_IDS[RoleType.TUTOR], 7)
    assert "bookings.tutor_id = 42" in sql, "rol kapısı düştü"
    assert "bookings.client_id = 7" in sql


@pytest.mark.asyncio
async def test_egitmende_client_id_verilmezse_sorgu_degismez():
    # `bookings.client_id = clients.id` JOIN koşuludur; aranan SABİTE eşitlik.
    sql = await _sql(ROLE_IDS[RoleType.TUTOR], None)
    assert "bookings.client_id = 7" not in sql
    assert "bookings.tutor_id = 42" in sql


@pytest.mark.asyncio
async def test_ogrencide_client_id_yok_sayilir():
    """Öğrenci yalnız kendi kayıtlarını görür; parametre kapıyı gevşetemez."""
    sql = await _sql(ROLE_IDS[RoleType.CLIENT], 7)
    assert "bookings.client_id = 42" in sql
    assert "bookings.client_id = 7" not in sql
