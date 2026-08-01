"""F30 YAPISAL sözleşmeleri — kaynak/AST taraması (DÜŞÜK GÜÇLÜ).

Repo standardı (kök `CLAUDE.md` → §C) bu tür testleri **düşük güçlü** sayar:
"kod böyle yazılmış" der, "davranış doğru" demez. Her madde ya mimari bir
sözleşmedir ya da bir **regresyon nöbetçisidir**, ve her birinin yanında bir
davranış testi adıyla belirtilir.

Kurallar (F29'dan devralındı, bir kez tuzağa düşüldüğü için yazılı):
* sınıf/fonksiyon sınırı **AST ile** bulunur (`find()` + karakter penceresi YOK),
* docstring'ler taramadan çıkarılır (yorum metni yalancı eşleşme üretmesin),
* test kendi kaynağını yakalayamaz.

İki tür madde vardır ve karıştırılmamalıdır:

* **KIRMIZI** — F30 henüz yazılmadığı için başarısız olmalıdır (`HENÜZ YAZILMADI`).
* **NÖBETÇİ** — bugün YEŞİLDİR ve F30 boyunca yeşil kalmalıdır; F29'un
  genişletilmediğini ve stoğun ikinci kez düşürülmediğini kanıtlar.
"""
from __future__ import annotations

import ast
import importlib.util
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[2]

YENI_IZINLER = ("packing.view", "packing.pack", "packing.manage")

#: Hijyen nöbetçisinin izlemesi gereken yeni tablolar (test izolasyonu).
YENI_TABLOLAR = ("order_packages", "order_package_items", "package_scan_events")

#: F30 servis modülleri. `packing_rules` SAF olmalı (DB'ye dokunmaz).
SAF_MODUL = "services/packing_rules.py"
SERVIS_MODUL = "services/packing_service.py"
#: `order_fsm`'in çağırdığı ince olay modülü (sözleşme §3.7).
OLAY_MODUL = "services/packing_events.py"


def _import_edilenler(rel: str) -> set[str]:
    """Modülün import ettiği adlar (AST; docstring/yorum sayılmaz)."""
    out: set[str] = set()
    for d in ast.walk(_agac(rel)):
        if isinstance(d, ast.Import):
            out.update(a.name for a in d.names)
        elif isinstance(d, ast.ImportFrom):
            modul = d.module or ""
            out.add(modul)
            out.update(f"{modul}.{a.name}" for a in d.names)
    return out


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


def _enum_uyeleri(agac: ast.Module, sinif: str) -> set[str]:
    dugum = _dugum(agac, sinif)
    assert dugum is not None, f"{sinif} bulunamadı"
    return {
        h.target.id
        for h in dugum.body
        if isinstance(h, ast.AnnAssign) and isinstance(h.target, ast.Name)
    } | {
        t.id
        for a in dugum.body
        if isinstance(a, ast.Assign)
        for t in a.targets
        if isinstance(t, ast.Name)
    }


# ══════════════════ KIRMIZI: izin kablolaması ═══════════════════════════════


def test_packing_izinleri_KATALOGDA():
    """Katalogda olmayan izin hiçbir role bağlanamaz → SUPER_ADMIN dahil sessiz 403.
    Davranış eşi: `test_f30_packing_http_pg.py::test_pack_izniyle_tam_akis_200`."""
    from core.admin_permissions import PERMISSION_CODES

    eksik = [k for k in YENI_IZINLER if k not in PERMISSION_CODES]
    assert not eksik, f"kataloğa eklenmemiş izinler: {eksik}"


def test_izin_migrationi_VAR():
    """Katalog + DB + ROL üçlüsünden biri eksikse izin işe yaramaz (sözleşme §7 S6).

    Burada yalnız migration dosyasının VARLIĞI aranır — bu düşük güçlü bir
    ipucudur. **Gerçek rol→izin dağılımı** migration uygulandıktan sonra
    veritabanından ölçülür:
    `tests/integration/test_f30_permissions_pg.py`. Metinde rol adının geçmesini
    aramak, OPERATIONS_MANAGER'a yanlışlıkla `packing.manage` verilmesini
    yakalayamazdı (denetim bulgusu 2).
    """
    versions = BACKEND / "migrations" / "versions"
    adaylar = [
        p for p in versions.glob("*.py") if "packing." in p.read_text(encoding="utf-8")
    ]
    if not adaylar:
        pytest.fail(
            "HENÜZ YAZILMADI: packing.* izinlerini seed eden migration", pytrace=False
        )


# ══════════════════ NÖBETÇİ: canlı paket yüklemi ════════════════════════════


