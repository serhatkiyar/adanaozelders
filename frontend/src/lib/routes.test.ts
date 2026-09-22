// @vitest-environment node
import { LEGACY_STATIC } from "@/App";
import { describe, it, expect } from "vitest";
import { PATHS, ROUTES, ilanYolu, tutorSlug, parseTutorId } from "@/lib/routes";

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
    /*
     * PANEL ŞERİDİ DÜZ (kullanıcı kararı, 22 Eyl 2026).
     *
     * 8–22 Eyl 2026 arasında şeridin sayfaları `/pano/*` altındaydı; 22 Eyl'de
     * yeniden düz oldu (`/takvim`, `/mesajlar`, `/ayarlar` …). Yalnız panonun
     * kendisi `/pano`da kalır. Eski `/pano/*` adresleri yönlendirmedir.
     */
    expect(PATHS.bookings).toBe("/genel-bakis");
    // Öğrencinin listesi panodan ayrıldı (Modül 4, 18 Eyl 2026).
    expect(PATHS.reservations).toBe("/dersler");
    expect(PATHS.messages).toBe("/mesajlar");
    expect(PATHS.tutorListing).toBe("/profil");
    expect(PATHS.tutorReviews).toBe("/degerlendirmeler");
    expect(PATHS.balance).toBe("/bakiyem");
    expect(PATHS.tutorEarnings).toBe("/kazanclar");
    expect(PATHS.tutorCalendar).toBe("/takvim");
    expect(PATHS.tutorAnalytics).toBe("/analizler");
    // Öğrenciler listesi (22 Eyl 2026); kişi sayfası `/uyeler/:id` kalır.
    expect(PATHS.tutorStudents).toBe("/ogrenciler");
    expect(ROUTES.tutorStudents).toBe(PATHS.tutorStudents);
    expect(ROUTES.dersPlanla(5)).toBe("/takvim?ogrenci=5");
    expect(PATHS.profile).toBe("/hesabim");
    expect(PATHS.profileEdit).toBe("/hesabim/profil");
    expect(PATHS.libraryReservation).toBe("/rezervasyon/:tur/:id");
    expect(PATHS.settings).toBe("/ayarlar");
    expect(PATHS.lesson).toBe("/ders-talepleri/:id");
    expect(PATHS.tutorPromotion).toBe("/ilanimi-one-cikar");
    expect(PATHS.tutorOnboarding).toBe("/ilanini-olustur");
    /*
     * ESKİ YOLLAR KALICI YÖNLENDİRMEDİR.
     *
     * Üretimde canlıydılar: DB'deki bildirim satırları, gönderilmiş
     * e-postalar ve kullanıcıların yer imleri bunları taşıyor. Biri silinirse
     * o linkler 404 olur ve bunu ancak eski bir e-postaya tıklayan kullanıcı
     * fark eder. `/pano/*` yolları 8–22 Eyl 2026 arasında canlıydı.
     */
    const eskiYollar = LEGACY_STATIC.map(([from]) => from);
    for (const eski of [
      "/pano",
      "/pano/rezervasyonlar",
      "/rezervasyonlar",
      "/pano/mesajlar",
      "/pano/hesabim",
      "/pano/hesabim/profil",
      "/pano/bakiyem",
      "/pano/kazanclar",
      "/pano/takvim",
      "/pano/analizler",
      "/pano/ilanim",
      "/ilanim",
      "/pano/degerlendirmeler",
      "/ilan-ayarlari",
      // Bilet metaforu kalktı ama bu yönlendirme aynı sebeple duruyor.
      "/biletlerim",
    ]) {
      expect(eskiYollar, `${eski} yönlendirmesi düşmüş`).toContain(eski);
    }
    // ÜK-4: yol `/ogrenciler` değil `/uyeler`. Hesap sahibi öğrenci olmak
    // zorunda değil; eski yol `App.tsx`te yönlendirmeye bağlandı.
    expect(PATHS.uyeProfili).toBe("/uyeler/:id");
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
    expect(ROUTES.uyeProfili(9)).toBe("/uyeler/9");
  });

  it("param üreticileri, PATHS desenindeki `:param`'ı doldurur", () => {
    // Üreticinin çıktısı, deseni `:param` → değer ile değiştirmekle aynı olmalı.
    expect(ROUTES.lesson(7)).toBe(PATHS.lesson.replace(":id", "7"));
    expect(ROUTES.srsDeck(3)).toBe(PATHS.srsDeck.replace(":id", "3"));
    expect(ROUTES.uyeProfili(9)).toBe(PATHS.uyeProfili.replace(":id", "9"));
    expect(ROUTES.tutor("x-1")).toBe(PATHS.tutor.replace(":slug", "x-1"));
  });

  it("messageWith query'yi encode eder", () => {
    expect(ROUTES.messageWith(5, "Ayşe Yılmaz")).toBe(
      "/mesajlar?to=5&name=Ay%C5%9Fe%20Y%C4%B1lmaz",
    );
  });
});

describe("kök SEO adresleri (Modül 6)", () => {
  it("adres üreticileri desenle birebir ve önek taşımaz", () => {
    expect(ROUTES.ilan("lgs-yks-matematik-seyhan")).toBe("/lgs-yks-matematik-seyhan");
    expect(ROUTES.ilan("x-y")).toBe(PATHS.kokAdres.replace(":kokSlug", "x-y"));
    expect(ROUTES.dersSayfasi("matematik")).toBe("/matematik-ozel-ders");
    expect(ROUTES.ilceDersSayfasi("seyhan", "matematik")).toBe(
      PATHS.ilceDersSayfasi
        .replace(":ilce", "seyhan")
        .replace(":dersSayfasi", "matematik-ozel-ders")
    );
  });

  it("öğretmen linki TEK kapıdan: ilan adresi varsa o, yoksa eski adres", () => {
    expect(ilanYolu({ id: 4, slug: "dilan-4", url_slug: "lgs-matematik-seyhan" })).toBe(
      "/lgs-matematik-seyhan"
    );
    // Hiç yayınlanmamış ilan: eski adres (rota sayfayı açar, adres doğunca yönlenir).
    expect(ilanYolu({ id: 4, slug: "dilan-4", url_slug: null })).toBe("/egitmenler/dilan-4");
    expect(ilanYolu({ id: 4 })).toBe("/egitmenler/4");
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
