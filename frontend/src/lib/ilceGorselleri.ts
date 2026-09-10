/**
 * İlçe görselleri — yer önerisi satırlarındaki kare kutuya girer.
 *
 * ## Neden sadece üç ilçe
 *
 * Görsel ÜRETİLEN bir varlıktır (illüstrasyon); her ilçe için biri yok ve
 * uydurulamaz. Görseli olmayan ilçe/mahalle nötr bir simgeyle çizilir —
 * yanlış bir ilçenin resmini göstermektense simge doğru olandır.
 *
 * ## Boyut
 *
 * Kaynaklar 1311x833 PNG'ydi (1,3–2,0 MB/adet). Ortadan KARE kırpılıp 96px
 * WebP'ye indirildi (2–4 KB): kutu 48px, 2x retina için 96 yeterli. Aynı
 * ders `CategoryBar`da yazılı — orada beş ikon 1024px PNG olarak 4,21 MB
 * tutuyor ve ana sayfada anında iniyordu.
 *
 * Kırpma ORTADAN: sahnenin merkezi (Seyhan'da cami + Taşköprü, Çukurova'da
 * baraj gölü, Yüreğir'de şehir silueti) korunuyor.
 */
const GORSELLER: Record<string, string> = {
  seyhan: "/icons/ilceler/seyhan.webp",
  cukurova: "/icons/ilceler/cukurova.webp",
  yuregir: "/icons/ilceler/yuregir.webp",
};

/** Türkçe ilçe adını dosya adına indirger ("Çukurova" → "cukurova"). */
function anahtar(ilce: string): string {
  return ilce
    .toLocaleLowerCase("tr")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z]/g, "");
}

/** İlçenin görseli; yoksa `null` (çağıran nötr simgeye düşer). */
export function ilceGorseli(ilce: string | undefined): string | null {
  if (!ilce) return null;
  return GORSELLER[anahtar(ilce)] ?? null;
}
