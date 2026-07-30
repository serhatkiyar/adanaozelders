"""Stok hareket defteri — DAVRANIŞ SÖZLEŞMESİ (kaynak kodun yapısı).

## Bu testin varlık sebebi

Defterin değeri "yazıldı mı" değil, **"atlanabilir mi"** sorusuna verdiği
cevaptır. `products.stock`'a doğrudan atama yapan tek bir yeni satır, defteri
sessizce yalancı yapar: sayı değişir, hareket yazılmaz, `verify_ledger` sapma
raporlar ama kimse bakmaz. Bu yüzden burada davranış değil **kaynak kodun
yapısı** doğrulanır — PK-1'in `test_payment_gate_wiring.py` dosyasıyla aynı
yaklaşım (o denetim de "testler kapıyı çağırıyor ama kapının kablolandığını
kimse doğrulamıyor" boşluğunu böyle kapattı).

## Neden HTTP testi yetmez

Stok mutasyonları ödeme callback'i, iade kabulü ve CSV içe aktarma gibi
kurulumu ağır yollardan geçiyor. HTTP seviyesinde her yolu kurmak, testi
korumadan daha kırılgan yapar; üstelik `setattr(p, field, ...)` gibi **dinamik**
bir yazımı hiçbir davranış testi "doğrudan mutasyon" olarak teşhis edemez.
Bu yüzden dinamik yol ayrı bir kuralla kapatılır: `stock`, düzenlenebilir alan
listesinde bulunmaz (bkz. `test_stok_editable_listesinde_degil`).

Paketin ilk commit'i olduğu için implementasyon yok: koşum kırmızıdır.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[2]

#: Defterin tek yazıcısı. Bu dosya dışında `products.stock`'a atama yasak.
LEDGER = "services/stock_ledger.py"

#: Mutasyonun geçmesi gereken fonksiyonlar. `apply_many`, çok ürünlü işlemlerde
#: ürünleri artan `product_id` sırasıyla kilitleyen toplu sarmalayıcıdır — kilit
#: sırası disiplinini her çağırana bırakmak yerine TEK yerde tutar.
APPLY = "apply_movement"
APPLY_MANY = "apply_many"

#: (dosya, fonksiyon) → gövdesinde `apply_movement` çağrısı ARANAN yerler.
#: Bunlar §1a envanterindeki altı yazma noktasıdır.
INVENTORY: list[tuple[str, str]] = [
    ("services/order_service.py", "_finalize_paid"),     # W1 SALE
    ("services/order_service.py", "_restock"),           # W2 SALE_CANCEL
    ("services/order_service.py", "_restock_items"),     # W3 RETURN
    ("services/store_service.py", "create_product"),     # W4 INITIAL
    ("services/store_service.py", "bulk_import_products"),  # W5 INITIAL
    ("services/store_service.py", "update_product"),     # W6 ADMIN_ADJUSTMENT
]

#: Çok ürünlü işlemler `apply_many` kullanmak ZORUNDA: kilit sırası (artan
#: product_id) tek yerde garanti edilir, üç çağıranın üçünde tekrarlanmaz.
MUST_BATCH: list[tuple[str, str]] = [
    ("services/order_service.py", "_finalize_paid"),
    ("services/order_service.py", "_restock"),
    ("services/order_service.py", "_restock_items"),
]


def _read(rel: str) -> str:
    return (BACKEND / rel).read_text(encoding="utf-8")


def _tree(rel: str) -> ast.Module:
    return ast.parse(_read(rel))


def _func(rel: str, name: str) -> ast.AST:
    for node in ast.walk(_tree(rel)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    raise AssertionError(f"{rel} içinde {name} bulunamadı")


def _calls(node: ast.AST) -> set[str]:
    """Gövdedeki çağrı adları (hem `f()` hem `mod.f()`)."""
    out: set[str] = set()
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            if isinstance(n.func, ast.Name):
                out.add(n.func.id)
            elif isinstance(n.func, ast.Attribute):
                out.add(n.func.attr)
    return out


def _source_files() -> list[str]:
    rels: list[str] = []
    for sub in ("services", "api/routers", "api", "core"):
        for p in (BACKEND / sub).glob("*.py"):
            rels.append(str(p.relative_to(BACKEND)).replace("\\", "/"))
    return sorted(set(rels))


# ───────────────── 1. Tek yazma noktası ─────────────────

def test_defter_modulu_var():
    assert (BACKEND / LEDGER).exists(), (
        f"{LEDGER} yok — defterin tek yazma noktası yazılmadı"
    )


def test_products_stock_a_atama_yapan_tek_dosya_defter():
    """`p.stock = ...` / `p.stock += ...` yalnız `stock_ledger.py` içinde olabilir."""
    ihlaller: list[str] = []
    for rel in _source_files():
        if rel == LEDGER:
            continue
        for node in ast.walk(_tree(rel)):
            targets: list[ast.AST] = []
            if isinstance(node, ast.Assign):
                targets = list(node.targets)
            elif isinstance(node, ast.AugAssign):
                targets = [node.target]
            for t in targets:
                if isinstance(t, ast.Attribute) and t.attr == "stock":
                    ihlaller.append(f"{rel}:{node.lineno}")
    assert ihlaller == [], (
        "Bu satırlar stoğu doğrudan yazıyor; hepsi stock_ledger.apply_movement "
        f"üzerinden geçmeli: {', '.join(ihlaller)}"
    )


def test_urun_kurucusunda_ilk_stok_sabit():
    """`Product(stock=...)` yalnız sabit (0 / None) alabilir.

    İlk stoğu constructor'da yazmak, `apply_movement`'ın "mevcut + delta"
    aritmetiğiyle bakiyeyi ÇİFT sayardı. Bu yüzden ürün `stock=0` ile kurulur
    ve ilk bakiye `INITIAL` hareketiyle deftere yazılır.
    """
    ihlaller: list[str] = []
    for rel in _source_files():
        for node in ast.walk(_tree(rel)):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)):
                continue
            if node.func.id != "Product":
                continue
            for kw in node.keywords:
                if kw.arg != "stock":
                    continue
                # Alt ağaçta payload/satır referansı (Attribute) veya çağrı
                # varsa değer sabit değildir.
                dinamik = [
                    n for n in ast.walk(kw.value)
                    if isinstance(n, (ast.Attribute, ast.Call, ast.Subscript))
                ]
                if dinamik:
                    ihlaller.append(f"{rel}:{node.lineno}")
    assert ihlaller == [], (
        "Product(stock=...) sabit olmalı (0/None); ilk bakiye INITIAL "
        f"hareketiyle yazılmalı: {', '.join(ihlaller)}"
    )


@pytest.mark.parametrize("rel,fn", INVENTORY)
def test_alti_mutasyon_noktasi_deftere_yaziyor(rel, fn):
    cagrilar = _calls(_func(rel, fn))
    assert cagrilar & {APPLY, APPLY_MANY}, (
        f"{rel}::{fn} stoğu değiştiriyor ama {APPLY}/{APPLY_MANY} çağırmıyor"
    )


@pytest.mark.parametrize("rel,fn", MUST_BATCH)
def test_cok_urunlu_islemler_toplu_sarmalayiciyi_kullaniyor(rel, fn):
    assert APPLY_MANY in _calls(_func(rel, fn)), (
        f"{rel}::{fn} birden çok ürüne dokunuyor; kilit sırası garantisi için "
        f"{APPLY_MANY} kullanmalı"
    )


def test_toplu_sarmalayici_kilit_sirasini_sabitliyor():
    """Artan `product_id` sırası tek yerde garanti edilir."""
    assert "sorted" in _calls(_func(LEDGER, APPLY_MANY)), (
        f"{APPLY_MANY} ürünleri artan product_id sırasıyla işlemek zorunda; "
        "aksi hâlde çapraz ürünlü iki eşzamanlı sipariş deadlock üretir"
    )


# ───────────────── 2. Clamp yasağı (Karar 5) ─────────────────

def test_stok_kirpma_kalibi_yok():
    """`max(0, p.stock - qty)` deseni sessizce eksik delta yazar → yasak."""
    ihlaller: list[str] = []
    for rel in _source_files():
        for i, line in enumerate(_read(rel).splitlines(), start=1):
            if "max(0" in line and "stock" in line:
                ihlaller.append(f"{rel}:{i}")
    assert ihlaller == [], (
        "Stok kırpılmamalı; yetersizlik InsufficientStock ile sonlanmalı: "
        f"{', '.join(ihlaller)}"
    )


def test_oversell_clamp_kavrami_kodda_hic_yok():
    """rev. 1'de önerilen `OVERSELL_CLAMP` reddedildi; izi kalmasın."""
    ihlaller: list[str] = []
    hedefler = list(_source_files()) + [
        str(p.relative_to(BACKEND)).replace("\\", "/")
        for p in (BACKEND / "models").glob("*.py")
    ] + [
        str(p.relative_to(BACKEND)).replace("\\", "/")
        for p in (BACKEND / "migrations" / "versions").glob("*.py")
    ]
    for rel in hedefler:
        if "OVERSELL_CLAMP" in _read(rel):
            ihlaller.append(rel)
    assert ihlaller == [], f"OVERSELL_CLAMP kaldırıldı: {', '.join(ihlaller)}"


