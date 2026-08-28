/**
 * ── Puck SPIKE konfigürasyonu (feat/puck-spike · zaman kutulu deneme) ──
 *
 * Amaç ÜRÜN DEĞİL KARAR: Puck'ın sürükle-bırak editörü mevcut vitrin blok
 * şemasına (store_merchandising) eşlenebiliyor mu ve kalite çıtasını geçiyor
 * mu? Dört blok tipi eşlendi: HERO_CAROUSEL / RICH_TEXT / BANNER /
 * PRODUCT_RAIL. Render'lar public `StoreLandingBlocks` görünümünün
 * yaklaşık kopyasıdır — spike'ta amaç editör DENEYİMİNİ görmek.
 *
 * Gerçek entegrasyonda (Faz 2) bu config `StoreLandingPageRevision.puck_data`
 * kolonuna yazacak ve public render kendi eşleyicimizden geçecek.
 */
import type { Config } from "@measured/puck";

import { fetchProductSets } from "@/api/storeMerchandising";

/* ── Prop şekilleri: mevcut blok config'ine birebir eşlenebilir ── */

export interface HeroSlideProps {
  image_url: string;
  alt_text: string;
  link_url: string;
}

export interface PuckProps {
  HeroCarousel: { slides: HeroSlideProps[] };
  RichText: { title: string; content: string };
  Banner: {
    title: string;
    description: string;
    image_url: string;
    link_label: string;
    link_url: string;
  };
  ProductRail: {
    title: string;
    product_set: { id: number; title: string } | null;
  };
  [key: string]: Record<string, unknown>;
}

export const puckConfig: Config = {
  categories: {
    vitrin: {
      title: "Vitrin blokları",
      components: ["HeroCarousel", "Banner", "ProductRail", "RichText"],
    },
  },
  components: {
    HeroCarousel: {
      label: "Hero (kaydırmalı görsel)",
      fields: {
        slides: {
          type: "array",
          label: "Slaytlar",
          getItemSummary: (item: HeroSlideProps, i) =>
            item.alt_text || `Slayt ${(i ?? 0) + 1}`,
          arrayFields: {
            image_url: { type: "text", label: "Görsel adresi" },
            alt_text: { type: "text", label: "Alternatif metin" },
            link_url: { type: "text", label: "Bağlantı" },
          },
          defaultItemProps: { image_url: "", alt_text: "", link_url: "" },
        },
      },
      defaultProps: { slides: [] },
      render: ({ slides }) => (
        <div className="mx-auto max-w-6xl px-4 py-3">
          {slides.length === 0 ? (
            <div className="flex aspect-[2280/720] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400">
              Hero için slayt ekleyin
            </div>
          ) : (
            <div className="flex snap-x gap-4 overflow-x-auto pb-2">
              {slides.map((s: HeroSlideProps, i: number) => (
                <div
                  key={i}
                  className="relative aspect-[2280/720] w-full flex-none snap-start overflow-hidden rounded-2xl bg-slate-100"
                >
                  {s.image_url ? (
                    <img src={s.image_url} alt={s.alt_text} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">
                      Görsel adresi girin
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ),
    },

    Banner: {
      label: "Banner",
      fields: {
        title: { type: "text", label: "Başlık" },
        description: { type: "textarea", label: "Açıklama" },
        image_url: { type: "text", label: "Görsel adresi" },
        link_label: { type: "text", label: "Bağlantı etiketi" },
        link_url: { type: "text", label: "Bağlantı adresi" },
      },
      defaultProps: {
        title: "Kampanya başlığı",
        description: "",
        image_url: "",
        link_label: "İncele",
        link_url: "",
      },
      render: ({ title, description, image_url, link_label }) => (
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="relative overflow-hidden rounded-2xl bg-slate-900">
            {image_url && (
              <img src={image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
            )}
            <div className="relative px-8 py-10 text-white">
              <h3 className="text-2xl font-bold">{title}</h3>
              {description && <p className="mt-2 max-w-lg text-sm text-white/80">{description}</p>}
              {link_label && (
                <span className="mt-4 inline-block rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-900">
                  {link_label}
                </span>
              )}
            </div>
          </div>
        </div>
      ),
    },

    ProductRail: {
      label: "Ürün rayı (koleksiyon)",
      fields: {
        title: { type: "text", label: "Bölüm başlığı" },
        product_set: {
          type: "external",
          label: "Koleksiyon",
          placeholder: "Koleksiyon seç…",
          fetchList: async () => {
            const sets = await fetchProductSets();
            return sets.map((s) => ({ id: s.id, title: s.name || `#${s.id}` }));
          },
          getItemSummary: (item: { title?: string; id: number }) => item.title ?? `#${item.id}`,
        },
      },
      defaultProps: { title: "Öne çıkanlar", product_set: null },
      render: ({ title, product_set }) => (
        <section className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <span className="text-xs text-slate-400">
              {product_set ? `Koleksiyon: ${product_set.title}` : "Koleksiyon seçilmedi"}
            </span>
          </div>
          <div className="mt-3 flex gap-4 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-40 flex-none">
                <div className="aspect-[3/4] rounded-xl bg-slate-100" />
                <div className="mt-2 h-3 w-3/4 rounded bg-slate-100" />
                <div className="mt-1.5 h-3 w-1/2 rounded bg-slate-100" />
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Spike notu: gerçek ürün kartları public eşleyicide çizilir; editörde yer tutucu.
          </p>
        </section>
      ),
    },

    RichText: {
      label: "Metin bloğu",
      fields: {
        title: { type: "text", label: "Başlık" },
        content: { type: "textarea", label: "İçerik" },
      },
      defaultProps: { title: "", content: "" },
      render: ({ title, content }) => (
        <section className="mx-auto max-w-3xl px-4 py-3">
          {title && <h2 className="text-lg font-semibold text-slate-900">{title}</h2>}
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-600">
            {content || "Metin girin…"}
          </p>
        </section>
      ),
    },
  },
};
