"""İP-16 (aralıklı tekrar) mutasyon provası kataloğu — 20 mutasyon.

`scripts/mutation_drill` sürücüsünün güvenlik makinesini (bayt yedeği +
SHA-256 doğrulamalı geri alma, kirli ağaç reddi, HEAD/status karşılaştırması)
YENİDEN KULLANIR; yalnız katalog ve bir ek nöbetçi buraya aittir.

## Ek nöbetçi: "seçilen test sayısı 0 ise BAŞARISIZLIK"

Üst sürücü, pytest 0 test seçtiğinde (yanlış dosya adı, `-k` kayması, import
hatasıyla koleksiyonun boşalması) çıkışta FAILED satırı bulamaz ve mutasyonu
"YAKALANMADI" diye raporlar. İkisi aynı şey değildir: biri "test zayıf",
öteki "test hiç koşmadı". Bu modül mutasyondan ÖNCE `--collect-only` ile
seçilen test sayısını ölçer ve 0 ise provayı hata olarak keser — exit 0'a
güvenilmez (kök CLAUDE.md → Test Kalitesi §D).

## Kullanım

    cd backend
    python -m scripts.mutation_drill_ip16 --list
    POSTGRES_DB=adana_ip16_test PAYMENT_PROVIDER=fake \
        python -m scripts.mutation_drill_ip16 IP16-1
    POSTGRES_DB=adana_ip16_test PAYMENT_PROVIDER=fake \
        python -m scripts.mutation_drill_ip16          # hepsi
"""
from __future__ import annotations

import argparse
import contextlib
import re
import sys

from scripts.mutation_drill import (
    BACKEND,
    FRONTEND,
    KOK,
    GeciciYama,
    Mutasyon,
    _agac_durumu,
    _kirilanlar,
    _kos,
    _on_kontrol,
)

ENGINE = "backend/services/spaced_repetition/engine.py"
QUEUE = "backend/services/spaced_repetition/queuerules.py"
DAY = "backend/services/spaced_repetition/dayboundary.py"
SERVICE = "backend/services/srs_service.py"
TYPEANS = "frontend/src/lib/srsTypeAnswer.ts"

BIRIM = "tests/unit/test_fsrs_scheduler.py"
KUYRUK = "tests/integration/test_ip16_queue_pg.py"
OTURUM = "tests/integration/test_ip16_session_pg.py"
TIPLER = "tests/integration/test_ip16_types_pg.py"
GIZLILIK = "tests/integration/test_ip16_privacy_pg.py"
TARAYICI = "tests/integration/test_ip16_browser_pg.py"