def test_yetersiz_stok_istisnasi_tanimli():
    src = _read(LEDGER)
    assert "class InsufficientStock" in src
    assert "class IdempotencyConflict" in src


# ───────────────── 3. Idempotency (Karar 7) ─────────────────

def test_on_conflict_do_nothing_kullanilmiyor():
    """Sessiz yutma yasak: tekrar, mevcut hareketi DÖNDÜRMELİ; çelişki HATA."""
    src = _read(LEDGER).lower()
    assert "on conflict" not in src
    assert "on_conflict_do_nothing" not in src
    assert "on_conflict_do_update" not in src


def test_idempotency_catismasi_yukseltiliyor():
    """`apply_movement` gövdesinde payload karşılaştırması ve conflict yolu var."""
    fn = _func(LEDGER, APPLY)
    yukseltilenler = {
        n.exc.func.id
        for n in ast.walk(fn)
        if isinstance(n, ast.Raise)
        and isinstance(n.exc, ast.Call)
        and isinstance(n.exc.func, ast.Name)
    }
    assert "IdempotencyConflict" in yukseltilenler
    assert "InsufficientStock" in yukseltilenler


def test_apply_movement_satir_kilidi_aliyor():
    src = ast.dump(_func(LEDGER, APPLY))
    assert "with_for_update" in src, (
        "apply_movement ürün satırını FOR UPDATE ile kilitlemek zorunda"
    )


