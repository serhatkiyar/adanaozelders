"""Kanonik kilit sırası — testler arası TEK doğruluk kaynağı.

## Neden ayrı bir modül

Kilit sırası iddiası daha önce iki yerde ayrı ayrı yazılıydı ve F30 denetiminde
üçüncü bir kopya (kaynak metninde `find()` + karakter penceresi ile literal
arama) ortaya çıktı. O yaklaşım iki bakımdan kabul edilemezdi:

* **Uygulanamaz.** Testin geçmesi için üretim koduna ya da başka bir teste
  anlamsız bir `"OrderPackage"` literali eklemek gerekiyordu; yani test doğru
  kilidin alınmasını değil, doğru dizginin yazılmasını ölçüyordu.
* **Kırılgan.** `find()` + sabit pencere, kök `CLAUDE.md` §C'nin açıkça
  yasakladığı desen.

Burada sıra **veri olarak** durur; testler onu import eder ve fonksiyonların
GERÇEK çağrı sırasını AST üzerinden ölçer.

## Sıra

    StockCountSession → Product → Order → OrderReturn → OrderPackage → DeliveryStop

Gerekçeler:

* `StockCountSession` önce: `apply_session` oturumu koşullu UPDATE ile claim
  edip SONRA ürünleri kilitler (`inventory_service.py:1083-1100`).
* `Product` `Order`'dan önce: `_finalize_paid` ürün kilidini PAID claim'inden
  önce alır (`order_service.py:618`); ters olsaydı iade yoluyla döngü kurulurdu.
* **`OrderPackage`, `Order`'dan sonra ve `DeliveryStop`'tan önce** (F30):
  paketleme `Order → OrderPackage`, zimmet `Order → OrderPackage → DeliveryStop`
  alır. Paket, siparişin altında ve durağın üstünde yer alır — durak zaten
  `_lock_stop_and_order` ile `Order`'dan sonra kilitleniyor
  (`delivery_service.py:1457-1470`).
"""
from __future__ import annotations

import ast
import itertools

#: Kilit alınabilen kaynaklar, ALINMA sırasına göre. Bir akış birden çok kaynağı
#: kilitliyorsa bunları HER ZAMAN bu sırayla almalıdır.
CANONICAL_LOCK_ORDER: tuple[str, ...] = (
    "StockCountSession",
    "Product",
    "Order",
    "OrderReturn",
    "OrderPackage",
    "DeliveryStop",
)

#: Ürün kilidini alan TEK fonksiyon (`stock_ledger`); adı geçtiğinde kilitlenen
#: kaynak `Product`'tır.
PRODUCT_LOCKER = "lock_products"

#: Kilidi kendi içinde alan yardımcılar → kilitledikleri kaynaklar, SIRASIYLA.
#: Bir fonksiyon bu yardımcıyı çağırdığında o kaynakları kilitlemiş sayılır.
LOCK_HELPERS: dict[str, tuple[str, ...]] = {
    PRODUCT_LOCKER: ("Product",),
    "_lock_order": ("Order",),
    "_lock_order_products": ("Product",),
    "_lock_stop_and_order": ("Order", "DeliveryStop"),
    "_lock_field_stop": ("DeliveryStop",),
    # F30 (`packing_service`). Adları bilinçli olarak `_lock_` önekiyle
    # başlar: bir kilidi yardımcıya taşımak, onu bu sözlüğe yazmayı da
    # gerektirir — yoksa kabul testi o fonksiyonu "hiçbir kaynağı
    # kilitlemiyor" diye kırar (G7 deseninin nöbetçisi).
    "_lock_package": ("OrderPackage",),
    "_lock_live_package": ("OrderPackage",),
    # `packing_events.live_package(..., lock=True)` — `delivery_service`in
    # paket kilidini aldığı yol. Kayıtlı olmasaydı `add_stops`'un kilit sırası
    # AST'den ölçülemezdi (kilit "görünmez" olurdu).
    "live_package": ("OrderPackage",),
}


#: Kilidi yalnız `lock=True` verildiğinde alan yardımcılar.
_KOSULLU_KILIT = frozenset({"live_package"})


