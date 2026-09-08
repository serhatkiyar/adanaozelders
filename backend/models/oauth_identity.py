from __future__ import annotations

import datetime

from sqlalchemy import DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class OAuthIdentity(Base, TimestampMixin):
    """Bir dış kimlik sağlayıcısındaki hesabın yerel hesabımıza bağı.

    ``(provider, subject)`` sağlayıcının verdiği KALICI kullanıcı kimliğidir
    (Google'da ``sub``). E-posta DEĞİL: kullanıcı Google hesabının adresini
    değiştirebilir, ``sub`` değişmez. Bağ e-postaya kurulsaydı adres değişimi
    hesabı erişilemez yapardı.

    FK YOK — bilinçli, ``refresh_tokens``/``verification_tokens``/``phone_otps``
    ile aynı desen: beş ayrı kullanıcı tablosu (admins/tutors/clients/
    library_operators/courier_accounts) var ve tek bir FK hepsini gösteremez.
    Hedef ``(role_id, user_id)`` ile taşınır; temizlik ``account_deletion_service``
    sorumluluğundadır.

    ``email`` yalnız DENETİM İZİdir. Sağlayıcıdaki adres değişince burada
    tazelenir ama kullanıcının ``email`` kolonuna ASLA yazılmaz: yerel e-posta
    beş tabloda tekildir (ÜK-5) ve dışarıdan gelen bir değerle güncellemek hem
    o tekilliği hem hesap devri korumasını delerdi.
    """

    __tablename__ = "oauth_identities"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Şimdilik yalnız "google". Kolon bugünden var ki ikinci bir sağlayıcı
    #: şema değişikliği değil satır eklemesi olsun.
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    linked_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # Bir sağlayıcı hesabı yalnız BİR yerel hesaba bağlanabilir.
        Index("uq_oauth_identities_provider_subject", "provider", "subject", unique=True),
        # Bir yerel hesaba aynı sağlayıcıdan İKİNCİ bir hesap bağlanamaz: aksi
        # halde "hangi Google hesabı bu hesabı açar" sorusunun cevabı çoğalır ve
        # bağı koparma işlemi hangi satırı sileceğini bilemez.
        Index("uq_oauth_identities_provider_user", "provider", "role_id", "user_id", unique=True),
    )
