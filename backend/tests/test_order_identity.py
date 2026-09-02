"""Müşteri-yüzü sipariş kimliği: numara üretimi + teslimat (fulfillment) durumu.

İkisi de saf — DB'siz. Sipariş numarası müşterinin faturada/destekte kullandığı
KALICI referanstır; `tracking_no` (ELDEN-R{run}-S{stop}) her başarısız denemede
değiştiği için onun yerine geçemez.
"""
import re

from core.order_no import ORDER_NO_RE, generate_order_no
from services.order_identity import fulfillment_state


# ── generate_order_no ─────────────────────────────────────────────────────────────


def test_bicim_dort_dortlu_gruplar():
    for _ in range(50):
        assert re.fullmatch(r"\d{4}-\d{4}-\d{4}", generate_order_no())


def test_kendi_desenine_uyar():
    assert ORDER_NO_RE.fullmatch(generate_order_no())


def test_ardisik_degil_sayi_sizdirmaz():
    # Sıralı numara "kaç sipariş aldılar" sorusunu dışarıya cevaplar. 200 üretimde
    # tekrar da olmamalı (çakışma tavanı DB'nin unique index'i, ama entropi burada).
    uretilen = [generate_order_no() for _ in range(200)]
    assert len(set(uretilen)) == 200
    sayilar = [int(n.replace("-", "")) for n in uretilen]
    assert sayilar != sorted(sayilar)


# ── fulfillment_state ─────────────────────────────────────────────────────────────


def test_hicbir_kalem_teslim_edilmedi():
    assert fulfillment_state({1: 2, 2: 1}, {}) == "NONE"
    assert fulfillment_state({1: 2}, {1: 0}) == "NONE"


def test_tum_kalemler_tam_teslim():
    assert fulfillment_state({1: 2, 2: 1}, {1: 2, 2: 1}) == "ALL"


def test_kismi_teslim_kalem_eksik():
    # 2. kalem hiç gelmedi — ikinci teslimat bekliyor.
    assert fulfillment_state({1: 2, 2: 1}, {1: 2}) == "PARTIAL"


def test_kismi_teslim_ayni_kalemin_adedi_eksik():
    # Aynı kalemin 3 adedinden 1'i geldi (bölünmüş teslimat).
    assert fulfillment_state({1: 3}, {1: 1}) == "PARTIAL"


def test_fiziksel_kalem_yoksa_dijital_siparis_ALL_degildir():
    # Kalem yoksa teslim edilecek bir şey de yoktur; "hepsi teslim" demek yanıltır.
    assert fulfillment_state({}, {}) == "NONE"


def test_fazla_teslim_ALL_sayilir_ama_patlamaz():
    # Veri bozuksa (teslim > sipariş) ekran çökmemeli; tavan ALL'dur.
    assert fulfillment_state({1: 1}, {1: 5}) == "ALL"
