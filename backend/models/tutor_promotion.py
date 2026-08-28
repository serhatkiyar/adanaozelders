"""İlan öne çıkarma satın alması — eğitmenin platformdan aldığı reklam paketi.

## Neden escrow değil

Para PLATFORMUN kendi cirosudur: satılan şey, platformun kendi arama sonuç
sayfasındaki reklam alanıdır. Üçüncü kişi adına tahsilat yoktur, hak ediş
dağıtımı yoktur — bu yüzden `released_at` kolonu da yoktur ve `EscrowSpec`
`has_released_guard=False` ile kullanılır (mağaza siparişiyle aynı sınıf).
Yön de terstir: ödeyen taraf eğitmendir.

## Neden süpürge işi yok

Aktiflik bir SQL yüklemidir, zamanlanmış iş değil:

    payment_status = PAID ∧ cancelled_at IS NULL ∧ starts_at <= now() < ends_at

`services/library_capacity.py:74-99` bu deseni koltuk tutma için kuruyor; aynı
gerekçe burada daha da güçlü: bir süpürgenin çalışmaması durumunda ilan bedava
olarak üst sırada kalırdı ve bunun tek belirtisi bir log satırı olurdu.

## `expiry_notified_at` neden var

Görünürlük yükleme bağlı olduğu için bitişte YAPILACAK BİR İŞ YOK. Bu kolon
yalnız "süren doldu" bildirimini bir kez göndermek içindir; para ya da
görünürlük kararına hiçbir noktada girmez.
"""
from __future__ import annotations

import datetime
import enum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import TimestampMixin


class PromotionPaymentStatus(str, enum.Enum):
    PENDING = "PENDING"
    PAID = "PAID"
    FAILED = "FAILED"
    REFUNDING = "REFUNDING"
    REFUNDED = "REFUNDED"
    MANUAL_REVIEW = "MANUAL_REVIEW"


class TutorPromotion(Base, TimestampMixin):
    """Bir eğitmenin satın aldığı süreli öne çıkarma hakkı.

    Soft-delete YOKTUR: satın alma kaydı silinmez. İptal `cancelled_at` ile
    damgalanır ve kayıt para geçmişinin parçası olarak durur.
    """

    __tablename__ = "tutor_promotions"

    id: Mapped[int] = mapped_column(primary_key=True)
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # ── Satın alma anının snapshot'ı ────────────────────────────────────────
    # Katalog (`core/promotion_packages.py`) sonradan değişse bile geçmiş kayıt
    # değişmez: fiyat ve süre burada donar.
    package_days: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'TRY'")
    )
    # KDV kırılımı sipariş tarafındaki desenle aynı: fiyat BRÜT, vergi içeriden
    # çıkarılır (`services/tax.py::tax_from_gross`). Oran belirsizken NULL
    # kalır — sessizce %0 yazılmaz (`SHIPPING_TAX_RATE` ile aynı disiplin).
    tax_rate: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    tax_amount: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)

    # ── Para durumu ─────────────────────────────────────────────────────────
    payment_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'PENDING'")
    )
    provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    provider_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    paid_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refunded_amount: Mapped[float] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    refund_requested_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refund_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    # ── Yürürlük penceresi ──────────────────────────────────────────────────
    # Ödeme onaylanana kadar NULL: ödenmemiş bir paket hiçbir zaman görünürlük
    # üretmez ve "önce başlasın, sonra ödesin" diye bir ara durum yoktur.
    starts_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ends_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expiry_notified_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Cayma hakkı istisnası onayı. Hizmet satın alma anında ifa edilmeye
    # başladığı için cayma hakkı istisnası ÖN ONAYA bağlıdır; onayın kendisi
    # bir kanıttır ve satın alma kaydıyla birlikte saklanır. Onaysız satın
    # alma yoktur (servis 422 verir), bu yüzden PAID kayıtta dolu olması
    # beklenir — ama kolon nullable: geçmişe dönük veri uydurulmaz.
    terms_accepted_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    tutor: Mapped["Tutor"] = relationship()

    __table_args__ = (
        CheckConstraint("package_days > 0", name="ck_tutor_promotions_days"),
        CheckConstraint("price >= 0", name="ck_tutor_promotions_price"),
        CheckConstraint(
            "ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at",
            name="ck_tutor_promotions_window",
        ),
        # Öne çıkarma sorgusunun sıcak yolu: "şu eğitmenin şu anda yürürlükte
        # olan kaydı var mı" — tutor_id zaten indexli, pencere buna eklenir.
        Index("ix_tutor_promotions_window", "tutor_id", "starts_at", "ends_at"),
        Index("ix_tutor_promotions_payment_status", "payment_status"),
    )
