"""İP-18 (sipariş kilit yarışı) mutasyon provası kataloğu — 8 mutasyon.

`scripts/mutation_drill` sürücüsünün güvenlik makinesini (bayt yedeği +
SHA-256 doğrulamalı geri alma, kirli ağaç reddi, HEAD/status karşılaştırması)
YENİDEN KULLANIR; katalog ve üç ek nöbetçi buraya aittir.

## Ek nöbetçi 1 — `ERROR` ile düşen testler de "kırıldı"dır (TB-29)

Ortak `mutation_drill._kirilanlar` yalnız `FAILED ` ile başlayan satırları
sayar. Bir mutasyon testleri **koşamayacak** kadar derinden bozarsa (import
hatası, koleksiyon patlaması, conftest'te DB kurulamaması) pytest `ERROR
tests/...::düğüm` yazar ve tek bir `FAILED` satırı olmaz — sürücü o mutasyonu
"YAKALANMADI" raporlar. Oysa suite hiç koşamamıştır; bu `FAILED`'dan daha sert
bir kırılmadır.

TB-29 bu dalda **AÇIK**: düzeltme İP-16 sürücüsünde yerel olarak yapıldı,
ortak sürücüye taşınmadı. Ortak sürücüyü değiştirmek yedi paketin kapanış
raporlarının dayandığı ölçüm aracını değiştirir ve geçmiş turların
"yakalanmadı" kayıtlarının bir kısmını geçersiz kılabilir — bu, İP-18'in
kapsamı değil. Bu yüzden burada da (İP-16'daki gibi) üst fonksiyon bilinçli
olarak GÖLGELENİR.

## Ek nöbetçi 2 — "seçilen test sayısı 0 ise BAŞARISIZLIK"

Yanlış dosya adı / `-k` kayması / import hatası pytest'e 0 test seçtirir;
çıktıda `FAILED` olmaz ve mutasyon "yakalanmadı" görünür. "Test zayıf" ile
"test hiç koşmadı" aynı şey değildir. Mutasyondan ÖNCE `--collect-only` ile
sayılır, 0 ise prova hata olarak kesilir.

## Ek nöbetçi 3 — YEŞİL TABAN ÇİZGİSİ (TB-14/7b)

Mutasyondan önce hedef testler **temiz ağaçta** koşturulur. Zaten kırmızı olan
bir testin mutasyon altında da kırmızı kalması "mutasyon yakalandı" DEĞİLDİR;
bu nöbetçi olmadan sürücü kendi kendini kandırabilir.

## Kullanım

    cd backend
    python -m scripts.mutation_drill_ip18 --list
    $env:POSTGRES_DB='adana_ip18_test'; $env:PAYMENT_PROVIDER='fake'
    python -m scripts.mutation_drill_ip18 IP18-1
    python -m scripts.mutation_drill_ip18            # hepsi
"""
from __future__ import annotations

import argparse
import contextlib
import re
import sys

from scripts.mutation_drill import (
    BACKEND,
    KOK,
    GeciciYama,
    Mutasyon,
    _agac_durumu,
    _kos,
    _on_kontrol,
)
from scripts.mutation_drill import _kirilanlar as _ust_kirilanlar

ORDER = "backend/services/order_service.py"
RECONCILER = "backend/services/escrow_reconciler.py"

#: Davranış matrisi (gerçek PG) ve saf/yapısal sözleşme.
PG = "tests/integration/test_ip18_siparis_kilit_pg.py"
SAF = "tests/test_ip18_odeme_kosulu.py"
KILIT_SOZLESMESI = "tests/acceptance/test_stock_lock_contract.py"
IP2B_CALLBACK = "tests/integration/test_ip2b_cancel_callback_pg.py"


