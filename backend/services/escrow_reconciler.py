"""Escrow mutabakatı (reconciler) — sarkan iade niyetleri + bayat checkout'lar.

60 sn'lik arka plan döngüsünden çağrılır (main.py). İki işi vardır:

1. ``reconcile_refunding``: REFUNDING'de sarkan kayıtlar (claim commit'lendi ama
   sağlayıcı çağrısı sonuçsuz kaldı — crash/timeout). Karantina penceresi dolan
   kayıt için önce sağlayıcıdan POZİTİF kanıt aranır (refund_state); iade
   görünüyorsa yalnız yerel finalize. Görünmüyorsa sınırlı retry — tam-tutar
   iadenin sağlayıcıdaki AŞIRI-İADE REDDİ emniyet kemeridir (kayıp ilk çağrı
   aslında kabul edildiyse retry reddedilir; çift iade imkânsız). Deneme sınırı
   dolunca retry durur, kayıt alarm loguyla görünür kalır.

2. ``reconcile_stale_checkouts``: kullanıcı iyzico'da ödedi ama callback bize hiç
   ulaşmadı (tarayıcı kapandı) YA DA varlık bu arada iptal edildi. provider_ref'i
   (CF token) olan bayat PENDING/PENDING_PAYMENT/CANCELLED kayıtlar sağlayıcıdan
   ``retrieve_checkout`` ile doğrulanır ve callback'le AYNI idempotent
   ``complete_checkout`` yoluna verilir (ölü varlıkta otomatik iade dahil).

Her kayıt kendi commit'iyle işlenir — bir kayıttaki hata diğerlerini geciktirmez.
"""
from __future__ import annotations

import datetime
import logging
import time

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.config import settings
from models.admin import Admin
from models.booking import Booking, BookingStatus
from models.library_exam import ExamRegistration, RegistrationStatus
from models.payment import Payment, PaymentStatus
from models.role import ROLE_IDS, RoleType
from models.store import Order, OrderPaymentStatus, OrderReturn
from models.study_reservation import StudyReservation
from services import escrow, notification_service

logger = logging.getLogger("adana.escrow")

# Bayat checkout taraması her CHECKOUT_RECONCILE_INTERVAL_SECONDS'ta bir koşar
# (60 sn'lik loop'tan daha seyrek — sağlayıcıya gereksiz okuma yapmamak için).
_last_checkout_scan: float = 0.0


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _reference_for(db: AsyncSession, obj, spec: escrow.EscrowSpec) -> str:
    """Sağlayıcıya verilen conversationId — charge'da ne yazıldıysa O.

    `Payment` için ders kimliği; diğerlerinde `spec.reference_id_attr`. İade
    TALEBİ kendi id'siyle DEĞİL, tahsilatın yapıldığı siparişin id'siyle
    sorgulanır (`order:{order_id}`) — `return:{id}` referansı iyzico'da hiçbir
    zaman eşleşmiyordu ve sarkan kısmi iade kalıcı ALERT'e düşüyordu (İP2A-02).
    """
    if isinstance(obj, Payment):
        return f"{spec.reference_prefix}:{obj.booking_id}"
    return f"{spec.reference_prefix}:{getattr(obj, spec.reference_id_attr)}"


_REFUNDING_TARGETS: tuple[tuple[type, escrow.EscrowSpec], ...] = (
    (Payment, escrow.PAYMENT_SPEC),
    (ExamRegistration, escrow.EXAM_SPEC),
    (StudyReservation, escrow.STUDY_SPEC),
    (Order, escrow.ORDER_SPEC),
    # Sarkan iade talepleri: kısmi iade sağlayıcı çağrısında süreç ölürse
    # talep REFUNDING'de kalır ve buradan devralınır.
    (OrderReturn, escrow.RETURN_SPEC),
)


