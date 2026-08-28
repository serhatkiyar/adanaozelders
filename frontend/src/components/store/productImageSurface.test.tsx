/**
 * Ürün görseli yüzeyleri: pad'lenmiş görselin zeminle kaynaşması.
 *
 * Sunucu her ürün görselini BEYAZ zeminli kare tuvale pad'liyor
 * (`core/storage.pad_to_square`). Sözleşme iki parçadır: görsel kutusu AÇIK
 * zeminlidir (`bg-white`) ve görsel `mix-blend-multiply` taşır — böylece
 * beyaz pad kutu zeminiyle birebir aynı renge düşer, kapak rengini korur
 * (gerçek Chrome'da ölçülmüştü: pad köşesi = kutu zemini = rgb(241,245,249)).
 *
 * (Tarihçe: dosya "karanlık temada da böyle" paritesini koruyordu; dark mode
 * CMS turunda söküldü — site tek temadır. Sözleşmenin kendisi değişmedi:
 * multiply + açık kutu, pad'lenmiş görselin görünmez olmasının tek yolu.)
 *
 * Bu dosya DÜŞÜK GÜÇLÜ bir sözleşme testidir: jsdom `mix-blend-mode`
 * compositing'i hesaplamaz; iş, multiply'ın ya da açık zeminin SESSİZCE
 * silinmemesidir.
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

describe("ürün görseli yüzeyleri — pad kaynaşması", () => {
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

  it.each(yuzeyler)("%s: görsel mix-blend-multiply taşır", (_ad, olustur) => {
    const { img } = gorselVeKutu(olustur());
    expect(img.className.split(/\s+/)).toContain("mix-blend-multiply");
  });

  it.each(yuzeyler)("%s: görsel kutusu açık zeminlidir", (_ad, olustur) => {
    const { kutu } = gorselVeKutu(olustur());
    // Koyu zemin, multiply'ı kapağın kendisini karartan bir filtreye çevirir.
    expect(kutu.className, "beyaz zemin kayıp").toContain("bg-white");
  });
});
