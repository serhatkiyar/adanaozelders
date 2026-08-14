"""İP-14 mutasyon provası — operatör paneli yüzeyi + denetim izi.

Güvenlik mekanizması `scripts/mutation_drill.py`'den **yeniden kullanılır**
(bayt yedeği + SHA-256 doğrulamalı geri alma, kirli ağaçta reddetme, test-DB
adı kontrolü, mutasyon sonrası HEAD/`git status` eşitliği). Yalnız katalog ve
koşucu ayrıdır; İP-12 paralel çalıştığı için ortak dosyanın kataloğu
büyütülmedi.

## Bu sürücünün ek nöbeti: "0 test seçildi" BAŞARISIZLIKTIR

İP-12'de şu tuzağa düşüldü: mutasyon uygulanır, test komutu **hiçbir testi
seçmez** (yanlış dosya adı / yanlış `-k` deseni), koşu 0 hatayla biter ve
sürücü "yakalanmadı" bile demeden yeşile boyanır. Burada koşulan testlerin
sayısı çıktıdan okunur; sayı sıfırsa mutasyon **BAŞARISIZ** sayılır ve neden
belirtilir.

## Kullanım

    cd backend
    python -m scripts.mutation_drill_ip14 --list
    POSTGRES_DB=adana_ip14_test python -m scripts.mutation_drill_ip14 M-D1
    POSTGRES_DB=adana_ip14_test python -m scripts.mutation_drill_ip14
"""
from __future__ import annotations

import argparse
import contextlib
import re
import subprocess
import sys

from scripts.mutation_drill import (
    BACKEND,
    FRONTEND,
    KOK,
    GeciciYama,
    Mutasyon,
    _agac_durumu,
    _kirilanlar,
    _on_kontrol,
)

FE = "frontend/src"
BE = "backend"


# ══════════════════════ Katalog ══════════════════════

