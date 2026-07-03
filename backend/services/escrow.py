"""Escrow çekirdeği — atomik durum claim'i + iki fazlı iade (intent = satırın kendisi).

Para yolundaki HER durum geçişi koşullu UPDATE ile yapılır: READ COMMITTED'da
yarışan transaction satır kilidinde bekler, WHERE koşulu güncel satıra göre
yeniden değerlendirilir → tek kazanan (check-then-act yarışları biter; C1/H2).

İade iki fazlıdır (crash-consistency; C2):
  Faz 1  ``begin_refund``: status=REFUNDING + refund_requested_at + refund_attempts++
         atomik claim edilir ve HEMEN COMMIT edilir — niyet (intent) kalıcıdır.
         Süreç burada ölürse kayıt sarkan REFUNDING olarak kalır; reconciler
         (services/escrow_reconciler.py) karantina penceresi sonrası devralır.
  Faz 2  ``perform_refund``: sağlayıcı iadesi → başarıda REFUNDING→REFUNDED finalize
         (+ bildirim). Başarısızlıkta REFUNDING'de bırakılır (reconciler retry'lar).

Terminal durumlar (RELEASED/REFUNDED/ATTENDED) hiçbir claim'in kaynağı değildir;
``released_at`` dolu satır asla iadeye claim edilemez (kütüphane kazanç raporu
``released_at``'ten okunur — çifte para hareketi imkânsızlaşır; H2).
"""
from __future__ import annotations

import dataclasses
import datetime
import logging
from collections.abc import Awaitable, Callable
from decimal import Decimal

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.payments.base import RefundState
from models.library_exam import RegistrationStatus
from models.payment import PaymentStatus

logger = logging.getLogger("ceyhan.escrow")


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# ── Saf geçiş tabloları (Hypothesis property testleri buradan beslenir) ──────────

PAYMENT_TRANSITIONS: dict[PaymentStatus, frozenset[PaymentStatus]] = {
    PaymentStatus.PENDING: frozenset(
        {PaymentStatus.HELD, PaymentStatus.FAILED, PaymentStatus.REFUNDING}
    ),
    PaymentStatus.FAILED: frozenset({PaymentStatus.HELD, PaymentStatus.REFUNDING}),
    PaymentStatus.HELD: frozenset({PaymentStatus.RELEASED, PaymentStatus.REFUNDING}),
    PaymentStatus.REFUNDING: frozenset({PaymentStatus.REFUNDED}),
    PaymentStatus.RELEASED: frozenset(),
    PaymentStatus.REFUNDED: frozenset(),
}

REGISTRATION_TRANSITIONS: dict[str, frozenset[str]] = {
    RegistrationStatus.PENDING_PAYMENT.value: frozenset(
        {
            RegistrationStatus.PAID.value,
            RegistrationStatus.CANCELLED.value,
            # Varlık ölüyken (oturum iptal vb.) doğrulanmış tahsilat → doğrudan iade.
            RegistrationStatus.REFUNDING.value,
        }
    ),
    RegistrationStatus.PAID.value: frozenset(
        {RegistrationStatus.ATTENDED.value, RegistrationStatus.REFUNDING.value}
    ),
    RegistrationStatus.CANCELLED.value: frozenset(
        {
            # register() iptal edilmiş kaydı canlandırabilir.
            RegistrationStatus.PENDING_PAYMENT.value,
            # İptalden SONRA gelen doğrulanmış tahsilat → iade (C2b).
            RegistrationStatus.REFUNDING.value,
        }
    ),
    RegistrationStatus.REFUNDING.value: frozenset({RegistrationStatus.REFUNDED.value}),
    RegistrationStatus.ATTENDED.value: frozenset(),
    RegistrationStatus.REFUNDED.value: frozenset(),
}


@dataclasses.dataclass(frozen=True)
class EscrowSpec:
    """Bir escrow modelinin durum sözlüğü (Payment enum, reg modelleri string)."""

    held: object
    refunding: object
    refunded: object
    reference_prefix: str


PAYMENT_SPEC = EscrowSpec(
    held=PaymentStatus.HELD,
    refunding=PaymentStatus.REFUNDING,
    refunded=PaymentStatus.REFUNDED,
    reference_prefix="booking",
)
EXAM_SPEC = EscrowSpec(
    held=RegistrationStatus.PAID.value,
    refunding=RegistrationStatus.REFUNDING.value,
    refunded=RegistrationStatus.REFUNDED.value,
    reference_prefix="examreg",
)
STUDY_SPEC = EscrowSpec(
    held=RegistrationStatus.PAID.value,
    refunding=RegistrationStatus.REFUNDING.value,
    refunded=RegistrationStatus.REFUNDED.value,
    reference_prefix="studyres",
)


# ── Atomik claim ─────────────────────────────────────────────────────────────────


