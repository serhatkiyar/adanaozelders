import { describe, expect, it } from "vitest";
import {
  EMPTY_CRITERIA,
  activeFacetCount,
  applyTaskFilter,
  criteriaActive,
  fromStored,
  sameStored,
  toStored,
  type TaskCriteria,
} from "./taskFilter";
import type { Task, TaskLabel, TaskPriority } from "@/types";

const NOW = new Date("2026-06-02T12:00:00");

function task(p: Partial<Task> & { id: number }): Task {
  return {
    id: p.id,
    list_id: 1,
    title: p.title ?? `Görev ${p.id}`,
    description: p.description ?? null,
    priority: p.priority ?? 4,
    due_at: p.due_at ?? null,
    recurrence: null,
    completed_at: null,
    position: p.position ?? 0,
    booking_id: null,
    subtasks: [],
    labels: p.labels ?? [],
    reminders: [],
    created_at: NOW.toISOString(),
  };
}

const label = (id: number, name = `l${id}`): TaskLabel => ({ id, name, color: null, is_favorite: false });

function crit(over: Partial<TaskCriteria> = {}): TaskCriteria {
  return { ...EMPTY_CRITERIA, ...over };
}

describe("criteriaActive / activeFacetCount", () => {
  it("boş kriter aktif değildir", () => {
    expect(criteriaActive(EMPTY_CRITERIA)).toBe(false);
    expect(activeFacetCount(EMPTY_CRITERIA)).toBe(0);
  });

  it("sadece sıralama daraltma saymaz (aktif değil)", () => {
    expect(criteriaActive(crit({ sort: "priority" }))).toBe(false);
  });

  it("arama/öncelik/etiket/son-tarih aktiflik sağlar ve yüz sayar", () => {
    expect(criteriaActive(crit({ q: "  x " }))).toBe(true);
    const c = crit({ q: "x", priorities: [1], labelIds: [2], due: ["today"] });
    expect(activeFacetCount(c)).toBe(4);
  });
});

describe("applyTaskFilter — arama", () => {
  const tasks = [
    task({ id: 1, title: "Matematik Raporu" }),
    task({ id: 2, title: "Fizik", description: "rapor hazırla" }),
    task({ id: 3, title: "Kimya" }),
  ];

  it("başlık ve açıklamada büyük/küçük harf duyarsız arar", () => {
    const r = applyTaskFilter(tasks, crit({ q: "RAPOR" }), NOW);
    expect(r.map((t) => t.id).sort()).toEqual([1, 2]);
  });

  it("Türkçe locale ile küçük harfe çevirir (İ/ı)", () => {
    const r = applyTaskFilter([task({ id: 9, title: "İMLA" })], crit({ q: "imla" }), NOW);
    expect(r).toHaveLength(1);
  });
});

describe("applyTaskFilter — öncelik & etiket", () => {
  const tasks = [
    task({ id: 1, priority: 1 as TaskPriority, labels: [label(10)] }),
    task({ id: 2, priority: 3 as TaskPriority, labels: [label(20)] }),
    task({ id: 3, priority: 1 as TaskPriority, labels: [label(10), label(20)] }),
  ];

  it("öncelik kümesine göre süzer", () => {
    expect(applyTaskFilter(tasks, crit({ priorities: [1] }), NOW).map((t) => t.id)).toEqual([1, 3]);
  });

  it("etiket ANY (herhangi biri) mantığıyla süzer", () => {
    expect(applyTaskFilter(tasks, crit({ labelIds: [20] }), NOW).map((t) => t.id)).toEqual([2, 3]);
  });

  it("birden çok yüz AND ile birleşir", () => {
    const r = applyTaskFilter(tasks, crit({ priorities: [1], labelIds: [20] }), NOW);
    expect(r.map((t) => t.id)).toEqual([3]);
  });
});

describe("applyTaskFilter — son tarih grupları & sıralama", () => {
  const overdue = task({ id: 1, due_at: "2026-06-01T10:00:00" });
  const today = task({ id: 2, due_at: "2026-06-02T18:00:00" });
  const upcoming = task({ id: 3, due_at: "2026-06-10T09:00:00" });
  const undated = task({ id: 4, due_at: null });
  const tasks = [undated, upcoming, today, overdue];

  it("son tarih grubuna göre süzer", () => {
    expect(applyTaskFilter(tasks, crit({ due: ["overdue"] }), NOW).map((t) => t.id)).toEqual([1]);
    expect(applyTaskFilter(tasks, crit({ due: ["today", "upcoming"] }), NOW).map((t) => t.id).sort()).toEqual([2, 3]);
    expect(applyTaskFilter(tasks, crit({ due: ["none"] }), NOW).map((t) => t.id)).toEqual([4]);
  });

  it("son tarihe göre sıralar, tarihsizler sona", () => {
    expect(applyTaskFilter(tasks, crit({ sort: "due" }), NOW).map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  it("önceliğe göre sıralar (P1 önce)", () => {
    const arr = [task({ id: 1, priority: 4 as TaskPriority }), task({ id: 2, priority: 1 as TaskPriority })];
    expect(applyTaskFilter(arr, crit({ sort: "priority" }), NOW).map((t) => t.id)).toEqual([2, 1]);
  });

  it("smart sıralama gelen sırayı korur", () => {
    expect(applyTaskFilter(tasks, crit({ sort: "smart" }), NOW).map((t) => t.id)).toEqual([4, 3, 2, 1]);
  });
});

describe("toStored / fromStored / sameStored", () => {
  it("gidiş-dönüş kayıpsızdır ve q kırpılır", () => {
    const c = crit({ q: "  ödev ", priorities: [2], labelIds: [5], due: ["today"], sort: "alpha" });
    const stored = toStored(c);
    expect(stored.q).toBe("ödev");
    const back = fromStored(stored);
    expect(back).toEqual({ ...c, q: "ödev" });
  });

  it("boş q null'a iner", () => {
    expect(toStored(crit({ q: "   " })).q).toBeNull();
    expect(fromStored(undefined)).toEqual(EMPTY_CRITERIA);
  });

  it("sameStored eşitliği yakalar", () => {
    expect(sameStored(toStored(crit({ priorities: [1] })), toStored(crit({ priorities: [1] })))).toBe(true);
    expect(sameStored(toStored(crit({ priorities: [1] })), toStored(crit({ priorities: [2] })))).toBe(false);
  });
});
