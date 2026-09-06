"""Hesap silme (KVKK m.7/m.11) ve veri taşınabilirliği (m.20).

`legalContent.ts` kullanıcıya "hesabınızı sildiğinizde verileriniz silinir, yok
edilir veya anonim hâle getirilir" taahhüdünde bulunuyordu ama karşılığı olan
hiçbir uç yoktu: tek silme yolu admin'in soft-delete'iydi ve **soft-delete
silme değildir**.

Yaklaşım — "anonimleştirme", fiziksel silme değil:
Mali kayıtlar (sipariş, ödeme, fatura verisi) Vergi Usul Kanunu ve Türk Ticaret
Kanunu gereği saklanmak ZORUNDADIR; kullanıcının silme talebi bunları ortadan
kaldıramaz. KVKK bu durumda "ilgili mevzuat gereği saklanan veriler" istisnasını
tanır. Bu yüzden:
  - kimlik/iletişim alanları (ad, e-posta, telefon, adres, avatar, biyografi)
    geri döndürülemez biçimde temizlenir,
  - satır SİLİNMEZ: siparişin `client_id` referansı ve tutarları kalır ki
    muhasebe ve escrow mutabakatı bozulmasın,
  - hesap pasifleştirilir ve tüm oturumlar iptal edilir.

Sonuç: veri sahibi tanınamaz hale gelir, mali kayıt bütünlüğü korunur.
"""
from __future__ import annotations

import datetime
import hashlib
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.client import Client, ClientAddress
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorEducation
from services import consent_service, refresh_token_service

logger = logging.getLogger("adana.account")

#: Silinen hesaplarda görünen ad.
ANON_NAME = "Silinmiş"
ANON_SURNAME = "Kullanıcı"


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def anonymized_email(user_id: int, role_id: int) -> str:
    """Benzersiz ama geri döndürülemez e-posta yer tutucusu.

    E-posta kolonu benzersiz olduğundan boş bırakılamaz; hash kullanıcıyı
    yeniden tanımlamaya YARAMAZ (tuz olarak id+rol kullanılır, ters çevrilemez)
    ama çakışmayı da önler.
    """
    digest = hashlib.sha256(f"{role_id}:{user_id}:deleted".encode()).hexdigest()[:24]
    return f"silinmis+{digest}@hesap.silindi"


