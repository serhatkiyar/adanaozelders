"""Tedarikçi katmanı — YAPISAL SÖZLEŞME (kaynak kodun yapısı).

## Bu dosya DÜŞÜK GÜÇLÜDÜR

Kök `CLAUDE.md` § C: kaynak/AST taraması bir özelliğin çalıştığını kanıtlamaz.
Buradaki her madde için yanında bir **davranış testi** vardır
(`tests/integration/test_supplier_*.py`). Bu dosyanın işi farklı: bir gün
birileri kısa yoldan `p.stock = tedarikci_stogu` yazdığında, davranış testleri
hâlâ yeşil kalabilir (o yol o testte uğranmıyor olabilir) ama defter sessizce
yalancı olur. `test_stock_ledger_contract.py` bu boşluğu `services/` ve `core/`
KÖKÜ için kapatıyor; `core/suppliers/` bir ALT DİZİN olduğu için o taramanın
dışında kalıyor — burası o boşluğu kapatır.

## Neden `float` yasağı AST ile ölçülüyor

`Decimal("51.0219")` ile `Decimal(str(51.0219))` doğru, `Decimal(51.0219)` ve
`float(x)` yanlıştır; yanlış olan da **çalışır** ve yalnız kuruş farkı üretir.
Kuruş farkı hiçbir testi kırmaz, marj raporunu kaydırır. Bu yüzden yazımın
kendisi yasaklanır.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[2]

SUPPLIER_PKG = "core/suppliers"
SYNC_SERVICE = "services/supplier_sync_service.py"

#: Defterin yazma fonksiyonları. Tedarikçi katmanı bunları ÇAĞIRAMAZ:
#: tedarikçi stoğu bizim rafımız değildir (D-1).
LEDGER_WRITERS = {"apply_movement", "apply_many"}


def _rels() -> list[str]:
    kok = BACKEND / SUPPLIER_PKG
    if not kok.exists():
        return []
    return sorted(
        str(p.relative_to(BACKEND)).replace("\\", "/") for p in kok.rglob("*.py")
    )


def _tum_dosyalar() -> list[str]:
    return _rels() + ([SYNC_SERVICE] if (BACKEND / SYNC_SERVICE).exists() else [])


def _tree(rel: str) -> ast.Module:
    return ast.parse((BACKEND / rel).read_text(encoding="utf-8"))


def test_tedarikci_paketi_var():
    assert (BACKEND / SUPPLIER_PKG).is_dir(), (
        f"{SUPPLIER_PKG} yok — sağlayıcı soyutlaması yazılmadı"
    )
    assert (BACKEND / SYNC_SERVICE).exists(), f"{SYNC_SERVICE} yok"


def test_tedarikci_katmani_urun_stoguna_yazmaz():
    """D-1. Yıldırım'ın stoğu `products.stock`'a ASLA kopyalanmaz.

    Kopyalansaydı: sayım oturumu tedarikçi stoğunu "raftaki mal" sanıp fark
    üretir, hasar defteri olmayan malı hasarlı yazabilir ve bir sonraki senkron
    gerçek satış düşümlerini geri ezerdi."""
    ihlaller: list[str] = []
    for rel in _tum_dosyalar():
        for node in ast.walk(_tree(rel)):
            hedefler: list[ast.AST] = []
            if isinstance(node, ast.Assign):
                hedefler = list(node.targets)
            elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
                hedefler = [node.target]
            for t in hedefler:
                if isinstance(t, ast.Attribute) and t.attr in {"stock", "damaged_stock"}:
                    ihlaller.append(f"{rel}:{node.lineno}")
    assert ihlaller == [], (
        "Tedarikçi katmanı ürün stoğuna yazıyor (D-1 ihlali): "
        + ", ".join(ihlaller)
    )


def test_senkron_defteri_cagirmaz():
    """Tedarikçi senkronu defter hareketi ÜRETMEZ. Ürettiği anda "elimizde
    olmayan mal" raf bakiyesine girer ve sayım her turda fark raporlar."""
    if not (BACKEND / SYNC_SERVICE).exists():
        pytest.fail(f"{SYNC_SERVICE} yok")
    cagrilar: set[str] = set()
    for n in ast.walk(_tree(SYNC_SERVICE)):
        if isinstance(n, ast.Call):
            if isinstance(n.func, ast.Attribute):
                cagrilar.add(n.func.attr)
            elif isinstance(n.func, ast.Name):
                cagrilar.add(n.func.id)
    kesisim = cagrilar & LEDGER_WRITERS
    assert kesisim == set(), (
        f"{SYNC_SERVICE} defter yazıcısı çağırıyor: {sorted(kesisim)}"
    )


def test_para_ve_stokta_float_kullanilmaz():
    """D-4. `float(...)` çağrısı tedarikçi katmanında yasaktır."""
    ihlaller: list[str] = []
    for rel in _tum_dosyalar():
        for n in ast.walk(_tree(rel)):
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
                if n.func.id == "float":
                    ihlaller.append(f"{rel}:{n.lineno}")
    assert ihlaller == [], (
        "Para/stok hesabında float kullanılmış (D-4 ihlali): " + ", ".join(ihlaller)
    )


def test_decimal_dogrudan_floattan_kurulmaz():
    """`Decimal(x)` yalnız dizgi/tamsayı sabitten kurulabilir.

    `Decimal(51.0219)` ikili kayan noktanın TÜM artığını taşır
    (51.02189999999999941...). Doğru yazım `Decimal(str(x))`."""
    ihlaller: list[str] = []
    for rel in _tum_dosyalar():
        for n in ast.walk(_tree(rel)):
            if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Name)):
                continue
            if n.func.id != "Decimal" or not n.args:
                continue
            arg = n.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, float):
                ihlaller.append(f"{rel}:{n.lineno}")
    assert ihlaller == [], (
        "Decimal doğrudan float sabitten kuruluyor: " + ", ".join(ihlaller)
    )


def test_uygunluk_yuklemi_tek_kaynakta():
    """D-2. SQL ve Python ikizleri AYNI modülde durur.

    Ayrı dosyalara dağılsalardı biri güncellenip diğeri unutulurdu ve sonuç
    şudur: liste "stokta" der, detay "tükendi" der. `_in_stock` ile arama
    yükleminin ayrışması bu projede bir kez zaten yaşandı."""
    from core import stock_policy

    for ad in ("satilabilir_yuklemi", "tedarikci_temin_yuklemi", "satilabilir_mi"):
        assert hasattr(stock_policy, ad), f"core/stock_policy.{ad} yok"


def test_tedarikci_yaniti_tokeni_tasimaz():
    """D-5. Şemada alan YOKSA sızıntı da olamaz — 403'e güvenmekten güçlüdür."""
    from schemas.supplier import SupplierOut

    alanlar = set(SupplierOut.model_fields)
    yasak = {"api_token", "token", "bearer", "secret"}
    assert alanlar & yasak == set(), (
        f"SupplierOut token taşıyor: {sorted(alanlar & yasak)}"
    )
    assert "has_token" in alanlar, (
        "Panel token'ın GİRİLİ olup olmadığını göstermeli — değerini değil"
    )
