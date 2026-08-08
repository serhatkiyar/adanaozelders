"""İP-16 F-matrisi — FSRS-5 saf planlayıcı birim testleri (DB'siz, IO'suz).

Referans: py-fsrs v5.1.3 (son FSRS-5 sürümü). Altın değerler
`tests/data/ip16_fsrs_ref.json` dosyasındadır ve GERÇEK py-fsrs v5.1.3
koşularak üretilmiştir (üretici: `tests/data/ip16_fsrs_ref_generator.py`);
elle hesap yok. İki çapa upstream test_basic.py ile birebir doğrulanmıştır:
`altin_zincir` interval geçmişi [0,4,14,44,125,328,0,0,7,16,34,71,142] ve
`memo_state_upstream` finali round(S)=49, round(D,4)=7.0866.

Import'lar test gövdesinde LAZY yapılır: modül henüz yokken (kırmızı faz)
her düğüm ImportError ile KIRMIZI düşer ama koleksiyon bozulmaz — komşu
paketlerin `-k ip1a/ip3/...` koşuları etkilenmez.
"""
from __future__ import annotations

import datetime
import json
import pathlib

import pytest

UTC = datetime.timezone.utc
BASE = datetime.datetime(2022, 11, 29, 12, 30, 0, 0, UTC)
REF = json.loads(
    (pathlib.Path(__file__).parent.parent / "data" / "ip16_fsrs_ref.json").read_text(
        encoding="utf-8"
    )
)


def _engine():
    from services.spaced_repetition import engine

    return engine


def _params():
    from services.spaced_repetition import params

    return params


def _yeni():
    return _engine().SrsCardState.new()


def _kos(senaryo: list[dict]):
    """Bir referans senaryosunu motorumuzda koşturur, adım listesi döndürür.

    Adımda `elapsed_days` varsa ofset-sürümlü (tekrar `now + gap` anında),
    yoksa due-sürümlü (tekrar `due` anında) — üreticiyle birebir aynı kural.
    """
    eng = _engine()
    state = eng.SrsCardState.new()
    now = BASE
    cikti = []
    rating_map = {"A": 1, "H": 2, "G": 3, "E": 4}
    for adim in senaryo:
        if "elapsed_days" in adim:
            now = now + datetime.timedelta(days=adim["elapsed_days"])
        sonuc = eng.review(state, rating_map[adim["rating"]], now)
        state = sonuc.state
        cikti.append(sonuc)
        if "elapsed_days" not in adim:
            now = state.due
    return cikti


def _phase_adi(s) -> str:
    # Enum ya da düz string — ikisini de kabul et, büyük harfe indirge.
    v = getattr(s, "value", s)
    return str(v).upper()


# ── F-1..F-4: yeni kart × dört cevap ─────────────────────────────────────────
# Beklenenler ref dosyasından (py-fsrs): S0 = w[G-1]; Learning adım makinesi:
# Again → adım 0 (1 dk) · Hard → adım 0'da kalır, (1+10)/2 = 5.5 dk ·
# Good → adım 1 (10 dk) · Easy → anında REVIEW, I(S0)=round(15.69105)=16 gün.

@pytest.mark.parametrize(
    ("anahtar", "rating", "phase", "step", "dakika"),
    [
        ("yeni_A", 1, "LEARNING", 0, 1),        # F-1
        ("yeni_H", 2, "LEARNING", 0, 5.5),      # F-2
        ("yeni_G", 3, "LEARNING", 1, 10),       # F-3
        ("yeni_E", 4, "REVIEW", None, 16 * 1440),  # F-4
    ],
)
def test_f1_f4_yeni_kart_dort_cevap(anahtar, rating, phase, step, dakika):
    ref = REF[anahtar][0]
    sonuc = _engine().review(_yeni(), rating, BASE)
    assert _phase_adi(sonuc.state.phase) == phase == ref["state"].upper()
    assert sonuc.state.step == step
    assert sonuc.interval_minutes == pytest.approx(dakika)
    assert sonuc.state.stability == pytest.approx(ref["stability"], rel=1e-6)
    assert sonuc.state.difficulty == pytest.approx(ref["difficulty"], rel=1e-6)


