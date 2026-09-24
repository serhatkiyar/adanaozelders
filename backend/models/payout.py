"""Hakediş ödemesi kaydı — "kime ne kadar ödedim" defteri.

Neden gerekli: platform, eğitmen ve kütüphaneler adına para tahsil ediyor ama
onlara ödeme yapan HİÇBİR otomatik mekanizma yok. iyzico'nun pazaryeri (alt üye
işyeri) entegrasyonu açık değil ve banka sanal POS'larında zaten yoktur — para
tek hesaba, platforma gelir.

Bu tabloyla akış şöyle olur:
  1. Kazanç servisleri "bu kişiye toplam ne kadar borçluyuz"u hesaplar
     (ders + mağaza dijital + kütüphane geliri, komisyon düşülmüş).
  2. Buradaki kayıtların toplamı "şimdiye dek ne kadar ödedik"i verir.
  3. Fark = ödenmemiş bakiye.

Ödemenin kendisi banka havalesiyle ELLE yapılır; bu tablo yalnız kaydı tutar.
Otomatik ödemeye (sub-merchant) geçildiğinde de bu defter mutabakat için
gereklidir — o yüzden sağlayıcıdan bağımsız tasarlandı.
"""
from __future__ import annotations

import datetime
import enum

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from core.crypto import EncryptedString
from core.database import Base
from models.mixins import TimestampMixin


class PayeeType(str, enum.Enum):
    """Ödemeyi alan taraf. Kullanıcı tabloları ayrı olduğundan tip + id çifti."""

    TUTOR = "TUTOR"
    LIBRARY = "LIBRARY"


class PayoutRecord(Base, TimestampMixin):
    __tablename__ = "payout_records"

    id: Mapped[int] = mapped_column(primary_key=True)

    payee_type: Mapped[str] = mapped_column(String(10), nullable=False)
    payee_id: Mapped[int] = mapped_column(nullable=False)

    #: Ödenen tutar (net — komisyon zaten düşülmüş kazançtır).
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'TRY'")
    )

    #: Ödemenin yapıldığı IBAN — SNAPSHOT. Alıcı sonradan IBAN'ını değiştirirse
    #: geçmiş ödemenin nereye gittiği kaybolmamalı (mutabakat kanıtı).
    #: Şifreli saklanır — kaynak alan (`PayoutMixin.iban`) da şifreli; snapshot'ı
    #: düz metin bırakmak şifrelemeyi anlamsız kılardı (aynı IBAN burada okunurdu).
    iban_snapshot: Mapped[str | None] = mapped_column(
        EncryptedString(255), nullable=True
    )
    #: Banka havale/EFT referansı — dekontla eşleştirmek için.
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    paid_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    paid_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        # "Bu kişiye şimdiye dek ne kadar ödedik" sorgusu.
        Index("ix_payout_records_payee", "payee_type", "payee_id"),
        Index("ix_payout_records_paid_at", "paid_at"),
    )


class PayoutRequestStatus(str, enum.Enum):
    #: Öğretmen "Para çek" dedi, ödeme bekliyor.
    REQUESTED = "REQUESTED"
    #: Admin havaleyi yaptı ve deftere işledi (``payout_record_id`` bağlı).
    PAID = "PAID"
    CANCELLED = "CANCELLED"


class PayoutRequest(Base, TimestampMixin):
    """Öğretmenin para çekme talebi (kullanıcı kararı, 23 Eyl 2026).

    Para öğretmen "Para çek" diyene kadar platformda birikir; admin öğretmene
    ancak açık bir talep varken ödeme kaydedebilir. Talep, o anki ödenebilir
    bakiyenin TAMAMI içindir (Preply deseni — tutar seçilmez).
    """

    __tablename__ = "payout_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=False
    )
    #: Talep anındaki ödenebilir bakiye (sunucuda hesaplanır, istemciden gelmez).
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'TRY'")
    )
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'REQUESTED'")
    )
    payout_record_id: Mapped[int | None] = mapped_column(
        ForeignKey("payout_records.id", ondelete="SET NULL"), nullable=True
    )
    paid_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # Öğretmen başına tek açık talep; eşzamanlı iki "Para çek"in son sözü.
        Index(
            "uq_payout_requests_tutor_open",
            "tutor_id",
            unique=True,
            postgresql_where=text("status = 'REQUESTED'"),
        ),
        Index("ix_payout_requests_status", "status"),
    )
