// @vitest-environment node
/**
 * İP-B2 · Ç-5 — dış yazı tipi konağı nöbetçisi (KVKK).
 *
 * ## Bu nöbetçi neden var
 *
 * İP-B1 bir çelişki ölçtü: `tailwind.config.js` yorumu "KVKK gereği Google
 * Fonts CDN'i kullanılmıyor" diyordu, `index.html` ise `Inter`ı tam olarak
 * oradan çekiyordu. Çelişki iki ayrı dosyada yaşadığı için hiçbir test onu
 * göremiyordu — kimse yazı tipinin **nereden geldiğini** iddia etmemişti.
 *
 * Yani kusur bir yazım hatası değildi; **iddiası olmayan bir alandı**. Aynı
 * sınıf bu depoda daha önce de görüldü (İP-A8 · B-15: bir yorum ortak `.input`
 * sınıfının `color-scheme` taşıdığını söylüyordu, taşımıyordu).
 *
 * Düzeltme (self-host) tek başına yeterli değil: bir sonraki geliştirici
 * `index.html`e bir `<link>` daha ekleyebilir, ya da bir bileşen CSS'inde
 * `@import url(...)` yazabilir. Bu dosya o kapıyı kapatır.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Bu bir KAYNAK SÖZLEŞMESİ testidir, yani düşük güçlüdür: "tarayıcı gerçekten
 * dış istek atmıyor" iddiasını jsdom kanıtlayamaz. Davranış kanıtı gerçek
 * Chrome turundadır (`docs/ip-b2-rapor.md` · Görev 5): ağ kaydında
 * `document.fonts` girdileri ve dış konağa giden istek sayısı ölçülür.
 *
 * Buradaki işi, düzeltmenin **sessizce geri alınamaması**.
 *
 * ## Dedektör kendi kaynağını yakalamıyor — ölçüldü
 *
 * `scripts/dis-font-tarama.mjs` aranan konak adını parçalardan birleştirir;
 * bu yüzden aranan dizi — bu dosya dahil — depoda hiçbir yerde tam yazılı
 * değildir ve tarama HİÇBİR dosyayı istisna tutmaz. (İlk yazımda üç dosyanın
 * YORUMU konak adlarını düz yazıyordu ve nöbetçi üçünü de yakaladı; hariç
 * tutma eklenmedi, yorumlar düzeltildi.) Alttaki ters prova
 * bloğu, taramanın gerçekten ayırt ettiğini sentetik metinle gösterir —
 * "hiçbir şey bulamayan bir tarayıcı da boş liste döndürür" tuzağına karşı.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  KOK,
  disFontBulgulari,
  metindeBulgular,
  taranacakDosyalar,
  yerelYaziTipleri,
  YASAK_KONAKLAR,
} from "../../scripts/dis-font-tarama.mjs";

describe("İP-B2 · Ç-5 · dış yazı tipi konağı", () => {
  it("depoda dış yazı tipi konağına atıf YOK (tavan değil TABAN)", () => {
    expect(
      disFontBulgulari().map((b) => `${b.dosya}:${b.satir} → ${b.parca}`),
      "bir dosya yazı tipini dış konaktan çekiyor — her sayfa yüklemesinde " +
        "ziyaretçinin IP adresi üçüncü tarafa gidiyor (KVKK m.9)"
    ).toEqual([]);
  });

  it("tarama gerçekten bir şeye bakıyor (yalancı yeşil kapısı)", () => {
    // Boş bir dosya listesi de `[]` bulgu üretirdi. Taramanın kapsamı
    // KİMLİKLE değil ama BÜYÜKLÜKLE çıpalanır: `index.html` ve `index.css`
    // gibi kritik dosyaların taramaya girdiği ayrıca doğrulanır.
    const dosyalar = taranacakDosyalar().map((d) => d.replace(/\\/g, "/"));
    expect(dosyalar.length).toBeGreaterThan(100);
    expect(dosyalar.some((d) => d.endsWith("/index.html"))).toBe(true);
    expect(dosyalar.some((d) => d.endsWith("/src/index.css"))).toBe(true);
    expect(dosyalar.some((d) => d.endsWith("/tailwind.config.js"))).toBe(true);
  });

  it("TERS PROVA: tarama dış konak geçen metni GERÇEKTEN yakalar", () => {
    // Dedektörün ayırt ediciliği. Bu olmadan yukarıdaki `[]` iddiası,
    // "hiçbir şey bulamayan bir tarayıcı" ile de geçerdi.
    const sahte = [
      "<link href=\"https://fonts." + "goog" + "leapis.com/css2?family=Inter\" rel=\"stylesheet\" />",
    ].join("\n");
    expect(metindeBulgular(sahte)).toHaveLength(1);

    const sahte2 = "  src: url(https://fonts." + "gsta" + "tic.com/s/inter/x.woff2);";
    expect(metindeBulgular(sahte2)).toHaveLength(1);

    // Yakınında duran masum metin YAKALANMAZ (yanlış pozitif provası).
    expect(metindeBulgular('src: url("/fonts/inter-latin.woff2") format("woff2");')).toEqual([]);
  });

  it("yasak konak listesi iki konağı da adlandırır", () => {
    // Liste sessizce boşalırsa tarama hiçbir şey aramaz ve yeşil kalırdı.
    expect(YASAK_KONAKLAR).toHaveLength(2);
    expect(YASAK_KONAKLAR.every((k) => k.startsWith("fonts."))).toBe(true);
  });
});

/** `@font-face { … }` blokları — YORUMLAR bu kümeye girmez (D3 dersi). */
const BILDIRIM_DESENI = /@font-face\s*\{[^}]*\}/g;

