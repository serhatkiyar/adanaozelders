/**
 * Mesaj gövdesini düz metin ve bağlantı parçalarına ayırır (Modül 5).
 *
 * Yalnız `http(s)://` ve `www.` ile başlayan adresler bağlantıya çevrilir;
 * `javascript:`, `data:` gibi şemalar hiçbir zaman bağlantı olmaz, çünkü
 * desen onları hiç yakalamaz ve üretilen `href` her zaman `http(s)` ile başlar.
 *
 * `dis`: adres sitenin kendi alan adına gitmiyorsa `true`. Ön yüz dış
 * bağlantıyı doğrudan açmaz, önce ara uyarı gösterir.
 */
export type MesajParcasi =
  | { tur: "metin"; deger: string }
  | { tur: "baglanti"; deger: string; href: string; dis: boolean };

const BAGLANTI = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// Cümle sonu noktalama bağlantıya dahil edilmez ("bak: www.x.com." gibi).
const SONDAKI_NOKTALAMA = /[.,;:!?)\]}]+$/;

function hostSadelestir(host: string): string {
  const kucuk = host.toLowerCase();
  return kucuk.startsWith("www.") ? kucuk.slice(4) : kucuk;
}

export function mesajParcala(metin: string, siteHost: string): MesajParcasi[] {
  const parcalar: MesajParcasi[] = [];
  const site = hostSadelestir(siteHost);
  let son = 0;

  const metinEkle = (deger: string) => {
    if (!deger) return;
    const onceki = parcalar[parcalar.length - 1];
    if (onceki && onceki.tur === "metin") onceki.deger += deger;
    else parcalar.push({ tur: "metin", deger });
  };

  for (const eslesme of metin.matchAll(BAGLANTI)) {
    const bas = eslesme.index ?? 0;
    const ham = eslesme[0];
    const adres = ham.replace(SONDAKI_NOKTALAMA, "");
    metinEkle(metin.slice(son, bas));

    const href = /^https?:\/\//i.test(adres) ? adres : `https://${adres}`;
    let host: string | null = null;
    try {
      const url = new URL(href);
      if (url.protocol === "http:" || url.protocol === "https:") host = url.hostname;
    } catch {
      host = null;
    }

    if (host) {
      parcalar.push({
        tur: "baglanti",
        deger: adres,
        href,
        dis: hostSadelestir(host) !== site,
      });
    } else {
      metinEkle(adres);
    }
    metinEkle(ham.slice(adres.length));
    son = bas + ham.length;
  }
  metinEkle(metin.slice(son));
  return parcalar;
}
