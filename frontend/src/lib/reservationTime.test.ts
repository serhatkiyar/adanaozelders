import { describe, expect, it } from "vitest";

import { goreliGun, mutlakZaman, tarihCipasi } from "./reservationTime";

// Rezervasyon ekranlarında zaman MUTLAK birincil, göreli ikincildir: randevu
// ekranı ekran görüntüsü alınıp paylaşılabilir olmalı ve "yarın 14:00" tek
// başına hangi güne denk geldiğini doğrulatmaz (UX Movement / Close).

describe("mutlakZaman", () => {
  it("aynı gün içindeki aralığı tek tarihle yazar", () => {
    expect(mutlakZaman("2026-09-03T14:00:00+03:00", "2026-09-03T15:00:00+03:00")).toBe(
      "3 Eylül Perşembe · 14:00–15:00",
    );
  });

  it("bitiş yoksa yalnız başlangıç saatini yazar", () => {
    expect(mutlakZaman("2026-09-03T14:00:00+03:00", null)).toBe("3 Eylül Perşembe · 14:00");
  });

  it("gece yarısını aşan aralıkta İKİ tarihi de yazar", () => {
    // Tek tarih yazmak "23:00–01:00" gibi bir aralığı aynı güne aitmiş gibi
    // gösterir; kullanıcı hangi gün bittiğini bilemez.
    expect(mutlakZaman("2026-09-03T23:00:00+03:00", "2026-09-04T01:00:00+03:00")).toBe(
      "3 Eylül Perşembe 23:00 → 4 Eylül Cuma 01:00",
    );
  });

  it("saat İSTANBUL saatidir, tarayıcının saat dilimi değil", () => {
    // Sunucu UTC gönderir; mekân fizikseldir ve saati İstanbul'dur.
    expect(mutlakZaman("2026-09-03T11:00:00Z", "2026-09-03T12:00:00Z")).toBe(
      "3 Eylül Perşembe · 14:00–15:00",
    );
  });
});

describe("goreliGun", () => {
  const simdi = new Date("2026-09-03T10:00:00+03:00");

  it("bugün ve yarın kelimeyle yazılır", () => {
    expect(goreliGun("2026-09-03T18:00:00+03:00", simdi)).toBe("bugün");
    expect(goreliGun("2026-09-04T09:00:00+03:00", simdi)).toBe("yarın");
  });

  it("gün farkı SAAT değil TAKVİM GÜNÜ üzerinden sayılır", () => {
    // 23:00 → ertesi gün 01:00 arası yalnız 2 saattir ama "yarın"dır.
    expect(goreliGun("2026-09-04T01:00:00+03:00", new Date("2026-09-03T23:00:00+03:00"))).toBe(
      "yarın",
    );
  });

  it("ileri günler sayıyla, geçmiş 'geçti' ile yazılır", () => {
    expect(goreliGun("2026-09-06T09:00:00+03:00", simdi)).toBe("3 gün sonra");
    expect(goreliGun("2026-09-01T09:00:00+03:00", simdi)).toBe("geçti");
  });

  it("bozuk/boş tarihte null döner (ekran çökmez)", () => {
    expect(goreliGun(null, simdi)).toBeNull();
    expect(goreliGun("bozuk", simdi)).toBeNull();
  });
});

describe("tarihCipasi", () => {
  it("liste satırının sol çıpası: gün kısaltması, sayı, ay", () => {
    expect(tarihCipasi("2026-09-03T14:00:00+03:00")).toEqual({
      gun: "Per",
      sayi: "03",
      ay: "Eyl",
    });
  });

  it("İstanbul günü kullanılır — UTC gece yarısı ertesi güne kaymaz", () => {
    // 2 Eylül 22:00 UTC = 3 Eylül 01:00 İstanbul.
    expect(tarihCipasi("2026-09-02T22:00:00Z").sayi).toBe("03");
  });
});
