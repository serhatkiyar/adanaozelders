"""Ürün kolu bazlı ödeme kapıları (launch gate).

## Neden tek `payments_live` yok

6493 sayılı Kanun kapsamına giren tartışma **başkası adına** toplanan paradadır:
eğitmen dersi, eğitmen dijital ürünü, kütüphane bileti/koltuk rezervasyonu. Bu
akışlarda para bir süre platformda bekleyip sonra hak sahibine aktarılıyorsa
"ödeme hizmeti" nitelendirmesi riski doğar (risk hipotezi — avukat teyidine
tabi; m.28/1 yaptırımı hapis cezasıdır). Doğru çözüm, parayı hiç kendi hesabına
almamak: lisanslı kuruluşun **alt üye işyeri** modeli.

Platformun **kendi kitabını** satması bambaşka bir şeydir: doğrudan satış, kendi
cirosu, alt üye işyeri gerekmez. O kolu kapatmak için hiçbir sebep yoktur.

Bu yüzden tek bir global "hazır mı" anahtarı YANLIŞTIR ve bilinçli olarak
yazılmamıştır. Her kol kendi bayrağıyla yönetilir; bir kolun eksiği diğerini
kapatmaz.

## Kapının iki bileşeni

Bir kol **açık** sayılmak için iki koşulu birlikte sağlamak zorundadır:

1. **İşletme bayrağı** (`core/flags.py`, DB'de, denetim kayıtlı) — operatör
   kararı.
2. **Sağlayıcı yeteneği** (`PaymentProvider.supports_marketplace`) — teknik
   gerçek. Yalnız pazaryeri kolları için gerekir.

İkincisi olmadan birincisini açmak, olmayan bir altyapıya güvenmek olur. Üretimde
sağlayıcı iyzico olmak zorundadır (`core/config.py::_guard_production`) ve iyzico
alt üye entegrasyonu PK-2'de yazılacaktır — dolayısıyla bu kural şu an fiilî
lansman kapısıdır ve kendini otomatik olarak açar.
"""
from __future__ import annotations

import logging
from enum import Enum

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from core import flags
from core.config import settings
from core.payments.factory import get_payment_provider

logger = logging.getLogger(__name__)


class PaymentBranch(str, Enum):
    """Ödeme kolu — parayı kimin adına tahsil ettiğimize göre ayrılır."""

    STORE = "store"
    TUTOR_MARKETPLACE = "tutor_marketplace"
    LIBRARY_MARKETPLACE = "library_marketplace"


BRANCH_FLAG: dict[PaymentBranch, str] = {
    PaymentBranch.STORE: flags.FLAG_STORE_PAYMENTS_LIVE,
    PaymentBranch.TUTOR_MARKETPLACE: flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE,
    PaymentBranch.LIBRARY_MARKETPLACE: flags.FLAG_LIBRARY_MARKETPLACE_PAYMENTS_LIVE,
}

#: Kol başkası adına para topluyor mu? (alt üye işyeri gerektirir)
BRANCH_NEEDS_MARKETPLACE: dict[PaymentBranch, bool] = {
    PaymentBranch.STORE: False,
    PaymentBranch.TUTOR_MARKETPLACE: True,
    PaymentBranch.LIBRARY_MARKETPLACE: True,
}

BRANCH_LABEL: dict[PaymentBranch, str] = {
    PaymentBranch.STORE: "Mağaza (platform kitapları)",
    PaymentBranch.TUTOR_MARKETPLACE: "Eğitmen pazaryeri (ders ve dijital ürün)",
    PaymentBranch.LIBRARY_MARKETPLACE: "Kütüphane pazaryeri (bilet ve koltuk)",
}

#: Müşteriye gösterilecek nötr metin. Kapalı kol "emanet" vaadi VERMEZ.
BRANCH_CLOSED_MESSAGE: dict[PaymentBranch, str] = {
    PaymentBranch.STORE: (
        "Mağaza ödemeleri şu anda geçici olarak kapalı. Kısa süre içinde tekrar "
        "açılacak."
    ),
    PaymentBranch.TUTOR_MARKETPLACE: (
        "Ders ödemeleri henüz açılmadı. Ödeme altyapımız hazır olduğunda "
        "rezervasyonunu tamamlayabileceksin."
    ),
    PaymentBranch.LIBRARY_MARKETPLACE: (
        "Kütüphane bileti ve çalışma alanı ödemeleri henüz açılmadı. Ödeme "
        "altyapımız hazır olduğunda satışa açılacak."
    ),
}

