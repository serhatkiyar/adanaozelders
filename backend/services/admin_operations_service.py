"""Yönetici operasyon kurtarma servisi — sıkışmış para + ölü iş (İP-4 / P1-4).

## Neden var

`escrow_reconciler` deneme tavanı dolan iadeyi `logger.error("MANUEL müdahale
gerekli")` ile bırakıyordu ve `core/outbox` dead-letter satırlarını hiçbir uç
göstermiyordu. Yani sarkan para ile ölü SMS/e-posta işi YALNIZ sunucu logunda
görünüyor, düzeltmesi YALNIZ SQL'den yapılabiliyordu (denetim raporu §4.2/P1-4).

## Sözleşme

1. Bu modül **para durumu değiştirmez**. Listeler salt okumadır; tek yazma
   işlemi ölü bir outbox işini yeniden kuyruğa almaktır (`retry_outbox_event`).
   Sıkışmış escrow için "elle iade et" DÜĞMESİ BİLİNÇLİ OLARAK YOKTUR: iade
   kararının tek sahibi `services/escrow.py`'nin iki fazlı claim'idir ve
   yönetici yüzeyinden ikinci bir para yolu açmak İP-2a'nın kapattığı riski
   geri getirir.
2. Kuyruk **gürültüsüz** olmalıdır: yalnızca otomatiğin ARTIK çözemeyeceği
   kayıtlar girer (`refund_attempts >= REFUND_MAX_ATTEMPTS` ya da kalıcı
   `MANUAL_REVIEW`). Reconciler'ın birkaç dakika içinde kendiliğinden bitireceği
   taze bir `REFUNDING` alarm değildir.
3. Model listesi `escrow_reconciler._REFUNDING_TARGETS`'tan DEVRALINIR. Yeni bir
   escrow yüzeyi eklendiğinde kuyruk kendiliğinden kapsar; ikinci bir katalog
   tutmak, ilk unutulduğunda sessiz bir kör nokta üretirdi.
"""
from __future__ import annotations

import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.outbox import OutboxEvent, OutboxStatus
from models.store import Order, OrderReturn
from schemas.admin_operations import FailedOutboxOut, OutboxRetryOut, StuckEscrowOut
from services import escrow
from services.escrow_reconciler import _REFUNDING_TARGETS

#: Model → yanıttaki `entity` etiketi. Sınıf adına DEĞİL açık haritaya bağlı:
#: bir modelin Python adı değişirse istemci sözleşmesi sessizce kaymamalı.
#:
#: Eksik anahtar bilinçli olarak **KeyError (500)** verir, sessiz atlama DEĞİL:
#: `_REFUNDING_TARGETS`'a yeni bir escrow yüzeyi eklenip burası unutulursa,
#: sessiz atlama o yüzeyin sıkışmış kayıtlarını kuyruktan görünmez kılardı —
#: yani bu modülün varlık sebebini (kör nokta bırakmamak) ortadan kaldırırdı.
_ENTITY_ADI: dict[str, str] = {
    "Payment": "payment",
    "ExamRegistration": "exam_registration",
    "StudyReservation": "study_reservation",
    "Order": "order",
    "OrderReturn": "order_return",
}


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def list_stuck_escrow(db: AsyncSession) -> list[StuckEscrowOut]:
    """Otomatiğin çözemediği para kayıtları — en yeni dokunulan önce."""
    out: list[StuckEscrowOut] = []
    for model, spec in _REFUNDING_TARGETS:
        status_col = getattr(model, spec.status_attr)
        aranan = [spec.refunding]
        if spec.manual_review is not None:
            aranan.append(spec.manual_review)
        kosullar = [status_col.in_([escrow._durum_degeri(d) for d in aranan])]
        if hasattr(model, "deleted_at"):
            kosullar.append(model.deleted_at.is_(None))
        rows = (await db.execute(select(model).where(*kosullar))).scalars().all()
        for obj in rows:
            durum = escrow._durum_degeri(getattr(obj, spec.status_attr))
            manuel = spec.manual_review is not None and durum == escrow._durum_degeri(
                spec.manual_review
            )
            if not manuel and obj.refund_attempts < settings.REFUND_MAX_ATTEMPTS:
                # Otomatiğin hâlâ deneme hakkı var — alarm değil.
                continue
            out.append(
                StuckEscrowOut(
                    entity=_ENTITY_ADI[model.__name__],  # type: ignore[arg-type]
                    entity_id=obj.id,
                    order_id=_siparis_kimligi(obj),
                    reason="MANUAL_REVIEW" if manuel else "RETRY_EXHAUSTED",
                    money_status=durum,
                    amount=getattr(obj, spec.amount_attr, None),
                    currency=getattr(obj, "currency", None),
                    refund_attempts=obj.refund_attempts,
                    refund_requested_at=obj.refund_requested_at,
                    provider_ref=obj.provider_ref,
                    updated_at=getattr(obj, "updated_at", None),
                )
            )
    out.sort(key=lambda k: (k.updated_at or k.refund_requested_at or _now()), reverse=True)
    return out


