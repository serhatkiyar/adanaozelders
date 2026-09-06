import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Task, TaskFilter, TaskLabel, TaskList, TaskPriority } from "@/types";

// Son görüntülenen kaynak referansı (proje/etiket/filtre) — localStorage'da tutulur.
export type RecentRef =
  | { kind: "list"; id: number }
  | { kind: "label"; id: number }
  | { kind: "filter"; id: number };

export type PaletteView = "today" | "upcoming" | "all" | "completed";

interface PaletteItem {
  key: string;
  icon: ReactNode;
  label: string;
  sub?: string;
  run: () => void;
}

interface Group {
  title: string;
  items: PaletteItem[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  lists: TaskList[];
  labels: TaskLabel[];
  filters: TaskFilter[];
  tasks: Task[];
  recent: RecentRef[];
  onPickView: (view: PaletteView) => void;
  onPickList: (id: number) => void;
  onPickLabel: (id: number) => void;
  onPickFilter: (f: TaskFilter) => void;
  onOpenTask: (id: number) => void;
  onSearchAll: (q: string) => void;
  onOpenFiltersLabels: () => void;
}

const norm = (s: string) => s.toLocaleLowerCase("tr");

const PRIO_DOT: Record<TaskPriority, string> = {
  1: "border-red-500",
  2: "border-orange-500",
  3: "border-blue-500",
  4: "border-slate-400 ",
};

// ── İkonlar ──
const HashIcon = ({ color }: { color?: string | null }) => (
  <span className="flex h-5 w-5 items-center justify-center text-sm font-bold leading-none" style={{ color: color || "#94a3b8" }}>#</span>
);
const AtIcon = ({ color }: { color?: string | null }) => (
  <span className="flex h-5 w-5 items-center justify-center text-sm font-bold leading-none" style={{ color: color || "#64748b" }}>@</span>
);
const FunnelIcon = ({ color }: { color?: string | null }) => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke={color || "#64748b"} strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18l-7 8v6l-4 2v-8l-7-8Z" /></svg>
);
const TaskDot = ({ p }: { p: TaskPriority }) => (
  <span className={`flex h-5 w-5 items-center justify-center`}>
    <span className={`h-3.5 w-3.5 rounded-full border-2 ${PRIO_DOT[p]}`} />
  </span>
);
const navIcon = (d: string) => (
  <svg className="h-5 w-5 text-slate-500 " viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={d} /></svg>
);
const I_INBOX = "M2 13h4l2 4h8l2-4h4M5 5h14l3 8v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6L5 5Z";
const I_TODAY = "M8 7V3m8 4V3M3 11h18M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z";
const I_UPCOMING = "M8 2v4m8-4v4M4 9h16M5 21h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1Z";
const I_ALL = "M3.75 5.25h16.5m-16.5 6.75h16.5m-16.5 6.75h16.5";
const I_DONE = "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
const I_FILTERS = "M4 6h16M4 6a1 1 0 0 0-1 1v1.5a1 1 0 0 0 .3.7l5.4 5.3a1 1 0 0 1 .3.7V20l4-2.5v-3.6a1 1 0 0 1 .3-.7l5.4-5.3a1 1 0 0 0 .3-.7V7a1 1 0 0 0-1-1";

