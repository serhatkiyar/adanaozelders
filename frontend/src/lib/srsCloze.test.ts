// @vitest-environment node
// İP-16 §6 — cloze render yardımcısının davranış testleri.
import { describe, expect, it } from "vitest";

import { clozeNumbers, renderCloze } from "./srsCloze";

describe("renderCloze", () => {
  it("aktif cloze ön yüzde [...] olur, diğerleri düz metin kalır", () => {
    const s = renderCloze("{{c1::Ankara}} Türkiye'nin {{c2::başkenti}}dir.", 1, false);
    expect(s).toEqual([
      { text: "[...]", kind: "blank" },
      { text: " Türkiye'nin başkentidir.", kind: "plain" },
    ]);
  });

  it("ipucu varsa boşluk [ipucu] olarak görünür", () => {
    const s = renderCloze("Başkent: {{c1::Ankara::şehir}}", 1, false);
    expect(s).toEqual([
      { text: "Başkent: ", kind: "plain" },
      { text: "[şehir]", kind: "blank" },
    ]);
  });

  it("arka yüzde aktif cloze açılmış (answer) döner", () => {
    const s = renderCloze("Başkent: {{c1::Ankara::şehir}}", 1, true);
    expect(s).toEqual([
      { text: "Başkent: ", kind: "plain" },
      { text: "Ankara", kind: "answer" },
    ]);
  });

  it("aynı N'in çoklu geçişi birlikte gizlenir", () => {
    const s = renderCloze("{{c1::a}} ve {{c1::b}} ve {{c2::c}}", 1, false);
    expect(s).toEqual([
      { text: "[...]", kind: "blank" },
      { text: " ve ", kind: "plain" },
      { text: "[...]", kind: "blank" },
      { text: " ve c", kind: "plain" },
    ]);
  });

  it("clozeNumbers farklı N'leri artan sırada verir", () => {
    expect(clozeNumbers("{{c2::b}} {{c1::a}} {{c2::c}}")).toEqual([1, 2]);
    expect(clozeNumbers("düz metin")).toEqual([]);
  });
});