def _migration_modulu(revizyon: str):
    """Migration dosyasını GERÇEKTEN import eder (metin araması değil).

    `migrations/versions` bir Python paketi değildir; dosya yolundan yüklenir.
    Amaç, migration'ın sabitini **çalışma zamanı değeri** olarak okumak: metin
    aramak, yorum satırındaki bir örnekle eşleşip yalancı yeşil üretirdi.
    """
    yol = BACKEND / "migrations" / "versions" / f"{revizyon}.py"
    assert yol.exists(), f"migration bulunamadı: {yol}"
    spec = importlib.util.spec_from_file_location(f"_f30_mig_{revizyon}", yol)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def test_CANLI_PAKET_yuklemi_UCLU_AYRISAMAZ():
    """Model sabiti ↔ migration sabiti ↔ terminal durum kümesi: üçü tek anlam.

    Bu, commit 2 denetiminin P2-2 bulgusudur: `alembic check` kısmi index'in
    `WHERE` yüklemini KARŞILAŞTIRMAZ, yalnız index'in varlığını görür. Yani
    migration'daki yüklem `('VOID')`'e daralsa ya da `('DELIVERED','VOID',
    'RETURNED')`'a genişlese autogenerate sessiz kalırdı — ve hata "ikinci
    paket açılamıyor"/"iki canlı paket oluştu" olarak ancak sahada görünürdü.

    Karşılaştırma metin düzeyinde DEĞİL anlam düzeyindedir (bkz.
    `tests/f30_predicate.py`): boşluk/sıra farkına kırılmaz, kümenin
    değişmesine kırılır.

    Davranış eşi (gerçek DB'deki uygulanmış index):
    `test_f30_package_schema_pg.py::test_CANLI_INDEX_YUKLEMI_TERMINAL_KUMESIYLE_AYNI`.
    """
    from models.packing import (
        LIVE_PACKAGE_SQL,
        PACKAGE_STATUSES,
        TERMINAL_PACKAGE_STATUSES,
    )
    from tests.f30_predicate import canli_kume

    beklenen = frozenset(PACKAGE_STATUSES) - frozenset(TERMINAL_PACKAGE_STATUSES)
    assert beklenen, "terminal küme bütün durumları yutmuş"

    model_kume = canli_kume(LIVE_PACKAGE_SQL, tum_durumlar=PACKAGE_STATUSES)
    assert model_kume == beklenen, (
        f"LIVE_PACKAGE_SQL terminal kümeden ayrışmış: {sorted(model_kume)} "
        f"≠ {sorted(beklenen)}"
    )

    migration = _migration_modulu("f30_paketleme_semasi")
    mig_kume = canli_kume(migration._LIVE, tum_durumlar=PACKAGE_STATUSES)
    assert mig_kume == model_kume, (
        f"migration yüklemi modelden ayrışmış: {sorted(mig_kume)} "
        f"≠ {sorted(model_kume)}"
    )
    # Migration'ın durum sözlüğü de aynı olmalı; aksi hâlde CHECK ile FSM
    # ayrışır ve servis yazamayacağı bir durumu "geçerli" sanır.
    assert tuple(migration._STATUSES) == tuple(PACKAGE_STATUSES)


def test_PAKET_DURUM_KUMESI_UCLU_AYNI():
    """Saf kural modülü ↔ model ↔ migration: aynı durum sözlüğü, aynı sıra.

    `packing_rules` `models`'i import EDEMEZ (saflık kuralı), bu yüzden durum
    adları ikinci kez yazılıdır. Ayrışırlarsa hata sessizdir: FSM izin verdiği
    bir geçişi DB CHECK'i reddeder ve kullanıcı 500 görür — ya da tersi, CHECK
    kabul ettiği bir durumu FSM hiç üretemez ve o durum ölü kalır.

    Geçiş matrisinin uçları da aynı sözlükten olmalıdır: matriste yazım hatalı
    bir durum (`RETURN_PENDNG`) sessizce "hiçbir zaman izinli olmayan bir
    geçiş" üretirdi.
    """
    from models.packing import PACKAGE_STATUSES as MODEL_STATUSES
    from models.packing import TERMINAL_PACKAGE_STATUSES
    from services import packing_rules

    migration = _migration_modulu("f30_paketleme_semasi")

    assert tuple(packing_rules.PACKAGE_STATUSES) == tuple(MODEL_STATUSES)
    assert tuple(migration._STATUSES) == tuple(MODEL_STATUSES)
    assert tuple(packing_rules.TERMINAL_STATUSES) == tuple(TERMINAL_PACKAGE_STATUSES)

    uclar = {b for b, _h in packing_rules.PACKAGE_TRANSITIONS} | {
        h for _b, h in packing_rules.PACKAGE_TRANSITIONS
    }
    bilinmeyen = uclar - set(MODEL_STATUSES)
    assert not bilinmeyen, f"geçiş matrisinde tanımsız durum: {sorted(bilinmeyen)}"

    # Canlı küme, terminal kümenin tümleyeni olmalı — üçüncü bir tanım yok.
    assert set(packing_rules.LIVE_STATUSES) == set(MODEL_STATUSES) - set(
        TERMINAL_PACKAGE_STATUSES
    )


