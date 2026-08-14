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
import hashlib
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
    #: Ek yamalar: ``((rel, eski, yeni), ...)``.
    #:
    #: Neden gerekli (İP-2a'da ortaya çıktı): bazı davranışlar BİRDEN ÇOK
    #: bağımsız guard'la korunur ve hiçbirini tek başına sökmek davranışı
    #: bozmaz — mutasyon "yakalanmadı" görünür ama test kusursuz da olabilir.
    #: Gerçek soruyu ("bu guard'lar topluca vazgeçilebilir mi?") cevaplamak
    #: için birkaç yamayı AYNI koşuda uygulamak gerekir. Tek yama zorunluluğu,
    #: katmanlı korumanın olduğu yerde mutasyon provasını kör bırakıyordu.
    ek: tuple[tuple[str, str, str], ...] = ()


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
        self._ozet: str | None = None

    def __enter__(self):
        # Yedek BAYT bazında (satır sonları dâhil birebir geri yüklenir); ama
        # eşleştirme metin modunda yapılır: dosyalar Windows'ta CRLF ile
        # duruyor, desenler kaynakta LF. Ham baytta arama sessizce "hedef metin
        # yok" der ve mutasyon hiç uygulanmaz (bu tuzağa bir kez düşüldü).
        self._yedek = self.yol.read_bytes()
        self._ozet = hashlib.sha256(self._yedek).hexdigest()
        metin = self.yol.read_text(encoding="utf-8")
        if self.eski not in metin:
            self._yedek = None
            raise SystemExit(f"MUTASYON UYGULANAMADI ({self.yol}): hedef metin yok")
        if metin.count(self.eski) > 1:
            # Birden çok eşleşme, "hangisini bozduğumuzu bilmiyoruz" demektir;
            # yanlış yeri mutasyona uğratıp "yakalandı" demek [[TB-14]]/7(c)'nin
            # ta kendisidir.
            self._yedek = None
            raise SystemExit(
                f"MUTASYON BELİRSİZ ({self.yol}): hedef metin "
                f"{metin.count(self.eski)} kez geçiyor, deseni daraltın"
            )
        self.yol.write_text(metin.replace(self.eski, self.yeni, 1), encoding="utf-8")
        return self

    def __exit__(self, *exc):
        if self._yedek is not None:
            self.yol.write_bytes(self._yedek)
            # TB-14/7(a): geri almanın gerçekten baytı baytına olduğu
            # DOĞRULANIR. `git status` karşılaştırması dosya içeriğini
            # görmez — aynı boyutta bozuk bir geri yazım oradan kaçardı.
            simdi = hashlib.sha256(self.yol.read_bytes()).hexdigest()
            if simdi != self._ozet:
                raise SystemExit(
                    f"!!! GERİ ALMA DOĞRULANAMADI ({self.yol}): "
                    f"SHA-256 {self._ozet[:12]} → {simdi[:12]} !!!"
                )
        return False


def _secilen_test_sayisi(m: "Mutasyon") -> int:
    """Mutasyondan ÖNCE: bu prova gerçekten kaç test seçiyor?

    Sıfır seçilen test, "mutasyon yakalanmadı" ile aynı çıktıyı üretir ama
    bambaşka bir şeydir: prova hiç koşmamıştır. Yol yanlış yazıldığında,
    dosya taşındığında ya da testler bir marker'la atlandığında sürücü sessizce
    "YAKALANMADI" der ve bu, "test zayıf" diye okunur. Sayı bu yüzden her
    provada AÇIKÇA basılır ve sıfır olması sert hata sayılır.
    """
    if m.taraf != "backend":
        return -1  # vitest tarafı ayrı sayılır; -1 = "ölçülmedi"
    r = _kos(
        [sys.executable, "-m", "pytest", "-q", "--collect-only", *m.testler], BACKEND
    )
    cikti = r.stdout + r.stderr
    for satir in reversed(cikti.strip().splitlines()):
        s = satir.strip()
        # "12 tests collected in 0.30s" / "12/34 tests collected (22 deselected)"
        if "test" in s and "collected" in s:
            bas = s.split(" ", 1)[0].split("/")[0]
            if bas.isdigit():
                return int(bas)
        if s.startswith("no tests ran") or "collected 0 items" in s:
            return 0
    return 0


def _kirilanlar(cikti: str) -> list[str]:
    """Mutasyonun yakalandığına dair kanıt satırları.

    ## `FAILED` yetmez — `ERROR` de sayılır ([[TB-29]])

    Bu tarama uzun süre yalnız `FAILED` satırlarına baktı ve **"test zayıf" ile
    "test hiç koşmadı"yı aynı kefeye koydu**. Ölçülen vaka (İP-16, IP16-21):
    migration zinciri koparıldığında entegrasyon conftest'i veritabanını
    kuramıyor ("Multiple head revisions"), pytest beş düğümü de `ERROR` olarak
    raporluyor ve TEK bir `FAILED` satırı çıkmıyor. Sürücü bunu "YAKALANMADI"
    sayıyordu; oysa suite hiç koşamamıştı, ki bu daha sert bir kırılmadır ve
    ters yönde yanlış karar verdirir: gerçekte nöbetçi olan bir testi
    "yetersiz" ilan edip yerine yenisini yazdırır.

    Ayrım İP-16'da yerel bir gölge fonksiyonla kapatılmıştı; kusur burada
    olduğu için düzeltme de buraya taşındı (İP-17). **Bu, geçmiş turların
    ölçüm aracını değiştirir**: daha önce "YAKALANMADI" raporlanmış bir prova,
    kurulum hatası yüzünden öyle görünüyorduysa artık YAKALANDI sayılır.
    Sözleşmeye not düşüldü.
    """
    pytest_fail = sorted(
        {s.split(" ")[1] if " " in s else s
         for s in cikti.splitlines() if s.startswith("FAILED")}
    )
    kurulum_hatasi = sorted(
        {s.split(" ")[1] if " " in s else s
         for s in cikti.splitlines() if s.startswith("ERROR ") and "::" in s}
    )
    if pytest_fail or kurulum_hatasi:
        return pytest_fail + [
            f"{h} (KURULUM HATASI — test hiç koşmadı)" for h in kurulum_hatasi
        ]
    # vitest: "×" işaretli satırlar
    return [
        s.strip()[:110].encode("ascii", "replace").decode()
        for s in cikti.splitlines() if "×" in s
    ][:8]


