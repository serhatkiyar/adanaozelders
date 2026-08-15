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


def _route_yolu_arayanlar(kaynak: str, ad: str = "<test>") -> list[str]:
    """`X.routes` koleksiyonu üzerinde `.path` arayan fonksiyonlar.

    Neden bu desen: FastAPI `include_router` route'ları DÜZLEŞTİRMEZ; tembel
    bir `_IncludedRouter` bırakır (`path == ""`) ve alt-router yolları ancak
    istek çözümlenirken açılır. `app.routes` bu depoda 9 girdi döner, yüzlerce
    gerçek uç orada GÖRÜNMEZ.

    Yön kritik: `assert yol in app.routes` **yanlış kırmızı** verir (bir kez
    yaşandı), `assert yol not in app.routes` ise **yalancı yeşil** — ve bu
    ikincisi tehlikelidir, çünkü kaldırma yapılmadan da geçer ve "bu sistem
    kaldırıldı" iddiasının kanıtı diye sunulabilir.

    Sınır (dürüst kayıt): dedektör `.routes` + `.path` ikilisini AYNI fonksiyon
    gövdesinde arar. İkisini iki ayrı yardımcıya bölen bir kaçış görülmez.
    Kural bu yüzden tek başına yeterli sayılmaz — OpenAPI'den okumanın kendisi
    her dosyada docstring'le anlatılır ve bu meta-test o anlatının nöbetçisidir.
    """
    try:
        agac = ast.parse(kaynak)
    except SyntaxError:
        return []
    bulunan: list[str] = []
    for fn in ast.walk(agac):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        routes_erisimi = any(
            isinstance(n, ast.Attribute) and n.attr == "routes" for n in ast.walk(fn)
        )
        path_erisimi = any(
            isinstance(n, ast.Attribute) and n.attr == "path" for n in ast.walk(fn)
        )
        if routes_erisimi and path_erisimi:
            bulunan.append(f"{ad}::{fn.name}")
    return bulunan


def test_N9_hicbir_test_route_tablosunu_app_routes_ten_OKUMAZ():
    """🔴 Bugün böyle bir nöbetçi yok — yalnız üç dosyada yorum var."""
    ihlaller: list[str] = []
    for yol in sorted(TESTLER.rglob("*.py")):
        if yol.name == Path(__file__).name:
            continue  # dedektörün kendi kaynağı (kendini yakalamasın)
        ihlaller += _route_yolu_arayanlar(
            yol.read_text(encoding="utf-8"), yol.relative_to(BACKEND).as_posix()
        )
    assert ihlaller == [], (
        "route tablosu `app.routes`/`.routes` üzerinden okunuyor — "
        "OpenAPI şemasından okuyun (`app.openapi()[\"paths\"]`); yokluk "
        f"iddiaları burada SESSİZCE geçer: {ihlaller}"
    )


_KOTU_ROUTE_ORNEGI = '''
def test_uc_kaldirildi(app):
    yollar = {r.path for r in app.routes}
    assert "/api/v1/flashcards" not in yollar
'''

_IYI_ROUTE_ORNEGI = '''
def test_uc_kaldirildi(app):
    yollar = set(app.openapi()["paths"])
    assert "/api/v1/flashcards" not in yollar
    assert any(y.startswith("/api/v1/srs") for y in yollar)  # doluluk
'''


def test_N9b_dedektor_bilinen_KOTU_ornegi_gercekten_buluyor():
    """POZİTİF KONTROL — "bulamadım" ancak bulabildiği gösterilince anlamlıdır."""
    assert _route_yolu_arayanlar(_KOTU_ROUTE_ORNEGI, "ornek") == [
        "ornek::test_uc_kaldirildi"
    ]


def test_N9c_dogru_yazim_YANLIS_POZITIF_uretmez():
    """DOLULUK NÖBETÇİSİ: OpenAPI'den okuyan test suçlanmamalı."""
    assert _route_yolu_arayanlar(_IYI_ROUTE_ORNEGI, "ornek") == []


# ── N-10 · TB-41: `escrow.claim` boğaz noktası ────────────────────────────────

#: `Order` modeliyle claim yapmasına İZİN VERİLEN fonksiyonlar. Liste DONMUŞTUR:
#: yeni bir ad eklemek bilinçli bir karardır ve diff'te görünür.
#:
#:   _siparis_para_claimi   — boğaz noktasının kendisi (İP-18)
#:   complete_checkout      — başarısız ödeme yolu (`payment_status='FAILED'`)
#:   settle_completed_return — iade yönü (`REFUNDED`), İP-2a
IZINLI_ORDER_CLAIM = {
    "_siparis_para_claimi",
    "complete_checkout",
    "settle_completed_return",
}


def _order_claim_yapanlar(kaynak: str) -> set[str]:
    """`escrow.claim(db, Order, …)` çağıran fonksiyon adları.

    Eski nöbetçi `values={...}` sözlük DEĞİŞMEZİNİ tarıyordu; `values` bir
    değişkene alınınca (`d = {...}; escrow.claim(..., values=d)`) hem AST
    nöbetçisi hem 21 davranış testi geçiyordu (denetçi ölçtü). Bu dedektör
    `values`'a HİÇ bakmaz — modele bakar, dolayısıyla o kaçış anlamsızdır.
    """
    agac = ast.parse(kaynak)
    bulunan: set[str] = set()
    for fn in ast.walk(agac):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for node in ast.walk(fn):
            if not isinstance(node, ast.Call):
                continue
            f = node.func
            if not (
                isinstance(f, ast.Attribute)
                and f.attr == "claim"
                and isinstance(f.value, ast.Name)
                and f.value.id == "escrow"
            ):
                continue
            if any(isinstance(a, ast.Name) and a.id == "Order" for a in node.args):
                bulunan.add(fn.name)
    return bulunan


def test_N10_Order_claimleri_YALNIZ_izinli_fonksiyonlarda():
    """🔴 Kural daraltıldı (K-6): dedektörü kaçışa karşı yamamak bitmeyen bir
    yarıştır; `values` okunmazsa onu gizlemenin faydası kalmaz."""
    bulunan = _order_claim_yapanlar(ORDER_SERVICE.read_text(encoding="utf-8"))
    kacaklar = sorted(bulunan - IZINLI_ORDER_CLAIM)
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
    assert _order_claim_yapanlar(_KOTU_CLAIM_ORNEGI) == {"yeni_bir_yol"}


def test_N10c_izinli_liste_GERCEKTEN_dolu_kalir():
    """DOLULUK NÖBETÇİSİ: liste boşalırsa/dedektör körleşirse test sessizce
    geçerdi — [[TB-38]]/(b): "bulunamadı" başarısızlık sayılmalıdır."""
    bulunan = _order_claim_yapanlar(ORDER_SERVICE.read_text(encoding="utf-8"))
    assert bulunan, "dedektör hiçbir claim bulamadı — körleşmiş olabilir"
    assert "_siparis_para_claimi" in bulunan, "boğaz noktası kayboldu"