def test_ISLEM_TABLOSU_OLAY_SOZLUGUNDEN_CIKMAZ():
    """`PACKAGE_ACTIONS`'ın ürettiği her olay tipi DB CHECK'inde tanımlı olmalı.

    `ck_package_scan_events_type` dar tutulmuştur (yazım hatası sessiz bir "iz
    yok" üretirdi). Saf tabloya CHECK'te olmayan bir `event_type` yazılırsa
    işlem çalışma zamanında `IntegrityError` verir — ve bu ancak o yol ilk kez
    kullanıldığında, yani üretimde görülürdü.
    """
    from models.packing import PACKAGE_EVENT_TYPES
    from services import packing_rules

    uretilenler = {k.event_type for k in packing_rules.PACKAGE_ACTIONS.values()}
    bilinmeyen = uretilenler - set(PACKAGE_EVENT_TYPES)
    assert not bilinmeyen, f"olay sözlüğünde olmayan tip: {sorted(bilinmeyen)}"

    # İşlemin hedef durumu geçiş matrisinde de izinli olmalı; aksi hâlde tablo
    # "yapılabilir" derken FSM "yasak" der ve işlem hiçbir durumdan çalışmaz.
    for ad, kural in packing_rules.PACKAGE_ACTIONS.items():
        if kural.to_status is None or not kural.from_statuses:
            continue
        for kaynak in kural.from_statuses:
            assert packing_rules.can_transition(kaynak, kural.to_status), (
                f"{ad}: {kaynak} → {kural.to_status} geçiş matrisinde yok"
            )


# ══════════════════ KIRMIZI: test izolasyonu ════════════════════════════════


def test_yeni_tablolar_HIJYEN_NOBETCISINDE():
    """Yeni tablo nöbetçiye eklenmezse sızan satırlar suite'i kırmaz ve test
    verisi zamanla admin ekranlarını şişirir (F29'da bir kez yaşandı)."""
    from tests.integration.conftest import _KRITIK_TABLOLAR

    eksik = [t for t in YENI_TABLOLAR if t not in _KRITIK_TABLOLAR]
    assert not eksik, f"hijyen nöbetçisine eklenmemiş tablolar: {eksik}"


# ══════════════════ KIRMIZI: saf kural modülü ═══════════════════════════════


def test_packing_rules_SAF_kalir():
    """`packing_rules` DB'ye, ORM'e ve FastAPI'ye dokunmaz.

    Sebep F29'un gerekçesiyle aynı (`inventory_rules.py:3-7`): FSM ve fiziksel
    anlam tablosu **veri olarak** durduğunda, "HANDED_OVER'ı da işletmede say"
    gibi tek satırlık bir sapma bir testte görünür. Servise gömülürse görünmez.
    """
    agac = _agac(SAF_MODUL)
    yasak = ("sqlalchemy", "models", "fastapi", "core.database", "services.stock_ledger")
    for d in ast.walk(agac):
        if isinstance(d, ast.Import):
            adlar = [a.name for a in d.names]
        elif isinstance(d, ast.ImportFrom):
            adlar = [d.module or ""]
        else:
            continue
        for ad in adlar:
            assert not any(ad.startswith(y) for y in yasak), (
                f"saf modül DB/HTTP katmanına dokunuyor: import {ad}"
            )


def test_paket_FSM_ve_konum_tablosu_SAF_VERIDIR():
    """`PACKAGE_TRANSITIONS` ve `PACKAGE_LOCATION` modül düzeyinde sabit olmalı.

    Davranış eşi: `test_f30_packing_rules_pure.py` (terminal çıkışsızlığı,
    her durumun konumu, canlı küme).
    """
    agac = _agac(SAF_MODUL)
    isimler = {
        t.id
        for a in agac.body
        if isinstance(a, (ast.Assign, ast.AnnAssign))
        for t in ([a.target] if isinstance(a, ast.AnnAssign) else a.targets)
        if isinstance(t, ast.Name)
    }
    for gerekli in ("PACKAGE_TRANSITIONS", "PACKAGE_LOCATION", "LIVE_STATUSES"):
        assert gerekli in isimler, f"saf veri eksik: {gerekli}"


# ══════════════════ KIRMIZI: F29 stoğuna dokunmama ══════════════════════════


def test_f30_servisleri_STOK_DEFTERINI_CAGIRMAZ():
    """F30 aynı ürünü ikinci kez stoktan düşüremez (denetçi notu 2).

    PAID siparişte `SALE` zaten yazılmıştır (`order_service.py:703`); paketleme
    fiziksel doğrulama/konum olayıdır. Davranış eşi:
    `test_f30_packing_pg.py::test_paket_tamamlaninca_DEFTERE_HAREKET_YAZILMAZ`.
    """
    for rel in (SAF_MODUL, SERVIS_MODUL):
        agac = _agac(rel)
        dokum = _dump_docstringsiz(agac)
        for yasak in ("stock_ledger", "apply_movement", "apply_many"):
            assert yasak not in dokum, f"{rel} defteri çağırıyor: {yasak}"


