from __future__ import annotations

import enum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.schema import Computed

from core.database import Base
from models.mixins import ModeratableMixin, PayoutMixin, SoftDeleteMixin, TimestampMixin


class LibraryStatus(str, enum.Enum):
    """Kütüphane katalog durumu. İki giriş yolu: admin küratörlüğü (doğrudan ACTIVE)
    ve self-servis onboarding (PENDING → admin onayı → ACTIVE / REJECTED). Yalnız
    ``ACTIVE`` kayıtlar public katalogda/haritada görünür. (status kolonu VARCHAR(10) —
    değerler ≤10 karakter olmalı.)"""

    ACTIVE = "ACTIVE"
    HIDDEN = "HIDDEN"
    PENDING = "PENDING"  # self-kayıt → admin onayı bekliyor (public'te görünmez)
    REJECTED = "REJECTED"  # admin reddetti (operatöre gerekçe gösterilir)


class Library(Base, TimestampMixin, SoftDeleteMixin, PayoutMixin):
    """Bölgedeki çalışma kütüphanesi / etüt merkezi. Tutor'ın kardeşi olan üçüncü
    bir tedarik tarafı (supply-side) entity'si: konumu (lat/lng), değerlendirme
    (Bayesian sıralama), çalışma saatleri ve (sonraki fazlarda) ücretli deneme
    oturumları + çalışma alanı rezervasyonu vardır. Admin küratörlüğünde yönetilir."""

    __tablename__ = "libraries"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Public işletme iletişim bilgisi (anti-disintermediation maskesi uygulanmaz —
    # kütüphaneler küratörlü işletmelerdir, iletişim açıkça gösterilir).
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    website: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # cover_url = geniş kapak/banner (16:9); logo_url = kurum logosu (1:1).
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Baz konum ("yakınımdaki kütüphaneler" haritası / Haversine araması).
    # location_text = yapısal alanlardan ELDE EDİLEN tam adres (gösterim + yol tarifi).
    location_text: Mapped[str | None] = mapped_column(String(400), nullable=True)
    location_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    location_lng: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    # Google Haritalar yer kimliği (place_id) — varsa "Haritada Görüntüle" işletmenin
    # gerçek Google profil sayfasını açar (yalnız pin değil). Veri setinden gelir;
    # elle eklenen kayıtlarda boş olabilir (o zaman ad/koordinatla aranır).
    google_place_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Yapısal adres — operatör/admin elle girer (geocode otomatik doldurmaz).
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)          # İl
    district: Mapped[str | None] = mapped_column(String(100), nullable=True)      # İlçe
    neighborhood: Mapped[str | None] = mapped_column(String(150), nullable=True)  # Mahalle
    street: Mapped[str | None] = mapped_column(String(200), nullable=True)        # Sokak/Cadde
    building_no: Mapped[str | None] = mapped_column(String(30), nullable=True)    # Kapı No

    # Çalışma alanı (masa) kapasitesi — saatlik koltuk rezervasyonunda kontenjan.
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Çalışma alanı saatlik ücreti (₺/saat). Doluysa + kapasite varsa rezervasyon açık.
    study_hourly_price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)

    # str-enum (LibraryStatus) değerleri saklanır; ayrı PG enum tipi yaratmamak için
    # String kolon (karşılaştırmalar str-enum olduğundan sorunsuz).
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'ACTIVE'")
    )
    # Self-kayıt reddedilirse admin'in gerekçesi (operatör panelinde gösterilir).
    rejection_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    rating_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    rating_sum: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    # Küratörleyen admin (denetim için; opsiyonel).
    created_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )

    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('simple', tr_normalize("
            "coalesce(name, '') || ' ' || coalesce(description, '')))",
            persisted=True,
        ),
        nullable=True,
    )

    hours: Mapped[list["LibraryHours"]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        order_by="LibraryHours.weekday",
    )
    amenity_links: Mapped[list["LibraryAmenity"]] = relationship(
        back_populates="library", cascade="all, delete-orphan"
    )
    reviews: Mapped[list["LibraryReview"]] = relationship(
        back_populates="library", cascade="all, delete-orphan"
    )
    images: Mapped[list["LibraryImage"]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        order_by="LibraryImage.sort_order, LibraryImage.id",
    )

    __table_args__ = (
        Index(
            "uq_libraries_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_libraries_search_vector", "search_vector", postgresql_using="gin"),
        Index("ix_libraries_status", "status"),
    )


