"""Takvim randevusu — pazaryeri kolu kapalıyken ödemesiz kabul (26 Eyl 2026).

Ürün kararı: iyzico Pazaryeri onayı gelene kadar ders ücreti eğitmene platform
dışında doğrudan ödenir. Kabul yine çalışır; ödeme kaydı açılmaz. Kanal İLK
kabulde derse yazılır ve sonra değişmez — aksi hâlde pazaryeri açıldığı gün
eski doğrudan ödemeli ders ertelenip yeniden kabul edilince sessizce ödeme
borcuna dönerdi.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest

from core import canli_ders
from models.booking import (
    PAYMENT_CHANNEL_DIRECT,
    PAYMENT_CHANNEL_ESCROW,
    Booking,
    BookingStatus,
)
from services import booking_service

UTC = datetime.timezone.utc


class _Db:
    async def flush(self):  # noqa: D401
        return None


def _ders(**alan) -> Booking:
    simdi = datetime.datetime.now(UTC)
    d = dict(
        id=11,
        tutor_id=7,
        client_id=9,
        status=BookingStatus.PENDING,
        start_at=simdi + datetime.timedelta(days=2),
        end_at=simdi + datetime.timedelta(days=2, hours=1),
        price=Decimal("500.00"),
        is_free_lesson=False,
        mode="IN_PERSON",
        offered_by_tutor=False,
    )
    d.update(alan)
    return Booking(**d)


@pytest.fixture
def kabul_ortami(monkeypatch):
    """accept()'in DB'ye dokunan yardımcılarını sahteler; çağrıları kaydeder."""
    kayit = {"odeme_kaydi": 0, "bildirimler": [], "kol_acik": False}

    async def _noop(*a, **k):
        return None

    async def _claim(db, booking, hedef, **k):
        booking.status = hedef
        return True

    async def _odeme(db, booking):
        kayit["odeme_kaydi"] += 1

    async def _bildir(db, **k):
        kayit["bildirimler"].append(k["message"])

    async def _kol(db, branch):
        return kayit["kol_acik"]

    monkeypatch.setattr(booking_service, "_lock_tutor", _noop)
    monkeypatch.setattr(booking_service, "_assert_not_on_time_off", _noop)
    monkeypatch.setattr(booking_service, "_claim_transition", _claim)
    monkeypatch.setattr(booking_service, "_notify_booking_update", lambda db, b: None)
    monkeypatch.setattr(booking_service.payment_service, "create_for_booking", _odeme)
    monkeypatch.setattr(booking_service.notification_service, "notify", _bildir)
    monkeypatch.setattr(booking_service.payment_gates, "branch_open", _kol)
    return kayit


async def test_kol_kapaliyken_kabul_DIRECT_ve_odeme_kaydi_ACILMAZ(kabul_ortami):
    ders = _ders()
    await booking_service.accept(_Db(), ders)
    assert ders.status == BookingStatus.ACCEPTED
    assert ders.payment_channel == PAYMENT_CHANNEL_DIRECT
    assert kabul_ortami["odeme_kaydi"] == 0
    assert any("doğrudan" in m for m in kabul_ortami["bildirimler"])


async def test_kol_acikken_kabul_ESCROW_ve_odeme_kaydi_acilir(kabul_ortami):
    kabul_ortami["kol_acik"] = True
    ders = _ders()
    await booking_service.accept(_Db(), ders)
    assert ders.payment_channel == PAYMENT_CHANNEL_ESCROW
    assert kabul_ortami["odeme_kaydi"] == 1


async def test_kanal_ertelemeden_sonraki_YENIDEN_kabulde_DEGISMEZ(kabul_ortami):
    """Doğrudan ödemeli ders, pazaryeri açıldıktan sonra ertelenip yeniden
    kabul edilse bile ödeme borcuna dönmez."""
    ders = _ders(payment_channel=PAYMENT_CHANNEL_DIRECT)
    kabul_ortami["kol_acik"] = True
    await booking_service.accept(_Db(), ders)
    assert ders.payment_channel == PAYMENT_CHANNEL_DIRECT
    assert kabul_ortami["odeme_kaydi"] == 0


async def test_kabul_ucu_yalniz_ESCROW_derste_kolu_ister(monkeypatch):
    """Önceden ESCROW sabitlenmiş ders kol kapandıysa yeniden kabul edilemez;
    kanalı henüz yazılmamış ders kapıya takılmaz (servis DIRECT'e düşürür)."""
    from fastapi import HTTPException

    from api.routers import bookings as router
    from services import payment_gates

    istenen: list[str] = []

    async def _kapi(db, branch):
        istenen.append(branch.value)
        raise HTTPException(503, "kapalı")

    async def _getir(db, booking_id, user):
        return ders

    async def _kabul(db, booking):
        return booking

    monkeypatch.setattr(payment_gates, "assert_branch_open", _kapi)
    monkeypatch.setattr(router, "_get_booking_or_404", _getir)
    monkeypatch.setattr(router, "_assert_yanit_verecek_taraf", lambda b, u: None)
    monkeypatch.setattr(router.booking_service, "accept", _kabul)

    ders = _ders()
    assert await router.accept_booking(11, user=None, db=None) is ders
    assert istenen == []

    ders = _ders(payment_channel=PAYMENT_CHANNEL_ESCROW)
    with pytest.raises(HTTPException) as exc:
        await router.accept_booking(11, user=None, db=None)
    assert exc.value.status_code == 503
    assert istenen == ["tutor_marketplace"]


@pytest.mark.parametrize("fiyat", [Decimal("500"), None])
def test_DIRECT_derste_canli_oda_odeme_beklemeden_acik(fiyat):
    assert canli_ders.ders_odasi_acik_mi(
        None, fiyat, payment_channel=PAYMENT_CHANNEL_DIRECT
    ) is True
    # Kanal ESCROW ya da yazılmamışsa eski kural aynen geçerli.
    for kanal in (PAYMENT_CHANNEL_ESCROW, None):
        assert canli_ders.ders_odasi_acik_mi(
            None, Decimal("500"), payment_channel=kanal
        ) is False


def test_sema_DIRECT_derste_oda_adini_GIZLEMEZ():
    from schemas.booking import BookingOut

    simdi = datetime.datetime.now(UTC)
    ortak = dict(
        id=1, tutor_id=7, client_id=9, status=BookingStatus.ACCEPTED,
        start_at=simdi, end_at=simdi + datetime.timedelta(hours=1),
        created_at=simdi, price=Decimal("500"), mode="ONLINE",
        meeting_room="adana-1-Ab3xYz",
    )
    assert BookingOut(**ortak, payment_channel="DIRECT").meeting_room == "adana-1-Ab3xYz"
    assert BookingOut(**ortak, payment_channel="ESCROW").meeting_room is None
