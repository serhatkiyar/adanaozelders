"""Eğitmenin siteye YÜKLEDİĞİ tanıtım videosu (YouTube/Vimeo bağlantısı değil).

Bağlantı hâlâ `tutors.intro_video_url`da durur; bu tablo doğrudan yüklenen
videonun yaşam döngüsünü taşır. Tek kaynak kuralı: eğitmenin ya ACTIVE bir
upload'ı vardır ya da `intro_video_url` doludur — ikisi birden değil
(`services/tutor_video_service.activate` ve `tutor_service.update_profile`).

Durumlar ``String(16)`` olarak saklanır (PG enum tipi DEĞİL): liste uzun ve
değişebilir, ``ALTER TYPE`` migration'ından kaçınılır — `TutorEducation
.verification_status` ile aynı yaklaşım.

Atomik değişim: eski video, yeni video işlenip (gerekirse onaylanıp) ACTIVE
olana kadar ACTIVE kalır. Aktivasyon eskiyi REPLACED yapar; nesneleri worker'ın
temizlik turu siler. Başarısız işleme eskiye hiç dokunmaz.
"""
from __future__ import annotations

import datetime
import enum

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class TutorIntroVideoStatus(str, enum.Enum):
    PENDING_UPLOAD = "PENDING_UPLOAD"  # imzalı adres verildi, tarayıcı yüklüyor
    UPLOADED = "UPLOADED"  # kaynak private bucket'ta; worker sırasında
    PROCESSING = "PROCESSING"  # worker aldı (lock_token)
    PENDING_REVIEW = "PENDING_REVIEW"  # işlendi, admin onayı bekliyor
    ACTIVE = "ACTIVE"  # profilde yayında
    REJECTED = "REJECTED"  # admin reddetti
    FAILED = "FAILED"  # doğrulama/işleme hatası
    REPLACED = "REPLACED"  # yeni video/bağlantı ile değiştirildi ya da eğitmen kaldırdı
    EXPIRED = "EXPIRED"  # yükleme hiç tamamlanmadı


#: Eğitmen başına aynı anda en fazla bir tane olabilen "yolda" kayıtlar.
IN_FLIGHT_STATUSES: tuple[str, ...] = (
    TutorIntroVideoStatus.PENDING_UPLOAD.value,
    TutorIntroVideoStatus.UPLOADED.value,
    TutorIntroVideoStatus.PROCESSING.value,
    TutorIntroVideoStatus.PENDING_REVIEW.value,
)

#: Nesneleri (kaynak, çıktı, poster) silinecek terminal durumlar.
CLEANUP_STATUSES: tuple[str, ...] = (
    TutorIntroVideoStatus.REJECTED.value,
    TutorIntroVideoStatus.FAILED.value,
    TutorIntroVideoStatus.REPLACED.value,
    TutorIntroVideoStatus.EXPIRED.value,
)

_IN_FLIGHT_SQL = ",".join(f"'{s}'" for s in IN_FLIGHT_STATUSES)


class TutorIntroVideo(Base, TimestampMixin):
    __tablename__ = "tutor_intro_videos"
    # `updated_at` sunucu tarafında (`onupdate=func.now()`) yazılır; flush sonrası
    # değeri RETURNING ile hemen al ki yanıt şeması (`to_own_out`) tembel yükleme
    # tetiklemesin (async oturumda `MissingGreenlet`).
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="PENDING_UPLOAD"
    )

    # Ham yükleme — `private/tutor-videos/{tutor_id}/{uuid}.bin`. Sunucu üretir;
    # istemci hiçbir uçta anahtar göndermez. Uzantı `.bin`: türüne güvenilmez.
    source_key: Mapped[str] = mapped_column(String(255), nullable=False)
    declared_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    declared_content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # İmzalı PUT adresinin son geçerlilik anı. `complete` bunu REDDETMEZ (imza
    # istek başında kontrol edilir, yavaş yükleme sonradan biter); yalnız
    # yetim PENDING_UPLOAD temizliğinin referansıdır.
    upload_expires_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # İşlenmiş çıktı — public `tutor-videos/{uuid}.mp4` + `.jpg`. Deneme başına
    # yeni uuid: iki worker aynı videoyu işlese bile anahtar çakışmaz.
    output_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    poster_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # Worker: deneme sayısı, alınma anı ve alan denemenin belirteci. Final
    # UPDATE `WHERE lock_token = ? AND status = 'PROCESSING'` ile yazılır; stale
    # geri almadan sonra geç biten deneme sonucu yazamaz.
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    processing_started_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    lock_token: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Hata: kod makine için, mesaj eğitmene gösterilen sade Türkçe.
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Moderasyon (admins ayrı tablo → FK yok, salt iz; `verified_by` deseni).
    reviewed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reviewed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Temizlik turu nesneleri sildikten sonra damgalar; satır denetim izi olarak kalır.
    objects_deleted_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # Eğitmen başına tek ACTIVE video. `tutors` tablosuna FK KONMADI:
        # döngüsel FK (tutors ↔ tutor_intro_videos) `use_alter` gerektirirdi.
        Index(
            "uq_tutor_intro_videos_active",
            "tutor_id",
            unique=True,
            postgresql_where=text("status = 'ACTIVE'"),
        ),
        # Eğitmen başına tek "yolda" video.
        Index(
            "uq_tutor_intro_videos_in_flight",
            "tutor_id",
            unique=True,
            postgresql_where=text(f"status IN ({_IN_FLIGHT_SQL})"),
        ),
        # Worker seçimi (UPLOADED, en eski önce) ve temizlik taramaları.
        Index("ix_tutor_intro_videos_status_created", "status", "created_at"),
    )

    @property
    def is_in_flight(self) -> bool:
        return self.status in IN_FLIGHT_STATUSES