def test_f30_servisleri_STOK_KOLONLARINA_YAZMAZ():
    """`products.stock` / `damaged_stock` tek yazıcısı `stock_ledger`'dır
    (`models/store.py:225-228`). F30 bu kuralı delmez."""
    for rel in (SAF_MODUL, SERVIS_MODUL):
        agac = _agac(rel)
        for d in ast.walk(agac):
            hedefler = []
            if isinstance(d, ast.Assign):
                hedefler = d.targets
            elif isinstance(d, ast.AugAssign):
                hedefler = [d.target]
            for h in hedefler:
                if isinstance(h, ast.Attribute):
                    assert h.attr not in ("stock", "damaged_stock"), (
                        f"{rel}: stok kolonuna doğrudan atama"
                    )


# ══════════════════ KIRMIZI: import sınırı (sözleşme §3.7) ═════════════════


def test_packing_events_SERVISI_IMPORT_ETMEZ():
    """`order_fsm → packing_events → packing_service` döngü kurar.

    `order_fsm` sipariş terminal olurken canlı paketi çözmek zorunda (§3.5);
    `packing_service` ise `order_fsm`'i kullanıyor. Karşılıklı import modül
    düzeyinde ImportError, fonksiyon içinde gizli bir döngüdür. Sınır:
    `packing_events` ince kalır — yalnız modeller + saf kurallar.
    """
    icerik = _import_edilenler(OLAY_MODUL)
    yasak = [
        a for a in icerik if "packing_service" in a or "delivery_service" in a
    ]
    assert not yasak, f"packing_events döngü kuruyor: {yasak}"


def test_order_fsm_PACKING_SERVICE_import_etmez():
    """`order_fsm` yalnız ince olay modülünü tanır (tek yön)."""
    icerik = _import_edilenler("services/order_fsm.py")
    yasak = [a for a in icerik if "packing_service" in a]
    assert not yasak, f"order_fsm doğrudan servise bağlanmış: {yasak}"


def test_order_fsm_TERMINAL_gecise_paket_kancasi_TAKAR():
    """Kanca gerçekten bağlanmalı: CANCELLED/REFUNDED geçişinde canlı paket
    çözülmezse iptal edilmiş siparişin paketi rafta kalır (G8).

    Davranış eşi: `test_f30_packing_pg.py::test_IPTAL_acik_paketi_VOID_eder`.
    """
    dugum = _dugum(_agac("services/order_fsm.py"), "transition_order")
    assert dugum is not None
    cagrilar = {
        n.func.attr if isinstance(n.func, ast.Attribute) else getattr(n.func, "id", "")
        for n in ast.walk(dugum)
        if isinstance(n, ast.Call)
    }
    assert "on_order_terminal" in cagrilar, (
        "order_fsm terminal geçişte paket kancasını çağırmıyor"
    )


def test_packing_service_DELIVERY_SERVICE_import_etmez():
    """Zimmet `delivery_service` tarafındadır; ters bağımlılık ikinci bir
    döngü açardı."""
    yasak = [a for a in _import_edilenler(SERVIS_MODUL) if "delivery_service" in a]
    assert not yasak, f"packing_service dağıtım servisine bağlanmış: {yasak}"


# ══════════════════ NÖBETÇİ: F29 genişletilmedi ═════════════════════════════


def test_NOBETCI_yeni_stok_hareket_tipi_EKLENMEDI():
    """F30 yeni `StockMovementType` üretmez (sözleşme §5).

    Bugün YEŞİL; F30 boyunca yeşil kalmalı. Kırmızıya dönerse F29 defteri
    sessizce genişletilmiş demektir ve `PHYSICAL_EFFECT` fail-safe'i
    (`inventory_rules.is_auto_reconcilable`) her sayım satırını STALE yapar.
    """
    mevcut = _enum_uyeleri(_agac("models/store.py"), "StockMovementType")
    assert mevcut == {
        "OPENING_BALANCE", "INITIAL", "SALE", "SALE_CANCEL", "RETURN",
        "ADMIN_ADJUSTMENT", "COUNT_ADJUSTMENT", "DAMAGE_TRANSFER",
        "DAMAGE_RECOVERY", "DAMAGE_DISPOSAL", "SUPPLIER_RETURN",
    }, f"hareket tipleri değişmiş: {sorted(mevcut)}"


def test_NOBETCI_yeni_SIPARIS_DURUMU_eklenmedi():
    """`OrderStatus`'e `PACKED`/`PREPARED` eklenmez (sözleşme §3.2, denetçi notu 1).

    Yeni ara statü `reserved_on_premise` (yalnız `status='PAID'` sayar,
    `inventory_service.py:134`), `ix_orders_fulfillment_queue` kısmi index'i ve
    dört kuyruk sorgusunu birden sessizce bozardı.
    """
    mevcut = _enum_uyeleri(_agac("models/store.py"), "OrderStatus")
    assert mevcut == {
        "PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"
    }, f"sipariş durumları değişmiş: {sorted(mevcut)}"


