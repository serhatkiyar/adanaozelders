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
    # İlan öne çıkarma: eğitmen PLATFORMDAN reklam alanı satın alır. Para
    # başkası adına toplanmaz — yön de terstir, eğitmen ödeyen taraftadır.
    # Bu yüzden `TUTOR_MARKETPLACE` yeniden KULLANILMADI: o kolun kapalı
    # olmasının sebebi (alt üye işyeri) burada hiç geçerli değil, ikisini aynı
    # bayrağa bağlamak reklam satışını gereksiz yere pazaryeri lisansına
    # bağımlı kılardı.
    TUTOR_PROMOTION = "tutor_promotion"


BRANCH_FLAG: dict[PaymentBranch, str] = {
    PaymentBranch.STORE: flags.FLAG_STORE_PAYMENTS_LIVE,
    PaymentBranch.TUTOR_MARKETPLACE: flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE,
    PaymentBranch.LIBRARY_MARKETPLACE: flags.FLAG_LIBRARY_MARKETPLACE_PAYMENTS_LIVE,
    PaymentBranch.TUTOR_PROMOTION: flags.FLAG_TUTOR_PROMOTION_PAYMENTS_LIVE,
}

#: Kol başkası adına para topluyor mu? (alt üye işyeri gerektirir)
BRANCH_NEEDS_MARKETPLACE: dict[PaymentBranch, bool] = {
    PaymentBranch.STORE: False,
    PaymentBranch.TUTOR_MARKETPLACE: True,
    PaymentBranch.LIBRARY_MARKETPLACE: True,
    PaymentBranch.TUTOR_PROMOTION: False,
}

BRANCH_LABEL: dict[PaymentBranch, str] = {
    PaymentBranch.STORE: "Mağaza (platform kitapları)",
    PaymentBranch.TUTOR_MARKETPLACE: "Öğretmen pazaryeri (ders ve dijital ürün)",
    PaymentBranch.LIBRARY_MARKETPLACE: "Kütüphane pazaryeri (bilet ve koltuk)",
    PaymentBranch.TUTOR_PROMOTION: "İlan öne çıkarma (öğretmen reklam paketi)",
}

#: Müşteriye gösterilecek nötr metin. Kapalı kol "emanet" vaadi VERMEZ.
BRANCH_CLOSED_MESSAGE: dict[PaymentBranch, str] = {
    PaymentBranch.STORE: (
        "Mağaza ödemeleri şu anda geçici olarak kapalı. Kısa süre içinde tekrar "
        "açılacak."
    ),
    # Bu kol iki şeyi kapsar: ders ödemesi ve eğitmenin dijital ürünü. Metin
    # ikisini de karşılamalı — mağazadaki bir eğitmen ürünü için "rezervasyonunu
    # tamamla" demek yanlış bağlam üretiyordu (uçtan uca denemede görüldü).
    PaymentBranch.TUTOR_MARKETPLACE: (
        "Öğretmenlere yapılan ödemeler henüz açılmadı. Ödeme altyapımız hazır "
        "olduğunda ders rezervasyonu ve öğretmen ürünleri satın alınabilecek."
    ),
    PaymentBranch.LIBRARY_MARKETPLACE: (
        "Kütüphane bileti ve çalışma alanı ödemeleri henüz açılmadı. Ödeme "
        "altyapımız hazır olduğunda satışa açılacak."
    ),
    # Bu metni EĞİTMEN görür (müşteri değil) — kapalıyken ilanı zaten
    # yayında olduğu için "bir şey bozuldu" izlenimi bırakmamalı.
    PaymentBranch.TUTOR_PROMOTION: (
        "İlan öne çıkarma satışı henüz açılmadı. İlanınız yayında kalmaya "
        "devam ediyor; öne çıkarma açıldığında panelinizden satın alabilirsiniz."
    ),
}

BLOCKER_FLAG_DISABLED = "flag_disabled"
BLOCKER_PROVIDER_MARKETPLACE = "provider_marketplace_support"


