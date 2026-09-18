// @vitest-environment node
/**
 * Ürün açıklamasının editör biçimine köprülenmesi.
 *
 * ## Arkasındaki gerçek arıza
 *
 * Açıklama bu tura kadar DÜZ METİNDİ. Zengin editör (TipTap) onu okurken
 * `<p>…</p>` olarak normalleştiriyor ve bu normalleştirme react-hook-form'a
 * bir DEĞİŞİKLİK olarak düşüyordu. Sonuç ölçüldü: yönetici bir ürünü açıp
 * hiçbir şeye dokunmadan "Kapat"a bastığında kirli form bekçisi devreye
 * giriyor ve **pencere kapanmıyordu**.
 *
 * Köprü formun BAŞLANGIÇ değerinde kurulur: editörün üreteceği biçim baştan
 * verilirse normalleştirme bir fark üretmez.
 */
import { describe, expect, it } from "vitest";

import { aciklamaEditorBicimi } from "./storeProductForm";

describe("aciklamaEditorBicimi", () => {
  it("boş değeri boş dize yapar", () => {
    expect(aciklamaEditorBicimi(null)).toBe("");
    expect(aciklamaEditorBicimi(undefined)).toBe("");
    expect(aciklamaEditorBicimi("   ")).toBe("");
  });

  it("düz metni tek paragrafa sarar", () => {
    expect(aciklamaEditorBicimi("80 gr kağıt")).toBe("<p>80 gr kağıt</p>");
  });

  it("boş satır paragraf böler", () => {
    expect(aciklamaEditorBicimi("Birinci\n\nİkinci")).toBe(
      "<p>Birinci</p><p>İkinci</p>"
    );
  });

  it("tek satır sonu <br> olur", () => {
    expect(aciklamaEditorBicimi("Bir\nİki")).toBe("<p>Bir<br>İki</p>");
  });

  it("HTML'i OLDUĞU GİBİ bırakır (sunucu zaten temizledi)", () => {
    const html = "<p>Merhaba <strong>dünya</strong></p>";
    expect(aciklamaEditorBicimi(html)).toBe(html);
  });

  it("düz metindeki < > & işaretlerini KAÇIRIR", () => {
    // Kaçış olmadan "5 < 10" editörde bozuk bir etiket denemesi olurdu.
    expect(aciklamaEditorBicimi("5 < 10 & 3 > 1")).toBe(
      "<p>5 &lt; 10 &amp; 3 &gt; 1</p>"
    );
  });

  it("kaçış SIRASI doğru: & önce, aksi hâlde çift kaçış olur", () => {
    expect(aciklamaEditorBicimi("a &lt; b")).toBe("<p>a &amp;lt; b</p>");
  });
});
