import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { StoreHeroCarousel } from "@/components/store/StoreHeroCarousel";

const SLIDES = [
  { id: 1, image_url: "/hero-1.webp", mobile_image_url: null, alt_text: "Birinci kampanya", link_url: null },
  { id: 2, image_url: "/hero-2.webp", mobile_image_url: "/hero-2-mobile.webp", alt_text: "İkinci kampanya", link_url: "/magaza?q=LGS" },
  { id: 3, image_url: "/hero-3.webp", mobile_image_url: null, alt_text: "Üçüncü kampanya", link_url: null },
];

const SHOWCASE = {
  configured: true,
  cards: [{
    id: 7,
    title: "TYT Matematik Seçkisi",
    description: "Editörün seçtiği kaynaklar",
    link_url: "/magaza?q=TYT",
    link_label: "TYT kaynaklarını gör",
    content_mode: "PRODUCTS" as const,
    products: [{ id: 11, slug: "tyt-matematik", title: "TYT Matematik", cover_url: "/images/products/yks_matematik.png" }],
    custom_tiles: [],
  }],
};

function renderCarousel(slides = SLIDES, showcase = SHOWCASE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["store", "hero-slides"], slides);
  queryClient.setQueryData(["store", "showcase-cards"], showcase);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StoreHeroCarousel />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("StoreHeroCarousel", () => {
  it("oklarla kampanyalar arasında manuel geçiş yapar", async () => {
    const user = userEvent.setup();
    const { container } = renderCarousel();
    const slides = container.querySelectorAll("article[aria-roledescription='slide']");

    expect(slides[0]?.getAttribute("aria-hidden")).toBe("false");
    expect(slides[1]?.getAttribute("aria-hidden")).toBe("true");
    expect(slides[1]?.hasAttribute("inert")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Sonraki kampanya" }));
    expect(slides[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(slides[1]?.getAttribute("aria-hidden")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Önceki kampanya" }));
    expect(slides[0]?.getAttribute("aria-hidden")).toBe("false");
  });

  it("CMS kartı yoksa frontend sahte kart üretmez", () => {
    renderCarousel([], { configured: false, cards: [] });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("CMS kartını gerçek ürün kapağı ve bağlantısıyla gösterir", () => {
    renderCarousel();

    expect(screen.getByRole("link", { name: /TYT kaynaklarını gör/i }).getAttribute("href")).toBe("/magaza?q=TYT");
    const productLink = screen.getByRole("link", { name: "TYT Matematik" });
    expect(productLink.getAttribute("href")).toBe("/magaza/urun/tyt-matematik");
    expect(productLink.querySelector('img[src="/images/products/yks_matematik.png"]')).not.toBeNull();
  });

  it("özel kart görselini kendi yönlendirmesiyle gösterir", () => {
    renderCarousel([], {
      configured: true,
      cards: [{
        id: 8,
        title: "Sınava hazırlık",
        description: "Küratör seçkileri",
        link_url: "/magaza",
        link_label: "Seçkilerin tümü",
        content_mode: "CUSTOM",
        products: [],
        custom_tiles: [{
          image_url: "/showcase/tyt.webp",
          label: "TYT seçkisi",
          alt_text: "TYT hazırlık kitapları",
          link_url: "/magaza?q=TYT",
        }],
      }],
    });

    expect(screen.getByRole("link", { name: /TYT hazırlık kitapları/i }).getAttribute("href")).toBe("/magaza?q=TYT");
  });

  it("API boşsa sahte banner göstermez", () => {
    const { container } = renderCarousel([], { configured: false, cards: [] });
    expect(container.querySelector("article[aria-roledescription='slide']")).toBeNull();
  });
});
