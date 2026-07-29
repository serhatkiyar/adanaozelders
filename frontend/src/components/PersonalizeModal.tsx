import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Field } from "@/components/ui/Field";
import {
  useThemeStore,
  type ThemePreference,
} from "@/store/themeStore";
import { useNavbarWidgetStore } from "@/store/navbarWidgetStore";
import { useUiPrefsStore } from "@/store/uiPrefsStore";
import { useNavPrefsStore } from "@/store/navPrefsStore";
import { CITIES, type NavbarWidget } from "@/lib/navbarWidget";
import {
  clearRecentlyViewed,
  getRecentlyViewed,
} from "@/lib/recentlyViewed";
import { resolveSurface, type NavSurface } from "@/lib/navPrefs";
import type { NavItem } from "@/lib/nav";
import { Icon } from "@/components/AppIcon";

interface PersonalizeModalProps {
  onClose: () => void;
  /** Oturum-içi nav listesi (Navigasyon bölümü için). Yoksa bölüm gizlenir. */
  navItems?: NavItem[];
  /** Aktif kullanıcının rol id'si — nav tercihleri rol bazlı saklanır. */
  roleId?: number;
}

/* ── Ortak küçük parçalar ───────────────────────────────────────────── */

function SectionHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-4">
      <h4 className="text-base font-bold text-slate-900 dark:text-white">
        {title}
      </h4>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</p>
    </div>
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

const subInputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white";

/* ── Tema bölümü ─────────────────────────────────────────────────────── */

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

const THEME_ICONS: Record<ThemePreference, ReactNode> = {
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

const THEME_OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "light", label: "Açık", hint: "Aydınlık arayüz" },
  { value: "dark", label: "Koyu", hint: "Göz yormayan karanlık" },
  { value: "system", label: "Sistem", hint: "Cihaz ayarını izle" },
];

function ThemeSection() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <div>
      <SectionHeading
        title="Tema"
        desc="Arayüzün açık mı koyu mu görüneceğini seç."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                  {THEME_ICONS[opt.value]}
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
    </div>
  );
}

/* ── Üst bar (widget) bölümü ─────────────────────────────────────────── */

const NAV_OPTIONS: { value: NavbarWidget; label: string; hint: string }[] = [
  { value: "logo", label: "Logo", hint: "Varsayılan site logosu" },
  { value: "yks", label: "YKS geri sayım", hint: "Sınava kalan gün" },
  { value: "lgs", label: "LGS geri sayım", hint: "Sınava kalan gün" },
  { value: "weather", label: "Hava durumu", hint: "Anlık sıcaklık" },
  { value: "clock", label: "Tarih & saat", hint: "Canlı saat" },
];

function NavbarWidgetSection() {
  const widget = useNavbarWidgetStore((s) => s.widget);
  const setWidget = useNavbarWidgetStore((s) => s.setWidget);
  const yksDate = useNavbarWidgetStore((s) => s.yksDate);
  const setYksDate = useNavbarWidgetStore((s) => s.setYksDate);
  const lgsDate = useNavbarWidgetStore((s) => s.lgsDate);
  const setLgsDate = useNavbarWidgetStore((s) => s.setLgsDate);
  const city = useNavbarWidgetStore((s) => s.city);
  const setCity = useNavbarWidgetStore((s) => s.setCity);

  return (
    <div>
      <SectionHeading
        title="Üst bar"
        desc="Logonun yerinde ne görünsün? Seçtiğin bilgi köşede yer alır."
      />
      <div className="space-y-1.5">
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
        <Field label="Şehir" labelClassName="block text-xs font-medium text-slate-600 dark:text-slate-300" className="mt-3">
          {(id) => (
              <select
                    id={id}
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
          )}
        </Field>
      )}
    </div>
  );
}

/* ── Navigasyon (kısayol düzeni) bölümü ──────────────────────────────── */

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

