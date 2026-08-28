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

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.payments.base import RefundState
from models.library_exam import RegistrationStatus
from models.payment import PaymentStatus
from models.store import OrderPaymentStatus
from models.tutor_promotion import PromotionPaymentStatus

logger = logging.getLogger("adana.escrow")


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
    """Bir escrow modelinin durum sözlüğü (Payment enum, reg modelleri string).

    ``status_attr``: para durumunun tutulduğu kolon. ``Order``'da sipariş yaşam
    döngüsü (``status``) ile ödeme durumu (``payment_status``) AYRI kolonlardır;
    claim daima ödeme kolonuna uygulanır.

    ``has_released_guard``: modelde ``released_at`` var mı. Ders/bilet/rezervasyon
    gerçek escrow'dur (para eğitmene/kütüphaneye serbest bırakılır) ve serbest
    bırakılmış satır asla iadeye claim edilemez. Mağaza siparişi ise doğrudan
    satıştır — hak ediş dağıtımı yoktur, dolayısıyla ``released_at`` kolonu da
    yoktur ve bu guard uygulanmaz.
    """

    held: object
    refunding: object
    refunded: object
    reference_prefix: str
    status_attr: str = "status"
    has_released_guard: bool = True
    #: İade edilecek tutarın kolonu (``Order``'da sipariş toplamı ``total``).
    amount_attr: str = "amount"
    #: Sağlayıcı referansındaki kimliğin kolonu. İade TALEBİ kendi id'siyle
    #: değil, **tahsilatın** yapıldığı siparişin id'siyle sorgulanır: iyzico
    #: `payment/detail` çağrısı charge'a verilen conversationId'yi ister
    #: (`order:{order_id}`), talep kimliğini tanımaz (İP2A-02).
    reference_id_attr: str = "id"
    #: Otomatik deneme tavanı dolduğunda yazılacak kalıcı durum (PK-δ).
    #: ``None`` → bu model için MANUAL_REVIEW desteklenmez, yalnız ALERT logu.
    manual_review: object | None = None
    #: Eşzamanlılık kilidi için advisory-lock sınıfı (model başına tekil).
    lock_class: int = 0


PAYMENT_SPEC = EscrowSpec(
    held=PaymentStatus.HELD,
    refunding=PaymentStatus.REFUNDING,
    refunded=PaymentStatus.REFUNDED,
    reference_prefix="booking",
    lock_class=1,
)
EXAM_SPEC = EscrowSpec(
    held=RegistrationStatus.PAID.value,
    refunding=RegistrationStatus.REFUNDING.value,
    refunded=RegistrationStatus.REFUNDED.value,
    reference_prefix="examreg",
    lock_class=2,
)
STUDY_SPEC = EscrowSpec(
    held=RegistrationStatus.PAID.value,
    refunding=RegistrationStatus.REFUNDING.value,
    refunded=RegistrationStatus.REFUNDED.value,
    reference_prefix="studyres",
    lock_class=3,
)
# Mağaza siparişi: doğrudan satış (emanet/hak ediş yok) ama aynı atomik claim ve
# iki fazlı iade disiplinine tabi. Para durumu `payment_status` kolonunda;
# `status` sipariş yaşam döngüsüdür (PENDING/PAID/SHIPPED/DELIVERED/…).
# REFUNDING durumu ve refund_attempts/refund_requested_at kolonları migration ile
# gelir; o zamana dek yalnız `claim` (PAID geçişi) tarafı kullanılır.
ORDER_SPEC = EscrowSpec(
    held=OrderPaymentStatus.PAID.value,
    refunding=OrderPaymentStatus.REFUNDING.value,
    refunded=OrderPaymentStatus.REFUNDED.value,
    reference_prefix="order",
    status_attr="payment_status",
    has_released_guard=False,
    amount_attr="total",
    manual_review=OrderPaymentStatus.MANUAL_REVIEW.value,
    lock_class=4,
)
# İade TALEBİ (kısmi iade dahil). Bir siparişte birden çok kısmi iade
# olabildiğinden para durumu sipariş değil TALEP üzerinde izlenir; ayrıca kısmi
# tutar, "sağlayıcı ikinci TAM iadeyi reddeder" idempotency'sini geçersiz kılar
# — her talebin kendi durumu ve deneme sayacı olmak zorundadır.
RETURN_SPEC = EscrowSpec(
    held="NONE",
    refunding="REFUNDING",
    refunded="REFUNDED",
    # Sağlayıcı referansı TALEBİN değil TAHSİLATIN kimliğidir: charge
    # `order:{order_id}` conversationId'siyle yapıldı, iyzico `payment/detail`
    # yalnız onu tanır. Eski `return:{id}` referansı hiçbir zaman eşleşmiyordu
    # ve sarkan kısmi iade 3 denemede kalıcı ALERT'e düşüyordu (İP2A-02).
    reference_prefix="order",
    reference_id_attr="order_id",
    status_attr="refund_status",
    has_released_guard=False,
    amount_attr="refund_amount",
    manual_review="MANUAL_REVIEW",
    lock_class=5,
)

