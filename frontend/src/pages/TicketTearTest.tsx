import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "@/store/toastStore";

/* ──────────────────────────────────────────────────────────────────────────
 * TEST SAYFASI — "Yırtılan kupon" bilet animasyonu (/test-bilet)
 *
 * Amaç: deneme/çalışma biletinde QR okutulup status ATTENDED'a geçince kupon
 * parçasının "koparılması" + ana parçaya "KULLANILDI" damgası vurulması efektini
 * denemek. framer-motion KULLANMADAN (projede yok) saf CSS/Tailwind geçişleriyle.
 *
 * Tasarım: yalnız DİKEY kenarlarda perforaj/testere "ısırık" (mask); üst/alt düz.
 * İki varyant: krem (cream) ve mor desenli (purple). QR'a tıklayınca Tickets.tsx'teki
 * gibi QR + kısa kod modalı açılır.
 *
 * Buradaki bilet verisi yerel demo'dur; gerçek akışta status WebSocket/polling
 * ile gelir (bkz. Tickets.tsx). Bu sayfa production yüzeyi değil, görsel prototip.
 * ────────────────────────────────────────────────────────────────────────── */

type TicketStatus = "PAID" | "ATTENDED";
type Variant = "cream" | "purple";

interface DemoTicket {
  exam_type: string;
  title: string;
  library_name: string;
  when: string;
  amount: string;
  short_code: string;
  qr_token: string;
  status: TicketStatus;
}

const SAMPLE: DemoTicket = {
  exam_type: "TYT",
  title: "Mart Genel Deneme · 1. Oturum",
  library_name: "Yaşam Kütüphanesi",
  when: "12 Mart Cmt · 10:00 · 135 dk",
  amount: "₺75,00",
  short_code: "4F6E8Y3F",
  qr_token: "demo-token-abc123",
  status: "PAID",
};

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