def _siparis_kimligi(obj) -> int | None:
    if isinstance(obj, OrderReturn):
        return obj.order_id
    if isinstance(obj, Order):
        return obj.id
    return None


def _outbox_projeksiyonu(ev: OutboxEvent) -> dict:
    """Ham payload'ı DIŞARIDA bırakan whitelist projeksiyonu.

    `payload` alıcının telefonunu/e-postasını taşır; teşhis için gereken şey
    `kind` + `last_error` + siparişe gidebilmektir.
    """
    ham = ev.payload or {}
    order_id = ham.get("order_id")
    return {
        "id": ev.id,
        "kind": ev.kind,
        "status": ev.status,
        "attempts": ev.attempts,
        "last_error": ev.last_error,
        "order_id": int(order_id) if isinstance(order_id, (int, str)) and str(order_id).isdigit() else None,
        "next_attempt_at": ev.next_attempt_at,
        "created_at": ev.created_at,
        "updated_at": ev.updated_at,
    }


async def list_failed_outbox(
    db: AsyncSession, *, limit: int = 100, offset: int = 0
) -> list[FailedOutboxOut]:
    """Dead-letter kuyruğu (`status=FAILED`) — en yeni önce.

    `CANCELLED` bilinçli olarak DIŞARIDA: o "gönderemedik" değil
    "gönderilmemeliydi" demektir (sipariş iptal edilmiş) ve operatörün
    yapacağı bir iş yoktur.
    """
    rows = (
        await db.execute(
            select(OutboxEvent)
            .where(OutboxEvent.status == OutboxStatus.FAILED.value)
            .order_by(OutboxEvent.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return [FailedOutboxOut(**_outbox_projeksiyonu(ev)) for ev in rows]


class OutboxRetryReddedildi(Exception):
    """Retry edilemeyecek durumdaki iş (`SENT` / `CANCELLED`)."""


async def retry_outbox_event(db: AsyncSession, event_id: int) -> OutboxRetryOut | None:
    """Ölü işi yeniden kuyruğa alır. Dönen: sonuç, ya da yoksa ``None``.

    ## Idempotency sözleşmesi

    Yeniden kuyruğa alma **koşullu tek UPDATE**'tir (`WHERE status = 'FAILED'`).
    İkinci çağrı hiçbir satırı etkilemez ve `requeued=False` döner: yeni bir
    olay ÜRETİLMEZ, sayaç ikinci kez sıfırlanmaz. Sayacı yeniden sıfırlamak
    zararsız görünür ama değildir — worker at-least-once'tır; iki kez sıfırlanan
    bir iş, sağlayıcı yavaşken iki ayrı gönderim penceresine girebilir.

    ## Neden sayaç sıfırlanıyor

    `attempts` tavanda bırakılırsa worker ilk turda yeniden tavana çarpar ve iş
    anında `FAILED`'a döner; retry hiçbir şey yapmamış olur. Sıfırlama
    yöneticinin bilinçli kararıdır (`operations.manage`) ve denetim izine yazılır.

    ## Neden SENT reddediliyor

    SMS/e-posta GERİ ALINAMAZ. Gönderilmiş bir işi "yeniden dene" ile
    tetiklemek müşteriye ikinci mesajı yollar; bu bir teşhis değil hatadır.
    """
    ev = await db.get(OutboxEvent, event_id, populate_existing=True)
    if ev is None:
        return None
    if ev.status in (OutboxStatus.SENT.value, OutboxStatus.CANCELLED.value):
        raise OutboxRetryReddedildi(ev.status)

    # Projeksiyon UPDATE'ten ÖNCE alınır: ORM-enabled UPDATE oturumu senkronize
    # ederken nesnenin alanlarını expire edebilir ve bayat nesnenin alanına
    # dokunmak async oturumda lazy-load (MissingGreenlet) üretir. Bu tuzağa bir
    # kez düşüldü; `escrow_reconciler` de aynı sebeple önce KİMLİK topluyor.
    goruntu = _outbox_projeksiyonu(ev)
    simdi = _now()
    res = await db.execute(
        update(OutboxEvent)
        .where(
            OutboxEvent.id == event_id,
            OutboxEvent.status == OutboxStatus.FAILED.value,
        )
        .values(
            status=OutboxStatus.PENDING.value,
            attempts=0,
            next_attempt_at=simdi,
        )
        .execution_options(synchronize_session=False)
    )
    requeued = bool(res.rowcount)
    if requeued:
        goruntu.update(
            {
                "status": OutboxStatus.PENDING.value,
                "attempts": 0,
                "next_attempt_at": simdi,
            }
        )
    return OutboxRetryOut(**goruntu, requeued=requeued)
