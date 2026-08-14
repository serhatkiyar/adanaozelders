"""Eski SM-2 kelime kartı sistemi KALDIRILDI — yokluk sözleşmesi (R1 · R2 · R4).

Bu dosya, `/ogren/kelime-kartlari` yüzeyini besleyen SM-2 paketinin
(`models/flashcard.py`, `schemas/flashcard.py`, `services/flashcard_service.py`,
`api/routers/flashcards.py` + `/flashcards` uçları) kaldırıldığını ölçer.
Yerine geçen sistem FSRS-5 tabanlı `srs_*` paketidir
(`docs/ip16-aralikli-tekrar-sozlesme.md`); o pakete BU DOSYA HİÇ DOKUNMAZ.

## Neden "yokluk sözleşmesi" ve neden bu dosya kırmızı doğdu

Bir şeyin kaldırıldığını iddia eden test, o şey **hiç var olmamış olsa da**
geçer. Yani böyle bir testin yeşil olması tek başına hiçbir şey kanıtlamaz —
kanıt, testin kaldırmadan ÖNCE gerçekten kırmızı düştüğünün görülmesidir
(kök CLAUDE.md §E: "eski bozuk kod da aynı testi geçer miydi?"). Bu dosya
bilerek üretim kodundan önce, ayrı bir commit'te yazıldı ve altı düğümün
tamamının kırmızı düştüğü koşularak kaydedildi; çıktı o commit'in mesajındadır.

Kaldırma tamamlandıktan sonra dosyanın işlevi değişir: artık kaldırmanın
kanıtı değil, **geri sızmanın nöbetçisidir** — biri SM-2 modülünü, uçlarını ya
da tablolarını geri getirirse burası kırmızı döner.

## Sınıflandırma (kök CLAUDE.md §H)

- R1: gerçek HTTP (httpx + ASGITransport, gerçek FastAPI uygulaması, gerçek
  bağımlılık çözümü). Kaynak taraması DEĞİLDİR.
- R2: gerçek route tablosu — **OpenAPI şeması** üzerinden (`app.routes`
  KULLANILAMAZ, gerekçesi düğümün kendi docstring'inde ve [[TB-46]]'te).
- R4: gerçek `import` denemesi (`importlib`). AST/metin taraması DEĞİLDİR —
  "dosyada şu satır yok" değil, "bu modül yüklenemiyor" ölçülür.

R3 (tabloların gerçekten düştüğü) taze tek kullanımlık PostgreSQL ister;
`tests/integration/test_flashcards_migration_pg.py` içindedir.
"""
from __future__ import annotations

import importlib

import httpx
import pytest

#: Kaldırılan router'ın TAMAMI (10 uç, `api/routers/flashcards.py`).
#:
#: DİKKAT — bu listenin doğruluğunu ölçen bir nöbetçi YOKTUR. Liste eksik
#: kalırsa R1 sessizce daha az uç dener ve yine yeşil döner. `test_R2_*`
#: sayıyı çapalamaz; o düğüm OpenAPI şemasında `flashcard` yolu ARAMAZ
#: olduğunu ölçer — yani eksik girdiyi değil, geri gelen yolu yakalar.
#: (Bağımsız denetim bulgusu F7, 14 Ağu 2026: yorumun ilk hâli var olmayan
#: bir korumayı tarif ediyordu ve dosyayı okuyanın güvenini yanlış
#: kalibre ediyordu.)
KALDIRILAN_UCLAR = [
    ("GET", "/api/v1/flashcards/decks"),
    ("POST", "/api/v1/flashcards/decks"),
    ("PATCH", "/api/v1/flashcards/decks/1"),
    ("DELETE", "/api/v1/flashcards/decks/1"),
    ("GET", "/api/v1/flashcards/decks/1/cards"),
    ("POST", "/api/v1/flashcards/decks/1/cards"),
    ("PATCH", "/api/v1/flashcards/cards/1"),
    ("DELETE", "/api/v1/flashcards/cards/1"),
    ("GET", "/api/v1/flashcards/decks/1/study"),
    ("POST", "/api/v1/flashcards/cards/1/review"),
]

#: Kaldırılan Python modülleri. `models/__init__.py` ve `api/router.py`
#: bağlantıları da koparılmalıdır; onları `test_R4_KAYIT_NOKTALARI_*` ölçer.
KALDIRILAN_MODULLER = [
    "models.flashcard",
    "schemas.flashcard",
    "services.flashcard_service",
    "api.routers.flashcards",
]

FLASHCARD_ONEKI = "/api/v1/flashcards"


@pytest.fixture
async def http():
    """Gerçek FastAPI uygulaması — dependency override YOK (İP-1a/İP-16 deseni)."""
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# ── R1: uçlar gerçekten YOK (404), yalnızca yetkisiz DEĞİL (401) ────────────


@pytest.mark.parametrize("method,yol", KALDIRILAN_UCLAR)
async def test_R1_UCLAR_404_DONER(http, method, yol):
    """Kaldırılan uç, kimliksiz istekte **404** dönmeli.

    404 ile 401 ayrımı bu düğümün bütün anlamıdır ve tesadüf değildir:

    * **401** = yol HÂLÂ VAR, yalnız kimlik doğrulaması reddetti. Router
      `api/router.py`'de duruyor, `get_current_active_user` çalışıyor demektir.
      Yani sistem kaldırılmamış, sadece kilitli.
    * **404** = FastAPI yönlendirme tablosunda böyle bir yol yok.

    Bu yüzden assert "404" demekle yetinmez; 401 gelirse hatayı ADIYLA söyler.
    Aksi halde ileride biri router'ı bırakıp yalnız izin kapatsa, gevşek bir
    "4xx bekliyorum" testi yeşil kalır ve kaldırma yapılmamış olduğu hâlde
    yapılmış görünürdü.
    """
    yanit = await http.request(method, yol)

    assert yanit.status_code != 401, (
        f"{method} {yol} → 401: uç HÂLÂ KAYITLI, yalnız kimlik doğrulaması "
        "reddediyor. Kaldırma değil, kilitleme yapılmış."
    )
    assert yanit.status_code == 404, (
        f"{method} {yol} → {yanit.status_code} (404 bekleniyordu). "
        "Uç yönlendirme tablosundan düşmemiş."
    )


