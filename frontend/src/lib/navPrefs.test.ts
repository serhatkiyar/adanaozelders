// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  resolveSurface,
  defaultVisible,
  type SurfacePrefs,
} from "./navPrefs";
import type { NavItem } from "./nav";
import { ROUTES } from "./routes";

const items: NavItem[] = [
  { to: ROUTES.favorites, label: "Favorilerim", icon: "favorites" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
  { to: ROUTES.questions, label: "Sorularım", icon: "questions" },
  { to: ROUTES.exams, label: "Denemelerim", icon: "exams" },
  { to: ROUTES.calendar, label: "Takvim", icon: "calendar" },
];

describe("defaultVisible", () => {
  it("yan menüde her şey varsayılan görünür", () => {
    for (const it of items) {
      expect(defaultVisible("sidebar", it)).toBe(true);
    }
  });

  it("üst barda çoğu görünür, Sorular/Denemeler/Takvim varsayılan gizli", () => {
    expect(defaultVisible("navbar", items[0])).toBe(true); // Favorilerim
    expect(defaultVisible("navbar", items[1])).toBe(true); // Mesajlar
    expect(defaultVisible("navbar", items[2])).toBe(false); // Sorularım
    expect(defaultVisible("navbar", items[3])).toBe(false); // Denemelerim
    expect(defaultVisible("navbar", items[4])).toBe(false); // Takvim
  });
});

describe("resolveSurface", () => {
  it("tercih yokken kanonik sırayı + varsayılan görünürlüğü döndürür", () => {
    const nav = resolveSurface(items, undefined, "navbar");
    expect(nav.map((r) => r.to)).toEqual(items.map((i) => i.to));
    expect(nav.find((r) => r.to === ROUTES.favorites)?.visible).toBe(true);
    expect(nav.find((r) => r.to === ROUTES.questions)?.visible).toBe(false);

    const side = resolveSurface(items, undefined, "sidebar");
    expect(side.every((r) => r.visible)).toBe(true);
  });

  it("yüzeyler bağımsız: aynı öğe üst barda gizli, yan menüde görünür olabilir", () => {
    const navPrefs: SurfacePrefs = {
      order: [],
      visible: { [ROUTES.favorites]: false },
    };
    const sidePrefs: SurfacePrefs = { order: [], visible: {} };
    const nav = resolveSurface(items, navPrefs, "navbar");
    const side = resolveSurface(items, sidePrefs, "sidebar");
    expect(nav.find((r) => r.to === ROUTES.favorites)?.visible).toBe(false);
    expect(side.find((r) => r.to === ROUTES.favorites)?.visible).toBe(true);
  });

  it("görünürlük override'ı varsayılanı ezer", () => {
    const prefs: SurfacePrefs = {
      order: [],
      visible: { [ROUTES.questions]: true }, // varsayılan navbar'da gizliydi
    };
    const nav = resolveSurface(items, prefs, "navbar");
    expect(nav.find((r) => r.to === ROUTES.questions)?.visible).toBe(true);
    // Dokunulmayanlar varsayılanda kalır.
    expect(nav.find((r) => r.to === ROUTES.exams)?.visible).toBe(false);
  });

  it("kayıtlı sırayı uygular, sıralanmamış (yeni) öğeleri sona ekler", () => {
    const prefs: SurfacePrefs = {
      order: [ROUTES.exams, ROUTES.favorites],
      visible: {},
    };
    const res = resolveSurface(items, prefs, "sidebar");
    expect(res.map((r) => r.to)).toEqual([
      ROUTES.exams,
      ROUTES.favorites,
      ROUTES.messages,
      ROUTES.questions,
      ROUTES.calendar,
    ]);
  });

  it("artık var olmayan rotaları order'dan görmezden gelir", () => {
    const prefs: SurfacePrefs = {
      order: ["/silinmis-rota", ROUTES.messages],
      visible: {},
    };
    const res = resolveSurface(items, prefs, "navbar");
    expect(res).toHaveLength(items.length);
    expect(res.map((r) => r.to)).toContain(ROUTES.messages);
  });
});
