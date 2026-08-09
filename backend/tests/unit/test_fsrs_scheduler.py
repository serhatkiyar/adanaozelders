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


def _gun(sonuc) -> int:
    """Bir sonraki cevaba kadar geçecek tam gün (dakika aralığından)."""
    return int(sonuc.interval_minutes // 1440)


def _kos(senaryo: list[dict]):
    """Bir referans senaryosunu motorumuzda koşturur, adım listesi döndürür.

    Adımda `elapsed_days` varsa ofset-sürümlü (tekrar `son cevap + gap`
    anında), yoksa due-sürümlü (tekrar vade anında; geçen gün = son adımın
    aralığı) — üreticiyle birebir aynı kural. Motor artık takvim görmediği
    için "an" yerine geçen GÜN taşınır; iki kural da aynı sayıyı verir.
    """
    eng = _engine()
    state = eng.SrsCardState.new()
    vadeye_kalan = 0
    cikti = []
    rating_map = {"A": 1, "H": 2, "G": 3, "E": 4}
    for adim in senaryo:
        gecen = adim.get("elapsed_days", vadeye_kalan)
        sonuc = eng.review(state, rating_map[adim["rating"]], elapsed_days=gecen)
        state = sonuc.state
        vadeye_kalan = _gun(sonuc)
        cikti.append(sonuc)
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
    sonuc = _engine().review(_yeni(), rating, elapsed_days=0)
    assert _phase_adi(sonuc.state.phase) == phase == ref["state"].upper()
    assert sonuc.state.step == step
    assert sonuc.interval_minutes == pytest.approx(dakika)
    assert sonuc.state.stability == pytest.approx(ref["stability"], rel=1e-6)
    assert sonuc.state.difficulty == pytest.approx(ref["difficulty"], rel=1e-6)


# ── F-5..F-8: öğrenmedeki kart × dört cevap (adım geçişleri) ────────────────

def test_f5_ogrenmede_again_basa_alir():
    eng = _engine()
    r1 = eng.review(_yeni(), 3, elapsed_days=0)      # adım 1'e ilerle
    s2 = eng.review(r1.state, 1, elapsed_days=_gun(r1))  # Again → adım 0
    assert _phase_adi(s2.state.phase) == "LEARNING"
    assert s2.state.step == 0
    assert s2.interval_minutes == pytest.approx(1)


def test_f6_ogrenmede_hard_adim_ilerletmez():
    eng = _engine()
    r1 = eng.review(_yeni(), 3, elapsed_days=0)      # adım 1
    s2 = eng.review(r1.state, 2, elapsed_days=_gun(r1))  # Hard → adım 1'de kal
    assert _phase_adi(s2.state.phase) == "LEARNING"
    assert s2.state.step == 1
    assert s2.interval_minutes == pytest.approx(10)


def test_f7_ogrenmede_son_adim_good_mezun_eder():
    eng = _engine()
    r1 = eng.review(_yeni(), 3, elapsed_days=0)      # adım 1 (son adım)
    s2 = eng.review(r1.state, 3, elapsed_days=_gun(r1))  # Good → REVIEW
    assert _phase_adi(s2.state.phase) == "REVIEW"
    assert s2.state.step is None
    # Altın zincir adım 2: graduate aralığı 4 gün.
    assert s2.interval_minutes == 4 * 1440


def test_f8_ogrenmede_easy_aninda_mezun_eder():
    eng = _engine()
    r1 = eng.review(_yeni(), 1, elapsed_days=0)      # Again → adım 0'da
    s2 = eng.review(r1.state, 4, elapsed_days=_gun(r1))  # Easy → REVIEW
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
    sonuc = eng.review(_yeni(), 4, elapsed_days=0)
    for _ in range(30):
        sonuc = eng.review(sonuc.state, 4, elapsed_days=_gun(sonuc))
        assert 1.0 <= sonuc.state.difficulty <= 10.0
    assert sonuc.state.difficulty == pytest.approx(1.0, abs=0.5)
    # Tavana it: Again üst üste — D 10'u aşmamalı.
    sonuc = eng.review(_yeni(), 1, elapsed_days=0)
    for _ in range(30):
        # same-day değil, lapse yolu: vadeden 2 gün sonra cevaplanıyor.
        sonuc = eng.review(sonuc.state, 1, elapsed_days=_gun(sonuc) + 2)
        assert 1.0 <= sonuc.state.difficulty <= 10.0


# ── F-11: hatırlanabilirlik referansla uyumlu ───────────────────────────────

def test_f11_hatirlanabilirlik():
    eng = _engine()
    sonuc = eng.review(_yeni(), 3, elapsed_days=0)  # S0 = 3.173
    s = sonuc.state
    # t = S iken R = desired_retention tanımı gereği 0.9'dur.
    t_gun = int(s.stability)  # tam-gün truncation
    r = eng.retrievability(s, elapsed_days=t_gun)
    factor = 0.9 ** (1 / -0.5) - 1
    beklenen = (1 + factor * t_gun / s.stability) ** -0.5
    assert r == pytest.approx(beklenen, rel=1e-9)
    # Hiç tekrar edilmemiş kartta (S yok) R tanımsızdır → 0.
    assert eng.retrievability(_yeni(), elapsed_days=0) == 0.0


# ── F-12: aralık desired retention'a göre ───────────────────────────────────

def test_f12_desired_retention_araligi_belirler():
    eng = _engine()
    r1 = eng.review(_yeni(), 3, elapsed_days=0)
    gecen = _gun(r1)
    r2 = eng.review(r1.state, 3, elapsed_days=gecen)  # REVIEW, S≈4.93
    # r=0.9'da I(S)=round(S). Ref: altın zincir adım 2 → 4 gün.
    assert _gun(r2) == 4
    # Daha düşük hedef tutma → daha uzun aralık; daha yüksek → daha kısa.
    r_dusuk = eng.review(r1.state, 3, elapsed_days=gecen, desired_retention=0.8)
    r_yuksek = eng.review(r1.state, 3, elapsed_days=gecen, desired_retention=0.97)
    assert r_dusuk.interval_minutes > r2.interval_minutes
    assert r_yuksek.interval_minutes < r2.interval_minutes


# ── F-13: maksimum aralık tavanı ────────────────────────────────────────────

def test_f13_maksimum_aralik_tavani():
    eng = _engine()
    par = _params()
    # Devasa kararlılıklı bir REVIEW kartı kur (gerçek akışla: gec_tekrar
    # senaryosunun son durumu S≈36k'ya ulaşmıyor; tavanı özel parametreyle test et).
    r1 = eng.review(_yeni(), 3, elapsed_days=0)
    r2 = eng.review(r1.state, 3, elapsed_days=_gun(r1))
    kisitli = eng.review(
        r2.state, 3, elapsed_days=_gun(r2), maximum_interval_days=3
    )
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
    _saflik_ihlalleri_yok()


#: Saf planlayıcı paketinde import'u YASAK modüller (sözleşme §2).
#:
#: `random`/`secrets` denetim bulgusu B4 ile eklendi: sözleşme "modülde
#: `datetime.now`, `random`, `sqlalchemy`, `fastapi`, `redis` import'u
#: YASAKTIR (birim test nöbetçisi vardır)" diyordu, ama nöbetçinin listesinde
#: `random` YOKTU — yani sözleşmenin iddiası kanıtsızdı. Rastgelelik burada
#: özellikle tehlikelidir: FSRS'in "fuzz" özelliği bilinçli olarak KAPALIDIR
#: (§2 determinizm), ve rastgele bir aralık sapması ne testte ne üretimde
#: gözle görünür — yalnız referans tablosu sessizce kayar.
#:
#: `time` de aynı sebeple yasaktır: `time.time()` modülün kendi saatini
#: okumasının ikinci yoludur.
YASAK_MODULLER = (
    "random",
    "secrets",
    "time",
    "sqlalchemy",
    "fastapi",
    "redis",
    "httpx",
    "requests",
)

#: Kendi saatini okuma çağrıları (`datetime.now()`, `date.today()`).
YASAK_CAGRILAR = ("now", "today", "monotonic", "perf_counter")


def _saflik_ihlalleri_yok() -> None:
    """Paketteki her modülü AST ile tarar; ihlal varsa assert eder.

    Tarama kaynak METNİ üzerinde değil AST üzerinde yapılır: bu dosyadaki
    açıklamalar "random" kelimesini geçiriyor ve metin araması kendi
    gerekçesini ihlal sanardı (kök CLAUDE.md §C — yorum/docstring yanlış
    pozitif üretmemeli).
    """
    import ast
    import pathlib as _pl

    import services.spaced_repetition as sr

    kok = _pl.Path(sr.__file__).parent
    dosyalar = sorted(kok.glob("*.py"))
    assert len(dosyalar) >= 4, f"paket boşaldı mı? {dosyalar}"
    for dosya in dosyalar:
        agac = ast.parse(dosya.read_text(encoding="utf-8"))
        for dugum in ast.walk(agac):
            if isinstance(dugum, ast.Import):
                for ad in dugum.names:
                    assert ad.name.split(".")[0] not in YASAK_MODULLER, (
                        f"{dosya.name} saf modülde {ad.name} import ediyor"
                    )
            elif isinstance(dugum, ast.ImportFrom):
                # YALNIZ kaynak modül denetlenir. `from datetime import time`
                # meşrudur — oradaki `time` saat modülü değil, `datetime.time`
                # sınıfıdır (gün başlangıcı `dayboundary` içinde onunla kurulur).
                kok_ad = (dugum.module or "").split(".")[0]
                assert kok_ad not in YASAK_MODULLER, (
                    f"{dosya.name} saf modülde {dugum.module} import ediyor"
                )
            elif isinstance(dugum, ast.Call):
                hedef = dugum.func
                ad = getattr(hedef, "attr", None) or getattr(hedef, "id", None)
                assert ad not in YASAK_CAGRILAR, (
                    f"{dosya.name} kendi saatini/rastgelesini okuyor: {ad}() — "
                    "zaman ve geçen gün parametreyle enjekte edilmeli"
                )


def test_f14b_saflik_nobetcisi_yasak_listesi_sozlesmeyle_ayni():
    """B4: sözleşme §2'nin saydığı yasakların HEPSİ nöbetçide olmalı."""
    for beklenen in ("random", "sqlalchemy", "fastapi", "redis"):
        assert beklenen in YASAK_MODULLER, f"{beklenen} nöbetçi listesinde yok"
    assert "now" in YASAK_CAGRILAR
    _saflik_ihlalleri_yok()


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
        assert _gun(bizim) == ref["interval_days"], f"{anahtar}[{i}] interval"


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
    on = eng.preview_intervals(_yeni(), elapsed_days=0)
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


# ── F-17 (H3): elapsed_days tabanı kuyruğun gün sınırıyla AYNI ──────────────


def _tr(yil, ay, gun, saat):
    """Europe/Istanbul yerel anı (UTC+3; test aralığında DST yok)."""
    return datetime.datetime(
        yil, ay, gun, saat, tzinfo=datetime.timezone(datetime.timedelta(hours=3))
    ).astimezone(UTC)


def test_f17_elapsed_gun_sinirini_izler_takvim_farkini_degil():
    """İki taban vardı: motor `(now - last_review).days`, kuyruk TR−4 saat.

    Ölçülen kanıt (düzeltmeden önce): Pazartesi 20:00'de cevaplanmış bir kart
    Salı 09:00'da tekrar cevaplandığında motor `elapsed=0` görüyordu (13 saat
    < 1 gün) ve **aynı gün 23:00'te cevaplanmış** kartla birebir aynı
    `S = 14.077712147375411` üretiyordu. Oysa kuyruk sınırına göre biri
    ertesi çalışma günü, öteki aynı gündür. Motor artık takvim aritmetiği
    yapmaz: geçen çalışma günü sayısını çağıran verir.
    """
    eng = _engine()
    from services.spaced_repetition import dayboundary

    pzt20 = _tr(2026, 8, 3, 20)
    sali09 = _tr(2026, 8, 4, 9)
    pzt23 = _tr(2026, 8, 3, 23)

    def gun_farki(sonra, once):
        return (dayboundary.study_day(sonra) - dayboundary.study_day(once)).days

    assert gun_farki(sali09, pzt20) == 1, "Salı 09:00 ertesi çalışma günüdür"
    assert gun_farki(pzt23, pzt20) == 0, "Pzt 23:00 aynı çalışma günüdür"
    # Takvim farkı ikisinde de 0 gün — eski tabanın ikisini eşitlemesinin sebebi.
    assert (sali09 - pzt20).days == 0 and (pzt23 - pzt20).days == 0

    kart = eng.SrsCardState(
        phase=eng.CardPhase.REVIEW,
        step=None,
        stability=10.0,
        difficulty=5.0,
        reps=3,
        lapses=0,
    )
    ayni_gun = eng.review(kart, 3, elapsed_days=gun_farki(pzt23, pzt20))
    ertesi_gun = eng.review(kart, 3, elapsed_days=gun_farki(sali09, pzt20))

    # Aynı çalışma günü → short-term formül; ölçülmüş altın değer korunur.
    assert ayni_gun.state.stability == pytest.approx(14.077712147375411, rel=1e-12)
    # Ertesi çalışma günü → uzun vadeli formül; artık AYRIŞMALI.
    assert ertesi_gun.state.stability != pytest.approx(
        ayni_gun.state.stability, rel=1e-9
    ), "ertesi gün aynı gün gibi puanlanıyor — iki taban hâlâ farklı"


def test_f17_motorda_takvim_aritmetigi_kalmadi():
    """Motor ne `datetime` kullanır ne de gün/timedelta hesabı yapar.

    Tarama **AST üzerinden** yapılır: docstring ve yorumlarda geçen
    "timedelta" kelimesi (bu düzeltmenin gerekçesi tam olarak orada yazılı)
    yanlış pozitif üretmemeli — kaynak metni araması bu testi ilk yazımda
    kendi açıklamasıyla kırmıştı.

    Kaynak sözleşmesi düşük güçlüdür (kök CLAUDE.md §C): tek başına yeterli
    sayılmaz, yanında F-17 davranış testi durur. İşi, tabanın sessizce motora
    geri sızmasını yakalamaktır."""
    import ast
    import pathlib as _pl

    from services.spaced_repetition import engine as _eng

    agac = ast.parse(_pl.Path(_eng.__file__).read_text(encoding="utf-8"))
    yasak_ad = {"datetime", "timedelta", "date", "timezone"}
    bulgular = []
    for dugum in ast.walk(agac):
        if isinstance(dugum, ast.Import):
            bulgular += [
                a.name for a in dugum.names if a.name.split(".")[0] in yasak_ad
            ]
        elif isinstance(dugum, ast.ImportFrom):
            if (dugum.module or "").split(".")[0] in yasak_ad:
                bulgular.append(dugum.module)
            bulgular += [a.name for a in dugum.names if a.name in yasak_ad]
        elif isinstance(dugum, ast.Name) and dugum.id in yasak_ad:
            bulgular.append(dugum.id)
        elif isinstance(dugum, ast.Attribute) and dugum.attr in ("days", "total_seconds"):
            bulgular.append(f".{dugum.attr}")
    assert not bulgular, f"engine.py'de takvim aritmetiği kaldı: {sorted(set(bulgular))}"


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
