// @vitest-environment node
/**
 * GİRİŞ KAPISI TEK KAPIDAN GEÇER — kaynak taraması.
 *
 * ## Ölçtüğü kusur sınıfı
 *
 * Kapı sekiz ayrı yerde `<Link to="?modal=login">` / `navigate("?modal=login")`
 * ile elle kuruluyordu ve hepsi aynı bug'ı taşıyordu: React Router'da
 * search-only bir `to` mevcut sorguyu birleştirmez, DEĞİŞTİRİR — filtreler
 * uçuyordu.
 *
 * Bug tek tek düzeltildi ama asıl risk DOKUZUNCU kopyanın sessizce doğması.
 * Yeni bir CTA yazan kişi çevredeki koda bakar; kalıp orada durduğu sürece
 * kopyalanır. Bu düğüm kalıbı ağaçtan siler.
 *
 * İkinci yön: tıklamayla tam sayfa `/giris`e gitmek. `Login` başarıda
 * `roleHome()`e götürdüğü (ya da `?git=` yoksa) kullanıcı geldiği yere
 * DÖNMEZ — bağlam sessizce kaybolur.
 *
 * ## Neden dizin yürüyüşü GÜVENLİ burada
 *
 * Tarama belirli bir KÖTÜ KALIBI arar; dosya SAYISINA dayanmaz. Bu yüzden
 * yeni eklenen bir dosya "sayı tutuyor" diye kaçamaz. Yine de yürüyüşün
 * kendisinin çalıştığı ayrı bir düğümle ölçülür.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Kaynak sözleşmesidir: davranış değil KÖKEN ölçer. Kapının doğru adres
 * ürettiğini `kapiSorguyuKorur`, sayfaların kaybolmadığını
 * `eylemKapisiSayfayiKorur` ölçer.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const YOL_ONEKI = /^\/([A-Za-z]:)/;
const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(YOL_ONEKI, "$1")),
  "..",
  ".."
);
const SRC = join(KOK, "src");

const oku = (goreli: string) => readFileSync(join(SRC, ...goreli.split("/")), "utf8");

/** Yorum satırları tarihi anlatıyor; kalıp taraması yalnız KODA bakar. */
const kodSatirlari = (kaynak: string) =>
  kaynak.split("\n").filter((s) => {
    const k = s.trim();
    return !k.startsWith("*") && !k.startsWith("//") && !k.startsWith("/*");
  });

function tsDosyalari(dizin: string, biriktir: string[] = [], onek = ""): string[] {
  for (const ad of readdirSync(dizin)) {
    const tam = join(dizin, ad);
    const goreli = onek ? `${onek}/${ad}` : ad;
    if (statSync(tam).isDirectory()) {
      if (ad === "__guards__" || ad === "node_modules") continue;
      tsDosyalari(tam, biriktir, goreli);
    } else if (/\.tsx?$/.test(ad) && !/\.test\.tsx?$/.test(ad)) {
      biriktir.push(goreli);
    }
  }
  return biriktir;
}

const DOSYALAR = tsDosyalari(SRC);

/** Giriş penceresi parametrelerini kurmaya yetkili TEK modül. */
const KAPI = "lib/girisAdresi.ts";

/**
 * Tam sayfa `/giris`e gitmesi MEŞRU olanlar — her biri gerekçesiyle.
 *
 * Auth akışının kendi ekranları (kayıt bitti → girişe dön, parola sıfırlandı →
 * girişe dön, e-posta doğrulandı → girişe dön), çıkış, rota kapısı ve rol
 * tablosunun `roleHome` karşılığı. Bunlar bir KORUMALI EYLEM tıklaması değil,
 * akışın kendi sonucu.
 */
const GEZINME_MESRU = new Set([
  "App.tsx",
  "hooks/useLogout.ts",
  "lib/roles.ts",
  "pages/ForgotPassword.tsx",
  "pages/GoogleDonus.tsx",
  "pages/LibraryRegister.tsx",
  "pages/Login.tsx",
  "pages/Register.tsx",
  "pages/ResetPassword.tsx",
  "pages/VerifyEmail.tsx",
  "routes/ProtectedRoute.tsx",
  // SMS bağlantısıyla gelen anonim alıcının kargo ekranı: oturum akışı
  // dışında, kendi jetonuyla geliyor.
  "components/store/DeliveryPrefControls.tsx",
]);

describe("giriş kapısı · tek kapı", () => {
  it("DOLULUK: tarama gerçekten dosya görüyor", () => {
    expect(DOSYALAR.length).toBeGreaterThan(200);
    expect(DOSYALAR).toContain(KAPI);
  });

  it("`?modal=login` literali YALNIZ kapı modülünde", () => {
    const suclular = DOSYALAR.filter(
      (yol) =>
        yol !== KAPI &&
        kodSatirlari(oku(yol)).some((s) => s.includes('"?modal='))
    );
    expect(
      suclular,
      `Giriş adresi elle kurulmuş. Tek kapı: ${KAPI}\n${suclular.join("\n")}`
    ).toEqual([]);
  });

  it("korumalı eylem tıklaması tam sayfa `/giris`e GİTMEZ", () => {
    // Kullanıcı bir eyleme tıkladığında sayfayı kaybetmemeli; giriş penceresi
    // mevcut adrese eklenir.
    const suclular = DOSYALAR.filter(
      (yol) =>
        !GEZINME_MESRU.has(yol) &&
        kodSatirlari(oku(yol)).some((s) => s.includes("ROUTES.login"))
    );
    expect(
      suclular,
      `Korumalı eylem kullanıcıyı sayfadan atıyor:\n${suclular.join("\n")}`
    ).toEqual([]);
  });

  it("izin listesi ÖLÜ girdi taşımıyor", () => {
    // Liste bakımsız kalırsa "istisna" adı altında gerçek bir kaçak yaşayabilir.
    for (const yol of GEZINME_MESRU) {
      expect(DOSYALAR, `${yol} artık yok — izin listesinden çıkarılmalı`).toContain(
        yol
      );
    }
  });
});
