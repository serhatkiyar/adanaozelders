/**
 * Canlı derste yüzen KAMERA KUTUSU — saf geometri ve tercih kuralları.
 * React, Zoom ve Excalidraw'dan bağımsız; birim testi `kameraKutusu.test.ts`.
 *
 * - Konum köşe olarak tutulur (`Kose`); masaüstü ve telefon ayrı saklanır.
 *   `null` = bağlamın varsayılan köşesi. Bağlam o köşeye izin vermiyorsa
 *   `koseEsle` en yakın izinli köşeyi seçer (saklanan değer değişmez).
 * - Kutu, küçültülmüş hap ve telefon balonu aynı köşeye yaslanır.
 * - Köşe, boyut ve "kendi görüntümü gizle" cihazda kalıcıdır
 *   (`localStorage`); küçültülmüş hal kalıcı değildir.
 */
import type { Kutu, Nokta } from "./sinifDuzeni";

export type Kose = "solUst" | "sagUst" | "solAlt" | "sagAlt";
export type Boyut = "kucuk" | "orta" | "buyuk";
export type VideoKalitesi = "dusuk" | "orta" | "yuksek";

export const KOSELER: readonly Kose[] = ["solUst", "sagUst", "solAlt", "sagAlt"];
export const BOYUTLAR: readonly Boyut[] = ["kucuk", "orta", "buyuk"];

/** Hazır kutu genişlikleri: Küçük 160 / Orta 200 / Büyük 280. */
export const KUTU_GENISLIK: Record<Boyut, number> = { kucuk: 160, orta: 200, buyuk: 280 };
/** Kutunun izinli alan kenarlarına uzaklığı. */
export const KOSE_BOSLUK = 16;
/** Masaüstünde küçültülmüş kutu: avatar + ad + konuşma halkası. */
export const HAP = { genislik: 200, yukseklik: 40 } as const;
/** Telefonda küçültülmüş kutu: yuvarlak avatar balonu. */
export const BALON = 48;
/** Telefon yatay + tahta: sağdaki dar video şeridi ve karoları (4:3). */
export const SERIT_GENISLIK = 112;
export const SERIT_KARO_YUKSEKLIK = 84;
/** Şerit ile tahta, şerit karoları arası boşluk. */
export const SERIT_ARASI = 8;

/**
 * Köşe alanının kenar payları (izinli alanın sahne/araç kenarına uzaklığı).
 * Masaüstü tahta (Excalidraw 0.18.1 `index.css` ve `TahtaAlani`ndan):
 * - Üst: tahta çerçevesi `p-1` (4) + başlık 40 + Excalidraw kenarı 1rem (16)
 *   + ☰ / kullanıcı listesi / takip satırı (~40) = 100; +20 boşluk → 120.
 * - Alt: çerçeve 4 + Excalidraw kenarı 16 + alt çubuk (yakınlaştırma, geri
 *   al, sayfa denetimi, yardım: `--lg-button-size` en çok 2.5rem = 40) + 16
 *   boşluk → 76.
 * `TELEFON_TAHTA_UST` gerçek arayüzde ölçülmedi (ÖLÇ).
 */
export const TAHTA_UST = 120;
export const TAHTA_ALT = 76;
/**
 * Telefon dikey + tahta: altta Excalidraw telefon çubuğu (~62px) ve onun
 * üstündeki "İçeriğe dön" hapı; üstte araç çubuğu.
 */
export const TELEFON_TAHTA_ALT = 132;
export const TELEFON_TAHTA_UST = 64; // ÖLÇ
/**
 * Telefon + paylaşım: alt köşedeki kutu, altta ortadaki paylaşım
 * yakınlaştırma çubuğunun (`PaylasimYakinlastirma`: alttan 12 + 44) üstünde
 * kalır: 12 + 44 + 8 boşluk.
 */
export const TELEFON_PAYLASIM_ALT = 64;
/** Paylaşım / bölünmüş / odak: üstte 40px başlık + 16px boşluk. */
export const BASLIK_ALTI = 56;

