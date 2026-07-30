"""F29 saf kurallar — olay etkisi tablosu ve sayım FSM'i (DB'siz).

Bu dosya **yalnız saf mantığı** ölçer; iş davranışı (gerçek stok, gerçek
sipariş, gerçek yetki) `tests/integration/test_inventory_*_pg.py` altındadır.
Repo standardı (§B) saf testin tek başına kanıt sayılmayacağını söylüyor:
buradaki her kural, PG tarafında bir davranış testiyle eşleştirilmiştir ve
eşleşme `test_olay_tablosu_davranis_testleriyle_eslesir` ile denetlenir.

**Neden saf bir katman var:** olay → fiziksel etki eşlemesi F29'un en kolay
sessizce bozulan yeridir. `RETURN`'ün "otomatik uzlaştırılabilir" sayılması
tek satırlık bir değişiklik olur, hiçbir şey patlamaz ve sayım, fiziksel
kabulü yapılmamış iadeyi varmış gibi kabul eder. Tablo veri olarak dururken
bu değişiklik BURADA görünür.

Paketin ilk test commit'i olduğu için implementasyon yok: koşum KIRMIZIDIR.
"""
from __future__ import annotations

import pytest

from tests.inventory_api import kurallar, uye

RULES = "services.inventory_rules"


# ── Olay etkisi tablosu ────────────────────────────────────────────────────

#: (olay, saleable, damaged, reserved, on_premise, otomatik_uzlastirilabilir)
#: İşaretler: -1 azalır · +1 artar · 0 değişmez · None belirsiz.
#: Kaynak: docs/f29-sayim-hasarli-stok-plani.md §3.
BEKLENEN_ETKI = [
    ("INITIAL",             +1,  0,  0, +1, True),
    ("SALE",                -1,  0, +1,  0, True),
    ("SALE_CANCEL",         +1,  0, -1,  0, True),
    ("SALE_CANCEL_SHIPPED", +1,  0,  0, None, False),
    ("RETURN",              +1,  0,  0, None, False),
    ("ADMIN_ADJUSTMENT",  None,  0,  0, None, False),
    ("COUNT_ADJUSTMENT",  None, None, 0,  0, True),
    ("DAMAGE_TRANSFER",     -1, +1,  0,  0, True),
    ("DAMAGE_RECOVERY",     +1, -1,  0,  0, True),
    ("DAMAGE_DISPOSAL",      0, -1,  0, -1, True),
    ("SUPPLIER_RETURN",   None,  None, 0, -1, True),
    ("ORDER_PREPARED",       0,  0,  0,  0, True),
    ("ORDER_SHIPPED",        0,  0, -1, -1, True),
    ("ORDER_DELIVERED",      0,  0,  0,  0, True),
    ("DELIVERY_FAILED",      0,  0, +1, +1, True),
    ("STOP_REMOVED",         0,  0, +1, +1, True),
    ("RETURN_RECEIVED",      0,  0,  0, None, False),
    ("MANUAL_DB_CHANGE",  None, None, None, None, False),
]


def test_olay_tablosu_TAM_ve_fazlasi_yok():
    """Tablo tam olarak planlanan olay kümesini içerir.

    Eksik olay = sessiz boşluk (bilinmeyen olay uzlaştırmaya sokulur).
    Fazla olay = plan dışı davranış. İkisi de burada görünür.
    """
    tablo = uye(RULES, "PHYSICAL_EFFECT")
    assert set(tablo) == {ad for ad, *_ in BEKLENEN_ETKI}


@pytest.mark.parametrize(
    "olay,saleable,damaged,reserved,on_premise,otomatik",
    BEKLENEN_ETKI,
    ids=[e[0] for e in BEKLENEN_ETKI],
)
def test_olayin_dort_eksendeki_etkisi(
    olay, saleable, damaged, reserved, on_premise, otomatik
):
    tablo = uye(RULES, "PHYSICAL_EFFECT")
    etki = tablo[olay]
    assert etki.saleable == saleable, f"{olay}: saleable"
    assert etki.damaged == damaged, f"{olay}: damaged"
    assert etki.reserved == reserved, f"{olay}: reserved"
    assert etki.on_premise == on_premise, f"{olay}: on_premise"
    assert etki.auto_reconcilable is otomatik, f"{olay}: otomatik uzlaştırma"


def test_ON_PREMISE_etkisi_belirsiz_olan_olay_ASLA_otomatik_uzlastirilamaz():
    """Değişmez: fiziksel etkisi bilinmeyen olay otomatik düzeltmeye giremez.

    Tablo elle yazıldığı için bir satırda `on_premise=None` ve
    `auto_reconcilable=True` birlikte yazılabilir; o kombinasyon "bilmiyorum
    ama yine de düzelteyim" demektir ve F29'un temel kuralını çiğner.
    """
    tablo = uye(RULES, "PHYSICAL_EFFECT")
    ihlal = [
        ad for ad, e in tablo.items()
        if e.on_premise is None and e.auto_reconcilable
    ]
    assert not ihlal, f"belirsiz ama otomatik işaretli olaylar: {ihlal}"


