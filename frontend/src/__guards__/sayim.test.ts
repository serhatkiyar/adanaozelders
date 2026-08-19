/**
 * Sayacın kendisinin testi (İP-A2).
 *
 * `uiBaseline.test.ts` eşikleri tutar; bu dosya **eşiği ölçen aletin** doğru
 * ölçtüğünü tutar. İkisi ayrı: alet bozulursa eşik testi sessizce geçer
 * (yalancı yeşil), çünkü sayı düşer ve "artamaz" yönü memnun olur.
 *
 * Ölçülen kusur gerçekti: İP-A1 sürümü ham metinde regex ile sayıyordu ve
 * `AdminStore.tsx`'te bir YORUM satırında geçen `<label>` sözcüğünü gerçek
 * etiket sanıyordu (58 yerine 59). Yön "artamaz" olduğu için bu bir sessiz
 * geçiş üretmiyordu; ama eşikler A6-A7'de aşağı çekilecek ve yorumda kalmış
 * bir etiket MEŞRU bir düşüşü bloklardı.
 */
import { describe, expect, it } from "vitest";
import { dosyaOlcumu } from "../../scripts/ui-baseline-sayim.mjs";

describe("İP-A2 sayaç: yorum ve string sayılmaz", () => {
  it("satır yorumundaki <button sayılmaz", () => {
    const kaynak = `
      export function X() {
        // eskiden burada bir <button vardı, Button'a çevrildi
        return <Button>Tamam</Button>;
      }
    `;
    expect(dosyaOlcumu(kaynak).rawButton).toBe(0);
  });

  it("JSX içine gömülü blok yorumdaki <button sayılmaz", () => {
    const kaynak = `
      export function X() {
        return (
          <div>
            {/* TODO: <button className="x" /> yerine Button kullan */}
            <Button>Tamam</Button>
          </div>
        );
      }
    `;
    expect(dosyaOlcumu(kaynak).rawButton).toBe(0);
  });

  it("string ve şablon içindeki <label sayılmaz", () => {
    const kaynak = [
      "const ornek = '<label htmlFor=\"a\">Ad</label>';",
      "const sablon = `<label>${x}</label>`;",
      "export const Y = () => <div>{ornek}{sablon}</div>;",
    ].join("\n");
    const o = dosyaOlcumu(kaynak);
    expect(o.labels).toBe(0);
    expect(o.labelsWithHtmlFor).toBe(0);
  });

  it("gerçek JSX bozulmadan sayılır (ters prova: sayaç her şeyi 0'lamıyor)", () => {
    // Yukarıdaki üç test tek başına, `dosyaOlcumu` daima 0 dönse de geçerdi.
    // Bu test o yalancı yeşili kapatır.
    const kaynak = `
      export function X() {
        return (
          <form>
            <label htmlFor="ad">Ad</label>
            <input id="ad" />
            <label>Soyad<input /></label>
            <button type="submit">Gönder</button>
            <button />
          </form>
        );
      }
    `;
    const o = dosyaOlcumu(kaynak);
    expect(o.rawButton).toBe(2);
    expect(o.labels).toBe(2);
    expect(o.labelsWithHtmlFor).toBe(1);
  });

  it("Türkçe kesme işareti JSX metnini string sanıp yutmuyor", () => {
    // Elle yazılmış bir tarayıcının battığı yer burasıydı: `Medusa'nın`daki
    // kesme işareti string başlangıcı sanılırsa sonraki JSX'in tamamı kaybolur.
    const kaynak = `
      export function X() {
        return (
          <div>
            <p>Medusa'nın preset'i alındı; ekranların hiçbiri bozulmadı.</p>
            <button>Kapat</button>
          </div>
        );
      }
    `;
    expect(dosyaOlcumu(kaynak).rawButton).toBe(1);
  });

  it("<ButtonGroup> ham <button sayılmaz (etiket adı tam eşleşir)", () => {
    const kaynak = `export const X = () => <ButtonGroup><Button /></ButtonGroup>;`;
    expect(dosyaOlcumu(kaynak).rawButton).toBe(0);
  });

  it("overlay sınıfı yalnız string içinde sayılır, yorumda değil", () => {
    const yorum = `
      // fixed inset-0 kullanan eski overlay kaldırıldı
      export const X = () => <div className="relative" />;
    `;
    expect(dosyaOlcumu(yorum).overlays).toBe(0);

    const gercek = `
      export const X = () => (
        <div className="fixed inset-0 bg-black/40" role="dialog" aria-modal="true" />
      );
    `;
    const o = dosyaOlcumu(gercek);
    expect(o.overlays).toBe(1);
    expect(o.dialogRoles).toBe(1);
    expect(o.ariaModals).toBe(1);
  });

  it("@medusajs/ui importu import/export/dinamik biçimlerinde görülür", () => {
    expect(dosyaOlcumu(`import { Button } from "@medusajs/ui";`).medusaImport).toBe(
      true
    );
    expect(dosyaOlcumu(`export { Button } from "@medusajs/ui";`).medusaImport).toBe(
      true
    );
    expect(
      dosyaOlcumu(`const m = await import("@medusajs/ui");`).medusaImport
    ).toBe(true);
    // Yorumda geçen ad bağımlılık değildir.
    expect(
      dosyaOlcumu(`// "@medusajs/ui" buraya asla import edilmez`).medusaImport
    ).toBe(false);
  });
});