BLOCKER_FLAG_DISABLED = "flag_disabled"
BLOCKER_PROVIDER_MARKETPLACE = "provider_marketplace_support"


def marketplace_capability_ok() -> bool:
    """Yapılandırılmış sağlayıcı alt üye işyeri modelini uyguluyor mu?

    Ayrı fonksiyon: testler ve panel bunu tek noktadan gözlemleyebilsin.
    """
    return bool(get_payment_provider().supports_marketplace)


async def branch_blockers(db: AsyncSession | None, branch: PaymentBranch) -> list[str]:
    """Kolun açılmasını engelleyen sebepler (boşsa kol açık)."""
    blockers: list[str] = []
    if not await flags.is_enabled(db, BRANCH_FLAG[branch]):
        blockers.append(BLOCKER_FLAG_DISABLED)
    if BRANCH_NEEDS_MARKETPLACE[branch] and not marketplace_capability_ok():
        blockers.append(BLOCKER_PROVIDER_MARKETPLACE)
    return blockers


async def branch_open(db: AsyncSession | None, branch: PaymentBranch) -> bool:
    return not await branch_blockers(db, branch)


async def assert_branch_open(db: AsyncSession | None, branch: PaymentBranch) -> None:
    """Kol kapalıysa 503 + makinece okunabilir gövde ile reddeder.

    503 seçildi: bu geçici ve sunucu kaynaklı bir kısıttır, istemcinin isteği
    hatalı değildir (400 yanlış olurdu) ve yetki sorunu da değildir (403 yanlış
    olurdu).
    """
    blockers = await branch_blockers(db, branch)
    if not blockers:
        return
    raise HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        {
            "code": "PAYMENT_BRANCH_CLOSED",
            "branch": branch.value,
            "message": BRANCH_CLOSED_MESSAGE[branch],
            "blockers": blockers,
        },
    )


# ── Sepet (karışık satıcı) ───────────────────────────────────────────────────

#: Mağaza satırının satıcı tipi → kol. `models/store.py::SellerType` ile hizalı.
_SELLER_TYPE_BRANCH: dict[str, PaymentBranch] = {
    "PLATFORM": PaymentBranch.STORE,
    "TUTOR": PaymentBranch.TUTOR_MARKETPLACE,
}

#: Kolların deterministik sıralaması (rapor ve test kararlılığı için).
_BRANCH_ORDER: tuple[PaymentBranch, ...] = (
    PaymentBranch.STORE,
    PaymentBranch.TUTOR_MARKETPLACE,
    PaymentBranch.LIBRARY_MARKETPLACE,
)


def branches_for_seller_types(seller_types: list[str]) -> set[PaymentBranch]:
    """Sepetteki satıcı tiplerinden hangi kolların gerektiğini bulur.

    Bilinmeyen satıcı tipi **yok sayılmaz**: pazaryeri kolu gerektirdiği
    varsayılır — yeni bir satıcı tipi eklenip burası güncellenmezse kapı
    yanlışlıkla açık kalmasın.
    """
    branches: set[PaymentBranch] = set()
    for raw in seller_types:
        key = (raw or "").strip().upper()
        branches.add(_SELLER_TYPE_BRANCH.get(key, PaymentBranch.TUTOR_MARKETPLACE))
    return branches


async def blocked_branches_for_seller_types(
    db: AsyncSession | None, seller_types: list[str]
) -> list[str]:
    """Sepet için kapalı olan kolların listesi (ödeme denemesinden ÖNCE rapor).

    `cart/validate` bunu kullanır: müşteri checkout'ta 503 görmek yerine sepette
    hangi kalemin engellendiğini öğrenir.
    """
    needed = branches_for_seller_types(seller_types)
    return [
        b.value for b in _BRANCH_ORDER if b in needed and not await branch_open(db, b)
    ]


