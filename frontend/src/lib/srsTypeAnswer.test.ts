// İP-16 T-5/T-6/T-7 — yazarak cevaplama karşılaştırma kuralları.
// Sözleşme (docs/ip16-aralikli-tekrar-sozlesme.md §6 T-6): trim + ardışık boşluk
// teke iner + Unicode NFC + TÜRKÇE locale-aware küçük harf (İ→i, I→ı);
// noktalama korunur. Anki'nin case-duyarlı varsayılanından bilinçli sapma.
import { describe, expect, it } from "vitest";

import {
  compareTypedAnswer,
  normalizeAnswer,
  normalizeInvariantAnswer,
} from "./srsTypeAnswer";

describe("normalizeAnswer (T-6)", () => {
  it("baş/son boşlukları kırpar, ardışık boşlukları teke indirir", () => {
    expect(normalizeAnswer("  merhaba   dünya  ")).toBe("merhaba dünya");
  });

  it("Türkçe İ → i katlaması doğru (naif toLowerCase 'i̇' üretirdi)", () => {
    // "İSTANBUL".toLowerCase() = "i̇stanbul" (i + U+0307) — YANLIŞ.
    const n = normalizeAnswer("İSTANBUL");
    expect(n).toBe("istanbul");
    expect(n.includes("̇")).toBe(false);
  });

  it("Türkçe I → ı katlaması doğru (locale'siz lowercase 'i' verirdi)", () => {
    expect(normalizeAnswer("ILIK")).toBe("ılık");
  });

  it("NFC normalizasyonu: ayrık combining işaretler birleşik forma iner", () => {
    // "e" + U+0301 (combining acute) ≡ "é" (U+00E9)
    expect(normalizeAnswer("café")).toBe(normalizeAnswer("café"));
  });

  it("noktalama korunur", () => {
    expect(normalizeAnswer("a, b!")).toBe("a, b!");
  });
});

describe("çift katlama (B2): Türkçe VE invariant, herhangi biri tutarsa doğru", () => {
  // Tek başına Türkçe katlama, Türkçe olmayan kelimelerde I → ı yapıp
  // "IELTS"i "ielts"ten ayırıyordu; tek başına invariant katlama ise
  // "İstanbul"u "istanbul"dan ayırıyordu (i + U+0307). Deste dil alanı
  // taşımadığı için karar: iki katlama da üretilir, HERHANGİ biri tutarsa
  // cevap doğru sayılır (yanlış-negatifi yanlış-pozitife tercih ederiz —
  // puanı zaten kullanıcı verir).
  it.each([
    ["IELTS", "ielts"],
    ["ielts", "IELTS"],
    ["IMPORTANT", "important"],
    ["AI", "ai"],
    ["İstanbul", "istanbul"],
    ["istanbul", "İSTANBUL"],
    ["ISPARTA", "ısparta"],
    ["Isparta", "ısparta"],
  ])("%s ↔ %s eşleşir", (beklenen, yazilan) => {
    expect(compareTypedAnswer(beklenen, yazilan).correct).toBe(true);
  });

  it("gerçekten farklı cevap hâlâ yanlış (katlama gevşemesi her şeyi kabul etmez)", () => {
    expect(compareTypedAnswer("Isparta", "Ispanya").correct).toBe(false);
    expect(compareTypedAnswer("ielts", "toefl").correct).toBe(false);
  });

  it("her iki normalizasyon da dışarıya açık ve farklı sonuç üretebilir", () => {
    expect(normalizeAnswer("IELTS")).toBe("ıelts");
    expect(normalizeInvariantAnswer("IELTS")).toBe("ielts");
    expect(normalizeAnswer("İstanbul")).toBe("istanbul");
    expect(normalizeInvariantAnswer("İstanbul")).not.toBe("istanbul");
  });
});

describe("compareTypedAnswer (T-5)", () => {
  it("birebir doğru cevap eşleşir", () => {
    expect(compareTypedAnswer("Ankara", "Ankara").correct).toBe(true);
  });

  it("büyük/küçük harf ve kenar boşlukları farkı doğru sayılır", () => {
    expect(compareTypedAnswer("Ankara", "  ANKARA ").correct).toBe(true);
    expect(compareTypedAnswer("ILIK su", "ılık   su").correct).toBe(true);
  });

  it("yanlış cevap yanlış sayılır", () => {
    expect(compareTypedAnswer("Ankara", "İzmir").correct).toBe(false);
  });

  it("noktalama farkı yanlış sayılır (kural: noktalama korunur)", () => {
    expect(compareTypedAnswer("a, b", "a b").correct).toBe(false);
  });
});

describe("fark vurgusu (T-7)", () => {
  it("yanlış yazımda doğru/yanlış/eksik parçalar ayrışır", () => {
    const s = compareTypedAnswer("fotosentez", "fotosentes");
    expect(s.correct).toBe(false);
    const kinds = new Set(s.segments.map((p) => p.kind));
    expect(kinds.has("good")).toBe(true); // ortak önek "fotosente"
    expect(kinds.has("bad") || kinds.has("missed")).toBe(true);
    // Yazılan metnin doğru kısmı good segmentlerinde geçmeli.
    const good = s.segments
      .filter((p) => p.kind === "good")
      .map((p) => p.text)
      .join("");
    expect(good.startsWith("fotosente")).toBe(true);
  });

  it("eksik kalan kuyruk 'missed' olarak işaretlenir", () => {
    const s = compareTypedAnswer("uzun cevap", "uzun");
    expect(s.correct).toBe(false);
    const missed = s.segments
      .filter((p) => p.kind === "missed")
      .map((p) => p.text)
      .join("");
    expect(missed).toContain("cevap");
  });

  it("fazladan yazılan parça 'bad' olarak işaretlenir", () => {
    const s = compareTypedAnswer("kısa", "kısa fazlalık");
    expect(s.correct).toBe(false);
    const bad = s.segments
      .filter((p) => p.kind === "bad")
      .map((p) => p.text)
      .join("");
    expect(bad).toContain("fazlalık");
  });

  it("doğru cevapta tek 'good' segmenti döner", () => {
    const s = compareTypedAnswer("tam doğru", "tam doğru");
    expect(s.segments).toEqual([{ text: "tam doğru", kind: "good" }]);
  });
});
