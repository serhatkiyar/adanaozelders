from __future__ import annotations

import datetime
import decimal
import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from core.storage_types import PrivateAsset

#: Formdaki deneyim seçenekleri — serbest metin değil, kapalı liste.
EXPERIENCE_CHOICES = ("universite-ogrencisi", "0-2", "3-5", "5+")

#: Ders biçimi — kalıcı `models.tutor.TeachingMode` ile aynı sözlük.
TEACHING_MODE_CHOICES = ("ONLINE", "IN_PERSON", "BOTH")


class TutorPreApplicationProfileIn(BaseModel):
    """İlan dosyasının isteğe bağlı kısmı.

    Formun alt bölümleri (profil, ders bilgileri, eğitim) buradan gelir;
    alanların hepsi None olabilir — başvuru bunlarsız da geçerlidir.
    """

    headline: str | None = Field(default=None, max_length=255)
    bio: str | None = Field(default=None, max_length=2000)
    intro_video_url: str | None = Field(default=None, max_length=500)
    teaching_mode: str | None = Field(default=None)
    hourly_rate: decimal.Decimal | None = Field(default=None, ge=0, le=100000)
    availability_note: str | None = Field(default=None, max_length=300)
    education_note: str | None = Field(default=None, max_length=300)

    @field_validator("teaching_mode")
    @classmethod
    def _known_mode(cls, value: str | None) -> str | None:
        if value is not None and value not in TEACHING_MODE_CHOICES:
            raise ValueError("geçersiz ders biçimi")
        return value

    @field_validator("intro_video_url")
    @classmethod
    def _check_intro_video(cls, value: str | None) -> str | None:
        """`schemas.tutor` ile AYNI kural: https + YouTube/Vimeo.

        Kopya olmasının sebebi, oradaki doğrulayıcının bir eğitmen profili
        şemasına bağlı olması; iki yüzeyin kuralı ayrışırsa lead'den gelen
        adres profile taşınamaz hâle gelir. Kural değişirse İKİSİ birden
        değişmeli.
        """
        if value is None:
            return None
        url = value.strip()
        if not url:
            return None
        if not re.match(r"^https://", url, re.IGNORECASE):
            raise ValueError("Video bağlantısı https:// ile başlamalıdır")
        allowed = ("youtube.com", "www.youtube.com", "youtu.be", "vimeo.com")
        host = re.sub(r"^https://", "", url, flags=re.IGNORECASE).split("/")[0].lower()
        if host not in allowed:
            raise ValueError("Yalnızca YouTube veya Vimeo bağlantısı desteklenir")
        return url

    @field_validator("headline", "bio", "availability_note", "education_note")
    @classmethod
    def _trim(cls, value: str | None) -> str | None:
        """Baştaki/sondaki boşlukları atar; boş kalan alan serviste None olur."""
        return value.strip() if value is not None else None


class TutorPreApplicationIn(TutorPreApplicationProfileIn):
    full_name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=10, max_length=20)
    # İsteğe bağlı: lansmanda kayıt daveti göndermek için.
    email: EmailStr | None = Field(default=None, max_length=255)
    # Serbest metin ders alanı virgül/satır sonundan bölünüp buraya gelir.
    # Kapalı çip listesi kalktığı için sınırlar gevşetildi (10 → 20 öğe):
    # "matematik, fizik, kimya, biyoloji…" yazan biri 422 yememeli.
    subjects: list[str] = Field(min_length=1, max_length=20)
    district: str | None = Field(default=None, max_length=50)
    experience: str | None = Field(default=None)
    note: str | None = Field(default=None, max_length=2000)
    # KVKK aydınlatma onayı sunucuda da zorunludur (endpoint 422 verir);
    # varsayılan False: alan gönderilmezse onay VARSAYILMAZ.
    kvkk_accepted: bool = False

    @field_validator("subjects")
    @classmethod
    def _clean_subjects(cls, items: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in items:
            label = " ".join(item.split())
            if not label:
                continue
            if len(label) > 100:
                raise ValueError("branş adı en fazla 100 karakter olabilir")
            if label not in cleaned:
                cleaned.append(label)
        if not cleaned:
            raise ValueError("en az bir ders seçilmelidir")
        # `subjects` kolonu String(600); istemciye güvenilmez, birleşik uzunluk
        # burada da sınırlanır (aksi hâlde 20 × 100 karakter taşardı).
        if len(", ".join(cleaned)) > 600:
            raise ValueError("verdiğin dersler çok uzun, kısaltır mısın")
        return cleaned

    @field_validator("experience")
    @classmethod
    def _known_experience(cls, value: str | None) -> str | None:
        if value is not None and value not in EXPERIENCE_CHOICES:
            raise ValueError("geçersiz deneyim seçimi")
        return value


class TutorPreApplicationOut(BaseModel):
    detail: str


class PreApplicationDocumentOut(BaseModel):
    """Ek belge. `url` private/ anahtarıdır; `PrivateAsset` yanıtta kısa ömürlü
    imzalı adrese çevirir."""

    url: PrivateAsset
    name: str


class MatchedSubjectOut(BaseModel):
    """Ön başvurudaki serbest metnin çözüldüğü kanonik ders."""

    id: int
    slug: str
    name: str
    #: Adayın yazdığı ham metin — eşlemenin neyden geldiği görünsün.
    source_text: str


class AdminTutorPreApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    phone: str
    email: str | None = None
    subjects: str
    district: str | None = None
    experience: str | None = None
    note: str | None = None
    documents: list[PreApplicationDocumentOut] | None = None
    status: str
    kvkk_accepted_at: datetime.datetime
    created_at: datetime.datetime
    # İlan dosyası (formun isteğe bağlı bölümleri). `photo_url` de `private/`
    # anahtarıdır — `PrivateAsset` yanıtta imzalar.
    photo_url: PrivateAsset | None = None
    headline: str | None = None
    bio: str | None = None
    intro_video_url: str | None = None
    teaching_mode: str | None = None
    hourly_rate: decimal.Decimal | None = None
    availability_note: str | None = None
    education_note: str | None = None


class PreApplicationStatusIn(BaseModel):
    """Admin durum geçişi. Geçerli değerler modeldeki enum'dan doğrulanır."""

    status: str = Field(min_length=1, max_length=16)

    @field_validator("status")
    @classmethod
    def _known_status(cls, value: str) -> str:
        from models.tutor_pre_application import PreApplicationStatus

        if value not in {s.value for s in PreApplicationStatus}:
            raise ValueError("geçersiz durum")
        return value
