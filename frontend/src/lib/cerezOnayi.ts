/**
 * Çerez tercihi — Google Analytics, Meta Pixel ve Microsoft Clarity yalnız
 * "Kabul et"ten sonra yüklenir (26 Eyl 2026, kurucu kararı).
 *
 * Tercih tarayıcıda saklanır (kişiye özel kolaylık; sunucuya gitmez). Depolama
 * erişilemezse (gizli pencere vb.) tercih yok sayılır ve bant yeniden görünür;
 * etiketler yine yüklenmez.
 */

export type CerezTercihi = "kabul" | "red";

const ANAHTAR = "cerez-tercihi-v1";
const OLAY = "cerez-tercihi-degisti";
const AC_OLAYI = "cerez-bandini-ac";

export function cerezTercihi(): CerezTercihi | null {
  try {
    const v = localStorage.getItem(ANAHTAR);
    return v === "kabul" || v === "red" ? v : null;
  } catch {
    return null;
  }
}

export function cerezTercihiKaydet(t: CerezTercihi): void {
  try {
    localStorage.setItem(ANAHTAR, t);
  } catch {
    /* depolama yoksa yalnız bu oturum için geçerli */
  }
  window.dispatchEvent(new CustomEvent<CerezTercihi>(OLAY, { detail: t }));
}

export function cerezTercihiDinle(fn: (t: CerezTercihi) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<CerezTercihi>).detail);
  window.addEventListener(OLAY, h);
  return () => window.removeEventListener(OLAY, h);
}

/** Altbilgideki "Çerez tercihleri" bağlantısı bandı yeniden açar. */
export function cerezBandiniAc(): void {
  window.dispatchEvent(new Event(AC_OLAYI));
}

export function cerezBandiAcilinca(fn: () => void): () => void {
  window.addEventListener(AC_OLAYI, fn);
  return () => window.removeEventListener(AC_OLAYI, fn);
}