def marketplace_capability_ok() -> bool:
    """Yapılandırılmış sağlayıcı alt üye işyeri modelini uyguluyor mu?

    İki koşul: sağlayıcı yeteneği beyan etmeli **ve** sahte sağlayıcı olmamalı
    (geliştirme dışında). Gerekçe: `FakePaymentProvider` akışı deterministik
    uyguladığı için `supports_marketplace=True` der — bu geliştirmede doğru,
    ama canlı bir kurulum `ENVIRONMENT` unutulmuş ya da `staging` olarak
    açılırsa `PAYMENT_PROVIDER=fake` serbest kalır ve pazaryeri kapısı tek bir
    DB bayrağına iner. Kapı, ortam yapılandırmasının doğru olduğu varsayımına
    yaslanmamalı: sahte sağlayıcı **gerçek para tahsil etmediği için** gerçek
    bir kapı bileşeni sayılamaz.
    """
    provider = get_payment_provider()
    if not provider.supports_marketplace:
        return False
    if provider.name == "fake" and settings.ENVIRONMENT != "development":
        logger.error(
            "Sahte ödeme sağlayıcısı ENVIRONMENT=%s ortamında yapılandırılmış — "
            "pazaryeri kolları kapalı tutuluyor",
            settings.ENVIRONMENT,
        )
        return False
    return True


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
    # Engelleyici adları İÇ bilgidir ("ödeme sağlayıcımız pazaryeri
    # desteklemiyor") — gövdeye konursa `/payments/availability` ve üretim
    # `/health` için özenle uygulanan gizleme burada delinirdi. Ayrıca reddin
    # kendisi loglanır: amacı bir hukuki pozisyonu savunmak olan bir kontrolde
    # reddin kaydı delilin parçasıdır.
    logger.warning(
        "Ödeme kolu kapalı, istek reddedildi: branch=%s blockers=%s",
        branch.value,
        ",".join(blockers),
    )
    raise HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        {
            "code": "PAYMENT_BRANCH_CLOSED",
            "branch": branch.value,
            "message": BRANCH_CLOSED_MESSAGE[branch],
        },
    )


# ── Ürün tipi kapısı: dijital ürün ───────────────────────────────────────────
#
# Ödeme KOLLARINDAN ayrı bir eksendir ve onların yerine geçmez: kollar "kimin
# adına tahsilat yapılıyor" sorusunu, bu kapı "ne satılıyor" sorusunu yanıtlar.
# İkisi birlikte gerekir — eğitmenin dijital ürünü hem pazaryeri koluna hem bu
# kapıya tabidir; PLATFORM satıcı tipiyle açılmış bir dijital ürün ise
# `store` koluna düştüğü için kollardan HİÇ engel görmez (store varsayılanı
# açıktır) ve yalnız bu kapı tarafından durdurulur. Boşluk buydu.

DIGITAL_KIND = "DIGITAL"

DIGITAL_CLOSED_MESSAGE = (
    "Dijital ürün satışı şu anda kapalıdır. Sepetinizdeki indirilebilir "
    "ürünü çıkarıp yeniden deneyebilirsiniz."
)


def _has_digital(kinds: list[str]) -> bool:
    return any((k or "").strip().upper() == DIGITAL_KIND for k in kinds)


async def digital_products_open(db: AsyncSession | None) -> bool:
    """Dijital ürün satışı açık mı? Bayrak okuması `flags` katmanında
    FAIL-CLOSED'dır: okunamayan bayrak "kapalı" sayılır."""
    return await flags.is_enabled(db, flags.FLAG_DIGITAL_PRODUCTS_LIVE)


async def assert_digital_products_allowed(
    db: AsyncSession | None, kinds: list[str]
) -> None:
    """Sepette dijital kalem varsa ve bayrak kapalıysa 503 ile reddeder.

    503 gerekçesi `assert_branch_open` ile aynı: kısıt geçici ve sunucu
    kaynaklıdır, istemcinin isteği hatalı değildir.
    """
    if not _has_digital(kinds):
        return
    if await digital_products_open(db):
        return
    # Reddin kaydı, "dijital ürün satmıyoruz" beyanının delilidir.
    logger.warning(
        "Dijital ürün satışı kapalı, istek reddedildi: kinds=%s", ",".join(kinds)
    )
    raise HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        {
            "code": "DIGITAL_PRODUCTS_CLOSED",
            "message": DIGITAL_CLOSED_MESSAGE,
        },
    )


#: Oluşturma yolunun mesajı ayrıdır: sepetten çıkarılacak bir kalem yok,
#: karşıdaki kişi de müşteri değil yöneticidir — ne yapılacağını söylemeli.
DIGITAL_CREATE_CLOSED_MESSAGE = (
    "Dijital ürün satışı kapalıyken dijital ürün oluşturulamaz. Ürün kaydedilse "
    "bile satılamaz ve türü sonradan DEĞİŞTİRİLEMEZ (SKU öneki türe bağlıdır). "
    "Önce yasal metinleri güncelleyip 'digital_products_live' bayrağını açın."
)


