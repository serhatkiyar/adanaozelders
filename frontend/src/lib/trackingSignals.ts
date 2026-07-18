// Müşteri takip yüzeyi sinyalleri (PDS §3.2 + E8). Saf mantık (Vitest'li);
// React tarafı bunları ref'le zamanlar.

/** PDS E8: kurye bir durağı sona atınca `stops_ahead` ARTABİLİR. Sayaç sessizce
 *  büyümemeli — artışı tespit edip "teslimat sırası güncellendi" mikro-metni
 *  gösteririz. Yalnız gerçek artışta true (ilk yükleme / azalış / eşitlik false). */
export function stopsAheadIncreased(
  prev: number | null | undefined,
  next: number | null | undefined,
): boolean {
  if (prev == null || next == null) return false;
  return next > prev;
}

/** PDS §2.2: teslim penceresi YALNIZ DARALIR, asla sessizce genişlemez. Sunucudan
 *  gelen yeni pencere öncekinden genişse (veya kayıyorsa) bu bir "pencere
 *  güncellendi" olayıdır — sessizce yeni pencereyi göstermek yerine işaretlenir.
 *  Genişleme = yeni aralık eskisini kapsıyor ama daha büyük. Süreler ms/ISO. */
export function windowWidened(
  prevStart: string | null | undefined,
  prevEnd: string | null | undefined,
  nextStart: string | null | undefined,
  nextEnd: string | null | undefined,
): boolean {
  if (!prevStart || !prevEnd || !nextStart || !nextEnd) return false;
  const ps = new Date(prevStart).getTime();
  const pe = new Date(prevEnd).getTime();
  const ns = new Date(nextStart).getTime();
  const ne = new Date(nextEnd).getTime();
  if ([ps, pe, ns, ne].some((n) => Number.isNaN(n))) return false;
  // Yeni pencere daha geç bitiyorsa (kayma/genişleme) → uyar.
  return ne > pe;
}
