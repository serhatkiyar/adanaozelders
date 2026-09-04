import { GRUP_ADI, GRUP_SIRASI, type Ders, type DersGrubu } from "@/api/subjects";

/**
 * Ders kataloğu üzerinde saf arama/gruplama.
 *
 * `lib/dersTaksonomisi.ts::dersAra`'nın yerine geçer; farkı, veriyi koda gömülü
 * bir sabitten değil sunucudan almasıdır. Eski iki liste birbirinden sessizce
 * ayrışmıştı — bu dosya veri TAŞIMAZ, yalnız veriyi işler.
 */

const TR: Record<string, string> = {
  ı: "i", İ: "i", ş: "s", Ş: "s", ğ: "g", Ğ: "g",
  ü: "u", Ü: "u", ö: "o", Ö: "o", ç: "c", Ç: "c",
};

/** Sunucudaki `tr_normalize()` ile aynı harf katlaması. */
export function normalize(s: string): string {
  return s.replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => TR[c]).toLocaleLowerCase("tr-TR").trim();
}

export interface DersGrubuSonuc {
  grup: DersGrubu;
  baslik: string;
  dersler: Ders[];
}

/**
 * Sorguya uyan dersleri gruplayarak döner. Boş sorguda tüm katalog.
 *
 * Eşleşme ders adında VE eşanlamlılarda aranır: "matemetik" yazan kullanıcı
 * Matematik'i görmeli — eşanlamlılar kaynağın gerçek arama kayıtlarından
 * geliyor.
 */
export function dersAra(
  dersler: Ders[] | undefined,
  sorgu: string,
  limit = 60,
): DersGrubuSonuc[] {
  if (!dersler?.length) return [];
  const q = normalize(sorgu);

  // GRUP ADI da aranır. Kullanıcı "yazılım" yazdığında "Bilişim ve yazılım"
  // grubundaki dersleri (Python, Java, JavaScript…) görmeyi bekler — bunlar
  // kategori sözcükleridir, ders adı değil. Bu eşleşme olmadan "yazılım",
  // "müzik", "spor" gibi en doğal aramalar boş dönüyordu.
  const eslesenGruplar = GRUP_SIRASI.filter((g) =>
    normalize(GRUP_ADI[g]).includes(q),
  );

  const uyan = q
    ? dersler.filter(
        (d) =>
          normalize(d.name).includes(q) ||
          d.slug.includes(q) ||
          d.aliases.some((a) => a.includes(q)) ||
          eslesenGruplar.includes(d.group_code),
      )
    : dersler;

  // Sıralama üç kademeli:
  //   1. ARKASINDA EĞİTMEN OLAN ders önce — tıklayınca boş sayfa görmesin.
  //   2. Önek eşleşmesi: "mat" yazan kişi "Matematik"i "Bilgisayar
  //      Matematiği"nden önce görmeli.
  //   3. Alfabetik.
  // Eğitmeni olmayan ders GİZLENMEZ, sadece aşağı iner: "yazılım" yazıp hiçbir
  // şey bulamamak, boş bir sonuç sayfası görmekten daha kötüdür — kullanıcı
  // sitenin o dersi hiç bilmediğini sanır.
  const sirali = [...uyan].sort((a, b) => {
    const av = a.tutor_count > 0 ? 0 : 1;
    const bv = b.tutor_count > 0 ? 0 : 1;
    if (av !== bv) return av - bv;
    if (q) {
      const ap = normalize(a.name).startsWith(q) ? 0 : 1;
      const bp = normalize(b.name).startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
    }
    return a.name.localeCompare(b.name, "tr");
  });

  const kirpik = sirali.slice(0, limit);
  return GRUP_SIRASI.map((grup) => ({
    grup,
    baslik: GRUP_ADI[grup],
    dersler: kirpik.filter((d) => d.group_code === grup),
  })).filter((g) => g.dersler.length > 0);
}

/** Bir dersin seviye seçeneklerini merdivenlerinden toplar. */
export function dersinSeviyeleri<T extends { code: string; levels: unknown[] }>(
  ders: Ders | undefined,
  merdivenler: T[] | undefined,
): T[] {
  if (!ders || !merdivenler) return [];
  return merdivenler.filter((m) => ders.scales.includes(m.code));
}
