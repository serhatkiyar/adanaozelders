import { useState } from "react";
import { isoToLocalInput } from "@/lib/taskView";
import { localInputToIso } from "@/lib/datetime";
import type { ReminderInput } from "@/types";

// Hatırlatıcı düzenleyici (Todoist 'Reminders'): çoklu satır, ön ayar offsetleri
// (son tarihe göre) veya özel mutlak tarih, satır başına sil. Görev formunun
// lokal state'inde tutulur; submit'te iç içe payload'a paketlenir.

const PRESETS: { label: string; offset: number }[] = [
  { label: "Son tarihte", offset: 0 },
  { label: "15 dakika önce", offset: -15 },
  { label: "1 saat önce", offset: -60 },
  { label: "1 gün önce", offset: -1440 },
];

const absFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

export function offsetText(min: number): string {
  if (min === 0) return "Son tarihte";
  const before = min < 0;
  const m = Math.abs(min);
  let s: string;
  if (m % 1440 === 0) s = `${m / 1440} gün`;
  else if (m % 60 === 0) s = `${m / 60} saat`;
  else s = `${m} dakika`;
  return `${s} ${before ? "önce" : "sonra"}`;
}

const Bell = () => (
  <svg className="h-3.5 w-3.5 flex-none text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
  </svg>
);

export default function ReminderEditor({ reminders, due, onChange }: {
  reminders: ReminderInput[];
  due: string | null; // ISO son tarih (relative hatırlatmalar için çapa)
  onChange: (next: ReminderInput[]) => void;
}) {
  const [adding, setAdding] = useState(false);

  const add = (r: ReminderInput) => { onChange([...reminders, r]); setAdding(false); };
  const remove = (i: number) => onChange(reminders.filter((_, idx) => idx !== i));
  const setAt = (i: number, iso: string | null) =>
    onChange(reminders.map((r, idx) => (idx === i ? { ...r, remind_at: iso } : r)));

  const defaultAbs = () => due ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();

  return (
    <div className="space-y-1.5">
      {reminders.length === 0 && (
        <p className="px-0.5 text-xs text-slate-400">Henüz hatırlatıcı yok.</p>
      )}
      {reminders.map((r, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 ">
          <Bell />
          {r.type === "relative" ? (
            <span className="text-xs font-medium text-slate-600 ">{offsetText(r.offset_minutes ?? 0)}</span>
          ) : (
            <input
              type="datetime-local"
              value={isoToLocalInput(r.remind_at)}
              onChange={(e) => setAt(i, e.target.value ? localInputToIso(e.target.value) : null)}
              className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700 outline-none focus:border-marka-mid "
            />
          )}
          {r.type === "relative" && due && (
            <span className="text-[11px] text-slate-400">
              · {absFmt.format(new Date(new Date(due).getTime() + (r.offset_minutes ?? 0) * 60000))}
            </span>
          )}
          <button type="button" onClick={() => remove(i)} aria-label="Hatırlatıcıyı kaldır" className="ml-auto flex-none rounded p-0.5 text-slate-400 hover:text-red-500">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
      ))}

      <div className="relative">
        <button type="button" onClick={() => setAdding((a) => !a)} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-semibold text-marka transition hover:bg-marka-soft ">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" /></svg>
          Hatırlatıcı ekle
        </button>
        {adding && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setAdding(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl " onClick={(e) => e.stopPropagation()}>
              {due ? (
                PRESETS.map((p) => (
                  <button key={p.offset} type="button" onClick={() => add({ type: "relative", offset_minutes: p.offset })} className="block w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-100 ">{p.label}</button>
                ))
              ) : (
                <p className="px-2 py-1.5 text-xs text-slate-400">Ön ayarlar için önce son tarih ekle.</p>
              )}
              <button type="button" onClick={() => add({ type: "absolute", remind_at: defaultAbs() })} className="block w-full rounded-lg border-t border-slate-100 px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-100 ">Özel tarih…</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
