// Görev filtreleme/arama mantığı (Todoist 'Filtreler'). Saf fonksiyonlar —
// zaten yüklü görev listesine istemci tarafında uygulanır (anlık, isteksiz).
// Kalıcı filtreler backend'de TaskFilterCriteria (snake_case) olarak tutulur;
// burada çalışma kriteri camelCase'tir, sınırda toStored/fromStored dönüştürür.

import { classifyDue, type DueGroup } from "./taskView";
import type {
  DueGroupKey,
  Task,
  TaskFilterCriteria,
  TaskPriority,
  TaskSort,
} from "@/types";

export interface TaskCriteria {
  q: string;
  priorities: TaskPriority[];
  labelIds: number[];
  due: DueGroupKey[];
  sort: TaskSort;
}

export const EMPTY_CRITERIA: TaskCriteria = {
  q: "",
  priorities: [],
  labelIds: [],
  due: [],
  sort: "smart",
};

// Filtre "aktif" mi — yani normal görünüm yerine filtre sonucu gösterilmeli mi?
// (Sıralama tek başına aktiflik saymaz; daraltma yapmaz.)
export function criteriaActive(c: TaskCriteria): boolean {
  return (
    c.q.trim().length > 0 ||
    c.priorities.length > 0 ||
    c.labelIds.length > 0 ||
    c.due.length > 0
  );
}

// Aktif daraltma yüzü sayısı (rozet için).
export function activeFacetCount(c: TaskCriteria): number {
  return (
    (c.q.trim() ? 1 : 0) +
    (c.priorities.length ? 1 : 0) +
    (c.labelIds.length ? 1 : 0) +
    (c.due.length ? 1 : 0)
  );
}

function matches(task: Task, c: TaskCriteria, now: Date): boolean {
  const q = c.q.trim().toLocaleLowerCase("tr");
  if (q) {
    const hay = `${task.title} ${task.description ?? ""}`.toLocaleLowerCase("tr");
    if (!hay.includes(q)) return false;
  }
  if (c.priorities.length && !c.priorities.includes(task.priority)) return false;
  if (c.labelIds.length) {
    const ids = new Set(task.labels.map((l) => l.id));
    if (!c.labelIds.some((id) => ids.has(id))) return false;
  }
  if (c.due.length) {
    const g = classifyDue(task.due_at, now) as DueGroup;
    if (!c.due.includes(g as DueGroupKey)) return false;
  }
  return true;
}

function dueCmp(a: Task, b: Task): number {
  // Tarihsizler en sona.
  if (!a.due_at && !b.due_at) return 0;
  if (!a.due_at) return 1;
  if (!b.due_at) return -1;
  return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
}

export function applyTaskFilter(
  tasks: Task[],
  c: TaskCriteria,
  now: Date = new Date()
): Task[] {
  const out = tasks.filter((t) => matches(t, c, now));
  switch (c.sort) {
    case "alpha":
      return [...out].sort((a, b) => a.title.localeCompare(b.title, "tr"));
    case "priority":
      return [...out].sort((a, b) => a.priority - b.priority || dueCmp(a, b));
    case "due":
      return [...out].sort(dueCmp);
    default:
      // "smart": gelen sıra korunur (backend pozisyon/son-tarih sıralaması).
      return out;
  }
}

// ── Sınır dönüştürücüler (camelCase ↔ depolanan snake_case) ──
export function toStored(c: TaskCriteria): TaskFilterCriteria {
  return {
    q: c.q.trim() || null,
    priorities: c.priorities,
    label_ids: c.labelIds,
    due: c.due,
    sort: c.sort,
  };
}

export function fromStored(s?: TaskFilterCriteria | null): TaskCriteria {
  return {
    q: s?.q ?? "",
    priorities: s?.priorities ?? [],
    labelIds: s?.label_ids ?? [],
    due: s?.due ?? [],
    sort: s?.sort ?? "smart",
  };
}

// İki kriterin (kalıcı karşılaştırma için) aynı olup olmadığı — "Güncelle"
// düğmesinin kirli (dirty) durumunu saptamak için.
export function sameStored(a: TaskFilterCriteria, b: TaskFilterCriteria): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
