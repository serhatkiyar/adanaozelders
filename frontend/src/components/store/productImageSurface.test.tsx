/**
 * Ürün görseli yüzeyleri: pad'lenmiş görselin karanlık temada nasıl durduğu.
 *
 * Sorun: sunucu artık her ürün görselini BEYAZ zeminli kare tuvale pad'liyor
 * (`core/storage.pad_to_square`). Görsel kutusu karanlık temada koyu olduğu
 * sürece bu beyaz alan karta yapıştırılmış bir çıkartma gibi görünür.
 *
 * Neden `mix-blend-multiply`'ı karanlık temada da bırakmak TEK BAŞINA çözüm
 * değil: multiply yalnız beyazı değil HER pikseli zeminle çarpar. slate-900
 * (#0f172a) üzerinde bir kapak ≈ rgb(12,13,16) olur, yani kapak neredeyse
 * siyaha döner — `dark:mix-blend-normal` tam da bunun için konmuştu. Doğru
 * çözüm ikisinin birleşimidir: kutu zemini HER İKİ temada da AÇIK olur ve
 * multiply her iki temada çalışır. O zaman beyaz pad kutuyla birebir aynı
 * renge düşer (gerçek Chrome'da ölçüldü: pad köşesi = kutu zemini =
 * rgb(241,245,249)), kapak ise rengini korur (rgb(239,68,68) → rgb(225,66,67)).
 *
 * Bu dosya DÜŞÜK GÜÇLÜ bir sözleşme testidir: jsdom `mix-blend-mode`
 * compositing'i hesaplamaz, o yüzden asıl kanıt gerçek tarayıcı ölçümüdür.
 * Buradaki iş, birinin `dark:mix-blend-normal`'ı geri eklemesini ya da kutuyu
 * koyuya döndürmesini SESSİZCE geçirmemektir.
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ProductCard } from "@/components/store/ProductCard";
import { HoverZoomImage } from "@/components/store/HoverZoomImage";
import type { ProductSearchOut } from "@/types";

const URUN = {
  id: 1,
  slug: "ornek-kitap",
  title: "Örnek Kitap",
  price: "100.00",
  compare_at_price: null,
  cover_url: "https://ornek/kapak.webp",
  in_stock: true,
  rating_average: null,
  rating_count: 0,
} as unknown as ProductSearchOut;

function gorselVeKutu(kap: HTMLElement) {
  const img = kap.querySelector("img");
  expect(img, "ürün görseli render edilmedi").toBeTruthy();
  const kutu = img!.closest("div");
  expect(kutu, "görselin kutusu bulunamadı").toBeTruthy();
  return { img: img!, kutu: kutu! };
}

/** Tailwind'in `dark:` öneki olmayan sınıfları (her iki temada geçerli). */
function temadanBagimsiz(cls: string): string[] {
  return cls.split(/\s+/).filter((c) => c && !c.startsWith("dark:"));
}

describe("ürün görseli yüzeyleri — karanlık tema", () => {
  const yuzeyler: Array<[string, () => HTMLElement]> = [
    [
      "mağaza liste kartı",
      () =>
        render(
          <MemoryRouter>
            <ProductCard product={URUN} />
          </MemoryRouter>
        ).container,
    ],
    [
      "ürün detay büyük görseli",
      () =>
        render(
          <MemoryRouter>
            <HoverZoomImage src="https://ornek/kapak.webp" alt="Örnek Kitap" />
          </MemoryRouter>
        ).container,
    ],
  ];

  it.each(yuzeyler)("%s: multiply karanlık temada da uygulanır", (_ad, olustur) => {
    const { img } = gorselVeKutu(olustur());
    expect(temadanBagimsiz(img.className)).toContain("mix-blend-multiply");
    expect(
      img.className,
      "dark:mix-blend-normal geri gelmiş — pad'lenmiş görsel karanlık temada beyaz çıkartma gibi durur"
    ).not.toContain("dark:mix-blend-normal");
  });

  it.each(yuzeyler)("%s: görsel kutusu karanlık temada da AÇIK zeminlidir", (_ad, olustur) => {
    const { kutu } = gorselVeKutu(olustur());
    const cls = kutu.className;
    expect(cls, "açık temada beyaz zemin kayıp").toContain("bg-white");
    // Koyu zemin, multiply'ı kapağın kendisini karartan bir filtreye çevirir.
    expect(cls).not.toMatch(/dark:bg-slate-(8|9)00/);
    expect(cls, "karanlık tema için açık zemin tanımlanmamış").toMatch(
      /dark:bg-(white|slate-(50|100|200))/
    );
  });
});