MUTASYONLAR: list[Mutasyon] = [
    # ── 1-4: FSRS planlayıcısı (saf, birim testleriyle korunuyor) ───────────
    Mutasyon(
        "IP16-1", "F-9: kararlılık artışı kaldırıldı (S sabit kalıyor)",
        ENGINE,
        """    return stability * (
        1
        + math.exp(_W[8])
        * (11 - difficulty)
        * stability ** (-_W[9])
        * (math.exp((1 - retrievability) * _W[10]) - 1)
        * hard_penalty
        * easy_bonus
    )""",
        "    return stability  # MUTASYON: artış kaldırıldı",
        (BIRIM,),
    ),
    Mutasyon(
        "IP16-2", "F-10: zorluk 1..10 sınırı kaldırıldı",
        ENGINE,
        "    return _clamp(reverted, 1.0, 10.0)",
        "    return reverted  # MUTASYON: clamp kaldırıldı",
        (BIRIM,),
    ),
    Mutasyon(
        "IP16-3", "F-12: desired retention yok sayıldı (hep 0.9)",
        ENGINE,
        """    raw = (stability / params.FACTOR) * (
        desired_retention ** (1 / params.DECAY) - 1
    )""",
        """    raw = (stability / params.FACTOR) * (
        0.9 ** (1 / params.DECAY) - 1
    )  # MUTASYON: parametre yok sayıldı""",
        (BIRIM,),
    ),
    Mutasyon(
        "IP16-4", "F-13: maksimum aralık tavanı kaldırıldı",
        ENGINE,
        "    return int(_clamp(round(raw), 1, maximum_interval_days))",
        "    return int(max(round(raw), 1))  # MUTASYON: tavan yok",
        (BIRIM,),
    ),
    # ── 5-6: adım makinesi ─────────────────────────────────────────────────
    Mutasyon(
        "IP16-5", "Q-1: öğrenme adımları atlandı (ilk Good mezun ediyor)",
        ENGINE,
        "        graduates = rating == 4 or (rating == 3 and cur_step + 1 >= len(steps))",
        "        graduates = rating >= 3  # MUTASYON: adımlar atlandı",
        (BIRIM, KUYRUK),
    ),
    Mutasyon(
        "IP16-6", "Q-4: lapse'te relearning'e düşürme kaldırıldı",
        ENGINE,
        """        if rating == 1:
            lapses += 1
            new_phase = CardPhase.RELEARNING""",
        """        if rating == 1:
            lapses += 1
            new_phase = CardPhase.REVIEW  # MUTASYON: relearning yok""",
        (BIRIM, KUYRUK),
    ),
    # ── 10-12: limit kalıtımı ve gün sınırı ────────────────────────────────
    Mutasyon(
        "IP16-10", "L-3: alt deste limit kalıtımı kaldırıldı (yalnız yaprak)",
        QUEUE,
        """    new_values = []
    review_values = []
    for new_per_day, reviews_per_day in chain:
        if new_per_day is not None:
            new_values.append(new_per_day)
        if reviews_per_day is not None:
            review_values.append(reviews_per_day)""",
        """    new_values = []
    review_values = []
    _zincir = list(chain)[-1:]  # MUTASYON: yalnız seçili deste
    for new_per_day, reviews_per_day in _zincir:
        if new_per_day is not None:
            new_values.append(new_per_day)
        if reviews_per_day is not None:
            review_values.append(reviews_per_day)""",
        (KUYRUK,),
    ),
    Mutasyon(
        "IP16-11", "G-1/G-3: TZ dönüşümü UTC'ye çevrildi",
        DAY,
        "    local = now.astimezone(_TZ)",
        "    local = now  # MUTASYON: UTC'de kalındı",
        (KUYRUK,),
    ),
    Mutasyon(
        "IP16-12", "G-2: rollover ofseti (04:00) kaldırıldı",
        DAY,
        "    return (local - timedelta(hours=params.ROLLOVER_HOUR)).date()",
        "    return local.date()  # MUTASYON: rollover yok",
        (KUYRUK,),
    ),
    # ── 7-9: kuyruk filtresi, leech, günlük limit (servis) ─────────────────
    Mutasyon(
        "IP16-7", "Q-6/Q-7: bury/suspend filtresi kaldırıldı",
        SERVICE,
        """    return or_(
        prog.id.is_(None),
        and_(
            prog.suspended_at.is_(None),
            or_(prog.buried_until.is_(None), prog.buried_until <= now),
        ),
    )""",
        "    return or_(prog.id.is_(None), prog.id.isnot(None))  # MUTASYON: filtre yok",
        (KUYRUK,),
    ),
    Mutasyon(
        "IP16-8", "Q-8: leech eşiği yok sayıldı",
        SERVICE,
        "    return lapses == threshold or (lapses > threshold and (lapses - threshold) % half == 0)",
        "    return False  # MUTASYON: leech hiç tetiklenmiyor",
        (KUYRUK,),
    ),
    Mutasyon(
        "IP16-9", "L-1/L-2: günlük limitler yok sayıldı",
        SERVICE,
        """    rem_new = max(0, new_limit - introduced_today)
    rem_review = max(0, review_limit - reviews_today)""",
        """    rem_new = 10**6  # MUTASYON: limit yok
    rem_review = 10**6""",
        (KUYRUK,),
    ),
    # ── 13-14: idempotency ve undo ─────────────────────────────────────────
    Mutasyon(
        "IP16-13", "S-1: cevap claim'i koşulsuzlaştırıldı (replay ilerletiyor)",
        SERVICE,
        "    if token is not None and result.rowcount == 0:",
        "    if False:  # MUTASYON: claim koşulsuz",
        (OTURUM,),
    ),
    Mutasyon(
        "IP16-14", "S-5: undo zincirlenebilir yapıldı",
        SERVICE,
        "        .where(SrsReviewLog.id == last_id, SrsReviewLog.undone_at.is_(None))",
        "        .where(SrsReviewLog.id == last_id)  # MUTASYON: zincir serbest",
        (OTURUM,),
    ),
    # ── 15-17: sahiplik, K-6 gizlilik, kopya bağımsızlığı ──────────────────
    Mutasyon(
        "IP16-15", "D-4: deste sahiplik kontrolü kaldırıldı (IDOR)",
        SERVICE,
        """    if await _is_assigned(db, deck.id, user):
        return deck
    raise _404("Deste bulunamadı")""",
        "    return deck  # MUTASYON: sahiplik/atama kontrolü yok",
        (GIZLILIK,),
    ),
    Mutasyon(
        "IP16-16", "K-6: EĞİTMENE ÖĞRENCİ İLERLEMESİ AÇILDI",
        SERVICE,
        """    own_join = and_(
        prog.card_id == SrsCard.id,
        prog.user_id == user.id,
        prog.role_id == user.role_id,
        prog.deleted_at.is_(None),
    )""",
        """    own_join = and_(
        prog.card_id == SrsCard.id,
        prog.deleted_at.is_(None),
    )  # MUTASYON: kullanıcı filtresi kalktı — başkasının ilerlemesi sızar""",
        (GIZLILIK,),
    ),
    Mutasyon(
        "IP16-17", "D-9: kopya kaynağa bağlandı (derin kopya yerine paylaşım)",
        SERVICE,
        "            copied_from_id=src.id,",
        "            copied_from_id=src.id, id=src.id,  # MUTASYON: aynı satır",
        (GIZLILIK,),
    ),
    # ── 18-19: sayfalama ve kart bağımsızlığı ──────────────────────────────
    Mutasyon(
        "IP16-18", "B-3: sunucu sayfalaması kaldırıldı (istemciye bırakıldı)",
        SERVICE,
        """        .order_by(SrsCard.id)  # deterministik (B-3)
        .limit(page_size)
        .offset((page - 1) * page_size)""",
        "        .order_by(SrsCard.id)  # MUTASYON: limit/offset yok",
        (TARAYICI,),
    ),
    Mutasyon(
        "IP16-19", "T-2: ters kart ana kartla aynı ilerlemeyi paylaşıyor",
        SERVICE,
        """    if note_type == "BASIC_REVERSED":
        return [0, 1]""",
        """    if note_type == "BASIC_REVERSED":
        return [0]  # MUTASYON: ters kart ayrı kart değil""",
        (TIPLER,),
    ),
    # ── 20: yazarak cevaplama (frontend) ───────────────────────────────────
    Mutasyon(
        "IP16-20", "T-6: karşılaştırma gevşetildi (naif lowercase + noktalama silme)",
        TYPEANS,
        """    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr-TR");""",
        """    .replace(/[.,!?;:]/g, "")
    .toLowerCase(); // MUTASYON: Türkçe katlama + noktalama duyarlılığı gitti""",
        ("src/lib/srsTypeAnswer.test.ts",),
        taraf="frontend",
    ),
]


