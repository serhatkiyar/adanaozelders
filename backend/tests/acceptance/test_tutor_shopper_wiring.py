"""Eğitmen alıcı kablolaması — AST envanteri (docs/egitmen-alici-sozlesme.md).

## Bu testin varlık sebebi

Eğitmenin mağazada alıcı olabilmesi tek bir bağımlılık değişimine dayanıyor:
alıcı uçları `require_roles(RoleType.CLIENT)` yerine `get_shopping_client`
kullanır. Bu, gözle görülmesi kolay ama **sessizce geri alınması da kolay** bir
değişiklik: kopyala-yapıştırla eklenen yeni bir sipariş ucu eski kalıbı
getirirse eğitmen o uçta 403 alır ve kimse fark etmez.

Aynı sessizlik ters yönde de mümkün: `get_shopping_client` kapsam DIŞINDAKİ bir
uca (ders rezervasyonu, kütüphane, talep) yapıştırılırsa sözleşme §2 delinir ve
"eğitmen eğitmenden ders alır" hâli, hiçbir testi kırmadan üretime çıkar.

HTTP seviyesinde ölçmek burada zayıf olurdu: her uç kimlik + telefon + sahiplik
istiyor, kurulum kapının kendisinden kırılgan olur. Bunun yerine kaynak kodun
yapısı doğrulanır — `test_payment_gate_wiring.py` ile aynı yaklaşım.

Kapsanan her uç AYRI bir pytest node'udur: "30 uçtan biri geri döndü" hâli tek
bir toplu assert'in içinde kaybolmasın.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[2]

#: Alıcı yüzeyi: bu dosyalardaki `Client` alan uçlar gölge bağımlılığını
#: kullanmak ZORUNDADIR.
ALICI_DOSYALARI = ("api/routers/store.py", "api/routers/addresses.py")

#: Kapsam DIŞI: bu dosyalar CLIENT'a özel kalır (sözleşme §2). Gölge
#: bağımlılığı buralara sızarsa test kırılır.
KAPSAM_DISI_DOSYALARI = (
    "api/routers/bookings.py",
    "api/routers/payments.py",
    "api/routers/demands.py",
    "api/routers/library_exams.py",
    "api/routers/study_reservations.py",
    "api/routers/libraries.py",
    "api/routers/exams.py",
)

#: Favori yüzeyi — 6 Eyl 2026'da kapsam DIŞINDAN kapsam İÇİNE taşındı (ÜK-6 ·
#: docs/urun-kararlari.md). `bookmarks.py` bu listeye geldi, `library_bookmarks.py`
#: ise HİÇBİR listede yoktu: kapsam envanteri onu görmüyordu, yani kütüphane
#: favorisi sessizce değiştirilebilirdi. İkisi de artık çıpalı.
#:
#: Gerekçe: §2'nin kapsam dışı bırakma sebebi "çözülmemiş ürün soruları ve
#: görülmemiş taraflar"dı. Favori taraf ilişkisi kurmaz, para yolu yoktur,
#: mesajlaşma açmaz — o sebep favoriye uymuyor. Ders rezervasyonu, talep,
#: koltuk ve bilet yüzeyleri kapsam DIŞINDA kaldı.
FAVORI_DOSYALARI = (
    "api/routers/bookmarks.py",
    "api/routers/library_bookmarks.py",
)

ALICI_BAGIMLILIGI = "get_shopping_client"


def _tree(rel: str) -> ast.Module:
    return ast.parse((BACKEND / rel).read_text(encoding="utf-8"))


def _rota_fonksiyonlari(rel: str) -> list[ast.AsyncFunctionDef | ast.FunctionDef]:
    """`@router.<method>(...)` ile süslenmiş fonksiyonlar."""
    out = []
    for node in _tree(rel).body:
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        for dec in node.decorator_list:
            hedef = dec.func if isinstance(dec, ast.Call) else dec
            if (
                isinstance(hedef, ast.Attribute)
                and isinstance(hedef.value, ast.Name)
                and hedef.value.id == "router"
            ):
                out.append(node)
                break
    return out


def _client_bagimliligi(fn) -> str | None:
    """`x: Client = Depends(<ŞU>)` içindeki çağrılan adı döner.

    `Depends(require_roles(RoleType.CLIENT))` → "require_roles"
    `Depends(get_shopping_client)`            → "get_shopping_client"
    """
    args = fn.args
    for arg, default in zip(
        args.args[len(args.args) - len(args.defaults) :], args.defaults, strict=True
    ):
        ad = getattr(arg.annotation, "id", None)
        if ad != "Client":
            continue
        if not (
            isinstance(default, ast.Call)
            and getattr(default.func, "id", None) == "Depends"
        ):
            return "<Depends değil>"
        inner = default.args[0] if default.args else None
        if isinstance(inner, ast.Name):
            return inner.id
        if isinstance(inner, ast.Call):
            return getattr(inner.func, "id", "<bilinmeyen>")
        return "<bilinmeyen>"
    return None


def _alici_uclari() -> list[tuple[str, str]]:
    out = []
    for rel in ALICI_DOSYALARI:
        for fn in _rota_fonksiyonlari(rel):
            if _client_bagimliligi(fn) is not None:
                out.append((rel, fn.name))
    return out


ALICI_UCLARI = _alici_uclari()


def test_alici_yuzeyi_bos_degil():
    """Envanterin kendisi çürümesin: uç bulunamazsa test sessizce yeşile dönerdi."""
    assert len(ALICI_UCLARI) >= 30, (
        f"alıcı uç envanteri {len(ALICI_UCLARI)} uçta kaldı — dosya yolları "
        "değişmiş ya da AST çözümlemesi bozulmuş olabilir"
    )


@pytest.mark.parametrize("rel,fn_adi", ALICI_UCLARI, ids=lambda v: str(v))
def test_alici_ucu_golge_bagimliligini_kullanir(rel: str, fn_adi: str):
    """K-19: mağaza + adres alıcı uçlarında `require_roles(CLIENT)` kalmaz."""
    fn = next(f for f in _rota_fonksiyonlari(rel) if f.name == fn_adi)
    bagimlilik = _client_bagimliligi(fn)
    assert bagimlilik == ALICI_BAGIMLILIGI, (
        f"{rel}::{fn_adi} `Client`'ı {bagimlilik} ile alıyor — eğitmen bu uçta "
        f"403 alır. Alıcı yüzeyinde tek geçerli bağımlılık {ALICI_BAGIMLILIGI}."
    )


@pytest.mark.parametrize("rel", FAVORI_DOSYALARI)
def test_favori_uclari_golge_bagimliligini_kullanir(rel: str):
    """ÜK-6: eğitmen de favorileyebilir — favori uçlarında rol kapısı KALMAZ."""
    fonksiyonlar = _rota_fonksiyonlari(rel)
    # DOLULUK: AST çözümlemesi bozulursa boş liste de "hiç ihlal yok" derdi.
    assert len(fonksiyonlar) >= 3, f"{rel} içinde rota bulunamadı"
    for fn in fonksiyonlar:
        bagimlilik = _client_bagimliligi(fn)
        assert bagimlilik == ALICI_BAGIMLILIGI, (
            f"{rel}::{fn.name} `Client`'ı {bagimlilik} ile alıyor — eğitmen bu "
            "uçta 403 alır (ÜK-6)."
        )


@pytest.mark.parametrize("rel", KAPSAM_DISI_DOSYALARI)
def test_kapsam_disi_router_golge_bagimliligini_kullanmaz(rel: str):
    """Sözleşme §2: gölge yalnız MAĞAZA yüzeyindedir; ders/kütüphane/talep değil."""
    kaynak = (BACKEND / rel).read_text(encoding="utf-8")
    assert ALICI_BAGIMLILIGI not in kaynak, (
        f"{rel} alıcı bağımlılığını kullanıyor — kapsam sözleşmesi (§2) delindi. "
        "Ders rezervasyonu ve kütüphane yüzeyleri CLIENT'a özel kalmalı."
    )


def test_bildirim_yalniz_notify_uzerinden_yazilir():
    """§4.3: `Notification(...)` yeniden adreslemeyi atlayamaz.

    `notification_service.notify` gölgeye giden bildirimi eğitmene çevirir.
    Doğrudan `db.add(Notification(...))` yazan bir yol, bildirimi kimsenin
    göremediği gölge kimliğine düşürürdü.
    """
    izinli = BACKEND / "services" / "notification_service.py"
    kacaklar: list[str] = []
    for yol in list((BACKEND / "services").rglob("*.py")) + list(
        (BACKEND / "api").rglob("*.py")
    ):
        if yol == izinli:
            continue
        for node in ast.walk(ast.parse(yol.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == (
                "Notification"
            ):
                kacaklar.append(f"{yol.relative_to(BACKEND)}:{node.lineno}")
    assert not kacaklar, (
        "Notification(...) doğrudan kuruluyor: "
        + ", ".join(kacaklar)
        + " — notification_service.notify kullanılmalı (§4.3)."
    )


def test_golge_kimlik_alanlari_faturanin_istedigini_kapsar():
    """§1.5: fatura ve ödeme sağlayıcısı gölgeden gerçek ad/e-posta okur.

    Yansıtma listesinden `first_name`/`last_name`/`email` düşerse fatura
    boş ada, ödeme sağlayıcısı da yanlış alıcıya giderdi — ikisi de sessiz.
    """
    from api.deps import _SHADOW_MIRRORED_FIELDS

    for alan in ("first_name", "last_name", "email", "phone", "phone_verified_at"):
        assert alan in _SHADOW_MIRRORED_FIELDS, (
            f"'{alan}' yansıtma listesinden düşmüş — gölge eski/boş değer taşır"
        )