async def claim(
    db: AsyncSession,
    model: type,
    row_id: int,
    *,
    from_statuses: list,
    values: dict,
    extra_where: tuple = (),
) -> bool:
    """Koşullu UPDATE: satır ancak beklenen durumdaysa geçer; tek kazanan olur.

    True dönerse geçiş BU transaction'a aittir. Çağıranın elindeki ORM nesnesi
    bayatlar — gerekiyorsa ``db.refresh`` etmelidir.
    """
    stmt = (
        update(model)
        .where(
            model.id == row_id,
            model.status.in_(from_statuses),
            model.deleted_at.is_(None),
            *extra_where,
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    result = await db.execute(stmt)
    return result.rowcount == 1


# ── İki fazlı iade ───────────────────────────────────────────────────────────────


async def begin_refund(
    db: AsyncSession,
    obj,
    spec: EscrowSpec,
    *,
    from_statuses: list | None = None,
    provider_ref: str | None = None,
) -> bool:
    """Faz 1: iade niyetini atomik claim edip COMMIT eder (intent kalıcı).

    ``released_at`` dolu satır ASLA claim edilemez (kazanç zaten dağıtılmış —
    ikinci para hareketi yasak; H2). ``provider_ref`` verilirse (callback'ten
    gelen paymentTransactionId) iadenin yapılacağı kimlik olarak yazılır.
    """
    model = type(obj)
    values: dict = {
        "status": spec.refunding,
        "refund_requested_at": _now(),
        "refund_attempts": model.refund_attempts + 1,
    }
    if provider_ref:
        values["provider_ref"] = provider_ref
    claimed = await claim(
        db,
        model,
        obj.id,
        from_statuses=from_statuses or [spec.held],
        values=values,
        extra_where=(model.released_at.is_(None),),
    )
    if claimed:
        # Intent'i kalıcılaştır: süreç sağlayıcı çağrısında ölürse reconciler bulur.
        await db.commit()
        await db.refresh(obj)
    return claimed


async def perform_refund(
    db: AsyncSession,
    obj,
    spec: EscrowSpec,
    *,
    notify: Callable[[], Awaitable[None]] | None = None,
) -> bool:
    """Faz 2: sağlayıcı iadesi + REFUNDING→REFUNDED finalize.

    Sağlayıcı reddederse/ulaşılamazsa False: kayıt REFUNDING'de kalır ve reconciler
    devralır — HİÇBİR yerde HELD'e geri dönüş yoktur.
    """
    amount = Decimal(str(obj.amount))
    ok = True
    if amount > 0:
        provider = payments.get_payment_provider()
        ok = await provider.refund(provider_ref=obj.provider_ref, amount=amount)
    if not ok:
        logger.error(
            "escrow: sağlayıcı iadesi başarısız — REFUNDING'de bırakıldı, "
            "reconciler devralacak (%s#%s ref=%s)",
            type(obj).__name__,
            obj.id,
            obj.provider_ref,
        )
        return False
    return await finalize_refund(db, obj, spec, notify=notify)


async def finalize_refund(
    db: AsyncSession,
    obj,
    spec: EscrowSpec,
    *,
    notify: Callable[[], Awaitable[None]] | None = None,
) -> bool:
    """REFUNDING→REFUNDED (+ refunded_at) — iade sağlayıcıda kesinleşince."""
    finalized = await claim(
        db,
        type(obj),
        obj.id,
        from_statuses=[spec.refunding],
        values={"status": spec.refunded, "refunded_at": _now()},
    )
    if finalized:
        await db.refresh(obj)
        if notify is not None:
            await notify()
    return finalized


async def refund_escrow(
    db: AsyncSession,
    obj,
    spec: EscrowSpec,
    *,
    from_statuses: list | None = None,
    provider_ref: str | None = None,
    notify: Callable[[], Awaitable[None]] | None = None,
) -> str:
    """Tam iade akışı. Dönüş: 'refunded' | 'refunding' | 'not_claimed'.

    'not_claimed' = başka bir transaction kazandı (zaten iade/serbest/katılmış) —
    çağıran para hareketi YAPMAMALIDIR.
    """
    if not await begin_refund(
        db, obj, spec, from_statuses=from_statuses, provider_ref=provider_ref
    ):
        return "not_claimed"
    if await perform_refund(db, obj, spec, notify=notify):
        return "refunded"
    return "refunding"


# ── Reconciler saf karar çekirdeği (property-test edilebilir) ───────────────────

ACTION_WAIT = "wait"          # karantina penceresi dolmadı — dokunma
ACTION_FINALIZE = "finalize"  # sağlayıcıda iade POZİTİF görünüyor — yalnız yerel finalize
ACTION_RETRY = "retry"        # sınırlı retry (sağlayıcının aşırı-iade reddi emniyet kemeri)
ACTION_ALERT = "alert"        # deneme sınırı doldu — insan müdahalesi (retry durur)


def next_refund_action(
    *,
    attempts: int,
    requested_at: datetime.datetime | None,
    now: datetime.datetime,
    provider_state: RefundState,
    min_age: datetime.timedelta,
    max_attempts: int,
) -> str:
    """Sarkan bir REFUNDING kaydı için sıradaki güvenli adım.

    Kritik kural: NOT_REFUNDED/UNKNOWN "iade yok" kanıtı DEĞİLDİR — retry ancak
    deneme sınırı içinde yapılır ve tam-tutar iadenin sağlayıcıdaki aşırı-iade
    reddine yaslanır. Pozitif kanıt (REFUNDED) sağlayıcıya yazma çağrısı yapmadan
    yalnız yerel finalize üretir.
    """
    if requested_at is None or now - requested_at < min_age:
        return ACTION_WAIT
    if provider_state is RefundState.REFUNDED:
        return ACTION_FINALIZE
    if attempts >= max_attempts:
        return ACTION_ALERT
    return ACTION_RETRY