def test_NOBETCI_PHYSICAL_EFFECT_genisletilmedi():
    """`ORDER_PREPARED` / `ORDER_SHIPPED` / `DELIVERY_FAILED` zaten F30'un
    ihtiyacını karşılıyor (`inventory_rules.py:77-81`); yeni olay eklenmez."""
    from services.inventory_rules import PHYSICAL_EFFECT

    assert set(PHYSICAL_EFFECT) == {
        "INITIAL", "SALE", "SALE_CANCEL", "SALE_CANCEL_SHIPPED", "RETURN",
        "ADMIN_ADJUSTMENT", "COUNT_ADJUSTMENT", "DAMAGE_TRANSFER",
        "DAMAGE_RECOVERY", "DAMAGE_DISPOSAL", "SUPPLIER_RETURN",
        "ORDER_PREPARED", "ORDER_SHIPPED", "ORDER_DELIVERED",
        "DELIVERY_FAILED", "STOP_REMOVED", "RETURN_RECEIVED", "MANUAL_DB_CHANGE",
    }
    # F30'un dayandığı üç anlam değişmemeli.
    assert PHYSICAL_EFFECT["ORDER_PREPARED"].on_premise == 0
    assert PHYSICAL_EFFECT["ORDER_SHIPPED"].on_premise == -1
    assert PHYSICAL_EFFECT["DELIVERY_FAILED"].on_premise == +1


def test_NOBETCI_reserved_on_premise_PAID_tabanli_kalir():
    """F29 rezerve tanımı F30'da DEĞİŞTİRİLMEZ (sözleşme §7 S1).

    Değiştirilirse `RETURN_PENDING` sapması kapanır ama F29 kapalı paket
    yeniden açılmış olur; bu bilinçli bir borçtur, sessiz bir değişiklik değil.
    """
    from services.inventory_service import _RESERVED_ORDER_STATUS

    assert _RESERVED_ORDER_STATUS == "PAID"


# ══════════════════ KIRMIZI: kilit sırası ═══════════════════════════════════


def test_kanonik_sirada_PAKET_ORDER_ile_STOP_ARASINDA():
    """Sözleşme: … → Order → OrderReturn → **OrderPackage** → DeliveryStop.

    Sıra ortak modülden (`tests/acceptance/lock_contract.py`) okunur; kaynak
    metninde literal aranmaz. Bu, denetim bulgusu 1'in düzeltmesidir: eski hâli
    geçmek için üretim koduna anlamsız bir dizgi eklemeyi gerektiriyordu.
    """
    from tests.acceptance.lock_contract import CANONICAL_LOCK_ORDER, lock_rank

    assert "OrderPackage" in CANONICAL_LOCK_ORDER
    assert lock_rank("Order") < lock_rank("OrderPackage") < lock_rank("DeliveryStop")


def test_kanonik_sira_F29_ALT_DIZISINI_KORUR():
    """F30, F29'un kilit sırasını değiştirmez — yalnız araya bir kaynak ekler.

    `Product → Order → OrderReturn` alt dizisi bozulursa
    `test_stock_lock_contract.py::test_kaynak_kilit_sirasi_kanonik` ile iki ayrı
    doğruluk kaynağı oluşur ve biri sessizce yanlış kalır.
    """
    from tests.acceptance.lock_contract import CANONICAL_LOCK_ORDER, lock_rank

    f29 = ["Product", "Order", "OrderReturn"]
    assert [k for k in CANONICAL_LOCK_ORDER if k in f29] == f29
    assert lock_rank("StockCountSession") < lock_rank("Product")


@pytest.mark.parametrize(
    "fonksiyon",
    ["open_package", "complete", "void", "return_in", "repack"],
)
def test_packing_service_KILIT_SIRASI_kanonik(fonksiyon):
    """Fonksiyonun GERÇEK çağrı sırası ölçülür (AST), literal değil.

    `mark_prepared`'ın kilitsiz deseni (G7) kopyalanırsa ya da kilitler ters
    sırayla alınırsa burada görünür. Asıl koruma gerçek yarış testidir:
    `test_f30_packing_race_pg.py::test_kilit_sirasi_DEADLOCK_URETMEZ`.
    """
    from tests.acceptance.lock_contract import canonical_violations, observed_lock_models

    dugum = _dugum(_agac(SERVIS_MODUL), fonksiyon)
    assert dugum is not None, f"HENÜZ YAZILMADI: {SERVIS_MODUL}::{fonksiyon}"
    gorulen = observed_lock_models(dugum)
    assert gorulen, f"{fonksiyon} hiçbir kaynağı kilitlemiyor (G7 deseni)"
    assert "Order" in [m for m, _ln in gorulen], (
        f"{fonksiyon} siparişi FOR UPDATE ile almıyor — iptalle yarışır"
    )
    ihlaller = canonical_violations(dugum)
    assert not ihlaller, f"{fonksiyon} kanonik kilit sırasını bozuyor: {ihlaller}"


