// @vitest-environment node
/**
 * İP-A8 · Görev 6 — yerel widget şemasının TEK NOKTASI (B-9 / SK-6).
 *
 * ## Neden var
 *
 * SK-6 ("koyu temada yerel `date`/`time`/`number` widget'ı beyaz blok çiziyor")
 * A6c/A7d2'de `Form.Control` üzerinde kapatıldı ve kapanış envanterine
 * "kapatıldı" diye yazıldı. Bağımsız denetim #3 gerçek Chrome'da ölçtü (B-9):
 * `Form.Control` DIŞINDA yazılmış **dokuz** widget hâlâ
 * `color-scheme: normal` ile çiziliyordu. Üstelik `ClosedDays.tsx`teki bir
 * yorum ortak `.input` sınıfının şemayı "zaten taşıdığını" söylüyordu;
 * taşımıyordu (B-15) — kusurun kökü o yanlış inançtı.
 *
 * Dokuzunu tek tek yamamak onuncusunu davet ederdi. Düzeltme KÖK ÖĞEYE
 * taşındı: `html { color-scheme: light }`. Tarayıcının kendi çizdiği her
 * parça bunu miras alır — bugün var olan ve yarın doğacak bütün widget'lar
 * dahil. (Tarihçe: `html.dark { color-scheme: dark }` ikizi vardı; dark mode
 * CMS turunda ürün kararıyla söküldü — site tek temadır.)
 *
 * ## Bu nöbetçinin GÜCÜ ve SINIRI (kök CLAUDE.md §C)
 *
 * Bu bir KAYNAK SÖZLEŞMESİ testidir, yani düşük güçlüdür: `color-scheme`in
 * gerçekten uygulandığını jsdom ölçemez (stil dosyası yüklenmez, `colorScheme`
 * hesaplanmaz). Davranış kanıtı gerçek Chrome ölçümündedir:
 * `scripts/ip_a8_kontrast.mjs` beş widget'ı — `.input` sınıflı ve ÇIPLAK —
 * iki temada okur ve `docs/arsiv/ip-a/ip-a8/kontrast.json`a yazar. Ölçülen:
 * açık temada beşi de `light`, koyu temada beşi de `dark`; düzeltme geri
 * alınınca beşi de `normal`.
 *
 * Bu düğümün işi o düzeltmenin **sessizce silinememesini** sağlamaktır.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `index.css`in yolu — çalışma dizininden BAĞIMSIZ.
 *
 * İki kusurlu yazım denendi ve ikisi de ÖLÇÜLDÜ:
 *
 *   1. `join(process.cwd(), "src/index.css")` — vitest depo kökünden
 *      koşulduğunda `ENOENT`. Nöbetçi, koştuğu dizine bağlıydı.
 *   2. `import CSS from "@/index.css?raw"` — Vite'in CSS işleyicisi
 *      devreye giriyor ve vitest ortamında **boş dize** dönüyor
 *      (ölçüldü: `LEN 0`). Bu daha kötüsüydü: hata vermeden
 *      YALANCI bir kaynak üretiyordu.
 *
 * Doğrusu: dosyayı adaylar arasında ARA ve bulunamazsa AÇIKÇA patla.
 */
function cssYolu(): string {
  let dizin = process.cwd();
  for (let i = 0; i < 4; i++) {
    for (const aday of ["src/index.css", "frontend/src/index.css"]) {
      const yol = join(dizin, aday);
      if (existsSync(yol)) return yol;
    }
    dizin = join(dizin, "..");
  }
  throw new Error("index.css bulunamadi — nobetci olcemedi");
}

const CSS = readFileSync(cssYolu(), "utf8");

/** Yorumları atarak sadece gerçek kuralları bırakır (yorum yanlış pozitif üretmesin). */
const KURALLAR = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

describe("İP-A8 · yerel widget şeması tek noktadan geliyor", () => {
  it("`color-scheme: light` KÖK öğede bildiriliyor", () => {
    // Yorumlar elenmiş metinde aranır: gerekçe yorumunda geçen bir
    // `color-scheme` sözcüğü kuralın kendisi sayılmamalı — bu projede bir
    // yorumun "koruma var" sanılması (B-15) tam olarak bu kusurun köküydü.
    const acik = /html\s*\{[^}]*color-scheme:\s*light/m.test(KURALLAR);
    expect(acik, "`html { color-scheme: light }` kuralı yok").toBe(true);
  });

  it("koyu tema kuralı GERİ DÖNMEDİ (dark mode söküldü)", () => {
    // Ürün kararı: site tek temadır. `.dark` seçicili herhangi bir kural
    // sökümün geri alındığının işaretidir ve bilinçli bir karar ister.
    expect(/\.dark[\s.{[]/m.test(KURALLAR), "index.css'te `.dark` kuralı geri gelmiş").toBe(false);
  });

  it("dedektörün kendisi YORUMU kural sanmıyor (ters prova)", () => {
    const sahte = "/* html.dark { color-scheme: dark } */ html { color: red }";
    const temiz = sahte.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(/html\.dark\s*\{[^}]*color-scheme:\s*dark/m.test(temiz)).toBe(false);
  });
});
