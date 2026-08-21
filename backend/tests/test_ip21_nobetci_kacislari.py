"""İP-21 · Faz 4 — kandırılabilir nöbetçiler (saf birim / AST).

**Üretim kodundan ÖNCE yazıldı** (kök CLAUDE.md §E). Sözleşme §1/K-5, K-6.

  N-9  (TB-46)  `app.routes` üzerinden yol araması yasağı yalnız YORUMDA.
                Tuzağa dört kez düşüldü, üç dosyada yorumla belgeliydi. Belge
                o dosyayı okuyanı korur, YENİ dosya yazanı korumaz.
  N-10 (TB-41)  `escrow.claim` boğaz noktası nöbetçisi, `values` bir DEĞİŞKENE
                alınarak atlatılabiliyor (denetçi çalışan kaçış üretti).

K-6 gereği N-10'da dedektör yamanmaz, **kural daraltılır**: `Order` modeliyle
yapılan her claim izinli fonksiyon listesindedir. Böylece `values`'ın içeriğine
hiç bakılmaz ve onu gizlemenin bir faydası kalmaz. Liste donmuştur; yeni bir
claim yazan ya boğaz noktasından geçer ya listeye ekler — ikincisi diff'te
görünür ve bilinçli bir karardır.

⚠️ İkisi de KAYNAK SÖZLEŞMESİDİR (§C: düşük güçlü). Sınırları burada yazılıdır
ve her ikisinin de POZİTİF KONTROLÜ vardır: bir dedektörün "bulamadım" demesi,
ancak bilinen kötü örneği bulabildiği gösterildiğinde anlamlıdır.
"""
from __future__ import annotations

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
TESTLER = BACKEND / "tests"
ORDER_SERVICE = BACKEND / "services" / "order_service.py"


# ── N-9 · TB-46: `app.routes` üzerinden yol araması ────────────────────────────


#: Rota tablosuna MEŞRU biçimde dokunan dosyalar. Liste DONMUŞTUR ve her
#: satırın gerekçesi yazılıdır; yeni ad eklemek bilinçli bir karardır.
#:
#: Not: bu, [[TB-38]]'in şikâyet ettiği "elle tutulan liste" desenidir; o
#: yüzden yanında doluluk nöbetçisi var (`test_N9d`): listedeki dosya gerçekten
#: var olmalı ve gerçekten yakalanıyor olmalı — liste bayatlarsa test kırılır.
ROTA_MUAFLARI = {
    # Tuzağı BİLEREK çözüyor: `_IncludedRouter` sarmalını `original_router`
    # üzerinden geziyor ve gerçek `APIRoute` nesnelerine iniyor. Üstelik
    # kurduğu iddia YOKLUK değil DOLULUK (operatör rotalarının kapsamı).
    "tests/integration/test_ip3_operator_active_gate_pg.py",
    # Rota tablosundan iddia kurmuyor: testin eklediği geçici rotayı
    # teardown'da siliyor (`app.router.routes = [...]`).
    "tests/test_health_endpoints.py",
}


def _routes_erisimi(dugum) -> bool:
    """`X.routes` — nitelik erişimi VEYA `getattr(X, "routes")`."""
    if isinstance(dugum, ast.Attribute) and dugum.attr == "routes":
        return True
    return (
        isinstance(dugum, ast.Call)
        and isinstance(dugum.func, ast.Name)
        and dugum.func.id == "getattr"
        and len(dugum.args) >= 2
        and isinstance(dugum.args[1], ast.Constant)
        and dugum.args[1].value == "routes"
    )


def _path_erisimi(dugum) -> bool:
    """`X.path` — nitelik, `getattr(X, "path")` veya `X.__dict__["path"]`."""
    if isinstance(dugum, ast.Attribute) and dugum.attr == "path":
        return True
    if (
        isinstance(dugum, ast.Call)
        and isinstance(dugum.func, ast.Name)
        and dugum.func.id == "getattr"
        and len(dugum.args) >= 2
        and isinstance(dugum.args[1], ast.Constant)
        and dugum.args[1].value == "path"
    ):
        return True
    return (
        isinstance(dugum, ast.Subscript)
        and isinstance(dugum.slice, ast.Constant)
        and dugum.slice.value == "path"
    )


