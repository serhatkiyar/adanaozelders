"""Para metrikleri — "iş nasıl gidiyor?" sorusunun tek cevabı.

BOŞLUK: yönetim paneli tamamen sayaç (COUNT) tabanlıydı. "Kaç sipariş geldi"
biliniyor, "ne kadar ciro yaptık, ne kadarı bizim gelirimiz, ne kadarı emanette"
bilinmiyordu. Lansmanda ilk sorulacak soru bu ve cevabı hiçbir ekranda yoktu.

DÖRT PARA YÜZEYİ, İKİ FARKLI GELİR TİPİ
- **Komisyon geliri** (pazaryeri): ders escrow'u, kütüphane deneme/çalışma
  rezervasyonu ve eğitmenin dijital ürünü. Bu üçünde hacim başkasının
  cirosudur; bize yalnız komisyon kalır.
- **Doğrudan satış cirosu**: platformun kendi fiziksel ürünleri. Burada tutarın
  tamamı bize gelir ama karşılığında MAL MALİYETİ vardır — komisyonla aynı
  kefeye konursa gelir olduğundan yüksek görünür. Bu yüzden ayrı raporlanır.

EMANET GELİR DEĞİLDİR: ders yapılmadan, katılım doğrulanmadan tahsil edilen
para iade edilebilir. Ayrı satırda "emanette" olarak gösterilir — hakediş
defteriyle (services/payout_ledger.py) aynı ilke.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from sqlalchemy import Numeric, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.library_exam import ExamRegistration
from models.payment import Payment, PaymentStatus
from models.store import Order, OrderItem, SellerType
from models.study_reservation import StudyReservation

ZERO = Decimal("0.00")


def _sum(column, *conditions):
    """Koşullu toplam — NULL yerine 0 döner (rapor satırı boş kalmasın)."""
    return func.coalesce(
        func.sum(column).filter(*conditions) if conditions else func.sum(column),
        cast(0, Numeric(12, 2)),
    )


def _q(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _windows(current_start, previous_start):
    """İki dönemin koşulları — TEK sorguda hesaplanır.

    Dönem başına ayrı sorgu atmak tabloları iki kez taratıyordu (10x hacimde
    ölçüldü: 12 sorgu / 457 ms). `FILTER (WHERE …)` ile aynı taramadan hem
    bu dönem hem önceki dönem çıkar.
    """
    return {
        "cur": lambda col: [col >= current_start],
        "prev": lambda col: [col >= previous_start, col < current_start],
        # WHERE'e konacak ortak alt sınır: FILTER yalnız topladığını seçer,
        # taramayı daraltmaz. Bu sınır olmadan sorgular TÜM geçmişi okuyup
        # sonra filtreliyordu (10x hacimde ölçüldü: 228 ms).
        "_floor": previous_start,
    }


def _pair(column, date_column, windows, *conditions):
    """Aynı toplamın iki dönemlik hâli: (cur, prev) ifadeleri."""
    return {
        key: _sum(column, *conditions, *make(date_column))
        for key, make in windows.items()
        if key != "_floor"
    }


def _flatten(pairs: dict[str, dict]):
    """{"gross": {"cur": expr, "prev": expr}} → etiketli select sütunları."""
    columns = []
    for name, pair in pairs.items():
        for key, expr in pair.items():
            columns.append(expr.label(f"{key}__{name}"))
    return columns


def _split(row, names: list[str]) -> dict[str, dict[str, Decimal]]:
    return {
        key: {name: _q(row[f"{key}__{name}"]) for name in names}
        for key in ("cur", "prev")
    }


async def _lesson_money(db: AsyncSession, windows) -> dict[str, dict[str, Decimal]]:
    """Ders escrow'u: hacim, komisyon, emanet, iade."""
    pairs = {
        "gross": _pair(
            Payment.amount,
            Payment.created_at,
            windows,
            Payment.status.in_([PaymentStatus.HELD, PaymentStatus.RELEASED]),
        ),
        # Komisyon YALNIZ serbest bırakılınca gelir sayılır: emanetteki dersin
        # komisyonu henüz kazanılmamıştır (iade edilebilir).
        "commission": _pair(
            Payment.commission_amount,
            Payment.created_at,
            windows,
            Payment.status == PaymentStatus.RELEASED,
        ),
        "held": _pair(
            Payment.amount, Payment.created_at, windows, Payment.status == PaymentStatus.HELD
        ),
        "refunded": _pair(
            Payment.amount,
            Payment.created_at,
            windows,
            Payment.status == PaymentStatus.REFUNDED,
        ),
    }
    row = (
        await db.execute(
            select(*_flatten(pairs)).where(
                Payment.deleted_at.is_(None),
                Payment.created_at >= windows["_floor"],
            )
        )
    ).mappings().one()
    return _split(row, list(pairs))


