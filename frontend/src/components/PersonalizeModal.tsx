import { useEffect, useState, type ReactNode } from "react";
import {
  useThemeStore,
  type ThemePreference,
} from "@/store/themeStore";
import { useNavbarWidgetStore } from "@/store/navbarWidgetStore";
import { useUiPrefsStore } from "@/store/uiPrefsStore";
import { CITIES, type NavbarWidget } from "@/lib/navbarWidget";
import {
  clearRecentlyViewed,
  getRecentlyViewed,
} from "@/lib/recentlyViewed";

interface PersonalizeModalProps {
  onClose: () => void;
}

// Tema seçeneği kartının üstündeki küçük arayüz önizlemesi.
function ThemePreview({ variant }: { variant: "light" | "dark" | "system" }) {
  const panel = (tone: "light" | "dark") => (
    <div
      className={`flex h-full w-full flex-col gap-1.5 p-2 ${
        tone === "dark" ? "bg-slate-900" : "bg-white"
      }`}
    >
      <div
        className={`h-1.5 w-8 rounded-full ${
          tone === "dark" ? "bg-slate-600" : "bg-slate-300"
        }`}
      />
      <div className="flex gap-1.5">
        <div
          className={`h-6 w-6 rounded-md ${
            tone === "dark" ? "bg-indigo-500/80" : "bg-indigo-500"
          }`}
        />
        <div className="flex flex-1 flex-col justify-center gap-1">
          <div
            className={`h-1.5 w-full rounded-full ${
              tone === "dark" ? "bg-slate-700" : "bg-slate-200"
            }`}
          />
          <div
            className={`h-1.5 w-2/3 rounded-full ${
              tone === "dark" ? "bg-slate-700" : "bg-slate-200"
            }`}
          />
        </div>
      </div>
    </div>
  );

  if (variant === "system") {
    // Sol yarısı açık, sağ yarısı koyu — "OS'i izle" hissi.
    return (
      <div className="relative h-16 w-full overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
        <div className="absolute inset-0">{panel("light")}</div>
        <div
          className="absolute inset-0"
          style={{ clipPath: "polygon(100% 0, 100% 100%, 50% 100%, 50% 0)" }}
        >
          {panel("dark")}
        </div>
      </div>
    );
  }

  return (
    <div className="h-16 w-full overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
      {panel(variant)}
    </div>
  );
}

const ICONS: Record<ThemePreference, ReactNode> = {
  light: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
    />
  ),
  dark: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
    />
  ),
  system: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
    />
  ),
};

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  hint: string;
}[] = [
  { value: "light", label: "Açık", hint: "Aydınlık arayüz" },
  { value: "dark", label: "Koyu", hint: "Göz yormayan karanlık" },
  { value: "system", label: "Sistem", hint: "Cihaz ayarını izle" },
];

const NAV_OPTIONS: {
  value: NavbarWidget;
  label: string;
  hint: string;
}[] = [
  { value: "logo", label: "Logo", hint: "Varsayılan site logosu" },
  { value: "yks", label: "YKS geri sayım", hint: "Sınava kalan gün" },
  { value: "lgs", label: "LGS geri sayım", hint: "Sınava kalan gün" },
  { value: "weather", label: "Hava durumu", hint: "Anlık sıcaklık" },
  { value: "clock", label: "Tarih & saat", hint: "Canlı saat" },
];

const subInputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white";