class LibraryHours(Base):
    """Bir kütüphanenin haftalık açılış/kapanış saatleri (gün başına tek satır).
    ``is_closed`` o gün tamamen kapalıysa True; aksi halde open/close dakika (gece
    yarısından itibaren) doludur. TutorAvailability ile aynı dakika kuralı."""

    __tablename__ = "library_hours"

    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 0=Pazartesi … 6=Pazar (Python date.weekday()).
    weekday: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    is_closed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    open_minute: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    close_minute: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    library: Mapped["Library"] = relationship(back_populates="hours")

    __table_args__ = (
        CheckConstraint(
            "weekday >= 0 AND weekday <= 6", name="ck_library_hours_weekday"
        ),
        CheckConstraint(
            "is_closed OR (open_minute >= 0 AND close_minute <= 1440 "
            "AND close_minute > open_minute)",
            name="ck_library_hours_range",
        ),
        Index(
            "uq_library_hours_day",
            "library_id",
            "weekday",
            unique=True,
        ),
    )


class LibraryAmenity(Base):
    """Kütüphane olanağı/etiketi (wifi, sessiz_alan, kafeterya, otopark, priz...).
    Serbest etiket; katalog filtrelemesi ve profil rozetleri için."""

    __tablename__ = "library_amenities"

    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), primary_key=True
    )
    amenity: Mapped[str] = mapped_column(String(50), primary_key=True)

    library: Mapped["Library"] = relationship(back_populates="amenity_links")

    __table_args__ = (Index("ix_library_amenities_amenity", "amenity"),)


class LibraryImage(Base, TimestampMixin):
    """Kütüphane galeri fotoğrafı (One-to-Many; çalışma salonu, kafeterya, giriş…).
    Görsel object storage'a (MinIO/S3) yüklenir; burada yalnız public URL tutulur.
    ``sort_order`` küçükten büyüğe galeri sırasını verir (admin sürükle-bırak)."""

    __tablename__ = "library_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    caption: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    library: Mapped["Library"] = relationship(back_populates="images")


class LibraryReview(Base, TimestampMixin, SoftDeleteMixin, ModeratableMixin):
    """Bir kütüphaneye öğrenci değerlendirmesi. Tutor review'lerinin aksine booking
    ile gated DEĞİLDİR (kütüphaneler herkese açık fiziksel mekânlar) ama öğrenci
    başına kütüphane başına tek aktif değerlendirme tutulur. ``library.rating_sum/
    rating_count`` agregeleri servis katmanında güncellenir."""

    __tablename__ = "library_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False
    )
    # index: öğrencinin kütüphane yorumları + "daha önce yorumlamış mı" kontrolü.
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Karma puanlama: yorumu HERKES yazabilir ama yıldız ortalaması/Bayesian sıralamaya
    # yalnız "doğrulanmış ziyaretçi" (ATTENDED deneme/çalışma kaydı olan) sayılır.
    # Bu bayrak, değerlendirmenin library.rating_sum/rating_count agregesine katkı verip
    # vermediğini tutar: oluştururken doğrulanmışsa true; öğrenci sonradan katılırsa
    # promote edilir (bkz. services/library_service.promote_reviews_for_visitor).
    counts_to_rating: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    library: Mapped["Library"] = relationship(back_populates="reviews")
    client: Mapped["Client"] = relationship()

    __table_args__ = (
        CheckConstraint(
            "rating BETWEEN 1 AND 5", name="ck_library_reviews_rating_range"
        ),
        Index(
            "uq_library_reviews_client_active",
            "library_id",
            "client_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_library_reviews_library", "library_id"),
    )
