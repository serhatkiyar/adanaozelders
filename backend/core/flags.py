"""Özellik bayrakları — DB doğruluk kaynağı, süreç-içi TTL önbellek, FAIL-CLOSED.

## Neden fail-CLOSED (rate-limit'in tersi)

`core/ratelimit.py` bilinçli olarak fail-OPEN'dır: Redis düşerse istekler geçer,
çünkü altyapı arızasının bütün girişleri kesmesi daha kötüdür. Ödeme kapıları
TERSİ yönde asimetriktir: "bayrağı okuyamadım" hâlinde para tahsil etmek,
tahsil etmemekten çok daha pahalıdır (yanlış tahsil edilen paranın iadesi,
alınmayan siparişten kat kat maliyetlidir ve hukuki risk taşır). Bu yüzden
okuma hatasında **kapalı** dönülür.

## Neden Redis değil süreç-içi önbellek

Bayrak okuması her ödeme isteğinde çalışır; her istekte bir SELECT atmak
gereksizdir. Ama Redis'i araya koymak fail-open riskini geri getirir (Redis
boş/eski değer döndürürse kapı yanlış açılabilir) ve yeni bir tutarlılık sorunu
üretir. Bunun yerine küçük bir süreç-içi TTL önbelleği kullanılır: doğruluk
kaynağı her zaman DB'dir, önbellek yalnız `_CACHE_TTL_SECONDS` kadar eskir.
Admin bir bayrağı değiştirdiğinde kendi sürecinde `invalidate()` çağırır;
diğer süreçler en fazla TTL kadar gecikmeyle görür. Ödeme kapısı için bu
gecikme kabul edilebilir (kapatma kararı saniyeler içinde yayılır).

## Katalog kodda

Hangi bayrakların var olduğu ve varsayılanları `FLAG_SPECS`'tedir — tek
doğruluk kaynağı burasıdır (`core/admin_permissions.py` ile aynı disiplin).
`feature_flags` tablosunda satırı olmayan bayrak katalog varsayılanıyla
çalışır; tanımsız bir anahtar sorulması programlama hatasıdır (KeyError).

`enforced=False` olan bayraklar henüz kod tarafında bir şeyi kapatmıyor
(ilgili paket yazılınca bağlanacak). Panelde bu durum açıkça gösterilir ki
operatör var olmayan bir kontrolü açık sanmasın.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.feature_flag import FeatureFlag

logger = logging.getLogger(__name__)

# ── Anahtarlar ───────────────────────────────────────────────────────────────

FLAG_STORE_PAYMENTS_LIVE = "store_payments_live"
FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE = "tutor_marketplace_payments_live"
FLAG_LIBRARY_MARKETPLACE_PAYMENTS_LIVE = "library_marketplace_payments_live"
FLAG_TUTOR_PROMOTION_PAYMENTS_LIVE = "tutor_promotion_payments_live"
FLAG_DIGITAL_PRODUCTS_LIVE = "digital_products_live"
FLAG_MINOR_BOOKINGS_LIVE = "minor_bookings_live"
FLAG_INVOICING_LIVE = "invoicing_live"
FLAG_MANUAL_PAYOUT_ENABLED = "manual_payout_enabled"
FLAG_MARKETING_MESSAGES_ENABLED = "marketing_messages_enabled"


@dataclass(frozen=True, slots=True)
class FlagSpec:
    key: str
    default: bool
    label: str
    description: str
    #: Kod bu bayrağı fiilen uyguluyor mu? False ise panel "henüz uygulanmıyor"
    #: der — açık görünen ama hiçbir şeyi kapatmayan bir kontrol yanıltıcıdır.
    enforced: bool


FLAG_SPECS: tuple[FlagSpec, ...] = (
    FlagSpec(
        key=FLAG_STORE_PAYMENTS_LIVE,
        default=True,
        label="Mağaza ödemeleri (platformun kendi kitapları)",
        description=(
            "Platformun kendi malını satması doğrudan satıştır; para kendi "
            "cirosudur. Alt üye işyeri gerektirmez, bu yüzden varsayılanı açıktır."
        ),
        enforced=True,
    ),
    FlagSpec(
        key=FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE,
        default=False,
        label="Eğitmen pazaryeri ödemeleri (ders + dijital ürün)",
        description=(
            "Eğitmen adına para tahsil edilir. iyzico Pazaryeri (alt üye işyeri) "
            "entegrasyonu ve yazılı hukuki görüş olmadan açılmamalıdır."
        ),
        enforced=True,
    ),
    FlagSpec(
        key=FLAG_LIBRARY_MARKETPLACE_PAYMENTS_LIVE,
        default=False,
        label="Kütüphane pazaryeri ödemeleri (bilet + koltuk)",
        description=(
            "Kütüphane adına para tahsil edilir. Eğitmen pazaryeriyle aynı "
            "koşullara tabidir; ek olarak 5580 (etüt merkezi) görüşü beklenir."
        ),
        enforced=True,
    ),
    FlagSpec(
        key=FLAG_TUTOR_PROMOTION_PAYMENTS_LIVE,
        default=False,
        label="İlan öne çıkarma satışı (eğitmen reklam paketi)",
        description=(
            "Eğitmenin ilanını süreli olarak arama sonuçlarının üstünde "
            "göstermek için satın aldığı reklam paketi. Para PLATFORMUN kendi "
            "cirosudur — üçüncü kişi adına tahsilat yoktur, bu yüzden alt üye "
            "işyeri gerektirmez ve eğitmen pazaryeri kolundan bağımsızdır. "
            "Varsayılanı kapalı: hizmet koşulları metni yayımlanmadan ve "
            "sanal POS faaliyet kapsamı teyit edilmeden açılmamalıdır."
        ),
        enforced=True,
    ),
    FlagSpec(
        key=FLAG_DIGITAL_PRODUCTS_LIVE,
        default=False,
        label="Dijital ürün satışı (indirilebilir içerik)",
        description=(
            "İlk sürümde KAPSAM DIŞI. Sanal POS başvurusunda platformun eğitim "
            "hizmeti satmadığı ve üçüncü kişi adına tahsilat yapmadığı beyan "
            "edildi; yasal metinler (mesafeli satış sözleşmesi, ön bilgilendirme "
            "formu) buna göre yazıldı ve dijital ürüne ilişkin hüküm İÇERMİYOR. "
            "Bu bayrak açılırsa satış teknik olarak mümkün hale gelir ama "
            "metinlerle çelişir — açmadan önce yasal metinler güncellenmelidir. "
            "Satıcı tipinden BAĞIMSIZDIR: eğitmen ürünü ayrıca pazaryeri "
            "koluna da tabidir, platformun kendi dijital ürünü ise yalnız buna."
        ),
        enforced=True,
    ),
    FlagSpec(
        key=FLAG_MANUAL_PAYOUT_ENABLED,
        default=False,
        label="Elle havale kaydı (manuel payout defteri)",
        description=(
            "Parayı platform hesabında toplayıp eğitmene elle havale etme yolu. "
            "Üretimde bayrağa BAKILMAKSIZIN kapalıdır; yalnız geliştirme ve "
            "staging'de açılabilir."
        ),
        enforced=True,
    ),
    FlagSpec(
        key=FLAG_MINOR_BOOKINGS_LIVE,
        default=False,
        label="18 yaş altı rezervasyonu",
        description=(
            "Veli (Guardian) modeli yazılana kadar kapalı. Checkbox ile "
            "geçiştirilmez — kapalıyken 18 altı beyanı olan hesap rezervasyon "
            "açamaz. Uygulaması PK-5 ile bağlanacak."
        ),
        enforced=False,
    ),
    FlagSpec(
        key=FLAG_INVOICING_LIVE,
        default=False,
        label="Belge/fatura kesimi",
        description=(
            "KDV oranları, stopaj oranı, belge serisi ve kesim zamanı yazılı "
            "SMMM/entegratör teyidi gelmeden sabitlenmez. Uygulaması PK-6 ile "
            "bağlanacak."
        ),
        enforced=False,
    ),
    FlagSpec(
        key=FLAG_MARKETING_MESSAGES_ENABLED,
        default=False,
        label="Pazarlama SMS/e-postası",
        description=(
            "İYS kaydı ve onay senkronizasyonu yapılmadan pazarlama iletisi "
            "gönderilemez. İşlemsel iletiler (teslimat, tahsilat, doğrulama) bu "
            "bayraktan etkilenmez. Uygulaması İYS paketiyle bağlanacak."
        ),
        enforced=False,
    ),
)

_SPECS_BY_KEY: dict[str, FlagSpec] = {s.key: s for s in FLAG_SPECS}


def spec(key: str) -> FlagSpec:
    """Katalogda olmayan anahtar programlama hatasıdır (sessiz varsayılan yok)."""
    try:
        return _SPECS_BY_KEY[key]
    except KeyError as exc:  # noqa: TRY003
        raise KeyError(f"Tanımsız özellik bayrağı: {key!r}") from exc


# ── Süreç-içi TTL önbellek ───────────────────────────────────────────────────

_CACHE_TTL_SECONDS = 10.0
_cache: dict[str, tuple[float, bool]] = {}

#: Hangi anahtar için okuma hatasının stack trace'i zaten yazıldı.
#: DB düşükken `is_enabled` her istekte çağrıldığı için (public uygunluk ucu tek
#: istekte 3 kez okur) `exc_info=True` bir log-flood amplifikatörüne dönüşüyordu.
_traced: set[str] = set()


def reset_cache() -> None:
    """Testler ve açılış için önbelleği tamamen boşaltır."""
    _cache.clear()
    _traced.clear()


def invalidate(key: str | None = None) -> None:
    """Bayrak değiştikten sonra bu süreçte anında etkili olması için."""
    if key is None:
        _cache.clear()
    else:
        _cache.pop(key, None)


def _cache_get(key: str) -> bool | None:
    hit = _cache.get(key)
    if hit is None:
        return None
    expires_at, value = hit
    if time.monotonic() >= expires_at:
        _cache.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: bool) -> None:
    _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, value)


# ── Okuma ────────────────────────────────────────────────────────────────────


async def is_enabled(db: AsyncSession | None, key: str) -> bool:
    """Bayrak açık mı? Okuma başarısızsa **KAPALI** döner (fail-closed).

    ``db=None`` yalnız DB'ye erişimi olmayan saf bağlamlar için katalog
    varsayılanını döndürür (ör. testler, açılış öncesi raporlama).
    """
    flag = spec(key)

    cached = _cache_get(key)
    if cached is not None:
        return cached

    if db is None:
        return flag.default

    try:
        row = (
            await db.execute(
                select(FeatureFlag.enabled).where(FeatureFlag.key == key)
            )
        ).scalar_one_or_none()
    except Exception:  # noqa: BLE001
        # Hata ÖNBELLEĞE YAZILMAZ: geçici arıza kalıcı kapanmaya dönüşmesin.
        # Stack trace anahtar başına BİR kez yazılır: DB düşükken bu fonksiyon
        # her istekte çağrılır ve `exc_info` bir log-flood üreticisine dönüşür.
        first = key not in _traced
        _traced.add(key)
        logger.error(
            "Özellik bayrağı okunamadı (key=%s) — fail-closed: kapalı sayılıyor",
            key,
            exc_info=first,
        )
        return False

    value = flag.default if row is None else bool(row)
    _cache_set(key, value)
    return value


async def all_flags(db: AsyncSession | None) -> dict[str, bool]:
    """Katalogdaki tüm bayrakların güncel durumu (panel ve sağlık raporu için)."""
    return {s.key: await is_enabled(db, s.key) for s in FLAG_SPECS}


async def probe(db: AsyncSession) -> None:
    """Bayrak deposu gerçekten okunabiliyor mu? Okunamıyorsa **yükseltir**.

    `is_enabled` bilinçli olarak fail-closed'dır ve hatayı yutar; bu, çalışma
    zamanında doğru davranış ama açılışta iki farklı durumu ayırt edilemez hâle
    getirir: "operatör bu kolu kapattı" ile "bayrak tablosunu hiç okuyamıyorum"
    (ör. migration koşulmamış bir deploy). İkincisinde mağaza kolu da kapanır ve
    tek sinyal bir WARNING satırı olur.

    Açılış bu fonksiyonla ayrımı yapar; üretimde okunamıyorsa açılmamak doğru
    davranıştır (`core/config.py::_guard_production` felsefesi).
    """
    await db.execute(select(FeatureFlag.enabled).limit(1))
