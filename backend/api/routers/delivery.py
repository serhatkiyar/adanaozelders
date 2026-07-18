"""Kendi-filo teslimat uçları — tümü ADMIN (dağıtım ekibi platform ekibidir).

Planlama: tur CRUD + durak ekle/çıkar/sırala + uygun siparişler.
Saha (dağıtıcı ekranı): QR tarama, OTP gönder/doğrula, teslim edilemedi, override.
"""
from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    require_admin_method_permission,
    require_admin_permission,
    require_roles,
    require_roles_or_admin_permission,
)
from core import courier_position, storage
from core.database import get_db
from models.role import RoleType
from schemas.delivery import (
    CapacityDayOut,
    ClosedDayIn,
    ClosedDayOut,
    CourierAccountCreate,
    CourierAccountOut,
    CourierCreate,
    CourierPasswordResetIn,
    CourierWorkspaceOut,
    DeliveryFeedbackOut,
    DeliveryKpiOut,
    CourierOut,
    CourierUpdate,
    DeliveryRunCreate,
    DeliveryRunOut,
    DeliveryRunUpdate,
    DeliveryStopOut,
    DispatchDayIn,
    EligibleOrderOut,
    OtpSendOut,
    OtpVerifyIn,
    OverrideDeliverIn,
    ScanIn,
    ScanOut,
    StopFailIn,
    StopsAddIn,
    StopsReorderIn,
    TrackIn,
)
from services import (
    courier_account_service,
    delivery_calendar,
    delivery_feedback_service,
    delivery_service,
)

_MAX_PHOTO_BYTES = 12 * 1024 * 1024

router = APIRouter(
    prefix="/delivery",
    tags=["delivery"],
    dependencies=[Depends(require_admin_method_permission("delivery.view", "delivery.manage"))],
)

# Saha router'ı: ADMIN + KURYE. Kurye yalnız KENDİ atanmış turunun uçlarına
# erişir (courier_account_service.ensure_*_access → yabancı tur/durak 404).
# Yönetim/planlama uçları yukarıdaki ADMIN-only router'da kalır; override-deliver
# bilinçli ADMIN'dedir (OTP'siz teslim = yetki yükseltme yolu).
field_router = APIRouter(prefix="/delivery", tags=["delivery-field"])
_field_user = require_roles_or_admin_permission("delivery.manage", RoleType.COURIER)
_field_viewer = require_roles_or_admin_permission("delivery.view", RoleType.COURIER)


# ── Planlama ─────────────────────────────────────────────────────────────────────


@router.get("/eligible-orders", response_model=list[EligibleOrderOut])
async def eligible_orders(db: AsyncSession = Depends(get_db)):
    return await delivery_service.eligible_orders(db)


@router.get("/outsourced-orders", response_model=list[EligibleOrderOut])
async def outsourced_orders(db: AsyncSession = Depends(get_db)):
    """Bölge dışı ödenmiş fiziksel siparişler — dış kargo bekleyen kuyruk."""
    return await delivery_service.outsourced_orders(db)


@router.get("/prep-queue", response_model=list[EligibleOrderOut])
async def prep_queue(db: AsyncSession = Depends(get_db)):
    """Hazırlama istasyonu kuyruğu — henüz toplanmamış/etiketlenmemiş siparişler."""
    return await delivery_service.prep_queue(db)


@router.post("/orders/{order_id}/prepare", response_model=EligibleOrderOut)
async def mark_prepared(order_id: int, db: AsyncSession = Depends(get_db)):
    """Siparişi 'hazır' işaretle — paket toplandı, etiket basıldı; artık tura eklenebilir."""
    return await delivery_service.mark_prepared(db, order_id, prepared=True)


@router.post("/orders/{order_id}/unprepare", response_model=EligibleOrderOut)
async def unmark_prepared(order_id: int, db: AsyncSession = Depends(get_db)):
    """Hazırlığı geri al (yalnız tura girmemiş sipariş)."""
    return await delivery_service.mark_prepared(db, order_id, prepared=False)


@router.get("/attention-orders", response_model=list[EligibleOrderOut])
async def attention_orders(db: AsyncSession = Depends(get_db)):
    """İstisna kuyruğu — deneme hakkı dolmuş, operatör kararı bekleyen siparişler."""
    return await delivery_service.attention_orders(db)


@router.post("/orders/{order_id}/retry", response_model=EligibleOrderOut)
async def retry_exhausted_order(order_id: int, db: AsyncSession = Depends(get_db)):
    """Deneme hakkı dolmuş siparişe bir tur daha hak tanı (müşteriyle görüşüldü)."""
    return await delivery_service.retry_exhausted_order(db, order_id)


