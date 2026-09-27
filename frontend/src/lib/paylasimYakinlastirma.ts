/**
 * Karşı tarafın ekran paylaşımında yakınlaştırma ve kaydırma — saf hesap.
 * La Suite Meet `utils/screenShareZoom.ts` (MIT — DINUM/Etalab) uyarlaması.
 *
 * Dönüşüm `scale(z) translate(x%, y%)` biçimindedir; kaydırma yüzeyin
 * yüzdesidir. Oyuncu kabı TAŞINMAZ (Zoom oyuncuları yeniden kurulurdu):
 * yalnız sarmalayıcıya CSS dönüşümü uygulanır.
 */
export const EN_AZ_YAKINLIK = 1;
export const EN_COK_YAKINLIK = 4;
/** Düğme ve +/− adımı. */
export const YAKINLIK_ADIMI = 0.25;
/** Ctrl + tekerlek hızı (deltaY başına). */
export const TEKERLEK_HIZI = 0.002;
/** Ok tuşu kaydırma adımı (yüzeyin %'si). */
export const KAYDIRMA_ADIMI = 5;
/** Bir eksenin yarısı (%): hem imleç merkezinin ölçüsü hem kaydırma sınırı. */
const YARIM = 50;

export type Kayma = { x: number; y: number };
/** Resmin yüzeyi kapladığı oran (her eksende 0–1; `contain` boşlukları). */
export type ResimOrani = { x: number; y: number };
export const TAM_ORAN: ResimOrani = { x: 1, y: 1 };

export const yakinlikSinirla = (z: number) =>
  Math.max(EN_AZ_YAKINLIK, Math.min(EN_COK_YAKINLIK, z));

/**
 * Kaymayı resim görünümü hep kaplayacak biçimde sınırlar:
 * `z * (oran * 50 - |kayma|) >= 50`. Resmi hâlâ görünümden küçük olan eksen
 * 0'da kalır (boşluklar simetrik).
 */
export function kaymaSinirla(k: Kayma, z: number, oran: ResimOrani = TAM_ORAN): Kayma {
  const enCokX = Math.max(0, (oran.x - 1 / z) * YARIM);
  const enCokY = Math.max(0, (oran.y - 1 / z) * YARIM);
  // `|| 0`: -0 yerine 0 (dönüşüm metni ve karşılaştırma sade kalsın).
  return {
    x: Math.max(-enCokX, Math.min(enCokX, k.x)) || 0,
    y: Math.max(-enCokY, Math.min(enCokY, k.y)) || 0,
  };
}

/** `object-fit: contain` resmin yüzeyi kapladığı oran. */
export function resimOrani(yw: number, yh: number, rw: number, rh: number): ResimOrani {
  if (!yw || !yh || !rw || !rh) return TAM_ORAN;
  const yuzey = yw / yh;
  const resim = rw / rh;
  return yuzey > resim ? { x: resim / yuzey, y: 1 } : { x: 1, y: yuzey / resim };
}

export const donusum = (z: number, k: Kayma) => `scale(${z}) translate(${k.x}%, ${k.y}%)`;

/**
 * İmleç altındaki noktayı sabit tutarak yakınlaştırır:
 * `kayma' = kayma + imleç * (1/z' - 1/z)`. İmleç merkeze göre % cinsinden.
 */
export function imlecteYakinlastir(p: {
  kayma: Kayma;
  onceki: number;
  sonraki: number;
  imlec: Kayma;
  oran?: ResimOrani;
}): Kayma {
  const fark = 1 / p.sonraki - 1 / p.onceki;
  return kaymaSinirla(
    { x: p.kayma.x + p.imlec.x * fark, y: p.kayma.y + p.imlec.y * fark },
    p.sonraki,
    p.oran,
  );
}

/** Piksel farkı → yüzey yüzdesi, ölçeğe bölünür (resim imleci 1:1 izler). */
export function kaydir(
  k: Kayma,
  dxPx: number,
  dyPx: number,
  yuzey: { w: number; h: number },
  z: number,
  oran: ResimOrani = TAM_ORAN,
): Kayma {
  if (!yuzey.w || !yuzey.h) return k;
  return kaymaSinirla(
    { x: k.x + (dxPx / yuzey.w) * 100 / z, y: k.y + (dyPx / yuzey.h) * 100 / z },
    z,
    oran,
  );
}

/** İmlecin yüzey merkezine göre konumu (%). */
export function imlecYuzdesi(
  istemciX: number,
  istemciY: number,
  r: { left: number; top: number; width: number; height: number },
): Kayma {
  return {
    x: ((istemciX - r.left) / r.width) * 100 - YARIM,
    y: ((istemciY - r.top) / r.height) * 100 - YARIM,
  };
}
