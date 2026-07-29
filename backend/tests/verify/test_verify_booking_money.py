"""Ders (booking) para yolu — gerçek DB + gerçek servis katmanı.

Dört para yüzeyinin sonuncusu. Sipariş Hafta 2'de, kütüphane dikeyi Hafta 14'te
doğrulandı; ders yolu `payment_service` %17 kapsamayla en eski ve en çok
kullanılan yüzey olmasına rağmen gerçek davranışıyla hiç sınanmamıştı.

Doğrulanan zincir: **tutor kabul eder → PENDING · öğrenci öder → HELD (emanet) →
ders tamamlanır → RELEASED (komisyon düşülür) · iptalde → REFUNDED.**

Kritik değişmezler:

* Emanetten çıkış **atomik claim**'dir: tamamlama ile iptal yarışırsa yalnız
  biri kazanır — iki para hareketi asla olmaz.
* Serbest bırakılmış (`RELEASED`) tutar iade edilemez; aksi halde eğitmene
  ödenen para ikinci kez öğrenciye giderdi.
* Komisyon **eğitmene özel oran** varsa onu kullanır; bölünme tutarlıdır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest

from models.booking import Booking, BookingStatus
from models.payment import Payment, PaymentStatus
from services import escrow, payment_service

pytestmark = pytest.mark.asyncio


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


@pytest.fixture
async def booking_factory(db, factory):
    """Kabul edilmiş bir ders (ödeme henüz kurulmamış)."""
    created: list[int] = []

    async def make(*, price: str | None = "200.00", starts_in_hours: float = 24):
        tutor = await factory.tutor(db)
        client = await factory.client(db)
        start = _now() + datetime.timedelta(hours=starts_in_hours)
        b = Booking(
            tutor_id=tutor.id,
            client_id=client.id,
            status=BookingStatus.ACCEPTED,
            start_at=start,
            end_at=start + datetime.timedelta(hours=1),
            price=Decimal(price) if price is not None else None,
        )
        db.add(b)
        await db.flush()
        created.append(b.id)
        return b

    yield make

    await db.rollback()
    from sqlalchemy import text

    from core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        if created:
            await s.execute(
                text("DELETE FROM payments WHERE booking_id = ANY(:ids)"), {"ids": created}
            )
            await s.execute(
                text("DELETE FROM bookings WHERE id = ANY(:ids)"), {"ids": created}
            )
            await s.commit()


async def _held(db, booking) -> Payment:
    """Ödemesi alınmış (emanetteki) ders."""
    p = await payment_service.create_for_booking(db, booking)
    p.status = PaymentStatus.HELD
    p.provider_ref = "tx-booking"
    await db.commit()
    return p


# ── Kurulum ─────────────────────────────────────────────────────────────────────


async def test_kabulde_odeme_PENDING_kurulur_ve_komisyon_bolunur(db, booking_factory):
    b = await booking_factory(price="200.00")

    p = await payment_service.create_for_booking(db, b)

    assert p is not None
    assert p.status == PaymentStatus.PENDING
    assert Decimal(str(p.amount)) == Decimal("200.00")
    assert Decimal(str(p.commission_amount)) + Decimal(str(p.tutor_earning)) == (
        Decimal(str(p.amount))
    ), "komisyon bölünmesi tutarı korumuyor"
    assert Decimal(str(p.tutor_earning)) > Decimal(str(p.commission_amount))


async def test_ucretsiz_derste_odeme_KURULMAZ(db, booking_factory):
    """price=0 (ilk ders ücretsiz) — sağlayıcıya hiç gidilmemeli."""
    b = await booking_factory(price="0")
    assert await payment_service.create_for_booking(db, b) is None


async def test_fiyati_olmayan_derste_odeme_KURULMAZ(db, booking_factory):
    b = await booking_factory(price=None)
    assert await payment_service.create_for_booking(db, b) is None


async def test_ikinci_kabul_yeni_odeme_URETMEZ(db, booking_factory):
    """Reschedule sonrası tekrar accept idempotent olmalı; aksi halde aynı ders
    için iki tahsilat kaydı doğardı."""
    b = await booking_factory()
    ilk = await payment_service.create_for_booking(db, b)
    await db.commit()

    ikinci = await payment_service.create_for_booking(db, b)

    assert ikinci.id == ilk.id


# ── Emanetten çıkış ─────────────────────────────────────────────────────────────


async def test_ders_tamamlaninca_emanet_egitmene_acilir(db, booking_factory):
    b = await booking_factory()
    p = await _held(db, b)

    await payment_service.release(db, b)

    await db.refresh(p)
    assert p.status == PaymentStatus.RELEASED
    assert p.released_at is not None


async def test_odenmemis_ders_tamamlanirsa_release_ETMEZ(db, booking_factory):
    """PENDING (öğrenci hiç ödememiş) bir kayıt tamamlansa bile eğitmene para
    açılamaz — ortada tahsilat yok."""
    b = await booking_factory()
    p = await payment_service.create_for_booking(db, b)
    await db.commit()

    await payment_service.release(db, b)

    await db.refresh(p)
    assert p.status == PaymentStatus.PENDING
    assert p.released_at is None


async def test_iptalde_emanet_ogrenciye_iade_edilir(db, booking_factory, fake_provider):
    b = await booking_factory()
    p = await _held(db, b)

    await payment_service.refund(db, b)
    await db.commit()

    await db.refresh(p)
    assert p.status in (PaymentStatus.REFUNDED, PaymentStatus.REFUNDING)
    assert p.released_at is None
    assert len(fake_provider.refunds) == 1
    assert fake_provider.refunds[0][1] == Decimal("200.00")


async def test_serbest_birakilmis_para_iade_EDILEMEZ(
    db, booking_factory, fake_provider
):
    """`has_released_guard`: eğitmene açılmış tutar ikinci kez öğrenciye gidemez."""
    b = await booking_factory()
    p = await _held(db, b)
    await payment_service.release(db, b)
    await db.commit()

    await payment_service.refund(db, b)

    await db.refresh(p)
    assert p.status == PaymentStatus.RELEASED
    assert fake_provider.refunds == [], "serbest bırakılmış emanet için iade istendi"


async def test_iade_sonrasi_release_EDILEMEZ(db, booking_factory, fake_provider):
    """Ters yön: iade edilmiş ders sonradan "tamamlandı" işaretlenirse (ör.
    auto-complete) eğitmene para açılmamalı."""
    b = await booking_factory()
    p = await _held(db, b)
    await payment_service.refund(db, b)
    await db.commit()

    await payment_service.release(db, b)

    await db.refresh(p)
    assert p.status in (PaymentStatus.REFUNDED, PaymentStatus.REFUNDING)
    assert p.released_at is None


async def test_release_iki_kez_cagrilirsa_damga_degismez(db, booking_factory):
    """Auto-complete ile elle tamamlama aynı derse denk gelebilir."""
    b = await booking_factory()
    p = await _held(db, b)
    await payment_service.release(db, b)
    await db.commit()
    await db.refresh(p)
    ilk_damga = p.released_at

    await payment_service.release(db, b)

    await db.refresh(p)
    assert p.released_at == ilk_damga


async def test_odemesiz_derste_release_ve_refund_no_op(db, booking_factory):
    """Ücretsiz derste ödeme kaydı yok; para yolları sessizce geçmeli (patlamamalı)."""
    b = await booking_factory(price="0")

    assert await payment_service.release(db, b) is None
    assert await payment_service.refund(db, b) is None


# ── Tutar bütünlüğü ─────────────────────────────────────────────────────────────


async def test_iade_tutari_odenen_tutarin_TAMAMI(db, booking_factory, fake_provider):
    """Kısmi iade ders yolunda YOKTUR; eksik iade müşteriyi mağdur eder, fazlası
    platformdan çıkar."""
    b = await booking_factory(price="345.67")
    p = await _held(db, b)

    await payment_service.refund(db, b)
    await db.commit()

    assert fake_provider.refunds[0][1] == Decimal("345.67")
    await db.refresh(p)
    assert Decimal(str(p.amount)) == Decimal("345.67")


async def test_escrow_claim_yalniz_HELD_durumundan_cikar(db, booking_factory):
    """Doğrudan escrow katmanı: PENDING bir kayıt iade akışına claim edilemez —
    tahsil edilmemiş parayı iade etmek sağlayıcıda hatalı harekettir."""
    b = await booking_factory()
    p = await payment_service.create_for_booking(db, b)
    await db.commit()

    claimed = await escrow.claim(
        db,
        Payment,
        p.id,
        from_statuses=[PaymentStatus.HELD],
        values={"status": PaymentStatus.REFUNDING},
    )

    assert claimed is False
    await db.refresh(p)
    assert p.status == PaymentStatus.PENDING
