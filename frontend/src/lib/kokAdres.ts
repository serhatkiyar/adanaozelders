import { DERS_EKI } from "@/lib/routes";

/** Sunucudaki `core/seo_adres.py::SLUG_DESENI` ile aynı. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Kök rota parametreleri bir SEO adresi BİÇİMİNDE mi (Modül 6)?
 *
 *   `/:kokSlug`            → geçerli slug (ilan ya da ders sayfası olabilir)
 *   `/:ilce/:dersSayfasi`  → iki geçerli slug ve ikincisi `-ozel-ders` ile biter
 *
 * Biçime uymayan yol sunucuya hiç sorulmaz: rota tablosu onu doğrudan 404'e
 * verir (eski davranış korunur, ağ beklemesi yok).
 */
export function kokAdresBiciminde(p: {
  kokSlug?: string;
  ilce?: string;
  dersSayfasi?: string;
}): boolean {
  if (p.kokSlug !== undefined) return SLUG.test(p.kokSlug);
  return (
    !!p.ilce &&
    !!p.dersSayfasi &&
    SLUG.test(p.ilce) &&
    SLUG.test(p.dersSayfasi) &&
    p.dersSayfasi.endsWith(`-${DERS_EKI}`)
  );
}
