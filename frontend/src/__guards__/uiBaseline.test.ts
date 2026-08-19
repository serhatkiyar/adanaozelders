/**
 * İP-A1/A2 nöbetçi eşikleri.
 *
 * Bu test bir KAYNAK SÖZLEŞMESİ testidir (CLAUDE.md §C: düşük güçlü sayılır).
 * Amacı davranışı kanıtlamak değil; Medusa UI geçişi boyunca erişilebilirlik ve
 * mimari borcun SESSİZCE BÜYÜMESİNİ engellemektir. Son iki eşik sıfır/sabit
 * olduğu için gerçek bekçidir: ihlal doğduğu gün CI kırılır.
 *
 * Sayacın kendi doğruluğu ayrı bir dosyada sınanır (`sayim.test.ts`): eşiği
 * ölçen alet bozulursa bu dosya sessizce yeşil kalırdı.
 *
 * ## Eşikler İP-A2'de yeniden ölçüldü
 *
 * | Ölçüm | İP-A1 (regex) | İP-A2 (AST) | Neden değişti |
 * |---|---|---|---|
 * | dosya | 78 | 64 | test dosyaları ölçüm dışına alındı |
 * | ham `<button` | 126 | 126 | değişmedi |
 *
 * ## İP-A3a: `<label htmlFor>` ORANI KALDIRILDI
 *
 * Eski eşik `htmlFor`lu etiket / toplam etiket oranıydı (A1'de 3/59, A2'de
 * 4/55) ve **ölçmeyi bırakmak üzereydi**. Mekanizma: `Form.*`'a göç eden her
 * form ham `<label>`larını Form.Label'a devreder — PAYDA düşer — ama paya
 * hiçbir şey eklenmez, çünkü tek `htmlFor`lu etiket `form.tsx`'in KENDİ iç
 * etiketidir. A6-A7'de elli dosya göç edince payda ~1'e iner, oran %100'e
 * çıkar ve nöbetçi hiçbir şey tutmaz hâle gelirdi.
 *
 * Daha kötüsü: hiç `<label>`ı olmayan bir `<input>` o metriğe **zaten
 * görünmüyordu**. Gerçek borç tam orada.
 *
 * Yerine gelen: **erişilebilir adı olmayan form kontrolü sayısı.** Bir
 * `<input>`/`<select>`/`<textarea>`, `Form.Control` içindeyse, `htmlFor` ile
 * kendisine bağlanan bir `<label>` varsa, `aria-label`/`aria-labelledby`
 * taşıyorsa ya da `<label>` içinde sarmalanmışsa adlandırılmış sayılır;
 * kalanı borçtur. Yön "artamaz", hedef 0 — ve göç ilerledikçe DÜŞER.
 *
 * `labels` / `labelsWithHtmlFor` sayaçta kaldı ama artık eşik değil, teşhis
 * sayısıdır (sayaç bunları `htmlFor`↔`id` eşleştirmesi için zaten üretiyor).
 *
 * Eşiklerin hepsi gerçek JSX mutasyonuyla sınandı
 * (`docs/ip-a2-rapor.md` → Görev 6, `docs/ip-a3a-rapor.md` → Görev 5).
 */
import { describe, expect, it } from "vitest";
import { sayim, UNLABELED_OVERLAY_FILES } from "../../scripts/ui-baseline-sayim.mjs";

const olcum = sayim();

describe("İP-A1 nöbetçi eşikleri", () => {
  it("ölçüm tabanı boş değil (yanlış yeşil koruması)", () => {
    // Taban çökerse tüm sayımlar 0'a düşer ve her eşik 'geçer'. Önce tabanı doğrula.
    expect(olcum.files).toBeGreaterThanOrEqual(60);
  });

  it("ham <button sayısı artamaz (taban 126)", () => {
    // İP-A2 pilotu bu sayıyı DÜŞÜRMEDİ ve düşürmesi de beklenmiyordu:
    // `DamageDialog` zaten `admin/ui`'nin `Button`'ını kullanıyordu, tek bir
    // ham `<button>`ı yoktu. Sayı A6-A7'de düşecek.
    expect(olcum.rawButton).toBeLessThanOrEqual(126);
  });

  it("erişilebilir adı olmayan form kontrolü artamaz (taban 41)", () => {
    // İP-A3a'da eski `<label htmlFor>` ORANININ yerini aldı. Gerekçe için
    // dosya başındaki nota bak.
    //
    // Ölçüm tabanı ayrıca doğrulanır: kontrol sayacı sıfıra düşerse (tarayıcı
    // bozulur, taban çöker) borç sayısı da sıfırlanır ve eşik SESSİZCE geçer.
    expect(olcum.kontrolToplam).toBeGreaterThanOrEqual(140);
    expect(olcum.adsizKontrol).toBeLessThanOrEqual(41);
  });

  it("ui2/ dışında @medusajs/ui import eden dosya yok", () => {
    // Kalıcı kural: ekran dosyaları Medusa'yı doğrudan import etmez.
    expect(olcum.medusaDirectImports).toEqual([]);
  });

  it("role=dialog/aria-modal taşımayan overlay sayısı artamaz (taban 5)", () => {
    expect(olcum.unlabeledOverlays).toBeLessThanOrEqual(5);
  });

  it("etiketsiz overlay'i olan dosya listesi sabittir", () => {
    // Yeni bir dosya listeye girerse test kırılır — borç sessizce yayılamaz.
    expect(olcum.overlayOffenders).toEqual([...UNLABELED_OVERLAY_FILES].sort());
  });
});
