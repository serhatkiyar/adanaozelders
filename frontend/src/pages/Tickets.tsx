import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import {
  useCancelRegistration,
  useMyRegistrations,
  usePayRegistration,
} from "@/hooks/useLibraryExams";
import {
  useCancelStudy,
  useMyStudyReservations,
  usePayStudy,
} from "@/hooks/useStudy";
import { formatTRY } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROUTES } from "@/lib/routes";
import type {
  RegistrationOut,
  RegistrationStatus,
  StudyReservationOut,
} from "@/types";

/* Navbar'daki "Kütüphaneler" ikonu (Heroicons building-library). */
function LibraryIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z"
      />
    </svg>
  );
}

/* Mor bilet üzerinde okunaklı durum rozetleri (cam efektli, ince ring). */
const STATUS_PILL: Record<RegistrationStatus, { label: string; cls: string }> = {
  PENDING_PAYMENT: {
    label: "Ödeme bekliyor",
    cls: "bg-amber-300/20 text-amber-100 ring-1 ring-inset ring-amber-200/30",
  },
  PAID: {
    label: "Bilet hazır",
    cls: "bg-emerald-300/20 text-emerald-50 ring-1 ring-inset ring-emerald-200/30",
  },
  ATTENDED: {
    label: "Katıldın ✓",
    cls: "bg-emerald-300/25 text-white ring-1 ring-inset ring-emerald-200/40",
  },
  CANCELLED: {
    label: "İptal",
    cls: "bg-white/10 text-violet-200 ring-1 ring-inset ring-white/15",
  },
  REFUNDED: {
    label: "İade edildi",
    cls: "bg-white/10 text-violet-200 ring-1 ring-inset ring-white/15",
  },
};

const PREVIEW_COUNT = 3; // bölüm başına ön gösterim; fazlası "daha fazla göster" ile açılır