export default function TaskCommandPalette(props: Props) {
  const { open, onClose, lists, labels, filters, tasks, recent } = props;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Render sonrası odakla.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const inbox = lists.find((l) => l.is_inbox);
  const projects = useMemo(() => lists.filter((l) => !l.is_inbox), [lists]);

  // Komut/sonuç gruplarını kur.
  const groups = useMemo<Group[]>(() => {
    const q = query.trim();
    const qn = norm(q);
    const pickList = (l: TaskList) => () => props.onPickList(l.id);
    const pickLabel = (l: TaskLabel) => () => props.onPickLabel(l.id);
    const pickFilter = (f: TaskFilter) => () => props.onPickFilter(f);

    const navItems: PaletteItem[] = [
      ...(inbox ? [{ key: "nav-inbox", icon: navIcon(I_INBOX), label: "Gelen Kutusu", run: () => props.onPickList(inbox.id) }] : []),
      { key: "nav-today", icon: navIcon(I_TODAY), label: "Bugün", run: () => props.onPickView("today") },
      { key: "nav-upcoming", icon: navIcon(I_UPCOMING), label: "Yaklaşan", run: () => props.onPickView("upcoming") },
      { key: "nav-all", icon: navIcon(I_ALL), label: "Tüm Aktif", run: () => props.onPickView("all") },
      { key: "nav-completed", icon: navIcon(I_DONE), label: "Tamamlananlar", run: () => props.onPickView("completed") },
      { key: "nav-filters", icon: navIcon(I_FILTERS), label: "Filtreler ve Etiketler", run: () => props.onOpenFiltersLabels() },
    ];

    if (!q) {
      // Boş arama: son görüntülenenler + gezinme.
      const recentItems: PaletteItem[] = [];
      for (const r of recent) {
        if (r.kind === "list") {
          const l = projects.find((x) => x.id === r.id);
          if (l) recentItems.push({ key: `r-l${l.id}`, icon: <HashIcon color={l.color} />, label: l.name, sub: "Projelerim", run: pickList(l) });
        } else if (r.kind === "label") {
          const l = labels.find((x) => x.id === r.id);
          if (l) recentItems.push({ key: `r-lb${l.id}`, icon: <AtIcon color={l.color} />, label: l.name, sub: "Etiketlerim", run: pickLabel(l) });
        } else if (r.kind === "filter") {
          const f = filters.find((x) => x.id === r.id);
          if (f) recentItems.push({ key: `r-f${f.id}`, icon: <FunnelIcon color={f.color} />, label: f.name, sub: "Filtrelerim", run: pickFilter(f) });
        }
        if (recentItems.length >= 5) break;
      }
      const out: Group[] = [];
      if (recentItems.length) out.push({ title: "Son görüntülenenler", items: recentItems });
      out.push({ title: "Gezinme", items: navItems });
      return out;
    }

    // Arama modu.
    const out: Group[] = [];
    out.push({
      title: "Ara",
      items: [{
        key: "search-all",
        icon: <svg className="h-5 w-5 text-marka" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" /></svg>,
        label: `“${q}” için tüm görevlerde ara`,
        run: () => props.onSearchAll(q),
      }],
    });

    const taskHits = tasks
      .filter((t) => norm(`${t.title} ${t.description ?? ""}`).includes(qn))
      .slice(0, 6)
      .map<PaletteItem>((t) => ({
        key: `t${t.id}`,
        icon: <TaskDot p={t.priority} />,
        label: t.title,
        sub: projects.find((p) => p.id === t.list_id)?.name ?? (t.list_id === inbox?.id ? "Gelen Kutusu" : undefined),
        run: () => props.onOpenTask(t.id),
      }));
    if (taskHits.length) out.push({ title: "Görevler", items: taskHits });

    const projHits = projects.filter((l) => norm(l.name).includes(qn)).slice(0, 5)
      .map<PaletteItem>((l) => ({ key: `p${l.id}`, icon: <HashIcon color={l.color} />, label: l.name, sub: "Projelerim", run: pickList(l) }));
    if (projHits.length) out.push({ title: "Projeler", items: projHits });

    const labelHits = labels.filter((l) => norm(l.name).includes(qn)).slice(0, 5)
      .map<PaletteItem>((l) => ({ key: `lb${l.id}`, icon: <AtIcon color={l.color} />, label: l.name, sub: "Etiketlerim", run: pickLabel(l) }));
    if (labelHits.length) out.push({ title: "Etiketler", items: labelHits });

    const filterHits = filters.filter((f) => norm(f.name).includes(qn)).slice(0, 5)
      .map<PaletteItem>((f) => ({ key: `f${f.id}`, icon: <FunnelIcon color={f.color} />, label: f.name, sub: "Filtrelerim", run: pickFilter(f) }));
    if (filterHits.length) out.push({ title: "Filtreler", items: filterHits });

    const navHits = navItems.filter((n) => norm(n.label).includes(qn));
    if (navHits.length) out.push({ title: "Gezinme", items: navHits });

    return out;
  }, [query, recent, projects, labels, filters, tasks, inbox]); // eslint-disable-line react-hooks/exhaustive-deps

  // Düz seçilebilir liste (klavye gezinmesi için).
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    if (active >= flat.length) setActive(0);
  }, [flat.length, active]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (item: PaletteItem) => { item.run(); onClose(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (flat.length ? (i + 1) % flat.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[active]) run(flat[active]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  let idx = -1;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Arama girişi */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 ">
          <svg className="h-5 w-5 flex-none text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            placeholder="Görev ara veya komut yaz…"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 "
          />
          <kbd className="flex-none rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500 ">Esc</kbd>
        </div>

        {/* Sonuçlar */}
        <div className="max-h-[55vh] overflow-y-auto py-2">
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">Sonuç yok.</div>
          ) : (
            groups.map((g) => (
              <div key={g.title} className="mb-1">
                <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.title}</div>
                {g.items.map((item) => {
                  idx += 1;
                  const isActive = idx === active;
                  const myIdx = idx;
                  return (
                    <button
                      key={item.key}
                      ref={isActive ? activeRef : undefined}
                      onMouseMove={() => setActive(myIdx)}
                      onClick={() => run(item)}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition ${isActive ? "bg-marka-soft " : ""}`}
                    >
                      <span className="flex-none">{item.icon}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-800 ">{item.label}</span>
                      {item.sub && <span className="flex-none text-xs text-slate-400">{item.sub}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
