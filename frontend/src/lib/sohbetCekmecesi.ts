/**
 * Telefonda ve ≤880px pencerede sohbet kapalıyken beliren önizleme balonu
 * (`SohbetOnizlemesi`) için SAF kurallar. React'ten bağımsız; birim testi
 * `sohbetCekmecesi.test.ts`.
 */

/** Önizleme balonundaki metnin en çok uzunluğu. */
export const ONIZLEME_UZUNLUGU = 80;

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
