import { describe, expect, it } from "vitest";
import { buildSnippet } from "@/lib/messageSearch";

// Yardımcı: yalnız eşleşen parçaların metnini toplar.
const matches = (body: string, term: string) =>
  buildSnippet(body, term)
    .filter((s) => s.match)
    .map((s) => s.text);

// Yardımcı: parçaları birleştirince elde edilen görünür metin.
const rendered = (body: string, term: string) =>
  buildSnippet(body, term)
    .map((s) => s.text)
    .join("");

describe("buildSnippet", () => {
  it("boş terimde gövdeyi tek vurgusuz parça olarak döner", () => {
    expect(buildSnippet("merhaba", "")).toEqual([
      { text: "merhaba", match: false },
    ]);
    expect(buildSnippet("merhaba", "   ")).toEqual([
      { text: "merhaba", match: false },
    ]);
  });

  it("boş gövde + boş terimde boş dizi döner", () => {
    expect(buildSnippet("", "")).toEqual([]);
  });

  it("eşleşen terimi ayrı parça olarak işaretler", () => {
    const segs = buildSnippet("matematik ödevini yaptın mı", "ödev");
    expect(segs).toEqual([
      { text: "matematik ", match: false },
      { text: "ödev", match: true },
      { text: "ini yaptın mı", match: false },
    ]);
  });

  it("büyük/küçük harf duyarsız eşleşir ve orijinal yazımı korur", () => {
    expect(matches("ÖDEV teslim", "ödev")).toEqual(["ÖDEV"]);
    expect(matches("Ödev ve ödev", "ÖDEV")).toEqual(["Ödev", "ödev"]);
  });

  it("birden çok geçişi işaretler", () => {
    expect(matches("ödev ödev ödev", "ödev")).toEqual(["ödev", "ödev", "ödev"]);
  });

  it("eşleşme yoksa hiçbir parça vurgulanmaz", () => {
    expect(matches("merhaba dünya", "xyz")).toEqual([]);
  });

  it("regex özel karakterlerini düz metin olarak ele alır", () => {
    expect(matches("fiyat (net) 100", "(net)")).toEqual(["(net)"]);
    expect(matches("a.b.c yolu", "a.b")).toEqual(["a.b"]);
    // '.' joker gibi davranmamalı:
    expect(matches("axb yolu", "a.b")).toEqual([]);
  });

  it("uzun gövdede eşleşme derindeyse başına … ekleyip kırpar", () => {
    const long = "x".repeat(200) + "ödev" + "y".repeat(200);
    const segs = buildSnippet(long, "ödev");
    expect(segs[0]).toEqual({ text: "…", match: false });
    expect(segs.some((s) => s.match && s.text === "ödev")).toBe(true);
    expect(segs[segs.length - 1]).toEqual({ text: "…", match: false });
    // Kırpılmış kesit, orijinal gövdeden kısa olmalı.
    expect(rendered(long, "ödev").length).toBeLessThan(long.length);
  });

  it("baştaki kısa eşleşmede ön … eklemez", () => {
    const segs = buildSnippet("ödev başında", "ödev");
    expect(segs[0]).toEqual({ text: "ödev", match: true });
  });
});