export type KoseBaglami =
  | "tahta"
  | "paylasim"
  | "bolunmus"
  | "telefonTahtaDikey"
  | "telefonDiger"
  | "odak";

export interface KoseAlani {
  /** Kutunun sol üst noktasının dolaşabileceği iç alan (kenar payları düşülmüş). */
  alan: Kutu;
  izinli: Kose[];
  varsayilan: Kose;
}

const sinirla = (d: number, a: number, b: number) => Math.min(b, Math.max(a, d));

/** Kutu ölçüsü: tek karo 3:2 (200×133), iki karo yan yana kare (200×100). */
export function kutuOlcusu(boyut: Boyut, ikiKaro: boolean): { w: number; h: number } {
  const w = KUTU_GENISLIK[boyut];
  return { w, h: ikiKaro ? w / 2 : Math.round((w * 2) / 3) };
}

/** Bağlama göre izinli köşeler ve kenar payları; `zemin` kutunun durduğu yüzey. */
export function koseAlani(baglam: KoseBaglami, zemin: Kutu): KoseAlani {
  const p = { ust: BASLIK_ALTI, alt: KOSE_BOSLUK, sol: KOSE_BOSLUK, sag: KOSE_BOSLUK };
  let izinli: Kose[] = [...KOSELER];
  let varsayilan: Kose = "solUst";
  if (baglam === "tahta") {
    // Sol sütunda ☰ ve altında stil paneli (`.App-menu__left`: 12.5rem
    // genişlik, en çok tahta yüksekliği − 166px; alt ucu tahtanın altına
    // ~90px kalır). Sol alttaki kutu da onu örter: yalnız sağ köşeler.
    p.ust = TAHTA_UST;
    p.alt = TAHTA_ALT;
    izinli = ["sagUst", "sagAlt"];
    varsayilan = "sagUst";
  } else if (baglam === "telefonTahtaDikey") {
    // Sağda kilit/el sütunu ve sayfa denetimi: yalnız sol köşeler.
    p.ust = TELEFON_TAHTA_UST;
    p.alt = TELEFON_TAHTA_ALT;
    izinli = ["solAlt", "solUst"];
    varsayilan = "solAlt";
  } else if (baglam === "telefonDiger") {
    // Telefonda bu bağlam yalnız paylaşım varken: altta ortada paylaşım
    // yakınlaştırma çubuğu (12 + 44). Alt köşedeki kutu onun üstünde durur.
    p.alt = TELEFON_PAYLASIM_ALT;
  } else if (baglam === "odak") {
    varsayilan = "sagUst";
  }
  const x = zemin.x + p.sol;
  const y = zemin.y + p.ust;
  return {
    alan: {
      x,
      y,
      w: Math.max(0, zemin.w - p.sol - p.sag),
      h: Math.max(0, zemin.h - p.ust - p.alt),
    },
    izinli,
    varsayilan,
  };
}

const solMu = (k: Kose) => k === "solUst" || k === "solAlt";
const ustMu = (k: Kose) => k === "solUst" || k === "sagUst";
const koseYap = (sol: boolean, ust: boolean): Kose =>
  sol ? (ust ? "solUst" : "solAlt") : ust ? "sagUst" : "sagAlt";

/**
 * İzinli değilse en yakın izinli köşe: önce aynı yanda dikey çevirme
 * (telefon tahta: sağ üst → sağ alt değil, sol üst), sonra yatay çevirme,
 * en son çapraz (masaüstü tahta: sol üst → sağ üst).
 */
export function koseEsle(k: Kose, izinli: readonly Kose[]): Kose {
  const adaylar = [
    k,
    koseYap(solMu(k), !ustMu(k)),
    koseYap(!solMu(k), ustMu(k)),
    koseYap(!solMu(k), !ustMu(k)),
  ];
  return adaylar.find((a) => izinli.includes(a)) ?? izinli[0] ?? k;
}