async def reconcile_refunding(db: AsyncSession) -> int:
    """Sarkan REFUNDING kayıtlarını güvenli biçimde sonuca sürer. Dönen: işlenen.

    ## Kayıt-başı izolasyon (İP-2a/R1)

    Her kayıt KENDİ transaction'ında işlenir ve kendi advisory kilidini tutar.
    Bir kaydın hatası partinin kalanını düşürmez (hata YUTULMAZ, `logger.exception`
    ile görünür kalır); kilit hem "canlı istek sağlayıcıda asılı" hâlini hem de
    ikinci bir reconciler worker'ını dışarıda tutar (İP2A-06).

    ## Telafi bütünlüğü (İP2A-01)

    Sağlayıcı iadesi kesinleştiğinde para dışındaki HER şey de tamamlanır:
    `refunded_amount`, kupon, sipariş FSM'i, audit ve müşteri bildirimi. Eskiden
    reconciler yalnız escrow katmanını çağırıyordu ve kayıt sonrasında hiçbir
    yoldan telafi edilemiyordu (`payment_status` artık PAID olmadığı için
    cancel/refund uçları 409 veriyordu).

    ## PK-α

    Bu yol **stok geri koymaz**: stok yalnız fiziksel kabulde döner
    (`order_service.receive_return`). Sipariş İPTALİ yolundaki `SALE_CANCEL`
    bundan ayrıdır — orada mal hiç müşteriye çıkmamıştır.
    """
    provider = payments.get_payment_provider()
    min_age = datetime.timedelta(minutes=settings.REFUND_RECONCILE_MIN_AGE_MINUTES)
    handled = 0

    for model, spec in _REFUNDING_TARGETS:
        # Para durumunun kolonu modele göre değişir (Order'da `payment_status`,
        # OrderReturn'de `refund_status`). Soft-delete de her modelde yok.
        status_col = getattr(model, spec.status_attr)
        conditions = [status_col == spec.refunding]
        if hasattr(model, "deleted_at"):
            conditions.append(model.deleted_at.is_(None))
        # Önce yalnız KİMLİKLER alınır: aşağıdaki döngü commit/rollback yaptığı
        # için ORM nesneleri bayatlar ve bayat nesnenin alanına dokunmak async
        # oturumda lazy-load (MissingGreenlet) üretir.
        ids = (
            await db.execute(select(model.id).where(*conditions).order_by(model.id))
        ).scalars().all()
        # ⚠️ Burada `rollback()` YOK ve olmamalı: oturum `expire_on_commit=False`
        # ile kurulur, yani `commit` çağıranın nesnelerini bayatlatmaz — ama
        # `rollback` HER ŞEYİ expire eder ve çağıranın elindeki nesneye
        # dokunmak async oturumda lazy-load (MissingGreenlet) üretir. Salt-okuma
        # SELECT'i açık transaction'da bırakmak zararsızdır; ilk kaydın işi aynı
        # transaction'da başlar ve kendi commit'iyle kapanır.
        for row_id in ids:
            try:
                if await _tek_kaydi_isle(db, model, spec, row_id, provider, min_age):
                    handled += 1
                await db.commit()
            except Exception:  # noqa: BLE001 — kayıt izole edilir, parti ölmez
                await db.rollback()
                logger.exception(
                    "reconciler: %s#%s mutabakatı BAŞARISIZ — kayıt atlandı, "
                    "parti devam ediyor (elle inceleyin)",
                    model.__name__,
                    row_id,
                )
    return handled


