// @vitest-environment node
/**
 * robots.txt nöbetçisi (teknik SEO denetimi, 28 Eyl 2026).
 *
 * İki yönlü iddia:
 *   1. Oturum-içi ve token'lı yüzeyler taranmaz. Denetimde `/yonetim`,
 *      `/bildirimler`, `/mesaj-merkezi`, `/canli-ders/:id` gibi kişisel/yönetim
 *      yolları listede YOKTU; yeni bir panel yolu eklenip buraya yazılmazsa bu
 *      dosya kırılır.
 *   2. Public/SEO yüzeyi yanlışlıkla kapanmaz. Kurallar ÖNEK eşleşmesidir ve
 *      ilan/ders sayfaları kökte yaşar: düz `Disallow: /ogren` yazılsaydı
 *      `/ogrenci-koclugu-ozel-ders` de taranmaz olurdu (robots.txt başı).
 *
 * Eşleştirici Google'ın kuralını izler: en uzun eşleşen kural kazanır, eşitte
 * `Allow`; `$` satır sonu çapasıdır.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PATHS } from "@/lib/routes";

const ROBOTS = readFileSync(join(__dirname, "../../public/robots.txt"), "utf8");

type Kural = { izin: boolean; desen: string };

function kurallar(metin: string): Kural[] {
  return metin
    .split("\n")
    .map((s) => s.replace(/#.*/, "").trim())
    .map((s) => /^(allow|disallow):\s*(\S*)$/i.exec(s))
    .filter((m): m is RegExpExecArray => m !== null && m[2] !== "")
    .map((m) => ({ izin: m[1].toLowerCase() === "allow", desen: m[2] }));
}

function eslesir(desen: string, yol: string): boolean {
  const capali = desen.endsWith("$");
  const govde = (capali ? desen.slice(0, -1) : desen)
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${govde}${capali ? "$" : ""}`).test(yol);
}

const KURALLAR = kurallar(ROBOTS);

function taranabilir(yol: string): boolean {
  let enIyi: Kural | null = null;
  for (const k of KURALLAR) {
    if (!eslesir(k.desen, yol)) continue;
    if (
      !enIyi ||
      k.desen.length > enIyi.desen.length ||
      (k.desen.length === enIyi.desen.length && k.izin)
    ) {
      enIyi = k;
    }
  }
  return enIyi ? enIyi.izin : true;
}

/** `:param` yerine örnek değer koyar. */
const ornek = (desen: string) => desen.replace(/:[A-Za-z]+/g, "x1");

describe("robots.txt", () => {
  it("oturum-içi, token'lı ve yönetim yolları taranmaz", () => {
    const kapali = [
      PATHS.bookings,
      PATHS.reservations,
      PATHS.messages,
      PATHS.messageCenter,
      PATHS.notifications,
      PATHS.calendar,
      PATHS.favorites,
      PATHS.profile,
      PATHS.profileEdit,
      PATHS.addresses,
      PATHS.settings,
      PATHS.accountSettings,
      PATHS.orders,
      PATHS.orderDetail,
      PATHS.balance,
      PATHS.lesson,
      PATHS.canliDers,
      PATHS.libraryReservation,
      PATHS.tutorListing,
      PATHS.tutorOnboarding,
      PATHS.tutorPromotion,
      PATHS.tutorReviews,
      PATHS.tutorAnalytics,
      PATHS.tutorStudents,
      PATHS.sellerProducts,
      PATHS.deliveryRun,
      PATHS.operatorLibrary,
      PATHS.operatorSessions,
      PATHS.admin,
      PATHS.adminUsers,
      PATHS.adminNew,
      PATHS.storeCart,
      PATHS.storeCheckout,
      PATHS.storeCollectionShared,
      PATHS.cargoTracking,
      PATHS.login,
      PATHS.register,
      PATHS.forgotPassword,
      PATHS.resetPassword,
      PATHS.verifyEmail,
      PATHS.googleReturn,
      PATHS.confirmDelete,
    ];
    const acikKalan = kapali.map(ornek).filter(taranabilir);
    expect(acikKalan).toEqual([]);
  });

  it("public/SEO yüzeyi kapanmaz (önek tuzağı dahil)", () => {
    const acik = [
      PATHS.home,
      PATHS.tutors,
      PATHS.libraries,
      PATHS.store,
      PATHS.storeOkulaDonus,
      PATHS.blog,
      PATHS.faq,
      PATHS.contact,
      PATHS.about,
      PATHS.kvkk,
      ornek(PATHS.tutor),
      ornek(PATHS.library),
      ornek(PATHS.storeProduct),
      ornek(PATHS.blogPost),
      // Kök ilan / ders / ilçe adresleri — kapalı yolların önekiyle başlayanlar.
      "/ogrenci-koclugu-ozel-ders",
      "/profil-fotografi-cekimi-kursu",
      "/dersler-icin-matematik-seyhan",
      "/yonetim-bilisim-sistemleri-ozel-ders",
      "/matematik-ozel-ders",
      "/seyhan/matematik-ozel-ders",
    ];
    expect(acik.filter((y) => !taranabilir(y))).toEqual([]);
  });

  it("sitemap kökte ilan edilir", () => {
    expect(ROBOTS).toMatch(/^Sitemap: https:\/\/[^\s]+\/sitemap\.xml$/m);
  });

  it("eşleştirici ayırt eder (ters prova)", () => {
    expect(taranabilir("/hesabim")).toBe(false);
    expect(taranabilir("/hesabim-guvenligi-ozel-ders")).toBe(true);
  });
});
