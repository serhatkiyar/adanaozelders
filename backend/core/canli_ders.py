"""Canlı ders kuralları — saf, tek kaynak.

Hem şema (`schemas/booking.py::BookingOut._gate_meeting_room`) hem canlı ders
token uçları (`api/routers/bookings.py::_canli_ders_kapilari`) buradan okur.
Kural bir yerde değişirse diğerinde de değişir: oda adı gizli kalıp token
verilmesi (ya da tersi) böylece imkânsızlaşır.
"""
from __future__ import annotations

import datetime
from collections.abc import Iterable, Mapping
from decimal import Decimal

from models.booking import PAYMENT_CHANNEL_DIRECT
from models.payment import PaymentStatus

# Katılım penceresi. Bu iki değer `frontend/src/lib/lesson.ts` içindeki
# JOIN_OPENS_BEFORE_MIN / JOIN_CLOSES_AFTER_MIN ile AYNI olmalıdır: ayrışırsa
# arayüz "Derse Katıl" düğmesini gösterirken sunucu 409 döner (ya da tersi).
KATILIM_ACILIS = datetime.timedelta(minutes=15)
KATILIM_KAPANIS = datetime.timedelta(minutes=30)


def ders_odasi_acik_mi(
    payment_status: PaymentStatus | str | None,
    price: Decimal | float | int | None,
    *,
    payment_channel: str | None = None,
) -> bool:
    """Canlı ders odası (adı ve token'ı) bu ders için açılabilir mi?

    Ödeme emanete alınmışsa (HELD/RELEASED) ya da ders ücretsizse (price==0).
    Aksi halde öğrenci ödeme yapmadan canlı derse girebilirdi.

    Doğrudan ödemeli (DIRECT) derste platform para tutmaz; ücret eğitmene
    platform dışında ödenir, bu yüzden oda kabulle birlikte açıktır. Kanal
    sunucuda, ilk kabulde yazılır; istemciden gelmez.
    """
    if payment_channel == PAYMENT_CHANNEL_DIRECT:
        return True
    odendi = payment_status in (PaymentStatus.HELD, PaymentStatus.RELEASED)
    ucretsiz = price is not None and price == 0
    return odendi or ucretsiz


# ── Paralel sağlayıcı ataması ────────────────────────────────────────────────
# zoom ve agora aynı anda kullanılır; kullanıcı seçmez. Her ders, ilk giriş
# biletinde bunlardan birine KALICI atanır (`services/canli_ders_saglayici.py`).
PARALEL_SAGLAYICILAR: tuple[str, ...] = ("zoom", "agora")
# Kullanım tahmini: bir ders = süresi × 2 kişi-dakikası (eğitmen + öğrenci).
DERS_KISI_SAYISI = 2


def saglayici_sec(
    *,
    anahtarli: Iterable[str],
    kotalar: Mapping[str, int],
    kullanim: Mapping[str, float],
    varsayilan: str,
) -> str | None:
    """Yeni bir derse hangi sağlayıcı atanır? Saf kural, tek kaynak.

    - Aday: anahtarı tanımlı paralel sağlayıcılar. Anahtarsız sağlayıcı HİÇ
      seçilmez; aday yoksa None (çağıran 503 döner, atama yapılmaz).
    - Bu ay kalan ücretsiz kişi-dakikası (kota − kullanım) > 0 olanlar
      arasından kalanı en çok olan. Eşitlikte varsayılan, sonra sabit sıra.
    - Hepsi tükenmişse varsayılan (anahtarı varsa); yoksa en az aşan aday.
    """
    adaylar = [s for s in PARALEL_SAGLAYICILAR if s in set(anahtarli)]
    if not adaylar:
        return None

    def kalan(s: str) -> float:
        return kotalar.get(s, 0) - kullanim.get(s, 0)

    # Sıralama anahtarı: kalan çok olan önce; eşitlikte varsayılan önce.
    def sira(s: str) -> tuple[float, int]:
        return (-kalan(s), 0 if s == varsayilan else 1)

    kalanli = [s for s in adaylar if kalan(s) > 0]
    if kalanli:
        return min(kalanli, key=sira)
    if varsayilan in adaylar:
        return varsayilan
    return min(adaylar, key=sira)


def ay_araligi(an: datetime.datetime) -> tuple[datetime.datetime, datetime.datetime]:
    """`an`ın takvim ayı [başı, sonraki ayın başı) — UTC. Sağlayıcıların aylık
    ücretsiz dakikası UTC ay sınırıyla sıfırlanır varsayımı."""
    an = an.astimezone(datetime.timezone.utc)
    bas = an.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if bas.month == 12:
        son = bas.replace(year=bas.year + 1, month=1)
    else:
        son = bas.replace(month=bas.month + 1)
    return bas, son