MUTASYONLAR: list[Mutasyon] = [
    Mutasyon(
        "IP18-1",
        "yaşam döngüsü koşulu claim'den söküldü (kusurun kendisi)",
        ORDER,
        "        extra_where=kosul + tuple(extra_where),",
        "        extra_where=tuple(extra_where),  # MUTASYON: yasam dongusu kosulu yok",
        (PG,),
    ),
    Mutasyon(
        "IP18-2",
        "boğaz noktası atlandı: doğrudan escrow.claim",
        ORDER,
        """    claimed = await _siparis_para_claimi(
        db,
        order.id,
        from_statuses=["PENDING", "FAILED"],
        values={"payment_status": "PAID", "paid_at": paid_at},
    )""",
        """    claimed = await escrow.claim(  # MUTASYON: bogaz noktasi atlandi
        db,
        Order,
        order.id,
        from_statuses=["PENDING", "FAILED"],
        values={"payment_status": "PAID", "paid_at": paid_at},
        status_attr="payment_status",
    )""",
        (SAF, KILIT_SOZLESMESI),
    ),
    Mutasyon(
        "IP18-3",
        "ölü varlık iadesi söküldü (para bağlanmıyor ama iade de edilmiyor)",
        ORDER,
        """            await _olu_varlik_tahsilatini_iade_et(
                db,
                order,
                provider_ref=provider_ref,
                tahsil_edilen=Decimal(str(order.total)),
            )
            return""",
        "            return  # MUTASYON: olu varlik iadesi sokuldu",
        (PG,),
    ),
    Mutasyon(
        "IP18-4",
        "claim sonucu yok sayıldı → iptal edilmiş siparişe stok/PAID yazılır",
        ORDER,
        """    if not claimed:
        # Neden kaybettik? Cevap bayat nesneden okunamaz — TAZE durum söyler.""",
        """    if False:  # MUTASYON: claim sonucu yok sayildi
        # Neden kaybettik? Cevap bayat nesneden okunamaz — TAZE durum söyler.""",
        (PG,),
    ),
    Mutasyon(
        "IP18-5",
        "kilit sırası ters çevrildi: Order kilidi Product'tan ÖNCE",
        ORDER,
        """    physical = _physical_items(order)
    needed: dict[int, int] = {}""",
        """    await _lock_order(db, order)  # MUTASYON: Order -> Product sirasi
    physical = _physical_items(order)
    needed: dict[int, int] = {}""",
        (PG, KILIT_SOZLESMESI),
    ),
    Mutasyon(
        "IP18-6",
        "claim kaybedilince TAZE durum yerine bayat ORM nesnesi okundu",
        ORDER,
        "        taze = await _taze_siparis_durumu(db, order.id)",
        "        taze = order.status  # MUTASYON: bayat ORM nesnesinden okundu",
        (PG,),
    ),
    Mutasyon(
        "IP18-7",
        "reconciler taramasına status filtresi EKLENDİ (ölü sipariş taranmaz)",
        RECONCILER,
        "                Order.provider_ref.isnot(None),",
        """                Order.provider_ref.isnot(None),
                Order.status.in_(["PENDING"]),  # MUTASYON: olu siparis taranmaz""",
        (IP2B_CALLBACK, PG),
    ),
    # ── TB-15(b) nöbetçileri (bağımsız denetim P1-2) ────────────────────────
    # Denetçi bu üçünü koştu ve ÜÇÜ DE 1311 testin hiçbirini kırmadı: TB-15(b)
    # davranış olarak kapatılmış ama NÖBETSİZ bırakılmıştı. D12/D13/D14 bu
    # boşluğu kapatmak için yazıldı; aşağıdaki üç prova onların gücünü kanıtlar.
    Mutasyon(
        "IP18-9",
        "TB-15(b): iade tavanı (M1) claim koşulundan söküldü",
        ORDER,
        "        extra_where=(Order.refund_reserved + order_total <= Order.total,),",
        "        extra_where=(),  # MUTASYON: tavan sokuldu",
        (PG,),
    ),
    Mutasyon(
        "IP18-10",
        "TB-15(b): `apply_refunded_amount` hiç çağrılmıyor (refunded_amount yazılmaz)",
        ORDER,
        "    await apply_refunded_amount(db, order, order_total)",
        "    pass  # MUTASYON: refunded_amount hic yazilmiyor",
        (PG,),
    ),
    Mutasyon(
        "IP18-11",
        "TB-15(b): `refund_reserved` rezervasyonu claim'den söküldü",
        ORDER,
        '            "refund_reserved": Order.refund_reserved + order_total,',
        "            # MUTASYON: rezervasyon sokuldu",
        (PG,),
    ),
    Mutasyon(
        "IP18-8",
        "tek kaynak sabiti genişletildi: PARA_BAGLANABILIR_DURUMLAR += CANCELLED",
        ORDER,
        'PARA_BAGLANABILIR_DURUMLAR: frozenset[str] = frozenset({"PENDING"})',
        'PARA_BAGLANABILIR_DURUMLAR: frozenset[str] = frozenset({"PENDING", "CANCELLED"})  # MUTASYON',
        (SAF, PG),
    ),
]