/** Verilen ölçüdeki kutuyu (kutu / hap / balon) alanın köşesine yaslar. */
export function koseKutusu(k: Kose, alan: Kutu, olcu: { w: number; h: number }): Kutu {
  const x = solMu(k) ? alan.x : Math.max(alan.x, alan.x + alan.w - olcu.w);
  const y = ustMu(k) ? alan.y : Math.max(alan.y, alan.y + alan.h - olcu.h);
  return { x, y, w: olcu.w, h: olcu.h };
}

/** Bırakılan kutuya (sol üst noktası) en yakın izinli köşe. */
export function enYakinKose(kutu: Kutu, alan: Kutu, izinli: readonly Kose[]): Kose {
  let en: Kose = izinli[0] ?? "solUst";
  let enMesafe = Infinity;
  for (const k of izinli) {
    const hedef = koseKutusu(k, alan, kutu);
    const m = (hedef.x - kutu.x) ** 2 + (hedef.y - kutu.y) ** 2;
    if (m < enMesafe) {
      enMesafe = m;
      en = k;
    }
  }
  return en;
}

/** Serbest sürüklemede sol üst nokta: kutu `sinir` dışına taşmaz. */
export function serbestKonumSinirla(n: Nokta, sinir: Kutu, olcu: { w: number; h: number }): Nokta {
  return {
    x: sinirla(n.x, sinir.x, Math.max(sinir.x, sinir.x + sinir.w - olcu.w)),
    y: sinirla(n.y, sinir.y, Math.max(sinir.y, sinir.y + sinir.h - olcu.h)),
  };
}

/** Dokunma: 10px'ten az ve 300 ms'den kısa. Kaydırma: en az 40px. */
export const DOKUNMA_PX = 10;
export const DOKUNMA_MS = 300;
export const KAYDIRMA_PX = 40;

export type KaydirmaSonucu =
  | { tur: "dokunma" }
  | { tur: "kaydirma"; kose: Kose }
  | { tur: "yok" };

/**
 * Telefonda parmak hareketinin sonucu. Kaydırma yönündeki köşe izinli değilse
 * `koseEsle` ile eşlenir; sonuç mevcut köşeyse hareket yok sayılır.
 */
export function kaydirmaSonucu(
  mevcut: Kose,
  d: { dx: number; dy: number; sureMs: number },
  izinli: readonly Kose[],
): KaydirmaSonucu {
  const ax = Math.abs(d.dx);
  const ay = Math.abs(d.dy);
  if (ax < DOKUNMA_PX && ay < DOKUNMA_PX && d.sureMs < DOKUNMA_MS) return { tur: "dokunma" };
  if (ax < KAYDIRMA_PX && ay < KAYDIRMA_PX) return { tur: "yok" };
  const sol = ax >= KAYDIRMA_PX ? d.dx < 0 : solMu(mevcut);
  const ust = ay >= KAYDIRMA_PX ? d.dy < 0 : ustMu(mevcut);
  const kose = koseEsle(koseYap(sol, ust), izinli);
  return kose === koseEsle(mevcut, izinli) ? { tur: "yok" } : { tur: "kaydirma", kose };
}

/** Kalite eşikleri (fiziksel piksel genişliği) ve ±%15 histerezis. */
const KALITE_SIRASI: readonly VideoKalitesi[] = ["dusuk", "orta", "yuksek"];
const KALITE_ESIKLERI = [360, 900] as const;
const HISTEREZIS = 0.15;

/**
 * Karo genişliğine göre istenecek video kalitesi. `onceki` verilirse seviye
 * ancak eşiği %15 aşınca değişir (sınırda gidip gelmesin).
 */
export function videoKalitesi(w: number, dpr: number, onceki?: VideoKalitesi): VideoKalitesi {
  const px = w * (dpr > 0 ? dpr : 1);
  if (!onceki) {
    let s = 0;
    while (s < KALITE_ESIKLERI.length && px >= KALITE_ESIKLERI[s]) s++;
    return KALITE_SIRASI[s];
  }
  let s = KALITE_SIRASI.indexOf(onceki);
  while (s < KALITE_ESIKLERI.length && px >= KALITE_ESIKLERI[s] * (1 + HISTEREZIS)) s++;
  while (s > 0 && px < KALITE_ESIKLERI[s - 1] * (1 - HISTEREZIS)) s--;
  return KALITE_SIRASI[s];
}

