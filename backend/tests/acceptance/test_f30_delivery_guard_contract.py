"""F30 — sipariş `DELIVERED`/`SHIPPED` yapan HER üretim yolu zimmet kapısından geçer.

## Bu nöbetçi neden var

Aynı sınıf hata **iki kez** üretime yaklaştı:

1. Commit 7'nin ilk turunda üç saha ucu (`verify` · `override-deliver` ·
   `deliver-drop`) paket durumuna hiç bakmıyordu. Guard
   `delivery_service._finalize_delivered` hunisine kondu ve docstring'e
   "yarın eklenecek dördüncü yol guard'ı kendiliğinden miras alır" yazıldı.
2. Bağımsız denetim o cümlenin **yanlış** olduğunu gösterdi: dördüncü yol
   zaten vardı — `order_service.mark_delivered`
   (`POST /store/admin/orders/{id}/deliver`) — ve huniden hiç geçmiyordu.
   Kutu raftayken sipariş `DELIVERED` olabiliyor, müşteriye teslim e-postası
   gidiyor, durak `PENDING` kalıyor ve paket bir daha zimmetlenemiyordu.

İki kez tekrarlayan bir hata "dikkat edelim" ile kapanmaz. Bu test, **yeni bir
teslim/sevkiyat yolu eklenip guard unutulursa kırılır** — yani üçüncü kez
olmasını engelleyen şey insanın hatırlaması değil, suite'in kırmızıya dönmesidir.

## Neden davranış testi DEĞİL

Kök `CLAUDE.md` §C: kaynak/AST sözleşmesi **düşük güçlü** sayılır ve tek
kanıt olamaz. Burada ölçülen şey bir davranış değil, **kapsamın kapalılığıdır**
("hiçbir yol guard'sız değil") ve o negatif iddia davranışla ifade edilemez:
her yolu tek tek çağıran bir test, henüz YAZILMAMIŞ yolu göremez. Bu yüzden
nöbetçi yapısaldır ama yanında her guard'ın gerçek davranış testi durur
(`tests/integration/test_f30_handover_idem_pg.py`,
`tests/integration/test_f30_admin_deliver_pg.py`).

Yapısal denetim **AST ile** yapılır: yorum ve docstring içindeki `"DELIVERED"`
dizgisi eşleşmez, fonksiyon sınırları `find()` + karakter penceresiyle değil
gerçek düğüm sınırlarıyla bulunur (§C).
"""
from __future__ import annotations

import ast
import pathlib

import pytest

KOK = pathlib.Path(__file__).resolve().parents[2]

#: Taranan üretim kodu. `services/` tek başına YETMEZ — denetim bulgusu tam da
#: `services/` içinde ama başka bir modüldeydi; router'lar da servisleri
#: atlayıp doğrudan geçiş yazabilir.
TARANAN_DIZINLER = ("services", "api/routers")

#: Ortak kapı. İsim ne modülle ne de yerel takma adla eşleşmeye bırakılır:
#: çağrının **fonksiyon adı** aranır (`packing_events.zimmet_zorunlu(...)`,
#: `zimmet_zorunlu(...)`, `pe.zimmet_zorunlu(...)` hepsi geçer).
TESLIM_KAPISI = "zimmet_zorunlu"
SEVKIYAT_KAPISI = "elle_sevkiyat_yasak"

#: Sipariş terminale giderken paket + durak da terminale gitmeli.
TERMINAL_HELPERLARI = frozenset({"teslim_terminali", "on_package_delivered"})

#: `Order` satırını `FOR UPDATE` ile alan yardımcılar. F30 kapısı bunlardan
#: SONRA çağrılmalıdır: kilitsiz okunan paket durumu bayattır ve nihai
#: denetimin iki P1'i tam olarak bu yüzden doğdu.
ORDER_KILITLERI = frozenset(
    {"_lock_order", "_lock_orders_ascending", "_lock_stop_and_order", "_lock_field_stop"}
)

