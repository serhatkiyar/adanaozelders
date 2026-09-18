from __future__ import annotations

import datetime
import enum
import re
from decimal import Decimal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from core.slug import tutor_slug
from models.tutor import Gender, TutorStatus
from schemas.education import EducationOut
from schemas.user import UserOut


class SubjectLevelIn(BaseModel):
    """Bir derste verilen seviyeler.

    `subject_id` kanonik ders kimliğidir (`GET /subjects`). Seviyeler o dersin
    merdivenlerinden gelmelidir — `Matematik`'e `b1` (CEFR) verilemez.
    """

    subject_id: int
    level_ids: list[int] = Field(default_factory=list, max_length=20)


class AvailabilityIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start_minute: int = Field(ge=0, le=1440)
    end_minute: int = Field(ge=0, le=1440)

    @model_validator(mode="after")
    def _check_range(self) -> "AvailabilityIn":
        if self.end_minute <= self.start_minute:
            raise ValueError("end_minute must be greater than start_minute")
        return self


class AvailabilityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    weekday: int
    start_minute: int
    end_minute: int


class TutorSort(str, enum.Enum):
    RELEVANCE = "relevance"
    PRICE_ASC = "price_asc"
    PRICE_DESC = "price_desc"
    RATING_DESC = "rating_desc"


class TeachingMode(str, enum.Enum):
    ONLINE = "ONLINE"  # Uzaktan
    IN_PERSON = "IN_PERSON"  # Yüzyüze
    BOTH = "BOTH"  # Her ikisi


class TutorProfileUpdate(BaseModel):
    headline: str | None = Field(default=None, max_length=255)
    bio: str | None = None
    # İlanda "Ders Hakkında" — dersin nasıl işlediği / metodoloji.
    lesson_info: str | None = Field(default=None, max_length=2000)

    # BAŞLIK UZUNLUĞU BURADA (PATCH) ARTIK ZORLANMIYOR (5 Eyl 2026).
    #
    # Eskiden kısa bir başlık Pydantic seviyesinde reddediliyordu. Sihirbaz her
    # adımda `PATCH /tutors/me` yaptığı için bu, "sayaç uyarır ama engellemez"
    # kararıyla çakışıyordu: kullanıcı adımı geçemiyor ve bizim yazdığımız açık
    # mesaj yerine ham şema hatası görüyordu — hem engel hem kötü mesaj.
    #
    # Taslak artık serbestçe kaydedilir; eşik TEK yerde, yayın kapısında yaşar
    # (`services/tutor_service.submit_for_approval`). İstemci tarafında
    # `lib/metin.ts::kelimeSayaci` aynı sabiti okuyup canlı sayaç gösterir.
    hourly_rate: Decimal | None = Field(
        default=None, ge=0, max_digits=10, decimal_places=2
    )
    teaching_mode: TeachingMode | None = None
    # Cinsiyet İLANIN alanıdır, hesabın değil: `Tutor` satırında durur ve
    # aramanın sert filtresidir. Bu yüzden `PATCH /users/me` yerine buraya
    # yazılır — avatar için verilen ters karar ("hesabın alanı, ilanın değil")
    # bilinçli olarak simetriktir. Kolon zaten var, migration gerekmez.
    # İSTEĞE BAĞLI kalır: yasal metin "cinsiyet (isteğe bağlı)" diyor.
    gender: Gender | None = None
    # Tanıtım videosu (YouTube/Vimeo). Boş string → temizle (None'a çevrilir).
    intro_video_url: str | None = Field(default=None, max_length=500)
    # İlk ders ücretsiz mi (opt-in/opt-out).
    first_lesson_free: bool | None = None

    @field_validator("intro_video_url")
    @classmethod
    def _check_intro_video(cls, v: str | None) -> str | None:
        # Boş bırakılırsa videoyu temizle. Yalnızca https + YouTube/Vimeo kabul
        # edilir (gömülü oynatıcı; rastgele iframe XSS/phishing riskini önler).
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if not re.match(r"^https://", v, re.IGNORECASE):
            raise ValueError("Video bağlantısı https:// ile başlamalıdır")
        allowed = ("youtube.com", "www.youtube.com", "youtu.be", "vimeo.com")
        host = re.sub(r"^https://", "", v, flags=re.IGNORECASE).split("/")[0].lower()
        if host not in allowed:
            raise ValueError("Yalnızca YouTube veya Vimeo bağlantısı desteklenir")
        return v
    # Yüzyüze ders için baz konum (serbest adres + harita koordinatı).
    location_text: str | None = Field(default=None, max_length=300)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    # İlçe (Adana) — onboarding'de seçilir; aramadaki "İlçe" filtresini besler.
    district: str | None = Field(default=None, max_length=80)
    # Verilirse eğitmenin ders/branş kümesini tümüyle değiştirir (replace).
    subjects: list[str] | None = Field(default=None, max_length=40)
    # Verilirse ders başına seviye seçimlerini tümüyle değiştirir (replace).
    # `subjects` ile BİRLİKTE gönderilmelidir: seviye verilen ders, bildirilen
    # dersler arasında değilse 422 döner (sessizce yutulmaz).
    subject_levels: list["SubjectLevelIn"] | None = Field(default=None, max_length=40)
    # Verilirse haftalık müsaitlik pencerelerini tümüyle değiştirir (replace).
    availability: list[AvailabilityIn] | None = Field(default=None, max_length=60)


