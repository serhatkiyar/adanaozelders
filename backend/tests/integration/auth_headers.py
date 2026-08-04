"""Test tarafı token üretimi — `auth_ver` claim'i GERÇEK satırdan okunur.

## Neden bu modül var

İP-3 §6 ile `api/deps.get_current_user` `auth_ver` claim'ini **bütün roller
için** denetler: claim yoksa `None` okunur, DB'deki `auth_version` ile
eşleşmez ve token **her uçta 401** alır.

F30, İP-2b ve İP-1a test fabrikaları bu denetimden ÖNCE yazıldığı için
token'larını `create_access_token(subject=…, role=…, role_id=…)` ile, yani
claim'siz üretiyordu. İki dal birleşince bu, 161 testi (F30 115 · İP-1a 34 ·
İP-2b 12) "Could not validate credentials" ile düşürdü — üretim kusuru değil,
test altyapısının üretim sözleşmesine yetişmemesi.

## Neden sabit `1` yazılmıyor

Fabrika hesapları bugün hiç şifre değiştirmediği için sürümleri kolon
varsayılanı (`1`) olurdu ve sabit yazmak "çalışırdı". Ama o sabit, sürüm
artıran bir senaryo eklendiği gün testi SESSİZCE yanlış yeşile çevirirdi
(kök `CLAUDE.md` → E: "fikstür sabit olduğu için bozuk davranış gözlenmeden mi
kalıyor?"). Bu yüzden değer her seferinde gerçek satırdan okunur ve satır
yoksa **yüksek sesle** hata verilir — sessizce geçerli görünen bir token
üretmek, testin ölçtüğü şeyi kaybettirir.

Rol→model eşlemesi `auth_service.MODEL_BY_ROLE_ID`'den gelir (üretimin tek
kaynağı); yeni bir rol eklenince bu yardımcı kendiliğinden onu da kapsar.
"""
from __future__ import annotations

from sqlalchemy import select

from core.database import AsyncSessionLocal
from core.security import create_access_token
from services.auth_service import MODEL_BY_ROLE_ID


async def auth_version_of(role_id: int, user_id: int) -> int:
    """`(role_id, user_id)` hesabının DB'deki güncel oturum sürümü."""
    model = MODEL_BY_ROLE_ID.get(role_id)
    if model is None:
        raise AssertionError(
            f"role_id={role_id} `auth_service.MODEL_BY_ROLE_ID`'de yok — "
            "yeni bir rol eklendiyse üretim katalogu güncellenmeli"
        )
    async with AsyncSessionLocal() as s:
        sürüm = (
            await s.execute(
                select(model.auth_version).where(model.id == user_id)
            )
        ).scalar_one_or_none()
    if sürüm is None:
        raise AssertionError(
            f"{model.__name__} id={user_id} bulunamadı — token üretilemez. "
            "(Fabrika satırı yaratmadan başlık istendiyse test kurgusu hatalı.)"
        )
    return sürüm


async def bearer_token(user_id: int, *, role: str, role_id: int) -> str:
    """Üretimdekiyle AYNI sözleşmeye sahip access token."""
    return create_access_token(
        subject=user_id,
        role=role,
        role_id=role_id,
        auth_version=await auth_version_of(role_id, user_id),
    )


async def bearer_headers(user_id: int, *, role: str, role_id: int) -> dict[str, str]:
    """`Authorization` başlığı — gerçek yetki zincirinden geçer."""
    return {"Authorization": f"Bearer {await bearer_token(user_id, role=role, role_id=role_id)}"}