async def _shadow_of(db: AsyncSession, tutor_id: int) -> Client | None:
    """Eğitmenin canlı alışveriş gölgesi (docs/egitmen-alici-sozlesme.md §1).

    Gölge ayrı bir kişi değil, aynı kişinin mağazadaki yansımasıdır: hesap
    kapatma, silme kilidi ve veri dökümü onu da kapsamak zorundadır.
    """
    return (
        await db.execute(
            select(Client).where(
                Client.shadow_of_tutor_id == tutor_id, Client.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()


async def anonymize_account(db: AsyncSession, user) -> list[str]:
    """Kullanıcının kimlik/iletişim verisini temizler ve hesabı kapatır.

    Commit ÇAĞIRANIN sorumluluğundadır. Dönüş değeri: DB referansı temizlenen
    ve depodan **commit SONRASI best-effort** silinmesi gereken `private/`
    dosya anahtarları (İP-3 §3 açık kararı: önce DB temizlenir ve commit
    edilir, sonra depo silme denenir; başarısız kalırsa işlem geri alınmaz —
    referans zaten yok, yetim nesne ayrı temizlik işine kalır. Tersi — önce
    dosyayı silip DB'de patlamak — kurtarılamaz durum üretir).
    """
    role_id = user.role_id
    uid = user.id
    orphan_files: list[str] = []

    # ── Kimlik ve iletişim ──
    user.first_name = ANON_NAME
    user.last_name = ANON_SURNAME
    user.email = anonymized_email(uid, role_id)
    user.hashed_password = "!"  # hiçbir parolayla eşleşmez
    user.is_active = False
    user.deleted_at = _now()

    # `gender` bu listeye Ç-4 turunda eklendi: `birth_date` temizleniyordu ama
    # cinsiyet KALIYORDU. İkisi de aydınlatma metninin aynı kaleminde ("kimlik
    # bilgileri") işlenen demografik veridir; birini silip diğerini bırakmak
    # bilinçli bir ayrım değil, unutulmuş bir alandı.
    for field in ("phone", "about", "avatar_url", "headline", "bio", "birth_date", "gender"):
        if hasattr(user, field):
            setattr(user, field, None)
    # Telefon doğrulaması ve e-posta doğrulaması sıfırlanır.
    for field in ("phone_verified_at", "email_verified_at"):
        if hasattr(user, field):
            setattr(user, field, None)
    # Konum (eğitmen haritada görünmesin). Gerçek kolon adları location_*;
    # eski liste ("lat", "lng") ölü addı ve hasattr sessizce atlıyordu.
    for field in ("location_lat", "location_lng", "location_text", "district"):
        if hasattr(user, field):
            setattr(user, field, None)
    # ── Ödeme hedefi ve kimlik verisi (İP-3 §3) — para yönlendirmesini engelle.
    # `tckn_encrypted` diye bir kolon hiç olmadı (ölü ad); gerçek alanlar
    # `identity_last4` ve `sub_merchant_key`. `payout_status` NOT NULL'dur:
    # None'a çekilemez, geçerli pasif değere ('NONE') çekilir.
    for field in ("iban", "identity_last4", "sub_merchant_key"):
        if hasattr(user, field):
            setattr(user, field, None)
    if hasattr(user, "payout_status"):
        user.payout_status = "NONE"
    # Kurye/operatör oturumlarını da öldüren sürüm sayacı.
    if hasattr(user, "auth_version") and user.auth_version is not None:
        user.auth_version = int(user.auth_version) + 1

    # ── Eğitmen doğrulama verisi: TCKN, e-Devlet barkodu, diploma dosyası ──
    if isinstance(user, Tutor):
        educations = (
            await db.execute(
                select(TutorEducation).where(TutorEducation.tutor_id == uid)
            )
        ).scalars().all()
        for edu in educations:
            if edu.document_url:
                orphan_files.append(edu.document_url)
            edu.document_url = None
            edu.document_name = None
            edu.verification_code = None
            edu.verification_tckn = None

    # ── Bağlı PII ──
    if role_id == ROLE_IDS[RoleType.CLIENT]:
        addresses = (
            await db.execute(
                select(ClientAddress).where(ClientAddress.client_id == uid)
            )
        ).scalars().all()
        for addr in addresses:
            # Adres satırı siparişe bağlı olabilir → satır silinmez, içeriği
            # temizlenir. `title` ve `address_line` NOT NULL olduğundan boş
            # bırakılamaz; yer tutucu yazılır.
            addr.title = "silindi"
            addr.address_line = "silindi"
            for field in (
                "recipient_name", "phone", "city", "district",
                "door_no", "apt_no", "directions",
                "location_lat", "location_lng",
            ):
                if hasattr(addr, field):
                    setattr(addr, field, None)
            addr.deleted_at = _now()

    # ── Eğitmenin alışveriş gölgesi de aynı yoldan geçer (§5.3) ──
    # Gölge kendi başına bir hesap değil; eğitmenle birlikte kapanmazsa mağaza
    # tarafında adı, e-postası ve teslimat adresleri geride kalırdı.
    if isinstance(user, Tutor):
        shadow = await _shadow_of(db, uid)
        if shadow is not None:
            orphan_files.extend(await anonymize_account(db, shadow))

    # Rıza kayıtlarındaki IP/user-agent (onayın verildiği gerçeği kalır).
    await consent_service.purge_for_user(db, user_id=uid, role_id=role_id)

    # Tüm oturumları kapat.
    await refresh_token_service.revoke_all_for_user(db, role_id=role_id, user_id=uid)

    # Log satırı bilinçli olarak yalnız rol+id taşır — PII yeniden sızmaz (İP-3 §3.6).
    logger.info("hesap anonimleştirildi (role=%s id=%s)", role_id, uid)
    return orphan_files


async def export_personal_data(db: AsyncSession, user) -> dict:
    """KVKK m.20 veri taşınabilirliği: kullanıcının verisinin JSON dökümü.

    Yalnız KENDİ verisi döner. Amaç eksiksiz bir arşiv değil, veri sahibinin
    "hakkımda ne tutuyorsunuz" sorusuna makine-okunur cevap vermektir.
    """
    role_id = user.role_id
    data: dict = {
        "olusturulma": _now().isoformat(),
        "hesap": {
            "id": user.id,
            "rol": role_id,
            "ad": getattr(user, "first_name", None),
            "soyad": getattr(user, "last_name", None),
            "eposta": getattr(user, "email", None),
            "telefon": getattr(user, "phone", None),
            "dogum_tarihi": (
                user.birth_date.isoformat()
                if getattr(user, "birth_date", None)
                else None
            ),
            # Aydınlatma metni cinsiyeti işlenen veri sayıyor ama döküm onu
            # vermiyordu: yasal metin kodun tutmadığı bir söz veriyordu.
            # `.value` ile yazılır — enum nesnesi JSON'a serileşmez.
            "cinsiyet": (
                user.gender.value if getattr(user, "gender", None) else None
            ),
            "kayit_tarihi": (
                user.created_at.isoformat() if getattr(user, "created_at", None) else None
            ),
        },
    }

    consents = await consent_service.latest_by_doc(
        db, user_id=user.id, role_id=role_id
    )
    data["onaylar"] = [
        {
            "belge": key,
            "surum": row.doc_version,
            "onaylandi": row.granted,
            "tarih": row.created_at.isoformat() if row.created_at else None,
        }
        for key, row in sorted(consents.items())
    ]

    # Adresler ve siparişler `clients.id`'ye bağlıdır; eğitmenin mağaza verisi
    # gölgesinin id'sinde durur ve dökümde eksik kalmamalıdır (§5.5).
    alici_id: int | None = None
    if role_id == ROLE_IDS[RoleType.CLIENT]:
        alici_id = user.id
    elif isinstance(user, Tutor):
        shadow = await _shadow_of(db, user.id)
        alici_id = shadow.id if shadow is not None else None

    if alici_id is not None:
        addresses = (
            await db.execute(
                select(ClientAddress).where(
                    ClientAddress.client_id == alici_id,
                    ClientAddress.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        data["adresler"] = [
            {
                "baslik": a.title,
                "alici": a.recipient_name,
                "telefon": a.phone,
                "adres": a.address_line,
                "ilce": a.district,
                "il": a.city,
                "tarif": a.directions,
            }
            for a in addresses
        ]

    return data


async def can_delete(db: AsyncSession, user) -> tuple[bool, str | None]:
    """Hesap şu an silinebilir mi? (False, gerekçe) döner.

    Açık para taahhüdü varken silmeyi engelliyoruz: emanetteki ödeme,
    tamamlanmamış teslimat veya bekleyen iade, anonimleştirmeden sonra
    çözülemez hale gelir.
    """
    from models.store import Order  # yerel import: döngü önleme

    # Siparişler `clients.id`'ye bağlıdır; eğitmenin siparişleri gölgesinin
    # id'sindedir. Kilit gölge üzerinden de aranmazsa yolda kargosu olan bir
    # eğitmen hesabını kapatır ve kuryenin teslim adresi/telefonu boşalır (§5.4).
    buyer_id: int | None = None
    if user.role_id == ROLE_IDS[RoleType.CLIENT]:
        buyer_id = user.id
    elif isinstance(user, Tutor):
        shadow = await _shadow_of(db, user.id)
        buyer_id = shadow.id if shadow is not None else None

    if buyer_id is not None:
        open_orders = (
            await db.execute(
                select(Order.id).where(
                    Order.client_id == buyer_id,
                    Order.deleted_at.is_(None),
                    Order.status.in_(["PAID", "SHIPPED"]),
                )
            )
        ).scalars().all()
        if open_orders:
            return False, (
                "Devam eden siparişiniz var. Teslimat tamamlandıktan sonra "
                "hesabınızı silebilirsiniz."
            )

    if isinstance(user, Tutor) or isinstance(user, Client):
        from models.booking import Booking, BookingStatus

        field = Booking.tutor_id if isinstance(user, Tutor) else Booking.client_id
        upcoming = (
            await db.execute(
                select(Booking.id).where(
                    field == user.id,
                    Booking.deleted_at.is_(None),
                    Booking.status == BookingStatus.ACCEPTED,
                    Booking.start_at >= _now(),
                )
            )
        ).scalars().all()
        if upcoming:
            return False, (
                "Yaklaşan onaylı dersiniz var. Dersler tamamlandıktan veya iptal "
                "edildikten sonra hesabınızı silebilirsiniz."
            )

    return True, None