// Tek bir yüzeyin (üst bar veya yan menü) kısayol düzenleyicisi:
// sürükle-bırak sıralama + her satırda göster/gizle anahtarı.
function SurfaceEditor({
  roleId,
  navItems,
  surface,
}: {
  roleId: number;
  navItems: NavItem[];
  surface: NavSurface;
}) {
  const prefs = useNavPrefsStore((s) => s.byRole[roleId]?.[surface]);
  const setVisible = useNavPrefsStore((s) => s.setVisible);
  const setOrder = useNavPrefsStore((s) => s.setOrder);

  const items = useMemo(
    () => resolveSurface(navItems, prefs, surface),
    [navItems, prefs, surface]
  );

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const move = (target: string) => {
    if (!dragKey || dragKey === target) return;
    const order = items.map((i) => i.to);
    const from = order.indexOf(dragKey);
    const to = order.indexOf(target);
    if (from === -1 || to === -1) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    setOrder(roleId, surface, order);
  };

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const dragging = dragKey === item.to;
        const over = overKey === item.to && dragKey !== null && !dragging;
        return (
          <div
            key={item.to}
            draggable
            onDragStart={() => setDragKey(item.to)}
            onDragEnd={() => {
              setDragKey(null);
              setOverKey(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverKey(item.to);
            }}
            onDrop={(e) => {
              e.preventDefault();
              move(item.to);
              setOverKey(null);
            }}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
              over
                ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-400 dark:bg-indigo-500/10"
                : "border-slate-200 dark:border-slate-700"
            } ${dragging ? "opacity-50" : ""}`}
          >
            <span
              className="cursor-grab text-slate-300 transition hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
              title="Sürükleyerek sırala"
            >
              <GripIcon />
            </span>
            {item.icon && (
              <Icon
                name={item.icon}
                className={`h-5 w-5 shrink-0 transition ${
                  item.visible
                    ? "text-slate-500 dark:text-slate-400"
                    : "text-slate-300 dark:text-slate-600"
                }`}
              />
            )}
            <span
              className={`min-w-0 flex-1 truncate text-sm font-semibold transition ${
                item.visible
                  ? "text-slate-800 dark:text-slate-100"
                  : "text-slate-400 line-through dark:text-slate-500"
              }`}
            >
              {item.label}
            </span>
            <Switch
              checked={item.visible}
              onChange={(v) => setVisible(roleId, surface, item.to, v)}
            />
          </div>
        );
      })}
    </div>
  );
}

function SubBlock({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2.5">
        <h5 className="text-sm font-bold text-slate-800 dark:text-slate-100">
          {title}
        </h5>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function NavigationSection({
  roleId,
  navItems,
}: {
  roleId: number;
  navItems: NavItem[];
}) {
  const reset = useNavPrefsStore((s) => s.reset);

  return (
    <div>
      <SectionHeading
        title="Navigasyon"
        desc="Kısayollarını sürükleyerek sırala; üst barda ve yan menüde ayrı ayrı göster/gizle."
      />

      <div className="space-y-6">
        <SubBlock
          title="Üst bar"
          desc="Sayfanın tepesindeki ikon kısayolları."
        >
          <SurfaceEditor roleId={roleId} navItems={navItems} surface="navbar" />
        </SubBlock>

        <SubBlock
          title="Yan menü"
          desc="Profil fotoğrafına tıklayınca açılan menü."
        >
          <SurfaceEditor roleId={roleId} navItems={navItems} surface="sidebar" />
        </SubBlock>
      </div>

      <button
        type="button"
        onClick={() => reset(roleId)}
        className="mt-5 text-xs font-medium text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        Varsayılana sıfırla
      </button>
    </div>
  );
}

/* ── Keşif bölümü ────────────────────────────────────────────────────── */

function DiscoverySection() {
  const show = useUiPrefsStore((s) => s.showRecentlyViewed);
  const setShow = useUiPrefsStore((s) => s.setShowRecentlyViewed);
  const [hasHistory, setHasHistory] = useState(
    () => getRecentlyViewed().length > 0
  );

  return (
    <div>
      <SectionHeading
        title="Keşif"
        desc="Ana sayfadaki kişisel önerileri yönet."
      />
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-700">
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
    </div>
  );
}

/* ── Ayarlar sayfası için düz panel (modal kabuğu olmadan) ───────────── */

// "Görünüm ve tercihler" kategorisinde kullanılır: tüm bölümleri alt alta
// dizer. Modaldakiyle aynı bölüm bileşenlerini paylaşır (kod tekrarı yok).
export function PersonalizePanel({
  navItems,
  roleId,
}: {
  navItems?: NavItem[];
  roleId?: number;
}) {
  return (
    <div className="space-y-8">
      <ThemeSection />
      <div className="border-t border-slate-100 dark:border-slate-800" />
      <NavbarWidgetSection />
      {navItems && navItems.length > 0 && roleId != null && (
        <>
          <div className="border-t border-slate-100 dark:border-slate-800" />
          <NavigationSection roleId={roleId} navItems={navItems} />
        </>
      )}
      <div className="border-t border-slate-100 dark:border-slate-800" />
      <DiscoverySection />
    </div>
  );
}

/* ── Modal kabuğu (VS Code ayarları düzeni) ──────────────────────────── */

interface SectionDef {
  id: string;
  label: string;
  icon: ReactNode;
  render: ReactNode;
}

// Görünüm tercihlerinin tutulduğu pencere. Profil menüsündeki "Kişiselleştir"
// girişinden açılır. Sol kategori paneli + sağ içerik (VS Code ayarları gibi).
export function PersonalizeModal({
  onClose,
  navItems,
  roleId,
}: PersonalizeModalProps) {
  const sections = useMemo<SectionDef[]>(() => {
    const list: SectionDef[] = [
      {
        id: "theme",
        label: "Tema",
        icon: (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 9 9c0 1.66-1.34 3-3 3h-1.5a1.5 1.5 0 0 0-1.06 2.56A1.5 1.5 0 0 1 13.5 21H12Z M7.5 11.25h.008v.008H7.5v-.008Zm3-3h.008v.008H10.5V8.25Zm3 0h.008v.008H13.5V8.25Z"
          />
        ),
        render: <ThemeSection />,
      },
      {
        id: "navbar",
        label: "Üst bar",
        icon: (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75A2.25 2.25 0 0 1 6 4.5h12a2.25 2.25 0 0 1 2.25 2.25v10.5A2.25 2.25 0 0 1 18 19.5H6a2.25 2.25 0 0 1-2.25-2.25V6.75Zm0 2.25h16.5"
          />
        ),
        render: <NavbarWidgetSection />,
      },
    ];

    if (navItems && navItems.length > 0 && roleId != null) {
      list.push({
        id: "navigation",
        label: "Navigasyon",
        icon: (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
          />
        ),
        render: <NavigationSection roleId={roleId} navItems={navItems} />,
      });
    }

    list.push({
      id: "discovery",
      label: "Keşif",
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
        />
      ),
      render: <DiscoverySection />,
    });

    return list;
  }, [navItems, roleId]);

  const [active, setActive] = useState<string>(sections[0]?.id ?? "theme");
  const activeSection =
    sections.find((s) => s.id === active) ?? sections[0];

  // Esc ile kapat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const railButton = (s: SectionDef, layout: "rail" | "chip") => {
    const isActive = s.id === active;
    const base =
      layout === "rail"
        ? "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition"
        : "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition";
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => setActive(s.id)}
        aria-current={isActive}
        className={`${base} ${
          isActive
            ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
            : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/60"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          className="h-5 w-5 shrink-0"
          aria-hidden
        >
          {s.icon}
        </svg>
        {s.label}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[85vh] max-h-[680px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Kişiselleştir"
      >
        {/* Başlık */}
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Kişiselleştir
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Sitenin görünümünü ve kısayollarını kendine göre ayarla.
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

        {/* Gövde: sol panel + içerik */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Mobil sekmeler */}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-100 p-2 dark:border-slate-700 sm:hidden">
            {sections.map((s) => railButton(s, "chip"))}
          </div>

          {/* Masaüstü sol panel */}
          <nav className="hidden w-52 shrink-0 space-y-1 overflow-y-auto border-r border-slate-100 p-3 dark:border-slate-700 sm:block">
            {sections.map((s) => railButton(s, "rail"))}
          </nav>

          {/* İçerik */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {activeSection?.render}
          </div>
        </div>
      </div>
    </div>
  );
}