def _kirilanlar(cikti: str) -> list[str]:  # noqa: F811 — üst sürücüyü bilinçli gölgeler
    """Üst sürücünün `FAILED` taraması + pytest `ERROR …::düğüm` satırları.

    ⚠️ **Kapsam dar ve bilinçli** (bağımsız denetim bulgusu, [[TB-42]]): yalnız
    içinde `::` geçen `ERROR` satırları sayılır. Pytest, KOLEKSİYON düzeyinde
    patlayan bir dosyayı `ERROR tests/x.py - NameError: …` biçiminde, yani
    düğüm ayracı OLMADAN raporlar; o satır burada sayılmaz ve mutasyon
    "yakalanmadı" görünebilir.

    `::` şartı kaldırılamaz çünkü yakalanan log çıktısı da `ERROR ` ile başlar
    (`ERROR    adana.escrow:escrow.py:518 …`). Onu da saymak, ERROR log yazan
    HER mutasyonu "yakalandı" gösterirdi — yani ölçüm aracını yalancı yeşil
    üreticisine çevirirdi. Yön bu yüzden güvenlidir: eksik sayar, fazla
    saymaz. Doğru çözüm iki deseni ayırt eden bir eşleştiricidir; ortak
    sürücüyle birlikte ele alınmalıdır (TB-29 + TB-42).
    """
    kirilan = list(_ust_kirilanlar(cikti))
    hatalar = sorted(
        {
            s.split(" ")[1] if " " in s else s
            for s in cikti.splitlines()
            if s.startswith("ERROR ") and "::" in s
        }
    )
    return kirilan + [f"{h} (KURULUM HATASI — test hiç koşmadı)" for h in hatalar]


def _sayi_ve_sonuc(cikti: str) -> str:
    son = [x for x in cikti.strip().splitlines() if x.strip()]
    return son[-1].encode("ascii", "replace").decode() if son else "(çıktı yok)"


def _secilen_test_sayisi(m: Mutasyon) -> int:
    """Mutasyondan ÖNCE: hedef testler gerçekten seçiliyor mu? 0 = BAŞARISIZLIK."""
    r = _kos(
        [sys.executable, "-m", "pytest", "--collect-only", "-q", *m.testler], BACKEND
    )
    for satir in reversed(
        [s for s in (r.stdout + r.stderr).splitlines() if s.strip()]
    ):
        eslesme = re.search(r"(\d+)\s+tests?\s+collected", satir)
        if eslesme:
            return int(eslesme.group(1))
        if "no tests collected" in satir or "error" in satir.lower():
            return 0
    return 0


def _yesil_taban(m: Mutasyon) -> tuple[bool, str]:
    """Temiz ağaçta hedef testler YEŞİL mi? Değilse prova geçersizdir."""
    r = _kos([sys.executable, "-m", "pytest", "-q", *m.testler], BACKEND)
    cikti = r.stdout + r.stderr
    return (not _kirilanlar(cikti)) and r.returncode == 0, _sayi_ve_sonuc(cikti)


def calistir(m: Mutasyon, head0: str, durum0: str) -> tuple[bool, int]:
    print(f"\n{'=' * 72}\n{m.no} - {m.ad}\n{'=' * 72}")
    sayi = _secilen_test_sayisi(m)
    print(f"seçilen test sayısı: {sayi}")
    if sayi == 0:
        print("!!! SEÇİLEN TEST YOK — prova geçersiz, BAŞARISIZLIK !!!")
        return False, 0

    yesil, ozet = _yesil_taban(m)
    print(f"yeşil taban çizgisi: {'EVET' if yesil else 'HAYIR'}  [{ozet}]")
    if not yesil:
        print("!!! TABAN KIRMIZI — mutasyon provası ANLAMSIZ, BAŞARISIZLIK !!!")
        return False, sayi

    with contextlib.ExitStack() as yamalar:
        yamalar.enter_context(GeciciYama(KOK / m.rel, m.eski, m.yeni))
        for rel, eski, yeni in m.ek:
            yamalar.enter_context(GeciciYama(KOK / rel, eski, yeni))
        r = _kos([sys.executable, "-m", "pytest", "-q", *m.testler], BACKEND)
        cikti = r.stdout + r.stderr
        kirilan = _kirilanlar(cikti)

    head1, durum1 = _agac_durumu()
    if (head1, durum1) != (head0, durum0):
        print("!!! ÇALIŞMA AĞACI GERİ ALINMADI — DUR !!!")
        raise SystemExit(3)

    if kirilan:
        print(f"YAKALANDI ({len(kirilan)} test kırıldı):")
        for k in kirilan[:8]:
            print("   -", k)
        return True, sayi
    print("!!! YAKALANMADI — bu davranış için önce anlamlı bir test yazılmalı !!!")
    print("   son satır:", _sayi_ve_sonuc(cikti))
    return False, sayi


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("hedef", nargs="?", help="mutasyon no (ör. IP18-4); boşsa hepsi")
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
    print(f"İP-18 MUTASYON PROVASI: {yakalanan}/{len(sonuc)} yakalandı")
    for no, ok, n in sonuc:
        print(f"  {'YAKALANDI  ' if ok else 'YAKALANMADI'} {no} (seçilen test: {n})")
    return 0 if yakalanan == len(sonuc) else 1


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


if __name__ == "__main__":
    sys.exit(main())
