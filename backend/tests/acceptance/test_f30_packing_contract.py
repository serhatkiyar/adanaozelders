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
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[2]

YENI_IZINLER = ("packing.view", "packing.pack", "packing.manage")

#: Hijyen nöbetçisinin izlemesi gereken yeni tablolar (test izolasyonu).
YENI_TABLOLAR = ("order_packages", "order_package_items", "package_scan_events")

#: F30 servis modülleri. `packing_rules` SAF olmalı (DB'ye dokunmaz).
SAF_MODUL = "services/packing_rules.py"
SERVIS_MODUL = "services/packing_service.py"


def _agac(rel: str) -> ast.Module:
    yol = BACKEND / rel
    if not yol.exists():
        pytest.fail(f"HENÜZ YAZILMADI: {rel}", pytrace=False)
    return ast.parse(yol.read_text(encoding="utf-8"))


def _metin(rel: str) -> str:
    yol = BACKEND / rel
    if not yol.exists():
        pytest.fail(f"HENÜZ YAZILMADI: {rel}", pytrace=False)
    return yol.read_text(encoding="utf-8")


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


def test_izin_migrationi_ROL_DAGITIMI_yapar():
    """Katalog + DB + ROL üçlüsünden biri eksikse izin işe yaramaz (sözleşme §7 S6).

    Migration SUPER_ADMIN ve COMMERCE_MANAGER'a üç izni de, OPERATIONS_MANAGER'a
    `packing.view` + `packing.pack`'i vermelidir (depo paketler, çözmez).
    """
    versions = BACKEND / "migrations" / "versions"
    adaylar = [
        p for p in versions.glob("*.py") if "packing." in p.read_text(encoding="utf-8")
    ]
    if not adaylar:
        pytest.fail(
            "HENÜZ YAZILMADI: packing.* izinlerini seed eden migration", pytrace=False
        )
    metin = "\n".join(p.read_text(encoding="utf-8") for p in adaylar)
    for kod in YENI_IZINLER:
        assert kod in metin, f"migration'da yok: {kod}"
    for rol in ("SUPER_ADMIN", "COMMERCE_MANAGER", "OPERATIONS_MANAGER"):
        assert rol in metin, f"rol dağıtımı eksik: {rol}"


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


def test_kanonik_kilit_sirasinda_PAKET_ORDER_ile_STOP_ARASINDA():
    """Kanonik sıra: StockCountSession → Product → Order → OrderReturn →
    **OrderPackage** → DeliveryStop.

    `mark_prepared`'ın kilitsiz deseni (G7) kopyalanmaz. Asıl koruma gerçek
    yarış testidir: `test_f30_packing_race_pg.py::test_kilit_sirasi_deadlock_uretmez`.
    """
    yol = BACKEND / "tests" / "acceptance" / "test_stock_lock_contract.py"
    metin = yol.read_text(encoding="utf-8")
    assert "OrderPackage" in metin, (
        "HENÜZ YAZILMADI: kanonik kilit sırası OrderPackage'ı içermiyor"
    )
    order_i = metin.find('"Order"')
    paket_i = metin.find('"OrderPackage"')
    stop_i = metin.find('"DeliveryStop"')
    assert -1 not in (order_i, paket_i, stop_i)
    assert order_i < paket_i < stop_i, "kilit sırasında OrderPackage yanlış yerde"


# ══════════════════ KIRMIZI: kablolama ══════════════════════════════════════


def test_paket_modelleri_KAYITLI():
    """Yeni tablo `models/__init__` üzerinden import edilmezse Alembic
    autogenerate onu görmez ve `alembic check` drift'i kaçırır."""
    metin = _metin("models/__init__.py")
    for sinif in ("OrderPackage", "OrderPackageItem", "PackageScanEvent"):
        assert sinif in metin, f"models/__init__ içinde yok: {sinif}"


def test_packing_router_KAYITLI():
    """Router `api/router.py`'ye include edilmezse uçlar 404 döner."""
    metin = _metin("api/router.py")
    assert "packing" in metin, "packing router include edilmemiş"


def test_prepare_uclari_KALDIRILDI():
    """Elle "Hazır" butonu (`/orders/{id}/prepare`, `/unprepare`) kaldırılır.

    İki kapı bırakmak "eksik kalem kabul edilmez" ilkesini boşa çıkarır
    (sözleşme §3.5). Davranış eşi:
    `test_f30_packing_http_pg.py::test_eski_prepare_ucu_ARTIK_YOK`.
    """
    metin = _metin("api/routers/delivery.py")
    assert "/orders/{order_id}/prepare" not in metin, "eski prepare ucu duruyor"
    assert "/orders/{order_id}/unprepare" not in metin, "eski unprepare ucu duruyor"


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
