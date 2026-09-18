// @vitest-environment node
import { describe, expect, it } from "vitest";

import { mergeSearchHistory } from "@/lib/storeSearchHistory";

describe("mergeSearchHistory", () => {
  it("yeni terimi başa ekler", () => {
    expect(mergeSearchHistory(["kalem"], "defter")).toEqual(["defter", "kalem"]);
  });

  it("tekrarı tr-duyarsız temizler ve başa taşır", () => {
    expect(mergeSearchHistory(["Kalem", "defter"], "kalem")).toEqual([
      "kalem",
      "defter",
    ]);
    expect(mergeSearchHistory(["İğne", "defter"], "iğne")).toEqual([
      "iğne",
      "defter",
    ]);
  });

  it("boş/whitespace terimi eklemez", () => {
    expect(mergeSearchHistory(["kalem"], "   ")).toEqual(["kalem"]);
    expect(mergeSearchHistory(["kalem"], "")).toEqual(["kalem"]);
  });

  it("terimi trim'ler", () => {
    expect(mergeSearchHistory([], "  roman  ")).toEqual(["roman"]);
  });

  it("MAX'e kırpar (en yeni başta)", () => {
    const hist = ["a", "b", "c"];
    expect(mergeSearchHistory(hist, "yeni", 3)).toEqual(["yeni", "a", "b"]);
  });
});
