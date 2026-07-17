"""Mağaza siparişi durum makinesi (FSM) — tek geçiş otoritesi.

Sipariş ``status``'ü daha önce ``order_service`` ve ``delivery_service`` içinde
dağınık ``order.status = "..."`` atamalarıyla değişiyordu; yasadışı sıçramalar
(ör. PENDING→DELIVERED) engellenmiyor, geçişler kalıcı olarak izlenmiyordu.
``transition_order`` bu iki eksiği tek yerde kapatır: geçerli geçişi doğrular,
``order.status``'ü set eder ve bir ``OrderStatusHistory`` satırı yazar.

``ALLOWED_ORDER_TRANSITIONS`` saf veridir (pytest'li).
"""
from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.delivery import DeliveryStop, DeliveryStopStatus
from models.store import Order, OrderStatusHistory

# İzinli geçişler (OrderStatus değerleri). Terminal durumlar (CANCELLED/REFUNDED)
# boş küme → oradan çıkış yok. SHIPPED→PAID: teslim edilemedi/tur iptal geri sarımı.
ALLOWED_ORDER_TRANSITIONS: dict[str, set[str]] = {
    "PENDING": {"PAID", "CANCELLED"},
    "PAID": {"SHIPPED", "CANCELLED", "REFUNDED"},
    "SHIPPED": {"DELIVERED", "PAID", "REFUNDED"},
    "DELIVERED": {"REFUNDED"},
    "CANCELLED": set(),
    "REFUNDED": set(),
}


def can_transition(old_status: str, new_status: str) -> bool:
    """Geçiş geçerli mi? (saf) Aynı duruma 'geçiş' no-op sayılır (True)."""
    if old_status == new_status:
        return True
    return new_status in ALLOWED_ORDER_TRANSITIONS.get(old_status, set())


async def _close_open_stops(db: AsyncSession, order_id: int, *, reason: str) -> None:
    """Siparişin bekleyen duraklarını CANCELLED'a kapatır (FAILED değil —
    kurye performans metriğine sayılmaz). Kilit: durak satırı FOR UPDATE ile
    alınır ki eşzamanlı verify/fail sonuçlanmış durağı ezmesin."""
    stops = (
        await db.execute(
            select(DeliveryStop)
            .where(
                DeliveryStop.order_id == order_id,
                DeliveryStop.status == DeliveryStopStatus.PENDING.value,
            )
            .with_for_update()
        )
    ).scalars().all()
    for stop in stops:
        stop.status = DeliveryStopStatus.CANCELLED.value
        stop.courier_note = stop.courier_note or reason


async def transition_order(
    db: AsyncSession,
    order: Order,
    new_status: str,
    *,
    changed_by: str,
    reason: str | None = None,
) -> None:
    """Siparişi ``new_status``'e geçir (doğrula + set + geçmiş yaz).

    ``changed_by`` aktörü tanımlar: 'system:payment' | 'system:oversell' |
    'admin' | 'client' | 'courier'. Aynı duruma geçiş no-op'tur (geçmiş yazılmaz).
    Geçersiz geçişte 409.
    """
    old_status = order.status
    if old_status == new_status:
        return
    if not can_transition(old_status, new_status):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Geçersiz sipariş durum geçişi: {old_status} → {new_status}",
        )
    order.status = new_status
    # Teslim anını bir kez damgala (iade penceresinin başlangıcı). Geri sarım
    # (SHIPPED→PAID→…→DELIVERED) tekrarında ilk teslim değil son teslim geçerli
    # olsun diye her DELIVERED geçişinde tazelenir.
    if new_status == "DELIVERED":
        order.delivered_at = datetime.datetime.now(datetime.timezone.utc)
    # İptal/iade edilen siparişin bekleyen durağı kalamaz — kalırsa start_run
    # o durakta geçersiz geçişe (CANCELLED→SHIPPED) takılıp TÜM turu bloklar.
    # Geçiş otoritesi burası olduğundan temizlik de burada (çağıran unutamaz).
    if new_status in ("CANCELLED", "REFUNDED"):
        await _close_open_stops(db, order.id, reason=f"Sipariş {new_status.lower()} oldu")
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            old_status=old_status,
            new_status=new_status,
            changed_by=changed_by,
            reason=reason,
        )
    )
