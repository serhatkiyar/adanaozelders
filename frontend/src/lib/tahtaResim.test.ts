// @vitest-environment node
import { describe, expect, it } from "vitest";

import { dataUrlCoz, resimDosyaAdi, resimKaynagi, resimUzantisi } from "./tahtaResim";

describe("tahta resimleri", () => {
  it("yalnız png/jpeg/webp/gif kabul edilir; uzantı gerçek türden", () => {
    expect(resimUzantisi("image/png")).toBe("png");
    expect(resimUzantisi("IMAGE/JPEG")).toBe("jpg");
    expect(resimUzantisi("image/svg+xml")).toBeNull();
    expect(resimUzantisi(undefined)).toBeNull();
    expect(resimDosyaAdi("abc/..:1", "image/webp")).toBe("tahta-resim-abc1.webp");
    expect(resimDosyaAdi("abc", "image/svg+xml")).toBeNull();
  });

  it("data: adresi çözülür, bozuğu null", () => {
    const c = dataUrlCoz("data:image/png;base64,AAEC");
    expect(c?.tur).toBe("image/png");
    expect([...(c?.veri ?? [])]).toEqual([0, 1, 2]);
    expect(dataUrlCoz("data:image/png,ham")).toBeNull();
    expect(dataUrlCoz("https://x/y.png")).toBeNull();
  });

  it("kaynak, aynı dosyayı gösteren herhangi bir elemandan bulunur", () => {
    const elemanlar = [
      { type: "image", fileId: "f1", customData: null },
      { type: "rectangle" },
      { type: "image", fileId: "f1", customData: { kaynak: 42 } },
    ];
    expect(resimKaynagi(elemanlar, "f1")).toBe(42);
    expect(resimKaynagi(elemanlar, "f2")).toBeNull();
  });
});
