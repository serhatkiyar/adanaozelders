"""Kütüphane dikeyinin para yolları — gerçek DB + gerçek servis katmanı.

Deneme bileti ve çalışma rezervasyonu, ders ve mağaza siparişiyle aynı escrow
disiplinine tabidir ama **kendi kuralları** vardır ve bunlar bugüne dek hiç
doğrulanmamıştı (`library_exam_service` %15, `study_reservation_service` %19
kapsama). Buradaki bir hata ekrana yansımaz: para ya kütüphaneye hiç geçmez ya
da katılmayan öğrenciye iade edilir.

Doğrulanan kurallar:

* Emanet ancak **katılım doğrulanınca** (QR) ya da **etkinlik bitip no-show
  süresi geçince** kütüphaneye açılır — ikisi de `released_at` damgasıdır.
* Serbest bırakılmış para **iade edilemez** (`has_released_guard`): aksi halde
  kütüphaneye ödenen tutar ikinci kez öğrenciye giderdi.
* İade **penceresi** vardır: oturuma `REFUND_WINDOW_HOURS` saatten az kalmışsa
  iptal reddedilir (no-show riski kütüphanede kalmasın).
* Komisyon bölünmesi tutarlıdır (`amount = commission + earning`).
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest

from core.config import settings
from models.library import Library
from models.library_exam import (
    ExamRegistration,
    ExamSessionStatus,
    LibraryExamSession,
    RegistrationStatus,
)
from services import commission, escrow, library_exam_service

pytestmark = pytest.mark.asyncio


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


@pytest.fixture
async def library(db):
    import uuid

    u = uuid.uuid4().hex[:10]
    lib = Library(
        name=f"Test Kütüphane {u}",
        slug=f"test-kutuphane-{u}",
        status="ACTIVE",
        capacity=2,
        study_hourly_price=Decimal("20.00"),
    )
    db.add(lib)
    await db.flush()
    # Id'yi ŞİMDİ yakala: teardown'daki rollback nesneyi expire eder ve
    # `lib.id` okumak lazy-load (IO) tetikler — event loop dışında MissingGreenlet.
    lib_id = lib.id
    yield lib
    await db.rollback()
    from sqlalchemy import text

    from core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        await s.execute(
            text("DELETE FROM exam_registrations WHERE session_id IN "
                 "(SELECT id FROM library_exam_sessions WHERE library_id = :i)"),
            {"i": lib_id},
        )
        await s.execute(
            text("DELETE FROM library_exam_sessions WHERE library_id = :i"), {"i": lib_id}
        )
        await s.execute(text("DELETE FROM libraries WHERE id = :i"), {"i": lib_id})
        await s.commit()


@pytest.fixture
async def operator(db, library):
    """Gerçek operatör kaydı: `attended_by_operator_id` FK'lidir, uydurma bir id
    ile katılım doğrulaması DB seviyesinde reddedilir."""
    import uuid

    from models.library_operator import LibraryOperator

    u = uuid.uuid4().hex[:10]
    op = LibraryOperator(
        library_id=library.id,
        email=f"op-{u}@verify.test",
        hashed_password="x",
        first_name="Test",
        last_name="Operator",
        username=f"op{u}",
        role_id=4,
    )
    db.add(op)
    await db.flush()
    op_id = op.id  # bkz. `library` fixture'ı: rollback sonrası okumak IO tetikler
    yield op
    await db.rollback()
    from sqlalchemy import text

    from core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        await s.execute(
            text("DELETE FROM library_operators WHERE id = :i"), {"i": op_id}
        )
        await s.commit()


@pytest.fixture
async def session_factory(db, library):
    async def make(*, starts_in_hours: float = 48, status: str = ExamSessionStatus.SCHEDULED.value):
        s = LibraryExamSession(
            library_id=library.id,
            exam_type="TYT",
            title="TYT Deneme",
            starts_at=_now() + datetime.timedelta(hours=starts_in_hours),
            duration_minutes=135,
            capacity=50,
            price=Decimal("100.00"),
            status=status,
        )
        db.add(s)
        await db.flush()
        return s

    return make


@pytest.fixture
async def paid_registration(db, factory, session_factory):
    """Ödemesi tamamlanmış (emanetteki) bir bilet."""

    async def make(*, starts_in_hours: float = 48):
        client = await factory.client(db)
        sess = await session_factory(starts_in_hours=starts_in_hours)
        rate = commission.rate_for(None)
        amount = Decimal("100.00")
        fee, earning = commission.split(amount, rate)
        reg = ExamRegistration(
            session_id=sess.id,
            client_id=client.id,
            status=RegistrationStatus.PAID.value,
            amount=amount,
            commission_amount=fee,
            library_earning=earning,
            commission_rate=rate,
            paid_at=_now(),
            qr_token="tok-" + str(sess.id),
            short_code=f"C{sess.id:05d}",
        )
        db.add(reg)
        await db.flush()
        return reg, sess, client

    return make


# ── Komisyon ────────────────────────────────────────────────────────────────────


async def test_komisyon_bolunmesi_tutarli(db, paid_registration):
    """DB'de CHECK var (`amount = commission + earning`) ama bölünmenin DOĞRU
    tarafa gittiğini kısıt denetlemez."""
    reg, _s, _c = await paid_registration()
    assert Decimal(str(reg.commission_amount)) + Decimal(str(reg.library_earning)) == (
        Decimal(str(reg.amount))
    )
    assert Decimal(str(reg.library_earning)) > Decimal(str(reg.commission_amount))


# ── Emanetin açılması ───────────────────────────────────────────────────────────


async def test_katilim_dogrulanınca_emanet_acilir(db, paid_registration, operator):
    reg, sess, _c = await paid_registration()
    await db.refresh(reg, ["session"])

    result = await library_exam_service._attend_exam(
        db, reg, operator_library_id=sess.library_id, operator_id=operator.id
    )

    assert result.already is False
    await db.refresh(reg)
    assert reg.status == RegistrationStatus.ATTENDED.value
    assert reg.released_at is not None, "katılım doğrulandı ama emanet açılmadı"


async def test_baska_kutuphanenin_bileti_dogrulanamaz(db, paid_registration, operator):
    """Operatör yalnız kendi kütüphanesinin biletini okutabilir."""
    from fastapi import HTTPException

    reg, sess, _c = await paid_registration()
    await db.refresh(reg, ["session"])

    with pytest.raises(HTTPException) as exc:
        await library_exam_service._attend_exam(
            db, reg, operator_library_id=sess.library_id + 9999, operator_id=operator.id
        )
    assert exc.value.status_code == 403


async def test_ikinci_okutma_tekrar_release_ETMEZ(db, paid_registration, operator):
    """QR iki kez okutulursa ikinci sefer "zaten doğrulandı" demeli; damganın
    değişmesi kazanç kaydını da kaydırırdı."""
    reg, sess, _c = await paid_registration()
    await db.refresh(reg, ["session"])
    await library_exam_service._attend_exam(
        db, reg, operator_library_id=sess.library_id, operator_id=operator.id
    )
    await db.refresh(reg)
    ilk_damga = reg.released_at

    result = await library_exam_service._attend_exam(
        db, reg, operator_library_id=sess.library_id, operator_id=operator.id
    )

    assert result.already is True
    await db.refresh(reg)
    assert reg.released_at == ilk_damga


async def test_no_show_emaneti_kutuphaneye_birakir(db, paid_registration):
    """Katılmayan öğrencinin parası iade EDİLMEZ, kütüphaneye geçer — aksi halde
    escrow'da süresiz kilitli kalırdı."""
    reg, sess, _c = await paid_registration()
    # Etkinlik bitmiş ve tolerans süresi de geçmiş olsun.
    sess.starts_at = _now() - datetime.timedelta(
        hours=settings.AUTO_COMPLETE_GRACE_HOURS + 5
    )
    await db.commit()

    count = await library_exam_service.auto_release_no_shows(db)

    assert count >= 1
    await db.refresh(reg)
    assert reg.released_at is not None
    assert reg.status == RegistrationStatus.PAID.value, "no-show ATTENDED sayılmamalı"


