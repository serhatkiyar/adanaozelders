"""Mutasyon provası sürücüsü — GÜVENLİ.

Doğru davranışı geçici olarak bozar, hedef testlerin **gerçekten kırıldığını**
gösterir, sonra değişikliği geri alır. Kural: kök `CLAUDE.md` → *Test Kalitesi ve
Doğrulama Standardı* § D.

## Neden ayrı ve dikkatli bir sürücü

İlk (tek kullanımlık) sürüm iki gerçek zarar verdi:

1. Geri almayı `git checkout -- <dosya>` ile yapıyordu ve aynı dosyadaki
   **commit edilmemiş bir üretim düzeltmesini sildi**; hata bir tur daha yaşandı.
2. Mutasyonlardan biri denetim işine `UPDATE products SET stock = 0` + `commit`
   enjekte ediyordu ve testler o sırada **geliştirme veritabanına** karşı
   koştuğu için gerçek katalog ürünlerinin stoğunu sıfırladı.

Bu yüzden burada:

* kirli çalışma ağacında **başlamayı reddeder** (`--allow-dirty` bilinçli kaçış),
* geri alma `git` ile DEĞİL, dosyanın **baytları belleğe alınıp geri yazılarak**
  yapılır (başka hiçbir değişikliğe dokunmaz),
* her mutasyondan sonra HEAD ve `git status` **başlangıçtaki hâline eşit mi**
  diye doğrulanır,
* veritabanı yazan testler adı `test` içeren bir veritabanı ister
  (`tests/integration/db_guard.py` zaten zorluyor); sürücü de env'i kontrol eder.

## Kullanım

    cd backend
    python -m scripts.mutation_drill --list
    POSTGRES_DB=adana_test python -m scripts.mutation_drill M1
    POSTGRES_DB=adana_test python -m scripts.mutation_drill        # hepsi
"""
from __future__ import annotations

import argparse
import dataclasses
import os
import pathlib
import subprocess
import sys

KOK = pathlib.Path(__file__).resolve().parents[2]
BACKEND = KOK / "backend"
FRONTEND = KOK / "frontend"


@dataclasses.dataclass(frozen=True, slots=True)
class Mutasyon:
    no: str
    ad: str
    rel: str
    eski: str
    yeni: str
    testler: tuple[str, ...]
    taraf: str = "backend"


def _kos(cmd, cwd) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=str(cwd), capture_output=True, text=True,
        encoding="utf-8", errors="replace", shell=isinstance(cmd, str),
    )


def _git(*args) -> str:
    return _kos(["git", *args], KOK).stdout.strip()


def _agac_durumu() -> tuple[str, str]:
    """(HEAD, `git status --porcelain`) — mutasyon öncesi/sonrası karşılaştırılır."""
    return _git("rev-parse", "HEAD"), _git("status", "--porcelain")


def _on_kontrol(allow_dirty: bool) -> tuple[str, str]:
    head, durum = _agac_durumu()
    if durum and not allow_dirty:
        print(
            "REDDEDİLDİ: çalışma ağacı kirli.\n\n"
            "Mutasyon provası dosyaları geçici olarak DEĞİŞTİRİR. Kirli bir "
            "ağaçta koşmak, bir hata hâlinde senin commit edilmemiş "
            "değişikliklerini kaybettirebilir (bir kez oldu).\n\n"
            "Önce commit/stash et, ya da riski kabul ediyorsan --allow-dirty.\n\n"
            "Bekleyen değişiklikler:\n  " + durum.replace("\n", "\n  ")
        )
        raise SystemExit(2)
    db = (os.getenv("POSTGRES_DB") or "").lower()
    if db and "test" not in db:
        print(
            f"REDDEDİLDİ: POSTGRES_DB='{db}' bir test veritabanına benzemiyor.\n"
            "Mutasyonlar veritabanına YAZABİLİR (bir mutasyon geliştirme "
            "kataloğunun stoğunu sıfırladı). Adında 'test' geçen bir "
            "veritabanı kullanın."
        )
        raise SystemExit(2)
    return head, durum


class GeciciYama:
    """Dosyayı belleğe alıp değiştirir; çıkışta **baytları** geri yazar.

    `git checkout --` KULLANILMAZ: o, dosyadaki başka (commit edilmemiş)
    değişiklikleri de siler.
    """

    def __init__(self, yol: pathlib.Path, eski: str, yeni: str) -> None:
        self.yol = yol
        self.eski = eski
        self.yeni = yeni
        self._yedek: bytes | None = None

    def __enter__(self):
        # Yedek BAYT bazında (satır sonları dâhil birebir geri yüklenir); ama
        # eşleştirme metin modunda yapılır: dosyalar Windows'ta CRLF ile
        # duruyor, desenler kaynakta LF. Ham baytta arama sessizce "hedef metin
        # yok" der ve mutasyon hiç uygulanmaz (bu tuzağa bir kez düşüldü).
        self._yedek = self.yol.read_bytes()
        metin = self.yol.read_text(encoding="utf-8")
        if self.eski not in metin:
            self._yedek = None
            raise SystemExit(f"MUTASYON UYGULANAMADI ({self.yol}): hedef metin yok")
        self.yol.write_text(metin.replace(self.eski, self.yeni, 1), encoding="utf-8")
        return self

    def __exit__(self, *exc):
        if self._yedek is not None:
            self.yol.write_bytes(self._yedek)
        return False