async def _tek_kaydi_isle(
    db: AsyncSession,
    model: type,
    spec: escrow.EscrowSpec,
    row_id: int,
    provider,
    min_age: datetime.timedelta,
) -> bool:
    """Tek sarkan kaydı kendi transaction'ında sonuca sürer. Dönen: işlendi mi."""
    # Kilit ALINAMIYORSA kayıt şu anda başkasının elinde: canlı bir istek
    # sağlayıcıda asılı olabilir. O pencerede ikinci gerçek iade emri vermek
    # kısmi iadede GERÇEK çifte ödemedir (sağlayıcının aşırı-iade reddi kısmi
    # tutarları ayırt edemez) — bu yüzden beklemeden geçilir (İP2A-06).
    if not await escrow.try_inflight_lock(db, spec, row_id):
        logger.info(
            "reconciler: %s#%s başkası tarafından işleniyor — bu tur atlandı",
            model.__name__, row_id,
        )
        return False

    obj = await db.get(model, row_id, populate_existing=True)
    if obj is None:
        return False
    if escrow._durum_degeri(getattr(obj, spec.status_attr)) != escrow._durum_degeri(
        spec.refunding
    ):
        return False  # kilidi beklerken sonuçlanmış

    now = _now()
    reference = await _reference_for(db, obj, spec)
    state = await provider.refund_state(
        provider_ref=obj.provider_ref, reference=reference
    )
    action = escrow.next_refund_action(
        attempts=obj.refund_attempts,
        requested_at=obj.refund_requested_at,
        now=now,
        provider_state=state,
        min_age=min_age,
        max_attempts=settings.REFUND_MAX_ATTEMPTS,
    )
    if action == escrow.ACTION_WAIT:
        return False

    if action == escrow.ACTION_FINALIZE:
        # Sağlayıcıda iade POZİTİF görünüyor — yazma çağrısı yapmadan bitir.
        if not await escrow.finalize_refund(db, obj, spec):
            return False
        logger.warning(
            "reconciler: sağlayıcıda görünen iade yerelde finalize edildi (%s#%s)",
            model.__name__, obj.id,
        )
        await _telafileri_tamamla(db, obj, kaynak="finalize")
        return True

    if action == escrow.ACTION_ALERT:
        # PK-δ: sessiz log yerine SORGULANABİLİR kalıcı durum. Para hareketi
        # yapılmaz, REFUNDED yazılmaz, başarı yan etkileri üretilmez.
        logger.error(
            "reconciler: iade %s denemede sonuçlanamadı — MANUEL İNCELEME "
            "(%s#%s ref=%s)",
            obj.refund_attempts, model.__name__, obj.id, obj.provider_ref,
        )
        if await escrow.mark_manual_review(db, obj, spec):
            await _manual_review_audit(db, obj, spec)
            return True
        return False

    # ACTION_RETRY: deneme sayacını + karantinayı atomik tazele. WHERE koşulu
    # karantinayı da içerir → aynı turda ikinci bir worker (kilidi almış olsa
    # bile, ör. kilit sınıfı ileride değişirse) claim'i KAZANAMAZ.
    claimed = await escrow.claim(
        db,
        model,
        obj.id,
        from_statuses=[spec.refunding],
        values={
            "refund_requested_at": now,
            "refund_attempts": model.refund_attempts + 1,
        },
        extra_where=(model.refund_requested_at <= now - min_age,),
        status_attr=spec.status_attr,
    )
    if not claimed:
        return False
    await db.refresh(obj, attribute_names=["refund_requested_at", "refund_attempts"])
    tutar = escrow.order_inflight_refund(obj) if isinstance(obj, Order) else None
    if not await escrow.perform_refund(db, obj, spec, amount=tutar):
        # Başarısızlık da COMMIT edilir: deneme sayacı kalıcı olmazsa kayıt
        # tavana hiç ulaşmaz ve MANUAL_REVIEW'a asla düşmez (sonsuz sessiz retry).
        return False
    await _telafileri_tamamla(db, obj, kaynak="retry")
    return True