# İlan öne çıkarma: mağaza siparişiyle aynı sınıf — doğrudan satış, hak ediş
# yok, dolayısıyla `released_at` guard'ı da yok. Fark, paranın YÖNÜDÜR: ödeyen
# taraf eğitmendir. İade tutarı paketin kendi fiyatıdır (`price`); kısmi iade
# YOKTUR — satılan şey bölünemeyen bir süre hakkıdır.
PROMOTION_SPEC = EscrowSpec(
    held=PromotionPaymentStatus.PAID.value,
    refunding=PromotionPaymentStatus.REFUNDING.value,
    refunded=PromotionPaymentStatus.REFUNDED.value,
    reference_prefix="promo",
    status_attr="payment_status",
    has_released_guard=False,
    amount_attr="price",
    manual_review=PromotionPaymentStatus.MANUAL_REVIEW.value,
    lock_class=8,
)

# ── Advisory kilit sınıfı kayıt defteri ────────────────────────────────────────
#
# Yukarıdaki `EscrowSpec.lock_class` değerleri (1-5 ve 8) iade uçuş-içi nöbeti
# içindir. Kütüphane kolunun KONTENJAN serileştirmesi de advisory kilit kullanır
# (satır kilidi değil — bkz. `services/library_capacity.py`) ve **aynı isim
# alanını** paylaşır; bu yüzden sınıf numaraları tek bir yerden dağıtılır. İki
# numarayı iki ayrı modülde tutmak, ileride birinin diğerinin sınıfını yeniden
# kullanmasına ve iki alakasız işlemin sessizce birbirini beklemesine yol açardı.
EXAM_SESSION_CAPACITY_LOCK_CLASS = 6
LIBRARY_CAPACITY_LOCK_CLASS = 7


# ── Atomik claim ─────────────────────────────────────────────────────────────────