def _kirilanlar(cikti: str) -> list[str]:
    pytest_fail = sorted(
        {s.split(" ")[1] if " " in s else s
         for s in cikti.splitlines() if s.startswith("FAILED")}
    )
    if pytest_fail:
        return pytest_fail
    # vitest: "×" işaretli satırlar
    return [
        s.strip()[:110].encode("ascii", "replace").decode()
        for s in cikti.splitlines() if "×" in s
    ][:8]


def calistir(m: Mutasyon, head0: str, durum0: str) -> bool:
    print(f"\n{'=' * 72}\n{m.no} - {m.ad}\n{'=' * 72}")
    with GeciciYama(KOK / m.rel, m.eski, m.yeni):
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
        print("YAKALANDI. Kırılan testler:")
        for k in kirilan:
            print("   -", k)
        return True
    print("!!! YAKALANMADI — bu davranış için önce anlamlı bir test yazılmalı !!!")
    ozet = [x for x in cikti.strip().splitlines() if x.strip()][-1:]
    if ozet:
        print("   son satır:", ozet[0].encode("ascii", "replace").decode())
    return False


# ══════════════════════ Mutasyon kataloğu (commit 6) ══════════════════════

MUTASYONLAR: list[Mutasyon] = [
    Mutasyon(
        "M1", "liste JOIN'i kaldırıldı (N+1)",
        "backend/services/stock_ledger.py",
        """    return MovementPage(
        rows=[MovementRow(movement=r[0], sku=r[1], product_title=r[2]) for r in rows],
        total=total,
    )""",
        """    _out = []
    for _r in rows:
        _p = (
            await db.execute(select(Product).where(Product.id == _r[0].product_id))
        ).scalars().first()
        _out.append(MovementRow(movement=_r[0], sku=_p.sku, product_title=_p.title))
    return MovementPage(rows=_out, total=total)""",
        ("tests/integration/test_stock_audit_pg.py",),
    ),
    Mutasyon(
        "M2", "sıralamadan id DESC kaldırıldı",
        "backend/services/stock_ledger.py",
        ".order_by(StockMovement.created_at.desc(), StockMovement.id.desc())",
        ".order_by(StockMovement.created_at.desc())",
        ("tests/integration/test_stock_audit_pg.py",),
    ),
    Mutasyon(
        "M3", "genel denetim 200 ürün tavanı kaldırıldı",
        "backend/services/stock_ledger.py",
        "    limit = max(1, min(int(limit), AUDIT_MAX_LIMIT))",
        "    limit = max(1, int(limit))",
        ("tests/integration/test_stock_audit_pg.py",),
    ),
    Mutasyon(
        "M4", "genel liste ucundan products.view kaldırıldı",
        "backend/api/routers/store.py",
        """async def all_stock_movements(
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),""",
        """async def all_stock_movements(
    db: AsyncSession = Depends(get_db),""",
        ("tests/integration/test_stock_endpoints_pg.py",),
    ),
    Mutasyon(
        "M5", "audit_products içine stok UPDATE'i eklendi",
        "backend/services/stock_ledger.py",
        """    urunler = {
        p.id: p
        for p in (
            await db.execute(select(Product).where(Product.id.in_(ids)))
        ).scalars()
    }""",
        """    urunler = {
        p.id: p
        for p in (
            await db.execute(select(Product).where(Product.id.in_(ids)))
        ).scalars()
    }
    await db.execute(
        text("UPDATE products SET stock = 0 WHERE id = ANY(:ids)"), {"ids": ids}
    )
    await db.commit()""",
        ("tests/integration/test_stock_audit_pg.py",),
    ),
    Mutasyon(
        "M6", "toplu doğrulamadan OPENING_NOT_FIRST kaldırıldı",
        "backend/services/stock_ledger.py",
        """        if o and o.acilis_id is not None and int(o.acilis_id) != int(o.ilk_id):
            problems.append(
                _p(
                    PROBLEM_OPENING_NOT_FIRST,
                    "açılış bakiyesi zincirin ilk satırı değil",
                    movement_id=int(o.acilis_id),
                    expected=int(o.ilk_id),
                    actual=int(o.acilis_id),
                )
            )""",
        "        pass  # MUTASYON",
        ("tests/integration/test_stock_audit_pg.py",),
    ),
    Mutasyon(
        "M7", "movement_type filtresi API query'sine gönderilmiyor",
        "frontend/src/api/stock.ts",
        """  return Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && v !== null),
  );""",
        """  return Object.fromEntries(
    Object.entries(f).filter(
      ([k, v]) => k !== "movement_type" && v !== undefined && v !== "" && v !== null,
    ),
  );""",
        ("src/api/stock.test.ts",), "frontend",
    ),
    Mutasyon(
        "M8", "dijital ürün 'defter tutulmuyor' durumu kaldırıldı",
        "frontend/src/components/admin/StockLedgerPanel.tsx",
        "  if (dijital) {",
        "  if (false) {",
        ("src/components/admin/StockLedgerPanel.test.tsx",), "frontend",
    ),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("hedef", nargs="?", help="mutasyon no (ör. M4); boşsa hepsi")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--allow-dirty", action="store_true",
                    help="kirli çalışma ağacında koşmayı KABUL ET (riskli)")
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

    sonuc = [(m.no, calistir(m, head0, durum0)) for m in secili]
    print(f"\n{'=' * 72}")
    yakalanan = sum(1 for _, ok in sonuc if ok)
    print(f"MUTASYON PROVASI: {yakalanan}/{len(sonuc)} yakalandı")
    for no, ok in sonuc:
        if not ok:
            print(f"  YAKALANMADI: {no}")
    return 0 if yakalanan == len(sonuc) else 1


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


if __name__ == "__main__":
    sys.exit(main())
