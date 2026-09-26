import { describe, expect, it } from "vitest";

import type { HamKatilimci } from "../../video/tipler";
import { sesIstatistigiSeviyesi } from "../../video/zoom/cevir";
import {
  agSeviyesi,
  BASLANGIC,
  eliDegisti,
  katilimcilariEsitle,
  sesKalitesiDegisti,
  tepkiGondereni,
  tepkiMesajiCoz,
  tepkiMesajiYaz,
  type OdaDurumu,
} from "./indirgeyiciler";

function kisi(id: string, ek: Partial<HamKatilimci> = {}): HamKatilimci {
  return {
    id,
    ad: id,
    ben: false,
    rol: null,
    videoAcik: false,
    mikKapali: true,
    sesBagli: false,
    paylasiyor: false,
    yenidenBaglaniyor: false,
    ...ek,
  };
}

describe("bağlantı göstergesi — kamera kapalıyken", () => {
  it("boş istatistik ölçüm sayılmaz; rtt/jitter eşikleri", () => {
    expect(sesIstatistigiSeviyesi({ rtt: 0, jitter: 0, sample_rate: 0 })).toBeNull();
    expect(sesIstatistigiSeviyesi({ rtt: 80, jitter: 5, sample_rate: 48000 })).toBe(4);
    expect(sesIstatistigiSeviyesi({ rtt: 350, jitter: 5, sample_rate: 48000 })).toBe(2);
    expect(sesIstatistigiSeviyesi({ rtt: 80, jitter: 120, sample_rate: 48000 })).toBe(1);
  });

  it("ağ ölçümü yoksa YALNIZ kendi kartım ses istatistiğine düşer", () => {
    let d: OdaDurumu = { ...BASLANGIC, benId: "1" };
    d = sesKalitesiDegisti(d, "encode", 4);
    d = sesKalitesiDegisti(d, "decode", 2);
    expect(agSeviyesi(d, "1")).toBe(2);
    expect(agSeviyesi(d, "2")).toBeNull();
    // Ağ ölçümü varsa o geçer.
    d = { ...d, agKaliteleri: { "1": { uplink: 5 } } };
    expect(agSeviyesi(d, "1")).toBe(5);
  });

  it("değişmeyen seviye aynı durumu döndürür; null değeri siler", () => {
    const d = sesKalitesiDegisti({ ...BASLANGIC }, "decode", 4);
    expect(sesKalitesiDegisti(d, "decode", 4)).toBe(d);
    expect(sesKalitesiDegisti(d, "decode", null).sesKalitesi).toEqual({});
  });
});

describe("tepki / el mesajları (ders kanalı)", () => {
  it("yazılan mesaj geri çözülür; tanınmayan emoji ve bozuk gövde reddedilir", () => {
    expect(tepkiMesajiCoz(tepkiMesajiYaz({ tur: "tepki", emoji: "🎉" }))).toEqual({
      tur: "tepki",
      emoji: "🎉",
    });
    expect(tepkiMesajiCoz(tepkiMesajiYaz({ tur: "el", kalkik: true }))).toEqual({
      tur: "el",
      kalkik: true,
    });
    expect(tepkiMesajiCoz(tepkiMesajiYaz({ tur: "elSor" }))).toEqual({ tur: "elSor" });
    expect(tepkiMesajiCoz({ t: "tepki", e: "<img>" })).toBeNull();
    expect(tepkiMesajiCoz("{bozuk")).toBeNull();
    expect(tepkiMesajiCoz(42)).toBeNull();
  });

  it("ayrılanın kalkık eli liste eşitlenince düşer", () => {
    let d: OdaDurumu = { ...BASLANGIC, benId: "1" };
    d = eliDegisti(d, "2", true);
    expect(d.kalkikEller).toEqual(["2"]);
    d = katilimcilariEsitle(d, [kisi("1", { ben: true })]);
    expect(d.kalkikEller).toEqual([]);
  });

  it("gönderen kanal rolüyle eşlenir: karşı rolü taşıyan (kendim olmayan) katılımcı", () => {
    const d = katilimcilariEsitle({ ...BASLANGIC }, [
      kisi("10", { ben: true, rol: "ogretmen", ad: "Ayşe" }),
      kisi("20", { rol: "ogrenci", ad: "Mehmet" }),
    ]);
    expect(tepkiGondereni(d, "ogrenci", "ogretmen")?.id).toBe("20");
    // Kendi rolüm (yankı ya da ikinci sekme) ve bilinmeyen rol eşlenmez.
    expect(tepkiGondereni(d, "ogretmen", "ogretmen")).toBeNull();
    expect(tepkiGondereni(d, null, "ogretmen")).toBeNull();
    // Karşı taraf henüz odada değilse gönderen yok.
    const yalniz = katilimcilariEsitle({ ...BASLANGIC }, [
      kisi("10", { ben: true, rol: "ogretmen" }),
    ]);
    expect(tepkiGondereni(yalniz, "ogrenci", "ogretmen")).toBeNull();
  });
});
