"""Hakediş defteri — "kime ne kadar borçluyuz, ne kadarını ödedik".

Platform, eğitmen ve kütüphaneler adına para tahsil ediyor ama onlara ödeme
yapan otomatik bir mekanizma yok (iyzico alt üye işyeri kapalı; banka sanal
POS'larında zaten yoktur). Bu modül borcu hesaplar, ödemeyi admin elle yapar,
kaydı ``payout_records``'a düşer.

BORÇ = kazanılmış (hak edilmiş) toplam − şimdiye dek ödenen toplam

"Kazanılmış" tanımı kaynağa göre değişir:
  - Ders: ``payments.status = RELEASED`` (ders tamamlandı, emanet çözüldü)
  - Mağaza dijital ürün: sipariş PAID (doğrudan satış, emanet yok)
  - Kütüphane deneme/çalışma: ``released_at`` dolu (QR ile katılım doğrulandı)

Emanetteki (HELD) para BORÇ DEĞİLDİR — ders henüz yapılmamıştır, iade
edilebilir. Bu ayrım kritiktir: emaneti ödenmiş göstermek, iade halinde
platformu zarara sokar.
"""
from __future__ import annotations

import dataclasses
import datetime
from decimal import Decimal

from fastapi import HTTPException
from fastapi import status as http_status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models.booking import Booking
from models.library import Library
from models.library_exam import ExamRegistration
from models.payment import Payment, PaymentStatus
from models.payout import (
    PayeeType,
    PayoutRecord,
    PayoutRequest,
    PayoutRequestStatus,
)
from models.store import Order, OrderItem, SellerType
from models.study_reservation import StudyReservation
from models.tutor import Tutor

ZERO = Decimal("0.00")