async def claim(
    db: AsyncSession,
    model: type,
    row_id: int,
    *,
    from_statuses: list,
    values: dict,
    extra_where: tuple = (),
    status_attr: str = "status",
) -> bool:
    """Koşullu UPDATE: satır ancak beklenen durumdaysa geçer; tek kazanan olur.

    True dönerse geçiş BU transaction'a aittir. Çağıranın elindeki ORM nesnesi
    bayatlar — gerekiyorsa ``db.refresh`` etmelidir.

    ``status_attr`` para durumunun kolonudur; ``Order`` gibi sipariş durumu ile
    ödeme durumunu ayrı tutan modellerde ``payment_status`` verilir.
    """
    status_col = getattr(model, status_attr)
    # Soft-delete her modelde yok (ör. OrderReturn yalnız TimestampMixin taşır);
    # kolon varsa filtreye eklenir, yoksa atlanır.
    soft_delete = (
        (model.deleted_at.is_(None),) if hasattr(model, "deleted_at") else ()
    )
    stmt = (
        update(model)
        .where(
            model.id == row_id,
            status_col.in_(from_statuses),
            *soft_delete,
            *extra_where,
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    result = await db.execute(stmt)
    return result.rowcount == 1


# ── Uçuş-içi (in-flight) nöbeti ─────────────────────────────────────────────────
#
# İki fazlı iadenin bedeli: niyet COMMIT edildiği için sağlayıcı çağrısı
# boyunca hiçbir satır kilidi TUTULMAZ (bilinçli — kurye teslimi bloke
# olmasın, İP-2b R17). Ama o pencerede reconciler karantina süresini dolmuş
# görüp AYNI kayda ikinci gerçek iade emri verebilir (İP2A-06): kısmi iadede
# sağlayıcının "aşırı iade reddi" emniyet kemeri geçersizdir, yani bu GERÇEK
# çifte ödemedir.
#
# Çözüm zamana değil **sahipliğe** dayanır: sağlayıcı çağrısını yapan
# transaction, kayda ait bir PostgreSQL advisory kilidini çağrı boyunca tutar.
# Neden advisory (satır kilidi değil): satır kilidi Order↔OrderReturn kilit
# sırasına girer ve iki eşzamanlı iadede gerçek deadlock üretir; advisory kilit
# ayrı bir isim alanındadır ve satır yazımlarının kanonik sırasını (Order →
# OrderReturn) bozmaz. Süreç ölürse bağlantı düşer, kilit kendiliğinden serbest
# kalır — sarkan kayıt yine reconciler'a kalır.


def _durum_degeri(x) -> str:
    """Enum ya da düz string durumu tek bir karşılaştırılabilir değere indirger.

    ``Payment.status`` PG enum'u (ORM'de ``PaymentStatus``), diğer modellerin
    para durumu düz ``String``. Karşılaştırmayı ``str()``'e bırakmak
    ``'PaymentStatus.REFUNDING' != 'REFUNDING'`` gibi SESSİZ bir yanlışa yol
    açardı — nöbet hiç tutmadan hep "durum değişmiş" derdi.
    """
    return str(x.value if hasattr(x, "value") else x)


async def try_inflight_lock(db: AsyncSession, spec: EscrowSpec, row_id: int) -> bool:
    """Kaydın iade kilidini BEKLEMEDEN almayı dener. False = başkası çalışıyor."""
    return bool(
        (
            await db.execute(
                text("SELECT pg_try_advisory_xact_lock(:c, :i)"),
                {"c": spec.lock_class, "i": int(row_id)},
            )
        ).scalar_one()
    )


async def acquire_inflight_lock(db: AsyncSession, spec: EscrowSpec, row_id: int) -> None:
    """Kaydın iade kilidini alır (gerekirse bekler). Transaction sonunda düşer."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:c, :i)"),
        {"c": spec.lock_class, "i": int(row_id)},
    )


async def current_status(db: AsyncSession, obj, spec: EscrowSpec):
    """Satırın DB'deki TAZE para durumu (ORM kimlik haritasını atlar)."""
    model = type(obj)
    return (
        await db.execute(
            select(getattr(model, spec.status_attr)).where(model.id == obj.id)
        )
    ).scalar_one_or_none()


# ── İki fazlı iade ───────────────────────────────────────────────────────────────


async def begin_refund(
    db: AsyncSession,
    obj,
    spec: EscrowSpec,
    *,
    from_statuses: list | None = None,
    provider_ref: str | None = None,
    extra_values: dict | None = None,
    extra_where: tuple = (),
    refresh_attrs: tuple[str, ...] = (),
) -> bool:
    """Faz 1: iade niyetini atomik claim edip COMMIT eder (intent kalıcı).

    ``released_at`` dolu satır ASLA claim edilemez (kazanç zaten dağıtılmış —
    ikinci para hareketi yasak; H2). ``provider_ref`` verilirse (callback'ten
    gelen paymentTransactionId) iadenin yapılacağı kimlik olarak yazılır.

    ``extra_values``/``extra_where``: niyetle AYNI atomik UPDATE'e binen ek
    yazımlar ve koşullar. Para rezervasyonu (`orders.refund_reserved`) ve iade
    tutarının kesinleşmesi bu yolla claim'e bağlanır — ayrı bir UPDATE'e
    bırakılsalardı iki eşzamanlı iade arasında kayıp güncelleme penceresi
    doğardı (İP2A-04).
    """
    model = type(obj)
    values: dict = {
        spec.status_attr: spec.refunding,
        "refund_requested_at": _now(),
        "refund_attempts": model.refund_attempts + 1,
    }
    if provider_ref:
        values["provider_ref"] = provider_ref
    if extra_values:
        values.update(extra_values)
    claimed = await claim(
        db,
        model,
        obj.id,
        from_statuses=from_statuses or [spec.held],
        values=values,
        extra_where=(
            ((model.released_at.is_(None),) if spec.has_released_guard else ())
            + tuple(extra_where)
        ),
        status_attr=spec.status_attr,
    )
    if claimed:
        # Intent'i kalıcılaştır: süreç sağlayıcı çağrısında ölürse reconciler bulur.
        await db.commit()
        # YALNIZ claim'in yazdığı skaler alanlar tazelenir. Parametresiz
        # `refresh` İLİŞKİLERİ de expire eder; çağıran (ör. order_service
        # `_restock`) hemen ardından `order.items` okuyor ve async oturumda
        # lazy-load MissingGreenlet ile 500 üretiyordu.
        await db.refresh(
            obj,
            attribute_names=[
                spec.status_attr,
                "refund_requested_at",
                "refund_attempts",
                *refresh_attrs,
            ],
        )
    return claimed


async def perform_refund(
    db: AsyncSession,
    obj,
    spec: EscrowSpec,
    *,
    notify: Callable[[], Awaitable[None]] | None = None,
    amount: Decimal | None = None,
) -> bool:
    """Faz 2: sağlayıcı iadesi + REFUNDING→REFUNDED finalize.

    Sağlayıcı reddederse/ulaşılamazsa False: kayıt REFUNDING'de kalır ve reconciler
    devralır — HİÇBİR yerde HELD'e geri dönüş yoktur.

    ``amount`` verilmezse ``spec.amount_attr`` kolonundan okunur. Sipariş
    yolunda tutar **kalan** iade edilebilir tutardır (`total` DEĞİL): kısmi
    iade sonrası tam iade, siparişin tamamını ikinci kez göndererek ödenenden
    fazlasını iade ettiriyordu (İP2A-03).

    **Uçuş-içi nöbeti:** sağlayıcıya gitmeden önce kaydın advisory kilidi
    alınır ve TAZE durum yeniden okunur. Bu ikili, "reconciler ile canlı istek
    aynı kaydı aynı anda sağlayıcıya gönderir" yarışını kapatır: bekleyen taraf
    kilidi aldığında kaydın artık REFUNDING olmadığını görür ve İKİNCİ ÇAĞRIYI
    YAPMAZ.
    """
    await acquire_inflight_lock(db, spec, obj.id)
    taze = await current_status(db, obj, spec)
    if taze is not None and _durum_degeri(taze) != _durum_degeri(spec.refunding):
        # Kilidi beklerken başka bir yol bu iadeyi sonuçlandırdı. Kayıt zaten
        # REFUNDED ise iş bitmiştir; MANUAL_REVIEW ise otomatik para hareketi
        # YASAKTIR. Her iki hâlde de sağlayıcıya gidilmez.
        bitti = _durum_degeri(taze) == _durum_degeri(spec.refunded)
        logger.warning(
            "escrow: iade kilidi alındığında durum '%s' — sağlayıcı çağrısı "
            "ATLANDI (%s#%s)", taze, type(obj).__name__, obj.id,
        )
        return bitti

    tutar = (
        Decimal(str(amount))
        if amount is not None
        else Decimal(str(getattr(obj, spec.amount_attr)))
    )
    ok = True
    if tutar > 0:
        provider = payments.get_payment_provider()
        ok = await provider.refund(provider_ref=obj.provider_ref, amount=tutar)
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


def order_inflight_refund(order) -> Decimal:
    """Sipariş yolunda UÇUŞTA olan iade tutarı = rezerve edilmiş − kesinleşmiş.

    Reconciler bir siparişi retry'larken `total`'ı değil bunu gönderir: kısmi
    RMA'sı tamamlanmış bir siparişin tam iadesi, ödenenden fazlasını iade
    ettiriyordu (İP2A-03). Belirsizlik yok, çünkü sipariş `REFUNDING` iken RMA
    para yolu açılmaz (`order_service._settle_return` taze `payment_status`'ü
    kilit altında `PAID` görmek zorundadır).

    **Fail-safe:** rezervasyon farkı 0 çıkarsa tutar SIFIR SAYILMAZ. Böyle bir
    satır, bu sürümden ÖNCE commit'lenmiş bir niyet ya da elle üretilmiş bir
    kayıt olabilir; 0 döndürmek sağlayıcıya hiç gitmeden `REFUNDED` yazmak
    (yani parayı iade etmeden "iade edildi" demek) anlamına gelirdi. Güvenli
    taban, siparişin henüz iade edilmemiş kısmıdır — aşırı iadeyi sağlayıcının
    reddi ve `refunded_amount` tavanı zaten sınırlar.
    """
    kesin = Decimal(str(order.refunded_amount or 0))
    ucusta = Decimal(str(order.refund_reserved or 0)) - kesin
    if ucusta > 0:
        return ucusta
    return max(Decimal(str(order.total)) - kesin, Decimal("0"))


async def mark_manual_review(db: AsyncSession, obj, spec: EscrowSpec) -> bool:
    """Deneme tavanı dolan sarkan iadeyi kalıcı MANUAL_REVIEW'a taşır (PK-δ).

    Sözleşme (docs/ip2a-magaza-iade-sozlesme.md §5/PK-δ):
    - `REFUNDED` **yazılmaz** — para gerçekten döndü mü bilinmiyor;
    - otomatik reconciler bu kaydı bir daha sağlayıcıya göndermez;
    - kayıt admin kuyruğundan (`refund_status=MANUAL_REVIEW` filtresi)
      sorgulanabilir olur;
    - başarı yan etkileri (stok, kupon, bildirim, finalize) ÜRETİLMEZ.
    """
    if spec.manual_review is None:
        return False
    return await claim(
        db,
        type(obj),
        obj.id,
        from_statuses=[spec.refunding],
        values={spec.status_attr: spec.manual_review},
        status_attr=spec.status_attr,
    )


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
        values={spec.status_attr: spec.refunded, "refunded_at": _now()},
        status_attr=spec.status_attr,
    )
    if finalized:
        # Skaler alanlarla sınırlı (parametresiz refresh ilişkileri expire eder
        # ve çağıran taraf lazy-load ile MissingGreenlet alır).
        await db.refresh(obj, attribute_names=[spec.status_attr, "refunded_at"])
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


async def refund_unexpected_charge(
    *, provider_ref: str | None, amount: Decimal, context: str
) -> bool:
    """Bizde karşılığı olmayan DOĞRULANMIŞ tahsilatı sağlayıcıya aynen geri gönderir.

    Kullanım: callback'te token uyuşmazlığı (ikinci/bayat CF oturumu ödendi) ya da
    paidPrice uyuşmazlığı — varlığa bağlanamayan para emanete alınmaz, iade edilir.
    Satır-durumu yoktur; replay idempotency'si sağlayıcının aşırı-iade reddine
    yaslanır (aynı işlemin ikinci tam iadesi reddedilir).
    """
    provider = payments.get_payment_provider()
    ok = await provider.refund(provider_ref=provider_ref, amount=amount)
    logger.error(
        "escrow: beklenmeyen tahsilat iade edildi=%s (%s ref=%s tutar=%s)",
        ok,
        context,
        provider_ref,
        amount,
    )
    return ok


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
