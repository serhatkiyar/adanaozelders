"""İlan öne çıkarma paketleri — katalog kodda, tek doğruluk kaynağı.

Neden DB değil kod: paket sayısı üçtür, fiyat operasyon sırasında değil ürün
kararıyla değişir ve her değişiklik yasal metinle (hizmet koşulları, ön
bilgilendirme) birlikte gözden geçirilmelidir. `core/flags.py` ve
`core/admin_permissions.py` ile aynı disiplin: katalog kodda, operatör kararı
DB'de. Fiyatın panelden anlık değiştirilebilmesi, metinle fiyatın sessizce
ayrışmasına yol açardı.

Fiyat KDV **dahildir** (`services/tax.py` fiyatları brüt kabul eder). Satın alma
anındaki fiyat kayda snapshot olarak yazılır; buradaki değer sonradan değişse
bile geçmiş kayıt değişmez.

DİKKAT: `SLOT_LIMIT` yalnız bir sayı değil, bir ürün taahhüdüdür — arama
sonuçlarının kaçının reklam olabileceğini söyler ve sıralama kriterleri
sayfasında yayımlanır. Değiştirmek o metni de değiştirmeyi gerektirir.
"""
from __future__ import annotations

import dataclasses
from decimal import Decimal

#: Arama sonuçlarının üstünde aynı anda gösterilebilecek en fazla ilan.
SLOT_LIMIT = 3

#: Bir eğitmenin aynı anda taşıyabileceği en fazla açık kayıt (aktif + kuyruk).
#: Sonsuz stoklama gelir gibi görünür ama satılan şey RAF ÖMRÜDÜR: bir eğitmen
#: aylarca ileriye satın alırsa slotlar kilitlenir ve diğer eğitmenlere satacak
#: yer kalmaz.
MAX_OPEN_PER_TUTOR = 2


@dataclasses.dataclass(frozen=True, slots=True)
class PromotionPackage:
    days: int
    price: Decimal
    label: str


PROMOTION_PACKAGES: tuple[PromotionPackage, ...] = (
    PromotionPackage(days=7, price=Decimal("149.00"), label="7 gün"),
    PromotionPackage(days=15, price=Decimal("249.00"), label="15 gün"),
    PromotionPackage(days=30, price=Decimal("399.00"), label="30 gün"),
)

_BY_DAYS: dict[int, PromotionPackage] = {p.days: p for p in PROMOTION_PACKAGES}


def package_for(days: int) -> PromotionPackage | None:
    """Katalogda olmayan gün sayısı satın alınamaz (istemci uydurmasın)."""
    return _BY_DAYS.get(days)
