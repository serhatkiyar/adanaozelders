from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.client import Client
from models.demand import Demand, DemandStatus
from models.demand_response import DemandResponse
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.demand import DemandCreate
from services import messaging_service, notification_service


async def create_demand(
    db: AsyncSession, client: Client, data: DemandCreate
) -> Demand:
    demand = Demand(client_id=client.id, **data.model_dump())
    db.add(demand)
    await db.flush()
    await db.refresh(demand)
    return demand


async def _response_counts(db: AsyncSession, demand_ids: list[int]) -> dict[int, int]:
    """Talep başına aktif yanıt sayısı (öğrencinin 'kaç eğitmen yanıtladı' rozeti)."""
    if not demand_ids:
        return {}
    rows = (
        await db.execute(
            select(DemandResponse.demand_id, func.count())
            .where(
                DemandResponse.demand_id.in_(demand_ids),
                DemandResponse.deleted_at.is_(None),
            )
            .group_by(DemandResponse.demand_id)
        )
    ).all()
    return {did: cnt for did, cnt in rows}


async def list_open_demands(
    db: AsyncSession,
    *,
    tutor: Tutor,
    subjects: list[str] | None = None,
    subject: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Demand]:
    """Açık talepleri (eğitmen browse) listeler.

    ``subjects`` verilirse (eğitmenin "alanıma uygun" filtresi) yalnız o branşlardaki
    talepler döner; aksi halde opsiyonel ``subject`` trigram filtresi. Öğrenci adı ve
    eğitmenin daha önce yanıtlayıp yanıtlamadığı (``responded``) doldurulur.
    """
    stmt = (
        select(Demand, Client.first_name, Client.last_name)
        .join(Client, Client.id == Demand.client_id)
        .where(Demand.status == DemandStatus.OPEN, Demand.deleted_at.is_(None))
    )
    if subjects is not None:
        # Boş liste (eğitmenin hiç branşı yok) → hiç eşleşme.
        stmt = stmt.where(Demand.subject.in_(subjects))
    elif subject:
        stmt = stmt.where(Demand.subject.op("%")(subject))
    stmt = stmt.order_by(Demand.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).all()

    demands = [d for d, _fn, _ln in rows]
    # Bu eğitmenin daha önce yanıtladığı talepleri tek sorguda işaretle.
    responded_ids: set[int] = set()
    if demands:
        responded_ids = set(
            (
                await db.execute(
                    select(DemandResponse.demand_id).where(
                        DemandResponse.demand_id.in_([d.id for d in demands]),
                        DemandResponse.tutor_id == tutor.id,
                        DemandResponse.deleted_at.is_(None),
                    )
                )
            ).scalars()
        )
    for d, fn, ln in rows:
        d.client_name = f"{fn} {ln}".strip()
        d.responded = d.id in responded_ids
    return demands


async def list_client_demands(
    db: AsyncSession, client: Client, *, limit: int = 20, offset: int = 0
) -> list[Demand]:
    stmt = (
        select(Demand)
        .where(Demand.client_id == client.id, Demand.deleted_at.is_(None))
        .order_by(Demand.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    demands = list((await db.execute(stmt)).scalars().all())
    counts = await _response_counts(db, [d.id for d in demands])
    for d in demands:
        d.response_count = counts.get(d.id, 0)
    return demands


async def close_demand(db: AsyncSession, client: Client, demand_id: int) -> Demand:
    demand = await db.get(Demand, demand_id)
    if demand is None or demand.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demand not found")
    if demand.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your demand")
    if demand.status != DemandStatus.OPEN:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only OPEN demands can be closed"
        )
    demand.status = DemandStatus.CLOSED
    await db.flush()
    return demand


async def respond_to_demand(
    db: AsyncSession, tutor: Tutor, demand_id: int, body: str
) -> dict:
    """Eğitmen açık talebe yanıt verir → öğrenciyle sohbet açılır (ilk mesaj eğitmenden).

    DemandResponse kaydı hem dedupe hem de (rezervasyon olmadan) mesajlaşma izni içindir.
    Talep + eğitmen başına tek yanıt; sonrasında sohbetten devam edilir.
    """
    demand = await db.get(Demand, demand_id)
    if demand is None or demand.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Talep bulunamadı")
    if demand.status != DemandStatus.OPEN:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu talep artık açık değil")

    existing = await db.scalar(
        select(DemandResponse.id).where(
            DemandResponse.demand_id == demand_id,
            DemandResponse.tutor_id == tutor.id,
            DemandResponse.deleted_at.is_(None),
        )
    )
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu talebi zaten yanıtladın; sohbetten devam edebilirsin.",
        )

    db.add(DemandResponse(demand_id=demand_id, tutor_id=tutor.id))
    # Yanıt kaydı flush edilince _can_message bu çift için izin verir.
    await db.flush()

    message = await messaging_service.send_message(
        db, sender=tutor, counterparty_id=demand.client_id, body=body
    )
    await notification_service.notify(
        db,
        user_id=demand.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"Bir eğitmen \"{demand.title}\" talebine yanıt verdi.",
        link="/mesajlar",
    )

    client = await db.get(Client, demand.client_id)
    return {
        "conversation_id": message.conversation_id,
        "client_id": demand.client_id,
        "client_name": client.full_name if client else "Öğrenci",
    }


async def list_responses(
    db: AsyncSession, client: Client, demand_id: int
) -> list[dict]:
    """Öğrencinin kendi talebine gelen yanıtlayan eğitmenler (sohbete köprü)."""
    demand = await db.get(Demand, demand_id)
    if demand is None or demand.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Talep bulunamadı")
    if demand.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Senin talebin değil")
    rows = (
        await db.execute(
            select(
                Tutor.id,
                Tutor.first_name,
                Tutor.last_name,
                Tutor.avatar_url,
                Tutor.headline,
                DemandResponse.created_at,
            )
            .join(Tutor, Tutor.id == DemandResponse.tutor_id)
            .where(
                DemandResponse.demand_id == demand_id,
                DemandResponse.deleted_at.is_(None),
            )
            .order_by(DemandResponse.created_at.desc())
        )
    ).all()
    return [
        {
            "tutor_id": tid,
            "tutor_name": f"{fn} {ln}".strip(),
            "tutor_avatar_url": avatar,
            "headline": headline,
            "responded_at": created_at,
        }
        for tid, fn, ln, avatar, headline, created_at in rows
    ]
