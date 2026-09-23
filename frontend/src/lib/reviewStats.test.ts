// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  degerlendirmeTarihi,
  kriterOrtalamalari,
  reviewOutToItem,
  toDistributionRows,
} from "@/lib/reviewStats";
import type { ReviewOut } from "@/types";

describe("toDistributionRows", () => {
  it("boş/tanımsız girdide 5 satır, hepsi 0", () => {
    const rows = toDistributionRows(undefined);
    expect(rows.map((r) => r.star)).toEqual([5, 4, 3, 2, 1]);
    expect(rows.every((r) => r.count === 0 && r.pct === 0)).toBe(true);
  });

  it("yıldızları 5'ten 1'e sıralar", () => {
    const rows = toDistributionRows({
      count: 0,
      distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
    });
    expect(rows.map((r) => r.star)).toEqual([5, 4, 3, 2, 1]);
  });

  it("yüzdeleri toplam üzerinden hesaplar", () => {
    const rows = toDistributionRows({
      count: 100,
      distribution: { "5": 90, "4": 10, "3": 0, "2": 0, "1": 0 },
    });
    const byStar = Object.fromEntries(rows.map((r) => [r.star, r]));
    expect(byStar[5].count).toBe(90);
    expect(byStar[5].pct).toBeCloseTo(90, 5);
    expect(byStar[4].pct).toBeCloseTo(10, 5);
    expect(byStar[3].pct).toBe(0);
  });

  it("eksik yıldız anahtarlarını 0 sayar", () => {
    const rows = toDistributionRows({
      count: 3,
      distribution: { "5": 3 },
    });
    const byStar = Object.fromEntries(rows.map((r) => [r.star, r]));
    expect(byStar[5].pct).toBeCloseTo(100, 5);
    expect(byStar[2].count).toBe(0);
    expect(byStar[2].pct).toBe(0);
  });

  it("toplam 0 iken bölme hatası vermez", () => {
    const rows = toDistributionRows({ count: 0, distribution: {} });
    expect(rows.every((r) => r.pct === 0)).toBe(true);
  });
});

describe("degerlendirmeTarihi", () => {
  it("düzenlenmemişse yalnız oluşturma tarihi", () => {
    expect(degerlendirmeTarihi("2026-09-12T10:00:00Z")).toBe("12 Eylül 2026");
  });
  it("düzenlendiyse edited_at ikinci tarih olur", () => {
    expect(
      degerlendirmeTarihi("2026-09-12T10:00:00Z", "2026-09-20T10:00:00Z")
    ).toBe("12 Eylül 2026 · Düzenlendi 20 Eylül 2026");
  });
});

describe("reviewOutToItem", () => {
  const temel: ReviewOut = {
    id: 1,
    booking_id: 10,
    client_id: 20,
    tutor_id: 30,
    rating: 5,
    comment_text: "Harika",
    is_anonymous: false,
    created_at: "2026-09-12T10:00:00Z",
    client_name: "Ayşe",
    client_avatar_url: "avatars/a.jpg",
  };
  it("anonimse ad 'Anonim Öğrenci', fotoğraf yok", () => {
    const item = reviewOutToItem({ ...temel, is_anonymous: true });
    expect(item.name).toBe("Anonim Öğrenci");
    expect(item.avatarUrl).toBeNull();
    expect(item.anonymous).toBe(true);
  });
  it("anonim değilse ad ve fotoğraf korunur", () => {
    const item = reviewOutToItem(temel);
    expect(item.name).toBe("Ayşe");
    expect(item.avatarUrl).toBe("avatars/a.jpg");
  });
});

describe("kriterOrtalamalari", () => {
  it("yalnız puan almış kriterleri döner", () => {
    expect(
      kriterOrtalamalari({
        count: 2,
        distribution: {},
        clarity_average: 4.9,
        motivation_average: null,
        preparation_average: 4.7,
      })
    ).toEqual([
      { ad: "Netlik", ortalama: 4.9 },
      { ad: "Hazırlık", ortalama: 4.7 },
    ]);
  });
});