def _secilen_test_sayisi(m: Mutasyon) -> int:
    """Mutasyondan ÖNCE: hedef testler gerçekten seçiliyor mu?

    0 ise prova anlamsızdır (yanlış yol / bozuk koleksiyon) ve BAŞARISIZLIKTIR.
    """
    if m.taraf == "backend":
        r = _kos(
            [sys.executable, "-m", "pytest", "--collect-only", "-q", *m.testler],
            BACKEND,
        )
        son = [s for s in (r.stdout + r.stderr).splitlines() if s.strip()]
        for satir in reversed(son):
            eşleşme = re.search(r"(\d+)\s+tests?\s+collected", satir)
            if eşleşme:
                return int(eşleşme.group(1))
            if "no tests collected" in satir or "error" in satir.lower():
                return 0
        return 0
    r = _kos("npx vitest list " + " ".join(m.testler), FRONTEND)
    cikti = r.stdout + r.stderr
    return len([s for s in cikti.splitlines() if " > " in s])


def calistir(m: Mutasyon, head0: str, durum0: str) -> tuple[bool, int]:
    print(f"\n{'=' * 72}\n{m.no} - {m.ad}\n{'=' * 72}")
    sayi = _secilen_test_sayisi(m)
    print(f"seçilen test sayısı: {sayi}")
    if sayi == 0:
        print("!!! SEÇİLEN TEST YOK — prova geçersiz, BAŞARISIZLIK !!!")
        return False, 0

    with contextlib.ExitStack() as yamalar:
        yamalar.enter_context(GeciciYama(KOK / m.rel, m.eski, m.yeni))
        for rel, eski, yeni in m.ek:
            yamalar.enter_context(GeciciYama(KOK / rel, eski, yeni))
        if m.taraf == "backend":
            r = _kos([sys.executable, "-m", "pytest", "-q", *m.testler], BACKEND)
        else:
            r = _kos("npx vitest run " + " ".join(m.testler), FRONTEND)
        cikti = r.stdout + r.stderr
        kirilan = _kirilanlar(cikti)

    head1, durum1 = _agac_durumu()
    if (head1, durum1) != (head0, durum0):
        print("!!! ÇALIŞMA AĞACI GERİ ALINMADI — DUR !!!")
        raise SystemExit(3)

    if kirilan:
        print(f"YAKALANDI ({len(kirilan)} test kırıldı):")
        for k in kirilan[:6]:
            print("   -", k)
        return True, sayi
    print("!!! YAKALANMADI — bu davranış için önce anlamlı bir test yazılmalı !!!")
    son = [x for x in cikti.strip().splitlines() if x.strip()][-1:]
    if son:
        print("   son satır:", son[0].encode("ascii", "replace").decode())
    return False, sayi


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("hedef", nargs="?", help="mutasyon no (ör. IP16-4); boşsa hepsi")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--allow-dirty", action="store_true")
    a = ap.parse_args()

    if a.list:
        for m in MUTASYONLAR:
            print(f"{m.no}  {m.ad}   ({m.rel})")
        return 0

    head0, durum0 = _on_kontrol(a.allow_dirty)
    secili = [m for m in MUTASYONLAR if not a.hedef or m.no == a.hedef]
    if not secili:
        print(f"bilinmeyen mutasyon: {a.hedef}")
        return 2

    sonuc = [(m.no, *calistir(m, head0, durum0)) for m in secili]
    print(f"\n{'=' * 72}")
    yakalanan = sum(1 for _no, ok, _n in sonuc if ok)
    print(f"İP-16 MUTASYON PROVASI: {yakalanan}/{len(sonuc)} yakalandı")
    for no, ok, n in sonuc:
        if not ok:
            print(f"  YAKALANMADI: {no} (seçilen test: {n})")
    return 0 if yakalanan == len(sonuc) else 1


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


if __name__ == "__main__":
    sys.exit(main())
