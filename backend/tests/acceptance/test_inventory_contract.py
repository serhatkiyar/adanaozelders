"""F29 YAPISAL sözleşmeleri — kaynak/AST taraması (DÜŞÜK GÜÇLÜ).

Repo standardı (kök `CLAUDE.md` → §C) bu tür testleri **düşük güçlü** sayar:
"kod böyle yazılmış" der, "davranış doğru" demez. Bu yüzden buradaki her
madde yalnız **mimari/yapısal** bir sözleşmedir ve her birinin yanında bir
davranış testi vardır (aşağıda adıyla belirtilir).

Kurallar:
* sınıf/fonksiyon sınırı **AST ile** bulunur (`find()` + sabit karakter
  penceresi KULLANILMAZ — bir kez bu tuzağa düşüldü),
* docstring'ler taramadan çıkarılır (yorum metni yalancı eşleşme üretmesin),
* test kendi kaynağını yakalayamaz.

Paketin ilk test commit'i olduğu için çoğu madde KIRMIZIDIR.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[2]

YENI_IZINLER = ("inventory.view", "inventory.count", "inventory.apply")

#: Hijyen nöbetçisinin izlemesi gereken yeni tablolar (test izolasyonu).
YENI_TABLOLAR = (
    "stock_count_sessions",
    "stock_count_lines",
    "stock_count_line_events",
    "stock_damage_events",
)


def _agac(rel: str) -> ast.Module:
    yol = BACKEND / rel
    if not yol.exists():
        pytest.fail(f"HENÜZ YAZILMADI: {rel}", pytrace=False)
    return ast.parse(yol.read_text(encoding="utf-8"))


def _dugum(agac: ast.Module, isim: str):
    for d in ast.walk(agac):
        if isinstance(d, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if d.name == isim:
                return d
    return None


def _dump_docstringsiz(dugum) -> str:
    """Docstring'i çıkarılmış AST dökümü — açıklama metni eşleşme üretmesin."""
    kopya = ast.parse(ast.unparse(dugum))
    for d in ast.walk(kopya):
        if isinstance(d, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)):
            if (
                d.body
                and isinstance(d.body[0], ast.Expr)
                and isinstance(d.body[0].value, ast.Constant)
                and isinstance(d.body[0].value.value, str)
            ):
                d.body = d.body[1:] or [ast.Pass()]
    return ast.dump(kopya)


# ── İzin kataloğu kablolaması ──────────────────────────────────────────────

def test_yeni_izinler_KATALOGDA():
    """Katalogda olmayan izin hiçbir role bağlanamaz → sessiz 403.
    Davranış eşi: `test_inventory_endpoints_pg.py::test_APPLY_izniyle_tam_akis_200`."""
    from core.admin_permissions import PERMISSION_CODES

    eksik = [k for k in YENI_IZINLER if k not in PERMISSION_CODES]
    assert not eksik, f"kataloğa eklenmemiş izinler: {eksik}"


def test_izin_migrationi_ROL_DAGITIMI_yapar():
    """Katalog + DB + ROL üçlüsünden biri eksikse izin işe yaramaz.

    Migration dosyası SUPER_ADMIN ve COMMERCE_MANAGER'a üç izni de,
    OPERATIONS_MANAGER'a yalnız `inventory.view`'ı vermelidir (plan §6.3).
    """
    versions = BACKEND / "migrations" / "versions"
    adaylar = [
        p for p in versions.glob("*.py")
        if "inventory" in p.read_text(encoding="utf-8")
    ]
    if not adaylar:
        pytest.fail("HENÜZ YAZILMADI: inventory izinlerini seed eden migration",
                    pytrace=False)
    metin = "\n".join(p.read_text(encoding="utf-8") for p in adaylar)
    for kod in YENI_IZINLER:
        assert kod in metin, f"migration'da yok: {kod}"
    for rol in ("SUPER_ADMIN", "COMMERCE_MANAGER", "OPERATIONS_MANAGER"):
        assert rol in metin, f"rol dağıtımı eksik: {rol}"


# ── Test izolasyonu ────────────────────────────────────────────────────────

