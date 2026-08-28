/**
 * ── Alışveriş rolü nöbetçisi (eğitmen alıcı turu) ──
 *
 * Ürün kararı: mağazada alıcı olabilen roller ARTIK TEK DEĞİL — öğrenciye ek
 * olarak eğitmen de kendi oturumuyla alışveriş yapar (sunucu tarafında bir
 * `Client` yansımasına çevrilir; bkz. docs/egitmen-alici-sozlesme.md).
 *
 * Bu yüzden alıcı yüzeyinde çıplak `ROLE_IDS.CLIENT` karşılaştırması SESSİZ
 * BİR HATADIR: backend eğitmene 200 döner ama arayüz onu öğrenci değil diye
 * eler — sepet dolar, ödeme düğmesi çalışmaz ve kimse fark etmez. Tek kaynak
 * `lib/roles.ts::alisverisYapabilir`'dir.
 *
 * Nöbetçi YALNIZ alıcı yüzeyini tarar. Kapsam dışı yüzeyler (eğitmen yer
 * imleri, denemeler, ders rezervasyonu) hâlâ öğrenciye özeldir ve orada
 * `ROLE_IDS.CLIENT` DOĞRU koddur — bu yüzden burada yasaklanmaz.
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function srcKoku(): string {
  let dizin = process.cwd();
  for (let i = 0; i < 4; i++) {
    for (const aday of ["src", "frontend/src"]) {
      const yol = join(dizin, aday);
      if (existsSync(join(yol, "main.tsx"))) return yol;
    }
    dizin = join(dizin, "..");
  }
  throw new Error("src koku bulunamadi — nobetci olcemedi");
}

/** Mağaza alıcı yüzeyi: sepet → ödeme → siparişler → adres → favori/koleksiyon. */
const ALICI_YUZEYI = [
  "pages/store/CartPage.tsx",
  "pages/store/CheckoutPage.tsx",
  "pages/store/OrdersPage.tsx",
  "pages/store/OrderDetailPage.tsx",
  "pages/store/FavoritesPage.tsx",
  "pages/store/ProductDetailPage.tsx",
  "pages/AddressesPage.tsx",
  "components/store/StoreAccountMenu.tsx",
  "components/StoreFavoritesSync.tsx",
  "hooks/useAddresses.ts",
  "store/favoritesStore.ts",
];

const YORUM = /^\s*(\/\/|\*|\/\*)/;
const CIPLAK_ROL = /ROLE_IDS\.CLIENT/;

function ihlaller(): string[] {
  const kok = srcKoku();
  const bulunan: string[] = [];
  for (const gorece of ALICI_YUZEYI) {
    const yol = join(kok, gorece);
    if (!existsSync(yol)) {
      // Dosya taşındıysa nöbetçi sessizce körleşmesin.
      bulunan.push(`${gorece}: DOSYA YOK — envanter güncellenmeli`);
      continue;
    }
    readFileSync(yol, "utf8")
      .split("\n")
      .forEach((satir, i) => {
        if (YORUM.test(satir)) return;
        if (CIPLAK_ROL.test(satir)) bulunan.push(`${gorece}:${i + 1}`);
      });
  }
  return bulunan;
}

describe("alışveriş rolü nöbetçisi", () => {
  it("alıcı yüzeyinde çıplak ROLE_IDS.CLIENT karşılaştırması KALMAZ", () => {
    expect(ihlaller()).toEqual([]);
  });

  it("dedektör gerçek bir karşılaştırmayı yakalar (ters prova)", () => {
    expect(CIPLAK_ROL.test("  if (user.role_id === ROLE_IDS.CLIENT) {")).toBe(true);
    expect(YORUM.test("  // ROLE_IDS.CLIENT eskiden burada kullanılıyordu")).toBe(
      true,
    );
  });
});