export default function TicketTearTest() {
  const [status, setStatus] = useState<TicketStatus>(SAMPLE.status);
  const [modal, setModal] = useState(false);

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12 dark:bg-slate-950">
      <div className="mx-auto max-w-xl space-y-8">
        <header className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Test · Prototip</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Yırtılan kupon bileti</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            QR'a tıkla → kod modalı. Girişi doğrulayınca kupon koparılır ve bilete{" "}
            <strong>KULLANILDI</strong> damgası vurulur.
          </p>
        </header>

        <div className="space-y-6">
          <TearableTicket variant="cream" data={{ ...SAMPLE, status }} onQrClick={() => setModal(true)} />
          <TearableTicket variant="purple" data={{ ...SAMPLE, status }} onQrClick={() => setModal(true)} />
        </div>

        {/* ── Test kontrolleri ── */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => setStatus("ATTENDED")}
            disabled={status === "ATTENDED"}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✓ Girişi doğrula (QR okut)
          </button>
          <button
            onClick={() => setStatus("PAID")}
            disabled={status === "PAID"}
            className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            ↺ Sıfırla
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          Durum: <code className="font-mono">{status}</code>
        </p>
      </div>

      {modal && (
        <QrModal
          title={SAMPLE.title}
          subtitle={SAMPLE.library_name}
          value={`${SAMPLE.short_code}:${SAMPLE.qr_token}`}
          code={SAMPLE.short_code}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  );
}

/* ── Perforaj mask: yalnız DİKEY kenarlar (sol/sağ ısırık), üst/alt düz ──
 * İki katman (sol + sağ) radial-gradient + mask-composite intersect:
 * bir pikseli yalnız her iki katmanda da opak ise göster → ısırıklar birleşir,
 * üst/alt kenarlar dokunulmadığı için düz kalır. */
const SIDE_BITES: React.CSSProperties = {
  WebkitMask:
    "radial-gradient(7px at 0 50%,#0000 98%,#000) repeat-y 0 50%/100% 20px," +
    "radial-gradient(7px at 100% 50%,#0000 98%,#000) repeat-y 100% 50%/100% 20px",
  mask:
    "radial-gradient(7px at 0 50%,#0000 98%,#000) repeat-y 0 50%/100% 20px," +
    "radial-gradient(7px at 100% 50%,#0000 98%,#000) repeat-y 100% 50%/100% 20px",
  WebkitMaskComposite: "source-in",
  maskComposite: "intersect",
};

/* Varyant token'ları (renk/desen/damga). */
const VARIANTS: Record<
  Variant,
  {
    style?: React.CSSProperties;
    container: string;
    badge: string;
    statusPaid: string;
    statusUsed: string;
    title: string;
    libName: string;
    muted: string;
    amount: string;
    code: string;
    hint: string;
    perfColor: string;
    stamp: string;
    qrRing: string;
  }
> = {
  cream: {
    container: "bg-[#f4efe4] dark:bg-[#27241f]",
    badge: "bg-indigo-600/10 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300",
    statusPaid: "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
    statusUsed: "bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
    title: "text-slate-900 dark:text-stone-100",
    libName: "text-slate-600 dark:text-stone-300",
    muted: "text-slate-500 dark:text-stone-400",
    amount: "text-slate-900 dark:text-stone-100",
    code: "text-slate-900 dark:text-stone-100",
    hint: "text-slate-400 group-hover:text-indigo-500",
    perfColor: "rgba(40,30,20,0.28)",
    stamp: "border-emerald-600/80 text-emerald-600/90 dark:border-emerald-400/70 dark:text-emerald-300/90",
    qrRing: "ring-black/5 group-hover:ring-indigo-400",
  },
  purple: {
    // Mor degrade + ince beyaz nokta deseni (mask'lenir, ısırıklar deseni de keser).
    style: {
      backgroundColor: "#5b21b6",
      backgroundImage:
        "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.16) 1.5px, transparent 0), linear-gradient(135deg, #7c3aed 0%, #5b21b6 55%, #4c1d95 100%)",
      backgroundSize: "16px 16px, 100% 100%",
    },
    container: "text-violet-50",
    badge: "bg-white/15 text-white ring-1 ring-inset ring-white/20",
    statusPaid: "bg-amber-300/20 text-amber-100 ring-1 ring-inset ring-amber-200/30",
    statusUsed: "bg-emerald-300/20 text-emerald-50 ring-1 ring-inset ring-emerald-200/30",
    title: "text-white",
    libName: "text-violet-100",
    muted: "text-violet-200/80",
    amount: "text-white",
    code: "text-white",
    hint: "text-violet-200/70 group-hover:text-white",
    perfColor: "rgba(255,255,255,0.5)",
    stamp: "border-amber-300/90 text-amber-200",
    qrRing: "ring-white/10 group-hover:ring-amber-300",
  },
};

function TearableTicket({
  data,
  variant,
  onQrClick,
}: {
  data: DemoTicket;
  variant: Variant;
  onQrClick: () => void;
}) {
  const isUsed = data.status === "ATTENDED";
  const v = VARIANTS[variant];

  // Damga "basılır" (thump): status değişince büyükten normale oturur — gecikmeli
  // tetikle ki geçiş animasyonu çalışsın (kupon koparılmaz, yerinde durur).
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
    <div className="flex justify-center">
      {/* Wrapper: maskelenmiş şekle yumuşak gölge (drop-shadow, normal shadow mask'ı takip etmez). */}
      <div style={{ filter: "drop-shadow(0 12px 16px rgba(15,23,42,0.18))" }}>
        <div style={{ ...SIDE_BITES, ...v.style }} className={`relative flex w-[26rem] max-w-full ${v.container}`}>
          {/* ── Ana parça (sabit) ── */}
          <div className="relative flex-1 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${v.badge}`}>{data.exam_type}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                  isUsed ? v.statusUsed : v.statusPaid
                }`}
              >
                {isUsed ? "Katıldın ✓" : "Bilet hazır"}
              </span>
            </div>

            <h3 className={`mt-2 text-base font-bold ${v.title}`}>{data.title}</h3>
            <p className={`mt-1 flex items-center gap-1.5 text-sm ${v.libName}`}>
              <LibraryIcon className="h-4 w-4 shrink-0 opacity-80" />
              {data.library_name}
            </p>
            <p className={`mt-0.5 text-sm ${v.muted}`}>🗓️ {data.when}</p>
            <p className={`mt-2 text-sm font-bold ${v.amount}`}>{data.amount}</p>
          </div>

          {/* ── İç dikey perforaj (noktalı delik sırası) ── */}
          <div
            className="relative w-[2px] shrink-0"
            style={{
              backgroundImage: `radial-gradient(circle, ${v.perfColor} 1.5px, transparent 1.8px)`,
              backgroundSize: "100% 11px",
              backgroundRepeat: "repeat-y",
              backgroundPosition: "center",
            }}
          />

          {/* ── Kupon parçası (sabit) — QR'a tıklayınca kod modalı ── */}
          <button
            type="button"
            onClick={onQrClick}
            className={`group flex w-[9rem] shrink-0 flex-col items-center justify-center px-4 py-4 text-center outline-none transition-opacity duration-300 ${
              isUsed ? "opacity-50" : "opacity-100"
            }`}
            aria-label="QR ve giriş kodunu büyüt"
          >
            <div className="w-[6.5rem]">
              <div className={`mx-auto w-fit rounded-md bg-white p-1.5 ring-1 transition group-hover:ring-2 ${v.qrRing}`}>
                <QRCodeSVG value={`${data.short_code}:${data.qr_token}`} size={80} level="M" />
              </div>
              <div className={`mt-2 font-mono text-base font-bold tracking-widest ${v.code}`}>
                {data.short_code.length === 8
                  ? `${data.short_code.slice(0, 4)} ${data.short_code.slice(4)}`
                  : data.short_code}
              </div>
              <div className={`mt-0.5 text-[10px] font-medium uppercase tracking-wide ${v.hint}`}>
                Büyütmek için dokun
              </div>
            </div>
          </button>

          {/* ── "Kullanıldı" damgası — biletin üzerine eğik basılır (thump) ── */}
          {isUsed && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
              <div
                className={`select-none rounded-xl border-4 px-6 py-2.5 text-center font-black uppercase leading-none tracking-[0.15em] shadow-sm transition-all duration-300 ease-out ${v.stamp} ${
                  stamped ? "rotate-[-14deg] scale-100 opacity-90" : "rotate-[-14deg] scale-[1.8] opacity-0"
                }`}
                style={{ textShadow: "0 1px 0 rgba(255,255,255,0.15)" }}
              >
                <span className="block text-2xl">Kullanıldı</span>
                <span className="mt-1 block text-[10px] font-bold tracking-[0.2em] opacity-80">
                  {data.when.split(" · ")[0]} · giriş onaylandı
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── QR + elle girilebilir kod modalı (Tickets.tsx ile aynı desen) ── */

function QrModal({
  title,
  subtitle,
  value,
  code,
  onClose,
}: {
  title: string;
  subtitle?: string;
  value: string;
  code: string;
  onClose: () => void;
}) {
  const pretty = code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
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

        <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <QRCodeSVG value={value} size={216} level="M" />
        </div>

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
