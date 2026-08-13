"""İP-18 · D2 — tahsilatın bağlanabileceği sipariş durumları TEK KAYNAKTA.

Bu dosya veritabanı istemez; ölçtüğü şey **sözleşmenin şekli**dir, davranışı
değil. Davranış kanıtı ayrı ve önceliklidir: `tests/integration/
test_ip18_siparis_kilit_pg.py` üç giriş noktasının (callback · `pay()` ·
reconciler) da bu kurala uyduğunu gerçek PostgreSQL'de ölçer.

## Neden ayrı bir düğüm

Kusurun kökü tek bir çağrı yerinde değil, **kuralın hiç yazılmamış olmasında**.
`escrow.claim` yalnız `payment_status`'ü koşulluyor; sipariş yaşam döngüsü
(`orders.status`) hiçbir claim'in şartı değil. Üç giriş noktası aynı hatayı
bağımsız olarak taşıyor. Kural üç yere ayrı ayrı kopyalanırsa dördüncü giriş
noktası (ileride eklenecek bir uç, bir betik, bir arka plan işi) onu yeniden
kaçırır — İP-2b'nin `settle_refunded_order` ile öğrendiği ders budur.

Bu yüzden sözleşme şudur: iki küme ve iki koşul yardımcısı `order_service`'te
**bir kez** tanımlanır; claim'ler koşulu elle yazmaz, yardımcıyı çağırır.

Güç sınıfı: **yapısal sözleşme (düşük güçlü)** — kök `CLAUDE.md` §C. Tek
başına "özellik tamamlandı" kanıtı DEĞİLDİR.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from services import order_service

BOGAZ = "_siparis_para_claimi"
ORDER_SERVICE = (
    pathlib.Path(__file__).resolve().parents[1] / "services" / "order_service.py"
)


def _eksik(ad: str) -> str:
    return (
        f"`order_service.{ad}` YOK — tahsilatın hangi sipariş durumlarına "
        "bağlanabileceği kuralı hiçbir yerde tanımlı değil; üç giriş noktası "
        "(complete_checkout · pay()→_charge · reconciler) koşulu ayrı ayrı "
        "kaçırıyor (İP-18 P0)."
    )


def test_kirmizi_para_baglanabilir_durumlar_tanimli():
    """Tahsilatın bağlanabileceği yaşam döngüsü durumları tek kümede."""
    assert hasattr(order_service, "PARA_BAGLANABILIR_DURUMLAR"), _eksik(
        "PARA_BAGLANABILIR_DURUMLAR"
    )
    # `PENDING → PAID` FSM'in tek ödeme kenarı (`order_fsm`), dolayısıyla
    # tahsilat yalnız PENDING bir siparişe bağlanabilir.
    assert order_service.PARA_BAGLANABILIR_DURUMLAR == frozenset({"PENDING"})


def test_kirmizi_olu_siparis_durumlari_tanimli():
    """Ölü varlık (geç tahsilat → otomatik iade) kümesi de aynı kaynakta."""
    assert hasattr(order_service, "OLU_SIPARIS_DURUMLARI"), _eksik(
        "OLU_SIPARIS_DURUMLARI"
    )
    assert order_service.OLU_SIPARIS_DURUMLARI == frozenset({"CANCELLED", "REFUNDED"})


def test_kirmizi_iki_kume_kesismez():
    """Bir sipariş aynı anda hem canlı hem ölü sayılamaz.

    Kesişen kümeler, aynı tahsilatın hem bağlanıp hem iade edilmesine kapı
    açardı; iki claim de başarılı olur ve para iki kez hareket ederdi.
    """
    for ad in ("PARA_BAGLANABILIR_DURUMLAR", "OLU_SIPARIS_DURUMLARI"):
        if not hasattr(order_service, ad):
            pytest.fail(_eksik(ad))
    assert not (
        order_service.PARA_BAGLANABILIR_DURUMLAR
        & order_service.OLU_SIPARIS_DURUMLARI
    )


@pytest.mark.parametrize(
    "yardimci,kume_adi",
    [
        ("canli_siparis_kosulu", "PARA_BAGLANABILIR_DURUMLAR"),
        ("olu_siparis_kosulu", "OLU_SIPARIS_DURUMLARI"),
    ],
)
def test_kirmizi_kosul_yardimcisi_claim_uyumlu(yardimci: str, kume_adi: str):
    """Yardımcı, `escrow.claim(extra_where=...)`'a doğrudan verilebilir olmalı.

    Sözleşme kilit DEĞİL koşul kullanır (Faz 1 ölçümü): `complete_checkout`
    yoluna Order satır kilidi eklemek kanonik `Product → Order` sırasını
    tersine çevirir. Koşul, claim'in kendi UPDATE'ine bindiği için ek kilit
    almaz ve sırayı bozmaz.
    """
    if not hasattr(order_service, yardimci):
        pytest.fail(_eksik(yardimci + "()"))
    kosul = getattr(order_service, yardimci)()
    assert isinstance(kosul, tuple), "extra_where bir tuple olmalı"
    assert len(kosul) == 1
    sql = str(kosul[0].compile(compile_kwargs={"literal_binds": True}))
    assert "orders.status" in sql, f"koşul sipariş durumuna bakmıyor: {sql}"
    for durum in getattr(order_service, kume_adi):
        assert durum in sql, f"{durum} koşulda yok: {sql}"


# ── Yapısal nöbetçi: dördüncü giriş noktası kuralı atlayamasın ───────────────


def _paid_yazan_dogrudan_claimler() -> list[tuple[str, int]]:
    """`escrow.claim(...)` çağrılarından `payment_status='PAID'` yazanlar.

    Sınır AST ile bulunur (`find()` + sabit karakter penceresi DEĞİL) ve yalnız
    gerçek çağrı düğümlerine bakılır — yorum satırı, docstring ve dizge
    yanlış pozitif üretemez.
    """
    agac = ast.parse(ORDER_SERVICE.read_text(encoding="utf-8"))
    bulunan: list[tuple[str, int]] = []
    for fn in ast.walk(agac):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if fn.name == BOGAZ:
            continue  # boğaz noktasının kendisi muaf
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
            for kw in node.keywords:
                if kw.arg != "values" or not isinstance(kw.value, ast.Dict):
                    continue
                for k, v in zip(kw.value.keys, kw.value.values, strict=False):
                    yazilan = (
                        v.value
                        if isinstance(v, ast.Constant)
                        else getattr(v, "attr", None)
                    )
                    if (
                        isinstance(k, ast.Constant)
                        and k.value == "payment_status"
                        and yazilan in ("PAID", "PAID.value")
                    ):
                        bulunan.append((fn.name, node.lineno))
    return bulunan


def test_yesil_paid_claimi_yalniz_bogaz_noktasindan_gecer():
    """[YEŞİL NÖBETÇİ] Siparişe para BAĞLAYAN claim tek kapıdan geçmeli.

    Kusurun kökü tek bir çağrı yeri değil, kuralın hiç yazılmamış olmasıydı.
    Kural üç yere kopyalansaydı dördüncü giriş noktası (yeni bir uç, betik,
    arka plan işi) onu yeniden kaçırırdı. Bu nöbetçi tam olarak o günü
    yakalar: `payment_status='PAID'` yazan doğrudan bir `escrow.claim`
    eklenirse kırılır.

    Güç sınıfı: **yapısal (düşük güçlü)** — davranış kanıtı
    `tests/integration/test_ip18_siparis_kilit_pg.py`'dedir. Yalnız bu testin
    geçmesi kuralın uygulandığı anlamına GELMEZ; ama bu test kırılırsa kural
    kesinlikle delinmiştir.
    """
    kacaklar = _paid_yazan_dogrudan_claimler()
    assert kacaklar == [], (
        "siparişe para bağlayan claim boğaz noktasını atlıyor "
        f"(`{BOGAZ}` kullanılmalı): {kacaklar}"
    )