def test_handover_scan_KILIT_SIRASI_kanonik():
    """Zimmet üç kaynağı birden alan tek akıştır: Order → OrderPackage → DeliveryStop."""
    from tests.acceptance.lock_contract import canonical_violations, observed_lock_models

    dugum = _dugum(_agac("services/delivery_service.py"), "handover_scan")
    if dugum is None:
        pytest.fail(
            "HENÜZ YAZILMADI: delivery_service.handover_scan", pytrace=False
        )
    modeller = [m for m, _ln in observed_lock_models(dugum)]
    assert {"Order", "OrderPackage"} <= set(modeller), (
        f"zimmet sipariş+paket kilidi almıyor: {modeller}"
    )
    assert not canonical_violations(dugum)


# ══════════════════ KIRMIZI: kablolama ══════════════════════════════════════


def test_paket_modelleri_KAYITLI():
    """`models/__init__` üzerinden import EDİLEBİLİR olmalı.

    Metinde ad aramak yerine gerçek import denenir: Alembic autogenerate
    modelleri bu paketten toplar; import edilemeyen tablo `alembic check`
    drift'inden de kaçar.
    """
    import models

    eksik = [
        s
        for s in ("OrderPackage", "OrderPackageItem", "PackageScanEvent")
        if not hasattr(models, s)
    ]
    assert not eksik, f"models paketinden import edilemiyor: {eksik}"
    assert set(eksik).isdisjoint(models.__all__ or [])


def _router_yollari() -> set[str]:
    """Uygulamanın GERÇEK route tablosu — OpenAPI şemasından.

    Ne `api_router.routes` ne de `app.routes` KULLANILAMAZ: FastAPI 0.137'de
    `include_router` lazy bir `_IncludedRouter` bırakır ve route'lar ancak
    istek çözümlenirken düzleşir. O listelerde yol aramak her zaman boş küme
    döndürür, yani test **yalancı yeşil** olur.

    Bu tuzağa denetim düzeltmesi sırasında iki kez düşüldü: `api_router.routes`
    ile yazılan ilk sürümde `test_prepare_uclari_KALDIRILDI` uçlar dururken
    geçiyordu, `app.routes`'a geçirilen ikinci sürümde de geçmeye devam etti.
    `app.openapi()["paths"]` 322 yol döndürür ve gerçeği yansıtır.
    """
    from main import app

    return set(app.openapi()["paths"])


def test_packing_router_KAYITLI():
    """Router include edilmezse uçlar 404 döner. GERÇEK route tablosu okunur.

    ⚠️ Bu düğüm commit 1'de **yanlış sebeple kırmızıydı**: yol öneki
    `"/packing/"` sanılmıştı, oysa `api_router` uygulamaya
    `settings.API_V1_PREFIX` ile bağlanır (`main.py:239`) ve OpenAPI tablosunda
    yollar `/api/v1/packing/...` olarak görünür. Yani router yazılsa bile test
    geçemezdi — kırmızılığı hiçbir şeyin kanıtı değildi. Önek artık
    **ayardan** okunur; sabit yazılsaydı prefix değiştiğinde test sessizce
    yanlış yeri arardı.
    """
    from core.config import settings

    onek = f"{settings.API_V1_PREFIX}/packing/"
    yollar = _router_yollari()
    assert any(y.startswith(onek) for y in yollar), (
        f"packing router include edilmemiş (route tablosunda {onek} yok)"
    )


def test_zimmet_uclari_SAHA_ROUTERINDA():
    """Zimmet ve manifest **saha** router'ındadır (ADMIN + KURYE).

    Paketleme uçları ADMIN-only'dir; zimmeti kurye yapar. İkisi aynı router'a
    konsaydı ya kurye depo ekranlarını görürdü ya da zimmet yalnız admin'e
    kalırdı — ikisi de sözleşme §6'yı bozar.
    Davranış eşi: `test_f30_packing_http_pg.py::test_KURYE_zimmet_ucunu_KULLANABILIR`
    ve `::test_KURYE_paketleme_uclarina_ERISEMEZ`.
    """
    from core.config import settings

    yollar = _router_yollari()
    for yol in ("/delivery/handover/scan", "/delivery/handover/manifest/{run_id}"):
        assert f"{settings.API_V1_PREFIX}{yol}" in yollar, f"eksik uç: {yol}"


def test_prepare_uclari_KALDIRILDI():
    """Elle "Hazır" butonu (`/orders/{id}/prepare`, `/unprepare`) kaldırılır.

    İki kapı bırakmak "eksik kalem kabul edilmez" ilkesini boşa çıkarır
    (sözleşme §3.5). Kaynak metni değil GERÇEK route tablosu denetlenir.
    Davranış eşi: `test_f30_packing_http_pg.py::test_eski_prepare_ucu_ARTIK_YOK`.
    """
    kalanlar = [
        y for y in _router_yollari() if y.endswith(("/prepare", "/unprepare"))
    ]
    assert not kalanlar, f"eski hazırlama uçları duruyor: {kalanlar}"