# ── F-5..F-8: öğrenmedeki kart × dört cevap (adım geçişleri) ────────────────

def test_f5_ogrenmede_again_basa_alir():
    eng = _engine()
    s1 = eng.review(_yeni(), 3, BASE).state          # adım 1'e ilerle
    s2 = eng.review(s1, 1, s1.due)                    # Again → adım 0
    assert _phase_adi(s2.state.phase) == "LEARNING"
    assert s2.state.step == 0
    assert s2.interval_minutes == pytest.approx(1)


def test_f6_ogrenmede_hard_adim_ilerletmez():
    eng = _engine()
    s1 = eng.review(_yeni(), 3, BASE).state          # adım 1
    s2 = eng.review(s1, 2, s1.due)                    # Hard → adım 1'de kal
    assert _phase_adi(s2.state.phase) == "LEARNING"
    assert s2.state.step == 1
    assert s2.interval_minutes == pytest.approx(10)


def test_f7_ogrenmede_son_adim_good_mezun_eder():
    eng = _engine()
    s1 = eng.review(_yeni(), 3, BASE).state          # adım 1 (son adım)
    s2 = eng.review(s1, 3, s1.due)                    # Good → REVIEW
    assert _phase_adi(s2.state.phase) == "REVIEW"
    assert s2.state.step is None
    # Altın zincir adım 2: graduate aralığı 4 gün.
    assert s2.interval_minutes == 4 * 1440


def test_f8_ogrenmede_easy_aninda_mezun_eder():
    eng = _engine()
    s1 = eng.review(_yeni(), 1, BASE).state          # Again → adım 0'da
    s2 = eng.review(s1, 4, s1.due)                    # Easy → REVIEW
    assert _phase_adi(s2.state.phase) == "REVIEW"
    assert s2.state.step is None
    assert s2.interval_minutes >= 1440               # en az 1 gün


# ── F-9: kararlılık artışı referans değerlerle uyumlu ───────────────────────

def test_f9_kararlilik_artisi_referansla_uyumlu():
    adimlar = _kos(REF["altin_zincir"])
    ref_s = [a["stability"] for a in REF["altin_zincir"]]
    bizim = [a.state.stability for a in adimlar]
    for i, (b, r) in enumerate(zip(bizim, ref_s, strict=True)):
        assert b == pytest.approx(r, rel=1e-6), f"adım {i}: {b} != {r}"
    # Ardışık Good tekrarlarında S kesin artar (2..5. adımlar REVIEW'da Good).
    assert bizim[2] > bizim[1] and bizim[4] > bizim[3]


# ── F-10: zorluk 1..10 sınırları ────────────────────────────────────────────

def test_f10_zorluk_sinirlari():
    eng = _engine()
    # Tabana it: Easy üst üste — D 1'in altına inmemeli.
    state = _yeni()
    now = BASE
    sonuc = eng.review(state, 4, now)
    for _ in range(30):
        state, now = sonuc.state, sonuc.state.due
        sonuc = eng.review(state, 4, now)
        assert 1.0 <= sonuc.state.difficulty <= 10.0
    assert sonuc.state.difficulty == pytest.approx(1.0, abs=0.5)
    # Tavana it: Again üst üste — D 10'u aşmamalı.
    state, now = _yeni(), BASE
    sonuc = eng.review(state, 1, now)
    for _ in range(30):
        state = sonuc.state
        now = state.due + datetime.timedelta(days=2)  # same-day değil, lapse yolu
        sonuc = eng.review(state, 1, now)
        assert 1.0 <= sonuc.state.difficulty <= 10.0


# ── F-11: hatırlanabilirlik referansla uyumlu ───────────────────────────────

