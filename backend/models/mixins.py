from __future__ import annotations

import datetime

from decimal import Decimal

from sqlalchemy import DateTime, Integer, Numeric, String, func, text
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column

from core.crypto import EncryptedString


class NameMixin:
    first_name: Mapped[str] = mapped_column(String(75), nullable=False)
    last_name: Mapped[str] = mapped_column(String(75), nullable=False)
    username: Mapped[str] = mapped_column(String(50), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Kimlik bütünlüğü: ad-soyad ve kullanıcı adı serbestçe değiştirilemez. İlk
    # değişiklik serbest; ikinci ve sonrası admin onayı + gerekçe gerektirir
    # (bkz. name_change_request + name_change_service).
    name_change_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    username_change_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    @hybrid_property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @full_name.inplace.expression
    @classmethod
    def _full_name_expression(cls):
        return func.concat(cls.first_name, " ", cls.last_name)


class TimestampMixin:
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class EmailVerificationMixin:
    """E-posta doğrulama durumu. ``email_verified_at`` doluysa adres doğrulanmıştır.
    ``email_verified`` türetilmiş bool, şemalarda (UserOut) doğrudan sunulur."""

    email_verified_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None


class PhoneVerificationMixin:
    """Telefon doğrulama durumu. ``phone`` (normalize) + ``phone_verified_at`` doluysa
    numara SMS OTP ile doğrulanmıştır. Numara değişince doğrulama düşer.
    ``phone_verified`` türetilmiş bool, şemalarda (UserOut) doğrudan sunulur."""

    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    phone_verified_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    @property
    def phone_verified(self) -> bool:
        return self.phone_verified_at is not None


class LastSeenMixin:
    last_seen_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class AuthVersionMixin:
    """Oturum sürümü — İP-3 §6: BÜTÜN giriş hesabı modellerinde bulunur.

    Şifre değişimi, şifre sıfırlaması ve hesap kapatma sürümü artırır; access
    token'daki ``auth_ver`` claim'i `api/deps.get_current_user`'da bu kolonla
    karşılaştırılır — eski sürümlü token, denylist ya da doğal süre dolumunu
    beklemeden ANINDA 401 alır. Rol istisnası yoktur (eskiden yalnız kuryede
    denetleniyordu; o istisna kaldırıldı).
    """

    auth_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )


class ModeratableMixin:
    """Yönetim tarafından gizlenebilen kullanıcı içeriği (yorumlar).

    Üç yorum türü de (ders, ürün, kütüphane) aynı ihtiyaca sahiptir: şikayet
    gelir, admin inceler, uygunsuz içeriği yayından kaldırır. SİLMEK yerine
    GİZLEMEK tercih edilir — kayıt kanıt olarak durur (aynı kullanıcı tekrar
    şikayet edilirse geçmişi görünür) ve karar geri alınabilir.

    ``deleted_at``'ten farkı: silme kullanıcının kendi iradesidir, gizleme
    yönetim kararıdır; gerekçesi ve kararı veren admin kayda geçer.
    """

    hidden_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Kararı veren admin (admins ayrı tablo → FK yok, salt iz; audit_log deseni).
    hidden_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Kullanıcıya gösterilebilecek kısa gerekçe (şikayet çözümünden gelir).
    hidden_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)

    @property
    def is_hidden(self) -> bool:
        return self.hidden_at is not None


class PayoutMixin:
    """Para alan tarafın (eğitmen/kütüphane) ödeme/escrow alma bilgisi.

    Kimlik doğrulamayı sağlayıcı (iyzico) yapar; biz IBAN'ı toplar, sağlayıcıya alt üye
    işyeri olarak iletir, sonucu (``sub_merchant_key`` + ``payout_status``) saklarız.
    TCKN KALICI SAKLANMAZ — yalnız son4 (``identity_last4``) tutulur; tam TCKN
    onboarding sırasında sağlayıcıya iletilir. Para iyzico'dan IBAN'a gider; bizde kasa yok.
    """

    # DB'de ŞİFRELİ (EncryptedString/Fernet), Python tarafı düz metinle çalışır.
    # TCKN şifreliyken IBAN düz metin duruyordu; oysa IBAN da ad-soyadla birlikte
    # doğrudan finansal kimlik verisidir ve bir veritabanı sızıntısında para
    # hedefini değiştirmek için tek başına yeterli bilgidir.
    # Uzunluk: IBAN 34 karaktere kadar; Fernet token'ı ~150 karaktere şişer.
    iban: Mapped[str | None] = mapped_column(EncryptedString(255), nullable=True)
    sub_merchant_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # NONE (bilgi yok) | PENDING (sağlayıcıda onay bekliyor) | ACTIVE | REJECTED
    payout_status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default="NONE"
    )
    identity_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    payout_updated_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Komisyon promosyon override (bitiş tarihli); yoksa global PLATFORM_COMMISSION_RATE.
    commission_rate_override: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 4), nullable=True
    )
    commission_override_until: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
