from __future__ import annotations

import datetime

from pydantic import BaseModel, EmailStr, Field, model_validator

from models.tutor import Gender


class Token(BaseModel):
    """Oturum yanıtı — YALNIZ access token.

    Refresh token bilinçli olarak burada yoktur: ``httpOnly`` çerezde taşınır
    (bkz. ``core/cookies.py``). Gövdede dönseydi JavaScript onu okuyup saklamak
    zorunda kalırdı ve tek bir XSS 30 günlük hesap devrine yeterdi.
    """

    access_token: str
    token_type: str = "bearer"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=75)
    last_name: str = Field(min_length=1, max_length=75)
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    # KVKK aydınlatma + kullanım koşulları + gizlilik politikası onayı.
    # İstemci, onayladığı metinlerin sürümünü (legalContent.ts `updatedAt`,
    # "YYYY-MM-DD") gönderir; sunucu bunu `user_consents`'a yazar. İspat yükü
    # veri sorumlusunda olduğundan onay kaydı OLMADAN kayıt kabul edilmez.
    consent_version: str = Field(
        min_length=4, max_length=20, pattern=r"^\d{4}-\d{2}-\d{2}$"
    )


class MessageResponse(BaseModel):
    detail: str


class EmailVerifyConfirm(BaseModel):
    token: str = Field(min_length=1, max_length=512)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


class AccountDeleteRequest(BaseModel):
    """Hesap silme onayı. İKİ KOL, biri seçilir.

    Onay her hâlükârda istenir: ele geçirilmiş bir oturumun hesabı yok etmesini
    zorlaştırır (geri alınamaz işlem). Kanıtın BİÇİMİ hesaba göre değişir:

    ``password``  Parolalı hesap — bugünkü davranış, birebir korunur.
    ``token``     Parolasız (Google ile açılmış) hesap. Parola sorulamayacağı
                  için onay e-posta kutusuna gönderilen tek kullanımlık bir
                  bağlantıyla verilir. Bu kol olmasaydı Google ile açılan hesap
                  KVKK silme hakkını hiç kullanamazdı.

    İkisi birden gönderilemez: hangi kanıtın geçerli sayıldığı belirsiz kalırdı
    ve uç, hesabın durumuna göre doğru kolu seçmek yerine ilk dolu alana bakma
    eğilimine girerdi.
    """

    password: str | None = Field(default=None, min_length=1, max_length=128)
    token: str | None = Field(default=None, min_length=1, max_length=256)

    @model_validator(mode="after")
    def _tek_kanit(self) -> "AccountDeleteRequest":
        if bool(self.password) == bool(self.token):
            raise ValueError("Parola ya da onay bağlantısı; ikisinden tam olarak biri.")
        return self