@router.get("/calendar", response_model=list[ClosedDayOut])
async def list_closed_days(db: AsyncSession = Depends(get_db)):
    """Teslimata kapalı günler (yaklaşanlar) — admin takvimi."""
    return await delivery_calendar.list_closed_days(db)


@router.post("/calendar", response_model=ClosedDayOut, status_code=status.HTTP_201_CREATED)
async def add_closed_day(payload: ClosedDayIn, db: AsyncSession = Depends(get_db)):
    """Bir günü teslimata kapalı işaretle (özel gün / elle tatil)."""
    return await delivery_calendar.add_closed_day(
        db, day=payload.day, label=payload.label
    )


@router.delete("/calendar/{closed_day_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_closed_day(closed_day_id: int, db: AsyncSession = Depends(get_db)):
    """Kapalı gün işaretini kaldır (o gün yeniden teslimata açılır)."""
    await delivery_calendar.remove_closed_day(db, closed_day_id)


@router.post("/calendar/seed-holidays", response_model=list[ClosedDayOut])
async def seed_holidays(
    year: int = Query(default=2026, ge=2025, le=2030),
    db: AsyncSession = Depends(get_db),
):
    """Yılın resmî tatillerini yükle (idempotent). Admin tetikler; istemediğini siler."""
    return await delivery_calendar.seed_holidays(db, year)


@router.get("/kpi", response_model=DeliveryKpiOut)
async def kpi_summary(
    days: int = Query(default=30, ge=1, le=180),
    db: AsyncSession = Depends(get_db),
):
    """Teslimat KPI özeti — söz tutma, ilk denemede teslim, başarısızlık nedenleri.
    İlk 90 gün hedefsiz baseline (PDS §14); oranlar yön verir, yargı üretmez."""
    return await delivery_service.kpi_summary(db, days=days)


@router.get("/feedback", response_model=list[DeliveryFeedbackOut])
async def recent_feedback(
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Son teslimat değerlendirmeleri (Faz 7) — 👎 yorumlarını okumak için."""
    return await delivery_feedback_service.list_recent(db, limit=limit)


@router.get("/capacity", response_model=list[CapacityDayOut])
async def capacity_overview(
    days: int = Query(default=14, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
):
    """Önümüzdeki günlerin söz doluluğu — kapasite şeridi (booked/capacity +
    söz borcu). Sayım, söz motoruyla aynı filtreyi kullanır."""
    return await delivery_service.capacity_overview(db, days=days)


@router.post("/dispatch-day", response_model=list[DeliveryRunOut])
async def dispatch_day(
    payload: DispatchDayIn, db: AsyncSession = Depends(get_db)
):
    """Günü Optimize Et: uygun siparişleri araçlara bölüştürüp optimize turlar kurar."""
    return await delivery_service.dispatch_day(db, payload.run_date)


@router.get("/runs", response_model=list[DeliveryRunOut])
async def list_runs(
    run_date: datetime.date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    return await delivery_service.list_runs(db, run_date=run_date)


@router.post("/runs", response_model=DeliveryRunOut, status_code=status.HTTP_201_CREATED)
async def create_run(payload: DeliveryRunCreate, db: AsyncSession = Depends(get_db)):
    return await delivery_service.create_run(db, payload)


@field_router.get("/runs/{run_id}", response_model=DeliveryRunOut)
async def get_run(
    run_id: int,
    user=Depends(_field_viewer),
    db: AsyncSession = Depends(get_db),
):
    await courier_account_service.ensure_run_access(db, user, run_id)
    return await delivery_service.get_run(db, run_id)


@router.patch("/runs/{run_id}", response_model=DeliveryRunOut)
async def update_run(
    run_id: int, payload: DeliveryRunUpdate, db: AsyncSession = Depends(get_db)
):
    """Tur meta güncellemesi (kurye ataması)."""
    return await delivery_service.update_run(db, run_id, payload)


# ── Kurye profilleri ─────────────────────────────────────────────────────────────


@router.get("/couriers", response_model=list[CourierOut])
async def list_couriers(db: AsyncSession = Depends(get_db)):
    return await delivery_service.list_couriers(db)


@router.post("/couriers", response_model=CourierOut, status_code=status.HTTP_201_CREATED)
async def create_courier(payload: CourierCreate, db: AsyncSession = Depends(get_db)):
    return await delivery_service.create_courier(db, payload)


@router.patch("/couriers/{courier_id}", response_model=CourierOut)
async def update_courier(
    courier_id: int, payload: CourierUpdate, db: AsyncSession = Depends(get_db)
):
    return await delivery_service.update_courier(db, courier_id, payload)


@router.delete("/couriers/{courier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_courier(courier_id: int, db: AsyncSession = Depends(get_db)):
    await delivery_service.delete_courier(db, courier_id)


@router.post("/couriers/{courier_id}/photo", response_model=CourierOut)
async def upload_courier_photo(
    courier_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Kurye vesikalık fotoğrafı (müşteri takip sayfasındaki kimlik kartı)."""
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Yalnızca görsel yüklenebilir.")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Görsel 12MB sınırını aşıyor.")
    url = await storage.upload_courier_photo(data)
    return await delivery_service.set_courier_photo(db, courier_id, url)


@router.post("/runs/{run_id}/stops", response_model=DeliveryRunOut)
async def add_stops(
    run_id: int, payload: StopsAddIn, db: AsyncSession = Depends(get_db)
):
    return await delivery_service.add_stops(db, run_id, payload.order_ids)


@router.put("/runs/{run_id}/reorder", response_model=DeliveryRunOut)
async def reorder_stops(
    run_id: int, payload: StopsReorderIn, db: AsyncSession = Depends(get_db)
):
    return await delivery_service.reorder_stops(db, run_id, payload.stop_ids)


@router.post("/runs/{run_id}/optimize", response_model=DeliveryRunOut)
async def optimize_run(run_id: int, db: AsyncSession = Depends(get_db)):
    """Bekleyen durakları optimal sıraya dizer (VROOM; yoksa haversine fallback)."""
    return await delivery_service.optimize_run(db, run_id)


@router.post("/runs/{run_id}/start", response_model=DeliveryRunOut)
async def start_run(run_id: int, db: AsyncSession = Depends(get_db)):
    return await delivery_service.start_run(db, run_id)


@field_router.post("/runs/{run_id}/complete", response_model=DeliveryRunOut)
async def complete_run(
    run_id: int,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """Kurye kendi ACTIVE turunu son durak bitince kapatır; admin her turu."""
    await courier_account_service.ensure_run_access(db, user, run_id)
    return await delivery_service.complete_run(db, run_id)


@router.post("/runs/{run_id}/cancel", response_model=DeliveryRunOut)
async def cancel_run(run_id: int, db: AsyncSession = Depends(get_db)):
    return await delivery_service.cancel_run(db, run_id)


@router.delete("/stops/{stop_id}", response_model=DeliveryRunOut)
async def remove_stop(stop_id: int, db: AsyncSession = Depends(get_db)):
    return await delivery_service.remove_stop(db, stop_id)


@field_router.post("/stops/{stop_id}/photo", response_model=DeliveryStopOut)
async def upload_stop_photo(
    stop_id: int,
    file: UploadFile = File(...),
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """Teslim kanıtı fotoğrafı (PoD) — kapıya/komşuya bırakmada zorunlu kanıt,
    normal teslimde opsiyonel ek. Yeniden çekimde eskisinin yerine geçer.
    Sahiplik STORAGE YAZIMINDAN ÖNCE doğrulanır (orphan upload önlenir)."""
    await courier_account_service.ensure_stop_access(db, user, stop_id)
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Yalnızca görsel yüklenebilir.")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Görsel 12MB sınırını aşıyor.")
    url = await storage.upload_delivery_photo(data)
    return await delivery_service.set_stop_photo(db, stop_id, url)


# ── Saha (dağıtıcı ekranı — ADMIN + sahip KURYE) ─────────────────────────────────


@field_router.get("/me", response_model=CourierWorkspaceOut)
async def courier_me(
    user=Depends(require_roles(RoleType.COURIER)),
    db: AsyncSession = Depends(get_db),
):
    """Kurye açılış ekranı: hesabım + profilim + güncel turum (ACTIVE, yoksa
    bugünün PLANNED'ı, yoksa null). Kuryeye tur LİSTESİ verilmez."""
    from models.courier import Courier as CourierModel

    run_id = await courier_account_service.current_run_id(db, user)
    run = await delivery_service.get_run(db, run_id) if run_id else None
    profile = await db.get(CourierModel, user.courier_id)
    return CourierWorkspaceOut(
        account=courier_account_service._to_out(user),
        courier=delivery_service._courier_to_out(profile) if profile else None,
        run=run,
    )


@field_router.post("/runs/{run_id}/track", status_code=status.HTTP_204_NO_CONTENT)
async def track_run(
    run_id: int,
    payload: TrackIn,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """Dağıtıcı telefonunun konum ping'i (~10 sn'de bir; Redis, kalıcı iz yok)."""
    await courier_account_service.ensure_run_access(db, user, run_id)
    await delivery_service.track_run(db, run_id, lat=payload.lat, lng=payload.lng)


@field_router.get("/runs/{run_id}/position")
async def run_position(
    run_id: int,
    user=Depends(_field_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Kuryenin son bilinen konumu (admin rota haritası) — yoksa null alanlar."""
    await courier_account_service.ensure_run_access(db, user, run_id)
    pos = await courier_position.get_position(run_id)
    return pos or {"lat": None, "lng": None, "age_seconds": None}


@field_router.post("/scan", response_model=ScanOut)
async def scan(
    payload: ScanIn,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    stop, run_status = await delivery_service.scan(db, payload.payload)
    # QR başka kuryenin paketiyse varlık sızdırma — 404 (etiket karışıklığında
    # kurye "bu etikete ait durak bulunamadı" görür, alıcı bilgisi görmez).
    await courier_account_service.ensure_stop_access(db, user, stop.id)
    return ScanOut(stop=stop, run_status=run_status)


@field_router.post("/stops/{stop_id}/send-otp", response_model=OtpSendOut)
async def send_otp(
    stop_id: int,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """``sent`` GERÇEK gönderim sonucudur — SMS sağlayıcısı düşükken kuryeye
    "gönderildi" denmez (müşteri kapıda hiç gelmeyecek kodu beklemesin)."""
    await courier_account_service.ensure_stop_access(db, user, stop_id)
    masked, sent = await delivery_service.send_otp(db, stop_id)
    return OtpSendOut(masked_phone=masked, sent=sent)


@field_router.post("/stops/{stop_id}/verify", response_model=DeliveryStopOut)
async def verify_delivery(
    stop_id: int,
    payload: OtpVerifyIn,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    await courier_account_service.ensure_stop_access(db, user, stop_id)
    return await delivery_service.verify_delivery(
        db, stop_id, code=payload.code, lat=payload.lat, lng=payload.lng
    )


@field_router.post("/stops/{stop_id}/deliver-drop", response_model=DeliveryStopOut)
async def deliver_drop(
    stop_id: int,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """Kapıya/komşuya bırakma teslimi (müşteri talimatlıysa; foto kanıt zorunlu)."""
    await courier_account_service.ensure_stop_access(db, user, stop_id)
    return await delivery_service.deliver_drop(db, stop_id)


@router.post("/stops/{stop_id}/override-deliver", response_model=DeliveryStopOut)
async def override_deliver(
    stop_id: int, payload: OverrideDeliverIn, db: AsyncSession = Depends(get_db)
):
    """Notlu YÖNETİCİ teslimi — OTP bypass'ı olduğundan bilinçli ADMIN-only;
    kurye kod ulaşmadığında yöneticiyle iletişime geçer (UI yönlendirir)."""
    return await delivery_service.override_deliver(db, stop_id, note=payload.note)


@field_router.post("/stops/{stop_id}/fail", response_model=DeliveryStopOut)
async def fail_stop(
    stop_id: int,
    payload: StopFailIn,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    await courier_account_service.ensure_stop_access(db, user, stop_id)
    return await delivery_service.fail_stop(
        db, stop_id, reason=payload.reason, reason_code=payload.reason_code
    )


# ── Kurye hesabı yaşam döngüsü (ADMIN) ───────────────────────────────────────────


@router.get("/couriers/{courier_id}/account", response_model=CourierAccountOut | None)
async def courier_account(courier_id: int, db: AsyncSession = Depends(get_db)):
    return await courier_account_service.account_for_courier(db, courier_id)


@router.post(
    "/couriers/{courier_id}/account",
    response_model=CourierAccountOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_courier_account(
    courier_id: int,
    payload: CourierAccountCreate,
    admin=Depends(require_admin_permission("delivery.manage")),
    db: AsyncSession = Depends(get_db),
):
    return await courier_account_service.create_account(
        db, courier_id, payload, actor=admin
    )


@router.post("/accounts/{account_id}/close", status_code=status.HTTP_204_NO_CONTENT)
async def close_courier_account(
    account_id: int,
    admin=Depends(require_admin_permission("delivery.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Kurye işten ayrıldı: hesap kapanır, telefonundaki oturum ANINDA düşer."""
    await courier_account_service.close_account(db, account_id, actor=admin)


@router.post(
    "/accounts/{account_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT
)
async def reset_courier_password(
    account_id: int,
    payload: CourierPasswordResetIn,
    admin=Depends(require_admin_permission("delivery.manage")),
    db: AsyncSession = Depends(get_db),
):
    await courier_account_service.reset_password(
        db, account_id, payload.new_password, actor=admin
    )