def test_f11_hatirlanabilirlik():
    eng = _engine()
    sonuc = eng.review(_yeni(), 3, BASE)  # S0 = 3.173
    s = sonuc.state
    # t = S iken R = desired_retention tanımı gereği 0.9'dur.
    t_gun = s.stability
    # Tam-gün truncation: t=floor(gün) kullanılır; kesin nokta için tam gün seç.
    an = BASE + datetime.timedelta(days=int(t_gun))
    r = eng.retrievability(s, an)
    factor = 0.9 ** (1 / -0.5) - 1
    beklenen = (1 + factor * int(t_gun) / s.stability) ** -0.5
    assert r == pytest.approx(beklenen, rel=1e-9)
    # Tekrar edilmemiş kartta R hesabı son tekrara göre; last_review yokken 0.
    assert eng.retrievability(_yeni(), BASE) == 0.0


# ── F-12: aralık desired retention'a göre ───────────────────────────────────

def test_f12_desired_retention_araligi_belirler():
    eng = _engine()
    s1 = eng.review(_yeni(), 3, BASE).state
    s2 = eng.review(s1, 3, s1.due).state              # REVIEW, S≈4.93
    # r=0.9'da I(S)=round(S). Ref: altın zincir adım 2 → 4 gün.
    assert (s2.due - s2.last_review).days == 4
    # Daha düşük hedef tutma → daha uzun aralık; daha yüksek → daha kısa.
    r_dusuk = eng.review(s1, 3, s1.due, desired_retention=0.8)
    r_yuksek = eng.review(s1, 3, s1.due, desired_retention=0.97)
    assert r_dusuk.interval_minutes > s2_interval_minutes(s2)
    assert r_yuksek.interval_minutes < s2_interval_minutes(s2)


