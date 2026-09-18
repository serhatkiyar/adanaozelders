// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "@/lib/quickParse";

const now = new Date(2026, 5, 1, 9, 0); // 1 Haziran 2026, 09:00 yerel
const ctx = {
  projects: [{ id: 7, name: "İş" }, { id: 9, name: "Okul" }],
  labels: [{ id: 3, name: "acil" }],
  now,
};

const iso = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo, d, h, mi).toISOString();

describe("parseQuickAdd", () => {
  it("tarih + saat + öncelik + proje + etiket çıkarır", () => {
    const r = parseQuickAdd("Rapor yarın 17:00 !1 #İş @acil", ctx);
    expect(r.title).toBe("Rapor");
    expect(r.priority).toBe(1);
    expect(r.listId).toBe(7);
    expect(r.labelIds).toEqual([3]);
    expect(r.dueIso).toBe(iso(2026, 5, 2, 17, 0));
    expect(r.recurrence).toBeNull();
  });

  it("saat verilmezse gün sonu (23:59) atar", () => {
    const r = parseQuickAdd("Sunum bugün", ctx);
    expect(r.title).toBe("Sunum");
    expect(r.dueIso).toBe(iso(2026, 5, 1, 23, 59));
  });

  it("p-biçimi öncelik ve 'N gün sonra'", () => {
    const r = parseQuickAdd("Tekrar p3 3 gün sonra", ctx);
    expect(r.title).toBe("Tekrar");
    expect(r.priority).toBe(3);
    expect(r.dueIso).toBe(iso(2026, 5, 4, 23, 59));
  });

  it("açık tarih: '15 haziran'", () => {
    const r = parseQuickAdd("Faturayı öde 15 haziran", ctx);
    expect(r.title).toBe("Faturayı öde");
    expect(r.dueIso).toBe(iso(2026, 5, 15, 23, 59));
  });

  it("geçmiş ay-günü gelecek yıla taşınır", () => {
    const r = parseQuickAdd("Yıllık kontrol 15 ocak", ctx);
    expect(new Date(r.dueIso!).getFullYear()).toBe(2027);
  });

  it("tekrar: 'her gün' bugüne çapalanır", () => {
    const r = parseQuickAdd("Su iç her gün", ctx);
    expect(r.title).toBe("Su iç");
    expect(r.recurrence).toBe("daily");
    expect(r.dueIso).toBe(iso(2026, 5, 1, 23, 59));
  });

  it("tekrar: 'her Pazartesi' -> weekly + bir Pazartesi'ye düşer", () => {
    const r = parseQuickAdd("Spor her Pazartesi", ctx);
    expect(r.recurrence).toBe("weekly");
    expect(new Date(r.dueIso!).getDay()).toBe(1); // Pazartesi
  });

  it("hafta içi -> weekdays", () => {
    const r = parseQuickAdd("Ders çalış hafta içi 20:00", ctx);
    expect(r.recurrence).toBe("weekdays");
    expect(new Date(r.dueIso!).getHours()).toBe(20);
  });

  it("eşleşmeyen @etiket newLabelNames'e düşer", () => {
    const r = parseQuickAdd("Görev @yeni @acil", ctx);
    expect(r.labelIds).toEqual([3]);
    expect(r.newLabelNames).toEqual(["yeni"]);
    expect(r.title).toBe("Görev");
  });

  it("özel token yoksa metni aynen başlık yapar", () => {
    const r = parseQuickAdd("Sadece düz bir görev", ctx);
    expect(r.title).toBe("Sadece düz bir görev");
    expect(r.dueIso).toBeNull();
    expect(r.priority).toBeUndefined();
  });
});