/**
 * Telefon yatay + tahta: videolar sağda 112px şeritte, karolar 112×84 alt
 * alta (kendi karon üstte); tahta kalan genişliği alır.
 */
export function seritYerlesimi(
  grup: Kutu,
  karoSayisi: 1 | 2,
): { serit: Kutu; arac: Kutu; karolar: Kutu[] } {
  const sx = grup.x + Math.max(0, grup.w - SERIT_GENISLIK);
  const serit: Kutu = { x: sx, y: grup.y, w: Math.min(SERIT_GENISLIK, grup.w), h: grup.h };
  const arac: Kutu = { x: grup.x, y: grup.y, w: Math.max(0, sx - SERIT_ARASI - grup.x), h: grup.h };
  const kh = Math.min(
    SERIT_KARO_YUKSEKLIK,
    Math.max(0, Math.floor((grup.h - (karoSayisi - 1) * SERIT_ARASI) / karoSayisi)),
  );
  const karolar: Kutu[] = [];
  for (let i = 0; i < karoSayisi; i++) {
    karolar.push({ x: sx, y: grup.y + i * (kh + SERIT_ARASI), w: serit.w, h: kh });
  }
  return { serit, arac, karolar };
}

/* ── Cihazda kalıcı tercih ─────────────────────────────────────────────── */

export const KUTU_TERCIHI_ANAHTARI = "canliDers.kameraKutusu.v1";

export interface KutuTercihi {
  koseMasaustu: Kose | null;
  koseTelefon: Kose | null;
  boyut: Boyut;
  /** Kendi görüntümü yalnız kendi ekranımda gizle (kamera yayını sürer). */
  kendiGizli: boolean;
}

export const VARSAYILAN_KUTU_TERCIHI: KutuTercihi = {
  koseMasaustu: null,
  koseTelefon: null,
  boyut: "orta",
  kendiGizli: false,
};

const koseMi = (d: unknown): d is Kose => typeof d === "string" && KOSELER.includes(d as Kose);
const boyutMu = (d: unknown): d is Boyut => typeof d === "string" && BOYUTLAR.includes(d as Boyut);

/** Saklanan metni doğrular; bozuk/eksik alan varsayılana düşer. SAF. */
export function kutuTercihiCoz(ham: string | null): KutuTercihi {
  if (!ham) return { ...VARSAYILAN_KUTU_TERCIHI };
  let veri: Record<string, unknown>;
  try {
    const cozulen: unknown = JSON.parse(ham);
    if (typeof cozulen !== "object" || cozulen === null) return { ...VARSAYILAN_KUTU_TERCIHI };
    veri = cozulen as Record<string, unknown>;
  } catch {
    return { ...VARSAYILAN_KUTU_TERCIHI };
  }
  return {
    koseMasaustu: koseMi(veri.koseMasaustu) ? veri.koseMasaustu : null,
    koseTelefon: koseMi(veri.koseTelefon) ? veri.koseTelefon : null,
    boyut: boyutMu(veri.boyut) ? veri.boyut : VARSAYILAN_KUTU_TERCIHI.boyut,
    kendiGizli: typeof veri.kendiGizli === "boolean" ? veri.kendiGizli : false,
  };
}

export function kutuTercihiOku(): KutuTercihi {
  try {
    return kutuTercihiCoz(window.localStorage.getItem(KUTU_TERCIHI_ANAHTARI));
  } catch {
    return { ...VARSAYILAN_KUTU_TERCIHI };
  }
}

export function kutuTercihiYaz(t: KutuTercihi): void {
  try {
    window.localStorage.setItem(KUTU_TERCIHI_ANAHTARI, JSON.stringify(t));
  } catch {
    // depolama kapalı: bu sekme boyunca yalnız bellekte kalır
  }
}