def s2_interval_minutes(s2) -> int:
    return int((s2.due - s2.last_review).total_seconds() // 60)


# ── F-13: maksimum aralık tavanı ────────────────────────────────────────────

def test_f13_maksimum_aralik_tavani():
    eng = _engine()
    par = _params()
    # Devasa kararlılıklı bir REVIEW kartı kur (gerçek akışla: gec_tekrar
    # senaryosunun son durumu S≈36k'ya ulaşmıyor; tavanı özel parametreyle test et).
    s1 = eng.review(_yeni(), 3, BASE).state
    s2 = eng.review(s1, 3, s1.due).state
    kisitli = eng.review(s2, 3, s2.due, maximum_interval_days=3)
    assert kisitli.interval_minutes == 3 * 1440
    # Varsayılan tavan da uygulanır: sözleşme 36500 gün.
    assert par.MAXIMUM_INTERVAL_DAYS == 36500
    cok_uzun = _kos(REF["gec_tekrar"])
    for adim in cok_uzun:
        assert adim.interval_minutes <= 36500 * 1440


# ── F-14: determinizm ───────────────────────────────────────────────────────

def test_f14_determinizm_ve_saflik():
    eng = _engine()
    a = _kos(REF["karisik"])
    b = _kos(REF["karisik"])
    assert [(x.state, x.interval_minutes) for x in a] == [
        (x.state, x.interval_minutes) for x in b
    ]
    # Saflık nöbeti: modül ağacında zaman/IO/DB import'u olamaz.
    import services.spaced_repetition as sr
    import pathlib as _pl

    kok = _pl.Path(sr.__file__).parent
    yasak = ("sqlalchemy", "fastapi", "redis", "httpx", "requests")
    for dosya in kok.glob("*.py"):
        icerik = dosya.read_text(encoding="utf-8")
        for y in yasak:
            assert f"import {y}" not in icerik and f"from {y}" not in icerik, (
                f"{dosya.name} saf modülde {y} import ediyor"
            )
        assert "datetime.now(" not in icerik.replace("datetime.datetime.now(", "X"), (
            f"{dosya.name} kendi now()'unu çağırıyor — zaman enjekte edilmeli"
        )
        assert "datetime.datetime.now(" not in icerik, (
            f"{dosya.name} kendi now()'unu çağırıyor — zaman enjekte edilmeli"
        )


# ── F-15: referans tablosu (py-fsrs v5.1.3 altın değerleri, 70 adım) ────────

@pytest.mark.parametrize("anahtar", sorted(REF.keys()))
def test_f15_referans_tablosu(anahtar):
    senaryo = REF[anahtar]
    adimlar = _kos(senaryo)
    for i, (bizim, ref) in enumerate(zip(adimlar, senaryo, strict=True)):
        assert _phase_adi(bizim.state.phase) == ref["state"].upper(), (
            f"{anahtar}[{i}] state"
        )
        assert bizim.state.step == ref["step"], f"{anahtar}[{i}] step"
        assert bizim.state.stability == pytest.approx(ref["stability"], rel=1e-6), (
            f"{anahtar}[{i}] stability"
        )
        assert bizim.state.difficulty == pytest.approx(ref["difficulty"], rel=1e-6), (
            f"{anahtar}[{i}] difficulty"
        )
        gun = (bizim.state.due - bizim.state.last_review).days
        assert gun == ref["interval_days"], f"{anahtar}[{i}] interval"


def test_f15_capa_degerler_upstream_ile_birebir():
    """Upstream test_basic.py çapaları — referans dosyası bozulursa yakalar."""
    ivl = [a["interval_days"] for a in REF["altin_zincir"]]
    assert ivl == [0, 4, 14, 44, 125, 328, 0, 0, 7, 16, 34, 71, 142]
    final = REF["memo_state_upstream"][-1]
    assert round(final["stability"]) == 49
    assert round(final["difficulty"], 4) == 7.0866
    # Ve motorumuz da aynı sonucu üretmeli:
    son = _kos(REF["memo_state_upstream"])[-1]
    assert round(son.state.stability) == 49
    assert round(son.state.difficulty, 4) == 7.0866


# ── F-16: uç durumlar ───────────────────────────────────────────────────────

def test_f16_uc_durumlar():
    eng = _engine()
    # 0 tekrar: yeni kartta önizleme çağrısı patlamaz, 4 rating de değer verir.
    on = eng.preview_intervals(_yeni(), BASE)
    assert set(on.keys()) == {1, 2, 3, 4}
    assert all(v >= 1 for v in on.values())
    # Çok uzun gecikme: 1000 gün sonra tekrar — durum bozulmaz (ref'le uyum
    # F-15'te; burada değer sağlığı).
    son = _kos(REF["gec_tekrar"])[-1].state
    assert son.stability > 0 and 1.0 <= son.difficulty <= 10.0
    # Ardışık lapse: her lapse'te lapses sayacı artar, S pozitif kalır.
    adimlar = _kos(REF["ardisik_lapse"])
    assert adimlar[-1].state.lapses == 3
    assert all(a.state.stability > 0 for a in adimlar)
    # Same-day tekrarlar short-term formülüyle: S değişir ama due bugünde kalmaz
    # (ref ayni_gun ile uyum F-15'te).
    assert len(REF["ayni_gun"]) == 5


# ── Parametre tek-kaynak sözleşmesi ─────────────────────────────────────────

def test_parametreler_tek_yerde_ve_dogru():
    par = _params()
    assert len(par.FSRS_WEIGHTS) == 19
    assert par.FSRS_WEIGHTS[0] == pytest.approx(0.40255)
    assert par.FSRS_WEIGHTS[18] == pytest.approx(0.6621)
    assert par.DESIRED_RETENTION == 0.9
    assert par.MAXIMUM_INTERVAL_DAYS == 36500
    assert tuple(par.LEARNING_STEPS_MINUTES) == (1, 10)
    assert tuple(par.RELEARNING_STEPS_MINUTES) == (10,)
    assert par.LEECH_THRESHOLD == 8
    assert par.ROLLOVER_HOUR == 4
    assert par.TIMEZONE_NAME == "Europe/Istanbul"
