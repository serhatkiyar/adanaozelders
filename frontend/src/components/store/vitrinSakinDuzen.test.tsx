/**
 * Vitrin · sakin düzen sözleşmesi.
 *
 * ## Neden
 *
 * Canlı ana sayfada dört görsel kartın DÖRDÜNDE de aynı bağlantı metni
 * yazıyordu ("Okula Dönüş Alışverişi →") ve dördü de aynı adrese gidiyordu.
 * Aynı çağrıyı dört kez basmak bilgi taşımaz, yalnız gürültü üretir.
 *
 * ## Neden metni SİLMİYORUZ
 *
 * Bu projede bir kez şu hata yapıldı: yönetici bir alan doldurdu, vitrin onu
 * sessizce basmadı (B-2, "hedefsiz bağlantı metni"). Aynı sınıfa geri
 * düşmemek için metin KAYBOLMAZ — satır başına BİR KEZ basılır. Etiketler
 * farklıysa her kart kendi metnini gösterir.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { StoreLandingBlocks } from "@/components/store/StoreLandingBlocks";

import type { LandingPage } from "@/types";

function kart(id: number, baslik: string, etiket: string, hedef: string | null) {
  return {
    id,
    block_key: `k${id}`,
    block_type: "IMAGE_CARD_GRID" as const,
    title: baslik,
    description: "",
    link_label: etiket,
    link_url: hedef,
    config: {
      cards: [
        { image_url: `https://cdn.test/${id}.webp`, alt_text: baslik, fit: "contain" },
      ],
    },
    product_set_id: null,
    product_set_revision_id: null,
    is_active: true,
    sort_order: id * 10,
    products: [],
    categories: [],
    warnings: [],
  };
}

function sayfa(blocks: ReturnType<typeof kart>[]): LandingPage {
  return {
    id: 1,
    internal_name: "Ana",
    slug: "ana-sayfa",
    page_type: "HOME",
    is_archived: false,
    state: "LIVE",
    revision: {
      id: 9,
      page_id: 1,
      version: 9,
      status: "PUBLISHED",
      title: "Mağaza",
      seo_title: "",
      seo_description: "",
      og_image_url: null,
      blocks,
    },
  } as unknown as LandingPage;
}

function sar(sayfaVerisi: LandingPage) {
  return render(
    <MemoryRouter>
      <StoreLandingBlocks page={sayfaVerisi} trackEvents={false} />
    </MemoryRouter>,
  );
}

describe("görsel kart satırı · sakin düzen", () => {
  it("aynı bağlantı metni satırda YALNIZ BİR KEZ basılır", () => {
    sar(
      sayfa([
        kart(1, "Sırt Çantaları", "Okula Dönüş Alışverişi", "/magaza"),
        kart(2, "Su Mataraları", "Okula Dönüş Alışverişi", "/magaza"),
        kart(3, "Resim Malzemeleri", "Okula Dönüş Alışverişi", "/magaza"),
        kart(4, "Beslenme Çantaları", "Okula Dönüş Alışverişi", "/magaza"),
      ]),
    );
    expect(screen.getAllByText(/Okula Dönüş Alışverişi/)).toHaveLength(1);
    // Kartların kendisi kaybolmaz.
    expect(screen.getByText("Sırt Çantaları")).toBeTruthy();
    expect(screen.getByText("Beslenme Çantaları")).toBeTruthy();
  });

  it("etiketler FARKLIYSA her kart kendi metnini gösterir", () => {
    sar(
      sayfa([
        kart(1, "Sırt Çantaları", "Çantalara bak", "/magaza?c=1"),
        kart(2, "Su Mataraları", "Mataralara bak", "/magaza?c=2"),
      ]),
    );
    expect(screen.getByText(/Çantalara bak/)).toBeTruthy();
    expect(screen.getByText(/Mataralara bak/)).toBeTruthy();
  });

  it("etiket aynı ama HEDEFLER farklıysa tekilleştirilmez", () => {
    // Aynı metin farklı yerlere gidiyorsa tek bağlantıya indirmek KULLANICIYI
    // yanıltır: satırdaki tek bağlantı hangi kartın hedefine giderdi?
    sar(
      sayfa([
        kart(1, "Sırt Çantaları", "İncele", "/magaza?c=1"),
        kart(2, "Su Mataraları", "İncele", "/magaza?c=2"),
      ]),
    );
    expect(screen.getAllByText(/İncele/)).toHaveLength(2);
  });

  it("hedefi olmayan kartlar tekilleştirmeye zorlamaz", () => {
    // Hepsi hedefsizse ortak bir bağlantı üretilemez; metin kart başına kalır
    // (ve panel bunu ayrıca uyarır).
    sar(
      sayfa([
        kart(1, "Sırt Çantaları", "İncele", null),
        kart(2, "Su Mataraları", "İncele", null),
      ]),
    );
    expect(screen.getAllByText(/İncele/)).toHaveLength(2);
  });
});
