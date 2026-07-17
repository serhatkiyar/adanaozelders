"""Transactional outbox işleyicisi (bkz. models/outbox.py gerekçesi).

``enqueue`` olayı ÇAĞIRANIN transaction'ına ekler (commit etmez) — durum
değişikliğiyle olay atomik kalıcı olur. ``dispatch_pending`` worker adımıdır:
zamanı gelmiş PENDING olayları FOR UPDATE SKIP LOCKED ile alır (çoklu worker
güvenli), handler'ı çağırır; başarıda SENT, hatada üstel backoff'la yeniden
dener, ``OUTBOX_MAX_ATTEMPTS`` tavanında FAILED (dead-letter) bırakır.

``next_backoff_seconds`` saftır (pytest'li).
"""
from __future__ import annotations

import datetime
import logging
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import mail, sms
from core.config import settings
from models.outbox import OutboxEvent, OutboxStatus

logger = logging.getLogger("adana.outbox")

# Deneme başına bekleme tabanı; üst sınır 1 saat (SMS'in saatler sonra gelmesi
# anlamsızlaşır ama kayıt/iz için denemeye değer — tavana FAILED zaten var).
_BACKOFF_BASE_SECONDS = 30
_BACKOFF_MAX_SECONDS = 3600


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def next_backoff_seconds(attempts: int) -> int:
    """attempts. denemeden SONRA kaç sn beklenir? (saf) 30s, 60s, 120s… tavan 1h."""
    return min(_BACKOFF_BASE_SECONDS * (2 ** max(attempts - 1, 0)), _BACKOFF_MAX_SECONDS)


# ── Handler kayıtları: kind → async fn(payload) -> bool (gönderildi mi) ──────────


async def _h_sms_tracking_link(p: dict[str, Any]) -> bool:
    return await sms.send_tracking_link_sms(to=p["to"], order_id=p["order_id"], url=p["url"])


async def _h_sms_approach(p: dict[str, Any]) -> bool:
    return await sms.send_approach_sms(
        to=p["to"], order_id=p["order_id"], stops_ahead=p["stops_ahead"], url=p["url"]
    )


async def _h_sms_failed(p: dict[str, Any]) -> bool:
    return await sms.send_failed_sms(to=p["to"], order_id=p["order_id"])


async def _h_sms_postponed(p: dict[str, Any]) -> bool:
    return await sms.send_postponed_sms(
        to=p["to"], order_id=p["order_id"], new_date=p["new_date"]
    )


async def _h_email_order_status(p: dict[str, Any]) -> bool:
    return await mail.send_order_status_email(
        to=p["to"], name=p["name"], order_id=p["order_id"], status=p["status"],
        total=p["total"], currency=p["currency"], orders_url=p["orders_url"],
    )


_HANDLERS: dict[str, Callable[[dict[str, Any]], Awaitable[bool]]] = {
    "sms:tracking_link": _h_sms_tracking_link,
    "sms:approach": _h_sms_approach,
    "sms:failed": _h_sms_failed,
    "sms:postponed": _h_sms_postponed,
    "email:order_status": _h_email_order_status,
}


def enqueue(db: AsyncSession, kind: str, payload: dict[str, Any]) -> None:
    """Olayı çağıranın transaction'ına ekler — COMMIT ETMEZ (atomiklik çağıranda)."""
    if kind not in _HANDLERS:
        raise ValueError(f"Bilinmeyen outbox kind: {kind}")
    db.add(OutboxEvent(kind=kind, payload=payload))


async def dispatch_pending(db: AsyncSession, *, limit: int = 50) -> int:
    """Zamanı gelmiş PENDING olayları gönderir; gönderilen sayısını döner.

    SKIP LOCKED: aynı anda ikinci bir worker/instance koşarsa olaylar paylaşılır,
    çift gönderim olmaz (at-least-once garantisi süreç çökmesinde yine geçerli:
    gönderildi ama SENT yazılamadıysa bir sonraki tur yeniden gönderir).
    """
    events = (
        (
            await db.execute(
                select(OutboxEvent)
                .where(
                    OutboxEvent.status == OutboxStatus.PENDING.value,
                    OutboxEvent.next_attempt_at <= _now(),
                )
                .order_by(OutboxEvent.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    sent = 0
    for ev in events:
        handler = _HANDLERS.get(ev.kind)
        ev.attempts += 1
        try:
            ok = handler is not None and await handler(ev.payload)
            error = None if handler is not None else f"handler yok: {ev.kind}"
        except Exception as exc:  # noqa: BLE001 — sender'lar fail-soft ama emniyet
            ok, error = False, f"{exc.__class__.__name__}: {exc}"
        if ok:
            ev.status = OutboxStatus.SENT.value
            ev.last_error = None
            sent += 1
        else:
            ev.last_error = error or "gönderim başarısız"
            if ev.attempts >= settings.OUTBOX_MAX_ATTEMPTS:
                ev.status = OutboxStatus.FAILED.value
                logger.error(
                    "outbox dead-letter: id=%s kind=%s (%s deneme) %s",
                    ev.id, ev.kind, ev.attempts, ev.last_error,
                )
            else:
                ev.next_attempt_at = _now() + datetime.timedelta(
                    seconds=next_backoff_seconds(ev.attempts)
                )
    await db.commit()
    return sent