def test_apply_movement_kendi_commitini_atmiyor():
    """Defter ve stok AYNI transaction'da yazılır; commit çağırana aittir."""
    assert "commit" not in _calls(_func(LEDGER, APPLY))


# ───────────── 4. Dinamik yazım yolunun kapatılması ─────────────

def _editable_strings() -> set[str]:
    """`update_product` içinde `editable` listesine giren tüm dizgiler."""
    fn = _func("services/store_service.py", "update_product")
    out: set[str] = set()
    for node in ast.walk(fn):
        hedef_editable = (
            isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "editable" for t in node.targets)
        ) or (
            isinstance(node, ast.AugAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == "editable"
        )
        if hedef_editable:
            for n in ast.walk(node.value):
                if isinstance(n, ast.Constant) and isinstance(n.value, str):
                    out.add(n.value)
        # editable.append("...") / .extend([...])
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "editable"
        ):
            for arg in node.args:
                for n in ast.walk(arg):
                    if isinstance(n, ast.Constant) and isinstance(n.value, str):
                        out.add(n.value)
    return out


def test_stok_editable_listesinde_degil():
    """`setattr(p, field, ...)` döngüsü stoğu yazamamalı.

    Bu, AST'nin göremediği DİNAMİK mutasyon yolu. Stok bu listede kalırsa
    admin düzenlemesi deftere hiç uğramadan mutlak atama yapar (bugünkü hata).
    """
    assert "stock" not in _editable_strings(), (
        "stock, editable listesinden çıkarılmalı; admin düzeltmesi kilit "
        "altında delta hesaplayıp ADMIN_ADJUSTMENT yazmalı"
    )