class TutorOut(UserOut):
    status: TutorStatus
    headline: str | None = None
    bio: str | None = None
    lesson_info: str | None = None
    intro_video_url: str | None = None
    first_lesson_free: bool = True
    hourly_rate: Decimal | None = None
    teaching_mode: TeachingMode | None = None
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    location_text: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    district: str | None = None
    subjects: list[str] = []
    #: Ders başına seçilen seviyeler: {subject_id: [level_id, ...]}.
    #: Anahtar JSON'da dize olur; istemci `Number(k)` ile çözer.
    subject_levels: dict[int, list[int]] = {}
    availability: list[AvailabilityOut] = []
    #: Kök ilan adresi (`/lgs-yks-matematik-seyhan`) — ilan ilk yayına girince
    #: sabitlenir; hiç yayınlanmamış ilanda None (bkz. `seo_slug_service`).
    url_slug: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def slug(self) -> str:
        """Kanonik SEO slug: ``isim-{id}`` — soyad İÇERMEZ (ÜK-9).

        `TutorOut` yasal adı taşır (kendi profili/admin) ama slug HER YERDE
        aynı olmalı: farklı üretilseydi eğitmenin kendi ekranındaki bağlantı
        public URL'den ayrışırdı.
        """
        return tutor_slug(self.id, self.first_name)


class TutorSearchOut(BaseModel):
    """PUBLIC eğitmen şeması — arama, vitrin ve profil detayı.

    Soyad TAŞIMAZ (ÜK-9): bu şema kimlik doğrulaması istemeyen uçlardan dönüyor
    (`GET /tutors/search`, `/featured`, `/{id|slug}`), yani yanıtı herkes
    görebiliyor. `display_name` modeldeki property'den gelir
    (`models/mixins.py::NameMixin`).

    `TutorOut` (yasal ad taşır) yalnız admin uçlarında ve eğitmenin KENDİ
    profilinde (`/tutors/me`) kullanılıyor; oralara dokunulmadı.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    display_name: str
    avatar_url: str | None = None
    headline: str | None = None
    bio: str | None = None
    # "Ders Hakkında" — yalnız profil (detay) yanıtında anlamlı; listede gösterilmez.
    lesson_info: str | None = None
    # Tanıtım videosu — yalnız profil (detay) yanıtında doldurulur.
    intro_video_url: str | None = None
    # İlk ders ücretsiz mi? Kart/profilde rozet ve ücretsiz talep akışı için.
    first_lesson_free: bool = True
    hourly_rate: Decimal | None = None
    teaching_mode: TeachingMode | None = None
    gender: Gender | None = None
    birth_date: datetime.date | None = None
    last_seen_at: datetime.datetime | None = None
    # Güven sinyalleri: hesabın açılış tarihi ("… tarihinden beri üye") ve
    # tamamlanmış ders sayısı (sosyal kanıt). Profilde rozet olarak gösterilir.
    created_at: datetime.datetime | None = None
    completed_lessons: int = 0
    # Ortalama ilk-yanıt süresi (saniye); mesajlaşma verisinden hesaplanır. Yalnız
    # profil (detay) yanıtında doldurulur, arama listesinde None (N+1'den kaçınma).
    avg_response_seconds: int | None = None
    rating_count: int
    rating_average: float | None = None
    bayesian_score: float
    location_text: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    district: str | None = None
    # "Yakınımdaki" araması yapıldığında doldurulur (km).
    distance_km: float | None = None
    subjects: list[str] = []
    availability: list[AvailabilityOut] = []
    educations: list[EducationOut] = []
    # Ödeme hesabı (alt üye) onaylı → "Kimliği Doğrulanmış" rozeti.
    identity_verified: bool = False
    #: Kök ilan adresi — site içi bütün eğitmen linkleri buna gider. Eski
    #: `/egitmenler/<slug>` adresi yalnız yönlendirme olarak yaşar.
    url_slug: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def slug(self) -> str:
        """Kanonik SEO slug: ``isim-{id}`` — soyad İÇERMEZ (ÜK-9)."""
        return tutor_slug(self.id, self.display_name)