MUTASYONLAR: list[Mutasyon] = [
    # ── FAZ 1: bugün + gruplama + sıralama ────────────────────────────────
    Mutasyon(
        "M-B2", '"Bugün" filtresi kaldırıldı (tümü sayılıyor)',
        f"{FE}/lib/operatorAgenda.ts",
        """  const bugunkuler = kayitlar.filter((k) => {
    const kova = gunKovasi(k, simdi);
    if (kova === "BUGUN") return true;
    // Bugün başlamış ama penceresi kapanmış kayıt: listede değil, sayaçta var.
    return kova === "GECMIS" && istanbulGunAnahtari(k.startsAt) === bugunKey;
  });""",
        "  const bugunkuler = kayitlar;",
        ("src/lib/operatorAgenda.test.ts", "src/pages/dashboards/operatorPanel.acceptance.test.tsx"),
        taraf="frontend",
    ),
    Mutasyon(
        "M-B5", "gün anahtarı Türkiye yerine UTC'den hesaplanıyor",
        f"{FE}/lib/operatorAgenda.ts",
        """const gunBicimi = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",""",
        """const gunBicimi = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",""",
        ("src/lib/operatorAgenda.test.ts", "src/pages/dashboards/operatorPanel.acceptance.test.tsx"),
        taraf="frontend",
    ),
    Mutasyon(
        "M-G1", "gruplama tek grup döndürüyor",
        f"{FE}/lib/operatorAgenda.ts",
        """    const kova = gunKovasi(kayit, simdi);
    if (kova === "GECMIS") continue;""",
        """    const kova = "BUGUN" as GunKovasi;
    if (kova === "GECMIS") continue;""",
        ("src/lib/operatorAgenda.test.ts", "src/pages/dashboards/operatorPanel.acceptance.test.tsx"),
        taraf="frontend",
    ),
    Mutasyon(
        "M-S1", "yönetim listesi eski DESC sıralamasına döndü",
        f"{BE}/services/library_exam_service.py",
        """        .order_by(
            # 1) Gelecek (False=0) önce, geçmiş (True=1) sonra.
            gecmis.asc(),""",
        """        .order_by(
            LibraryExamSession.starts_at.desc(),
            gecmis.asc(),""",
        ("tests/integration/test_ip14_operator_panel_pg.py",),
    ),
    # ── FAZ 2: hata + kesilme dürüstlüğü ──────────────────────────────────
    Mutasyon(
        "M-E1", "Bakiyem'de hata dalı kaldırıldı (hata = boş liste)",
        f"{FE}/pages/Balance.tsx",
        "          ) : txnError ? (",
        "          ) : false ? (",
        ("src/pages/operatorBalance.acceptance.test.tsx",),
        taraf="frontend",
    ),
    Mutasyon(
        "M-E5", "boş durum ile hata durumu AYNI metne bağlandı",
        f"{FE}/components/ExamSessionsManager.tsx",
        """          <ErrorState
            description="Oturum listesi yüklenemedi. Listenin boş olduğu anlamına gelmez — bağlantını kontrol edip yeniden dene."
            onRetry={() => void refetch()}
          />""",
        """          <ErrorState description="Henüz oturum eklenmedi." onRetry={() => void refetch()} />""",
        ("src/pages/dashboards/operatorPanel.acceptance.test.tsx",),
        taraf="frontend",
        # Boş durum metni de aynıya çekilir; tek taraflı değişiklik "farklı
        # metin" iddiasını zaten bozar, asıl soru İKİSİ aynı olursa ne olduğu.
        ek=((
            f"{FE}/components/ExamSessionsManager.tsx",
            """          Henüz oturum eklenmedi.
        </p>""",
            """          Oturum listesi yüklenemedi. Listenin boş olduğu anlamına gelmez — bağlantını kontrol edip yeniden dene.
        </p>""",
        ),),
    ),
    Mutasyon(
        "M-K1", "200 satır tavan uyarısı kaldırıldı",
        f"{FE}/pages/Balance.tsx",
        "          {transactions && kesildiMi(transactions) && (",
        "          {false && transactions && kesildiMi(transactions) && (",
        ("src/pages/operatorBalance.acceptance.test.tsx",),
        taraf="frontend",
    ),
    # ── FAZ 3: onay ────────────────────────────────────────────────────────
    Mutasyon(
        "M-Y3", "ConfirmDialog atlandı, iptal doğrudan mutate ediyor",
        f"{FE}/components/ExamSessionsManager.tsx",
        "                onClick={() => setIptalSoruluyor(true)}",
        "                onClick={doCancel}",
        ("src/pages/dashboards/operatorPanel.acceptance.test.tsx",),
        taraf="frontend",
    ),
    # ── FAZ 4: nav ─────────────────────────────────────────────────────────
    Mutasyon(
        "M-N1", "nav dalı öğrenciye sabitlendi",
        f"{FE}/lib/nav.ts",
        """    case 4:
      return OPERATOR_NAV;""",
        """    case 4:
      return STUDENT_NAV;""",
        ("src/pages/dashboards/operatorPanel.acceptance.test.tsx",),
        taraf="frontend",
    ),
    # ── FAZ 5: denetim izi ─────────────────────────────────────────────────
    Mutasyon(
        "M-D1", "yoklama audit çağrısı kaldırıldı",
        f"{BE}/services/library_exam_service.py",
        """    await operator_audit.kaydet(
        db,
        actor=actor,
        action="exam_attendance.verify",""",
        """    await _atla(
        db,
        actor=actor,
        action="exam_attendance.verify",""",
        ("tests/integration/test_ip14_operator_panel_pg.py",),
        ek=((
            f"{BE}/services/library_exam_service.py",
            "def _now() -> datetime.datetime:",
            "async def _atla(*a, **kw) -> None:\n    return None\n\n\ndef _now() -> datetime.datetime:",
        ),),
    ),
    Mutasyon(
        "M-D2", "oturum iptali audit çağrısı kaldırıldı",
        f"{BE}/services/library_exam_service.py",
        """    await operator_audit.kaydet(
        db,
        actor=actor,
        action="exam_session.cancel",""",
        """    await _atla(
        db,
        actor=actor,
        action="exam_session.cancel",""",
        ("tests/integration/test_ip14_operator_panel_pg.py",),
        ek=((
            f"{BE}/services/library_exam_service.py",
            "def _now() -> datetime.datetime:",
            "async def _atla(*a, **kw) -> None:\n    return None\n\n\ndef _now() -> datetime.datetime:",
        ),),
    ),
    Mutasyon(
        "M-D3", "karne yayınlama audit çağrısı kaldırıldı",
        f"{BE}/services/library_exam_service.py",
        """        await operator_audit.kaydet(
            db,
            actor=actor,
            action="exam_results.publish",""",
        """        await _atla(
            db,
            actor=actor,
            action="exam_results.publish",""",
        ("tests/integration/test_ip14_operator_panel_pg.py",),
        ek=((
            f"{BE}/services/library_exam_service.py",
            "def _now() -> datetime.datetime:",
            "async def _atla(*a, **kw) -> None:\n    return None\n\n\ndef _now() -> datetime.datetime:",
        ),),
    ),
    Mutasyon(
        "M-D4", "audit AYRI transaction'a alındı (aksiyondan bağımsız yazılıyor)",
        f"{BE}/services/library_exam_service.py",
        """async def _attend_exam(
    db: AsyncSession,
    reg: ExamRegistration,
    *,
    operator_library_id: int,
    operator_id: int,
    actor: AuditAktoru | None = None,
) -> AttendanceResult:""",
        """async def _attend_exam(
    db: AsyncSession,
    reg: ExamRegistration,
    *,
    operator_library_id: int,
    operator_id: int,
    actor: AuditAktoru | None = None,
) -> AttendanceResult:
    # MUTASYON: iz, aksiyon daha yapılmadan ve AYRI bir oturumda yazılır.
    if actor is not None:
        from core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as _s:
            await operator_audit.kaydet(
                _s,
                actor=actor,
                action="exam_attendance.verify",
                target_type="exam_registration",
                target_id=reg.id,
            )
            await _s.commit()""",
        ("tests/integration/test_ip14_operator_panel_pg.py",),
    ),
    Mutasyon(
        "M-D5", "actor_role ADMIN olarak yazılıyor",
        f"{BE}/services/operator_audit.py",
        """    await audit_service.record(
        db,
        actor=actor,""",
        """    import dataclasses as _dc

    @_dc.dataclass(frozen=True, slots=True)
    class _SahteAdmin:
        id: int
        role_id: int

    await audit_service.record(
        db,
        actor=_SahteAdmin(id=actor.id, role_id=1),""",
        ("tests/integration/test_ip14_operator_panel_pg.py",),
    ),
]