def test_prepared_at_YAZICILARI_SINIRLI():
    """`prepared_at`'i yazan yerler sözleşmede sayılıdır (§3.5):
    `packing_service` (complete + repack) ve `order_service`
    (`roll_promise_after_failed_attempt` sıfırlaması). `delivery_service`
    ARTIK yazmaz — `mark_prepared` kaldırıldığı için."""
    agac = _agac("services/delivery_service.py")
    for d in ast.walk(agac):
        hedefler = d.targets if isinstance(d, ast.Assign) else []
        for h in hedefler:
            if isinstance(h, ast.Attribute):
                assert h.attr not in ("prepared_at", "prepared_by"), (
                    "delivery_service hâlâ prepared_at yazıyor"
                )


#: `prepared_at` / `prepared_by`'a yazabilen TEK fonksiyonlar (sözleşme §3.5).
#: `(modül, fonksiyon)` — modül düzeyinde ya da başka bir fonksiyonda yazmak
#: yasaktır.
PREPARED_AT_ALLOWLIST: frozenset[tuple[str, str]] = frozenset(
    {
        # Yazanlar: doğrulanmış paket → sipariş hazır.
        ("services/packing_service.py", "complete"),
        ("services/packing_service.py", "repack"),
        # Sıfırlayanlar: paket çözüldü / kuryeden döndü ama yeniden dağıtıma
        # ONAYLANMADI / sipariş terminal oldu / teslim denemesi başarısız.
        ("services/packing_service.py", "void"),
        ("services/packing_service.py", "return_in"),
        ("services/packing_events.py", "on_order_terminal"),
        ("services/order_service.py", "roll_promise_after_failed_attempt"),
    }
)

#: Taranan üretim ağacı. `tests/` ve `migrations/` dışarıdadır: fikstürler
#: satırı INSERT sırasında kurucu argümanıyla yazar, bu bir yazıcı DEĞİLDİR.
_URETIM_DIZINLERI = ("services", "api", "core", "scripts")


def _prepared_at_yazicilari() -> set[tuple[str, str]]:
    """Üretim ağacındaki BÜTÜN `x.prepared_at = ...` / `x.prepared_by = ...`
    atamalarını `(dosya, kapsayan fonksiyon)` olarak toplar.

    AST okunur: yorum, docstring ve metin eşleşmesi testi kandıramaz. Kapsayan
    fonksiyon `ast.walk` ile değil **gövde ağacında yürüyerek** bulunur, yani
    "en yakın fonksiyon" doğru saptanır.
    """
    bulunan: set[tuple[str, str]] = set()

    def _gez(dugum, dosya: str, fonksiyon: str) -> None:
        for cocuk in ast.iter_child_nodes(dugum):
            ad = fonksiyon
            if isinstance(cocuk, (ast.FunctionDef, ast.AsyncFunctionDef)):
                ad = cocuk.name
            hedefler: list = []
            if isinstance(cocuk, ast.Assign):
                hedefler = list(cocuk.targets)
            elif isinstance(cocuk, (ast.AugAssign, ast.AnnAssign)):
                hedefler = [cocuk.target]
            for h in hedefler:
                if isinstance(h, ast.Attribute) and h.attr in (
                    "prepared_at",
                    "prepared_by",
                ):
                    bulunan.add((dosya, ad))
            _gez(cocuk, dosya, ad)

    for dizin in _URETIM_DIZINLERI:
        kok = BACKEND / dizin
        if not kok.exists():
            continue
        for yol in kok.rglob("*.py"):
            rel = yol.relative_to(BACKEND).as_posix()
            _gez(ast.parse(yol.read_text(encoding="utf-8")), rel, "<modül>")
    return bulunan


def test_prepared_at_YAZICILARI_ALLOWLISTTE():
    """Üretimde `prepared_at`'e yazan HER yer sözleşmedeki listede olmalı.

    Bu, F30'un kapanış nöbetçisidir. Boşluk G1'in tamamı "hazır" damgasının
    kalem kalem doğrulanmamış bir paketten doğabilmesiydi; damganın kaynağı
    tek bir yerde sayılı DEĞİLSE kural bir sonraki özellikte sessizce delinir.

    Yeni bir yazıcı eklemek bu testi kırar ve yazarı sözleşmeyi güncellemeye
    (ya da vazgeçmeye) zorlar — istenen tam olarak budur.
    """
    bulunan = _prepared_at_yazicilari()
    fazla = bulunan - PREPARED_AT_ALLOWLIST
    assert not fazla, (
        "sözleşme dışı `prepared_at` yazıcısı: "
        + ", ".join(f"{d}::{f}" for d, f in sorted(fazla))
    )
    # Ters yön: listede olup KOD'da olmayan bir giriş, listenin bayatladığını
    # gösterir (ör. fonksiyon yeniden adlandırıldı ve nöbetçi körleşti).
    eksik = PREPARED_AT_ALLOWLIST - bulunan
    assert not eksik, (
        "allowlist bayat — bu yazıcılar artık yok: "
        + ", ".join(f"{d}::{f}" for d, f in sorted(eksik))
    )


