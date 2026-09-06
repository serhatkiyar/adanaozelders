import { useEffect, useState, type ReactNode } from "react";
import { useNavbarWidgetStore } from "@/store/navbarWidgetStore";
import { useWeather } from "@/hooks/useWeather";
import {
  daysUntil,
  WEATHER_LABEL,
  type WeatherKind,
} from "@/lib/navbarWidget";

// ── Küçük SVG ikon seti (navbar widget'ları için) ──
function SvgIcon({
  children,
  className = "h-5 w-5",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

const TargetIcon = ({ className }: { className?: string }) => (
  <SvgIcon className={className}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </SvgIcon>
);

const ClockIcon = ({ className }: { className?: string }) => (
  <SvgIcon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </SvgIcon>
);

function WeatherGlyph({
  kind,
  className,
}: {
  kind: WeatherKind;
  className?: string;
}) {
  switch (kind) {
    case "clear":
      return (
        <SvgIcon className={className}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </SvgIcon>
      );
    case "fog":
      return (
        <SvgIcon className={className}>
          <path d="M3 9h13a3.5 3.5 0 1 0-3.4-4.3" />
          <path d="M3 13h17M5 17h14" />
        </SvgIcon>
      );
    case "rain":
      return (
        <SvgIcon className={className}>
          <path d="M7 16a4 4 0 0 1-.5-7.97A5 5 0 0 1 16 7.5a3.5 3.5 0 0 1 .5 6.96" />
          <path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2" />
        </SvgIcon>
      );
    case "snow":
      return (
        <SvgIcon className={className}>
          <path d="M7 15a4 4 0 0 1-.5-7.97A5 5 0 0 1 16 6.5a3.5 3.5 0 0 1 .5 6.96" />
          <path d="M9 18h.01M12 20h.01M15 18h.01" />
        </SvgIcon>
      );
    case "storm":
      return (
        <SvgIcon className={className}>
          <path d="M7 14a4 4 0 0 1-.5-7.97A5 5 0 0 1 16 5.5a3.5 3.5 0 0 1 .5 6.96" />
          <path d="M12 13l-2 4h3l-2 4" />
        </SvgIcon>
      );
    case "cloud":
    default:
      return (
        <SvgIcon className={className}>
          <path d="M7 18a4.5 4.5 0 0 1-.5-8.97A5.5 5.5 0 0 1 17 10.5a3.5 3.5 0 0 1-.5 7.5H7Z" />
        </SvgIcon>
      );
  }
}

// Widget'ların ortak "pill" kabuğu — navbar'da logoyla aynı yüksekliği korur.
function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl bg-slate-100/80 px-3 py-1.5 text-slate-700 ring-1 ring-slate-200/70 transition group-hover:bg-slate-100 ">
      {children}
    </span>
  );
}

function Stacked({ top, bottom }: { top: ReactNode; bottom: ReactNode }) {
  return (
    <span className="flex flex-col leading-none">
      <span className="text-sm font-bold">{top}</span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 ">
        {bottom}
      </span>
    </span>
  );
}

function Countdown({
  label,
  targetISO,
}: {
  label: string;
  targetISO: string;
}) {
  const days = daysUntil(targetISO);
  const top =
    days > 0 ? (
      <>
        {days} <span className="text-xs font-semibold">gün</span>
      </>
    ) : days === 0 ? (
      "Bugün!"
    ) : (
      "Tamamlandı"
    );
  return (
    <Pill>
      <TargetIcon className="h-5 w-5 text-marka" />
      <Stacked top={top} bottom={label} />
    </Pill>
  );
}

function WeatherWidget() {
  const city = useNavbarWidgetStore((s) => s.city);
  const { data, isLoading, isError } = useWeather(city.lat, city.lng, true);

  if (isLoading) {
    return (
      <Pill>
        <span className="h-5 w-5 animate-pulse rounded-full bg-slate-300 " />
        <span className="h-7 w-16 animate-pulse rounded bg-slate-200 " />
      </Pill>
    );
  }
  if (isError || !data) {
    return (
      <Pill>
        <WeatherGlyph kind="cloud" className="h-5 w-5 text-slate-400" />
        <Stacked top="—°" bottom={city.name} />
      </Pill>
    );
  }
  return (
    <Pill>
      <WeatherGlyph kind={data.kind} className="h-5 w-5 text-sky-500" />
      <Stacked
        top={`${data.temperature}°`}
        bottom={`${city.name} · ${WEATHER_LABEL[data.kind]}`}
      />
    </Pill>
  );
}

const dateFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
});
const timeFmt = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
});

function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <Pill>
      <ClockIcon className="h-5 w-5 text-marka" />
      <Stacked top={timeFmt.format(now)} bottom={dateFmt.format(now)} />
    </Pill>
  );
}

interface NavbarWidgetProps {
  /** Logo varyantında masaüstü (md+) wordmark <img>'ine uygulanacak boyut sınıfı (header'dan gelir). */
  logoClass: string;
  /** Logo varyantında mobil (md altı) yazısız simge <img>'ine uygulanacak boyut sınıfı. */
  logoCompactClass: string;
}

// Navbar'ın sol üst alanı: kullanıcı tercihine göre logo veya bir bilgi widget'ı.
// Daima ana sayfaya götüren <Link> içinde render edilir (üst bileşende).
export function NavbarWidget({ logoClass, logoCompactClass }: NavbarWidgetProps) {
  const widget = useNavbarWidgetStore((s) => s.widget);
  const yksDate = useNavbarWidgetStore((s) => s.yksDate);
  const lgsDate = useNavbarWidgetStore((s) => s.lgsDate);

  switch (widget) {
    case "yks":
      return <Countdown label="YKS" targetISO={yksDate} />;
    case "lgs":
      return <Countdown label="LGS" targetISO={lgsDate} />;
    case "weather":
      return <WeatherWidget />;
    case "clock":
      return <ClockWidget />;
    case "logo":
    default:
      return (
        <>
          <img src="/logo-compact.svg" alt="Adana Özel Ders" className={logoCompactClass} />
          <img src="/logo.svg" alt="Adana Özel Ders" className={logoClass} />
        </>
      );
  }
}
