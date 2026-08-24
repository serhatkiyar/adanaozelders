/**
 * Vitrin taslağının SAF yardımcıları — DOM, ağ ve React yok.
 *
 * `LandingPagesManager.tsx` 1500 satırı aşmıştı ve bu fonksiyonlar
 * (blok kopyalama, medya ekleme, uyarı eşlemesi, yeni blok varsayılanları)
 * o dosyanın içinde durmak zorunda değildi: hiçbiri panelin durumuna bağlı
 * değil, hepsi girdi→çıktı. Ayrı durunca hem okunur hem de testleri panel
 * monte etmeden koşar.
 *
 * `BlockWarnings` burada DEĞİL: JSX üretiyor ve panelin görsel diline ait.
 */
import { BLOK_SEMASI, medyaAlani } from "@/lib/storeBlockSchema";
import type {
  LandingPageBlockInput,
  LandingPageBlockType,
  StoreMediaAsset,
} from "@/types";

const freshBlockKey = () => crypto.randomUUID();

/**
 * Sunucunun blok başına ürettiği uyarıları blok anahtarına eşler.
 *
 * Uyarılar TASLAKTA yaşamaz (taslak kurulurken ayıklanır, çünkü kaydedilen
 * yükün parçası değildir); kaynakları her zaman sunucudan gelen önizleme
 * revizyonudur.
 */
export function warningsByBlockKey(
  blocks: { block_key?: string | null; warnings?: string[] }[] | undefined,
): Record<string, string[]> {
  const harita: Record<string, string[]> = {};
  for (const block of blocks ?? []) {
    if (!block.block_key) continue;
    if (block.warnings?.length) harita[block.block_key] = block.warnings;
  }
  return harita;
}

export function duplicateLandingBlock(
  block: LandingPageBlockInput,
  index: number,
): LandingPageBlockInput {
  return {
    ...block,
    block_key: freshBlockKey(),
    title: block.title ? `${block.title} (kopya)` : block.title,
    config: structuredClone(block.config),
    sort_order: index * 10,
  };
}

export function appendMediaToLandingBlock(
  block: LandingPageBlockInput,
  asset: StoreMediaAsset,
): LandingPageBlockInput {
  // Hangi bloğun görsel aldığı ve görselin nereye yazıldığı ŞEMADAN gelir;
  // eskiden burada blok tiplerini sayan iki koşul ve gömülü bir `fit` üçlüsü
  // vardı (yeni bir görselli tip eklendiğinde burası sessizce atlanırdı).
  const alan = medyaAlani(block.block_type);
  if (!alan) return block;
  if (alan.tekil) {
    return {
      ...block,
      config: {
        ...block.config,
        [alan.ad]: asset.image_url,
        alt_text: asset.alt_text,
        decorative: !asset.alt_text,
        fit: alan.varsayilanFit,
      },
    };
  }
  const items =
    (block.config[alan.ad] as Array<Record<string, unknown>> | undefined) ?? [];
  if (items.some((item) => item.image_url === asset.image_url)) return block;
  return {
    ...block,
    config: {
      ...block.config,
      [alan.ad]: [
        ...items,
        {
          image_url: asset.image_url,
          alt_text: asset.alt_text,
          decorative: !asset.alt_text,
          fit: alan.varsayilanFit,
          label: "",
          link_url: "",
        },
      ],
    },
  };
}

/** Yeni blok — varsayılanların tek kaynağı `BLOK_SEMASI`. */
export function newBlock(
  type: LandingPageBlockType,
  index: number,
  productSetId?: number,
): LandingPageBlockInput {
  const tanim = BLOK_SEMASI[type];
  return {
    block_key: freshBlockKey(),
    block_type: type,
    title: tanim.varsayilanBaslik,
    description: "",
    link_label: "Keşfet",
    link_url: null,
    config: tanim.varsayilanConfig(),
    product_set_id: type === "PRODUCT_RAIL" ? (productSetId ?? null) : null,
    product_set_revision_id: null,
    is_active: true,
    sort_order: index * 10,
  };
}