def test_yeni_tablolar_HIJYEN_NOBETCISINDE():
    """Yeni tablo nöbetçiye eklenmezse, sızan satırlar suite'i kırmaz ve
    test verisi zamanla admin ekranlarını şişirir (bir kez yaşandı: 2013 ürün).
    """
    from tests.integration.conftest import _KRITIK_TABLOLAR

    eksik = [t for t in YENI_TABLOLAR if t not in _KRITIK_TABLOLAR]
    assert not eksik, f"hijyen nöbetçisine eklenmemiş tablolar: {eksik}"


# ── Kilit sırası (yapısal ipucu — asıl koruma davranış testinde) ───────────

def test_apply_session_ONCE_oturumu_claim_eder_SONRA_urun_kilitler():
    """Yapısal ipucu. **Asıl koruma** gerçek yarış testidir:
    `test_inventory_lock_order_pg.py` (ters başlatma, 5 çift, lock_timeout).

    Burada yalnız çağrı SIRASI denetlenir: `claim` benzeri oturum geçişi,
    `lock_products`'tan ÖNCE görünmelidir. Ters sıra `Product →
    StockCountSession` kilit yolunu açar ve satışla döngü kurar.
    """
    agac = _agac("services/inventory_service.py")
    fn = _dugum(agac, "apply_session")
    if fn is None:
        pytest.fail("HENÜZ YAZILMADI: inventory_service.apply_session", pytrace=False)

    sira: list[str] = []
    for d in ast.walk(fn):
        if isinstance(d, ast.Call):
            ad = ast.unparse(d.func)
            if "claim" in ad or "_claim_status" in ad:
                sira.append("claim")
            elif "lock_products" in ad:
                sira.append("lock")
    assert "claim" in sira, "oturum durumu koşullu UPDATE ile claim edilmiyor"
    assert "lock" in sira, "ürünler kilitlenmiyor"
    assert sira.index("claim") < sira.index("lock"), (
        "kilit sırası ihlali: ürün kilidi oturum claim'inden ÖNCE alınıyor"
    )


def test_urun_kilidi_YALNIZ_stock_ledger_lock_products_ile_alinir():
    """`stock_ledger.lock_products` ürün kilidi alan TEK yerdir (commit 4).
    Envanter servisi kendi `with_for_update`'ini açarsa sıra disiplini ikiye
    bölünür. Davranış eşi: `test_inventory_lock_order_pg.py` tüm çiftler."""
    agac = _agac("services/inventory_service.py")
    kaynak = ast.dump(agac)
    assert "with_for_update" not in kaynak or "lock_products" in kaynak
    for d in ast.walk(agac):
        if isinstance(d, ast.Call) and "with_for_update" in ast.unparse(d.func):
            hedef = ast.unparse(d)
            assert "Product" not in hedef, (
                f"ürün kilidi lock_products dışında alınıyor: {hedef}"
            )


# ── Parasal değerleme yasağı ───────────────────────────────────────────────

@pytest.mark.parametrize(
    "rel", ["models/inventory.py", "services/inventory_service.py",
            "services/inventory_rules.py", "schemas/inventory.py"]
)
def test_envanter_katmani_PARASAL_alan_TASIMAZ(rel):
    """Direktif: F29 parasal değerleme yapmaz. Docstring'ler taramadan
    çıkarılır — 'parasal değerleme yoktur' açıklaması testi kırmasın."""
    agac = _agac(rel)
    yasak = ("price", "cost", "amount", "currency", "tutar", "maliyet", "value_try")
    dokum = _dump_docstringsiz(agac).lower()
    bulunan = [k for k in yasak if k in dokum]
    assert not bulunan, f"{rel} içinde parasal kavram: {bulunan}"


# ── Router kaydı ───────────────────────────────────────────────────────────

def test_inventory_routeri_api_routera_KAYITLI():
    """Router include edilmezse uçlar 404 döner ve yetki testleri de 'geçer'
    gibi görünmez — ama menü de gizli olduğu için hata sessiz kalır."""
    metin = (BACKEND / "api" / "router.py").read_text(encoding="utf-8")
    assert "inventory" in metin, "api/router.py'de inventory router'ı yok"
