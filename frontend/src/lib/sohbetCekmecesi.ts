/**
 * Telefonda ve ≤880px pencerede alttan açılan iki kademeli ders sohbeti
 * (`YanPanel` "cekmece" düzeni) ve sohbet kapalıyken beliren önizleme
 * balonu için SAF kurallar. React'ten bağımsız; birim testi
 * `sohbetCekmecesi.test.ts`.
 */

export type Kademe = "kapali" | "yarim" | "tam";

/** Yarım kademe görünür alanın %40'ı, en az 260px (alan yetiyorsa). */
export const YARIM_ORAN = 0.4;
export const YARIM_EN_AZ = 260;
/** Tam kademede üstte bırakılan boşluk: sahnenin bir şeridi görünür kalır. */
export const UST_BOSLUK = 48;
/** Görünür alanın altında bu kadar px'ten fazlası örtülüyse klavye açık sayılır. */
export const KLAVYE_ESIGI = 120;
/** Bu hızdan (px/ms) hızlı bırakılan tutamak, yön kadar kademe atlar. */
export const HIZ_ESIGI = 0.5;
/** Önizleme balonundaki metnin en çok uzunluğu. */
export const ONIZLEME_UZUNLUGU = 80;

export interface GorunurAlan {
  /** Görünür alanın (klavye hariç) yüksekliği. */
  yukseklik: number;
  /** Pencerenin alt kenarından görünür alanın alt kenarına mesafe (klavye). */
  alt: number;
  klavyeAcik: boolean;
}

/**
 * `ic` = `window.innerHeight`; `vv` = `window.visualViewport` (yoksa
 * pencerenin tamamı görünür sayılır).
 */
export function gorunurAlan(
  ic: number,
  vv: { height: number; offsetTop: number } | null | undefined,
): GorunurAlan {
  if (!vv) return { yukseklik: ic, alt: 0, klavyeAcik: false };
  const alt = Math.max(0, Math.round(ic - (vv.height + vv.offsetTop)));
  return { yukseklik: vv.height, alt, klavyeAcik: alt > KLAVYE_ESIGI };
}

/** Kademenin piksel yüksekliği; `alan` = görünür alan yüksekliği. */
export function kademeYuksekligi(kademe: Kademe, alan: number): number {
  if (kademe === "kapali") return 0;
  const tam = Math.max(0, Math.round(alan - UST_BOSLUK));
  if (kademe === "tam") return tam;
  return Math.min(tam, Math.max(YARIM_EN_AZ, Math.round(alan * YARIM_ORAN)));
}

/**
 * Tutamak bırakılınca varılacak kademe. `yukseklik` bırakıldığı andaki
 * çekmece yüksekliği, `hiz` yüksekliğin değişim hızı (px/ms; + büyüyor).
 * Hızlı fiske yönündeki bir sonraki kademeye, yavaş bırakış en yakına gider.
 */
export function birakincaKademe(yukseklik: number, hiz: number, alan: number): Kademe {
  const yarim = kademeYuksekligi("yarim", alan);
  const tam = kademeYuksekligi("tam", alan);
  if (hiz > HIZ_ESIGI) return yukseklik < yarim ? "yarim" : "tam";
  if (hiz < -HIZ_ESIGI) return yukseklik > yarim ? "yarim" : "kapali";
  const adaylar: [Kademe, number][] = [
    ["kapali", 0],
    ["yarim", yarim],
    ["tam", tam],
  ];
  let en = adaylar[0];
  for (const a of adaylar) {
    if (Math.abs(a[1] - yukseklik) < Math.abs(en[1] - yukseklik)) en = a;
  }
  return en[0];
}

export interface SohbetOzeti {
  okunmamis: number;
  /** Son mesajın zamanı (`last_message_at`). */
  zaman: string | null;
}

/**
 * Önizleme balonu gerekli mi: ilk yüklemede (önceki yok) hayır; sohbet
 * kapalıyken okunmamış sayısı arttı VE son mesaj değiştiyse evet.
 */
export function onizlemeGerekli(
  onceki: SohbetOzeti | null,
  simdi: SohbetOzeti,
  sohbetAcik: boolean,
): boolean {
  if (!onceki || sohbetAcik) return false;
  return simdi.okunmamis > onceki.okunmamis && simdi.zaman !== onceki.zaman;
}

/** Balon metni: boşluklar tek, en çok `uzunluk` karakter (taşarsa "…"). */
export function onizlemeMetni(metin: string | null | undefined, uzunluk = ONIZLEME_UZUNLUGU): string {
  const tek = (metin ?? "").replace(/\s+/g, " ").trim();
  if (tek.length <= uzunluk) return tek;
  return `${tek.slice(0, Math.max(0, uzunluk - 1)).trimEnd()}…`;
}