// Navbar'daki logo alanında ne gösterileceğini seçtiren bölüm.
function NavbarSection() {
  const widget = useNavbarWidgetStore((s) => s.widget);
  const setWidget = useNavbarWidgetStore((s) => s.setWidget);
  const yksDate = useNavbarWidgetStore((s) => s.yksDate);
  const setYksDate = useNavbarWidgetStore((s) => s.setYksDate);
  const lgsDate = useNavbarWidgetStore((s) => s.lgsDate);
  const setLgsDate = useNavbarWidgetStore((s) => s.setLgsDate);
  const city = useNavbarWidgetStore((s) => s.city);
  const setCity = useNavbarWidgetStore((s) => s.setCity);

  return (
    <section className="mt-6 border-t border-slate-100 pt-6 dark:border-slate-700">
      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
        Üst bar
      </h4>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Logonun yerinde ne görünsün? Seçtiğin bilgi köşede yer alır.
      </p>

      <div className="mt-3 space-y-1.5">
        {NAV_OPTIONS.map((opt) => {
          const active = widget === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setWidget(opt.value)}
              aria-pressed={active}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                active
                  ? "border-indigo-500 bg-indigo-50/60 dark:border-indigo-400 dark:bg-indigo-500/10"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-700/40"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  active
                    ? "border-indigo-600 dark:border-indigo-400"
                    : "border-slate-300 dark:border-slate-600"
                }`}
              >
                {active && (
                  <span className="h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm font-semibold ${
                    active
                      ? "text-indigo-700 dark:text-indigo-300"
                      : "text-slate-800 dark:text-slate-100"
                  }`}
                >
                  {opt.label}
                </span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  {opt.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Seçili widget'a bağlı ek ayar */}
      {(widget === "yks" || widget === "lgs") && (
        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            {widget === "yks" ? "YKS tarihi" : "LGS tarihi"}
          </label>
          <input
            type="date"
            value={widget === "yks" ? yksDate : lgsDate}
            onChange={(e) =>
              widget === "yks"
                ? setYksDate(e.target.value)
                : setLgsDate(e.target.value)
            }
            className={`${subInputClass} mt-1`}
          />
        </div>
      )}

      {widget === "weather" && (
        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Şehir
          </label>
          <select
            value={city.name}
            onChange={(e) => {
              const next = CITIES.find((c) => c.name === e.target.value);
              if (next) setCity(next);
            }}
            className={`${subInputClass} mt-1`}
          >
            {CITIES.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </section>
  );
}

// Açık/kapalı anahtarı (toggle switch).
function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        checked ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-600"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
          checked ? "left-[1.375rem]" : "left-0.5"
        }`}
      />
    </button>
  );
}

// Ana sayfadaki kişisel keşif öğelerinin görünürlük ayarları.
function DiscoverySection() {
  const show = useUiPrefsStore((s) => s.showRecentlyViewed);
  const setShow = useUiPrefsStore((s) => s.setShowRecentlyViewed);
  const [hasHistory, setHasHistory] = useState(
    () => getRecentlyViewed().length > 0
  );

  return (
    <section className="mt-6 border-t border-slate-100 pt-6 dark:border-slate-700">
      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
        Keşif
      </h4>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Ana sayfadaki kişisel önerileri yönet.
      </p>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-700">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Son görüntülenen ilanlar
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Ana sayfada baktığın eğitmenleri göster
          </p>
        </div>
        <Switch checked={show} onChange={setShow} />
      </div>

      {hasHistory && (
        <button
          type="button"
          onClick={() => {
            clearRecentlyViewed();
            setHasHistory(false);
          }}
          className="mt-2 text-xs font-medium text-rose-600 transition hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
        >
          Görüntüleme geçmişini temizle
        </button>
      )}
    </section>
  );
}

// Görünüm tercihlerinin tutulduğu pencere. Profil menüsündeki "Kişiselleştir"
// girişinden açılır. Tema, navbar widget'ı ve keşif tercihlerini içerir.
export function PersonalizeModal({ onClose }: PersonalizeModalProps) {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  // Esc ile kapat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Kişiselleştir"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Kişiselleştir
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Sitenin görünümünü kendine göre ayarla.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="h-5 w-5"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <section className="mt-6">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
            Tema
          </h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Arayüzün açık mı koyu mu görüneceğini seç.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {THEME_OPTIONS.map((opt) => {
              const active = preference === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPreference(opt.value)}
                  aria-pressed={active}
                  className={`group relative flex flex-col gap-2.5 rounded-xl border p-3 text-left transition ${
                    active
                      ? "border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-200 dark:border-indigo-400 dark:bg-indigo-500/10 dark:ring-indigo-500/30"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-700/40"
                  }`}
                >
                  <ThemePreview variant={opt.value} />
                  <div className="flex items-center gap-2">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.7}
                      className={`h-4 w-4 shrink-0 ${
                        active
                          ? "text-indigo-600 dark:text-indigo-400"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                      aria-hidden
                    >
                      {ICONS[opt.value]}
                    </svg>
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-semibold ${
                          active
                            ? "text-indigo-700 dark:text-indigo-300"
                            : "text-slate-800 dark:text-slate-100"
                        }`}
                      >
                        {opt.label}
                      </p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {opt.hint}
                      </p>
                    </div>
                  </div>
                  {active && (
                    <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                        className="h-3 w-3"
                        aria-hidden
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4.5 12.75l6 6 9-13.5"
                        />
                      </svg>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <NavbarSection />

        <DiscoverySection />

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
}
