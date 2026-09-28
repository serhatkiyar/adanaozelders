// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bazTip, kameraHataMesaji, kameraKisitlari, kayitDosyaAdi, kayitMimeSec } from "./kameraKaydi";

describe("kayitMimeSec", () => {
  it("Safari: mp4 destekleniyorsa mp4 seçilir", () => {
    expect(kayitMimeSec((t) => t.startsWith("video/mp4"))).toBe("video/mp4;codecs=avc1,mp4a");
  });
  it("Chrome: mp4 yoksa vp9 webm", () => {
    expect(kayitMimeSec((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
  });
  it("hiçbiri desteklenmiyorsa null; hata fırlatan tarayıcıda da çökmez", () => {
    expect(kayitMimeSec(() => false)).toBeNull();
    expect(
      kayitMimeSec((t) => {
        if (t.includes("codecs")) throw new Error("x");
        return t === "video/webm";
      })
    ).toBe("video/webm");
  });
});

describe("baz tip ve dosya adı", () => {
  it("codec parametresi atılır", () => {
    expect(bazTip("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(bazTip("video/mp4;codecs=avc1,mp4a")).toBe("video/mp4");
    expect(kayitDosyaAdi("video/mp4")).toBe("kamera-kaydi.mp4");
    expect(kayitDosyaAdi("video/webm;codecs=vp8,opus")).toBe("kamera-kaydi.webm");
  });
});

describe("kamera hataları ve kısıtlar", () => {
  it("izin reddi, cihaz yok ve meşgul kamera ayrı mesajlar", () => {
    expect(kameraHataMesaji({ name: "NotAllowedError" })).toMatch(/izni verilmedi/);
    expect(kameraHataMesaji({ name: "NotFoundError" })).toMatch(/bulunamadı/);
    expect(kameraHataMesaji({ name: "NotReadableError" })).toMatch(/başka bir uygulama/);
    expect(kameraHataMesaji(new Error("x"))).toMatch(/açılamadı/);
  });
  it("720p hedef; cihaz seçilince exact deviceId", () => {
    const k = kameraKisitlari() as { video: Record<string, unknown>; audio: unknown };
    expect(k.video).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" });
    expect(k.audio).toBe(true);
    expect((kameraKisitlari("cam1").video as Record<string, unknown>).deviceId).toEqual({ exact: "cam1" });
  });
});
