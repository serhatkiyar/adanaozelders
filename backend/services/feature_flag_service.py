"""Bayrak okuma/yazma (admin paneli).

Katalog `core/flags.py`'dedir; bu servis onu DB durumuyla birleştirir ve
değişikliği **upsert** eder (satır yoksa oluşturur). Değişiklikten sonra
süreç-içi önbellek geçersiz kılınır; diğer süreçler en fazla TTL kadar gecikmeyle
görür.
"""
from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import flags
from core.config import settings
from models.feature_flag import FeatureFlag
from schemas.feature_flag import FeatureFlagOut


def _lock_reason(key: str) -> str | None:
    """Bayrak bu ortamda değiştirilebilir mi? Doluysa panel butonu kilitler."""
    if key == flags.FLAG_MANUAL_PAYOUT_ENABLED and settings.is_production:
        return (
            "Üretim ortamında kalıcı olarak kapalı — açılırsa uygulama bir "
            "sonraki başlatmada açılmaz."
        )
    return None


async def list_flags(db: AsyncSession) -> list[FeatureFlagOut]:
    rows = (await db.execute(select(FeatureFlag))).scalars().all()
    by_key = {r.key: r for r in rows}
    out: list[FeatureFlagOut] = []
    for spec in flags.FLAG_SPECS:
        row = by_key.get(spec.key)
        out.append(
            FeatureFlagOut(
                key=spec.key,
                label=spec.label,
                description=spec.description,
                enabled=spec.default if row is None else bool(row.enabled),
                default=spec.default,
                enforced=spec.enforced,
                updated_at=row.updated_at if row else None,
                updated_by_admin_id=row.updated_by_admin_id if row else None,
                note=row.note if row else None,
                locked_reason=_lock_reason(spec.key),
            )
        )
    return out


async def set_flag(
    db: AsyncSession,
    *,
    key: str,
    enabled: bool,
    admin_id: int,
    note: str | None = None,
) -> tuple[FeatureFlagOut, bool]:
    """Bayrağı ayarlar. `(yeni durum, önceki değer)` döner — audit `before/after`
    için önceki değere ihtiyaç duyar.

    Tanımsız anahtar `KeyError` yükseltir (router 404'e çevirir): panelin
    göndermediği bir anahtar programlama ya da manipülasyon işaretidir.

    **Üretimde `manual_payout_enabled` AÇILAMAZ.** Çalışma zamanı kapısı bu yolu
    zaten reddediyor (`payment_gates.assert_manual_payout_open` ortam kontrolünü
    bayraktan önce yapar), ama bayrağı açık bırakmak sonraki yeniden başlatmada
    uygulamayı hiç açtırmaz (`manual_payout_startup_problem`). Panelden
    açılabilir bırakmak, operatöre "servisi kaldıramaz hâle getir" düğmesi
    vermek olurdu.
    """
    spec = flags.spec(key)
    if key == flags.FLAG_MANUAL_PAYOUT_ENABLED and enabled and settings.is_production:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "FLAG_LOCKED_IN_PRODUCTION",
                "message": (
                    "Elle havale yolu üretimde kalıcı olarak kapalıdır; bu bayrak "
                    "açılamaz. Hakediş ödemesi sağlayıcı üzerinden yapılmalıdır."
                ),
            },
        )
    row = (
        await db.execute(select(FeatureFlag).where(FeatureFlag.key == key))
    ).scalars().first()
    previous = spec.default if row is None else bool(row.enabled)

    if row is None:
        row = FeatureFlag(key=key)
        db.add(row)
    row.enabled = enabled
    row.updated_by_admin_id = admin_id
    row.note = note
    row.updated_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()
    # NOT: önbellek burada geçersiz KILINMAZ. `flush` henüz commit değildir;
    # invalidate edilirse aradaki pencerede aynı worker'daki eşzamanlı bir istek
    # cache-miss alıp commit EDİLMEMİŞ (yani eski) değeri okur ve 10 sn
    # önbelleğe yazar — üstelik önemsediğimiz yön olan "kapatma" kararı gecikir.
    # Çağıran, commit'ten SONRA `flags.invalidate(key)` çağırmakla yükümlüdür.

    return (
        FeatureFlagOut(
            key=spec.key,
            label=spec.label,
            description=spec.description,
            enabled=enabled,
            default=spec.default,
            enforced=spec.enforced,
            updated_at=row.updated_at,
            updated_by_admin_id=row.updated_by_admin_id,
            note=row.note,
            locked_reason=_lock_reason(spec.key),
        ),
        previous,
    )
