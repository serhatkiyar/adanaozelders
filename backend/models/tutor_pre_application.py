"""Eğitmen ön başvurusu (lead) — hesapsız public formdan gelen kayıt.

Neden `tutors` tablosuna DRAFT satır değil: /kayit tam hesap açar (şifre,
e-posta doğrulama). Facebook gruplarından gelen trafikte bu sürtünme dönüşümü
öldürür; ön başvuru yalnız iletişim bilgisi toplar, hesap açma telefonla
aramadan SONRA olur. Şifre ve e-posta olmadığı için burada hesap da yoktur.

Soft-delete YOK: kayıt küçük ve düzdür; yaşam döngüsü tek `status` kolonunda
NEW → CONTACTED → CONVERTED/REJECTED olarak ilerler. KVKK silme talebi gelirse
kayıt hesap silme akışındaki disiplinle elle temizlenir.
"""
from __future__ import annotations

import datetime
import decimal
import enum

from sqlalchemy import DateTime, Index, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class PreApplicationStatus(str, enum.Enum):
    NEW = "NEW"
    CONTACTED = "CONTACTED"
    CONVERTED = "CONVERTED"
    REJECTED = "REJECTED"


class TutorPreApplication(Base, TimestampMixin):
    __tablename__ = "tutor_pre_applications"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    # E.164 (+905XXXXXXXXX) — uçta `phone_service.normalize_phone` zorunlu.
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    # İsteğe bağlı: lansmanda toplu kayıt daveti göndermek için. Doğrulanmaz
    # (hesap yok); yanlış yazılmışsa telefon görüşmesinde düzeltilir.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Virgülle ayrılmış branş etiketleri. Taksonomi frontend'te yaşar
    # (`examTree.ts`) ve kalıcı `TutorSubject` da serbest metindir — lead
    # kaydı için ilişkisel tablo kurulmaz.
    subjects: Mapped[str] = mapped_column(String(600), nullable=False)
    district: Mapped[str | None] = mapped_column(String(50), nullable=True)
    experience: Mapped[str | None] = mapped_column(String(20), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Diploma/sertifika ekleri: [{"url": "...", "name": "..."}] listesi.
    # URL'ler `private/` anahtarındadır; admin yanıtında `PresignPrivateUrls`
    # katmanı otomatik imzalar. En çok 3 dosya (uçta zorlanır) — lead kaydı
    # için ayrı dosya tablosu YAGNI.
    documents: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Aydınlatma metni onayının kanıtı; onaysız gönderim uçta 422 alır.
    kvkk_accepted_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'NEW'")
    )

    # ── İlan dosyası (isteğe bağlı bölümler) ─────────────────────────────
    #
    # Bunlar kalıcı `Tutor` alanlarının lead karşılığıdır: aday telefonla
    # aranıp hesabı açıldığında elle taşınır. Hepsi nullable, çünkü başvuru
    # ad + telefon + verilen derslerle tamamlanmış sayılır; gerisini yazmak
    # başvuru sahibinin tercihidir.
    #
    # Profil fotoğrafı `private/` altındadır, `avatars/` DEĞİL: anonim uçtan
    # public önek'e yazmak siteyi bedava görsel barındırmaya açardı.
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Kalıcı `Tutor` alanlarıyla AYNI adlar: aday hesaba dönüştürülürken
    # taşıma mekanik olsun (bugün elle yapılıyor).
    headline: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    # https + youtube/vimeo — kalıcı `Tutor.intro_video_url` ile aynı kural.
    intro_video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # ONLINE / IN_PERSON / BOTH — kalıcı `TeachingMode` ile aynı sözlük.
    teaching_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    hourly_rate: Mapped[decimal.Decimal | None] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    # "Hafta içi akşam, hafta sonu tam gün" gibi serbest metin. Haftalık
    # pencere modeli (`TutorAvailability`) lead aşaması için ağır.
    availability_note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Okul + bölüm tek satır; ilişkisel `TutorEducation` lead'de kurulmaz.
    education_note: Mapped[str | None] = mapped_column(String(300), nullable=True)

    __table_args__ = (
        # Admin listesi "önce bekleyenler" filtresiyle açılır; telefon ise
        # çift gönderim kontrolünün sıcak yoludur.
        Index("ix_tutor_pre_applications_status", "status"),
        Index("ix_tutor_pre_applications_phone", "phone"),
    )