def calistir(m: Mutasyon, head0: str, durum0: str) -> bool:
    print(f"\n{'=' * 72}\n{m.no} - {m.ad}\n{'=' * 72}")
    import contextlib

    secilen = _secilen_test_sayisi(m)
    print(f"seçilen test sayısı: {secilen if secilen >= 0 else 'ölçülmedi (frontend)'}")
    if secilen == 0:
        print("!!! SIFIR TEST SEÇİLDİ — prova hiç koşmadı, bu bir BAŞARISIZLIKTIR !!!")
        return False

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
    # ── İP-1a: ders pazaryeri para güvenliği (P0-1…P0-6) ────────────────────
    #
    # Katalog daha önce tamamen envanter/stok odaklıydı ve **para yolunda tanımlı
    # tek bir mutasyon yoktu** (bkz. docs/ip1a-ders-para-sozlesme.md §9d). Bu
    # bölüm o boşluğu kapatır: her giriş İP-1a'da yazılan bir guard'ı söker ve
    # nöbetçisinin gerçekten kırıldığını gösterir.
    Mutasyon(
        "M9", "İP-1a P0-1: red yolundan emanet iadesi kaldırıldı",
        "backend/services/booking_service.py",
        """    # Emanette ödeme varsa öğrenciye iade et (yoksa no-op). Taraf iptaliyle AYNI
    # yol: `escrow.refund_escrow` (claim + iki faz) — paralel bir iade uygulaması
    # yazılmaz, idempotency ve sağlayıcı-başarısızlığı davranışı devralınır.
    await payment_service.refund(db, booking)""",
        """    pass  # MUTASYON: red emaneti çözmüyor""",
        ("tests/integration/test_ip1a_reschedule_reject_pg.py",),
    ),
    Mutasyon(
        "M10", "İP-1a P0-2: admin iptali ortak booking_service yolunu atlıyor",
        "backend/services/admin_service.py",
        """    from services import booking_service

    return await booking_service.cancel_by_admin(db, booking, reason=reason)""",
        """    booking.status = BookingStatus.CANCELLED  # MUTASYON: FSM + iade yok
    await db.flush()
    return booking""",
        (
            "tests/integration/test_ip1a_admin_cancel_pg.py",
        ),
    ),
    Mutasyon(
        "M11", "İP-1a P0-3: complete'in start_at eşiği kaldırıldı",
        "backend/services/booking_service.py",
        """    if start > datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Henüz başlamamış bir ders tamamlanamaz.",
        )""",
        """    return  # MUTASYON: başlamamış ders de tamamlanabilir""",
        ("tests/integration/test_ip1a_complete_timing_pg.py",),
    ),
    Mutasyon(
        "M12", "İP-1a P0-4: complete/auto-complete ihtilaf koşulu kaldırıldı",
        "backend/services/booking_service.py",
        "_IHTILAFSIZ = (Booking.is_disputed.is_(False),)",
        "_IHTILAFSIZ = ()  # MUTASYON: ihtilaf para kararında okunmuyor",
        ("tests/integration/test_ip1a_dispute_autocomplete_pg.py",),
    ),
    Mutasyon(
        "M13", "İP-1a P0-6: atomik claim koşulsuz ORM atamasına çevrildi (accept)",
        "backend/services/booking_service.py",
        """    if not await _claim_transition(db, booking, BookingStatus.ACCEPTED):
        raise _claim_hatasi(booking, BookingStatus.ACCEPTED)""",
        """    _transition(booking, BookingStatus.ACCEPTED)  # MUTASYON: claim yok""",
        ("tests/integration/test_ip1a_races_pg.py",),
    ),
    Mutasyon(
        "M14", "İP-1a §8/S4: sahipsiz emanet iadesi claim'siz (iki worker açık)",
        "backend/services/escrow_reconciler.py",
        """            outcome = await escrow.refund_escrow(
                db, payment, escrow.PAYMENT_SPEC, notify=_bildir
            )""",
        """            # MUTASYON: claim'siz doğrudan sağlayıcı çağrısı
            _ok = await escrow.perform_refund(
                db, payment, escrow.PAYMENT_SPEC, notify=_bildir
            )
            outcome = "refunded" if _ok else "refunding\"""",
        ("tests/integration/test_ip1a_orphan_escrow_pg.py",),
    ),
    Mutasyon(
        "M15", "İP-1a §7/S5: sağlayıcı reddettiği hâlde REFUNDED damgalanıyor",
        "backend/services/escrow.py",
        """            obj.provider_ref,
        )
        return False""",
        """            obj.provider_ref,
        )
        return await finalize_refund(db, obj, spec, notify=notify)  # MUTASYON""",
        ("tests/integration/test_ip1a_orphan_escrow_pg.py",),
    ),
    Mutasyon(
        "M16", "İP-1a: release'in HELD kısıtı gevşetildi (RELEASED'dan da claim)",
        "backend/services/payment_service.py",
        """        from_statuses=[PaymentStatus.HELD],
        values={"status": PaymentStatus.RELEASED, "released_at": _now()},""",
        """        from_statuses=[PaymentStatus.HELD, PaymentStatus.RELEASED],  # MUTASYON
        values={"status": PaymentStatus.RELEASED, "released_at": _now()},""",
        ("tests/integration/test_ip1a_complete_timing_pg.py",),
    ),
    Mutasyon(
        "M17", "İP-1a: begin_refund'ın released_at IS NULL guard'ı silindi",
        "backend/services/escrow.py",
        """        extra_where=(
            (model.released_at.is_(None),) if spec.has_released_guard else ()
        ),""",
        """        extra_where=(),  # MUTASYON: released_at guard yok""",
        ("tests/integration/test_ip1a_orphan_escrow_pg.py",),
    ),
    Mutasyon(
        "M18", "İP-1a §8/S2: sahipsiz emanet taramasının karantinası kaldırıldı",
        "backend/services/escrow_reconciler.py",
        """                Booking.updated_at <= cutoff,
                Payment.updated_at <= cutoff,""",
        """                Booking.id.is_not(None),  # MUTASYON: karantina yok""",
        ("tests/integration/test_ip1a_orphan_escrow_pg.py",),
    ),
    Mutasyon(
        "M19", "İP-1a P0-4: ihtilaf açma koşulsuz (tamamlanmış derste de açılır)",
        "backend/services/admin_service.py",
        """        result = await db.execute(
            update(Booking)
            .where(
                Booking.id == booking.id,
                Booking.status.in_(_DISPUTE_ACILABILIR),
                Booking.deleted_at.is_(None),
            )
            .values(is_disputed=True)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            await db.refresh(booking)
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Yalnızca devam eden bir derste ihtilaf açılabilir; tamamlanmış "
                "ya da iptal edilmiş dersin para hareketi sonuçlanmıştır.",
            )
        booking.is_disputed = True""",
        """        booking.is_disputed = True  # MUTASYON: koşulsuz ihtilaf""",
        ("tests/integration/test_ip1a_races_pg.py",),
    ),
    Mutasyon(
        "M20", "İP-1a P0-5: sahipsiz emanet taraması hiçbir satır işlemiyor",
        "backend/services/escrow_reconciler.py",
        """    handled = 0
    for payment, booking in rows:""",
        """    handled = 0
    for payment, booking in []:  # MUTASYON: tarama ölü""",
        ("tests/integration/test_ip1a_orphan_escrow_pg.py",),
    ),
    # ── Nihai bağımsız audit'in bulduğu iki P1 (M21, M22) ───────────────────
    #
    # İkisi de "60 test yeşilken gerçek PG probunda para açığı" sınıfındandır:
    # M12 ve M13 gibi geniş mutasyonlar bu boşlukları GÖREMİYORDU, çünkü her
    # birinde ikinci bir koruma katmanı ölçümü gölgeliyordu.
    Mutasyon(
        "M21", "İP-1a P1-A: auto-complete claim'inin ihtilaf koşulu sökülü "
               "(aday sorgusundaki filtre KORUNUYOR)",
        "backend/services/booking_service.py",
        """        if not await _claim_transition(
            db, booking, BookingStatus.COMPLETED, extra_where=_IHTILAFSIZ
        ):""",
        """        if not await _claim_transition(
            db, booking, BookingStatus.COMPLETED
        ):  # MUTASYON: yalnız claim guard'ı sökülü""",
        ("tests/integration/test_ip1a_dispute_autocomplete_pg.py",),
    ),
    Mutasyon(
        "M22", "İP-1a P1-B: reschedule atomik claim yerine doğrudan status ataması",
        "backend/services/booking_service.py",
        """    if not await _claim_transition(db, booking, BookingStatus.PENDING):
        raise _claim_hatasi(booking, BookingStatus.PENDING)""",
        """    booking.status = BookingStatus.PENDING  # MUTASYON: eski doğrudan atama""",
        ("tests/integration/test_ip1a_races_pg.py",),
    ),
    # ── İP-2a: mağaza iade para güvenliği (İP2A-01…18 + PK-α/PK-δ) ──────────
    #
    # Katalogda mağaza İADE yolunda tanımlı tek bir mutasyon yoktu: İP-1a bölümü
    # ders emanetini, envanter bölümü defteri sökerdi ama "iade parası + fiziksel
    # kabul + manuel inceleme" üçlüsü hiç sınanmamıştı
    # (docs/ip2a-magaza-iade-sozlesme.md → Üretim uygulaması kapanışı).
    Mutasyon(
        "M23", "İP2A-09: refunded_amount artışı kaldırıldı (tek yazıcı ölü)",
        "backend/services/order_service.py",
        """    await db.execute(
        text(
            "UPDATE orders SET refunded_amount = LEAST(refunded_amount + :a, total), "
            "refunded_at = COALESCE(refunded_at, now()) WHERE id = :i"
        ),
        {"a": amount, "i": order.id},
    )""",
        """    pass  # MUTASYON: iade cirosu ve kümülatif tavan güncellenmiyor""",
        (
            "tests/integration/test_ip2a_refund_two_phase_pg.py",
            "tests/integration/test_ip2a_races_pg.py",
        ),
    ),
    Mutasyon(
        "M24", "İP2A-03/04: iade rezervasyon tavanı kaldırıldı",
        "backend/services/order_service.py",
        '            "WHERE id = :i AND refund_reserved + :a <= total"',
        '            "WHERE id = :i"  # MUTASYON: tavan koşulu yok',
        ("tests/integration/test_ip2a_races_pg.py",),
    ),
    Mutasyon(
        # M24 tek başına yakalanmadı ve bu SONUÇ DOĞRUDUR: tavan dört bağımsız
        # guard'la korunur (sipariş satır kilidi · kilit altında TAZE
        # `reservable_refund` okuması · `payment_status == PAID` şartı · koşullu
        # UPDATE). Hiçbirini tek başına sökmek ulaşılabilir bir aşırı iade
        # üretmiyor. M24b üçünü birden söker — yani tarihsel İP2A-03/04
        # şeklini geri getirir — ve davranışın GERÇEKTEN bozulduğunu gösterir.
        "M24b", "İP2A-03/04: tavan hesabı tarihsel (bayat) hâline döndürüldü",
        "backend/services/order_service.py",
        """    row = (
        await db.execute(
            text("SELECT total - refund_reserved FROM orders WHERE id = :i"),
            {"i": order_id},
        )
    ).scalar_one_or_none()""",
        """    row = (  # MUTASYON: tavan bayat `refunded_amount`'tan okunuyor
        await db.execute(
            text("SELECT total - refunded_amount FROM orders WHERE id = :i"),
            {"i": order_id},
        )
    ).scalar_one_or_none()""",
        ("tests/integration/test_ip2a_races_pg.py",),
        "backend",
        (
            (
                "backend/services/order_service.py",
                '            "WHERE id = :i AND refund_reserved + :a <= total"',
                '            "WHERE id = :i"  # MUTASYON: koşullu tavan yok',
            ),
        ),
    ),
    Mutasyon(
        # M27 tek başına yakalanmadı: uçuş-içi advisory kilidi ikinci worker'ı
        # zaten dışarıda tutuyor. M27b ikisini birden söker.
        "M27b", "İP2A-06: retry claim'i VE advisory nöbeti birlikte sökülü",
        "backend/services/escrow_reconciler.py",
        """    if not await escrow.try_inflight_lock(db, spec, row_id):
        logger.info(
            "reconciler: %s#%s başkası tarafından işleniyor — bu tur atlandı",
            model.__name__, row_id,
        )
        return False""",
        """    if False:  # MUTASYON: nöbet yok
        return False""",
        ("tests/integration/test_ip2a_races_pg.py",),
        "backend",
        (
            (
                "backend/services/escrow_reconciler.py",
                "        extra_where=(model.refund_requested_at <= now - min_age,),",
                "        # MUTASYON: karantina claim'e girmiyor",
            ),
        ),
    ),
    Mutasyon(
        # M27/M27b/M27c yakalanmadı ve sebebi ölçüldü: iki worker'a karşı asıl
        # nöbeti `escrow.perform_refund`'un KENDİSİ tutuyor — advisory kilidi
        # sağlayıcı çağrısı boyunca elinde tutar ve kilidi aldıktan sonra TAZE
        # durumu yeniden okur, yani bekleyen worker kaydın artık REFUNDING
        # olmadığını görüp sağlayıcıya HİÇ gitmez. Reconciler'ın kendi ön
        # nöbeti ve karantina koşulu bunun ÜSTÜNE binen katmanlardır.
        # M27d merkezî nöbeti söker: iki-worker nöbetçisinin dişi budur.
        "M27d", "İP2A-06: perform_refund'un kilit + taze durum nöbeti sökülü",
        "backend/services/escrow.py",
        """    await acquire_inflight_lock(db, spec, obj.id)
    taze = await current_status(db, obj, spec)
    if taze is not None and _durum_degeri(taze) != _durum_degeri(spec.refunding):""",
        """    taze = None  # MUTASYON: kilit yok, taze durum okunmuyor
    if False:""",
        ("tests/integration/test_ip2a_races_pg.py",),
        "backend",
        (
            (
                "backend/services/escrow_reconciler.py",
                """    if not await escrow.try_inflight_lock(db, spec, row_id):
        logger.info(
            "reconciler: %s#%s başkası tarafından işleniyor — bu tur atlandı",
            model.__name__, row_id,
        )
        return False""",
                """    if False:  # MUTASYON: reconciler ön nöbeti de yok
        return False""",
            ),
            (
                "backend/services/escrow_reconciler.py",
                "        extra_where=(model.refund_requested_at <= now - min_age,),",
                "        # MUTASYON: karantina claim'e girmiyor",
            ),
        ),
    ),
    Mutasyon(
        "M25", "İP2A-02: talebin provider_ref'i yazılmıyor",
        "backend/services/order_service.py",
        """        provider_ref=order.provider_ref,
        extra_values={"refund_amount": odenebilir},""",
        """        extra_values={"refund_amount": odenebilir},  # MUTASYON: ref yok""",
        (
            "tests/integration/test_ip2a_refund_two_phase_pg.py",
            "tests/integration/test_ip2a_admin_http_pg.py",
        ),
    ),
    Mutasyon(
        "M26", "İP2A-01: reconciler final telafileri atlanıyor",
        "backend/services/escrow_reconciler.py",
        """    await _telafileri_tamamla(db, obj, kaynak="retry")
    return True""",
        """    return True  # MUTASYON: para döndü, telafi kuyruğu koşmadı""",
        ("tests/integration/test_ip2a_refund_two_phase_pg.py",),
    ),
    Mutasyon(
        "M27", "İP2A-06: reconciler retry claim'i ikinci worker'a açıldı",
        "backend/services/escrow_reconciler.py",
        """        extra_where=(model.refund_requested_at <= now - min_age,),""",
        """        extra_where=(),  # MUTASYON: karantina claim'e girmiyor""",
        ("tests/integration/test_ip2a_races_pg.py",),
    ),
    Mutasyon(
        "M28", "İP2A-06: uçuş-içi advisory nöbeti kaldırıldı",
        "backend/services/escrow_reconciler.py",
        """    if not await escrow.try_inflight_lock(db, spec, row_id):""",
        """    if False:  # MUTASYON: canlı istekle yarışmaya açık""",
        ("tests/integration/test_ip2a_races_pg.py",),
    ),
    Mutasyon(
        "M29", "İP2A-05: tam iade hesabı yalnız SEÇİLEN satırlara indirildi",
        "backend/services/order_service.py",
        """    is_full = returns.covers_whole_order(
        remaining_by_item=kalan_by_item, selection_by_item=secim_by_item
    )""",
        """    is_full = returns.is_full_return(  # MUTASYON: sipariş kapsamı yok
        [
            {"quantity": secim_by_item[i], "refund_quantity": secim_by_item[i]}
            for i in secim_by_item
        ]
    )""",
        ("tests/integration/test_ip2a_partial_math_pg.py",),
    ),
    Mutasyon(
        "M30", "İP2A-14: yuvarlama artığının dağıtımı kaldırıldı",
        "backend/services/returns.py",
        """    for _, i in sorted(artik, key=lambda t: (-t[0], t[1]))[: max(kalan_kurus, 0)]:
        taban[i] += CENT""",
        """    pass  # MUTASYON: artık kuruşlar hiçbir satıra atanmıyor""",
        ("tests/integration/test_ip2a_partial_math_pg.py",),
    ),
    Mutasyon(
        "M31", "PK-α: fiziksel kabul olmadan para yolunda stok geri ekleniyor",
        "backend/services/order_service.py",
        """    await settle_completed_return(db, ret, changed_by=str(changed_by_of(actor)))""",
        """    for _ri in await _return_lines(db, ret.id):  # MUTASYON: kabulsüz stok
        _ri.accepted_quantity = int(_ri.quantity)
    await db.flush()
    await _restock_items(db, order, ret)
    await settle_completed_return(db, ret, changed_by=str(changed_by_of(actor)))""",
        (
            "tests/integration/test_ip2a_restock_pg.py",
            "tests/integration/test_ip2a_admin_http_pg.py",
        ),
    ),
    Mutasyon(
        # NOT: bu mutasyonun TEK BAŞINA yakalanmaması BEKLENİR ve doğrudur —
        # tarihsel M3/M3′ ile aynı desen. İkinci bağımsız koruma (kilit
        # altındaki `restored_quantity_by_order_item` tavanı) davranışı korur,
        # yani anahtar bozulsa bile stok satılandan fazla artmaz. Davranışın
        # gerçekten bozulduğu hâl M32b'dir.
        "M32", "PK-α: fiziksel kabul idempotency anahtarı çağrıya özgü yapıldı",
        "backend/services/order_service.py",
        """                "idempotency_key": stock_ledger.idempotency_key_for(
                    stock_ledger.StockMovementType.RETURN, return_item_id=ri.id
                ),""",
        """                "idempotency_key": (  # MUTASYON: replay engeli yok
                    f"return_line:{ri.id}:RETURN:{id(ri)}"
                ),""",
        ("tests/integration/test_ip2a_restock_pg.py",),
    ),
    Mutasyon(
        "M32b", "PK-α: kabul anahtarı VE fazla geri yükleme tavanı birlikte bozuldu",
        "backend/services/order_service.py",
        """    for ri, item, gelen in lines:
        tavan = int(item.quantity) - int(geri_yuklenen.get(item.id, 0))
        adet = min(gelen, max(tavan, 0))""",
        """    for ri, item, gelen in lines:  # MUTASYON: tavan yok + anahtar tekil değil
        adet = gelen
        specs.append(
            {
                "product_id": item.product_id,
                "qty_delta": adet,
                "bucket": stock_ledger.StockBucket.SALEABLE,
                "movement_type": stock_ledger.StockMovementType.RETURN,
                "reason_code": "RETURN_ACCEPTED",
                "ref_type": "order_return",
                "ref_id": ret.id,
                "ref_line_id": ri.id,
                "idempotency_key": f"return_line:{ri.id}:RETURN:{id(ri)}",
                "note": None,
            }
        )
        continue
        tavan = 0""",
        ("tests/integration/test_ip2a_restock_pg.py",),
    ),
    Mutasyon(
        "M33", "PK-δ: retry tavanında MANUAL_REVIEW yerine REFUNDING bırakılıyor",
        "backend/services/escrow_reconciler.py",
        """        if await escrow.mark_manual_review(db, obj, spec):
            await _manual_review_audit(db, obj, spec)
            return True
        return False""",
        """        return False  # MUTASYON: kayıt sessizce REFUNDING'de bırakılıyor""",
        ("tests/integration/test_ip2a_refund_two_phase_pg.py",),
    ),
    Mutasyon(
        "M34", "PK-δ: MANUAL_REVIEW kaydı otomatik retry'a yeniden dahil edildi",
        "backend/services/escrow_reconciler.py",
        """        conditions = [status_col == spec.refunding]""",
        """        conditions = [  # MUTASYON: askıya alınan kayıt yine taranıyor
            status_col.in_(
                [spec.refunding]
                + ([spec.manual_review] if spec.manual_review else [])
            )
        ]""",
        ("tests/integration/test_ip2a_refund_two_phase_pg.py",),
    ),
    Mutasyon(
        "M35", "İP2A-18: para emri sonrası ORM ilişkisine (lazy-load) dönülüyor",
        "backend/services/order_service.py",
        """    for ri in await _return_lines(db, ret.id):
        item = by_id.get(ri.order_item_id)
        if item is None or item.kind != ProductKind.PHYSICAL.value:""",
        """    for ri in ret.items:  # MUTASYON: expire koleksiyon → MissingGreenlet
        item = by_id.get(ri.order_item_id)
        if item is None or item.kind != ProductKind.PHYSICAL.value:""",
        ("tests/integration/test_ip2a_restock_pg.py",),
    ),
    Mutasyon(
        "M36", "M2: sağlayıcı reddettiği hâlde iade kesinleşmiş sayılıyor (RMA)",
        "backend/services/order_service.py",
        """    if not await escrow.perform_refund(
        db, ret, escrow.RETURN_SPEC, amount=odenebilir
    ):""",
        """    await escrow.perform_refund(db, ret, escrow.RETURN_SPEC, amount=odenebilir)
    if False:  # MUTASYON: başarısızlık yutuldu""",
        ("tests/integration/test_ip2a_refund_two_phase_pg.py",),
    ),
    Mutasyon(
        "M37", "İP2A-08: karar audit'i kararla aynı transaction'dan çıkarıldı",
        "backend/services/order_service.py",
        """    # ── 3. Audit (kararla aynı transaction) ──
    await _audit_return(
        db, actor=actor, action="return.approve", ret=ret, order=order,
        amount=odenebilir, reason=admin_note, extra={"para_hareketi": True},
    )""",
        """    pass  # MUTASYON: para hareketi başlatan karar izsiz""",
        ("tests/integration/test_ip2a_admin_http_pg.py",),
    ),
    Mutasyon(
        "M38", "İP2A-07/D1: talep durumu koşulsuz APPROVED yazılıyor",
        "backend/services/order_service.py",
        """    if not await escrow.claim(
        db,
        OrderReturn,
        ret.id,
        from_statuses=[ReturnStatus.PENDING.value],
        values={
            "status": ReturnStatus.APPROVED.value,
            "admin_note": admin_note,
            "resolved_at": _now(),
        },
        status_attr="status",
    ):
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu talep zaten sonuçlandırılmış"
        )""",
        """    ret.status = ReturnStatus.APPROVED.value  # MUTASYON: claim yok
    ret.admin_note = admin_note
    ret.resolved_at = _now()
    await db.flush()""",
        ("tests/integration/test_ip2a_races_pg.py",),
    ),
    # ── İP-1b · kütüphane kolu kontenjan / canlılık / bilet kodu / claim ────
    #
    # NOT: iki koruma DB DDL'inde yaşar (`ex_study_res_client_no_overlap` ve
    # bilet kodu unique index'leri) ve dosya yamasıyla sökülemez — model
    # dosyasını değiştirmek zaten uygulanmış bir migration'ı geri almaz. Onların
    # provası ayrı yapılır: `scripts/ip1b_ddl_drill.py`.
    Mutasyon(
        "M39", "İP1B K-1: oturum kontenjan kilidi kaldırıldı (check-then-act geri döndü)",
        "backend/services/library_exam_service.py",
        """    await library_capacity.lock_exam_session(db, s.id)

    existing = (""",
        """    pass  # MUTASYON: kontenjan serileştirmesi yok

    existing = (""",
        ("tests/integration/test_ip1b_kontenjan_pg.py",),
    ),
    Mutasyon(
        "M40", "İP1B K-2: ödeme bekleyen tutma koltuk tutmuyor",
        "backend/services/library_capacity.py",
        """    return or_(
        model.status.in_(ACTIVE_REGISTRATION_STATUSES),
        and_(
            model.status == RegistrationStatus.PENDING_PAYMENT.value,
            model.hold_expires_at.isnot(None),
            model.hold_expires_at > func.now(),
        ),
    )""",
        """    return model.status.in_(ACTIVE_REGISTRATION_STATUSES)  # MUTASYON: tutma yok""",
        ("tests/integration/test_ip1b_kontenjan_pg.py",),
    ),
    Mutasyon(
        "M41", "İP1B K-3/K-5: pay() kontenjanı hiç görmüyor",
        "backend/services/library_exam_service.py",
        """    dolu = await library_capacity.count_exam_seats(db, s.id, exclude_id=reg.id)
    if dolu >= s.capacity:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Oturum kontenjanı doldu; ödeme alınamadı.",
        )""",
        """    pass  # MUTASYON: ödeme yolunda kontenjan kontrolü yok""",
        ("tests/integration/test_ip1b_kontenjan_pg.py",),
    ),
    Mutasyon(
        "M42", "İP1B K-6: çalışma alanı kapasite kilidi kaldırıldı",
        "backend/services/study_reservation_service.py",
        """    await library_capacity.lock_library(db, library_id)

    # Öğrencinin bu pencereyle çakışan ÖDENMEMİŞ (askıda) holdlerini iptal et""",
        """    pass  # MUTASYON: kapasite serileştirmesi yok

    # Öğrencinin bu pencereyle çakışan ÖDENMEMİŞ (askıda) holdlerini iptal et""",
        ("tests/integration/test_ip1b_kontenjan_pg.py",),
    ),
    Mutasyon(
        "M43", "İP1B S-1: register'da kütüphane canlılık kontrolü yok",
        "backend/services/library_exam_service.py",
        """    s = await _get_session_or_404(db, session_id)
    lib = await _require_live_library(db, s.library_id)""",
        """    s = await _get_session_or_404(db, session_id)
    lib = await db.get(Library, s.library_id)  # MUTASYON: canlılık kapısı yok""",
        ("tests/integration/test_ip1b_canlilik_pg.py",),
    ),
    Mutasyon(
        "M44", "İP1B D-1: kütüphane silme emanet guard'ı kaldırıldı",
        "backend/services/library_service.py",
        """    engel = await _silmeyi_engelleyen(db, lib_id)
    if engel is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Kütüphane silinemez: {engel}."
        )""",
        """    pass  # MUTASYON: açık emanet kontrolü yok""",
        ("tests/integration/test_ip1b_silme_guard_pg.py",),
    ),
    Mutasyon(
        "M45", "İP1B C-2: QR token üreticisi çakışmayı aramıyor",
        "backend/services/library_capacity.py",
        """    for _ in range(_MAX_DENEME):
        token = codes.gen_qr_token()
        if not await _kod_kullanimda(db, "qr_token", token):
            return token
    raise RuntimeError("benzersiz QR token üretilemedi")""",
        """    return codes.gen_qr_token()  # MUTASYON: tekillik aranmıyor""",
        ("tests/integration/test_ip1b_bilet_kodu_pg.py",),
    ),
    Mutasyon(
        "M46", "İP1B P-1/P-2: uçuş-içi nöbeti kaldırıldı (çift tahsilat serbest)",
        "backend/services/library_exam_service.py",
        """    if not await escrow.try_inflight_lock(db, escrow.EXAM_SPEC, reg.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu kayıt için bir ödeme işlemi zaten sürüyor."
        )""",
        """    pass  # MUTASYON: aynı kayda eşzamanlı ikinci tahsilat serbest""",
        ("tests/integration/test_ip1b_pay_claim_pg.py",),
        ek=(
            (
                "backend/services/study_reservation_service.py",
                """    if not await escrow.try_inflight_lock(db, escrow.STUDY_SPEC, res.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu rezervasyon için bir ödeme işlemi zaten sürüyor.",
        )""",
                """    pass  # MUTASYON: aynı rezervasyona eşzamanlı ikinci tahsilat serbest""",
            ),
        ),
    ),

    # ══════════════════ İP-5 · KDV ve fatura (dokuz mutasyon) ══════════════════
    #
    # Ortak not: hepsi ÜRÜN kodunu bozar, test kodunu değil. Bir mutasyon
    # testin kendi beklentisini gevşetiyorsa hiçbir şey kanıtlamaz.
    Mutasyon(
        "P1", "IP5: tax_rate şema doğrulaması kaldırıldı (varsayılan 0 geri geldi)",
        "backend/schemas/store.py",
        """    tax_rate: Decimal = Field(**_TAX_RATE_FIELD_ARGS)
    stock: int | None = Field(default=None, ge=0)""",
        """    tax_rate: Decimal = Field(default=Decimal("0"))  # MUTASYON: sinir + zorunluluk yok
    stock: int | None = Field(default=None, ge=0)""",
        ("tests/integration/test_ip5_tax_writer_pg.py",),
    ),
    Mutasyon(
        "P2", "IP5: siparişe vergi kırılımı yazılmıyor (totals_by_rate bağlantısı kesildi)",
        "backend/services/order_service.py",
        """        net_total=kdv.net_total,
        tax_total=kdv.tax_total,
        tax_breakdown=tax.breakdown_to_json(kdv.breakdown),""",
        """        net_total=None,  # MUTASYON: kirilim saklanmiyor
        tax_total=None,
        tax_breakdown=None,""",
        ("tests/integration/test_ip5_tax_math_pg.py",),
    ),
    Mutasyon(
        "P3", "IP5: kuruş artığı dağıtımı kaldırıldı (bağımsız orantısal yuvarlama)",
        "backend/services/tax.py",
        "    shares = allocate_discount_shares(grosses, Decimal(str(discount or 0)))",
        """    # MUTASYON: en-buyuk-artik yerine bagimsiz yuvarlama
    _toplam = sum(grosses, Decimal("0")) or Decimal("1")
    shares = [
        _q(Decimal(str(discount or 0)) * g / _toplam) for g in grosses
    ]""",
        ("tests/integration/test_ip5_tax_math_pg.py",),
    ),
    Mutasyon(
        "P4", "IP5: fatura kırılımı saklanandan değil ANLIK hesaplanıyor",
        "backend/services/invoice_service.py",
        """        "tax_lines": [
            {"rate": s["rate"], "base": str(s["base"]), "tax": str(s["tax"])}
            for s in order.tax_breakdown
        ],""",
        """        # MUTASYON: saklanan kirilim yerine urunun GUNCEL orani
        "tax_lines": [
            {
                "rate": tax.rate_key(_p.tax_rate if _p is not None else 0),
                "base": str(
                    (Decimal(str(it.unit_price)) * it.quantity)
                    - tax.tax_from_gross(
                        Decimal(str(it.unit_price)) * it.quantity,
                        Decimal(str((_p.tax_rate if _p is not None else 0) or 0)),
                    )
                ),
                "tax": str(
                    tax.tax_from_gross(
                        Decimal(str(it.unit_price)) * it.quantity,
                        Decimal(str((_p.tax_rate if _p is not None else 0) or 0)),
                    )
                ),
            }
            for it in order.items
            for _p in [
                (
                    await db.execute(
                        text("SELECT tax_rate FROM products WHERE id = :i"),
                        {"i": it.product_id},
                    )
                ).first()
            ]
        ],""",
        ("tests/integration/test_ip5_tax_math_pg.py::test_m6_saklanan_kirilim_urun_oranindan_bagimsiz",
         "tests/integration/test_ip5_invoice_pg.py::test_f4_kirilim_dbdeki_degerlerle_ayni"),
    ),
    Mutasyon(
        "P5", "IP5: fatura sahiplik kontrolü kaldırıldı (IDOR)",
        "backend/services/invoice_service.py",
        """                Order.id == order_id,
                # Sahiplik SORGUDA: "yok" ile "senin değil" ayırt edilemez
                # (İP-2a/İP-3 IDOR deseni).
                Order.client_id == client_id,""",
        """                Order.id == order_id,
                # MUTASYON: sahiplik kosulu kaldirildi""",
        ("tests/integration/test_ip5_invoice_pg.py",),
    ),
    Mutasyon(
        "P6", "IP5: kısmi iadede orantı kaldırıldı (tüm kırılım geri döndürülüyor)",
        "backend/services/invoice_service.py",
        "    if iade_edilen > 0 and rma_toplami <= 0:",
        "    if iade_edilen > 0:  # MUTASYON: RMA olsa da tam kirilim donduruluyor",
        ("tests/integration/test_ip5_tax_math_pg.py",),
    ),
    Mutasyon(
        "P7", "IP5: oversell iadesi merkezi hattan çıkarıldı (TB-15(a) geri geldi)",
        "backend/services/order_service.py",
        """    if not await reserve_refund(db, order, tutar):
        logger.error(
            "order %s: oversell iadesi için tavan rezerve edilemedi "
            "(total=%s, rezerve=%s) — para hareketi yapılmadı, elle inceleyin",
            order.id, order.total, order.refund_reserved,
        )
        return
    if not await escrow.begin_refund(""",
        """    if not await escrow.begin_refund(  # MUTASYON: tavan kapisi atlandi""",
        ("tests/integration/test_ip5_oversell_refund_pg.py",),
        ek=(
            (
                "backend/services/order_service.py",
                """        await settle_refunded_order(
            db,
            order,
            amount=tutar,
            reason_code="ORDER_CANCELLED",
            terminal_status="CANCELLED",
            changed_by=OVERSELL_AKTORU,
            reason="Stok yetersiz: " + ", ".join(shortages),
            # Bu sipariş hiç PAID olmadı; `SALE` yazılmadığı için geri
            # yüklenecek bir şey de yok (TB-15(a)/3).
            restock=False,
        )""",
                """        # MUTASYON: ortak telafi kuyrugu atlandi, elle FSM gecisi
        await order_fsm.transition_order(
            db,
            order,
            "CANCELLED",
            changed_by="system:oversell",
            reason="Stok yetersiz: " + ", ".join(shortages),
        )""",
            ),
        ),
    ),
    Mutasyon(
        "P8", "IP5: 'oversell iptalinde restock yok' koşulu kaldırıldı",
        "backend/services/order_service.py",
        """    if await _oversell_iptali_mi(db, order):""",
        """    if False:  # MUTASYON: oversell ayrimi kaldirildi""",
        ("tests/integration/test_ip5_oversell_refund_pg.py",),
        ek=(
            # Koruma İKİ katmanlı (canlı çağrıda parametre, reconciler'da iz).
            # Tek katmanı sökmek davranışı bozmaz — mutasyon "yakalanmadı"
            # görünür ama testler kusursuz da olabilir. Gerçek soru
            # "bu guard'lar TOPLUCA vazgeçilebilir mi?" olduğu için ikisi
            # birlikte sökülür.
            (
                "backend/services/order_service.py",
                """            # Bu sipariş hiç PAID olmadı; `SALE` yazılmadığı için geri
            # yüklenecek bir şey de yok (TB-15(a)/3).
            restock=False,""",
                """            restock=True,  # MUTASYON: acik parametre de kaldirildi""",
            ),
        ),
    ),
    Mutasyon(
        "PR1", "presence: flush SQL'indeki CAST'ler kaldırıldı",
        "backend/core/presence.py",
        """            "FROM (VALUES (CAST(:id AS INTEGER), CAST(:ts AS BIGINT))) AS v(id, ts) "
            "WHERE t.id = v.id\"""",
        """            "FROM (VALUES (:id, :ts)) AS v(id, ts) WHERE t.id = v.id"  # MUTASYON""",
        ("tests/integration/test_presence_flush_pg.py",),
    ),
    Mutasyon(
        "PR2", "presence: tablo adı allowlist'i kaldırıldı",
        "backend/core/presence.py",
        """    if not sep or table not in _FLUSHABLE_TABLES:""",
        """    if not sep:  # MUTASYON: Redis'ten gelen tablo adi dogrudan SQL'e giriyor""",
        ("tests/integration/test_presence_flush_pg.py",),
    ),
    Mutasyon(
        "PR3", "presence: kuyruk temizligi degeri karsilastirmadan DEL'e dondu",
        "backend/core/presence.py",
        "    await _kuyruktan_dus(r, list(pending.items()))",
        "    await r.delete(_DIRTY_KEY)  # MUTASYON: hgetall + DEL yarisi",
        ("tests/integration/test_presence_flush_pg.py",),
    ),
    Mutasyon(
        "PR4", "presence: kuyruk tavani alarmi kaldirildi",
        "backend/core/presence.py",
        "    _uyar_kuyruk_sismis(len(pending))",
        "    pass  # MUTASYON: kuyruk sismesi sessiz",
        ("tests/integration/test_presence_flush_pg.py",),
    ),
    Mutasyon(
        "P9", "IP5: kök conftest PAYMENT_PROVIDER satırı kaldırıldı (TB-21)",
        "backend/conftest.py",
        'os.environ.setdefault("PAYMENT_PROVIDER", "fake")',
        '# MUTASYON: setdefault kaldirildi (.env sizabilir)',
        ("tests/integration/test_ip5_provider_guard_pg.py",),
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