def _route_yolu_arayanlar(kaynak: str, ad: str = "<test>") -> list[str]:
    """`X.routes` koleksiyonu üzerinde `path` arayan DOSYALAR.

    Neden bu desen: FastAPI `include_router` route'ları DÜZLEŞTİRMEZ; tembel
    bir `_IncludedRouter` bırakır (`path == ""`) ve alt-router yolları ancak
    istek çözümlenirken açılır. `app.routes` bu depoda 9 girdi döner, yüzlerce
    gerçek uç orada GÖRÜNMEZ.

    Yön kritik: `assert yol in app.routes` **yanlış kırmızı** verir (bir kez
    yaşandı), `assert yol not in app.routes` ise **yalancı yeşil** — ve bu
    ikincisi tehlikelidir, çünkü kaldırma yapılmadan da geçer ve "bu sistem
    kaldırıldı" iddiasının kanıtı diye sunulabilir.

    ## Daraltma geçmişi (kendi kaçış avım, İP-21)

    İlk hâl `.routes` + `.path` ikilisini AYNI FONKSİYON gövdesinde arıyordu.
    Üç kaçış birden çalıştı: `getattr(app, "routes")` · ikisini iki ayrı
    yardımcıya bölmek · `r.__dict__["path"]`. Bu hâl DOSYA düzeyinde arar ve
    üç erişim biçimini de tanır.

    **Kalan sınır (dürüst kayıt):** iddiayı İKİ AYRI DOSYAYA bölen bir kaçış
    hâlâ görülmez (bir yardımcı modül `.routes` döndürür, test dosyası `.path`
    okur). Dedektörü kaçışa karşı yamamak bitmeyen bir yarıştır (§K-6); bu
    yüzden meta-test tek başına yeterli sayılmaz — yanında her dosyanın kendi
    docstring'i ve OpenAPI'den okuma alışkanlığı durur. Yanlış pozitif
    üretmemesi de ölçülür (`test_N9c`).
    """
    try:
        agac = ast.parse(kaynak)
    except SyntaxError:
        return []
    dugumler = list(ast.walk(agac))
    if any(_routes_erisimi(d) for d in dugumler) and any(
        _path_erisimi(d) for d in dugumler
    ):
        return [ad]
    return []


def test_N9_hicbir_test_route_tablosunu_app_routes_ten_OKUMAZ():
    """🔴 Bugün böyle bir nöbetçi yok — yalnız üç dosyada yorum var."""
    ihlaller: list[str] = []
    for yol in sorted(TESTLER.rglob("*.py")):
        if yol.name == Path(__file__).name:
            continue  # dedektörün kendi kaynağı (kendini yakalamasın)
        rel = yol.relative_to(BACKEND).as_posix()
        if rel in ROTA_MUAFLARI:
            continue
        ihlaller += _route_yolu_arayanlar(yol.read_text(encoding="utf-8"), rel)
    assert ihlaller == [], (
        "route tablosu `app.routes`/`.routes` üzerinden okunuyor — "
        "OpenAPI şemasından okuyun (`app.openapi()[\"paths\"]`); yokluk "
        f"iddiaları burada SESSİZCE geçer: {ihlaller}"
    )


#: Bilinen KÖTÜ desenler — üçü de kendi kaçış avımda ÇALIŞMIŞTI (İP-21).
_KOTU_ROUTE_ORNEKLERI = {
    "duz": """
def test_uc_kaldirildi(app):
    yollar = {r.path for r in app.routes}
    assert "/api/v1/flashcards" not in yollar
""",
    "getattr": """
def test_uc_kaldirildi(app):
    yollar = {r.path for r in getattr(app, "routes")}
    assert "/api/v1/flashcards" not in yollar
""",
    "iki_fonksiyon": """
def _yollar(app):
    return list(app.routes)

def test_uc_kaldirildi(app):
    assert "/api/v1/flashcards" not in {r.path for r in _yollar(app)}
""",
    "dict_erisimi": """
def test_uc_kaldirildi(app):
    yollar = {r.__dict__["path"] for r in app.routes}
    assert "/api/v1/flashcards" not in yollar
""",
}

_IYI_ROUTE_ORNEGI = '''
def test_uc_kaldirildi(app):
    yollar = set(app.openapi()["paths"])
    assert "/api/v1/flashcards" not in yollar
    assert any(y.startswith("/api/v1/srs") for y in yollar)  # doluluk
'''


def test_N9b_dedektor_bilinen_KOTU_ornegi_gercekten_buluyor():
    """POZİTİF KONTROL — "bulamadım" ancak bulabildiği gösterilince anlamlıdır."""
    for ad, ornek in _KOTU_ROUTE_ORNEKLERI.items():
        assert _route_yolu_arayanlar(ornek, "ornek") == ["ornek"], (
            f"dedektör bu kaçışı görmüyor: {ad}"
        )


def test_N9c_dogru_yazim_YANLIS_POZITIF_uretmez():
    """DOLULUK NÖBETÇİSİ: OpenAPI'den okuyan test suçlanmamalı."""
    assert _route_yolu_arayanlar(_IYI_ROUTE_ORNEGI, "ornek") == []


# ── N-10 · TB-41: `escrow.claim` boğaz noktası ────────────────────────────────

