import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Field } from "@/components/ui/Field";
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
      <h4 className="text-base font-bold text-slate-900 ">
        {title}
      </h4>
      <p className="mt-0.5 text-xs text-slate-500 ">{desc}</p>
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
        checked ? "bg-marka" : "bg-slate-300 "
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
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 ";

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
                  ? "border-marka-mid bg-marka-soft/60 "
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 "
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  active
                    ? "border-marka "
                    : "border-slate-300 "
                }`}
              >
                {active && (
                  <span className="h-2 w-2 rounded-full bg-marka " />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm font-semibold ${
                    active
                      ? "text-marka-metin-hover "
                      : "text-slate-800 "
                  }`}
                >
                  {opt.label}
                </span>
                <span className="block text-[11px] text-slate-500 ">
                  {opt.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {(widget === "yks" || widget === "lgs") && (
        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-600 ">
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
        <Field label="Şehir" labelClassName="block text-xs font-medium text-slate-600 " className="mt-3">
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
                ? "border-marka-mid bg-marka-soft/60 "
                : "border-slate-200 "
            } ${dragging ? "opacity-50" : ""}`}
          >
            <span
              className="cursor-grab text-slate-300 transition hover:text-slate-500 active:cursor-grabbing "
              title="Sürükleyerek sırala"
            >
              <GripIcon />
            </span>
            {item.icon && (
              <Icon
                name={item.icon}
                className={`h-5 w-5 shrink-0 transition ${
                  item.visible
                    ? "text-slate-500 "
                    : "text-slate-300 "
                }`}
              />
            )}
            <span
              className={`min-w-0 flex-1 truncate text-sm font-semibold transition ${
                item.visible
                  ? "text-slate-800 "
                  : "text-slate-400 line-through "
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
        <h5 className="text-sm font-bold text-slate-800 ">
          {title}
        </h5>
        <p className="text-[11px] text-slate-500 ">{desc}</p>
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
        className="mt-5 text-xs font-medium text-slate-500 transition hover:text-slate-700 "
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
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 ">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 ">
            Son görüntülenen ilanlar
          </p>
          <p className="text-[11px] text-slate-500 ">
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
          className="mt-2 text-xs font-medium text-rose-600 transition hover:text-rose-700 "
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
      <NavbarWidgetSection />
      {navItems && navItems.length > 0 && roleId != null && (
        <>
          <div className="border-t border-slate-100 " />
          <NavigationSection roleId={roleId} navItems={navItems} />
        </>
      )}
      <div className="border-t border-slate-100 " />
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
            ? "bg-marka-soft text-marka-metin-hover "
            : "text-slate-600 hover:bg-slate-100 "
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
        className="flex h-[85vh] max-h-[680px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 "
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Kişiselleştir"
      >
        {/* Başlık */}
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 ">
          <div>
            <h3 className="text-lg font-bold text-slate-900 ">
              Kişiselleştir
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 ">
              Sitenin görünümünü ve kısayollarını kendine göre ayarla.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
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
          <div className="flex gap-1 overflow-x-auto border-b border-slate-100 p-2 sm:hidden">
            {sections.map((s) => railButton(s, "chip"))}
          </div>

          {/* Masaüstü sol panel */}
          <nav className="hidden w-52 shrink-0 space-y-1 overflow-y-auto border-r border-slate-100 p-3 sm:block">
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