#: Kapıyı çağırıp Order kilidini KENDİ almayan yollar. Dar ve gerekçeli.
KILIT_ISTISNALARI: dict[tuple[str, str], str] = {
    (
        "services/delivery_service.py",
        "_finalize_delivered",
    ): (
        "Kilidi ÇAĞIRANI alır: üç saha ucu da `_lock_field_stop` ile girer ve o "
        "`_lock_stop_and_order` üzerinden Order + DeliveryStop satırlarını "
        "`FOR UPDATE` ile tutar. Huninin kendi kilidini alması aynı satırı "
        "ikinci kez kilitlemekten başka bir şey yapmazdı."
    ),
}

#: `DELIVERED` geçişi yapıp paket/durak terminalini KENDİ çağırmayan yollar.
TERMINAL_ISTISNALARI: dict[tuple[str, str], str] = {
    (
        "services/delivery_service.py",
        "_finalize_delivered",
    ): (
        "Durağı kanıt alanlarıyla (proof/lat/lng) KENDİ kapatır ve hemen "
        "ardından `packing_events.on_package_delivered` ile paketi terminale "
        "taşır; `teslim_terminali` sarmalayıcısına ihtiyacı yoktur."
    ),
}

#: Guard'ı ÇAĞIRMAYAN ama kuralı başka (ve doğrulanmış) bir mekanizmayla
#: uygulayan yollar. Liste **dar** ve her satırı gerekçelidir; bir giriş
#: eklemek, o yolun neden istisna olduğunu yazmayı zorunlu kılar.
ISTISNALAR: dict[tuple[str, str, str], str] = {
    (
        "services/delivery_service.py",
        "start_run",
        "SHIPPED",
    ): (
        "Paketi OLAN siparişi atlar (`paketler.get(order.id) is not None: "
        "continue`) — çıkışı zimmet yazmıştır. Davranış nöbetçisi: "
        "tests/integration/test_f30_guards_pg.py::"
        "test_C5_START_RUN_ZIMMETSIZ_PAKETLE_TURU_BASLATMAZ"
    ),
    (
        "services/delivery_service.py",
        "add_stops",
        "SHIPPED",
    ): (
        "Aktif tura eklenen durakta SHIPPED yalnız `paket is None` iken "
        "yazılır (sözleşme §3.4); paketi olan sipariş zimmeti bekler."
    ),
    (
        "services/delivery_service.py",
        "handover_scan",
        "SHIPPED",
    ): (
        "Zimmetin KENDİSİ — çıkışı yazan yol burasıdır. Kendi kendine kapı "
        "koyması döngü olurdu; paketin durumu bu fonksiyonun içinde "
        "`packing_rules.allows('handover', ...)` ile zaten doğrulanır."
    ),
}


def _kaynaklar() -> list[tuple[str, ast.Module]]:
    cikti = []
    for d in TARANAN_DIZINLER:
        for yol in sorted((KOK / d).rglob("*.py")):
            rel = yol.relative_to(KOK).as_posix()
            cikti.append((rel, ast.parse(yol.read_text(encoding="utf-8"), filename=rel)))
    return cikti


def _cagri_adi(node: ast.Call) -> str | None:
    """`f(...)` → 'f' · `m.f(...)` → 'f' · `a.b.f(...)` → 'f'."""
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def _gecis_hedefi(node: ast.AST) -> str | None:
    """Bu düğüm siparişi bir duruma geçiren bir YAZMA mı? Hedef durumu döndürür.

    İki biçim tanınır:
      * `order_fsm.transition_order(db, order, "DELIVERED", ...)`
      * `order.status = "DELIVERED"`  (helper'ı atlayan doğrudan atama)

    Docstring/yorumdaki dizgi eşleşmez: burada gezilen şey **AST düğümleri**dir,
    metin değil.
    """
    if isinstance(node, ast.Call):
        if _cagri_adi(node) != "transition_order":
            return None
        for arg in list(node.args) + [k.value for k in node.keywords]:
            if isinstance(arg, ast.Constant) and arg.value in ("DELIVERED", "SHIPPED"):
                return arg.value
        return None
    if isinstance(node, ast.Assign):
        for hedef in node.targets:
            if isinstance(hedef, ast.Attribute) and hedef.attr == "status":
                deger = node.value
                if isinstance(deger, ast.Constant) and deger.value in (
                    "DELIVERED",
                    "SHIPPED",
                ):
                    return deger.value
    return None