#: `escrow.claim` ÇAĞIRMASINA izin verilen fonksiyonlar. Liste DONMUŞTUR:
#: yeni bir ad eklemek bilinçli bir karardır ve diff'te görünür.
#:
#:   _siparis_para_claimi    — boğaz noktasının kendisi (İP-18)
#:   complete_checkout       — başarısız ödeme yolu (`payment_status='FAILED'`)
#:   settle_completed_return — iade yönü (`REFUNDED`), İP-2a
#:   reject_return           — RMA reddi (`OrderReturn`), İP-2a
#:   _settle_return          — RMA kapanışı (`OrderReturn`), İP-2a
IZINLI_CLAIM = {
    "_siparis_para_claimi",
    "complete_checkout",
    "settle_completed_return",
    "reject_return",
    "_settle_return",
}


def _claim_yapanlar(kaynak: str) -> set[str]:
    """`X.claim(…)` çağıran fonksiyon adları — sahip/model/argüman FARK ETMEZ.

    Daraltmanın üç adımı (her biri bir kaçış ölçüldükten SONRA atıldı):

    1. İlk nöbetçi (İP-18) `values={...}` sözlük DEĞİŞMEZİNİ tarıyordu.
       Kaçış: `d = {...}; escrow.claim(..., values=d)` — denetçi üretti.
    2. İkinci hâl (İP-21 ilk taslağı) `values` yerine MODELE bakıyordu
       (`escrow.claim(db, Order, …)`). Kendi kaçış avımda üç kaçış birden
       çalıştı: `M = Order` takma adı · `esc.claim(...)` modül takma adı ·
       `model=Order` anahtar sözcüğü.
    3. Bu hâl hiçbirine bakmaz: **`claim` adlı bir çağrı varsa** fonksiyon
       izinli listede olmalıdır. Kaçmak için `escrow.claim`'in ADINI
       değiştirmek gerekir — o zaman kaçış değil, escrow API'sini değiştiren
       bir refactor olur ve diff'te görünür.

    Yanlış pozitif riski ölçüldü: `order_service.py`'de `claim` adlı başka
    hiçbir metot çağrısı yok (beş çağrının beşi de `escrow.claim`).
    """
    agac = ast.parse(kaynak)
    bulunan: set[str] = set()
    for fn in ast.walk(agac):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for node in ast.walk(fn):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "claim"
            ):
                bulunan.add(fn.name)
    return bulunan


def test_N10_claim_cagrilari_YALNIZ_izinli_fonksiyonlarda():
    """🔴 Kural daraltıldı (K-6): dedektörü kaçışa karşı yamamak bitmeyen bir
    yarıştır; `values` okunmazsa onu gizlemenin faydası kalmaz."""
    bulunan = _claim_yapanlar(ORDER_SERVICE.read_text(encoding="utf-8"))
    kacaklar = sorted(bulunan - IZINLI_CLAIM)
    assert kacaklar == [], (
        "sipariş modeline doğrudan claim yazan yeni fonksiyon(lar) — boğaz "
        f"noktasından geçirin ya da listeye bilinçle ekleyin: {kacaklar}"
    )


_KOTU_CLAIM_ORNEGI = '''
async def yeni_bir_yol(db, order):
    deger = {"payment_status": "PAID", "provider_ref": "x"}
    await escrow.claim(db, Order, order.id, values=deger)
'''


def test_N10b_degiskene_alinmis_values_ARTIK_kacamaz():
    """POZİTİF KONTROL — denetçinin ürettiği kaçışın ta kendisi.

    Eski dedektör bu örneği GÖRMÜYORDU (`values` `ast.Dict` değil `ast.Name`).
    """
    assert _claim_yapanlar(_KOTU_CLAIM_ORNEGI) == {"yeni_bir_yol"}


def test_N10c_izinli_liste_GERCEKTEN_dolu_kalir():
    """DOLULUK NÖBETÇİSİ: liste boşalırsa/dedektör körleşirse test sessizce
    geçerdi — [[TB-38]]/(b): "bulunamadı" başarısızlık sayılmalıdır."""
    bulunan = _claim_yapanlar(ORDER_SERVICE.read_text(encoding="utf-8"))
    assert bulunan, "dedektör hiçbir claim bulamadı — körleşmiş olabilir"
    assert "_siparis_para_claimi" in bulunan, "boğaz noktası kayboldu"


def test_N9d_muafiyet_listesi_BAYAT_degil():
    """DOLULUK NÖBETÇİSİ — [[TB-38]]/(b): elle tutulan liste sessizce
    bayatlayabilir. İki koşul birden aranır:

    1. Muaf dosya GERÇEKTEN var (yeniden adlandırıldıysa liste ölü demektir);
    2. Muaf dosya gerçekten YAKALANIYOR — yani muafiyet hâlâ gerekli. Dosya
       OpenAPI'ye geçirilirse bu test kırılır ve satır listeden düşürülür.
    """
    for rel in sorted(ROTA_MUAFLARI):
        yol = BACKEND / rel
        assert yol.exists(), f"muaf dosya yok (liste bayat): {rel}"
        assert _route_yolu_arayanlar(yol.read_text(encoding="utf-8"), rel) == [rel], (
            f"{rel} artık rota tablosuna dokunmuyor — muafiyet gereksiz, "
            "listeden düşürün"
        )
