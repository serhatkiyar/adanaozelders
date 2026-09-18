// @vitest-environment node
import { describe, expect, it } from "vitest";
import { regionLabel, shortRegion } from "./region";

describe("shortRegion", () => {
  it("geocode adresinden il · ilçe çıkarır", () => {
    expect(shortRegion("Reşatbey, Çukurova, Adana, 01170, Türkiye")).toBe(
      "Adana · Çukurova"
    );
    expect(shortRegion("Çukurova, Adana")).toBe("Adana · Çukurova");
  });

  it("tek parça varsa onu döner", () => {
    expect(shortRegion("Adana")).toBe("Adana");
  });

  it("posta kodu ve ülkeyi atar", () => {
    expect(shortRegion("Bağlar Mah. No:5, Seyhan, Adana, Türkiye")).toBe(
      "Adana · Seyhan"
    );
    // Yalnız posta kodu + ülke kalırsa anlamlı parça yok → null.
    expect(shortRegion("01170, Türkiye")).toBeNull();
  });

  it("boş/null için null", () => {
    expect(shortRegion("")).toBeNull();
    expect(shortRegion(null)).toBeNull();
    expect(shortRegion(undefined)).toBeNull();
    expect(shortRegion(", , Türkiye")).toBeNull();
  });
});

describe("regionLabel", () => {
  it("yapısal il/ilçe varsa onları kullanır", () => {
    expect(regionLabel("Adana", "Çukurova", "her ne ise")).toBe("Adana · Çukurova");
    expect(regionLabel("Adana", null)).toBe("Adana");
  });
  it("yapısal yoksa adresten türetir (eski kayıt)", () => {
    expect(regionLabel(null, null, "Çukurova, Adana")).toBe("Adana · Çukurova");
  });
  it("hiçbiri yoksa null", () => {
    expect(regionLabel(null, null, null)).toBeNull();
    expect(regionLabel("", "", "")).toBeNull();
  });
});