async def test_etkinlik_bitmeden_no_show_release_YAPILMAZ(db, paid_registration):
    reg, _sess, _c = await paid_registration(starts_in_hours=48)

    await library_exam_service.auto_release_no_shows(db)

    await db.refresh(reg)
    assert reg.released_at is None


# ── İade sınırları ──────────────────────────────────────────────────────────────


async def test_serbest_birakilmis_para_iade_EDILEMEZ(db, paid_registration, fake_provider, operator):
    """`has_released_guard`: kütüphaneye açılmış tutar ikinci kez öğrenciye
    gidemez."""
    reg, sess, _c = await paid_registration()
    await db.refresh(reg, ["session"])
    await library_exam_service._attend_exam(
        db, reg, operator_library_id=sess.library_id, operator_id=operator.id
    )

    outcome = await escrow.refund_escrow(db, reg, escrow.EXAM_SPEC)

    assert outcome == "not_claimed"
    assert fake_provider.refunds == [], "serbest bırakılmış emanet için iade istendi"


async def test_iade_penceresi_kapaliysa_iptal_reddedilir(db, paid_registration):
    """Oturuma az kalmışsa iptal yok: bu noktadan sonra no-show riski
    kütüphanenindir."""
    from fastapi import HTTPException

    reg, _sess, client = await paid_registration(
        starts_in_hours=library_exam_service.REFUND_WINDOW_HOURS - 1
    )
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await library_exam_service.cancel_registration(db, client, reg.id)
    assert exc.value.status_code == 409

    await db.refresh(reg)
    assert reg.status == RegistrationStatus.PAID.value


async def test_iade_penceresi_acikken_iptal_iade_baslatir(
    db, paid_registration, fake_provider
):
    reg, _sess, client = await paid_registration(
        starts_in_hours=library_exam_service.REFUND_WINDOW_HOURS + 5
    )
    await db.commit()

    await library_exam_service.cancel_registration(db, client, reg.id)

    await db.refresh(reg)
    assert reg.status in (
        RegistrationStatus.REFUNDED.value,
        RegistrationStatus.REFUNDING.value,
    )
    assert reg.released_at is None


async def test_baskasinin_bileti_iptal_edilemez(db, paid_registration, factory):
    from fastapi import HTTPException

    reg, _sess, _c = await paid_registration()
    yabanci = await factory.client(db)
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await library_exam_service.cancel_registration(db, yabanci, reg.id)
    assert exc.value.status_code == 403
