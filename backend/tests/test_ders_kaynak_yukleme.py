"""Derse kaynak dosya yükleme — POST /bookings/{id}/resources/upload.

Canlı ders tahtası PDF'i ve RESMİ bu uçla derse kaynak olarak yükler (dosya
canlı kanaldan gitmez; karşı taraf kısa ömürlü imzalı adresten indirir). İki
taraf da (öğretmen ve dersin öğrencisi) yükleyebilir; tür dosya adının
uzantısından denetlenir; karşı tarafa "derse dosya paylaşıldı" bildirimi
gider.

Desen `test_ders_tahta_token.py` ile aynı: uç doğrudan çağrılır, depolama ve
servis sahtedir (DB yok).
"""
from __future__ import annotations

import datetime
import io
from decimal import Decimal

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from api.routers.bookings import upload_booking_resource
from core import storage
from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from services import booking_service

UTC = datetime.timezone.utc

EGITMEN = Tutor(id=7, first_name="E", last_name="S", role_id=ROLE_IDS[RoleType.TUTOR])
OGRENCI = Client(id=9, first_name="O", last_name="S", role_id=ROLE_IDS[RoleType.CLIENT])
YABANCI = Client(id=99, first_name="Y", last_name="K", role_id=ROLE_IDS[RoleType.CLIENT])


def _ders() -> Booking:
    simdi = datetime.datetime.now(UTC)
    return Booking(
        id=42,
        tutor_id=EGITMEN.id,
        client_id=OGRENCI.id,
        status=BookingStatus.ACCEPTED,
        start_at=simdi,
        end_at=simdi + datetime.timedelta(hours=1),
        price=Decimal("300.00"),
        mode="ONLINE",
    )


def _dosya(ad: str, tur: str, veri: bytes = b"\x89PNG....") -> UploadFile:
    return UploadFile(file=io.BytesIO(veri), filename=ad, headers=Headers({"content-type": tur}))


@pytest.fixture
def ortam(monkeypatch):
    """Ders bulunur; depolama ve kayıt sahte. Kaydedilen çağrılar döner."""
    ders = _ders()
    kayitlar: list[dict] = []

    async def sahte_get_booking(db, booking_id, *, viewer=None):
        return ders

    async def sahte_upload_file(data, *, original_name, content_type, prefix="lesson-resources"):
        return f"https://depo/private/{prefix}/x{storage.resource_ext(original_name)}"

    async def sahte_ekle(db, booking, actor, **kw):
        kayitlar.append({"actor": actor, **kw})
        return booking

    monkeypatch.setattr(booking_service, "get_booking", sahte_get_booking)
    monkeypatch.setattr(storage, "upload_file", sahte_upload_file)
    monkeypatch.setattr(booking_service, "add_uploaded_resource", sahte_ekle)
    return kayitlar


async def test_ogrenci_derse_resim_yukleyebilir(ortam):
    await upload_booking_resource(
        42, file=_dosya("tahta-resim-ab12.png", "image/png"), user=OGRENCI, db=None
    )
    assert len(ortam) == 1
    assert ortam[0]["actor"] is OGRENCI
    assert ortam[0]["file_name"] == "tahta-resim-ab12.png"
    assert ortam[0]["content_type"] == "image/png"
    assert ortam[0]["url"].startswith("https://depo/private/")


@pytest.mark.parametrize("ad", ["a.jpg", "a.jpeg", "a.webp", "a.gif", "a.pdf"])
async def test_tahta_turleri_izinli(ortam, ad):
    await upload_booking_resource(42, file=_dosya(ad, "x/y"), user=EGITMEN, db=None)
    assert len(ortam) == 1


async def test_derse_taraf_olmayan_403(ortam):
    with pytest.raises(HTTPException) as exc:
        await upload_booking_resource(42, file=_dosya("a.png", "image/png"), user=YABANCI, db=None)
    assert exc.value.status_code == 403
    assert ortam == []


async def test_izinsiz_tur_415(ortam):
    with pytest.raises(HTTPException) as exc:
        await upload_booking_resource(
            42, file=_dosya("a.svg", "image/svg+xml"), user=OGRENCI, db=None
        )
    assert exc.value.status_code == 415


async def test_buyuk_dosya_413(ortam, monkeypatch):
    monkeypatch.setattr(settings, "MAX_RESOURCE_SIZE_BYTES", 8)
    with pytest.raises(HTTPException) as exc:
        await upload_booking_resource(
            42, file=_dosya("a.png", "image/png", b"x" * 9), user=OGRENCI, db=None
        )
    assert exc.value.status_code == 413


class _SahteDb:
    def __init__(self) -> None:
        self.eklenen: list = []

    def add(self, nesne) -> None:
        self.eklenen.append(nesne)

    async def flush(self) -> None:
        return None


async def test_ogrenci_yukleyince_ogretmene_bildirim(monkeypatch):
    ders = _ders()
    bildirimler: list[dict] = []

    async def sahte_notify(db, **kw):
        bildirimler.append(kw)

    async def sahte_get_booking(db, booking_id, *, viewer=None):
        return ders

    monkeypatch.setattr(booking_service.notification_service, "notify", sahte_notify)
    monkeypatch.setattr(booking_service, "get_booking", sahte_get_booking)
    db = _SahteDb()
    await booking_service.add_uploaded_resource(
        db,
        ders,
        actor=OGRENCI,
        url="https://depo/private/lesson-resources/x.png",
        file_name="tahta-resim-ab12.png",
        content_type="image/png",
        size_bytes=10,
    )
    assert db.eklenen[0].uploader_id == OGRENCI.id
    assert db.eklenen[0].kind == "file"
    assert bildirimler == [
        {
            "user_id": EGITMEN.id,
            "role_id": ROLE_IDS[RoleType.TUTOR],
            "message": "Ders için yeni bir dosya paylaşıldı: tahta-resim-ab12.png",
            "link": "/tutor",
        }
    ]
