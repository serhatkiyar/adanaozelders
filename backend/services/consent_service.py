"""Rıza kayıtları (KVKK m.10/ETK) — ispat yükü veri sorumlusundadır.

Kayıt formundaki onay kutusu stateless'tı: kullanıcı "ben onaylamadım" dediğinde
gösterilecek hiçbir kayıt yoktu. Ayrıca metin sürümü değiştiğinde eski onayın
hangi metne verildiği bilinmiyordu.

Tasarım kararları:
- Onaylar **append-only**: geri alma yeni bir ``granted=False`` satırıdır, eski
  satır silinmez. Denetimde "ne zaman neye onay verdi, ne zaman geri aldı"
  zinciri okunabilir olmalıdır.
- Sürüm, frontend'deki ``legalContent.ts`` belgelerinin ``updatedAt`` değeridir
  ("YYYY-MM-DD"). Ayrı bir sürüm alanı tutmak iki kaynak yaratırdı.
- Zorunlu onaylar (KVKK/koşullar/gizlilik) kayıt akışında, pazarlama izinleri
  (ETK/İYS) ayarlardan verilir; ikisi aynı tabloda ``doc_key`` ile ayrışır.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.consent import ConsentDoc, UserConsent

#: Kayıt sırasında onaylanması zorunlu belgeler.
REQUIRED_AT_SIGNUP: tuple[str, ...] = (
    ConsentDoc.KVKK,
    ConsentDoc.TERMS,
    ConsentDoc.PRIVACY,
)

#: Kullanıcının ayarlardan yönettiği (opsiyonel) izinler.
MARKETING_DOCS: tuple[str, ...] = (
    ConsentDoc.MARKETING_EMAIL,
    ConsentDoc.MARKETING_SMS,
)


async def record(
    db: AsyncSession,
    *,
    user_id: int,
    role_id: int,
    doc_key: str,
    doc_version: str,
    granted: bool = True,
    ip: str | None = None,
    user_agent: str | None = None,
) -> UserConsent:
    """Tek bir onay/geri alma satırı yazar (commit çağıranın)."""
    row = UserConsent(
        user_id=user_id,
        role_id=role_id,
        doc_key=doc_key,
        doc_version=doc_version,
        granted=granted,
        ip=ip,
        # Uzun user-agent'lar kolonu taşırmasın.
        user_agent=(user_agent or None) and user_agent[:300],
    )
    db.add(row)
    return row


async def record_signup_consents(
    db: AsyncSession,
    *,
    user_id: int,
    role_id: int,
    doc_version: str,
    ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Kayıt akışındaki zorunlu onayları tek seferde yazar."""
    for doc_key in REQUIRED_AT_SIGNUP:
        await record(
            db,
            user_id=user_id,
            role_id=role_id,
            doc_key=doc_key,
            doc_version=doc_version,
            granted=True,
            ip=ip,
            user_agent=user_agent,
        )


async def latest_by_doc(
    db: AsyncSession, *, user_id: int, role_id: int
) -> dict[str, UserConsent]:
    """Kullanıcının her belge için EN GÜNCEL onay satırı.

    Geçmiş korunduğundan aynı belgeye birden çok satır olabilir; geçerli durum
    en son yazılandır.
    """
    rows = (
        await db.execute(
            select(UserConsent)
            .where(
                UserConsent.user_id == user_id,
                UserConsent.role_id == role_id,
            )
            .order_by(UserConsent.created_at.asc(), UserConsent.id.asc())
        )
    ).scalars().all()
    out: dict[str, UserConsent] = {}
    for row in rows:
        out[row.doc_key] = row  # sonraki yazım öncekini ezer → en güncel kalır
    return out


async def is_granted(
    db: AsyncSession, *, user_id: int, role_id: int, doc_key: str
) -> bool:
    """Bir izin şu an açık mı (pazarlama gönderimi öncesi kontrol)."""
    latest = await latest_by_doc(db, user_id=user_id, role_id=role_id)
    row = latest.get(doc_key)
    return bool(row and row.granted)


async def set_marketing(
    db: AsyncSession,
    *,
    user_id: int,
    role_id: int,
    doc_key: str,
    granted: bool,
    doc_version: str,
    ip: str | None = None,
    user_agent: str | None = None,
) -> UserConsent:
    """Pazarlama iznini açar/kapatır (her değişiklik yeni satır)."""
    if doc_key not in MARKETING_DOCS:
        raise ValueError(f"Pazarlama izni değil: {doc_key}")
    return await record(
        db,
        user_id=user_id,
        role_id=role_id,
        doc_key=doc_key,
        doc_version=doc_version,
        granted=granted,
        ip=ip,
        user_agent=user_agent,
    )


async def purge_for_user(db: AsyncSession, *, user_id: int, role_id: int) -> None:
    """Hesap anonimleştirmesinde rıza kayıtlarındaki PII'yi temizler.

    Satırlar silinmez (onayın verildiği gerçeği ispat için kalır) ama IP ve
    user-agent — kişisel veri — boşaltılır.
    """
    rows = (
        await db.execute(
            select(UserConsent).where(
                UserConsent.user_id == user_id,
                UserConsent.role_id == role_id,
            )
        )
    ).scalars().all()
    for row in rows:
        row.ip = None
        row.user_agent = None
