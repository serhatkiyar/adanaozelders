// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyDue, isoToLocalInput } from "@/lib/taskView";

describe("classifyDue", () => {
  const now = new Date(2026, 5, 1, 12, 0); // 1 Haziran 2026 12:00 yerel

  it("son tarihi olmayan -> none", () => {
    expect(classifyDue(null, now)).toBe("none");
    expect(classifyDue(undefined, now)).toBe("none");
  });

  it("geçersiz tarih -> none", () => {
    expect(classifyDue("not-a-date", now)).toBe("none");
  });

  it("geçmiş -> overdue", () => {
    const past = new Date(2026, 5, 1, 11, 0).toISOString();
    expect(classifyDue(past, now)).toBe("overdue");
  });

  it("aynı gün, ileri saat -> today", () => {
    const later = new Date(2026, 5, 1, 18, 0).toISOString();
    expect(classifyDue(later, now)).toBe("today");
  });

  it("yarın -> upcoming", () => {
    const tomorrow = new Date(2026, 5, 2, 9, 0).toISOString();
    expect(classifyDue(tomorrow, now)).toBe("upcoming");
  });
});

describe("isoToLocalInput", () => {
  it("boş/null -> boş string", () => {
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput(undefined)).toBe("");
  });

  it("ISO -> datetime-local biçimi (yerel)", () => {
    const local = new Date(2026, 5, 1, 9, 5);
    expect(isoToLocalInput(local.toISOString())).toBe("2026-06-01T09:05");
  });
});