async def reconcile_orphaned_escrow(db: AsyncSession) -> int:
    """Terminal derse bağlı **sahipsiz HELD emaneti** güvenli biçimde çözer (P0-5).

    Sözleşme §3: `HELD` yalnız `ACCEPTED` bir dersle birlikte durabilir. Ders
    terminal (REJECTED/CANCELLED/soft-deleted) olduğu hâlde para emanette
    kalmışsa o para ne öğrenciye döner ne eğitmene geçer — ve mevcut taramaların
    hiçbiri onu GÖRMEZ (`reconcile_refunding` REFUNDING, `reconcile_stale_checkouts`
    PENDING/FAILED tarar). Bu ağ, kaynak yollar (red/admin iptali) düzeltilmiş
    olsa bile gereklidir: geçmişte oluşmuş satırlar ve henüz bilinmeyen yollar
    için son savunma hattıdır.

    **Karar: güvenli claim sonrası otomatik iade + ERROR logu** (sözleşme §8/c).
    Gerekçe: (1) sistemin kendi precedent'i budur —
    `payment_service.complete_checkout` ölü booking'e gelen tahsilatta aynı şeyi
    yapar; (2) iade tek **geri döndürülebilir** yöndür (yanlış iadede öğrenci
    yeniden öder; yanlış release `released_at` guard'ı yüzünden geri alınamaz);
    (3) yeni bir para yolu icat edilmez — aynı `escrow.refund_escrow`.

    Karantina (§8/S2): uçuşta olan bir iptal transaction'ı yakalanmamalıdır.
    Hem dersin terminal olma anı hem ödemenin son dokunulma anı
    `REFUND_RECONCILE_MIN_AGE_MINUTES` kadar eskimiş olmalıdır; aksi hâlde tarama,
    `cancel`'ın claim'i ile `refund`'ı arasındaki pencereye girip aynı ödemeye
    ikinci bir iade emri gönderebilirdi.
    """
    cutoff = _now() - datetime.timedelta(
        minutes=settings.REFUND_RECONCILE_MIN_AGE_MINUTES
    )
    rows = (
        await db.execute(
            select(Payment, Booking)
            .join(Booking, Booking.id == Payment.booking_id)
            .where(
                Payment.status == PaymentStatus.HELD,
                Payment.deleted_at.is_(None),
                # Kazancı dağıtılmış satıra ASLA dokunulmaz (ikinci savunma
                # hattı `escrow.begin_refund` içindedir; burada zaten seçilmez).
                Payment.released_at.is_(None),
                or_(
                    Booking.status.in_(
                        (BookingStatus.REJECTED, BookingStatus.CANCELLED)
                    ),
                    Booking.deleted_at.is_not(None),
                ),
                Booking.updated_at <= cutoff,
                Payment.updated_at <= cutoff,
            )
        )
    ).all()
    handled = 0
    for payment, booking in rows:
        # Sessiz düzeltme YOK: sahipsiz emanet her hâlde görünür olmalı, çünkü
        # oluşması bir üretim kusurunun kanıtıdır (kaynak yol düzeltilmemiş ya da
        # yeni bir yol açık kalmış).
        logger.error(
            "reconciler: SAHİPSİZ EMANET — ders terminal (%s) ama ödeme HELD; "
            "otomatik iade başlatılıyor (booking=%s payment=%s tutar=%s)",
            booking.status.value if booking.status else "deleted",
            booking.id,
            payment.id,
            payment.amount,
        )

        async def _bildir(p=payment, b=booking) -> None:
            await notification_service.notify(
                db,
                user_id=b.client_id,
                role_id=ROLE_IDS[RoleType.CLIENT],
                message=(
                    f"İptal edilen ders için ödemen iade edildi: "
                    f"{p.amount} {p.currency}"
                ),
                link="/student/bookings",
            )

        # ── Kayıt-başı hata izolasyonu (İP-2b R11 ile aynı disiplin) ──
        #
        # Tek bir kaydın beklenmeyen hatası (sağlayıcı istisnası, ağ arızası)
        # döngüden dışarı kaçarsa partinin KALANI o turda hiç işlenmez ve
        # sahipsiz emanetler sorunlu kayıt durdukça sonsuza dek beklerdi.
        # Hata YUTULMAZ: `logger.exception` ile görünür kalır.
        #
        # Not: `escrow.begin_refund` claim'i COMMIT'ler. Sağlayıcı çağrısında
        # patlarsak kayıt REFUNDING'de kalır — yani "güvenli yeniden deneme"
        # durumudur ve `reconcile_refunding` bir sonraki turda devralır.
        # `REFUNDED` yalnız sağlayıcı POZİTİF döndüğünde yazılır.
        try:
            outcome = await escrow.refund_escrow(
                db, payment, escrow.PAYMENT_SPEC, notify=_bildir
            )
            await db.commit()
        except Exception:  # noqa: BLE001 — kayıt izole edilir, parti ölmez
            await db.rollback()
            logger.exception(
                "reconciler: sahipsiz emanet iadesi BAŞARISIZ — kayıt atlandı, "
                "parti devam ediyor (booking=%s payment=%s)",
                booking.id,
                payment.id,
            )
            continue
        if outcome != "not_claimed":
            handled += 1
    return handled


