"""F29 API yüzeyine **tembel** erişim — commit 2'de bu modüller HENÜZ YOK.

## Neden bu dosya var

Önceki pakette kırmızı matris, olmayan modülü dosya başında import ediyordu:
koşum **toplama hatası** (collection error) veriyordu. Toplama hatası da
kırmızıdır ama üç zayıflığı var: (1) hangi kabul kriterinin karşılanmadığı
okunmaz, tek bir `ImportError` görünür; (2) testlerin **çalıştırılabilir**
olduğu gösterilemez; (3) tek bir eksik isim, dosyadaki 20 testin tamamını
görünmez yapar.

Burada erişim tembeldir: her test **koşar** ve eksik parçayı adıyla söyleyerek
kırılır. Böylece `pytest -q` çıktısı doğrudan "hangi sözleşme henüz yok"
listesidir.

## Neden `pytest.importorskip` DEĞİL

`importorskip` SKIP üretir. Repo standardı (kök `CLAUDE.md` → Test Kalitesi,
§A/§I) eksik davranışın SKIP'e gömülmesini kabul etmez: SKIP yeşil koşumda
görünmez ve "hepsi geçti" yanılsaması üretir. Eksik davranış **kırmızıdır**.

## Yanlış pozitif koruması

Yardımcı, YALNIZ beklenen modülün eksikliğini yutar. İmplementasyon geldikten
sonra modülün İÇİNDE oluşan bir `ModuleNotFoundError` (yazım hatası, yanlış
import) **olduğu gibi yükselir** — aksi hâlde bu dosya, gerçek bir hatayı
"henüz yazılmadı" diye maskeleyen bir yalancı yeşil kaynağı olurdu.
"""
from __future__ import annotations

import importlib
from types import ModuleType

import pytest

#: F29'un yazacağı modüller ve karşıladıkları kabul kriteri (rapor için).
BEKLENEN = {
    "services.inventory_rules": "saf kurallar: olay etkisi tablosu + FSM geçiş matrisi",
    "services.inventory_service": "sayım oturumu + hasar işlemleri (DB)",
    "models.inventory": "StockCountSession / StockCountLine / StockDamageEvent",
}


def modul(ad: str) -> ModuleType:
    """`ad` modülünü getirir; henüz yazılmadıysa okunur bir mesajla KIRILIR."""
    try:
        return importlib.import_module(ad)
    except ModuleNotFoundError as exc:
        # Yalnız modülün KENDİSİ eksikse "henüz yok" de. İçeriden gelen bir
        # ModuleNotFoundError gerçek bir hatadır ve maskelenmemelidir.
        if exc.name != ad:
            raise
        pytest.fail(
            f"HENÜZ YAZILMADI: {ad} — {BEKLENEN.get(ad, '')}", pytrace=False
        )


def uye(ad: str, isim: str):
    """Modüldeki bir ismi getirir; yoksa hangi ismin eksik olduğunu söyler."""
    m = modul(ad)
    try:
        return getattr(m, isim)
    except AttributeError:
        pytest.fail(f"HENÜZ YAZILMADI: {ad}.{isim}", pytrace=False)


def kurallar() -> ModuleType:
    return modul("services.inventory_rules")


def servis() -> ModuleType:
    return modul("services.inventory_service")


def modeller() -> ModuleType:
    return modul("models.inventory")
