/**
 * Canlı ders cihaz tercihleri — Meet `userChoicesStore` karşılığı.
 *
 * Tarayıcıya özel kolaylıktır (mikrofon/kamera açık mı, hangi cihaz,
 * aynalama): sunucuya gitmez, kaybolursa varsayılana döner. Her okuma ve
 * yazma try/catch içinde: gizli pencerede ya da depolama kapalıyken
 * `localStorage` erişimi fırlatabilir.
 */

export interface DersTercihleri {
  mikAcik: boolean;
  kameraAcik: boolean;
  mikrofonId?: string;
  hoparlorId?: string;
  kameraId?: string;
  /** Kendi görüntümü aynalı gör (yalnız bende; karşı taraf etkilenmez). */
  ayna: boolean;
}

export const VARSAYILAN_TERCIHLER: DersTercihleri = {
  mikAcik: true,
  kameraAcik: true,
  ayna: true,
};

const ANAHTAR = "canliDers.tercihler.v1";

const kimlik = (d: unknown) => (typeof d === "string" && d ? d : undefined);
const bayrak = (d: unknown, yedek: boolean) => (typeof d === "boolean" ? d : yedek);

/** Saklanan metni doğrular; bozuk/eksik alan varsayılana düşer. SAF. */
export function tercihleriCoz(ham: string | null): DersTercihleri {
  if (!ham) return { ...VARSAYILAN_TERCIHLER };
  let veri: Record<string, unknown>;
  try {
    const cozulen: unknown = JSON.parse(ham);
    if (typeof cozulen !== "object" || cozulen === null) return { ...VARSAYILAN_TERCIHLER };
    veri = cozulen as Record<string, unknown>;
  } catch {
    return { ...VARSAYILAN_TERCIHLER };
  }
  return {
    mikAcik: bayrak(veri.mikAcik, VARSAYILAN_TERCIHLER.mikAcik),
    kameraAcik: bayrak(veri.kameraAcik, VARSAYILAN_TERCIHLER.kameraAcik),
    ayna: bayrak(veri.ayna, VARSAYILAN_TERCIHLER.ayna),
    mikrofonId: kimlik(veri.mikrofonId),
    hoparlorId: kimlik(veri.hoparlorId),
    kameraId: kimlik(veri.kameraId),
  };
}

let bellek: DersTercihleri | null = null;

export function tercihleriOku(): DersTercihleri {
  if (bellek) return bellek;
  let ham: string | null = null;
  try {
    ham = window.localStorage.getItem(ANAHTAR);
  } catch {
    // depolama kapalı: varsayılan
  }
  bellek = tercihleriCoz(ham);
  return bellek;
}

export function tercihleriYaz(kismi: Partial<DersTercihleri>): DersTercihleri {
  bellek = { ...tercihleriOku(), ...kismi };
  try {
    window.localStorage.setItem(ANAHTAR, JSON.stringify(bellek));
  } catch {
    // yazılamadı: bu sekme boyunca bellekte kalır
  }
  return bellek;
}
