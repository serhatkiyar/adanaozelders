from __future__ import annotations

import datetime
import enum
import re

from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.observability import request_id_ctx
from models.audit_log import AuditLog

#: Audit'e ASLA girmeyecek alan adları (alt-string eşleşme, case-insensitive):
#: kimlik bilgisi, oturum sırrı ve yasal hassas veri (TCKN/IBAN). Değer yerine
#: "[gizlendi]" yazılır — alanın DEĞİŞTİĞİ görünür, içeriği görünmez.
_SENSITIVE_KEY_RE = re.compile(
    r"password|passwd|secret|token|authorization|api_key|apikey|tckn|iban|otp|jti|hash",
    re.IGNORECASE,
)
_REDACTED = "[gizlendi]"
#: JSONB'ye kontrolsüz derinlik/nesne yazılmasın (audit özet içindir, dump değil).
_MAX_DEPTH = 4


def _scalar(v):
    """Yaprak değeri JSONB'ye güvenli hale getirir — çağıranlar Pydantic dump'ını
    olduğu gibi verebilsin diye Decimal/datetime/enum burada dönüştürülür."""
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, enum.Enum):
        return _scalar(v.value)
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return v.isoformat()
    return str(v)  # Decimal, UUID vb.


def redact(values: dict | None) -> dict | None:
    """Yapılandırılmış audit değerlerinden hassas alanları maskeler (saf, pytest'li).

    İç içe dict/list yapıları gezilir; anahtar adı hassas desenle eşleşirse değer
    maskelenir. Derinlik sınırı aşılırsa dal "[derin]" olarak kırpılır."""
    if values is None:
        return None

    def _walk(v, depth: int):
        if depth > _MAX_DEPTH:
            return "[derin]"
        if isinstance(v, dict):
            return {
                k: (_REDACTED if _SENSITIVE_KEY_RE.search(str(k)) else _walk(x, depth + 1))
                for k, x in v.items()
            }
        if isinstance(v, (list, tuple)):
            return [_walk(x, depth + 1) for x in v]
        return _scalar(v)

    return _walk(values, 1)


async def record(
    db: AsyncSession,
    *,
    actor,
    action: str,
    target_type: str,
    target_id: int | None = None,
    details: str | None = None,
    reason: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    meta: dict | None = None,
    ip_address: str | None = None,
) -> None:
    """Admin kritik aksiyonunu audit_logs'a yazar (append-only).

    before/after/meta HER ZAMAN redaction'dan geçer; request_id aktif istekten
    (observability ContextVar) otomatik alınır — çağıranın taşıması gerekmez."""
    rid = request_id_ctx.get()
    db.add(
        AuditLog(
            actor_id=actor.id,
            actor_role=actor.role_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
            reason=reason,
            before_values=redact(before),
            after_values=redact(after),
            meta=redact(meta),
            ip_address=ip_address,
            request_id=rid if rid != "-" else None,
        )
    )
    await db.flush()


async def list_logs(
    db: AsyncSession,
    *,
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
    action: str | None = None,
    target_type: str | None = None,
    actor_id: int | None = None,
    request_id: str | None = None,
    sort: str = "created_at",
    order: str = "desc",
) -> tuple[list[AuditLog], int]:
    filters = []
    normalized_q = q.strip() if q and q.strip() else None
    if normalized_q:
        pattern = f"%{normalized_q}%"
        filters.append(
            or_(
                AuditLog.action.ilike(pattern),
                AuditLog.target_type.ilike(pattern),
                AuditLog.details.ilike(pattern),
                AuditLog.reason.ilike(pattern),
            )
        )
    if action:
        filters.append(AuditLog.action == action)
    if target_type:
        filters.append(AuditLog.target_type == target_type)
    if actor_id is not None:
        filters.append(AuditLog.actor_id == actor_id)
    if request_id and request_id.strip():
        # Kısmi yapıştırma da eşleşsin (log satırından kopyalanan kısa önek).
        filters.append(AuditLog.request_id.ilike(f"%{request_id.strip()}%"))

    total = int(
        (await db.scalar(select(func.count()).select_from(AuditLog).where(*filters)))
        or 0
    )
    sort_columns = {
        "created_at": AuditLog.created_at,
        "action": AuditLog.action,
        "target_type": AuditLog.target_type,
        "actor_id": AuditLog.actor_id,
    }
    sort_column = sort_columns[sort]
    order_by = asc(sort_column) if order == "asc" else desc(sort_column)
    stmt = (
        select(AuditLog)
        .where(*filters)
        .order_by(order_by, AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list((await db.execute(stmt)).scalars().all())
    return items, total