def test_mark_prepared_KALDIRILDI():
    """Elle hazırlama İŞ MANTIĞI da silindi — yalnız uçlar değil.

    Uçları kaldırıp servis fonksiyonunu bırakmak, bir sonraki router'ın onu
    yeniden yayımlamasını bir satırlık iş hâline getirirdi. Fonksiyon adı
    üretim ağacının hiçbir yerinde tanımlı olmamalı.
    """
    for rel in ("services/delivery_service.py", "api/routers/delivery.py"):
        agac = _agac(rel)
        adlar = {
            d.name
            for d in ast.walk(agac)
            if isinstance(d, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        yasak = adlar & {"mark_prepared", "unmark_prepared", "unprepare_order"}
        assert not yasak, f"{rel}: elle hazırlama yolu geri gelmiş: {sorted(yasak)}"


def test_VOID_YETKI_DOGRULAYICISI_ZORUNLU():
    """`packing_service.void` `izin_dogrula`yı **zorunlu** parametre olarak ister.

    Commit 5 denetiminin bulgusu: parametrenin varsayılanı `None`'dı ve `None`
    geldiğinde hiçbir yetki kontrolü yapılmıyordu. Yani `void`, servis
    düzeyinde **fail-open**'dı: ileride eklenecek ikinci bir router ya da arka
    plan işi parametreyi geçirmeyi unuttuğunda `PACKED` bir paketi
    `packing.manage` OLMADAN çözebilir ve bunu kıran hiçbir şey olmazdı.

    Zorunlu hâle getirmek, atlamayı **görünür** kılar: atlamak isteyen çağıran
    `izin_dogrula=izin_zaten_dogrulandi` yazmak zorundadır ve o ad okunduğu an
    "burada yetki kontrolü yok" der.
    """
    import inspect

    from services import packing_service

    imza = inspect.signature(packing_service.void)
    p = imza.parameters.get("izin_dogrula")
    assert p is not None, "izin_dogrula parametresi kaldırılmış"
    assert p.kind is inspect.Parameter.KEYWORD_ONLY
    assert p.default is inspect.Parameter.empty, (
        "izin_dogrula varsayılan değer taşıyor — atlanması sessizleşir "
        "(fail-open); zorunlu kalmalı"
    )


def test_DENEME_TAVANI_KURALI_AYNI():
    """`packing_service._deneme_hakki_var` ↔ `delivery_service._within_attempt_cap`.

    İkisi aynı üç-deneme kuralını yazar ve **kopya olmaları zorunludur**:
    sözleşme §3.7 `packing_service`in `delivery_service`i import etmesini
    yasaklar (döngü sınırı). Kopya olduğu için ayrışabilirler — bu test
    ayrışmayı yakalar: aynı ayar altında ürettikleri SQL metni birebir aynı
    olmalı.
    """
    from services import delivery_service, packing_service

    a = str(packing_service._deneme_hakki_var())
    b = str(delivery_service._within_attempt_cap())
    assert a == b, f"deneme tavanı kuralı ayrışmış:\n  packing : {a}\n  delivery: {b}"


def test_add_stops_KILIT_SIRASI_kanonik():
    """`add_stops` kanonik sırada kilitler: Order → OrderPackage (→ DeliveryStop).

    Commit 5 denetiminin P1 bulgusu: bu fonksiyon **hiçbir satır kilidi
    almıyordu** — siparişi ve paketi kilitsiz okuyup karar veriyor, sonra
    durağı yazıyordu. `packing_service.void` ile yarışta çözülmüş paketli bir
    `PENDING` durak doğuruyor ve hem turu hem siparişi kilitliyordu.

    ⚠️ Bu **düşük güçlü** bir yapısal testtir (kök `CLAUDE.md` §C) ve bilinçli
    olarak öyle bırakılmıştır: kilidin yokluğunu kanıtlayacak davranış testi,
    iki transaction'ın araya girmesini zamanlamayla zorlamak zorunda kalırdı ve
    kırılgan olurdu. Davranış tarafında ölçülen şey **sonuç invariant'ıdır**
    (`test_f30_packing_race_pg.py::test_ES_ZAMANLI_void_ile_add_stops_BAYAT_DURAK_BIRAKMAZ`:
    paket VOID ise bekleyen durak KALMAZ). İkisi birlikte hem yapıyı hem
    sonucu korur.
    """
    from tests.acceptance.lock_contract import canonical_violations, observed_lock_models

    dugum = _dugum(_agac("services/delivery_service.py"), "add_stops")
    assert dugum is not None
    modeller = [m for m, _ln in observed_lock_models(dugum)]
    assert "Order" in modeller, "add_stops siparişi FOR UPDATE ile almıyor"
    assert "OrderPackage" in modeller, "add_stops paketi kilitsiz okuyor"
    assert not canonical_violations(dugum)