def test_SALE_fiziksel_mevcudu_DEGISTIRMEZ():
    """rev. 1'in hatası tam olarak buradaydı; ayrı ve adıyla sabitlendi."""
    tablo = uye(RULES, "PHYSICAL_EFFECT")
    assert tablo["SALE"].on_premise == 0
    assert tablo["SALE"].saleable == -1
    assert tablo["SALE"].reserved == +1


def test_RETURN_otomatik_uzlastirmaya_GIRMEZ():
    """İade stoğu fiziksel kabulden önce yazılıyor (order_service.py:1717)."""
    assert uye(RULES, "PHYSICAL_EFFECT")["RETURN"].auto_reconcilable is False


def test_ORDER_SHIPPED_fiziksel_cikistir():
    tablo = uye(RULES, "PHYSICAL_EFFECT")
    assert tablo["ORDER_SHIPPED"].on_premise == -1
    assert tablo["ORDER_SHIPPED"].reserved == -1


def test_is_auto_reconcilable_bilinmeyen_olayda_FAIL_SAFE():
    """Tabloda olmayan olay → False. Varsayılan 'evet' olsaydı, ileride
    eklenen her yeni hareket türü sessizce uzlaştırmaya girerdi."""
    f = uye(RULES, "is_auto_reconcilable")
    assert f("BOYLE_BIR_OLAY_YOK") is False
    assert f("SALE") is True


# ── Sayım oturumu FSM'i ────────────────────────────────────────────────────

IZINLI = {
    ("DRAFT", "IN_PROGRESS"),
    ("IN_PROGRESS", "REVIEW"),
    ("REVIEW", "IN_PROGRESS"),
    ("REVIEW", "APPLIED"),
    ("DRAFT", "CANCELLED"),
    ("IN_PROGRESS", "CANCELLED"),
    ("REVIEW", "CANCELLED"),
}
DURUMLAR = ["DRAFT", "IN_PROGRESS", "REVIEW", "APPLIED", "CANCELLED"]


def test_gecis_matrisi_TAM():
    """Tüm 5×5 kombinasyon tek tek denetlenir — 'izinliler geçiyor' demek
    yetmez; asıl risk izinsiz bir geçişin sessizce açık kalmasıdır."""
    can = uye(RULES, "can_transition")
    for a in DURUMLAR:
        for b in DURUMLAR:
            beklenen = (a, b) in IZINLI
            assert can(a, b) is beklenen, f"{a} → {b} beklenen={beklenen}"


@pytest.mark.parametrize("terminal", ["APPLIED", "CANCELLED"])
def test_terminal_durumdan_cikis_yok(terminal):
    can = uye(RULES, "can_transition")
    assert not any(can(terminal, b) for b in DURUMLAR)


def test_APPLIED_dogrudan_IN_PROGRESSa_donemez():
    """Uygulanmış sayım 'düzeltilemez'; yeni oturum açılır."""
    assert uye(RULES, "can_transition")("APPLIED", "IN_PROGRESS") is False


# ── Fark aritmetiği ────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "counted,expected,reserved,fark",
    [
        (10, 10, 0, 0),      # temiz
        (8, 10, 0, -2),      # eksik
        (12, 10, 0, +2),     # fazla
        (10, 8, 2, 0),       # 2 rezerve rafta: 8 satılabilir + 2 rezerve = 10
        (8, 8, 2, -2),       # rezerve sayılmamış → 2 eksik
        (0, 0, 0, 0),
    ],
)
def test_line_difference_rezerveyi_hesaba_katar(counted, expected, reserved, fark):
    f = uye(RULES, "line_difference")
    assert f(counted=counted, expected=expected, reserved=reserved) == fark


def test_line_difference_DAMAGED_kovasinda_rezerve_KULLANMAZ():
    """Rezerve yalnız satılabilir kovada anlamlıdır; hasarlı ürün siparişe
    ayrılamaz. Aynı fonksiyona rezerve geçilirse hasarlı fark bozulurdu."""
    f = uye(RULES, "line_difference")
    assert f(counted=3, expected=3, reserved=0) == 0


# ── Kapsam sözleşmesi ──────────────────────────────────────────────────────

def test_saf_kural_modulu_PARASAL_kavram_TASIMAZ():
    """Direktif: F29 parasal değerleme yapmaz. Saf katmanda tutar/maliyet
    kavramı belirirse, değerleme sessizce sızmış demektir."""
    m = kurallar()
    yasak = ("price", "cost", "amount", "value", "currency", "tutar", "maliyet")
    sizinti = [
        ad for ad in dir(m)
        if not ad.startswith("_") and any(k in ad.lower() for k in yasak)
    ]
    assert not sizinti, f"parasal kavram sızıntısı: {sizinti}"