describe("İP-B2 · Ç-5 · self-host bildirimi ayakta", () => {
  const css = readFileSync(join(KOK, "src", "index.css"), "utf8");

  it("index.css dört @font-face bildirimi taşır ve dördü de yerel dosyayı gösterir", () => {
    // Dört: iki aile (Inter gövde · Figtree panel başlığı) × iki altküme
    // (latin · latin-ext). Sayı KİMLİK gibi davranır: bir altküme sessizce
    // düşerse Türkçe harfler yedek yazı tipiyle çizilir ve fark yalnız
    // gerçek tarayıcıda görülür.
    const bildirimler = css.match(BILDIRIM_DESENI) ?? [];
    expect(
      bildirimler.length,
      "@font-face bildirimi kayboldu — yazı tipi yedek aileye düşer ve " +
        "kimse fark etmez"
    ).toBe(4);
    for (const b of bildirimler) {
      expect(b).toContain('url("/fonts/');
      expect(b).toContain(".woff2");
    }
  });

  it("her iki bildirimde de font-display: swap var", () => {
    // `swap` olmazsa yazı tipi inene kadar metin GÖRÜNMEZ (FOIT): ilk boyamada
    // üç saniyeye kadar boş metin alanı. Self-host'un bedeli budur ve `swap`
    // onu ödemeyi engeller.
    const bildirimler = css.match(BILDIRIM_DESENI) ?? [];
    expect(bildirimler.filter((b) => /font-display:\s*swap/.test(b))).toHaveLength(4);
  });

  it("latin-ext altkümesi HER İKİ ailede de BİLDİRİMDE bağlıdır (Türkçe ş/ğ/İ orada yaşıyor)", () => {
    // Yalnız `latin` alınsaydı panel `ş`, `ğ` ve `İ`yi yedek yazı tipiyle
    // çizerdi; fark yalnız gerçek tarayıcıda görülürdü.
    //
    // İDDİA `css.toContain(...)` DEĞİL, `@font-face` bloklarının İÇİNDEKİ
    // `url()` kümesi. Fark bu paketin mutasyon provasında ÖLÇÜLDÜ ve gerçek
    // bir yalancı yeşildi:
    //
    //   Mutasyon D3 `inter-latin-ext.woff2` dizisini `inter-latin.woff2` ile
    //   değiştirdi ve nöbetçi YEŞİL GEÇTİ. Sebep: dizi dosyada İKİ kez
    //   geçiyordu — biri `@font-face`te, biri açıklama YORUMUNDA — ve
    //   `toContain` ikisini ayırt etmiyordu. Yani bildirim silinse bile
    //   yorumun varlığı testi geçirebilirdi.
    //
    // Kaynak sözleşmesi testinin klasik zayıflığı (kök CLAUDE.md §C: "yorum
    // ve docstring yanlış pozitif üretmemeli"). Kümeyi bloklardan çıkarmak
    // yorumu ölçüm dışına atar.
    const bildirimler = css.match(BILDIRIM_DESENI) ?? [];
    const adresler = bildirimler
      .map((b) => b.match(/url\("([^"]+)"\)/)?.[1])
      .filter((u): u is string => Boolean(u))
      .sort();
    expect(adresler).toEqual([
      "/fonts/figtree-latin-ext.woff2",
      "/fonts/figtree-latin.woff2",
      "/fonts/inter-latin-ext.woff2",
      "/fonts/inter-latin.woff2",
    ]);
  });

  it("panel başlık kuralı TEK noktadadır ve `.panel-kok`a bağlıdır", () => {
    // Ekran başına yazılmış bir `font-display` sınıfı, göç etmemiş ekranları
    // eski başlıkla bırakırdı (Ç-3'ün tipografideki ikizi). Kural kabukta.
    expect(css).toMatch(/\.panel-kok\s+:is\(h1,\s*h2,\s*h3\)/);
    expect(css).toContain('theme("fontFamily.display")');
  });

  it("woff2 dosyaları diskte VAR ve gerçekten WOFF2", () => {
    // Bildirim ayakta ama dosya yoksa tarayıcı sessizce yedek aileye düşer —
    // "self-host ediyoruz" cümlesi yine yanlış olurdu.
    const yaziTipleri = yerelYaziTipleri();
    expect(yaziTipleri.map((y) => y.ad)).toEqual([
      "figtree-latin-ext.woff2",
      "figtree-latin.woff2",
      "inter-latin-ext.woff2",
      "inter-latin.woff2",
    ]);
    for (const y of yaziTipleri) {
      expect(y.woff2, `${y.ad}: WOFF2 imzası (wOF2) yok`).toBe(true);
      expect(y.bayt, `${y.ad}: dosya şüpheli derecede küçük`).toBeGreaterThan(5_000);
    }
  });

  it("index.html yazı tipi stylesheet'i DEĞİL, yerel preload taşır", () => {
    const html = readFileSync(join(KOK, "index.html"), "utf8");
    expect(html).toContain('href="/fonts/inter-latin.woff2"');
    // Dış konak zaten yukarıda yasak; burada ayrıca "stylesheet olarak yazı
    // tipi çekme" biçimi kapatılıyor.
    expect(/rel="stylesheet"[^>]*fonts/i.test(html)).toBe(false);
  });
});