async def assert_digital_product_creatable(
    db: AsyncSession | None, kind: str | None
) -> None:
    """Bayrak kapalıyken DIGITAL ürün OLUŞTURULMASINI reddeder.

    Neden satış kapısı yetmiyor: `assert_digital_products_allowed` yalnız
    checkout'ta çalışır. Bayrak kapalıyken oluşturulan dijital ürün kaydediliyor,
    `status=ACTIVE` ile vitrine çıkıyor (public arama bayrağa bakmaz), sepete
    ekleniyor ve ancak ödemede 503 alıyordu. Üstelik `products_identity_immutable`
    trigger'ı `kind`'ı değiştirilemez kıldığı için o satır DÜZELTİLEMİYORDU —
    tek çıkış silip yeniden açmaktı. Yani kapının yeri oluşturma anıdır.

    503 (kolların ve satış kapısının kullandığı kod): kısıt geçici ve sunucu
    kaynaklıdır, isteğin kendisi hatalı değildir.
    """
    if (kind or "").strip().upper() != DIGITAL_KIND:
        return
    if await digital_products_open(db):
        return
    logger.warning("Dijital ürün oluşturma reddedildi (bayrak kapalı)")
    raise HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        {
            "code": "DIGITAL_PRODUCTS_CLOSED",
            "message": DIGITAL_CREATE_CLOSED_MESSAGE,
        },
    )


async def digital_blocked_for_kinds(
    db: AsyncSession | None, kinds: list[str]
) -> bool:
    """`validate_cart` için: ödeme denemesinden ÖNCE sepette söylenebilsin."""
    return _has_digital(kinds) and not await digital_products_open(db)


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
    PaymentBranch.TUTOR_PROMOTION,
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


async def warn_if_closed_completion(
    db: AsyncSession | None, branch: PaymentBranch, *, reference: str
) -> None:
    """Kol KAPANDIKTAN SONRA tamamlanan bir tahsilatı görünür kılar.

    ## Kapatma kararının artçı penceresi (bilinçli, ama sessiz olmamalı)

    iyzico callback'i (`POST /payments/iyzico/callback`) **bilinçli olarak
    kapısızdır**: kapılansa, sağlayıcıda GERÇEKTEN tahsil edilmiş bir ödemenin
    yerel kaydı hiç oluşmaz — bu hem operasyonel hem hukuki olarak daha kötüdür
    (para alınmış, sistemde izi yok). Aynı şekilde `escrow_reconciler`
    `CHECKOUT_RECONCILE_MAX_AGE_HOURS` (48 saat) boyunca sarkan checkout'ları
    sağlayıcıdan doğrulayıp sonuca bağlar.

    Sonuç: bir kolu kapatmak **yoldaki** tahsilatları anında durdurmaz. Bu
    kaçınılmaz, ama görünmez olmamalı — kapatma kararının fiilen ne zaman
    etkili olduğu bilinmek zorundadır. Bu yüzden kapalı kolda tamamlanan her
    tahsilat ERROR seviyesinde loglanır.

    (Otomatik iade BİLİNÇLİ olarak yapılmıyor: para hareketi kararıdır ve
    uyuşmazlık/iade politikasıyla birlikte ele alınmalı — PK-3/PK-4.)
    """
    if await branch_open(db, branch):
        return
    logger.error(
        "KAPALI kolda tahsilat tamamlandı (kapatma kararının artçı penceresi): "
        "branch=%s ref=%s — drenajın bittiğini doğrulayın",
        branch.value,
        reference,
    )


# ── Elle havale (manuel payout) ──────────────────────────────────────────────


async def assert_manual_payout_open(db: AsyncSession | None) -> None:
    """Elle havale defteri: üretimde **bayrağa bakılmaksızın** kapalı.

    Kullanıcı kararı: "manuel olarak şirket hesabına para alıp öğretmene havale
    etme yolu, fallback dâhil tamamen kapalı olsun." Bayrağın üretimde
    açılabilir olması bu kararı delerdi; bu yüzden ortam kontrolü bayraktan
    ÖNCE gelir.

    Geçmiş `payout_records` satırları silinmez — mali kayıttır, salt-okunur
    kalır; yalnız yeni kayıt girilemez.
    """
    if settings.is_production:
        logger.warning(
            "Elle havale denemesi reddedildi (üretim ortamı) — bu yol kapalıdır"
        )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {
                "code": "MANUAL_PAYOUT_DISABLED",
                "message": (
                    "Elle havale kaydı üretimde kapalıdır. Hakediş ödemesi "
                    "sağlayıcı üzerinden (alt üye işyeri) yapılmalıdır."
                ),
            },
        )
    if not await flags.is_enabled(db, flags.FLAG_MANUAL_PAYOUT_ENABLED):
        logger.warning("Elle havale denemesi reddedildi (bayrak kapalı)")
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {
                "code": "MANUAL_PAYOUT_DISABLED",
                "message": (
                    "Elle havale kaydı kapalı. Geliştirme/staging ortamında "
                    "'manual_payout_enabled' bayrağıyla açılabilir."
                ),
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
