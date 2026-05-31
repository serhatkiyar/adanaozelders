import { describe, it, expect } from "vitest";
import { isLessonJoinable, jitsiUrl, mapsUrl } from "@/lib/lesson";

const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe("isLessonJoinable", () => {
  it("başlangıca 5 dk kala açık", () => {
    expect(isLessonJoinable(inMin(5), inMin(65))).toBe(true);
  });
  it("15 dk'dan erken kapalı", () => {
    expect(isLessonJoinable(inMin(30), inMin(90))).toBe(false);
  });
  it("bitişten 30 dk sonra kapalı", () => {
    expect(isLessonJoinable(inMin(-120), inMin(-60))).toBe(false);
  });
  it("bitişten hemen sonra (30 dk içinde) hâlâ açık", () => {
    expect(isLessonJoinable(inMin(-70), inMin(-10))).toBe(true);
  });
});

describe("url yardımcıları", () => {
  it("jitsi oda adını encode eder", () => {
    expect(jitsiUrl("oda 1")).toBe("https://meet.jit.si/oda%201");
  });
  it("maps adresi encode eder", () => {
    expect(mapsUrl("Ceyhan Meydan")).toContain("query=Ceyhan%20Meydan");
  });
});