def lock_rank(model: str) -> int:
    """Kaynağın kanonik sıradaki yeri. Bilinmeyen kaynak `-1`."""
    try:
        return CANONICAL_LOCK_ORDER.index(model)
    except ValueError:
        return -1


def _model_of_for_update(call: ast.Call) -> str | None:
    """`select(X)...with_for_update()` ya da `db.get(X, ..., with_for_update=...)`
    çağrısından kilitlenen model adını çıkarır."""
    fn = call.func
    adi = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", "")

    if adi == "with_for_update":
        # Zincirin herhangi bir yerindeki `select(Model)` argümanını bul.
        for n in ast.walk(call):
            if (
                isinstance(n, ast.Call)
                and isinstance(n.func, ast.Name)
                and n.func.id == "select"
                and n.args
            ):
                hedef = n.args[0]
                if isinstance(hedef, ast.Name):
                    return hedef.id
                if isinstance(hedef, ast.Attribute):
                    return hedef.value.id if isinstance(hedef.value, ast.Name) else None
        return None

    if adi == "get" and any(k.arg == "with_for_update" for k in call.keywords):
        if call.args and isinstance(call.args[0], ast.Name):
            return call.args[0].id
    return None


def observed_lock_models(node: ast.AST) -> list[tuple[str, int]]:
    """Fonksiyon gövdesinde kilitlenen kaynaklar, `(model, satır)` olarak ve
    SATIR SIRASINDA.

    Üç kalıp tanınır:
      1. `select(Model)...with_for_update()`
      2. `db.get(Model, ..., with_for_update=True)`
      3. `LOCK_HELPERS` içindeki yardımcı çağrıları

    Kaynak metni değil AST okunur; docstring ve yorumlar eşleşme üretmez.
    """
    bulunan: list[tuple[str, int]] = []
    for n in ast.walk(node):
        if not isinstance(n, ast.Call):
            continue
        model = _model_of_for_update(n)
        if model:
            bulunan.append((model, n.lineno))
            continue
        fn = n.func
        adi = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", "")
        if adi in LOCK_HELPERS:
            # `live_package` kilidi YALNIZ `lock=True` ile alır; kwarg'sız
            # çağrı düz bir okumadır ve kilit sayılmamalıdır. Aksi hâlde
            # `lock=True`yi silmek AST denetiminden kaçardı (mutasyon provası
            # bunu yakaladı).
            if adi in _KOSULLU_KILIT and not any(
                k.arg == "lock" and getattr(k.value, "value", None) is True
                for k in n.keywords
            ):
                continue
            for kaynak in LOCK_HELPERS[adi]:
                bulunan.append((kaynak, n.lineno))
    # Aynı satırda birden çok kayıt olabilir; giriş sırası korunur.
    bulunan.sort(key=lambda p: p[1])
    return bulunan


def canonical_violations(node: ast.AST) -> list[str]:
    """Kanonik sırayı bozan geçişleri döndürür (boşsa sıra doğru).

    Yalnız **bilinen** kaynaklar denetlenir; aynı kaynağın tekrar kilitlenmesi
    (yeniden giriş) ihlal sayılmaz — `lock_products` yeniden girişlidir.
    """
    gorulen = [(m, ln) for m, ln in observed_lock_models(node) if lock_rank(m) >= 0]
    ihlaller: list[str] = []
    # `zip(gorulen, gorulen[1:])` yerine `pairwise`: aranan şey **ardışık çift**.
    # İki dizinin uzunluğu tanım gereği bir fark eder, yani `strict=True` her
    # zaman ValueError verirdi ve `strict=False` de "eşitliği umursamıyoruz"
    # diyerek niyeti gizlerdi (ruff B905'i susturmak, niyeti yazmak değildir).
    # `pairwise` niyeti doğrudan söyler ve uzunluk sorusunu ortadan kaldırır.
    for (onceki, ln1), (sonraki, ln2) in itertools.pairwise(gorulen):
        if lock_rank(sonraki) < lock_rank(onceki):
            ihlaller.append(f"satır {ln1} {onceki} → satır {ln2} {sonraki}")
    return ihlaller