# ── R2: yönlendirme tablosunda ve OpenAPI'de iz yok ─────────────────────────


def test_R2_ROUTE_TABLOSUNDA_FLASHCARD_YOLU_YOK():
    """Uygulamanın route tablosunda `/api/v1/flashcards*` hiçbir yol kalmamalı.

    R1 tek tek uçları dener; bu düğüm **tersini** ölçer: `KALDIRILAN_UCLAR`
    elle yazılmış bir listedir, orada saymadığımız bir uç geride kalsa R1 onu
    göremezdi. Burada tablonun tamamı taranır.

    ## Route tablosu neden OpenAPI'den okunuyor

    `app.routes` (ve `api_router.routes`) **KULLANILAMAZ**: FastAPI
    `include_router`'da tembel bir `_IncludedRouter` bırakır, alt-router
    yolları ancak istek çözümlenirken düzleşir. O listede `flashcard` araması
    **hiçbir uygulamada** eşleşme vermez — yani `app.routes` ile yazılmış bir
    yokluk testi kaldırma yapılmadan da yeşil döner.

    Bu bir varsayım değil, bu dosyada ölçülmüş bir hatadır: düğümün ilk hâli
    `app.routes` üzerindeydi ve kırmızı fazın ilk koşusunda 16 kırmızının
    yanında **tek yeşil** olarak sırıttı. Aynı tuzak bu depoda zaten üç yerde
    belgeli (`tests/integration/test_ip16_privacy_pg.py` D-6c/D-7,
    `tests/acceptance/test_f30_packing_contract.py::_router_yollari`,
    `tests/integration/test_ip3_operator_active_gate_pg.py`); dördüncü kez
    aynı yere düşüldü. Kırmızı çıktısı görülmeseydi fark edilmezdi.

    Etiket (`tags=["flashcards"]`) ayrıca aranır: yollar silinse bile etiket
    başka bir uçta geride kalabilir.
    """
    from main import app

    sema = app.openapi()
    yollar_tablosu = sema.get("paths", {})

    # Yalancı yeşil nöbetçisi: boş/eksik şema, aşağıdaki iki assert'i de
    # kendiliğinden geçirirdi (`ENVIRONMENT=production` şemayı kapatır).
    # Ölçümün anlamlı olması için tablonun DOLU olduğu önce kanıtlanır.
    komsu_yollar = [y for y in yollar_tablosu if y.startswith("/api/v1/srs")]
    assert komsu_yollar, (
        "OpenAPI şeması boş ya da router'lar kayıtlı değil — bu hâlde "
        "'flashcard yolu yok' ölçümü hiçbir şey kanıtlamaz"
    )

    yollar = sorted(y for y in yollar_tablosu if y.startswith(FLASHCARD_ONEKI))
    assert yollar == [], (
        f"{len(yollar)} flashcard yolu route tablosunda duruyor:\n  "
        + "\n  ".join(yollar)
    )

    etiketler = {
        etiket
        for yol in yollar_tablosu.values()
        for islem in yol.values()
        if isinstance(islem, dict)
        for etiket in islem.get("tags", [])
    }
    assert "flashcards" not in etiketler, (
        "OpenAPI'de `flashcards` etiketi duruyor — bir uç geride kalmış"
    )


# ── R4: modüller gerçekten yüklenemiyor ─────────────────────────────────────


@pytest.mark.parametrize("modul", KALDIRILAN_MODULLER)
def test_R4_MODULLER_YUKLENEMEZ(modul):
    """Modül `import` edilmeye çalışıldığında `ModuleNotFoundError` vermeli.

    Metin/AST taraması yerine gerçek import denenir (kök CLAUDE.md §C: kaynak
    sözleşmesi düşük güçlüdür). Dosya diskte dursa ama içi boşaltılsa metin
    taraması yeşil verirdi; import denemesi vermez.
    """
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(modul)


def test_R4_MODEL_KAYIT_NOKTASI_TEMIZ():
    """`models.__all__` üzerinde flashcard kaydı kalmamalı.

    Modül dosyasını silmek yetmez: `models/__init__.py`'deki import ve
    `__all__` girdisi geride kalırsa uygulama zaten açılmaz — ama daha
    sinsi hâli, model dosyası durup Alembic autogenerate'in tabloyu geri
    eklemek istemesidir (R3'teki `alembic check` o yüzden var).

    Ölçüm **çalışan nesne üzerinden** yapılır (kaynak metni değil): paketin
    gerçekten dışa verdiği adlar okunur.

    `api/router.py` tarafının karşılığı burada DEĞİL, R2'dedir: `include_router`
    tembel bir `_IncludedRouter` bıraktığı için `api_router.routes` üzerinden
    yapılan bir arama her zaman boş döner ve nöbet tutmaz.
    """
    import models

    kalan_isimler = [ad for ad in models.__all__ if "flashcard" in ad.lower()]
    assert kalan_isimler == [], (
        f"models.__all__ içinde flashcard kaydı duruyor: {kalan_isimler}"
    )
    assert not hasattr(models, "Flashcard") and not hasattr(models, "FlashcardDeck"), (
        "models paketi Flashcard/FlashcardDeck adlarını hâlâ dışa veriyor"
    )
