import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
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
import { PaymentBranchNotice } from "@/components/PaymentBranchNotice";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { isBranchOpen } from "@/lib/paymentAvailability";
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
    cls: "bg-white/10 text-white/80 ring-1 ring-inset ring-white/15",
  },
  REFUNDING: {
    label: "İade ediliyor",
    cls: "bg-amber-300/20 text-amber-100 ring-1 ring-inset ring-amber-200/30",
  },
  REFUNDED: {
    label: "İade edildi",
    cls: "bg-white/10 text-white/80 ring-1 ring-inset ring-white/15",
  },
};

// Geçmiş + okutulmamış (no-show) bilet/rezervasyon için nötr rozet — kart zaten
// gri-tonlandığı için renk soluk görünür.
const EXPIRED_PILL = {
  label: "Süresi doldu",
  cls: "bg-white/10 text-white/80 ring-1 ring-inset ring-white/15",
};

const PREVIEW_COUNT = 3; // bölüm başına ön gösterim; fazlası "daha fazla göster" ile açılır

export function TicketsContent() {
  const { data, isLoading } = useMyRegistrations();
  const { data: studyRes, isLoading: studyLoading } = useMyStudyReservations();
  const hasExam = data && data.length > 0;
  const hasStudy = studyRes && studyRes.length > 0;
  const [showAllExam, setShowAllExam] = useState(false);
  const [showAllStudy, setShowAllStudy] = useState(false);

  if (isLoading || studyLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="mx-auto h-48 w-[28rem] max-w-full animate-pulse rounded-2xl bg-slate-100 "
          />
        ))}
      </div>
    );
  }

  if (!hasExam && !hasStudy) {
    return <EmptyTickets />;
  }

  return (
    <div className="grid grid-cols-1 items-start gap-x-6 gap-y-10 lg:grid-cols-2">
      {hasExam && (
        <section className="space-y-4">
          <TicketSectionHeader title="Deneme biletleri" count={data!.length} />
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
          <TicketSectionHeader title="Çalışma alanı" count={studyRes!.length} />
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
  );
}

/* Bölüm başlığı — bilet kartının sol kenarına hizalı, sakin. */
function TicketSectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="mx-auto flex w-[28rem] max-w-full items-baseline gap-2">
      <h2 className="text-base font-semibold text-slate-900 ">
        {title}
      </h2>
      <span className="text-sm font-normal text-slate-400 ">
        {count}
      </span>
    </div>
  );
}

/* Boş durum — sakin (ikon + nötr CTA). */
function EmptyTickets() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 py-20 text-center ">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-6 w-6" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a3 3 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a3 3 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z"
          />
        </svg>
      </div>
      <p className="mt-4 text-sm font-medium text-slate-700 ">
        Henüz bilet veya rezervasyon yok
      </p>
      <p className="mt-1 text-xs text-slate-400 ">
        Kütüphanelerde deneme oturumlarına katıl ya da çalışma alanı ayırt.
      </p>
      <Link
        to={ROUTES.libraries}
        className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 "
      >
        Kütüphaneleri keşfet
      </Link>
    </div>
  );
}

/* Bölüm "daha fazla / daha az" küçük geçişi (sakin / nötr). */
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
      className="mx-auto flex items-center gap-1 pt-1 text-sm font-semibold text-slate-600 transition hover:text-slate-900 "
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

/* ── Bilet temaları (türe göre) ──
 * Deneme bileti = mor, çalışma alanı = teal. Her tema koyu gradyan + açık metin
 * olduğundan birincil yazılar beyaz kalır; yalnız ikincil/ bağlantı tonları ile
 * gradyan + gölge renkleri temadan gelir. Aksan (amber kupon/QR halkası) ortaktır. */
interface TicketTheme {
  bg: CSSProperties; // gradyan + nokta dokusu
  shadow: string; // drop-shadow rgba'sı
  text: string; // çerçeve birincil metin sınıfı
  soft: string; // ikincil (tarih/süre) metin
  faint: string; // en soluk (kupon ipucu) metin
  link: string; // kütüphane bağlantısı
}

