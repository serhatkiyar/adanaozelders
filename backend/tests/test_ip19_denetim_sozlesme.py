"""İP-19 bağımsız denetim düzeltmeleri — saf birim düğümleri.

Bağımsız denetim raporunun (15 Ağu 2026) merge'i durduran üç bulgusundan
ikisinin birim yüzü. Davranış yüzü `tests/integration/test_ip19_denetim_pg.py`
ve `tests/integration/test_routing_live_vroom.py` içindedir.

**Üretim kodundan ÖNCE yazıldı** (kök CLAUDE.md §E).

Düğümler
--------
Y-1  `_arac_tavani`: aracın EFEKTİF durak tavanı tek yerde çözülür.
Y-2  `_route_vehicle` rota katmanına ASLA tavansız araç vermez (B-2).
Y-3  `AddressCreate` il/ilçe olmadan adres kabul etmez (B-3).
Y-4  `AddressUpdate` il/ilçeyi boş stringe düşüremez (B-3).
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from core.config import settings


# ── Y-1/Y-2 · B-2: tavan tek kaynaktan ────────────────────────────────────────
#
# 🔴 Denetim bulgusu B-2. `dispatch_day` günün tavanını
# `rv.max_stops or settings.DELIVERY_MAX_STOPS_PER_RUN` ile hesaplıyor ama
# `_route_vehicle` rota katmanına ham `v.max_stops`'u (NULL) veriyor. İki ifade
# ayrışıyor: tavan iki araç sayıyor, sağlayıcı hiç kısıt görmüyor ve
# haversine `vehicles[:1]` ile TEK araç kullanıyor → "80 siparişe söz ver,
# 1 araca yükle". Sözleşme §0.2'nin kapattığını iddia ettiği tuzağın aynısı,
# yalnız yeri değişmiş hâli.
#
# İddia: efektif tavan TEK bir fonksiyonda çözülür ve rota katmanına giden
# araç nesnesi o çözülmüş sayıyı taşır — `None` sızamaz.


def _arac(max_stops=None):
    from models.vehicle import Vehicle

    return Vehicle(
        code="TEST", label="Test", max_stops=max_stops, fixed_cost=0, profile="car"
    )


def test_Y1_arac_tavani_NULL_olani_platform_varsayilanina_cozer():
    """`max_stops` NULL = "kısıt yok" DEĞİL, "platform varsayılanı"."""
    from services.delivery_service import _arac_tavani

    assert _arac_tavani(_arac(max_stops=None)) == settings.DELIVERY_MAX_STOPS_PER_RUN
    assert _arac_tavani(_arac(max_stops=12)) == 12


def test_Y2_route_vehicle_rota_katmanina_tavansiz_arac_vermez():
    """Sağlayıcıya giden araç HER ZAMAN sayısal tavan taşır (B-2'nin kökü)."""
    from models.pickup_point import PickupPoint
    from services.delivery_service import _route_vehicle

    baz = PickupPoint(name="Baz", kind="BASE", lat=36.9855, lng=35.3253)

    rv = _route_vehicle(_arac(max_stops=None), baz)
    assert rv is not None
    assert rv.max_stops == settings.DELIVERY_MAX_STOPS_PER_RUN, (
        "rota katmanı tavansız araç gördü — VROOM'a max_tasks yazılmaz, "
        "haversine tek araçla yetinir (B-2)"
    )

    rv2 = _route_vehicle(_arac(max_stops=7), baz)
    assert rv2 is not None and rv2.max_stops == 7, "araca özel tavan ezildi"


def test_Y2b_gunluk_tavan_ile_rota_tavani_AYNI_fonksiyondan_turer():
    """Doluluk nöbetçisi: iki sayı aynı kaynaktan gelmeli.

    Bu düğüm bilinçli olarak DAVRANIŞSAL değil YAPISALDIR (§C: düşük güçlü) —
    davranış yüzü `test_ip19_denetim_pg.py::test_B2_*`'dedir. Buradaki iddia
    dar ama kesin: `gunluk_tavan` ve `_route_vehicle` aynı yardımcıyı çağırır,
    yani ayrışmaları için birinin diğerinden habersiz DEĞİŞTİRİLMESİ gerekir.
    """
    import ast
    import inspect
    import textwrap

    from services import delivery_service

    def _cagrilar(fn) -> set[str]:
        agac = ast.parse(textwrap.dedent(inspect.getsource(fn)))
        return {
            d.func.id
            for d in ast.walk(agac)
            if isinstance(d, ast.Call) and isinstance(d.func, ast.Name)
        }

    assert "_arac_tavani" in _cagrilar(delivery_service.gunluk_tavan)
    assert "_arac_tavani" in _cagrilar(delivery_service._route_vehicle)


# ── Y-3/Y-4 · B-3: ilçe olmadan adres kaydedilemez ────────────────────────────
#
# 🔴 Denetim bulgusu B-3. K-10 ile bölge otoritesi İLÇE LİSTESİ oldu ve
# `in_delivery_zone` ilçe yoksa `False` dönüyor. Ama adres şeması ilçeyi
# `default=None` bırakıyor ve form onu zorunlu tutmuyor: pin'ini haritadan
# işaretlemiş bir müşteri ilçesiz kaydedebiliyor ve siparişi sessizce "bölge
# dışı" oluyor — düşeceği dış kargo kuyruğu ise henüz yazılmadı (İP-20).
# Ölçüm: geliştirme kataloğundaki 2 adresin 2'si de bu durumda.


def test_Y3_adres_olusturma_il_ve_ilce_ISTER():
    from schemas.address import AddressCreate

    tam = dict(title="Ev", address_line="Mahalle Sok. 1", city="Adana", district="Seyhan")
    AddressCreate(**tam)  # tam kayıt geçer

    for eksik in ("city", "district"):
        veri = {k: v for k, v in tam.items() if k != eksik}
        with pytest.raises(ValidationError):
            AddressCreate(**veri)

    for bos in ("city", "district"):
        with pytest.raises(ValidationError):
            AddressCreate(**{**tam, bos: "   "})


def test_Y4_adres_guncelleme_il_ilceyi_bosa_dusuremez():
    from schemas.address import AddressUpdate

    AddressUpdate(district="Çukurova")  # kısmi güncelleme çalışmaya devam eder
    AddressUpdate(title="Yeni başlık")  # il/ilçeye dokunmayan güncelleme serbest
    AddressUpdate()  # None = "dokunma" (kısmi güncelleme kipi korunur)

    # ...ama DOLU bir alanı boşa çekmek başka şeydir: adres bölge sınıfını
    # kaybeder ve sipariş sessizce dış kargo kuyruğuna düşer.
    for bos in ("", "   "):
        with pytest.raises(ValidationError):
            AddressUpdate(district=bos)
        with pytest.raises(ValidationError):
            AddressUpdate(city=bos)
