import { describe, expect, it } from "vitest";

import {
  agSeviyesi,
  BASLANGIC,
  sesIstatistigiSeviyesi,
  sesKalitesiDegisti,
  type OdaDurumu,
} from "./indirgeyiciler";

describe("bağlantı göstergesi — kamera kapalıyken", () => {
  it("boş istatistik ölçüm sayılmaz; rtt/jitter eşikleri", () => {
    expect(sesIstatistigiSeviyesi({ rtt: 0, jitter: 0, sample_rate: 0 })).toBeNull();
    expect(sesIstatistigiSeviyesi({ rtt: 80, jitter: 5, sample_rate: 48000 })).toBe(4);
    expect(sesIstatistigiSeviyesi({ rtt: 350, jitter: 5, sample_rate: 48000 })).toBe(2);
    expect(sesIstatistigiSeviyesi({ rtt: 80, jitter: 120, sample_rate: 48000 })).toBe(1);
  });

  it("ağ ölçümü yoksa YALNIZ kendi kartım ses istatistiğine düşer", () => {
    let d: OdaDurumu = { ...BASLANGIC, benId: 1 };
    d = sesKalitesiDegisti(d, "encode", 4);
    d = sesKalitesiDegisti(d, "decode", 2);
    expect(agSeviyesi(d, 1)).toBe(2);
    expect(agSeviyesi(d, 2)).toBeNull();
    // Ağ ölçümü varsa o geçer.
    d = { ...d, agKaliteleri: { 1: { uplink: 5 } } };
    expect(agSeviyesi(d, 1)).toBe(5);
  });

  it("değişmeyen seviye aynı durumu döndürür; null değeri siler", () => {
    const d = sesKalitesiDegisti({ ...BASLANGIC }, "decode", 4);
    expect(sesKalitesiDegisti(d, "decode", 4)).toBe(d);
    expect(sesKalitesiDegisti(d, "decode", null).sesKalitesi).toEqual({});
  });
});