async def assert_cart_branches_open(
    db: AsyncSession | None, seller_types: list[str]
) -> None:
    """Karışık sepet **her iki** kolun da açık olmasını ister."""
    needed = branches_for_seller_types(seller_types)
    for branch in _BRANCH_ORDER:
        if branch in needed:
            await assert_branch_open(db, branch)


# ── Durum raporu (global gate YOK, kol bazlı) ────────────────────────────────


async def branches_status(
    db: AsyncSession | None, *, include_diagnostics: bool = True
) -> list[dict]:
    """Her kol için `{branch, label, open, message}` (+ teşhis alanları).

    Bilinçli olarak tek bir "hazır mı" boolean'ı DÖNMEZ: kolların tek bir
    sayıya indirilmesi, bir kolun eksiğinin diğerini kapatmasına yol açar.

    ``include_diagnostics=False`` iken `flag_enabled` ve `blockers` çıkarılır —
    public yüzeyler (anonim `/health`, müşteriye dönen uygunluk ucu) iç
    yapılandırma durumunu sızdırmamalıdır. Müşteriye gösterilecek `message`
    kalır; o zaten kullanıcı için yazılmıştır.
    """
    out: list[dict] = []
    for branch in _BRANCH_ORDER:
        blockers = await branch_blockers(db, branch)
        row: dict = {
            "branch": branch.value,
            "label": BRANCH_LABEL[branch],
            "open": not blockers,
            "message": None if not blockers else BRANCH_CLOSED_MESSAGE[branch],
        }
        if include_diagnostics:
            row["flag_enabled"] = await flags.is_enabled(db, BRANCH_FLAG[branch])
            row["blockers"] = blockers
        out.append(row)
    return out


# ── Elle havale (manuel payout) ──────────────────────────────────────────────


async def assert_manual_payout_open(db: AsyncSession | None) -> None:
    """Elle havale defteri: üretimde **bayrağa bakılmaksızın** kapalı.

    Kullanıcı kararı: "manuel olarak şirket hesabına para alıp eğitmene havale
    etme yolu, fallback dâhil tamamen kapalı olsun." Bayrağın üretimde
    açılabilir olması bu kararı delerdi; bu yüzden ortam kontrolü bayraktan
    ÖNCE gelir.

    Geçmiş `payout_records` satırları silinmez — mali kayıttır, salt-okunur
    kalır; yalnız yeni kayıt girilemez.
    """
    if settings.is_production:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {
                "code": "MANUAL_PAYOUT_DISABLED",
                "message": (
                    "Elle havale kaydı üretimde kapalıdır. Hakediş ödemesi "
                    "sağlayıcı üzerinden (alt üye işyeri) yapılmalıdır."
                ),
                "blockers": ["production_environment"],
            },
        )
    if not await flags.is_enabled(db, flags.FLAG_MANUAL_PAYOUT_ENABLED):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {
                "code": "MANUAL_PAYOUT_DISABLED",
                "message": (
                    "Elle havale kaydı kapalı. Geliştirme/staging ortamında "
                    "'manual_payout_enabled' bayrağıyla açılabilir."
                ),
                "blockers": [BLOCKER_FLAG_DISABLED],
            },
        )


def manual_payout_startup_problem(*, is_production: bool, flag_enabled: bool) -> str | None:
    """Açılışta bildirilecek yapılandırma sorunu (saf, testli).

    Üretimde bayrak açık bırakılmışsa uygulama AÇILMAMALIDIR: çalışma zamanı
    kapısı zaten reddediyor olsa da, açık bir bayrak "bu yol kullanılabilir"
    izlenimi verir ve bir sonraki refaktörde kapı atlanabilir. Sessizce yanlış
    yapılandırmayla çalışmaktansa açılmamak doğru davranıştır
    (`core/config.py::_guard_production` ile aynı felsefe).
    """
    if is_production and flag_enabled:
        return (
            "manual_payout_enabled=true — üretimde elle havale yolu kapalı olmalı "
            "(feature_flags tablosundan kapatın)"
        )
    return None
