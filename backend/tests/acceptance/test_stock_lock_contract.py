"""Kilit sözleşmesi — ürün kilidinin TEK sahibi ve kaynak sırası (commit 4).

## Bu testin varlık sebebi

Kilit sırası **davranışsal olarak** ancak yarış oluştuğunda görünür; yarış
oluşmadığı sürece tutarsız bir sıra sessizce yaşar ve bir gün üretimde deadlock
olarak patlar. `test_stock_lock_order_pg.py` yarışları kurar (olasılıksal),
burası **kaynağın yapısını** sabitler (deterministik). İkisi birlikte kapatır.

## Kanonik kaynak sırası

    Product → Order → OrderReturn → (Coupon / DeliveryStop)

Bir yol Product→Order alırken başkası Order→Product almamalı. Kilit grafiğinin
dosya:satır kanıtları `docs/stok-hareket-defteri-plani.md` §4e'de.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[2]

LEDGER = "services/stock_ledger.py"
#: Ürün kilidini alan TEK fonksiyon.
LOCKER = "lock_products"


def _read(rel: str) -> str:
    return (BACKEND / rel).read_text(encoding="utf-8")


def _tree(rel: str) -> ast.Module:
    return ast.parse(_read(rel))


def _funcs(rel: str) -> dict[str, ast.AST]:
    return {
        n.name: n
        for n in ast.walk(_tree(rel))
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _func(rel: str, name: str) -> ast.AST:
    try:
        return _funcs(rel)[name]
    except KeyError:
        raise AssertionError(f"{rel} içinde {name} yok") from None


def _source_files() -> list[str]:
    out: list[str] = []
    for sub in ("services", "api/routers"):
        for p in (BACKEND / sub).glob("*.py"):
            out.append(str(p.relative_to(BACKEND)).replace("\\", "/"))
    return sorted(out)


def _first_line(node: ast.AST, cagri_adi: str) -> int | None:
    """Gövdede `cagri_adi` çağrısının İLK satır numarası."""
    satirlar = [
        n.lineno
        for n in ast.walk(node)
        if isinstance(n, ast.Call)
        and (
            (isinstance(n.func, ast.Name) and n.func.id == cagri_adi)
            or (isinstance(n.func, ast.Attribute) and n.func.attr == cagri_adi)
        )
    ]
    return min(satirlar) if satirlar else None


def _dump_no_doc(node: ast.AST) -> str:
    """Docstring HARİÇ `ast.dump`.

    `ast.dump` docstring'i de dizgiye katar; bir açıklama satırında geçen
    `joinedload` sözcüğü testi yanlış kırar (bu tuzağa bir kez düşüldü —
    `test_defter_http_bagimliligi_tasimiyor` de bu yüzden AST'ye geçirildi).
    """
    kopya = ast.parse(ast.unparse(node)).body[0]
    govde = list(getattr(kopya, "body", []))
    if (
        govde
        and isinstance(govde[0], ast.Expr)
        and isinstance(govde[0].value, ast.Constant)
        and isinstance(govde[0].value.value, str)
    ):
        govde = govde[1:]
    return chr(10).join(ast.dump(n) for n in govde)


def _call_names(node: ast.AST) -> set[str]:
    out: set[str] = set()
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            if isinstance(n.func, ast.Name):
                out.add(n.func.id)
            elif isinstance(n.func, ast.Attribute):
                out.add(n.func.attr)
    return out


# ═════════════ 1. Ürün kilidinin TEK sahibi ═════════════


def test_urun_kilidini_alan_tek_yer_lock_products():
    """`with_for_update` + `Product` bileşimi yalnız `lock_products` içinde.

    Çağıranlarda ikinci ve FARKLI bir ürün kilitleme döngüsü açılırsa (eski
    hâl: üç ayrı sırasız döngü) sıra disiplini üç yerde tekrarlanmak zorunda
    kalır ve biri unutulduğunda sessizce deadlock'a dönüşür.
    """
    ihlaller: list[str] = []
    for rel in _source_files():
        for ad, node in _funcs(rel).items():
            if rel == LEDGER and ad == LOCKER:
                continue
            for n in ast.walk(node):
                if not (
                    isinstance(n, ast.Call)
                    and isinstance(n.func, ast.Attribute)
                    and n.func.attr == "with_for_update"
                ):
                    continue
                # Bu `with_for_update` zincirinde `Product` geçiyor mu?
                zincir = ast.dump(n)
                if "'Product'" in zincir or '"Product"' in zincir:
                    ihlaller.append(f"{rel}::{ad}:{n.lineno}")
    assert ihlaller == [], (
        "Ürün kilidi yalnız stock_ledger.lock_products içinde alınabilir; "
        f"şu yerler kendi kilidini alıyor: {', '.join(ihlaller)}"
    )


def test_lock_products_tek_sorgu_ve_id_sirali():
    """Tek `IN (...)` sorgusu + `ORDER BY Product.id` + `FOR UPDATE`.

    PostgreSQL satırları `ORDER BY`'a göre sıralayıp o sırada kilitler; bu,
    deadlock'tan kaçınmanın belgelenmiş deyimidir. Per-id döngü de doğru sırayı
    verebilir ama N gidiş-dönüş yapar ve sıralamayı çağırana bırakır.
    """
    dump = _dump_no_doc(_func(LEDGER, LOCKER))
    assert "with_for_update" in dump
    assert "order_by" in dump, "ORDER BY yok"
    assert "'id'" in dump or "attr='id'" in dump, "sıralama `id` üzerinde değil"
    assert "in_" in dump, "tek sorgulu `IN (...)` biçimi kullanılmıyor"
    assert "populate_existing" in dump, "bayat kimlik haritası riski"


def test_lock_products_eager_loading_kullanmiyor():
    """`joinedload`/`selectinload` ile alınan bir `FOR UPDATE`, ilişkili
    tabloların satırlarını da kilitler ve kilit grafiğine GÖRÜNMEZ kaynak sokar.
    """
    cagrilar = _call_names(_func(LEDGER, LOCKER))
    for yasak in ("joinedload", "selectinload", "subqueryload", "options"):
        assert yasak not in cagrilar, (
            f"{LOCKER} içinde {yasak}() var — kilit ilişkili tablolara genişliyor"
        )


#: Kilide KENDİ ihtiyacı olan (yalnız `apply_many`'nin kilidine güvenemeyen)
#: yollar. Diğerleri kilidi `apply_many`'ye bırakır — commit 5'te `_restock` ve
#: `_restock_items` tam olarak bunu yaptı: kendi kilit çağrıları kalktı,
#: `apply_many` tek sahibi oldu.
KENDI_KILIDINI_ALANLAR: list[tuple[str, str, str]] = [
    # Oversell ön kontrolü, PAID claim'inden ÖNCE ve kilit altında okumak zorunda.
    ("services/order_service.py", "_finalize_paid", "oversell ön kontrolü"),
    # Admin hedefi → delta çevirimi kilit altında olmak zorunda.
    ("services/store_service.py", "update_product", "hedef→delta çevirimi"),
    # Geri yükleme yolları sağlayıcı çağrısından ÖNCE kilitlemek zorunda
    # (yoksa Order→Product sırası oluşur; bkz. plan §4e).
    ("services/order_service.py", "_lock_order_products", "kanonik sıra"),
]


@pytest.mark.parametrize("rel,fn,neden", KENDI_KILIDINI_ALANLAR)
def test_kendi_kilidine_ihtiyaci_olanlar_ortak_yardimciyi_kullaniyor(rel, fn, neden):
    assert _first_line(_func(rel, fn), LOCKER) is not None, (
        f"{rel}::{fn} ({neden}) ürün kilidini ortak yardımcıyla almıyor"
    )


def test_geri_yukleme_yollari_kendi_kilit_dongusunu_acmiyor():
    """`_restock`/`_restock_items` **ortak yardımcıyı** kullanır, kendi döngüsünü açmaz.

    Requirement: "apply_many ürün kilitlerinin tek sahibi olarak kalabiliyorsa
    çağıranlarda ikinci ve FARKLI bir ürün kilitleme döngüsü oluşturma. Ön
    kontrol için alınan kilit gerçekten gerekiyorsa ortak bir yardımcı kullan."

    Burada kilit gerçekten gerekli: **fazla geri yükleme tavanı** defterden
    okunur ve bu okuma kilit altında olmalıdır — yoksa eşzamanlı iki geri
    yükleme (tam iptal ⟂ kısmi iade) ikisi de "henüz geri yüklenen yok" görüp
    stoğu satılandan fazla artırır (gerçek PG testiyle ölçüldü). Bu yüzden
    `lock_products` çağrısı MEŞRUDUR; yasak olan kendi `with_for_update`
    döngüsünü açmaktır (o kural `test_urun_kilidini_alan_tek_yer_lock_products`
    tarafından zaten korunuyor).
    """
    for fn in ("_restock", "_restock_items"):
        node = _func("services/order_service.py", fn)
        cagrilar = _call_names(node)
        assert LOCKER in cagrilar, (
            f"{fn} tavan okumasını kilit altında yapmıyor (ortak yardımcı yok)"
        )
        assert "apply_many" in cagrilar, f"{fn} apply_many kullanmıyor"
        # Tavan okuması kilitten SONRA gelmeli.
        assert _first_line(node, LOCKER) < _first_line(
            node, "restored_quantity_by_order_item"
        ), f"{fn}: tavan kilit ALINMADAN okunuyor"


# ═════════════ 2. Kaynak sırası: Product → Order → Return ═════════════

#: (dosya, fonksiyon, [beklenen sırada görülmesi gereken çağrı adları])
#: Yalnız İLK görülme satırları karşılaştırılır.
SIRA_MATRISI: list[tuple[str, str, list[str]]] = [
    # PAID: ürünler kilitlenir → sipariş satırı koşullu UPDATE ile claim edilir.
    ("services/order_service.py", "_finalize_paid", [LOCKER, "claim"]),
    # Tam iade: ürün kilitleri SAĞLAYICIDAN ÖNCE (kanonik sıra), telafi SONRA.
    (
        "services/order_service.py",
        "_refund_payment",
        ["_lock_order_products", "perform_refund", "_restock"],
    ),
    # Kısmi iade: aynı desen (kilit → sağlayıcı → telafi).
    (
        "services/order_service.py",
        "_settle_return",
        ["_lock_order_products", "refund", "_restock_items"],
    ),
]


@pytest.mark.parametrize("rel,fn,sira", SIRA_MATRISI)
def test_kaynak_kilit_sirasi_kanonik(rel, fn, sira):
    """Kanonik sıra: Product → Order → OrderReturn.

    `_settle_return` istisna gibi görünür (`claim` önce): oradaki `claim`
    **OrderReturn** satırınadır ve arada `db.commit()` vardır, yani ürün
    kilitleri AYRI bir transaction'da alınır. Ayrıntı: plan §4e.
    """
    node = _func(rel, fn)
    satirlar = [(ad, _first_line(node, ad)) for ad in sira]
    eksik = [ad for ad, ln in satirlar if ln is None]
    assert not eksik, f"{rel}::{fn} içinde bulunamadı: {eksik}"
    numaralar = [ln for _, ln in satirlar]
    assert numaralar == sorted(numaralar), (
        f"{rel}::{fn} kilit sırası kanonik değil: {satirlar}"
    )


def test_finalize_paid_urun_kilidini_claimden_ONCE_aliyor():
    """En kritik tek iddia: Product → Order.

    Ters olsaydı (`claim` önce, ürün sonra) bu yol, Order→Product sırasını
    kullanan iade yoluyla birlikte gerçek bir deadlock döngüsü kurardı.
    """
    node = _func("services/order_service.py", "_finalize_paid")
    kilit = _first_line(node, LOCKER)
    claim = _first_line(node, "claim")
    assert kilit is not None and claim is not None
    assert kilit < claim, f"ürün kilidi {kilit}, claim {claim} — sıra ters"


# ═════════════ 3. `update_product` sözleşmesi ═════════════


def test_update_product_mutlak_atama_yapmiyor():
    """Stok, `setattr` döngüsünün DİNAMİK yolundan geçmemeli.

    Bu, hiçbir AST testinin "doğrudan mutasyon" olarak göremeyeceği yoldur;
    bu yüzden ayrı bir kuralla kapatılır.
    """
    node = _func("services/store_service.py", "update_product")
    editable: set[str] = set()
    for n in ast.walk(node):
        hedef = (
            isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "editable" for t in n.targets)
        ) or (
            isinstance(n, ast.AugAssign)
            and isinstance(n.target, ast.Name)
            and n.target.id == "editable"
        )
        if hedef:
            for x in ast.walk(n.value):
                if isinstance(x, ast.Constant) and isinstance(x.value, str):
                    editable.add(x.value)
        if (
            isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute)
            and isinstance(n.func.value, ast.Name)
            and n.func.value.id == "editable"
        ):
            for arg in n.args:
                for x in ast.walk(arg):
                    if isinstance(x, ast.Constant) and isinstance(x.value, str):
                        editable.add(x.value)
    assert "stock" not in editable
    assert "kind" not in editable


def test_update_product_dijital_urunde_stok_degisikligini_reddediyor():
    src = ast.get_source_segment(
        _read("services/store_service.py"),
        _func("services/store_service.py", "update_product"),
    ) or ""
    assert "PHYSICAL" in src and "400" in src.replace("HTTP_400_BAD_REQUEST", "400"), (
        "dijital üründe stok değişikliği açıkça reddedilmiyor"
    )


def test_update_product_delta_kilit_altinda_hesapliyor():
    """Kilit ÖNCE alınmalı, delta SONRA hesaplanmalı."""
    node = _func("services/store_service.py", "update_product")
    kilit = _first_line(node, LOCKER)
    assert kilit is not None, "ürün satırı kilitlenmiyor"
    # Delta hesabının kilitten sonra geldiğini satır bazında doğrula.
    delta_satirlari = [
        n.lineno
        for n in ast.walk(node)
        if isinstance(n, ast.Assign)
        and any(
            isinstance(t, ast.Name) and t.id in ("stok_delta", "delta")
            for t in n.targets
        )
    ]
    assert delta_satirlari, "delta hesabı bulunamadı"
    assert max(delta_satirlari) > kilit, "delta kilitten ÖNCE hesaplanıyor"


# ═════════════ 4. Commit 5 borcu açıkça kayıtlı ═════════════


def test_commit4_defter_borcu_ODENDI():
    """Commit 4'te bırakılan `TODO(commit 5 …)` borç notları kalmamalı.

    Commit 4'te bu testin tersi vardı (notların VARLIĞINI zorunlu kılıyordu):
    kilit altyapısı kurulmuş ama hareketler deftere yazılmamıştı ve problemin
    "çözülmüş" görünmemesi gerekiyordu. Commit 5 borcu ödedi; şimdi notların
    KALMAMASI doğrulanıyor — aksi hâlde kod, yapılmış bir işi yapılmamış gibi
    anlatır.
    """
    kalanlar: list[str] = []
    for rel in _source_files():
        for i, satir in enumerate(_read(rel).splitlines(), start=1):
            if "TODO(commit 5" in satir:
                kalanlar.append(f"{rel}:{i}")
    assert kalanlar == [], f"ödenmiş borcun notu duruyor: {', '.join(kalanlar)}"
