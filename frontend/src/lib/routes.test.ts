import { describe, it, expect } from "vitest";
import { PATHS, ROUTES, tutorSlug, parseTutorId } from "@/lib/routes";

describe("PATHS — düz (flat) semantik yapı", () => {
  it("hiçbir path `/panel` öneki taşımaz", () => {
    for (const value of Object.values(PATHS)) {
      expect(value.startsWith("/panel")).toBe(false);
      expect(value.includes("/panel/")).toBe(false);
    }
  });

  it("tüm path'ler kökten (`/`) başlar", () => {
    for (const value of Object.values(PATHS)) {
      expect(value.startsWith("/")).toBe(true);
    }
  });

  it("kanonik mappingleri birebir tutar", () => {
    // Public
    expect(PATHS.home).toBe("/");
    expect(PATHS.tutors).toBe("/egitmenler");
    expect(PATHS.tutor).toBe("/egitmenler/:slug");
    // Kimlik
    expect(PATHS.login).toBe("/giris");
    expect(PATHS.register).toBe("/kayit");
    // Ortak oturum-içi
    expect(PATHS.profile).toBe("/hesabim");
    expect(PATHS.messages).toBe("/mesajlar");
    expect(PATHS.settings).toBe("/ayarlar");
    // Rezervasyonlar (CLIENT liste: ders + bilet) + ders/talep detayı (ortak stem)
    expect(PATHS.bookings).toBe("/rezervasyonlar");
    expect(PATHS.lesson).toBe("/ders-talepleri/:id");
    // Tutor yüzeyi
    expect(PATHS.tutorListing).toBe("/ilan-ayarlari");
    expect(PATHS.studentProfile).toBe("/ogrenciler/:id");
    // Client yüzeyi
    expect(PATHS.favorites).toBe("/favoriler");
    expect(PATHS.exams).toBe("/denemeler");
    expect(PATHS.tasks).toBe("/gorevler");
    // Öğren alt ağacı
    expect(PATHS.learn).toBe("/ogren");
    expect(PATHS.deepwork).toBe("/ogren/zamanlayici");
    expect(PATHS.grapher).toBe("/ogren/grafik");
    expect(PATHS.habits).toBe("/ogren/aliskanliklar");
    expect(PATHS.calendar).toBe("/takvim");
    expect(PATHS.questions).toBe("/sorular");
    expect(PATHS.leaderboard).toBe("/liderlik");
  });
});

describe("ROUTES — tek kaynak tutarlılığı", () => {
  it("statik ROUTES değerleri ilgili PATHS desenine eşittir (drift yok)", () => {
    expect(ROUTES.home).toBe(PATHS.home);
    expect(ROUTES.tutors).toBe(PATHS.tutors);
    expect(ROUTES.login).toBe(PATHS.login);
    expect(ROUTES.bookings).toBe(PATHS.bookings);
    expect(ROUTES.messages).toBe(PATHS.messages);
    expect(ROUTES.profile).toBe(PATHS.profile);
    expect(ROUTES.settings).toBe(PATHS.settings);
    expect(ROUTES.tutorListing).toBe(PATHS.tutorListing);
    expect(ROUTES.favorites).toBe(PATHS.favorites);
    expect(ROUTES.learn).toBe(PATHS.learn);
  });

  it("param üreticileri doğru somut URL üretir", () => {
    expect(ROUTES.tutor("ahmet-yilmaz-42")).toBe("/egitmenler/ahmet-yilmaz-42");
    expect(ROUTES.tutor(42)).toBe("/egitmenler/42");
    expect(ROUTES.lesson(7)).toBe("/ders-talepleri/7");
    expect(ROUTES.srsDeck(3)).toBe("/ogren/tekrar/deste/3");
    expect(ROUTES.studentProfile(9)).toBe("/ogrenciler/9");
  });

  it("param üreticileri, PATHS desenindeki `:param`'ı doldurur", () => {
    // Üreticinin çıktısı, deseni `:param` → değer ile değiştirmekle aynı olmalı.
    expect(ROUTES.lesson(7)).toBe(PATHS.lesson.replace(":id", "7"));
    expect(ROUTES.srsDeck(3)).toBe(PATHS.srsDeck.replace(":id", "3"));
    expect(ROUTES.studentProfile(9)).toBe(PATHS.studentProfile.replace(":id", "9"));
    expect(ROUTES.tutor("x-1")).toBe(PATHS.tutor.replace(":slug", "x-1"));
  });

  it("messageWith query'yi encode eder", () => {
    expect(ROUTES.messageWith(5, "Ayşe Yılmaz")).toBe(
      "/mesajlar?to=5&name=Ay%C5%9Fe%20Y%C4%B1lmaz",
    );
  });
});

describe("slug yardımcıları", () => {
  it("tutorSlug backend slug'ını tercih eder, yoksa id'ye düşer", () => {
    expect(tutorSlug({ id: 42, slug: "ahmet-yilmaz-42" })).toBe("ahmet-yilmaz-42");
    expect(tutorSlug({ id: 42, slug: null })).toBe("42");
    expect(tutorSlug({ id: 42 })).toBe("42");
  });

  it("parseTutorId sondaki sayıyı çıkarır", () => {
    expect(parseTutorId("ahmet-yilmaz-42")).toBe(42);
    expect(parseTutorId("42")).toBe(42);
    expect(parseTutorId(undefined)).toBeNaN();
    expect(parseTutorId("slug-yok")).toBeNaN();
  });
});