async def _telafileri_tamamla(db: AsyncSession, obj, *, kaynak: str) -> None:
    """Sağlayıcı iadesi kesinleşince koşan TAM telafi kuyruğu (İP2A-01).

    İki mağaza yolu vardır ve ikisi de canlı istekle AYNI sonucu üretmek
    zorundadır — eskiden reconciler yalnız escrow katmanını çağırıyordu:

    * ``Order``       — sipariş iptali/tam iadesi: `refunded_amount`, stok
      (`SALE_CANCEL`; mal hiç müşteriye çıkmadı), kupon, `CANCELLED` geçişi ve
      müşteri bildirimi (İP-2b R6/R7/R8).
    * ``OrderReturn`` — RMA: `refunded_amount`, kupon (yalnız tam iadede),
      sipariş `REFUNDED` geçişi, audit ve müşteri bildirimi. **Stok BURADA
      dönmez** (PK-α: yalnız fiziksel kabulde).

    Telafi kuyruğu `order_service` ile ORTAKTIR ve hepsi idempotenttir; aynı
    tur iki kez koşarsa ikinci uygulama no-op olur.
    """
    from services import order_service

    if isinstance(obj, Order):
        order = await order_service._load_full(db, obj.id)
        if order is None:
            return
        await order_service.settle_refunded_order(
            db,
            order,
            amount=escrow.order_inflight_refund(order),
            reason_code="ORDER_CANCELLED",
            terminal_status="CANCELLED",
            changed_by="system:reconciler",
            reason=f"Sağlayıcı iadesi mutabakat turunda tamamlandı ({kaynak})",
        )
        await notification_service.notify(
            db,
            user_id=order.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message=f"Siparişin #{order.id} için ödemen iade edildi.",
            link="/siparislerim",
        )
        return

    if isinstance(obj, OrderReturn):
        await order_service.settle_completed_return(
            db, obj, changed_by=f"system:reconciler:{kaynak}"
        )


async def _manual_review_audit(db: AsyncSession, obj, spec: escrow.EscrowSpec) -> None:
    """MANUAL_REVIEW geçişini denetim izine ve yönetici bildirimine bağlar.

    Sorgulanabilir bir DURUM tek başına yetmez: kimsenin bakmadığı bir kuyruk
    sessiz log'dan yalnız biraz iyidir. Geçiş `audit_logs`'a yazılır ve
    yöneticilere bildirim gider.
    """
    from services import audit_service, order_service

    hedef = "order_return" if isinstance(obj, OrderReturn) else "order"
    order_id = obj.order_id if isinstance(obj, OrderReturn) else obj.id
    await audit_service.record(
        db,
        actor=order_service._SistemAktoru(),
        action="refund.manual_review",
        target_type=hedef,
        target_id=obj.id,
        reason=(
            f"Otomatik iade {obj.refund_attempts} denemede sonuçlanmadı — "
            "manuel incelemeye alındı (PK-δ)"
        ),
        after={
            "refund_status": escrow._durum_degeri(getattr(obj, spec.status_attr)),
            "refund_attempts": obj.refund_attempts,
            "order_id": order_id,
        },
    )
    admin_ids = (
        await db.execute(select(Admin.id).where(Admin.deleted_at.is_(None)))
    ).scalars().all()
    for admin_id in admin_ids:
        await notification_service.notify(
            db,
            user_id=admin_id,
            role_id=ROLE_IDS[RoleType.ADMIN],
            message=(
                f"Sipariş #{order_id}: otomatik iade tamamlanamadı, manuel "
                "inceleme gerekiyor."
            ),
            link="/yonetim/magaza",
        )


