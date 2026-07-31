"""F29 envanter uçları — sayım oturumları ve hasar işlemleri (ADMIN).

## Bu katman ne YAPMAZ

İş mantığı taşımaz. Sayım FSM'i, snapshot/`STALE` kuralları, atomik uygulama,
kova aritmetiği, idempotency ve defter bütünlüğü doğrulaması
`services/inventory_service.py` ile `services/inventory_damage.py`'dedir ve
burada **yeniden uygulanmaz**. Uç yalnız beş şey yapar: giriş doğrulama ·
yetki · servis çağrısı · transaction sınırı · yanıt dönüşümü.

## Yetki ayrımı

| İzin | Kapsam |
|---|---|
| `inventory.view` | Oturum/satır/hasar olayı **okuma** |
| `inventory.count` | Oturum açma, ürün ekleme, sayma, yeniden sayma, gönderme, çözümleme, iptal |
| `inventory.apply` | Gözden geçirmeyi geri alma (`reopen`), farkı **uygulama**, **hasar işlemleri** |

`reopen` bilinçli olarak `inventory.apply` altındadır: gözden geçirmeyi
geçersiz kılan ve yarım kalmış sahiplenmeyi temizleyen bir **denetim**
işlemidir, sayım işlemi değil (plan §6.3). `cancel` `inventory.count`'tur ama
**başkasının** oturumunu iptal etmek `inventory.apply` ister — yetki kararı
olduğu için router'da verilir, servise sızmaz.

Token yoksa 401, izin yoksa 403 döner; izin hatası 404 ile GİZLENMEZ.

## Transaction sınırı

Servisler `commit` yapmaz. Yazan her uç: **servis çağrısı → `commit` → yanıt**.
Hata hâlinde `get_db` bağımlılığı `rollback` eder ve global istisna
işleyicileri ham DB/defter istisnalarını (`IntegrityError`,
`InsufficientStock`, `IdempotencyConflict`, `StockNotTracked`) doğru HTTP
koduna çevirir; beklenmeyen hata 500 olarak loglanır ve **400/409'a
kılıflanmaz**.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission
from core.database import get_db
from models.admin import Admin
from models.inventory import StockCountSession, StockDamageEvent
from schemas.inventory import (
    MAX_LIMIT,
    MAX_OFFSET,
    CountLineOut,
    CountLineQty,
    CountLineResolve,
    CountSessionApply,
    CountSessionCancel,
    CountSessionCreate,
    CountSessionDetailOut,
    CountSessionPage,
    CountSessionProducts,
    DamageEventCreate,
    DamageEventOut,
    DamageEventPage,
    DamageKind,
    OnPremiseOut,
)
from services import admin_access_service, inventory_damage, inventory_rules
from services import inventory_service as sayim

router = APIRouter(prefix="/inventory", tags=["inventory"])

VIEW = require_admin_permission("inventory.view")
COUNT = require_admin_permission("inventory.count")
APPLY = require_admin_permission("inventory.apply")


# ════════════════════════ Yanıt dönüşümü ════════════════════════


def _satir(gorunum: sayim.CountLineView) -> CountLineOut:
    """İç modeli DIŞARI verilecek biçime çevirir — alan alan.

    `difference` burada **türetilir**; saklanmaz. Sayılmamış satırda `None`
    kalır: sıfır yazmak "fark yok" demek olurdu, oysa "henüz bilinmiyor".
    """
    s = gorunum.line
    fark = (
        inventory_rules.line_difference(
            counted=int(s.counted_qty),
            expected=int(s.system_qty_snapshot),
            reserved=int(s.reserved_qty_snapshot or 0),
        )
        if s.counted_qty is not None
        else None
    )
    return CountLineOut(
        id=s.id,
        product_id=s.product_id,
        product_name=gorunum.product_name,
        product_sku=gorunum.product_sku,
        bucket=s.bucket,
        status=s.status,
        system_qty_snapshot=s.system_qty_snapshot,
        reserved_qty_snapshot=s.reserved_qty_snapshot,
        counted_qty=s.counted_qty,
        difference=fark,
        counted_at=s.counted_at,
        counted_by_admin_id=s.counted_by_admin_id,
        stale_reason=s.stale_reason,
        resolved_by_admin_id=s.resolved_by_admin_id,
        resolved_at=s.resolved_at,
        resolution_note=s.resolution_note,
        note=s.note,
        applied_movement_id=s.applied_movement_id,
    )


def _oturum(o: StockCountSession, ozet: sayim.SessionSummary | None = None) -> dict:
    """Oturumu yanıt sözlüğüne çevirir.

    `ozet` yalnız LİSTE ucunda gelir (toplu aggregate). Detayda özet
    satırların kendisinden türetilir — ikinci bir sorgu atmak gereksizdir.
    """
    return {
        "id": o.id,
        "code": o.code,
        "status": o.status,
        "scope": o.scope,
        "category_id": o.category_id,
        "note": o.note,
        "created_by_admin_id": o.created_by_admin_id,
        "created_at": o.created_at,
        "started_at": o.started_at,
        "submitted_at": o.submitted_at,
        "reviewed_by_admin_id": o.reviewed_by_admin_id,
        "reviewed_at": o.reviewed_at,
        "applied_by_admin_id": o.applied_by_admin_id,
        "applied_at": o.applied_at,
        "cancelled_by_admin_id": o.cancelled_by_admin_id,
        "cancelled_at": o.cancelled_at,
        "cancel_reason": o.cancel_reason,
        "line_count": ozet.line_count if ozet else 0,
        "uncounted_line_count": ozet.uncounted_line_count if ozet else 0,
        "has_stale": ozet.has_stale if ozet else False,
    }


def _olay(e: StockDamageEvent) -> DamageEventOut:
    return DamageEventOut(
        id=e.id,
        product_id=e.product_id,
        kind=e.kind,
        qty=e.qty,
        source_bucket=e.source_bucket,
        reason_code=e.reason_code,
        note=e.note,
        actor_admin_id=e.actor_admin_id,
        created_at=e.created_at,
        idempotency_key=e.idempotency_key,
    )


async def _detay(db: AsyncSession, session_id: int) -> CountSessionDetailOut:
    oturum, satirlar = await sayim.get_session(db, session_id)
    # Detayda satırlar zaten elimizde: özeti onlardan türetmek, liste ucundaki
    # aggregate sorgusunu burada TEKRARLAMAKTAN ucuzdur.
    ozet = sayim.SessionSummary(
        session=oturum,
        line_count=len(satirlar),
        uncounted_line_count=sum(1 for g in satirlar if g.line.counted_qty is None),
        has_stale=any(g.line.status in ("STALE", "RESOLVED") for g in satirlar),
    )
    return CountSessionDetailOut(
        **_oturum(oturum, ozet), lines=[_satir(g) for g in satirlar]
    )


# ════════════════════════ Sayım oturumları ════════════════════════


@router.get("/count-sessions", response_model=CountSessionPage)
async def list_count_sessions(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0, le=MAX_OFFSET),
    _admin: Admin = Depends(VIEW),
    db: AsyncSession = Depends(get_db),
):
    """Sayfalı oturum listesi. Tavan hem burada hem serviste zorlanır."""
    satirlar, toplam = await sayim.list_sessions(
        db, status_filter=status_filter, limit=limit, offset=offset
    )
    return CountSessionPage(
        items=[_oturum(oz.session, oz) for oz in satirlar],
        total=toplam,
        limit=limit,
        offset=offset,
    )


@router.get("/count-sessions/{session_id}", response_model=CountSessionDetailOut)
async def get_count_session(
    session_id: int,
    _admin: Admin = Depends(VIEW),
    db: AsyncSession = Depends(get_db),
):
    return await _detay(db, session_id)


@router.post(
    "/count-sessions",
    response_model=CountSessionDetailOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_count_session(
    payload: CountSessionCreate,
    admin: Admin = Depends(COUNT),
    db: AsyncSession = Depends(get_db),
):
    oturum = await sayim.create_session(
        db,
        scope=payload.scope.value,
        product_ids=payload.product_ids,
        category_id=payload.category_id,
        note=payload.note,
        admin_id=admin.id,
    )
    await db.commit()
    return await _detay(db, oturum.id)


@router.post("/count-sessions/{session_id}/start", response_model=CountSessionDetailOut)
async def start_count_session(
    session_id: int,
    admin: Admin = Depends(COUNT),
    db: AsyncSession = Depends(get_db),
):
    await sayim.start_session(db, session_id, admin_id=admin.id)
    await db.commit()
    return await _detay(db, session_id)


@router.post(
    "/count-sessions/{session_id}/products", response_model=CountSessionDetailOut
)
async def add_count_session_products(
    session_id: int,
    payload: CountSessionProducts,
    admin: Admin = Depends(COUNT),
    db: AsyncSession = Depends(get_db),
):
    await sayim.add_products(db, session_id, payload.product_ids, admin_id=admin.id)
    await db.commit()
    return await _detay(db, session_id)


@router.post(
    "/count-sessions/{session_id}/lines/{line_id}/count", response_model=CountLineOut
)
async def set_line_count(
    session_id: int,
    line_id: int,
    payload: CountLineQty,
    admin: Admin = Depends(COUNT),
    db: AsyncSession = Depends(get_db),
):
    """Miktar girme / yeniden sayma. `counted_at` gövdeden ALINMAZ."""
    # Aidiyet servise GİRMEDEN doğrulanır: yazıp sonra reddetmek, kalıcılığı
    # `get_db`'nin rollback'ine bağlar ve hata kodlarıyla bir oracle üretir.
    await sayim.assert_line_in_session(db, session_id, line_id)
    satir = await sayim.set_counted(
        db, line_id, payload.counted_qty, admin_id=admin.id
    )
    await db.commit()
    return _satir(await sayim.line_view(db, satir))


@router.post(
    "/count-sessions/{session_id}/lines/{line_id}/resolve", response_model=CountLineOut
)
async def resolve_line(
    session_id: int,
    line_id: int,
    payload: CountLineResolve,
    admin: Admin = Depends(COUNT),
    db: AsyncSession = Depends(get_db),
):
    """Belirsizliği açıklamayla kayda geçirir. Satırı UYGULANABİLİR YAPMAZ."""
    await sayim.assert_line_in_session(db, session_id, line_id)
    satir = await sayim.resolve_line(
        db, line_id, admin_id=admin.id, note=payload.note
    )
    await db.commit()
    return _satir(await sayim.line_view(db, satir))


@router.post("/count-sessions/{session_id}/submit", response_model=CountSessionDetailOut)
async def submit_count_session(
    session_id: int,
    admin: Admin = Depends(COUNT),
    db: AsyncSession = Depends(get_db),
):
    await sayim.submit_session(db, session_id, admin_id=admin.id)
    await db.commit()
    return await _detay(db, session_id)


@router.post("/count-sessions/{session_id}/reopen", response_model=CountSessionDetailOut)
async def reopen_count_session(
    session_id: int,
    admin: Admin = Depends(APPLY),
    db: AsyncSession = Depends(get_db),
):
    """Gözden geçirmeyi geri alır. **Denetim** işlemi → `inventory.apply`."""
    await sayim.reopen_session(db, session_id, admin_id=admin.id)
    await db.commit()
    return await _detay(db, session_id)


@router.post("/count-sessions/{session_id}/apply", response_model=CountSessionDetailOut)
async def apply_count_session(
    session_id: int,
    payload: CountSessionApply,
    admin: Admin = Depends(APPLY),
    db: AsyncSession = Depends(get_db),
):
    """Farkları atomik uygular. Aynı anahtarla tekrar → replay, farklı → 409."""
    await sayim.apply_session(
        db, session_id, admin_id=admin.id, idempotency_key=payload.idempotency_key
    )
    await db.commit()
    return await _detay(db, session_id)


@router.post("/count-sessions/{session_id}/cancel", response_model=CountSessionDetailOut)
async def cancel_count_session(
    session_id: int,
    payload: CountSessionCancel,
    admin: Admin = Depends(COUNT),
    db: AsyncSession = Depends(get_db),
):
    """Oturumu iptal eder.

    **Başkasının** oturumunu iptal etmek ayrıca `inventory.apply` ister: kendi
    işini geri almak sayım yetkisidir, başkasının işini kapatmak denetim
    yetkisidir (plan §6.3). Bu bir YETKİ kararıdır, servise taşınmaz.
    """
    oturum, _ = await sayim.get_session(db, session_id)
    if oturum.created_by_admin_id != admin.id:
        _rol, izinler = await admin_access_service.get_admin_access(db, admin.id)
        if "inventory.apply" not in izinler:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "başkasının sayım oturumunu iptal etmek inventory.apply ister",
            )
    await sayim.cancel_session(
        db, session_id, admin_id=admin.id, reason=payload.reason
    )
    await db.commit()
    return await _detay(db, session_id)


# ════════════════════════ Hasar işlemleri ════════════════════════

#: `kind` → servis fonksiyonu. Dört işlem tek uçtan geçer; ayrım gövdededir,
#: böylece idempotency ve gövde sözleşmesi tek yerde tanımlı kalır.
_HASAR = {
    DamageKind.TRANSFER: inventory_damage.damage_transfer,
    DamageKind.RECOVERY: inventory_damage.damage_recovery,
    DamageKind.DISPOSAL: inventory_damage.damage_disposal,
}


@router.get("/damage-events", response_model=DamageEventPage)
async def list_damage_events(
    product_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0, le=MAX_OFFSET),
    _admin: Admin = Depends(VIEW),
    db: AsyncSession = Depends(get_db),
):
    satirlar, toplam = await inventory_damage.list_damage_events(
        db, product_id=product_id, limit=limit, offset=offset
    )
    return DamageEventPage(
        items=[_olay(e) for e in satirlar],
        total=toplam,
        limit=limit,
        offset=offset,
    )


@router.get("/products/{product_id}/on-premise", response_model=OnPremiseOut)
async def product_on_premise(
    product_id: int,
    _admin: Admin = Depends(VIEW),
    db: AsyncSession = Depends(get_db),
):
    """Ürünün işletmedeki fiziksel mevcudu: satılabilir + hasarlı + rezerve."""
    sonuc = await sayim.expected_on_premise(db, [product_id])
    op = sonuc.get(product_id)
    if op is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ürün bulunamadı")
    return OnPremiseOut(
        product_id=op.product_id,
        saleable=op.saleable,
        damaged=op.damaged,
        reserved=op.reserved,
        total=op.total,
    )


@router.post(
    "/damage-events",
    response_model=DamageEventOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_damage_event(
    payload: DamageEventCreate,
    response: Response,
    admin: Admin = Depends(APPLY),
    db: AsyncSession = Depends(get_db),
):
    """Hasara ayırma / kurtarma / imha / tedarikçiye iade.

    Stok bakiyesini değiştirdiği için `inventory.apply` ister.

    **Yeni iş 201, replay 200 döner.** Aynı anahtarla gelen ikinci isteği
    "yeni kayıt" gibi göstermek, operatöre yapılmamış bir işi yapılmış
    sandırır: raftaki sayı değişmediğini görüp yeni anahtarla ikinci kez
    GERÇEK bir imha yazabilir ve imha geri alınamaz.
    """
    ortak = dict(
        qty=payload.qty,
        reason_code=payload.reason_code.value,
        admin_id=admin.id,
        note=payload.note,
        idempotency_key=payload.idempotency_key,
    )
    if payload.kind is DamageKind.SUPPLIER_RETURN:
        if payload.bucket is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "tedarikçi iadesinde kaynak kova zorunludur",
            )
        olay = await inventory_damage.supplier_return(
            db, payload.product_id, bucket=payload.bucket.value, **ortak
        )
    else:
        olay = await _HASAR[payload.kind](db, payload.product_id, **ortak)
    if inventory_damage.was_replayed(olay):
        response.status_code = status.HTTP_200_OK
    await db.commit()
    return _olay(olay)