def test_kind_editable_listesinde_degil():
    """SKU immutability'sinin ön koşulu.

    SKU `(kind, id)`'nin fonksiyonu. `kind` sonradan değiştirilebilir olursa
    SKU'nun öneki gerçeği yansıtmaz hâle gelir ama SKU immutable olduğu için
    düzeltilemez. Bu yüzden `kind` düzenlenemez KALMALI.
    """
    assert "kind" not in _editable_strings()


# ───────────── 5. Değiştirilemezlik yüzeyi (Karar 3) ─────────────

def test_hareket_guncelleme_silme_fonksiyonu_yok():
    yasak = ("update_stock_movement", "delete_stock_movement", "edit_stock_movement")
    ihlaller = [
        f"{rel}::{ad}"
        for rel in _source_files()
        for ad in yasak
        if f"def {ad}" in _read(rel)
    ]
    assert ihlaller == [], f"Defter append-only: {', '.join(ihlaller)}"


def test_hareket_ucunda_yazma_metodu_yok():
    """`stock-movements` yolunda yalnız GET olabilir."""
    src = _read("api/routers/store.py")
    # Boşa düşmesin: uç yoksa bu test hiçbir şey ölçmez.
    assert "stock-movements" in src
    for satir in src.splitlines():
        if "stock-movements" in satir:
            assert ".get(" in satir, f"Defter ucu salt-okunur olmalı: {satir.strip()}"


# ───────────── 6. İzinler (Karar 4) ─────────────

def test_defter_uclari_mevcut_urun_izinlerini_kullaniyor():
    src = _read("api/routers/store.py")
    assert "stock-movements" in src, "Hareket geçmişi ucu yazılmadı"
    assert "stock-verify" in src, "Defter doğrulama ucu yazılmadı"
    # Uçların yakınında products.view istenmiş olmalı.
    satirlar = src.splitlines()
    for i, satir in enumerate(satirlar):
        if "stock-movements" in satir or "stock-verify" in satir:
            blok = "\n".join(satirlar[i : i + 12])
            assert 'require_admin_permission("products.view")' in blok, (
                f"{satir.strip()} → products.view izni aranmıyor"
            )


def test_inventory_izin_kodu_bu_pakette_eklenmedi():
    """`inventory.*` tam envanter modülüne bırakıldı.

    Kimseye verilmemiş bir izin kodu bu kod tabanında SESSİZ 403 üretir
    (backend/CLAUDE.md'de kayıtlı tuzak).
    """
    assert "inventory." not in _read("core/admin_permissions.py")


# ───────────── 7. Model sözleşmesi ─────────────

def test_stock_movement_modeli_kayitli():
    init = _read("models/__init__.py")
    assert "StockMovement" in init, "models/__init__.py'a eklenmedi → autogenerate görmez"


def test_defter_satirinda_deleted_at_yok():
    """Soft-delete edilebilen defter satırı, gizlenebilir defter satırıdır."""
    src = _read("models/store.py")
    baslangic = src.find("class StockMovement")
    assert baslangic != -1, "StockMovement modeli yok"
    govde = src[baslangic : baslangic + 4000]
    sonraki = govde.find("\nclass ", 10)
    if sonraki != -1:
        govde = govde[:sonraki]
    assert "deleted_at" not in govde
    assert "SoftDeleteMixin" not in govde


def test_aktor_modeli_admine_ozel_alan_kullanmiyor():
    src = _read("models/store.py")
    baslangic = src.find("class StockMovement")
    assert baslangic != -1
    govde = src[baslangic : baslangic + 4000]
    assert "actor_type" in govde
    assert "actor_id" in govde
    assert "actor_admin_id" not in govde, (
        "Aktör modeli genel olmalı (SYSTEM/ADMIN ve ileride diğerleri)"
    )
    assert "ref_line_id" in govde, "Satır bazlı ticari kaynak alanı eksik"
