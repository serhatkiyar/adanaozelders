"""Admin-yönetimli teslimat takvimi (kapalı günler).

Operasyon kendi takvimini kontrol eder: hangi günün teslimata kapalı olacağı
(resmî tatil / özel gün) admin tarafından belirlenir — söz motoru bu tarihleri
atlar. Haftalık kural (Pazar vb.) yerine tarih-bazlı; "her şey otomatik" değil,
insan kontrolünde. Resmî tatiller admin tarafından TEK TIKLA yüklenir ama
otomatik değildir — admin istemediğini siler, ek gün ekler.
"""
from __future__ import annotations

import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models.delivery import DeliveryClosedDay
from schemas.delivery import ClosedDayOut

#: Türkiye resmî tatilleri — sabit ulusal günler kesin, dinî bayramlar (Ramazan/
#: Kurban) hicri takvime bağlı olduğundan tahminidir ve admin gerekirse düzeltir.
#: Yıl → [(ay, gün, etiket)]. Yeni yıl eklemek için buraya satır eklenir.
OFFICIAL_HOLIDAYS: dict[int, list[tuple[int, int, str]]] = {
    2026: [
        (1, 1, "Yılbaşı"),
        (3, 20, "Ramazan Bayramı Arifesi"),
        (3, 21, "Ramazan Bayramı 1. Gün"),
        (3, 22, "Ramazan Bayramı 2. Gün"),
        (3, 23, "Ramazan Bayramı 3. Gün"),
        (4, 23, "Ulusal Egemenlik ve Çocuk Bayramı"),
        (5, 1, "Emek ve Dayanışma Günü"),
        (5, 19, "Atatürk'ü Anma, Gençlik ve Spor Bayramı"),
        (5, 26, "Kurban Bayramı Arifesi"),
        (5, 27, "Kurban Bayramı 1. Gün"),
        (5, 28, "Kurban Bayramı 2. Gün"),
        (5, 29, "Kurban Bayramı 3. Gün"),
        (5, 30, "Kurban Bayramı 4. Gün"),
        (7, 15, "Demokrasi ve Milli Birlik Günü"),
        (8, 30, "Zafer Bayramı"),
        (10, 29, "Cumhuriyet Bayramı"),
    ],
}


def _to_out(c: DeliveryClosedDay) -> ClosedDayOut:
    return ClosedDayOut(id=c.id, day=c.day, label=c.label, source=c.source)


async def load_closed_dates(
    db: AsyncSession,
    *,
    start: datetime.date,
    end: datetime.date,
) -> frozenset[datetime.date]:
    """[start, end] aralığındaki kapalı günleri set olarak döner (söz motoruna
    geçirilir). Aralık dar tutulur — söz en çok birkaç hafta ileriye bakar."""
    rows = (
        await db.execute(
            select(DeliveryClosedDay.day).where(
                DeliveryClosedDay.deleted_at.is_(None),
                DeliveryClosedDay.day >= start,
                DeliveryClosedDay.day <= end,
            )
        )
    ).scalars().all()
    return frozenset(rows)


async def list_closed_days(
    db: AsyncSession, *, upcoming_only: bool = True
) -> list[ClosedDayOut]:
    stmt = select(DeliveryClosedDay).where(DeliveryClosedDay.deleted_at.is_(None))
    if upcoming_only:
        today = datetime.date.today()
        stmt = stmt.where(DeliveryClosedDay.day >= today)
    stmt = stmt.order_by(DeliveryClosedDay.day)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_out(c) for c in rows]


async def add_closed_day(
    db: AsyncSession, *, day: datetime.date, label: str | None, source: str = "manual"
) -> ClosedDayOut:
    """Bir günü kapalı işaretle. Zaten kapalıysa (unique index) etiketi günceller
    (idempotent — çift eklenmez)."""
    existing = (
        await db.execute(
            select(DeliveryClosedDay).where(
                DeliveryClosedDay.deleted_at.is_(None),
                DeliveryClosedDay.day == day,
            )
        )
    ).scalars().first()
    if existing is not None:
        if label:
            existing.label = label
        await db.commit()
        return _to_out(existing)
    c = DeliveryClosedDay(day=day, label=label, source=source)
    db.add(c)
    try:
        await db.commit()
    except IntegrityError:
        # Yarışta unique index — mevcut kaydı döndür.
        await db.rollback()
        again = (
            await db.execute(
                select(DeliveryClosedDay).where(
                    DeliveryClosedDay.deleted_at.is_(None),
                    DeliveryClosedDay.day == day,
                )
            )
        ).scalars().first()
        if again is not None:
            return _to_out(again)
        raise
    await db.refresh(c)
    return _to_out(c)


async def remove_closed_day(db: AsyncSession, closed_day_id: int) -> None:
    c = await db.get(DeliveryClosedDay, closed_day_id)
    if c is None or c.deleted_at is not None:
        return
    c.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()


async def seed_holidays(db: AsyncSession, year: int) -> list[ClosedDayOut]:
    """Verilen yılın resmî tatillerini yükler (idempotent). Admin tetikler;
    sonra istemediğini silebilir. Bilinmeyen yıl → boş."""
    entries = OFFICIAL_HOLIDAYS.get(year, [])
    out: list[ClosedDayOut] = []
    for month, dom, label in entries:
        out.append(
            await add_closed_day(
                db, day=datetime.date(year, month, dom), label=label, source="holiday"
            )
        )
    return out