def _fonksiyonlar(agac: ast.Module):
    for dugum in ast.walk(agac):
        if isinstance(dugum, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield dugum


def _icteki_fonksiyonlar(fn) -> set[int]:
    """İç içe tanımlı fonksiyonların satırları — sahibine sayılmasınlar."""
    satirlar: set[int] = set()
    for dugum in ast.walk(fn):
        if dugum is fn:
            continue
        if isinstance(dugum, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for alt in ast.walk(dugum):
                if hasattr(alt, "lineno"):
                    satirlar.add(alt.lineno)
    return satirlar


#: `_teslim_yollari()` doldurur: kapıyı çağıran her fonksiyon + kilit izi.
KAPI_CAGIRANLARI: list = []
#: (dosya, fonksiyon) → o fonksiyondaki terminal helper çağrıları.
TERMINAL_IZI: dict = {}


def _teslim_yollari() -> list[tuple[str, str, str, int, list[tuple[str, int]]]]:
    """(dosya, fonksiyon, hedef_durum, geçiş_satırı, [(guard_adı, satır), ...])"""
    bulunanlar = []
    for rel, agac in _kaynaklar():
        for fn in _fonksiyonlar(agac):
            ic_satirlar = _icteki_fonksiyonlar(fn)
            guardlar: list[tuple[str, int]] = []
            gecisler: list[tuple[str, int]] = []
            kilitler: list[tuple[str, int]] = []
            terminaller: list[tuple[str, int]] = []
            for dugum in ast.walk(fn):
                if getattr(dugum, "lineno", None) in ic_satirlar:
                    continue
                if isinstance(dugum, ast.Call):
                    ad = _cagri_adi(dugum)
                    if ad in (TESLIM_KAPISI, SEVKIYAT_KAPISI):
                        guardlar.append((ad, dugum.lineno))
                    if ad in ORDER_KILITLERI:
                        kilitler.append((ad, dugum.lineno))
                    if ad in TERMINAL_HELPERLARI:
                        terminaller.append((ad, dugum.lineno))
                hedef = _gecis_hedefi(dugum)
                if hedef is not None:
                    gecisler.append((hedef, dugum.lineno))
            for hedef, satir in gecisler:
                bulunanlar.append((rel, fn.name, hedef, satir, guardlar))
            for ad, satir in guardlar:
                KAPI_CAGIRANLARI.append((rel, fn.name, ad, satir, kilitler))
            TERMINAL_IZI[(rel, fn.name)] = terminaller
    return bulunanlar


YOLLAR = _teslim_yollari()


def test_TESLIM_YOLU_TARAYICISI_GERCEKTEN_BULUYOR():
    """Ters prova: tarayıcı hiçbir şey bulmuyorsa yukarıdaki matris totolojiktir.

    Bilinen iki `DELIVERED` yolu (saha hunisi + yönetici ucu) ADIYLA aranır.
    Tarayıcı bozulup boş liste dönerse matrisin tamamı sessizce yeşile döner —
    bu düğüm o hâli imkânsız kılar.
    """
    delivered = {(d, f) for d, f, h, _s, _g in YOLLAR if h == "DELIVERED"}
    assert ("services/delivery_service.py", "_finalize_delivered") in delivered, delivered
    assert ("services/order_service.py", "mark_delivered") in delivered, delivered
    assert len(delivered) >= 2, delivered


@pytest.mark.parametrize(
    "dosya,fonksiyon,hedef,satir,guardlar",
    YOLLAR,
    ids=[f"{d.split('/')[-1]}::{f}::{h}@{s}" for d, f, h, s, _g in YOLLAR],
)
def test_DELIVERED_VE_SHIPPED_YOLLARI_ZIMMET_KAPISINDAN_GECER(
    dosya, fonksiyon, hedef, satir, guardlar
):
    """Her geçiş, KENDİ fonksiyonunda ve geçişten ÖNCE bir kapı çağrısı ister.

    "Önce" satır numarasıyla ölçülür. Guard'ı geçişten sonraya taşımak, ona
    ulaşılmadan e-posta/outbox/durum geçişinin doğması demektir — mutasyon
    provasının 2. ve 3. maddesi tam olarak bunu sınar.
    """
    gerekce = ISTISNALAR.get((dosya, fonksiyon, hedef))
    if gerekce:
        assert len(gerekce) > 40, "İstisna gerekçesi ciddi olmalı"
        return

    beklenen = TESLIM_KAPISI if hedef == "DELIVERED" else SEVKIYAT_KAPISI
    onceki = [ad for ad, g_satir in guardlar if g_satir < satir]
    assert beklenen in onceki, (
        f"{dosya}::{fonksiyon} siparişi {hedef} yapıyor (satır {satir}) ama "
        f"öncesinde `{beklenen}` çağrısı YOK. Bulunan kapılar: {guardlar}.\n"
        "Yeni bir teslim/sevkiyat yolu eklediysen ortak kapıyı çağır "
        "(`packing_events.zimmet_zorunlu` / `.elle_sevkiyat_yasak`); bilinçli "
        "bir istisnaysa ISTISNALAR sözlüğüne GEREKÇESİYLE ekle."
    )


def test_ISTISNA_LISTESI_BAYATLAMAZ():
    """Allowlist'te artık var olmayan bir yol kalmamalı.

    Bayat istisna sessiz bir delik üretir: fonksiyon yeniden adlandırılıp guard
    unutulursa, listede duran eski satır kimseyi uyarmaz.
    """
    gercek = {(d, f, h) for d, f, h, _s, _g in YOLLAR}
    bayat = set(ISTISNALAR) - gercek
    assert not bayat, f"ISTISNALAR bayat: {bayat}"


def test_ORTAK_KAPI_TEK_MODULDE():
    """Guard `packing_events`'te durur; kopyası olmamalı.

    İki ayrı zimmet kuralı, ikisinin ayrışması demektir — commit 7'nin ilk
    turunda `delivery_service` kendi kopyasını taşıyordu ve yönetici yolu o
    kopyayı göremediği için P1 doğdu.
    """
    tanimlar = []
    for rel, agac in _kaynaklar():
        for fn in _fonksiyonlar(agac):
            if fn.name in (TESLIM_KAPISI, SEVKIYAT_KAPISI, f"_{TESLIM_KAPISI}"):
                tanimlar.append((rel, fn.name))
    assert sorted(tanimlar) == [
        ("services/packing_events.py", SEVKIYAT_KAPISI),
        ("services/packing_events.py", TESLIM_KAPISI),
    ], tanimlar


@pytest.mark.parametrize(
    "dosya,fonksiyon,kapi,satir,kilitler",
    KAPI_CAGIRANLARI,
    ids=[f"{d.split('/')[-1]}::{f}::{k}" for d, f, k, _s, _kl in KAPI_CAGIRANLARI],
)
def test_F30_KAPISI_ORDER_KILIDINDEN_SONRA_CAGRILIR(
    dosya, fonksiyon, kapi, satir, kilitler
):
    """Kapı, `Order` satırı `FOR UPDATE` ile alınmadan ÇAĞRILMAZ.

    Nihai denetimin iki P1'i de buydu: kapının kendisi doğruydu ama **bayat
    veri** okuyordu. `mark_shipped` eşzamanlı `open_package` ile yarışınca
    `order=SHIPPED + package=OPEN` (kurtarılamaz çıkmaz), `mark_delivered`
    `cancel_run`/`fail_stop` ile yarışınca `order=DELIVERED +
    package=RETURN_PENDING` üretebiliyordu.

    Yarış testleri (`tests/integration/test_f30_admin_race_pg.py`) bu hataları
    gerçekten yakalıyor; bu yapısal düğüm ise kapının kilitten ÖNCEYE
    taşınmasını — yani yarışın yeniden açılmasını — zamanlamadan bağımsız
    olarak kırar.
    """
    gerekce = KILIT_ISTISNALARI.get((dosya, fonksiyon))
    if gerekce:
        assert len(gerekce) > 40, "İstisna gerekçesi ciddi olmalı"
        return
    onceki = [ad for ad, k_satir in kilitler if k_satir < satir]
    assert onceki, (
        f"{dosya}::{fonksiyon} F30 kapısını (`{kapi}`, satır {satir}) çağırıyor "
        f"ama öncesinde Order kilidi YOK. Bulunan kilitler: {kilitler}. "
        "Kilitsiz okunan paket durumu bayattır; kapıdan ÖNCE "
        "`_lock_order(db, order)` çağır ya da KILIT_ISTISNALARI'na ekle."
    )


DELIVERED_YOLLARI = [y for y in YOLLAR if y[2] == "DELIVERED"]


@pytest.mark.parametrize(
    "dosya,fonksiyon",
    [(y[0], y[1]) for y in DELIVERED_YOLLARI],
    ids=[f"{y[0].split('/')[-1]}::{y[1]}" for y in DELIVERED_YOLLARI],
)
def test_DELIVERED_YOLU_PAKET_VE_DURAGI_DA_TERMINALE_TASIR(dosya, fonksiyon):
    """Sipariş terminale giderse paket ve durak da gider.

    Mutlu yolda bile eksikti: `mark_delivered` YALNIZ sipariş durumunu
    değiştiriyordu; paket `HANDED_OVER`, durak `PENDING`, QR geçerli kalıyordu.
    Yani yöneticinin ekranı "teslim edildi" derken kurye o durağı hâlâ
    görüyor, basılı etiket okutulmaya devam ediyor ve "kuryede paket var"
    sorgusu `true` diyordu.
    """
    gerekce = TERMINAL_ISTISNALARI.get((dosya, fonksiyon))
    if gerekce:
        assert len(gerekce) > 40, "İstisna gerekçesi ciddi olmalı"
        return
    terminaller = TERMINAL_IZI.get((dosya, fonksiyon), [])
    assert terminaller, (
        f"{dosya}::{fonksiyon} siparişi DELIVERED yapıyor ama paket/durak "
        f"terminalini çağırmıyor ({sorted(TERMINAL_HELPERLARI)}). Sipariş "
        "'teslim edildi' derken operasyonun 'yolda' demesi imkânsız olmalı."
    )


def test_TERMINAL_HELPER_ADLARI_GERCEKTEN_PACKING_EVENTS_TE_TANIMLI():
    """Terminal kümesi gevşetilerek nöbetçi sessizce etkisizleştirilemesin.

    Mutasyon provasında bulundu: kümeye `transition_order` gibi HER teslim
    yolunda zaten bulunan bir ad eklemek, üstteki düğümü totolojiye çevirip
    hiçbir testi kırmıyordu. Küme artık gerçek tanımlarla bağlı — `packing_events`
    içinde tanımlı olmayan bir ad "terminal helper" sayılamaz.
    """
    agac = ast.parse(
        (KOK / "services/packing_events.py").read_text(encoding="utf-8"),
        filename="packing_events.py",
    )
    tanimli = {fn.name for fn in _fonksiyonlar(agac)}
    eksik = TERMINAL_HELPERLARI - tanimli
    assert not eksik, (
        f"TERMINAL_HELPERLARI'nda `services/packing_events.py`'de TANIMLI OLMAYAN "
        f"ad(lar) var: {sorted(eksik)}. Kümeyi genişletmek nöbetçiyi etkisizleştirir."
    )