async def _library_money(db: AsyncSession, windows) -> dict[str, dict[str, Decimal]]:
    """Kütüphane deneme bileti + çalışma rezervasyonu (escrow gömülü)."""
    names = ["gross", "commission", "held", "refunded"]
    totals = {key: {name: ZERO for name in names} for key in ("cur", "prev")}
    for model in (ExamRegistration, StudyReservation):
        paid = model.paid_at
        pairs = {
            "gross": _pair(model.amount, paid, windows, paid.isnot(None)),
            "commission": _pair(
                model.commission_amount, paid, windows, model.released_at.isnot(None)
            ),
            "held": _pair(model.amount, paid, windows, model.released_at.is_(None)),
            "refunded": _pair(
                model.amount, paid, windows, model.refunded_at.isnot(None)
            ),
        }
        row = (
            await db.execute(
                select(*_flatten(pairs)).where(paid >= windows["_floor"])
            )
        ).mappings().one()
        part = _split(row, names)
        for key in totals:
            for name in names:
                totals[key][name] += part[key][name]
    return totals


async def _store_money(db: AsyncSession, windows) -> dict[str, dict]:
    """Mağaza: platform cirosu (doğrudan satış) + eğitmen ürünü komisyonu."""
    paid = Order.paid_at
    order_pairs = {
        "gross": _pair(Order.total, paid, windows, paid.isnot(None)),
        "refunded": _pair(Order.refunded_amount, paid, windows, paid.isnot(None)),
    }
    count_columns = [
        func.count().filter(paid.isnot(None), *make(paid)).label(f"{key}__orders")
        for key, make in windows.items()
        if key != "_floor"
    ]
    order_row = (
        await db.execute(
            select(*_flatten(order_pairs), *count_columns).where(
                Order.deleted_at.is_(None),
                paid >= windows["_floor"],
            )
        )
    ).mappings().one()

    item_pairs = {
        # Eğitmenin dijital ürünü: bize komisyon kalır.
        "tutor_commission": _pair(
            OrderItem.commission_amount,
            paid,
            windows,
            OrderItem.seller_type == SellerType.TUTOR.value,
        ),
        # Platformun kendi ürünü: tutarın tamamı bize gelir (ciro).
        "platform_sales": _pair(
            OrderItem.unit_price * OrderItem.quantity,
            paid,
            windows,
            OrderItem.seller_type == SellerType.PLATFORM.value,
        ),
    }
    item_row = (
        await db.execute(
            select(*_flatten(item_pairs))
            .select_from(OrderItem)
            .join(Order, Order.id == OrderItem.order_id)
            .where(
                Order.deleted_at.is_(None),
                paid.isnot(None),
                paid >= windows["_floor"],
            )
        )
    ).mappings().one()

    out: dict[str, dict] = {}
    for key in ("cur", "prev"):
        orders = int(order_row[f"{key}__orders"] or 0)
        gross = _q(order_row[f"{key}__gross"])
        out[key] = {
            "gross": gross,
            "commission": _q(item_row[f"{key}__tutor_commission"]),
            "direct_sales": _q(item_row[f"{key}__platform_sales"]),
            "refunded": _q(order_row[f"{key}__refunded"]),
            "orders": orders,
            # Sepet ortalaması: pazarlama kararlarının (kargo eşiği, kupon
            # tutarı) dayandığı tek sayı.
            "aov": _q(gross / orders) if orders else ZERO,
        }
    return out


def _combine(lesson: dict, library: dict, store: dict) -> dict:
    gmv = lesson["gross"] + library["gross"] + store["gross"]
    commission = lesson["commission"] + library["commission"] + store["commission"]
    return {
        "gmv": gmv,
        # Platform geliri = pazaryeri komisyonu + kendi ürün cirosu.
        "revenue": commission + store["direct_sales"],
        "commission_revenue": commission,
        "direct_sales_revenue": store["direct_sales"],
        "held": lesson["held"] + library["held"],
        "refunded": lesson["refunded"] + library["refunded"] + store["refunded"],
        "orders": store["orders"],
        "aov": store["aov"],
        "lesson_gmv": lesson["gross"],
        "library_gmv": library["gross"],
        "store_gmv": store["gross"],
    }


async def get_revenue(db: AsyncSession, *, range_name: str) -> dict:
    """Dönem + önceki dönem para metrikleri (dashboard'daki karşılaştırma deseni)."""
    days = {"day": 1, "week": 7, "month": 30}[range_name]
    now = datetime.datetime.now(datetime.timezone.utc)
    period_start = now - datetime.timedelta(days=days)
    previous_start = period_start - datetime.timedelta(days=days)

    windows = _windows(period_start, previous_start)
    lesson = await _lesson_money(db, windows)
    library = await _library_money(db, windows)
    store = await _store_money(db, windows)

    current = _combine(lesson["cur"], library["cur"], store["cur"])
    previous = _combine(lesson["prev"], library["prev"], store["prev"])

    # İade oranı: tutar bazında (adet bazında olsaydı küçük iadeler büyük
    # görünürdü). GMV sıfırken oran tanımsızdır — 0 döner.
    refund_rate = (
        float(current["refunded"] / current["gmv"]) if current["gmv"] else 0.0
    )
    return {
        "range": range_name,
        "period_start": period_start,
        "previous_period_start": previous_start,
        "refund_rate": round(refund_rate, 4),
        **{k: v for k, v in current.items()},
        **{f"previous_{k}": v for k, v in previous.items()},
    }
