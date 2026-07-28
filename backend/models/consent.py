"""Kullanıcı rıza kayıtları (KVKK / ETK ispat yükü).

Kayıt formundaki onay kutusu stateless'tı: kullanıcı "ben onaylamadım" dediğinde
gösterilecek hiçbir kayıt yoktu. KVKK'da **ispat yükü veri sorumlusundadır**;
ayrıca metin sürümü değiştiğinde eski onayın hangi metne verildiği bilinmiyordu.

Her satır tek bir belgeye verilen tek bir onaydır (KVKK aydınlatma, kullanım
koşulları, gizlilik politikası, açık rıza…). Onay GERİ ALINABİLİR: yeni bir
`granted=False` satırı yazılır, eski satır SİLİNMEZ — geçmiş denetlenebilir
kalmalıdır.
"""
from __future__ import annotations

import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class ConsentDoc:
    """`doc_key` için bilinen değerler (frontend legalContent.ts ile eşleşir)."""

    KVKK = "kvkk"
    TERMS = "terms"
    PRIVACY = "privacy"
    DISTANCE_SALES = "distance-sales"
    #: Pazarlama izni (ETK/İYS) — işlemsel iletiden ayrıdır.
    MARKETING_EMAIL = "marketing-email"
    MARKETING_SMS = "marketing-sms"


class UserConsent(Base):
    __tablename__ = "user_consents"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Sahiplik projenin ortak deseni: birleşik kullanıcı tablosu yok.
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)

    #: Hangi belge (bkz. ConsentDoc).
    doc_key: Mapped[str] = mapped_column(String(40), nullable=False)
    #: Onaylanan metnin sürümü — legalContent.ts'teki `updatedAt` ("YYYY-MM-DD").
    #: Metin değişince yeni onay istenebilmesi için saklanır.
    doc_version: Mapped[str] = mapped_column(String(20), nullable=False)

    #: False = onay geri alındı (satır silinmez, yenisi yazılır).
    granted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )

    #: İspat bağlamı. IP ve user-agent kişisel veridir; yalnız ispat amacıyla
    #: tutulur ve hesap anonimleştirmesinde temizlenir.
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # "Bu kullanıcının şu belgeye verdiği en güncel onay" sorgusu.
        Index("ix_user_consents_owner_doc", "role_id", "user_id", "doc_key"),
    )
