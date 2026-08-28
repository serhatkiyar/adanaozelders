/**
 * Blok satırları → Puck verisi (TEK YÖNLÜ, kayıpsız).
 *
 * Yalnız İLK açılışta kullanılır: revizyonda `puck_data` yoksa (eski form
 * nesli) mevcut bloklar Puck'a çevrilir; kaydettiği andan itibaren kanonik
 * kaynak `puck_data`dır ve sunucu blokları ondan türetir.
 *
 * Pasif bloklar (`is_active=false`) İÇE ALINMAZ: public render zaten yalnız
 * aktifleri basıyor ve Puck neslinde "pasif blok" kavramı yok (silinir).
 */
import type { LandingPageBlock } from "@/types";

import type { PuckIcerikOgesi, PuckMedya, PuckVerisi } from "./puckTipleri";

const TIP_ESLEME: Record<string, string> = {
  HERO_CAROUSEL: "HeroCarousel",
  IMAGE_CARD_GRID: "ImageCardGrid",
  CATEGORY_GRID: "CategoryGrid",
  PRODUCT_RAIL: "ProductRail",
  BANNER: "Banner",
  RICH_TEXT: "RichText",
  RECENTLY_VIEWED: "RecentlyViewed",
};

function medya(raw: unknown): PuckMedya {
  const m = (raw ?? {}) as Record<string, unknown>;
  const item: PuckMedya = {
    image_url: String(m.image_url ?? ""),
    alt_text: String(m.alt_text ?? ""),
    decorative: Boolean(m.decorative),
  };
  if (m.mobile_image_url) item.mobile_image_url = String(m.mobile_image_url);
  if (m.link_url) item.link_url = String(m.link_url);
  if (m.fit === "cover" || m.fit === "contain") item.fit = m.fit;
  if (typeof m.focal_x === "number") item.focal_x = m.focal_x;
  if (typeof m.focal_y === "number") item.focal_y = m.focal_y;
  if (m.label) item.label = String(m.label);
  return item;
}

export interface DonusumSonucu {
  data: PuckVerisi;
  /** Eşlenemeyen blok tipleri — çağıran ekranda listelenir. */
  atlanan: string[];
}

export function blokToPuck(blocks: LandingPageBlock[]): DonusumSonucu {
  const content: PuckIcerikOgesi[] = [];
  const atlanan: string[] = [];
  for (const b of blocks) {
    if (!b.is_active) continue;
    const tip = TIP_ESLEME[b.block_type];
    if (!tip) {
      atlanan.push(b.block_type);
      continue;
    }
    const ortak = {
      id: `${tip}-${b.block_key}`,
      block_key: b.block_key,
      title: b.title,
      description: b.description,
      link_label: b.link_label,
      link_url: b.link_url ?? null,
    };
    if (b.block_type === "HERO_CAROUSEL") {
      const props: Record<string, unknown> = {
        ...ortak,
        slides: ((b.config.slides as unknown[]) ?? []).map(medya),
      };
      if (typeof b.config.autoplay_ms === "number") props.autoplay_ms = b.config.autoplay_ms;
      content.push({ type: tip, props });
    } else if (b.block_type === "IMAGE_CARD_GRID") {
      content.push({
        type: tip,
        props: {
          ...ortak,
          cards: ((b.config.cards as unknown[]) ?? []).map(medya),
          overlay: Boolean(b.config.overlay),
        },
      });
    } else if (b.block_type === "CATEGORY_GRID") {
      content.push({
        type: tip,
        props: { ...ortak, category_ids: (b.config.category_ids as number[]) ?? [] },
      });
    } else if (b.block_type === "PRODUCT_RAIL") {
      content.push({
        type: tip,
        props: {
          ...ortak,
          product_set: b.product_set_id
            ? { id: b.product_set_id, title: b.title || `Koleksiyon #${b.product_set_id}` }
            : null,
        },
      });
    } else if (b.block_type === "BANNER") {
      content.push({ type: tip, props: { ...ortak, image: medya(b.config) } });
    } else if (b.block_type === "RICH_TEXT") {
      content.push({
        type: tip,
        props: { ...ortak, content: String(b.config.content ?? "") },
      });
    } else {
      // RECENTLY_VIEWED — config taşımaz.
      content.push({ type: tip, props: { ...ortak } });
    }
  }
  return { data: { root: { props: {} }, content, zones: {} }, atlanan };
}
