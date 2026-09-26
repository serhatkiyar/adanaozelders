/* ──────────────────────────────────────────────────────────────────────────
 * TAHTA TAKİBİ — "öğretmeni takip et" saf yardımcıları
 * (React/Centrifugo/Excalidraw'dan bağımsız)
 *
 * Taraflar birbirine GÖRÜNÜR ALANI (sahne koordinatında dikdörtgen) yollar,
 * kaydırma/yakınlık değerini değil: ekranlar farklı boyutta olduğundan
 * alıcı bu alanı kendi ekranına "contain" ile sığdırır (alan tamamen görünür,
 * bir eksende tam oturur).
 *
 * Öğrencinin öğretmeni takibi BİZİM durumumuzdur (Excalidraw `userToFollow`
 * tuvale her dokunuşta takibi bitirir; öğrenci çizerken takip kopmamalı).
 * Öğretmenin öğrenciyi takibi Excalidraw'ın kendi mekanizmasıdır (avatar).
 * ────────────────────────────────────────────────────────────────────────── */

/** Sahne koordinatında görünür alan: sol üst (x1,y1), sağ alt (x2,y2). */
export type Alan = { x1: number; y1: number; x2: number; y2: number };

/** Excalidraw görünüm durumunun takip için gereken kısmı. */
export type Gorunum = { scrollX: number; scrollY: number; zoom: number };

export const ZOOM_ALT = 0.1;
export const ZOOM_UST = 30;

/** Kullanıcının kaydırma/yakınlaştırma girdisi bu süre içinde olduysa takip kopar. */
export const GIRDI_PENCERESI_MS = 1_500;

const yuvarla = (v: number, basamak: number) => {
  const k = 10 ** basamak;
  return Math.round(v * k) / k;
};

/** Yakınlık değeri: 6 basamağa yuvarlanır, Excalidraw sınırlarına (0.1–30) kıstırılır. */
export function zoomNormalle(z: number): number {
  return Math.min(ZOOM_UST, Math.max(ZOOM_ALT, yuvarla(z, 6)));
}

/** Görünür alan (2 ondalık): `[-scrollX, -scrollY, -scrollX + w/z, -scrollY + h/z]`. */
export function gorunurAlan(d: Gorunum & { width: number; height: number }): Alan {
  return {
    x1: yuvarla(-d.scrollX, 2),
    y1: yuvarla(-d.scrollY, 2),
    x2: yuvarla(-d.scrollX + d.width / d.zoom, 2),
    y2: yuvarla(-d.scrollY + d.height / d.zoom, 2),
  };
}

/**
 * Alanı `ekran`a "contain" ile sığdırır ve ortalar. Yakınlık 0.1'in altına
 * inmez: çok büyük alan çok küçük ekranda tam kapsanmayabilir (bilinen sınır).
 */
export function alanaSigdir(alan: Alan, ekran: { width: number; height: number }): Gorunum {
  const bw = alan.x2 - alan.x1;
  const bh = alan.y2 - alan.y1;
  const zoom = zoomNormalle(Math.min(ekran.width / bw, ekran.height / bh));
  const cx = (alan.x1 + alan.x2) / 2;
  const cy = (alan.y1 + alan.y2) / 2;
  return {
    scrollX: ekran.width / (2 * zoom) - cx,
    scrollY: ekran.height / (2 * zoom) - cy,
    zoom,
  };
}

/** Alan ekranda yarım pikselden fazla değişti mi (yayına değer mi)? */
export function gorunumDegisti(onceki: Alan | null, yeni: Alan, zoom: number): boolean {
  if (!onceki) return true;
  const fark = Math.max(
    Math.abs(onceki.x1 - yeni.x1),
    Math.abs(onceki.y1 - yeni.y1),
    Math.abs(onceki.x2 - yeni.x2),
    Math.abs(onceki.y2 - yeni.y2),
  );
  return fark * zoom > 0.5;
}

/** İki görünüm aynı mı (programatik uyguladığımız görünümü tanımak için)? */
export function ayniGorunum(a: Gorunum, b: Gorunum, eps = 1e-6): boolean {
  return (
    Math.abs(a.scrollX - b.scrollX) <= eps &&
    Math.abs(a.scrollY - b.scrollY) <= eps &&
    Math.abs(a.zoom - b.zoom) <= eps
  );
}

/**
 * Kendi görünür alanımı yayınlamalı mıyım?
 *
 * - Öğretmen: karşı taraf varken, öğrenci takibi bırakmadıysa (`null` =
 *   bilinmiyor → yayınla) ve öğretmen ÖĞRENCİYİ takip etmiyorsa. Öğretmen
 *   öğrenciyi takip ederken de yayınlasaydı iki taraf birbirine sığdırır,
 *   alan her turda büyür (yakınlık 0.1'e kayar).
 * - Öğrenci: yalnız öğretmen onu izliyorsa.
 */
export function yayinlamaliMi(d: {
  ogretmen: boolean;
  karsiVar: boolean;
  ogrenciTakip: boolean | null;
  ogretmenTakipEdiyor: boolean;
  izleniyor: boolean;
}): boolean {
  if (d.ogretmen) return d.karsiVar && d.ogrenciTakip !== false && !d.ogretmenTakipEdiyor;
  return d.izleniyor;
}

/**
 * Görünüm değişikliği takibi koparır mı? Yalnız bizim uyguladığımızdan
 * FARKLIYSA ve son `GIRDI_PENCERESI_MS` içinde kullanıcı girdisi (tekerlek,
 * dokunma, tuş) olduysa. Girdisiz fark (Excalidraw'ın kendi düzeltmesi)
 * koparmaz; çağıran son alanı yeniden uygular.
 */
export function takipKoptuMu(
  beklenen: Gorunum | null,
  gercek: Gorunum,
  sonGirdi: number,
  simdi: number,
): boolean {
  if (beklenen && ayniGorunum(beklenen, gercek)) return false;
  return simdi - sonGirdi <= GIRDI_PENCERESI_MS;
}