def _q(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


@dataclasses.dataclass
class PayeeBalance:
    """Bir alıcının hakediş durumu."""

    payee_type: str
    payee_id: int
    name: str
    iban: str | None
    #: Hak edilmiş toplam (komisyon düşülmüş net).
    earned: Decimal
    #: Şimdiye dek ödenen toplam.
    paid: Decimal
    #: Henüz hak edilmemiş, emanetteki tutar (bilgi amaçlı — borç DEĞİL).
    pending: Decimal

    @property
    def balance(self) -> Decimal:
        """Ödenmemiş bakiye (negatife düşmez — fazla ödeme yapıldıysa 0)."""
        return max(self.earned - self.paid, ZERO)


async def _paid_totals(
    db: AsyncSession, payee_type: str, *, payee_id: int | None = None
) -> dict[int, Decimal]:
    stmt = (
        select(PayoutRecord.payee_id, func.coalesce(func.sum(PayoutRecord.amount), 0))
        .where(PayoutRecord.payee_type == payee_type)
        .group_by(PayoutRecord.payee_id)
    )
    if payee_id is not None:
        stmt = stmt.where(PayoutRecord.payee_id == payee_id)
    rows = (await db.execute(stmt)).all()
    return {pid: _q(total) for pid, total in rows}


async def _tutor_earned(
    db: AsyncSession, *, yalniz_tutor_id: int | None = None
) -> tuple[dict[int, Decimal], dict[int, Decimal]]:
    """Eğitmen kazançları: (hak edilmiş, emanetteki).

    ``yalniz_tutor_id`` verilirse yalnız o öğretmen hesaplanır (cüzdan uçları için —
    her açılışta tüm öğretmenleri taramak gereksiz)."""
    earned: dict[int, Decimal] = {}
    pending: dict[int, Decimal] = {}

    # ── Ders ücretleri (escrow) ──
    rows = (
        await db.execute(
            select(
                Booking.tutor_id,
                Payment.status,
                func.coalesce(func.sum(Payment.tutor_earning), 0),
            )
            .join(Booking, Booking.id == Payment.booking_id)
            .where(
                Payment.deleted_at.is_(None),
                # Yalnız defteri ilgilendiren iki durum: hak edilmiş (RELEASED)
                # ve emanetteki (HELD). PENDING/REFUNDED satırlar borç hesabına
                # girmediği hâlde taranıyordu — ödeme tablosu büyüdükçe bu fark
                # doğrusal olarak büyür.
                Payment.status.in_([PaymentStatus.RELEASED, PaymentStatus.HELD]),
                *([Booking.tutor_id == yalniz_tutor_id] if yalniz_tutor_id is not None else []),
            )
            .group_by(Booking.tutor_id, Payment.status)
        )
    ).all()
    for tutor_id, status, total in rows:
        if tutor_id is None:
            continue
        if status == PaymentStatus.RELEASED:
            earned[tutor_id] = earned.get(tutor_id, ZERO) + _q(total)
        elif status == PaymentStatus.HELD:
            pending[tutor_id] = pending.get(tutor_id, ZERO) + _q(total)

    # ── Mağaza dijital ürünleri (doğrudan satış — PAID anında hak edilir) ──
    rows = (
        await db.execute(
            select(
                OrderItem.tutor_id,
                func.coalesce(func.sum(OrderItem.tutor_earning), 0),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .where(
                OrderItem.seller_type == SellerType.TUTOR.value,
                OrderItem.tutor_id.isnot(None),
                Order.payment_status == "PAID",
                Order.deleted_at.is_(None),
                *(
                    [OrderItem.tutor_id == yalniz_tutor_id]
                    if yalniz_tutor_id is not None
                    else []
                ),
            )
            .group_by(OrderItem.tutor_id)
        )
    ).all()
    for tutor_id, total in rows:
        if tutor_id is not None:
            earned[tutor_id] = earned.get(tutor_id, ZERO) + _q(total)

    return earned, pending


async def _library_earned(db: AsyncSession) -> tuple[dict[int, Decimal], dict[int, Decimal]]:
    """Kütüphane kazançları: (hak edilmiş, emanetteki)."""
    earned: dict[int, Decimal] = {}
    pending: dict[int, Decimal] = {}

    for model, lib_col in (
        (ExamRegistration, None),  # session üzerinden bağlanır
        (StudyReservation, StudyReservation.library_id),
    ):
        if model is ExamRegistration:
            from models.library_exam import LibraryExamSession

            stmt = (
                select(
                    LibraryExamSession.library_id,
                    ExamRegistration.released_at.isnot(None),
                    func.coalesce(func.sum(ExamRegistration.library_earning), 0),
                )
                .join(
                    LibraryExamSession,
                    LibraryExamSession.id == ExamRegistration.session_id,
                )
                .where(
                    ExamRegistration.deleted_at.is_(None),
                    ExamRegistration.paid_at.isnot(None),
                )
                .group_by(LibraryExamSession.library_id, ExamRegistration.released_at.isnot(None))
            )
        else:
            stmt = (
                select(
                    lib_col,
                    StudyReservation.released_at.isnot(None),
                    func.coalesce(func.sum(StudyReservation.library_earning), 0),
                )
                .where(
                    StudyReservation.deleted_at.is_(None),
                    StudyReservation.paid_at.isnot(None),
                )
                .group_by(lib_col, StudyReservation.released_at.isnot(None))
            )

        for library_id, released, total in (await db.execute(stmt)).all():
            if library_id is None:
                continue
            target = earned if released else pending
            target[library_id] = target.get(library_id, ZERO) + _q(total)

    return earned, pending


async def list_balances(
    db: AsyncSession, *, only_owed: bool = True
) -> list[PayeeBalance]:
    """Tüm alıcıların hakediş durumu.

    ``only_owed=True`` (varsayılan) yalnız BORCU OLANLARI döner — ödeme günü
    bakılacak liste budur.
    """
    out: list[PayeeBalance] = []

    # ── Eğitmenler ──
    t_earned, t_pending = await _tutor_earned(db)
    t_paid = await _paid_totals(db, PayeeType.TUTOR.value)
    ids = set(t_earned) | set(t_pending) | set(t_paid)
    if ids:
        tutors = (
            await db.execute(
                select(Tutor.id, Tutor.first_name, Tutor.last_name, Tutor.iban).where(
                    Tutor.id.in_(ids)
                )
            )
        ).all()
        for tid, first, last, iban in tutors:
            out.append(
                PayeeBalance(
                    payee_type=PayeeType.TUTOR.value,
                    payee_id=tid,
                    name=f"{first or ''} {last or ''}".strip() or f"Öğretmen #{tid}",
                    iban=iban,
                    earned=t_earned.get(tid, ZERO),
                    paid=t_paid.get(tid, ZERO),
                    pending=t_pending.get(tid, ZERO),
                )
            )

    # ── Kütüphaneler ──
    l_earned, l_pending = await _library_earned(db)
    l_paid = await _paid_totals(db, PayeeType.LIBRARY.value)
    ids = set(l_earned) | set(l_pending) | set(l_paid)
    if ids:
        libs = (
            await db.execute(
                select(Library.id, Library.name).where(Library.id.in_(ids))
            )
        ).all()
        for lid, name in libs:
            out.append(
                PayeeBalance(
                    payee_type=PayeeType.LIBRARY.value,
                    payee_id=lid,
                    name=name or f"Kütüphane #{lid}",
                    # Kütüphane IBAN'ı operatör hesabında tutulur; şimdilik boş.
                    iban=None,
                    earned=l_earned.get(lid, ZERO),
                    paid=l_paid.get(lid, ZERO),
                    pending=l_pending.get(lid, ZERO),
                )
            )

    if only_owed:
        out = [b for b in out if b.balance > 0]
    # En çok borçlu olduğumuz önce.
    out.sort(key=lambda b: b.balance, reverse=True)
    return out


async def balance_for(
    db: AsyncSession, *, payee_type: str, payee_id: int
) -> PayeeBalance | None:
    for b in await list_balances(db, only_owed=False):
        if b.payee_type == payee_type and b.payee_id == payee_id:
            return b
    return None


async def record_payment(
    db: AsyncSession,
    *,
    payee_type: str,
    payee_id: int,
    amount: Decimal,
    admin_id: int | None,
    reference: str | None = None,
    note: str | None = None,
) -> PayoutRecord:
    """Yapılan havaleyi deftere işler (commit ÇAĞIRANIN).

    Tutar doğrulaması ÇAĞIRANDA: kısmi ödeme meşrudur (bakiyenin bir kısmı
    ödenebilir), ama borçtan fazlasını yazmak mutabakatı bozar.
    """
    balance = await balance_for(db, payee_type=payee_type, payee_id=payee_id)
    row = PayoutRecord(
        payee_type=payee_type,
        payee_id=payee_id,
        amount=_q(amount),
        iban_snapshot=balance.iban if balance else None,
        reference=(reference or None),
        note=(note or None),
        paid_by_admin_id=admin_id,
        paid_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(row)
    return row


async def history(
    db: AsyncSession, *, limit: int = 100, offset: int = 0
) -> list[PayoutRecord]:
    return list(
        (
            await db.execute(
                select(PayoutRecord)
                # İkincil anahtar `id`: sayfalı okumada aynı `paid_at`
                # değerli kayıtlar sayfalar arasında tekrarlanmasın/kaybolmasın.
                .order_by(PayoutRecord.paid_at.desc(), PayoutRecord.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars().all()
    )


# ── Öğretmen cüzdanı: bakiye + para çekme talebi ─────────────────────────────


async def tutor_balance(db: AsyncSession, tutor: Tutor) -> PayeeBalance:
    """Tek öğretmenin hakediş durumu (``list_balances`` ile AYNI formül)."""
    earned, pending = await _tutor_earned(db, yalniz_tutor_id=tutor.id)
    paid = await _paid_totals(db, PayeeType.TUTOR.value, payee_id=tutor.id)
    return PayeeBalance(
        payee_type=PayeeType.TUTOR.value,
        payee_id=tutor.id,
        name=tutor.full_name,
        iban=tutor.iban,
        earned=earned.get(tutor.id, ZERO),
        paid=paid.get(tutor.id, ZERO),
        pending=pending.get(tutor.id, ZERO),
    )


async def open_request(
    db: AsyncSession, tutor_id: int, *, kilitle: bool = False
) -> PayoutRequest | None:
    """Öğretmenin açık talebi. ``kilitle=True`` ödeme kaydında kullanılır:
    satır kilidi, iki adminin aynı talebi aynı anda iki kez ödemesini önler."""
    stmt = select(PayoutRequest).where(
        PayoutRequest.tutor_id == tutor_id,
        PayoutRequest.status == PayoutRequestStatus.REQUESTED.value,
    )
    if kilitle:
        stmt = stmt.with_for_update()
    return await db.scalar(stmt)


async def open_requests_by_tutor(db: AsyncSession) -> dict[int, PayoutRequest]:
    """Admin hakediş listesi için: öğretmen → açık talep."""
    rows = (
        await db.execute(
            select(PayoutRequest).where(
                PayoutRequest.status == PayoutRequestStatus.REQUESTED.value
            )
        )
    ).scalars().all()
    return {r.tutor_id: r for r in rows}


def talep_engeli(
    *, payout_status: str, balance: Decimal, acik_talep_var: bool
) -> str | None:
    """Para çekme talebi açılamıyorsa kullanıcıya gösterilecek gerekçe (saf)."""
    if acik_talep_var:
        return "Zaten işlenmekte olan bir para çekme talebin var."
    if payout_status != "ACTIVE":
        return "Para çekmek için önce ödeme bilgilerini (IBAN) ekle."
    if balance <= ZERO:
        return "Çekilebilecek bakiyen yok."
    return None


async def create_request(db: AsyncSession, tutor: Tutor) -> PayoutRequest:
    """Ödenebilir bakiyenin TAMAMI için talep açar (tutar sunucuda hesaplanır).

    Eşzamanlı iki istekte ikincisi ``uq_payout_requests_tutor_open``a takılır.
    """
    bakiye = await tutor_balance(db, tutor)
    engel = talep_engeli(
        payout_status=tutor.payout_status,
        balance=bakiye.balance,
        acik_talep_var=await open_request(db, tutor.id) is not None,
    )
    if engel is not None:
        raise HTTPException(http_status.HTTP_409_CONFLICT, engel)
    talep = PayoutRequest(tutor_id=tutor.id, amount=bakiye.balance)
    try:
        async with db.begin_nested():
            db.add(talep)
            await db.flush()
    except IntegrityError:
        raise HTTPException(
            http_status.HTTP_409_CONFLICT,
            "Zaten işlenmekte olan bir para çekme talebin var.",
        ) from None
    return talep


async def tutor_payout_history(db: AsyncSession, tutor_id: int) -> list[PayoutRequest]:
    """Öğretmenin para çekme talepleri (yeniden eskiye) — CSV için."""
    return list(
        (
            await db.execute(
                select(PayoutRequest)
                .where(PayoutRequest.tutor_id == tutor_id)
                .order_by(PayoutRequest.created_at.desc())
            )
        ).scalars().all()
    )