# ══════════════════════ Koşucu ══════════════════════

#: pytest: "7 passed", "3 failed, 4 passed"; vitest: "Tests  48 passed (48)".
_PYTEST_SAYI = re.compile(r"(\d+) (?:passed|failed|error|skipped)")
_VITEST_SAYI = re.compile(r"Tests\s+.*?\((\d+)\)")


def _secilen_test_sayisi(cikti: str, taraf: str) -> int:
    """Koşuda GERÇEKTEN çalışan test sayısı. 0 ise mutasyon geçersizdir."""
    temiz = re.sub(r"\x1b\[[0-9;]*m", "", cikti)
    if taraf == "backend":
        return sum(int(x) for x in _PYTEST_SAYI.findall(temiz))
    m = _VITEST_SAYI.search(temiz)
    return int(m.group(1)) if m else 0


def _kos(cmd, cwd) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=str(cwd), capture_output=True, text=True,
        encoding="utf-8", errors="replace", shell=isinstance(cmd, str),
    )


def calistir(m: Mutasyon, head0: str, durum0: str) -> bool:
    print(f"\n{'=' * 72}\n{m.no} - {m.ad}\n{'=' * 72}")
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
        kosan = _secilen_test_sayisi(cikti, m.taraf)

    head1, durum1 = _agac_durumu()
    if (head1, durum1) != (head0, durum0):
        print("!!! ÇALIŞMA AĞACI GERİ ALINMADI — DUR !!!")
        raise SystemExit(3)

    if kosan == 0:
        print(
            "!!! GEÇERSİZ PROVA: hiç test koşmadı (0 seçildi). Çıkış kodu 0 "
            "olsa bile bu BAŞARISIZLIKTIR — test yolu/deseni yanlış. !!!"
        )
        return False

    if kirilan:
        print(f"YAKALANDI ({kosan} test koştu). Kırılan testler:")
        for k in kirilan:
            print("   -", k)
        return True

    print(f"!!! YAKALANMADI ({kosan} test koştu) — test boşluğu var !!!")
    son = [x for x in cikti.strip().splitlines() if x.strip()][-1:]
    if son:
        print("   son satır:", son[0].encode("ascii", "replace").decode())
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("hedef", nargs="?", help="tek mutasyon (ör. M-D1)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--allow-dirty", action="store_true")
    a = ap.parse_args()

    if a.list:
        for m in MUTASYONLAR:
            print(f"{m.no:8} [{m.taraf:8}] {m.ad}")
        return 0

    head0, durum0 = _on_kontrol(a.allow_dirty)
    secili = [m for m in MUTASYONLAR if not a.hedef or m.no == a.hedef]
    if not secili:
        print(f"bilinmeyen mutasyon: {a.hedef}")
        return 2

    sonuc = {m.no: calistir(m, head0, durum0) for m in secili}
    print(f"\n{'=' * 72}\nÖZET")
    for no, ok in sonuc.items():
        print(f"  {no:8} {'YAKALANDI' if ok else 'YAKALANMADI'}")
    return 0 if all(sonuc.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
