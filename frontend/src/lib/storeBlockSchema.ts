/**
 * Vitrin bloklarının TEK KAYNAK şeması.
 *
 * ## Neden
 *
 * Blok editörü 400+ satırlık elle yazılmış bir `if (block_type === ...)`
 * zinciriydi: yeni bir blok tipi eklemek üç ayrı yerde (ad sözlüğü, açıklama
 * sözlüğü, editör dalı, varsayılan config üreteci) elle kod yazmayı
 * gerektiriyordu ve bir yerin unutulması sessiz kalıyordu.
 *
 * Sektör deseni bunun tersi: blok kendi şemasını BEYAN eder, editör o
 * şemadan ÜRETİLİR. Shopify'da her section `schema`/`presets` taşır ve tema
 * editörü ondan çizilir; merchant hiçbir zaman "editörde alan yok" durumuna
 * düşmez. Bu dosya aynı rolü oynar.
 *
 * ## Neden burada zod YOK
 *
 * Alan doğrulamasının otoritesi SUNUCUDUR (`_validate_block`): görsel
 * adresinin medya kütüphanesine ait olması, bağlantı biçimi, kart sayısı,
 * metinde HTML yasağı orada karara bağlanır. Aynı kuralları istemcide
 * tekrar yazmak ikinci bir otorite ve sessiz bir sapma kaynağı üretirdi.
 * Bu şema "hangi alan hangi tipte ve nasıl çizilir" sorusunu cevaplar —
 * "değer geçerli mi" sorusunu değil.
 *
 * ## Yeni blok tipi eklemek
 *
 * YALNIZ bu dosyaya bir giriş eklenir. `LandingPageBlockType` bir birleşim
 * tipi olduğu ve kayıt defteri `Record<LandingPageBlockType, ...>` olduğu
 * için eksik bırakılan bir tip DERLENMEZ — unutma sessiz kalamaz.
 */
import type { LandingPageBlockType } from "@/types";

/** Editörün çizebildiği alan türleri. */
export type BlokAlan =
  /** Çok satırlı serbest metin (`config[ad]`). */
  | { tur: "uzunMetin"; ad: string; etiket: string }
  /** Akıllı ürün grubu seçici (bloğun `product_set_id` alanı). */
  | { tur: "koleksiyon"; etiket: string }
  /** Mağaza kategorileri çoklu seçimi (`config[ad]`, sayı dizisi). */
  | { tur: "kategoriler"; ad: string; etiket: string }
  /**
   * Görsel alanı. `tekil` ise `config[ad]` doğrudan bir adres tutar
   * (BANNER); değilse `config[ad]` bir öğe dizisidir (slaytlar/kartlar).
   */
  | {
      tur: "medya";
      ad: string;
      etiket: string;
      tekil: boolean;
      /**
       * Yeni eklenen görselin varsayılan çerçeveleme biçimi. Tipe göre
       * DEĞİŞİR (hero tam kaplar, kart grubunda görsel kırpılmamalı) ve bu
       * fark eskiden `appendMediaToLandingBlock` içinde gömülü bir üçlü
       * koşuldu.
       */
      varsayilanFit: "cover" | "contain";
    };

export interface BlokTanimi {
  /** Panelde görünen ad. */
  ad: string;
  /** Blok paletindeki tek cümlelik açıklama. */
  aciklama: string;
  /**
   * Sayfada birden fazla bulunabilir mi. `RECENTLY_VIEWED` tekildir ve
   * sunucu da bunu reddeder ("Bir sayfada yalnız bir Son görüntülenenler
   * bloğu olabilir") — panel kopyalama düğmesini bu yüzden göstermez.
   */
  kopyalanabilir: boolean;
  /** Blok eklenince yazılacak başlık (boş olabilir). */
  varsayilanBaslik: string;
  /** Blok eklenince yazılacak `config`. Her çağrıda YENİ nesne döner. */
  varsayilanConfig: () => Record<string, unknown>;
  /** Bu tipe ÖZGÜ alanlar. Ortak alanlar (başlık/açıklama/bağlantı) hariç. */
  alanlar: BlokAlan[];
}

export const BLOK_SEMASI: Record<LandingPageBlockType, BlokTanimi> = {
  HERO_CAROUSEL: {
    ad: "Dönen büyük görseller",
    aciklama: "Sayfanın üstünde sırayla değişen kampanya görselleri.",
    kopyalanabilir: true,
    varsayilanBaslik: "",
    varsayilanConfig: () => ({ slides: [], autoplay_ms: 6500 }),
    alanlar: [
      { tur: "medya", ad: "slides", etiket: "Görseller", tekil: false, varsayilanFit: "cover" },
    ],
  },
  IMAGE_CARD_GRID: {
    ad: "Resimli kart grubu",
    aciklama: "Birbiriyle ilgili 2–4 görsel bağlantıyı yan yana gösterir.",
    kopyalanabilir: true,
    varsayilanBaslik: "",
    varsayilanConfig: () => ({ cards: [] }),
    alanlar: [
      { tur: "medya", ad: "cards", etiket: "Görseller", tekil: false, varsayilanFit: "contain" },
    ],
  },
  CATEGORY_GRID: {
    ad: "Kategori bağlantıları",
    aciklama: "Seçtiğiniz mağaza kategorilerine kısa yollar ekler.",
    kopyalanabilir: true,
    varsayilanBaslik: "",
    varsayilanConfig: () => ({ category_ids: [] }),
    alanlar: [
      { tur: "kategoriler", ad: "category_ids", etiket: "Kategoriler" },
    ],
  },
  PRODUCT_RAIL: {
    ad: "Ürün vitrini",
    aciklama: "Bir ürün grubunu yatay vitrin olarak gösterir.",
    kopyalanabilir: true,
    varsayilanBaslik: "",
    varsayilanConfig: () => ({}),
    alanlar: [{ tur: "koleksiyon", etiket: "Koleksiyon" }],
  },
  BANNER: {
    ad: "Tek geniş görsel",
    aciklama: "Tek bir yatay kampanya görseli gösterir.",
    kopyalanabilir: true,
    varsayilanBaslik: "",
    varsayilanConfig: () => ({}),
    alanlar: [
      { tur: "medya", ad: "image_url", etiket: "Görseller", tekil: true, varsayilanFit: "cover" },
    ],
  },
  RICH_TEXT: {
    ad: "Metin alanı",
    aciklama: "Başlık, açıklama veya bilgilendirme metni ekler.",
    kopyalanabilir: true,
    varsayilanBaslik: "",
    varsayilanConfig: () => ({ content: "" }),
    alanlar: [{ tur: "uzunMetin", ad: "content", etiket: "Metin" }],
  },
  RECENTLY_VIEWED: {
    ad: "Son görüntülenenler",
    aciklama: "Ziyaretçinin daha önce baktığı ürünleri gösterir.",
    kopyalanabilir: false,
    varsayilanBaslik: "Son görüntülediklerin",
    varsayilanConfig: () => ({}),
    alanlar: [],
  },
};

/** Blok paletinin sırası — panelde bu sırayla listelenir. */
export const BLOK_TIPLERI = Object.keys(BLOK_SEMASI) as LandingPageBlockType[];

/** Bir bloğun görsel alanı varsa onun tanımını verir, yoksa `undefined`. */
export function medyaAlani(
  tip: LandingPageBlockType,
): Extract<BlokAlan, { tur: "medya" }> | undefined {
  return BLOK_SEMASI[tip].alanlar.find(
    (alan): alan is Extract<BlokAlan, { tur: "medya" }> => alan.tur === "medya",
  );
}