const EXAM_THEME: TicketTheme = {
  bg: {
    backgroundColor: "#5b21b6",
    backgroundImage:
      "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.16) 1.5px, transparent 0), linear-gradient(135deg, #7c3aed 0%, #5b21b6 55%, #4c1d95 100%)",
    backgroundSize: "16px 16px, 100% 100%",
  },
  shadow: "rgba(76,29,149,0.25)",
  text: "text-violet-50",
  soft: "text-violet-200/80",
  faint: "text-violet-200/70",
  link: "text-violet-100",
};

const STUDY_THEME: TicketTheme = {
  bg: {
    backgroundColor: "#0f766e",
    backgroundImage:
      "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.16) 1.5px, transparent 0), linear-gradient(135deg, #0d9488 0%, #0f766e 55%, #115e59 100%)",
    backgroundSize: "16px 16px, 100% 100%",
  },
  shadow: "rgba(13,148,136,0.30)",
  text: "text-teal-50",
  soft: "text-teal-100/80",
  faint: "text-teal-100/70",
  link: "text-teal-50",
};

interface Stamp {
  label: string;
  sub?: string | null;
  tone: "amber" | "slate";
}

function TicketFrame({
  theme,
  muted = false,
  stamp,
  main,
  stub,
}: {
  /** Bilet türüne göre renk paleti (deneme = mor, çalışma = teal). */
  theme: TicketTheme;
  /** Geçmiş/no-show: kartı gri-tonla + soluklaştır. */
  muted?: boolean;
  /** Ortaya basılan eğik damga (Kullanıldı / Süresi Doldu). null = damgasız. */
  stamp?: Stamp | null;
  main: ReactNode;
  stub: ReactNode;
}) {
  // Damga "basılır" (thump): büyükten normale oturur — geçişin çalışması için gecikmeli tetik.
  const hasStamp = !!stamp;
  const [stamped, setStamped] = useState(hasStamp);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(timer.current);
    if (hasStamp) {
      timer.current = setTimeout(() => setStamped(true), 120);
    } else {
      setStamped(false);
    }
    return () => clearTimeout(timer.current);
  }, [hasStamp]);

  const stampTone =
    stamp?.tone === "slate"
      ? "border-slate-200/80 text-slate-100"
      : "border-amber-300/90 text-amber-200";

  return (
    <div
      style={{
        filter: muted
          ? "grayscale(0.9) opacity(0.82) drop-shadow(0 10px 14px rgba(15,23,42,0.18))"
          : `drop-shadow(0 12px 16px ${theme.shadow})`,
      }}
    >
      <div
        style={{ ...SIDE_BITES, ...theme.bg }}
        className={`relative flex min-h-[11.5rem] w-full ${theme.text}`}
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

        {/* Damga: Kullanıldı (amber) / Süresi Doldu (slate) */}
        {stamp && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <div
              className={`select-none rounded-xl border-4 px-6 py-2.5 text-center font-black uppercase leading-none tracking-[0.15em] shadow-sm transition-all duration-300 ease-out ${stampTone} ${
                stamped ? "rotate-[-14deg] scale-100 opacity-90" : "rotate-[-14deg] scale-[1.8] opacity-0"
              }`}
              style={{ textShadow: "0 1px 0 rgba(255,255,255,0.15)" }}
            >
              <span className="block text-2xl">{stamp.label}</span>
              {stamp.sub && (
                <span className="mt-1 block whitespace-nowrap text-[10px] font-bold tracking-wide opacity-80">
                  {stamp.sub}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* QR kuponu (PAID/ATTENDED) — tıklayınca kod modalı açar. Aksi halde kilit placeholder. */
function TicketStub({
  theme,
  qrToken,
  shortCode,
  regId,
  inactive,
  onShow,
}: {
  theme: TicketTheme;
  qrToken?: string | null;
  shortCode?: string | null;
  regId: number;
  /** Geçmiş/iade/iptal: QR okutulamaz → pasif gösterge (ikon + etiket). */
  inactive?: { label: string; icon: string } | null;
  onShow: () => void;
}) {
  if (inactive) {
    return (
      <div className="flex w-[8.75rem] shrink-0 flex-col items-center justify-center gap-1.5 px-4 py-4 text-center">
        <div className="text-2xl opacity-60">{inactive.icon}</div>
        <div className={`text-[11px] font-medium leading-tight ${theme.faint}`}>
          {inactive.label}
        </div>
      </div>
    );
  }
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
          <div className={`mt-0.5 text-[10px] font-medium uppercase tracking-wide ${theme.faint} group-hover:text-white`}>
            Büyütmek için dokun
          </div>
        </div>
      </button>
    );
  }
  return (
    <div className="flex w-[8.75rem] shrink-0 flex-col items-center justify-center gap-1.5 px-4 py-4 text-center">
      <div className="text-2xl opacity-70">🔒</div>
      <div className={`text-[11px] font-medium leading-tight ${theme.soft}`}>
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

// Ödenmiş bilet/rezervasyon: başlangıca bu kadar saatten FAZLA varsa iptalde tam iade.
const REFUND_WINDOW_HOURS = 24;
function refundableUntilStart(startIso?: string | null): boolean {
  if (!startIso) return false;
  return new Date(startIso).getTime() - Date.now() > REFUND_WINDOW_HOURS * 3600 * 1000;
}

interface TerminalView {
  muted: boolean;
  stamp: Stamp | null;
  inactive: { label: string; icon: string } | null;
  pill: { label: string; cls: string };
}

/**
 * Bilet/rezervasyonun nihai görünümü: duruma (ve no-show için geçmişliğe) göre
 * rozet, ortadaki eğik damga ve QR kuponunun pasif hâli. Deneme bileti ile çalışma
 * rezervasyonu bu mantığı paylaşır.
 *  - ATTENDED → "Kullanıldı" (amber, kart canlı)
 *  - REFUNDED → "İade Edildi" (soluk + pasif QR)
 *  - geçmiş + okutulmamış → "Süresi Doldu" (soluk + pasif QR)
 *  - aksi (PAID/PENDING geçerli) → damgasız, canlı.
 *
 * Not: CANCELLED listelerden sunucuda elenir (list_my_registrations / list_mine
 * `status != CANCELLED`), bu yüzden buraya hiç ulaşmaz; ayrı dal tutulmaz.
 */
function terminalView(
  status: RegistrationStatus,
  isExpired: boolean,
  attendedAt?: string | null
): TerminalView {
  if (status === "ATTENDED") {
    return {
      muted: false,
      stamp: {
        label: "Kullanıldı",
        sub: attendedAt ? formatDateTime(attendedAt) : "giriş onaylandı",
        tone: "amber",
      },
      inactive: null,
      pill: STATUS_PILL.ATTENDED,
    };
  }
  if (status === "REFUNDED") {
    return {
      muted: true,
      stamp: { label: "İade Edildi", sub: "ücret iade edildi", tone: "slate" },
      inactive: { label: "İade edildi", icon: "↩" },
      pill: STATUS_PILL.REFUNDED,
    };
  }
  if (status === "REFUNDING") {
    return {
      muted: true,
      stamp: { label: "İade Ediliyor", sub: "iade işleme alındı", tone: "slate" },
      inactive: { label: "İade ediliyor", icon: "↩" },
      pill: STATUS_PILL.REFUNDING,
    };
  }
  if (isExpired) {
    return {
      muted: true,
      stamp: { label: "Süresi Doldu", sub: "katılım sağlanmadı", tone: "slate" },
      inactive: { label: "Süresi doldu", icon: "⌛" },
      pill: EXPIRED_PILL,
    };
  }
  return { muted: false, stamp: null, inactive: null, pill: STATUS_PILL[status] };
}

function TicketCard({ reg }: { reg: RegistrationOut }) {
  const theme = EXAM_THEME;
  const [showQr, setShowQr] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const pay = usePayRegistration();
  const cancel = useCancelRegistration();
  // Deneme bileti ödemesi kütüphane pazaryeri koluna bağlıdır
  // (backend/api/routers/library_exams.py:380 → LIBRARY_MARKETPLACE). Kol
  // kapalıyken buton tıklanabilir kalırsa kullanıcı 503'e yürür; desen
  // `ExamSessionsSection`/`StudySpaceSection` ile aynıdır.
  const { data: availability } = usePaymentAvailability();
  const payOpen = isBranchOpen(availability, "library_marketplace");
  const session = reg.session;
  // Oturum bitti mi? (başlangıç + süre). Geçmiş + okutulmamış = no-show.
  const examEndMs = session
    ? new Date(session.starts_at).getTime() + (session.duration_minutes ?? 0) * 60_000
    : null;
  const isExpired =
    reg.status !== "ATTENDED" &&
    reg.status !== "CANCELLED" &&
    reg.status !== "REFUNDING" &&
    reg.status !== "REFUNDED" &&
    examEndMs != null &&
    examEndMs < Date.now();
  const view = terminalView(reg.status, isExpired, reg.attended_at);
  const pill = view.pill;

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
    const paid = reg.status === "PAID";
    const msg = paid
      ? `Bu bileti iptal edip tam iade almak istiyor musun? (Oturuma ${REFUND_WINDOW_HOURS} saatten az kalınca iade yapılamaz.)`
      : "Bu kaydı iptal etmek istiyor musun?";
    if (!window.confirm(msg)) return;
    cancel.mutate(reg.id, {
      onSuccess: () =>
        toast.success(paid ? "Bilet iptal edildi, ödemen iade edildi." : "Kayıt iptal edildi."),
      onError: (e) => toast.error(getErrorMessage(e, "İptal başarısız.")),
    });
  };

  return (
    <div className="mx-auto w-[28rem] max-w-full space-y-2">
      <TicketFrame
        theme={theme}
        muted={view.muted}
        stamp={view.stamp}
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
                <p className={`mt-1 text-sm ${theme.soft}`}>
                  🗓️ {formatDateTime(session.starts_at)} · ⏱️ {session.duration_minutes} dk
                </p>
                {session.library_name && (
                  <Link
                    to={ROUTES.library(session.library_slug ?? session.library_id)}
                    className={`mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium ${theme.link} underline-offset-2 hover:text-white hover:underline`}
                  >
                    <LibraryIcon className="h-4 w-4 shrink-0 opacity-80" />
                    {session.library_name}
                  </Link>
                )}
              </>
            )}
            <p className="mt-2 text-sm font-bold text-white">{formatTRY(reg.amount)}</p>

            {reg.status === "PENDING_PAYMENT" && !isExpired && (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={doPay}
                    disabled={!payOpen || pay.isPending}
                    className={PAY_BTN}
                  >
                    {!payOpen ? "Ödeme kapalı" : pay.isPending ? "…" : "Ödemeyi tamamla"}
                  </button>
                  <button onClick={doCancel} disabled={cancel.isPending} className={GHOST_BTN}>
                    İptal
                  </button>
                </div>
                {!payOpen && (
                  <PaymentBranchNotice branch="library_marketplace" className="mt-3" />
                )}
              </>
            )}

            {reg.status === "PAID" && refundableUntilStart(session?.starts_at) && (
              <div className="mt-3">
                <button onClick={doCancel} disabled={cancel.isPending} className={GHOST_BTN}>
                  İptal et &amp; iade al
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
            theme={theme}
            qrToken={reg.qr_token}
            shortCode={reg.short_code}
            regId={reg.id}
            inactive={view.inactive}
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
  const theme = STUDY_THEME;
  const [showQr, setShowQr] = useState(false);
  const pay = usePayStudy();
  const cancel = useCancelStudy();
  // Çalışma alanı rezervasyonu da kütüphane pazaryeri kolundadır
  // (backend/api/routers/study_reservations.py:143 → LIBRARY_MARKETPLACE).
  // Deneme biletiyle AYNI kol olması bir kopyala-yapıştır değil, backend'de
  // doğrulanmış durumdur: iki uç da `PaymentBranch.LIBRARY_MARKETPLACE` ister.
  const { data: availability } = usePaymentAvailability();
  const payOpen = isBranchOpen(availability, "library_marketplace");
  // Çalışma penceresi bitti mi? Geçmiş + okutulmamış = no-show.
  const isExpired =
    res.status !== "ATTENDED" &&
    res.status !== "CANCELLED" &&
    res.status !== "REFUNDING" &&
    res.status !== "REFUNDED" &&
    new Date(res.ends_at).getTime() < Date.now();
  const view = terminalView(res.status, isExpired, res.attended_at);
  const pill = view.pill;

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
    const paid = res.status === "PAID";
    const msg = paid
      ? `Bu rezervasyonu iptal edip tam iade almak istiyor musun? (Başlangıca ${REFUND_WINDOW_HOURS} saatten az kalınca iade yapılamaz.)`
      : "Bu rezervasyonu iptal etmek istiyor musun?";
    if (!window.confirm(msg)) return;
    cancel.mutate(res.id, {
      onSuccess: () =>
        toast.success(paid ? "Rezervasyon iptal edildi, ödemen iade edildi." : "Rezervasyon iptal edildi."),
      onError: (e) => toast.error(getErrorMessage(e, "İptal başarısız.")),
    });
  };

  return (
    <div className="mx-auto w-[28rem] max-w-full">
    <TicketFrame
      theme={theme}
      muted={view.muted}
      stamp={view.stamp}
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
              className={`mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium ${theme.link} underline-offset-2 hover:text-white hover:underline`}
            >
              <LibraryIcon className="h-4 w-4 shrink-0 opacity-80" />
              {res.library_name}
            </Link>
          )}
          <p className="mt-2 text-sm font-bold text-white">{formatTRY(res.amount)}</p>

          {res.status === "PENDING_PAYMENT" && !isExpired && (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={doPay}
                  disabled={!payOpen || pay.isPending}
                  className={PAY_BTN}
                >
                  {!payOpen ? "Ödeme kapalı" : pay.isPending ? "…" : "Ödemeyi tamamla"}
                </button>
                <button onClick={doCancel} disabled={cancel.isPending} className={GHOST_BTN}>
                  İptal
                </button>
              </div>
              {!payOpen && (
                <PaymentBranchNotice branch="library_marketplace" className="mt-3" />
              )}
            </>
          )}

          {res.status === "PAID" && refundableUntilStart(res.starts_at) && (
            <div className="mt-3">
              <button onClick={doCancel} disabled={cancel.isPending} className={GHOST_BTN}>
                İptal et &amp; iade al
              </button>
            </div>
          )}
        </>
      }
      stub={
        <TicketStub
          theme={theme}
          qrToken={res.qr_token}
          shortCode={res.short_code}
          regId={res.id}
          inactive={view.inactive}
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
        className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl "
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 "
          aria-label="Kapat"
        >
          ✕
        </button>

        <h3 className="pr-8 text-lg font-bold text-slate-900 ">Sınav Sonucun</h3>
        {reg.session?.title && (
          <p className="mt-0.5 text-sm text-slate-500 ">{reg.session.title}</p>
        )}

        {hasSummary && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-indigo-50 p-4 text-center ">
              <div className="text-2xl font-extrabold text-indigo-600 ">
                {reg.result_net ?? "—"}
              </div>
              <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ">
                Net
              </div>
            </div>
            <div className="rounded-2xl bg-indigo-50 p-4 text-center ">
              <div className="text-2xl font-extrabold text-indigo-600 ">
                {reg.result_rank ?? "—"}
              </div>
              <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ">
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
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm font-medium text-slate-500 ">
              Karne henüz yüklenmedi
            </div>
          )}
          {answerKey && (
            <a
              href={answerKey}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 "
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
        className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl "
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 "
          aria-label="Kapat"
        >
          ✕
        </button>

        <h3 className="pr-8 text-lg font-bold text-slate-900 ">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500 ">
            <LibraryIcon className="h-4 w-4 shrink-0" />
            {subtitle}
          </p>
        )}

        {/* QR — kontrast için her zaman beyaz zemin */}
        <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <QRCodeSVG value={value} size={216} level="M" />
        </div>

        {/* Elle giriş kodu (QR okutulamazsa) */}
        <p className="mt-5 text-center text-xs font-medium text-slate-500 ">
          QR okutulamıyorsa görevliye bu kodu söyleyin:
        </p>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 ">
          <code className="flex-1 select-all text-center font-mono text-3xl font-bold tracking-[0.2em] text-slate-900 ">
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