async def reconcile_stale_checkouts(db: AsyncSession) -> int:
    """Callback'i hiç gelmemiş (ya da varlığı ölmüş) checkout'ları sağlayıcıdan doğrular.

    Yalnız ``retrieve_checkout`` destekleyen sağlayıcıda (iyzico) çalışır; fake'te
    no-op. Sonuç, callback ile AYNI ``complete_checkout`` yoluna verilir — başarılı
    tahsilat ölü varlığa denk gelirse oradaki otomatik iade devreye girer.
    """
    global _last_checkout_scan
    provider = payments.get_payment_provider()
    retrieve = getattr(provider, "retrieve_checkout", None)
    if retrieve is None:
        return 0
    if time.monotonic() - _last_checkout_scan < settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS:
        return 0
    _last_checkout_scan = time.monotonic()

    now = _now()
    newest = now - datetime.timedelta(minutes=settings.CHECKOUT_RECONCILE_MIN_AGE_MINUTES)
    oldest = now - datetime.timedelta(hours=settings.CHECKOUT_RECONCILE_MAX_AGE_HOURS)
    handled = 0

    # Booking ödemeleri: CF token'ı yazılmış ama hâlâ PENDING/FAILED olanlar.
    # (Yerel import: order_service → delivery_service → ... zincirinde döngü var.)
    from services import (
        library_exam_service,
        order_service,
        payment_service,
        study_reservation_service,
    )

    payments_rows = (
        await db.execute(
            select(Payment).where(
                Payment.status.in_([PaymentStatus.PENDING, PaymentStatus.FAILED]),
                Payment.provider_ref.isnot(None),
                Payment.deleted_at.is_(None),
                Payment.updated_at <= newest,
                Payment.updated_at >= oldest,
            )
        )
    ).scalars().all()
    for p in payments_rows:
        result = await retrieve(token=p.provider_ref)
        if not result.success:
            continue
        await payment_service.complete_checkout(
            db, booking_id=p.booking_id, success=True,
            provider_ref=result.provider_ref,
            token=p.provider_ref, paid_price=result.paid_price,
        )
        await db.commit()
        handled += 1
        logger.warning(
            "reconciler: kayıp callback tamamlandı (payment#%s booking=%s)",
            p.id, p.booking_id,
        )

    pendingish = [
        RegistrationStatus.PENDING_PAYMENT.value,
        RegistrationStatus.CANCELLED.value,
    ]
    reg_rows = (
        await db.execute(
            select(ExamRegistration).where(
                ExamRegistration.status.in_(pendingish),
                ExamRegistration.provider_ref.isnot(None),
                ExamRegistration.paid_at.is_(None),
                ExamRegistration.deleted_at.is_(None),
                ExamRegistration.updated_at <= newest,
                ExamRegistration.updated_at >= oldest,
            )
        )
    ).scalars().all()
    for reg in reg_rows:
        result = await retrieve(token=reg.provider_ref)
        if not result.success:
            continue
        await library_exam_service.complete_checkout(
            db, registration_id=reg.id, success=True,
            provider_ref=result.provider_ref,
            token=reg.provider_ref, paid_price=result.paid_price,
        )
        await db.commit()
        handled += 1
        logger.warning("reconciler: kayıp callback tamamlandı (examreg#%s)", reg.id)

    res_rows = (
        await db.execute(
            select(StudyReservation).where(
                StudyReservation.status.in_(pendingish),
                StudyReservation.provider_ref.isnot(None),
                StudyReservation.paid_at.is_(None),
                StudyReservation.deleted_at.is_(None),
                StudyReservation.updated_at <= newest,
                StudyReservation.updated_at >= oldest,
            )
        )
    ).scalars().all()
    for res in res_rows:
        result = await retrieve(token=res.provider_ref)
        if not result.success:
            continue
        await study_reservation_service.complete_checkout(
            db, reservation_id=res.id, success=True,
            provider_ref=result.provider_ref,
            token=res.provider_ref, paid_price=result.paid_price,
        )
        await db.commit()
        handled += 1
        logger.warning("reconciler: kayıp callback tamamlandı (studyres#%s)", res.id)

    # Mağaza siparişleri: en yüksek hacimli ödeme yüzeyi ve en uzun süre
    # kapsam dışında kalmış olan. Müşteri iyzico'da öder, tarayıcıyı kapatır →
    # para çekilmiştir ama sipariş sonsuza dek PENDING kalır, kitap gönderilmez
    # ve kimse fark etmezdi.
    #
    # ── İP-18: burada `orders.status` filtresi YOKTUR ve olmamalıdır ──
    # Bu tarama `complete_checkout`'un İKİNCİ çağıranıdır ve iki işi birden
    # yapar: canlı siparişi kesinleştirmek VE **ölü** siparişe gelmiş tahsilatı
    # iade ettirmek (İP-2b R10). Seçimi `PARA_BAGLANABILIR_DURUMLAR` ile
    # daraltmak, iptal edilmiş siparişlerin kayıp callback'lerini taramanın
    # görüş alanından çıkarır ve parayı sağlayıcıda öksüz bırakırdı.
    # Yaşam döngüsü kararı burada değil, `order_service._siparis_para_claimi`
    # boğaz noktasında verilir (koşullu claim; kilit değil).
    order_rows = (
        await db.execute(
            select(Order).where(
                Order.payment_status.in_(
                    [OrderPaymentStatus.PENDING.value, OrderPaymentStatus.FAILED.value]
                ),
                Order.provider_ref.isnot(None),
                Order.paid_at.is_(None),
                Order.deleted_at.is_(None),
                Order.updated_at <= newest,
                Order.updated_at >= oldest,
            )
        )
    ).scalars().all()
    # ── Kayıt-başı hata izolasyonu (İP-2b R11) ──
    #
    # Döngü eskiden korumasızdı: TEK bir kaydın beklenmeyen hatası (sağlayıcı
    # istisnası, FSM 409'u, ağ arızası) `reconcile_stale_checkouts`'tan dışarı
    # kaçıyor ve partinin KALANI o turda hiç işlenmiyordu — kayıp callback'li
    # gerçek müşteriler, sorunlu kayıt durdukça HİÇBİR turda işlenmezdi.
    #
    # Satırlar önce anlık görüntüye alınır: `rollback` ORM nesnelerini expire
    # eder ve bayat nesnenin alanına dokunmak async oturumda lazy-load
    # (`MissingGreenlet`) üretir. Her kayıt kendi SAVEPOINT'inde işlenir; hata
    # yalnız o kaydın yazımlarını geri alır, oturum kullanılabilir kalır ve
    # hata GÖRÜNÜR bir kayıt bırakır (sessizce yutulmaz).
    order_specs = [(o.id, o.provider_ref) for o in order_rows]
    for order_id, order_token in order_specs:
        try:
            async with db.begin_nested():
                result = await retrieve(token=order_token)
                if not result.success:
                    continue
                await order_service.complete_checkout(
                    db, order_id=order_id, success=True,
                    provider_ref=result.provider_ref,
                    token=order_token, paid_price=result.paid_price,
                )
        except Exception:  # noqa: BLE001 — kayıt izole edilir, parti ölmez
            await db.rollback()
            logger.exception(
                "reconciler: order#%s mutabakatı BAŞARISIZ — kayıt atlandı, "
                "parti devam ediyor (elle inceleyin)",
                order_id,
            )
            continue
        await db.commit()
        handled += 1
        logger.warning("reconciler: kayıp callback tamamlandı (order#%s)", order_id)

    return handled
