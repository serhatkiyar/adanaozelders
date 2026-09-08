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
    avatar_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Kimlik bütünlüğü: ad-soyad serbestçe değiştirilemez. İlk değişiklik
    # serbest; ikinci ve sonrası admin onayı + gerekçe gerektirir
    # (bkz. name_change_request + name_change_service).
    #
    # `username` kolonu 5 Eyl 2026'da KALDIRILDI: giriş e-posta ile yapılıyor,
    # profil URL'i id/slug ile kuruluyor, hiçbir sosyal yüzeyde görünmüyordu.
    # Nöbetçi: tests/test_kullanici_adi_kaldirildi.py
    name_change_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    @hybrid_property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @full_name.inplace.expression
    @classmethod
    def _full_name_expression(cls):
        return func.concat(cls.first_name, " ", cls.last_name)

    @property
    def display_name(self) -> str:
        """PUBLIC yüzeylerde gösterilen ad — soyad TAŞIMAZ (ÜK-9).

        `full_name` ile farkı bir görüntüleme tercihi değil, KAPSAM ayrımıdır:

        ``full_name``     Yasal ad. Ödeme/KYC (iyzico alt üye işyeri), fatura,
                          admin panelleri, hesap sahibinin kendi ayarları ve
                          taraflar arasında sözleşme ilişkisi kurulmuş akışlar
                          (rezervasyon, mesajlaşma, sipariş).
        ``display_name``  Herkese açık yüzeyler: eğitmen kartı ve profili, SEO
                          başlıkları, JSON-LD, yorum yazarı adı, slug.

        Kesme SUNUCUDA yapılır. Arayüzde `split(" ")[0]` yazmak kozmetik kalır:
        soyad ağ yanıtında, HTML kaynağında, JSON-LD'de ve URL'de durmaya devam
        eder — kart tam olarak bu durumdaydı.

        KİMLİK İDDİASI TAŞIMAZ (`docs/kimlik-ve-diploma-dogrulama-plani.md`
        §A6): "Kimliği Doğrulanmış" rozeti bu ada değil, `payout_status`a
        (iyzico MERNIS/IBAN kontrolü) bağlıdır ve öyle kalmalıdır. Rozet
        kimliğin DOĞRULANDIĞINI söyler, kimliğin ne olduğunu değil.
        """
        return self.first_name


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


class PasswordMixin:
    """Parolanın VARLIĞINI bildirir. Kolon burada DEĞİL, her modelde durur.

    ``hashed_password`` beş kullanıcı tablosunda da NULL olabilir: Google ile
    açılan hesabın parolası yoktur. Sentinel bir hash (``"!"``) yerine NULL
    seçilmesinin ÖLÇÜLMÜŞ sebebi:

        bcrypt.checkpw(b"sifre", b"!")  ->  ValueError: Invalid salt

    ve ``core/security.verify_password`` bu istisnayı yakalamaz. Sentinel bugün
    depoda iki yerde yaşıyor (``api/deps.get_shopping_client`` gölge satırı ve
    ``account_deletion_service.anonymize_account``) ama ikisi de
    ``auth_service.authenticate``'in sorgusundan zaten düşen satırlardır —
    gölge ``_exclude_shadow`` ile, silinmiş hesap ``deleted_at`` ile. Google
    hesabı bunun TERSİdir: canlı, silinmemiş, gölge değil, yani authenticate'in
    tam da bulacağı satır. Sentinel seçilseydi o e-postayla bir parola denemesi
    401 değil **500** dönerdi ve "var olmayan e-posta 401 / Google hesabı 500"
    ayrımı bir hesap-varlığı yan kanalı olurdu.

    Parolasız hesabın kırdığı üç akış açıkça kapatılmıştır:
    ``auth_service.authenticate``, ``auth_service.change_password`` ve hesap
    silme ucu (``api/routers/auth.py``). Nöbetçi:
    ``tests/test_parolasiz_hesap.py``.

    ``has_password`` şemada (``UserOut``) sunulur: Ayarlar ekranı parolasız
    hesaba "Şifre değiştir" formu göstermemelidir — o form hiçbir zaman
    çalışmazdı.
    """

    @property
    def has_password(self) -> bool:
        return self.hashed_password is not None


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
