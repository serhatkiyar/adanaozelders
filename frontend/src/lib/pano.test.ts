// @vitest-environment node
import { describe, expect, it } from "vitest";
import { gorunurlukEylemi, kalanSure, katilDurumu, panoAltSatir, selamlama } from "@/lib/pano";

const saat = (h: number, m = 0) => new Date(2026, 8, 17, h, m);

describe("selamlama", () => {
  it.each([
    [4, 59, "İyi akşamlar"],
    [5, 0, "Günaydın"],
    [11, 59, "Günaydın"],
    [12, 0, "Tünaydın"],
    [17, 59, "Tünaydın"],
    [18, 0, "İyi akşamlar"],
  ])("%i:%i → %s", (h, m, beklenen) => {
    expect(selamlama(saat(h, m))).toBe(beklenen);
  });
});

describe("katilDurumu", () => {
  const start = new Date("2026-09-17T15:00:00Z").getTime();
  const iso = new Date(start).toISOString();
  const end = new Date(start + 50 * 60000).toISOString();
  const dk = (n: number) => start + n * 60000;

  it("16 dk önce henüz açılmamış, ikincil", () => {
    expect(katilDurumu(iso, end, dk(-16))).toBe("ikincil");
  });
  it("15 dk kala birincil", () => {
    expect(katilDurumu(iso, end, dk(-15))).toBe("birincil");
  });
  it("bitişten 30 dk sonrasına kadar birincil", () => {
    expect(katilDurumu(iso, end, dk(50 + 30))).toBe("birincil");
  });
  it("bitişten 31 dk sonra kapalı", () => {
    expect(katilDurumu(iso, end, dk(50 + 31))).toBe("kapali");
  });
});

describe("kalanSure", () => {
  const now = new Date("2026-09-17T12:00:00Z").getTime();
  const sonra = (dk: number) => new Date(now + dk * 60000).toISOString();
  it("dakika, saat, gün", () => {
    expect(kalanSure(sonra(32), now)).toBe("32 dk sonra");
    expect(kalanSure(sonra(120), now)).toBe("2 sa sonra");
    expect(kalanSure(sonra(3 * 24 * 60), now)).toBe("3 gün sonra");
    expect(kalanSure(sonra(-5), now)).toBe("Şimdi");
  });
});

describe("panoAltSatir", () => {
  const now = new Date(2026, 8, 17, 10, 0);
  it("hiç dersi olmayan yeni öğretmen", () => {
    expect(panoAltSatir({ nextLessonStart: null, completedTotal: 0, now })).toMatch(
      /Burada olman ne güzel/
    );
  });
  it("bugün dersi olan öğretmende alt satır yok", () => {
    const bugun = new Date(2026, 8, 17, 16, 0).toISOString();
    expect(panoAltSatir({ nextLessonStart: bugun, completedTotal: 4, now })).toBeNull();
  });
  it("bugün dersi olmayan öğretmen", () => {
    expect(panoAltSatir({ nextLessonStart: null, completedTotal: 4, now })).toMatch(
      /Bugün dersin yok/
    );
  });
});

describe("gorunurlukEylemi", () => {
  it("bilinen kod eylem döner, bilinmeyen kod çökmez", () => {
    expect(gorunurlukEylemi("NO_AVAILABILITY")?.to).toBeTruthy();
    // IBAN eksikliği panoda uyarı değil (23 Eyl 2026).
    expect(gorunurlukEylemi("PAYOUT_NOT_ACTIVE")).toBeNull();
    expect(gorunurlukEylemi("PENDING_APPROVAL")?.dugme).toBeNull();
    expect(gorunurlukEylemi("YENI_BIR_KOD")).toBeNull();
  });
});
