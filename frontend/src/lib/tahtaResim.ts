/* ──────────────────────────────────────────────────────────────────────────
 * TAHTA RESİMLERİ — saf yardımcılar
 *
 * Resim dosyası canlı kanaldan GİTMEZ (PDF'teki gibi): ekleyen taraf onu
 * derse kaynak dosya olarak yükler (private/ + kısa ömürlü imzalı adres),
 * sonra resim elemanına `customData.kaynak` yazar. Karşı taraf elemanı
 * normal eşitlemeyle alır, dosyası eksikse kaynağın imzalı adresinden
 * indirip kendisi ekler. Geç katılan da aynı yoldan gelir: ayrı mesaj yok.
 *
 * Sunucu türü DOSYA ADININ UZANTISINDAN denetler (`is_allowed_resource`):
 * bu yüzden ad, gerçek türden türetilen uzantıyla ve yarışan iki
 * yapıştırmanın aynı kaynağa eşlenmemesi için dosya kimliğiyle kurulur.
 * ────────────────────────────────────────────────────────────────────────── */

/** Sunucunun ders kaynağı sınırıyla aynı (`MAX_RESOURCE_SIZE_BYTES`). */
export const RESIM_SINIRI = 10 * 1024 * 1024;

const UZANTILAR: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** İzinli resim türünün uzantısı; tür izinli değilse `null`. */
export function resimUzantisi(tur: string | null | undefined): string | null {
  return (tur && UZANTILAR[tur.toLowerCase()]) || null;
}

/** Yüklenecek dosyanın adı: benzersiz ve uzantısı gerçek türden. */
export function resimDosyaAdi(dosyaKimligi: string, tur: string): string | null {
  const uzanti = resimUzantisi(tur);
  if (!uzanti) return null;
  const temiz = dosyaKimligi.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "resim";
  return `tahta-resim-${temiz}.${uzanti}`;
}

/** `data:` adresini ikili veriye çevirir; bozuksa `null`. */
export function dataUrlCoz(adres: string): { tur: string; veri: Uint8Array } | null {
  const m = /^data:([^;,]+)((?:;[^;,]*)*?);base64,(.*)$/s.exec(adres);
  if (!m) return null;
  try {
    const ikili = atob(m[3]);
    const veri = new Uint8Array(ikili.length);
    for (let i = 0; i < ikili.length; i++) veri[i] = ikili.charCodeAt(i);
    return { tur: m[1].toLowerCase(), veri };
  } catch {
    return null;
  }
}

type ResimElemani = {
  type?: string;
  fileId?: string | null;
  isDeleted?: boolean;
  customData?: Record<string, unknown> | null;
};

/**
 * Dosya kimliğinin ders kaynağı: o dosyayı gösteren HERHANGİ bir elemandan
 * (kopyalar aynı dosya kimliğini paylaşır, damgası yalnız birinde olabilir).
 */
export function resimKaynagi(elemanlar: Iterable<ResimElemani>, dosyaKimligi: string): number | null {
  for (const e of elemanlar) {
    if (e.type !== "image" || e.fileId !== dosyaKimligi) continue;
    const k = e.customData?.kaynak;
    if (typeof k === "number" && Number.isInteger(k) && k > 0) return k;
  }
  return null;
}
