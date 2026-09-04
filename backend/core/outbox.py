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

from sqlalchemy import select, update
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


# ── Sessiz saat (PDS §3.8) — saf, pytest'li ──────────────────────────────────
#: Müşteri SMS'i gece yarısı gitmesin: kind bu önekle başlıyorsa sessiz saatte
#: ertelenir. E-posta (email:*) gürültüsüz sayılır, ertelenmez.
_QUIET_KINDS_PREFIX = "sms:"


def in_quiet_hours(
    local: datetime.datetime, *, start_hour: int, end_hour: int, end_minute: int
) -> bool:
    """Yerel zaman sessiz aralıkta mı? Aralık gece yarısını sarar (21:00–08:30):
    saat >= başlangıç VEYA saat/dakika < bitiş. ``start_hour <= 0`` → kapalı."""
    if start_hour <= 0:
        return False
    after_start = local.hour >= start_hour
    before_end = (local.hour, local.minute) < (end_hour, end_minute)
    return after_start or before_end


def next_allowed_send(
    now_utc: datetime.datetime,
    *,
    utc_offset_hours: int,
    start_hour: int,
    end_hour: int,
    end_minute: int,
) -> datetime.datetime | None:
    """Sessiz saatteyse bir SONRAKİ izinli gönderim anını (UTC) döner; değilse
    None (hemen gönder). Bitiş bugünse bugünün, akşamsa yarının sabahı."""
    tz = datetime.timezone(datetime.timedelta(hours=utc_offset_hours))
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=datetime.timezone.utc)
    local = now_utc.astimezone(tz)
    if not in_quiet_hours(
        local, start_hour=start_hour, end_hour=end_hour, end_minute=end_minute
    ):
        return None
    target = local.replace(hour=end_hour, minute=end_minute, second=0, microsecond=0)
    if local.hour >= start_hour:  # akşam → yarının sabahı
        target += datetime.timedelta(days=1)
    return target.astimezone(datetime.timezone.utc)


# ── Handler kayıtları: kind → async fn(payload) -> bool (gönderildi mi) ──────────


async def _h_sms_tracking_link(p: dict[str, Any]) -> bool:
    # `order_no` bu yüke sonradan eklendi. Dağıtım anında KUYRUKTA BEKLEYEN eski
    # satırlar onu taşımaz; anahtar hatası o SMS'i kalıcı olarak düşürürdü.
    # Geri düşüş iç kimliktir — eski davranışın aynısı.
    return await sms.send_tracking_link_sms(
        to=p["to"],
        order_no=p.get("order_no") or f"#{p['order_id']}",
        url=p["url"],
        shipment_no=p.get("shipment_no"),
    )


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



async def _h_email_contact(p: dict[str, Any]) -> bool:
    ok = await mail.send_contact_message_email(
        to=p["to"], from_name=p["from_name"], from_email=p["from_email"],
        subject=p["subject"], message=p["message"], user_ref=p.get("user_ref"),
    )
    # Teyit maili başarısız olsa da mesaj işletmeye ulaştıysa olay tamamdır:
    # kullanıcının mesajı kaybolmasın diye yeniden denemeye sokmuyoruz.
    if ok and p.get("ack_to"):
        await mail.send_contact_ack_email(
            to=p["ack_to"], name=p["from_name"], subject=p["subject"]
        )
    return ok


async def _h_email_tutor_lead(p: dict[str, Any]) -> bool:
    return await mail.send_tutor_lead_email(
        to=p["to"], name=p["name"], phone=p["phone"], subjects=p["subjects"],
        email=p.get("email"), district=p.get("district"),
        experience=p.get("experience"), note=p.get("note"),
        document_count=p.get("document_count", 0),
        # `.get` ile okunur: kuyrukta bekleyen ESKİ olaylarda bu anahtar yok.
        has_photo=p.get("has_photo", False),
    )


_HANDLERS: dict[str, Callable[[dict[str, Any]], Awaitable[bool]]] = {
    "sms:tracking_link": _h_sms_tracking_link,
    "sms:approach": _h_sms_approach,
    "sms:failed": _h_sms_failed,
    "sms:postponed": _h_sms_postponed,
    "email:order_status": _h_email_order_status,
    "email:contact": _h_email_contact,
    "email:tutor_lead": _h_email_tutor_lead,
}


def enqueue(db: AsyncSession, kind: str, payload: dict[str, Any]) -> None:
    """Olayı çağıranın transaction'ına ekler — COMMIT ETMEZ (atomiklik çağıranda)."""
    if kind not in _HANDLERS:
        raise ValueError(f"Bilinmeyen outbox kind: {kind}")
    db.add(OutboxEvent(kind=kind, payload=payload))


#: Sipariş iptal/iade edilince GEÇERSİZLEŞEN olay türleri — hepsi "kutu yolda"
#: anlatan teslimat bildirimleridir. `email:order_status` bilinçli olarak DIŞARIDA:
#: durum e-postası iptalden sonra da doğrudur (zaten iptali duyurur).
_TESLIMAT_BILDIRIMLERI = (
    "sms:tracking_link",
    "sms:approach",
    "sms:failed",
    "sms:postponed",
)


async def cancel_pending_for_order(db: AsyncSession, order_id: int) -> int:
    """Siparişin kuyrukta BEKLEYEN teslimat bildirimlerini iptal eder.

    Neden gerekli: outbox at-least-once'tır ve sessiz saat ertelemesi gönderim
    penceresini saatlere büyütür. Sipariş bu arada iptal/iade edilirse müşteriye
    "kuryen yola çıktı" SMS'i GİDER — kutu yokken. Olay, durum değişikliğiyle
    AYNI transaction'da iptal edilir (çağıran commit eder); rollback olursa
    iptal de geri alınır.

    Yalnız `PENDING` satırlar hedeflenir: `SENT` olan zaten gitmiştir, `FAILED`
    dead-letter kaydıdır ve denetim izi olarak korunur. Dönen: iptal edilen sayı.
    """
    res = await db.execute(
        update(OutboxEvent)
        .where(
            OutboxEvent.status == OutboxStatus.PENDING.value,
            OutboxEvent.kind.in_(_TESLIMAT_BILDIRIMLERI),
            OutboxEvent.payload["order_id"].astext == str(order_id),
        )
        .values(
            status=OutboxStatus.CANCELLED.value,
            last_error="sipariş iptal/iade edildi — bildirim geçersizleşti",
        )
    )
    return int(res.rowcount or 0)


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
        # Sessiz saat: müşteri SMS'i gece yarısı gitmez → sabaha ertele (deneme
        # SAYILMAZ, hata değil; yalnız zaman kaydırma). E-posta ertelenmez.
        if ev.kind.startswith(_QUIET_KINDS_PREFIX):
            defer_to = next_allowed_send(
                _now(),
                utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
                start_hour=settings.DELIVERY_QUIET_START_HOUR,
                end_hour=settings.DELIVERY_QUIET_END_HOUR,
                end_minute=settings.DELIVERY_QUIET_END_MINUTE,
            )
            if defer_to is not None:
                ev.next_attempt_at = defer_to
                continue
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