export default function Tickets() {
  const { data, isLoading } = useMyRegistrations();
  const { data: studyRes, isLoading: studyLoading } = useMyStudyReservations();
  const hasExam = data && data.length > 0;
  const hasStudy = studyRes && studyRes.length > 0;
  const [showAllExam, setShowAllExam] = useState(false);
  const [showAllStudy, setShowAllStudy] = useState(false);

  return (
    <DashboardShell title="Biletlerim" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Biletlerim & Rezervasyonlarım
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Deneme oturumları ve çalışma alanı girişlerinde QR kodunu okutarak doğrula.
          </p>
        </div>

        {isLoading || studyLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : !hasExam && !hasStudy ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
            <div className="text-4xl">🎟️</div>
            <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              Henüz bilet veya rezervasyon yok
            </p>
            <Link
              to={ROUTES.libraries}
              className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Kütüphaneleri keşfet
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-x-6 gap-y-10 lg:grid-cols-2">
            {hasExam && (
              <section className="space-y-4">
                <h2 className="text-center text-xl font-extrabold text-slate-900 dark:text-white sm:text-2xl">
                  Deneme Biletleri
                </h2>
                {(showAllExam ? data! : data!.slice(0, PREVIEW_COUNT)).map((r) => (
                  <TicketCard key={r.id} reg={r} />
                ))}
                {data!.length > PREVIEW_COUNT && (
                  <MoreToggle
                    expanded={showAllExam}
                    hidden={data!.length - PREVIEW_COUNT}
                    onToggle={() => setShowAllExam((v) => !v)}
                  />
                )}
              </section>
            )}
            {hasStudy && (
              <section className="space-y-4">
                <h2 className="text-center text-xl font-extrabold text-slate-900 dark:text-white sm:text-2xl">
                  Çalışma Alanı Biletleri
                </h2>
                {(showAllStudy ? studyRes! : studyRes!.slice(0, PREVIEW_COUNT)).map((r) => (
                  <StudyReservationCard key={r.id} res={r} />
                ))}
                {studyRes!.length > PREVIEW_COUNT && (
                  <MoreToggle
                    expanded={showAllStudy}
                    hidden={studyRes!.length - PREVIEW_COUNT}
                    onToggle={() => setShowAllStudy((v) => !v)}
                  />
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

/* Bölüm "daha fazla / daha az" küçük geçişi. */
function MoreToggle({
  expanded,
  hidden,
  onToggle,
}: {
  expanded: boolean;
  hidden: number;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="mx-auto flex items-center gap-1 pt-1 text-sm font-semibold text-indigo-600 transition hover:text-indigo-700 hover:underline dark:text-indigo-300"
    >
      {expanded ? "Daha az göster" : `${hidden} bilet daha göster`}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}

/* ── Mor bilet çerçevesi ──
 * Yalnız dikey kenarlarda perforaj "ısırık" (mask + composite intersect); üst/alt
 * düz. ATTENDED'da biletin üzerine eğik "Kullanıldı" damgası basılır (thump).
 * Kupon koparılmaz/kaymaz; yerinde durur. */

const SIDE_BITES: CSSProperties = {
  WebkitMask:
    "radial-gradient(7px at 0 50%,#0000 98%,#000) repeat-y 0 50%/100% 20px," +
    "radial-gradient(7px at 100% 50%,#0000 98%,#000) repeat-y 100% 50%/100% 20px",
  mask:
    "radial-gradient(7px at 0 50%,#0000 98%,#000) repeat-y 0 50%/100% 20px," +
    "radial-gradient(7px at 100% 50%,#0000 98%,#000) repeat-y 100% 50%/100% 20px",
  WebkitMaskComposite: "source-in",
  maskComposite: "intersect",
};

const PURPLE_STYLE: CSSProperties = {
  backgroundColor: "#5b21b6",
  backgroundImage:
    "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.16) 1.5px, transparent 0), linear-gradient(135deg, #7c3aed 0%, #5b21b6 55%, #4c1d95 100%)",
  backgroundSize: "16px 16px, 100% 100%",
};

function TicketFrame({
  isUsed,
  usedAt,
  main,
  stub,
}: {
  isUsed: boolean;
  usedAt?: string | null;
  main: ReactNode;
  stub: ReactNode;
}) {
  // Damga "basılır" (thump): büyükten normale oturur — geçişin çalışması için gecikmeli tetik.
  const [stamped, setStamped] = useState(isUsed);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(timer.current);
    if (isUsed) {
      timer.current = setTimeout(() => setStamped(true), 120);
    } else {
      setStamped(false);
    }
    return () => clearTimeout(timer.current);
  }, [isUsed]);

  return (
    <div style={{ filter: "drop-shadow(0 12px 16px rgba(76,29,149,0.25))" }}>
      <div
        style={{ ...SIDE_BITES, ...PURPLE_STYLE }}
        className="relative flex min-h-[11.5rem] w-full text-violet-50"
      >
        {/* Ana parça */}
        <div className="relative flex min-w-0 flex-1 flex-col p-5">{main}</div>

        {/* İç dikey perforaj */}
        <div
          className="w-[2px] shrink-0"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.5) 1.5px, transparent 1.8px)",
            backgroundSize: "100% 11px",
            backgroundRepeat: "repeat-y",
            backgroundPosition: "center",
          }}
        />

        {/* Kupon (stub) */}
        {stub}

        {/* "Kullanıldı" damgası */}
        {isUsed && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <div
              className={`select-none rounded-xl border-4 border-amber-300/90 px-6 py-2.5 text-center font-black uppercase leading-none tracking-[0.15em] text-amber-200 shadow-sm transition-all duration-300 ease-out ${
                stamped ? "rotate-[-14deg] scale-100 opacity-90" : "rotate-[-14deg] scale-[1.8] opacity-0"
              }`}
              style={{ textShadow: "0 1px 0 rgba(255,255,255,0.15)" }}
            >
              <span className="block text-2xl">Kullanıldı</span>
              <span className="mt-1 block whitespace-nowrap text-[10px] font-bold tracking-wide opacity-80">
                {usedAt ? formatDateTime(usedAt) : "giriş onaylandı"}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* QR kuponu (PAID/ATTENDED) — tıklayınca kod modalı açar. Aksi halde kilit placeholder. */
function TicketStub({
  qrToken,
  shortCode,
  regId,
  onShow,
}: {
  qrToken?: string | null;
  shortCode?: string | null;
  regId: number;
  onShow: () => void;
}) {
  if (qrToken) {
    const code = shortCode ?? `${regId}`;
    const pretty = code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
    return (
      <button
        type="button"
        onClick={onShow}
        className="group flex w-[8.75rem] shrink-0 flex-col items-center justify-center px-4 py-4 text-center outline-none"
        aria-label="QR ve giriş kodunu büyüt"
      >
        <div className="w-[6.5rem]">
          <div className="mx-auto w-fit rounded-md bg-white p-1.5 ring-1 ring-white/10 transition group-hover:ring-2 group-hover:ring-amber-300">
            <QRCodeSVG value={`${regId}:${qrToken}`} size={80} level="M" />
          </div>
          <div className="mt-2 font-mono text-base font-bold tracking-widest text-white">{pretty}</div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-200/70 group-hover:text-white">
            Büyütmek için dokun
          </div>
        </div>
      </button>
    );
  }
  return (
    <div className="flex w-[8.75rem] shrink-0 flex-col items-center justify-center gap-1.5 px-4 py-4 text-center">
      <div className="text-2xl opacity-70">🔒</div>
      <div className="text-[11px] font-medium leading-tight text-violet-200/80">
        Ödeme sonrası QR oluşur
      </div>
    </div>
  );
}

/* Mor bilet üzerinde aksiyon butonları. */
const PAY_BTN =
  "rounded-lg bg-amber-300 px-4 py-2 text-sm font-bold text-amber-950 transition hover:bg-amber-200 disabled:opacity-60";
const GHOST_BTN =
  "rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60";

function TicketCard({ reg }: { reg: RegistrationOut }) {
  const [showQr, setShowQr] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const pay = usePayRegistration();
  const cancel = useCancelRegistration();
  const pill = STATUS_PILL[reg.status];
  const session = reg.session;
  const isUsed = reg.status === "ATTENDED";

  const doPay = async () => {
    try {
      const result = await pay.mutateAsync(reg.id);
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
        return;
      }
      toast.success("Ödeme alındı! Biletin hazır.");
    } catch (e) {
      toast.error(getErrorMessage(e, "Ödeme başarısız."));
    }
  };

  const doCancel = () => {
    if (!window.confirm("Bu kaydı iptal etmek istiyor musun?")) return;
    cancel.mutate(reg.id, {
      onSuccess: () => toast.success("Kayıt iptal edildi."),
      onError: (e) => toast.error(getErrorMessage(e, "İptal başarısız.")),
    });
  };

  return (
    <div className="mx-auto w-[28rem] max-w-full space-y-2">
      <TicketFrame
        isUsed={isUsed}
        usedAt={reg.attended_at}
        main={
          <>
            <div className="flex flex-wrap items-center gap-2">
              {session && (
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold text-white ring-1 ring-inset ring-white/20">
                  {session.exam_type}
                </span>
              )}
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pill.cls}`}>
                {pill.label}
              </span>
            </div>
            <h3 className="mt-2 text-base font-bold text-white">
              {session?.title ?? "Deneme oturumu"}
            </h3>
            {session && (
              <>
                <p className="mt-1 text-sm text-violet-200/80">
                  🗓️ {formatDateTime(session.starts_at)} · ⏱️ {session.duration_minutes} dk
                </p>
                {session.library_name && (
                  <Link
                    to={ROUTES.library(session.library_slug ?? session.library_id)}
                    className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium text-violet-100 underline-offset-2 hover:text-white hover:underline"
                  >
                    <LibraryIcon className="h-4 w-4 shrink-0 opacity-80" />
                    {session.library_name}
                  </Link>
                )}
              </>
            )}
            <p className="mt-2 text-sm font-bold text-white">{formatTRY(reg.amount)}</p>

            {reg.status === "PENDING_PAYMENT" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={doPay} disabled={pay.isPending} className={PAY_BTN}>
                  {pay.isPending ? "…" : "Ödemeyi tamamla"}
                </button>
                <button onClick={doCancel} disabled={cancel.isPending} className={GHOST_BTN}>
                  İptal
                </button>
              </div>
            )}

            {reg.result_published && (
              <button
                type="button"
                onClick={() => setShowResult(true)}
                className="mt-auto inline-flex items-center gap-1 self-end pt-3 text-sm font-bold text-amber-200 underline-offset-2 transition hover:text-white hover:underline"
              >
                Sınav sonucunu görüntüle
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </button>
            )}
          </>
        }
        stub={
          <TicketStub
            qrToken={reg.qr_token}
            shortCode={reg.short_code}
            regId={reg.id}
            onShow={() => setShowQr(true)}
          />
        }
      />

      {showResult && <ExamResultModal reg={reg} onClose={() => setShowResult(false)} />}

      {showQr && reg.qr_token && (
        <QrModal
          title={session?.title ?? "Deneme bileti"}
          subtitle={session?.library_name ?? undefined}
          value={`${reg.id}:${reg.qr_token}`}
          code={reg.short_code ?? `${reg.id}:${reg.qr_token}`}
          onClose={() => setShowQr(false)}
        />
      )}
    </div>
  );
}

function StudyReservationCard({ res }: { res: StudyReservationOut }) {
  const [showQr, setShowQr] = useState(false);
  const pay = usePayStudy();
  const cancel = useCancelStudy();
  const pill = STATUS_PILL[res.status];
  const isUsed = res.status === "ATTENDED";

  const doPay = async () => {
    try {
      const result = await pay.mutateAsync(res.id);
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
        return;
      }
      toast.success("Ödeme alındı! QR'ın hazır.");
    } catch (e) {
      toast.error(getErrorMessage(e, "Ödeme başarısız."));
    }
  };

  const doCancel = () => {
    if (!window.confirm("Bu rezervasyonu iptal etmek istiyor musun?")) return;
    cancel.mutate(res.id, {
      onSuccess: () => toast.success("Rezervasyon iptal edildi."),
      onError: (e) => toast.error(getErrorMessage(e, "İptal başarısız.")),
    });
  };

  return (
    <div className="mx-auto w-[28rem] max-w-full">
    <TicketFrame
      isUsed={isUsed}
      usedAt={res.attended_at}
      main={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold text-white ring-1 ring-inset ring-white/20">
              Çalışma Alanı
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pill.cls}`}>
              {pill.label}
            </span>
          </div>
          <p className="mt-2 text-base font-bold text-white">
            {formatDateTime(res.starts_at)} – {formatDateTime(res.ends_at)}
          </p>
          {res.library_name && (
            <Link
              to={ROUTES.library(res.library_slug ?? res.library_id)}
              className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium text-violet-100 underline-offset-2 hover:text-white hover:underline"
            >
              <LibraryIcon className="h-4 w-4 shrink-0 opacity-80" />
              {res.library_name}
            </Link>
          )}
          <p className="mt-2 text-sm font-bold text-white">{formatTRY(res.amount)}</p>

          {res.status === "PENDING_PAYMENT" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={doPay} disabled={pay.isPending} className={PAY_BTN}>
                {pay.isPending ? "…" : "Ödemeyi tamamla"}
              </button>
              <button onClick={doCancel} disabled={cancel.isPending} className={GHOST_BTN}>
                İptal
              </button>
            </div>
          )}
        </>
      }
      stub={
        <TicketStub
          qrToken={res.qr_token}
          shortCode={res.short_code}
          regId={res.id}
          onShow={() => setShowQr(true)}
        />
      }
    />

    {/* Modal frame DIŞINDA: TicketFrame'in `filter` (drop-shadow) ataşı, içindeki
        position:fixed öğeyi kapsar → modal bilete sıkışırdı. */}
    {showQr && res.qr_token && (
      <QrModal
        title="Çalışma alanı girişi"
        subtitle={res.library_name ?? undefined}
        value={`${res.id}:${res.qr_token}`}
        code={res.short_code ?? `${res.id}:${res.qr_token}`}
        onClose={() => setShowQr(false)}
      />
    )}
    </div>
  );
}

/* ── Sınav sonucu modalı (biletin sağ-alt linkiyle açılır) ── */

function ExamResultModal({ reg, onClose }: { reg: RegistrationOut; onClose: () => void }) {
  const answerKey = reg.session?.answer_key_url;
  const karne = reg.result_document_url;
  const hasSummary = reg.result_net != null || reg.result_rank != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-700"
          aria-label="Kapat"
        >
          ✕
        </button>

        <h3 className="pr-8 text-lg font-bold text-slate-900 dark:text-white">Sınav Sonucun</h3>
        {reg.session?.title && (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{reg.session.title}</p>
        )}

        {hasSummary && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-indigo-50 p-4 text-center dark:bg-indigo-500/10">
              <div className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-300">
                {reg.result_net ?? "—"}
              </div>
              <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Net
              </div>
            </div>
            <div className="rounded-2xl bg-indigo-50 p-4 text-center dark:bg-indigo-500/10">
              <div className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-300">
                {reg.result_rank ?? "—"}
              </div>
              <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Sıra
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2">
          {karne ? (
            <a
              href={karne}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              📄 Karneyi aç
            </a>
          ) : (
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm font-medium text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
              Karne henüz yüklenmedi
            </div>
          )}
          {answerKey && (
            <a
              href={answerKey}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              🔑 Cevap anahtarı
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── QR + elle girilebilir kod modalı ── */

function QrModal({
  title,
  subtitle,
  value,
  code,
  onClose,
}: {
  title: string;
  subtitle?: string;
  value: string; // QR'a gömülen tam token ("{id}:{token}")
  code: string; // elle girilebilen kısa kod ("8F3K9Q")
  onClose: () => void;
}) {
  // Okunaklı olsun diye 3'erli/4'erli grupla göster (kopyalama ham kodu alır).
  const pretty =
    code.length === 8
      ? `${code.slice(0, 4)} ${code.slice(4)}`
      : code.length === 6
      ? `${code.slice(0, 3)} ${code.slice(3)}`
      : code;
  const copy = () => {
    navigator.clipboard?.writeText(code).then(
      () => toast.success("Kod kopyalandı."),
      () => toast.error("Kopyalanamadı, elle seçin.")
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-700"
          aria-label="Kapat"
        >
          ✕
        </button>

        <h3 className="pr-8 text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <LibraryIcon className="h-4 w-4 shrink-0" />
            {subtitle}
          </p>
        )}

        {/* QR — kontrast için her zaman beyaz zemin */}
        <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <QRCodeSVG value={value} size={216} level="M" />
        </div>

        {/* Elle giriş kodu (QR okutulamazsa) */}
        <p className="mt-5 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
          QR okutulamıyorsa görevliye bu kodu söyleyin:
        </p>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
          <code className="flex-1 select-all text-center font-mono text-3xl font-bold tracking-[0.2em] text-slate-900 dark:text-white">
            {pretty}
          </code>
          <button
            onClick={copy}
            className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
            aria-label="Kodu kopyala"
          >
            Kopyala
          </button>
        </div>
      </div>
    </div>
  );
}
