// Bilinen yasal metin borcunun SESSİZCE eskimemesini garanti eder.
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe düzenlenmez.
//
// Neden test: `legalContent.ts` metinleri avukat onayına tabidir ve PK-1
// kapsamında bilinçli olarak DEĞİŞTİRİLMEDİ. Ama "düzeltmeyeceğiz" ile
// "unuttuk" arasındaki farkın kod tarafında bir karşılığı olmalı. Bu test iki
// yönde de kırılır:
//   • metin avukat onayıyla düzeltilirse → kütük kaydı silinmeye zorlanır,
//   • kütük kaydı silinip metin öyle kalırsa → borç görünmez olur, o da kırılır.
import { describe, expect, it } from "vitest";

import { LEGAL_DOCS } from "@/lib/legalContent";
import { LEGAL_DEBT, launchBlockingLegalDebt } from "@/lib/legalDebt";

function sectionText(doc: string, sectionId: string): string {
  const found = LEGAL_DOCS.find((d) => d.id === doc);
  expect(found, `yasal doküman bulunamadı: ${doc}`).toBeTruthy();
  const section = found!.sections.find((s) => s.id === sectionId);
  expect(section, `bölüm bulunamadı: ${doc}#${sectionId}`).toBeTruthy();
  return JSON.stringify(section);
}

describe("yasal metin borcu kütüğü", () => {
  it("her kayıt gerçek bir dokümana ve bölüme işaret eder", () => {
    for (const entry of LEGAL_DEBT) {
      expect(() => sectionText(entry.doc, entry.sectionId)).not.toThrow();
    }
  });

  it("kayıttaki alıntı metinde HÂLÂ birebir duruyor", () => {
    // Kırıldığında doğru davranış: metin avukat onayıyla düzeltildiyse kaydı
    // SİL; başka bir sebeple değiştiyse kaydı gerekçesiyle GÜNCELLE.
    for (const entry of LEGAL_DEBT) {
      const text = sectionText(entry.doc, entry.sectionId);
      expect(
        text.includes(entry.currentSnippet),
        `"${entry.id}" kaydındaki alıntı artık metinde yok — kütük eskimiş`,
      ).toBe(true);
    }
  });

  it("her kayıt sahibini, engelleyicisini ve sorunu açıkça yazar", () => {
    for (const entry of LEGAL_DEBT) {
      expect(entry.problem.length).toBeGreaterThan(40);
      expect(entry.blockedBy.length).toBeGreaterThan(5);
      expect(entry.owner.length).toBeGreaterThan(3);
    }
  });

  it("lansmanı engelleyen borç bilinen listeyle aynı", () => {
    // Yeni bir lansman engelleyicisi eklenirse burada görünür ve teslim
    // özetinde raporlanması gerektiği hatırlatılır.
    //
    // 17 Ağu 2026: `escrow-tum-odemeler` KAPANDI (metin düzeltildi), liste boş.
    // Boş liste "borç yok" demektir; yeni bir borç eklenirse bu test kırılır ve
    // raporlanmaya zorlanır.
    expect(launchBlockingLegalDebt().map((d) => d.id)).toEqual([]);
  });

  /* ── Kapanan borcun geri gelmemesi ── */

  it("iade politikası artık 'tüm ödemeler emanete alınır' DEMİYOR", () => {
    // Nöbetçinin yönü tersine döndü: eskiden "cümle hâlâ duruyor mu" diye
    // bakıyorduk (borç görünür kalsın diye), artık "cümle geri geldi mi" diye
    // bakıyoruz. Sanal POS başvurusunda emanet modeliyle çalışılmadığı beyan
    // edildiği için bu cümlenin dönmesi beyanla çelişki üretir.
    const bolum = sectionText("refund", "genel");
    expect(bolum).not.toContain("tüm ödemeler önce emanete alınır");
    expect(bolum).toContain("EMANET (ESCROW) MODELİ UYGULANMAZ");
  });

  it("yasal metinlerde dijital ürün satışına ilişkin hüküm YOK", () => {
    // Dijital ürün satışı ilk sürümde kapsam dışı (backend'de
    // `digital_products_live` bayrağı kapalı + checkout kapısı). Metinler bu
    // kararla uyuşmalı: olmayan bir ürün için cayma istisnası yazmak, sanal
    // POS beyanıyla çelişir.
    for (const doc of LEGAL_DOCS) {
      const metin = JSON.stringify(doc);
      for (const yasak of [
        "dijital ürün",
        "Dijital ürün",
        "indirilebilir ders notu",
        "m.15/1-ğ",
      ]) {
        expect(
          metin.includes(yasak),
          `${doc.id} belgesinde dijital ürün hükmü var: "${yasak}"`,
        ).toBe(false);
      }
    }
  });
});
