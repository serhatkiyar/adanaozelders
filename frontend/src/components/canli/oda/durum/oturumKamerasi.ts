/**
 * Ders içi kamera tercihi — YALNIZ bu sekmenin oturumu (`sessionStorage`).
 *
 * Kullanıcı kamerayı kapatıp sayfayı yenilerse (ya da bağlantı kopup yeniden
 * katılırsa) kamera kendiliğinden açılmasın. Anahtar ders + rol + kullanıcı:
 * başka bir derse ya da başka hesaba taşınmaz; sekme kapanınca silinir.
 * Kayıt yoksa (derse ilk giriş) çağıran mevcut varsayılanı kullanır — bu
 * modül kalıcı/global bir ayar DEĞİLDİR (o `tercihler.ts`).
 *
 * `sessionStorage` erişimi (gizli pencere, kapalı depolama) fırlatabilir;
 * her okuma/yazma try/catch içinde.
 */

const ONEK = "canliDers.kamera.v1";

export function oturumKamerasiAnahtari(
  dersId: number | undefined,
  rol: string | undefined,
  kullaniciId: number | undefined,
): string | null {
  if (!dersId || !rol || !kullaniciId) return null;
  return `${ONEK}:${dersId}:${rol}:${kullaniciId}`;
}

/** Ham değer → tercih; tanınmayan değer `null` (kayıt yok sayılır). */
export function oturumKamerasiCoz(ham: string | null): boolean | null {
  if (ham === "1") return true;
  if (ham === "0") return false;
  return null;
}

export function oturumKamerasiOku(anahtar: string | null): boolean | null {
  if (!anahtar) return null;
  try {
    return oturumKamerasiCoz(window.sessionStorage.getItem(anahtar));
  } catch {
    return null;
  }
}

export function oturumKamerasiYaz(anahtar: string | null, acik: boolean): void {
  if (!anahtar) return;
  try {
    window.sessionStorage.setItem(anahtar, acik ? "1" : "0");
  } catch {
    // depolama kapalı: tercih yalnız bu yüklemede geçerli kalır
  }
}

/**
 * Odadaki etkin anahtar: ders içi kamera düğmesi (`useMedyaKontrolleri`)
 * ders kimliğini bilmez; oda açılınca `CanliOda` kaydeder, kapanınca siler.
 */
let etkinAnahtar: string | null = null;

export function etkinOturumKamerasiAnahtari(anahtar: string | null): void {
  etkinAnahtar = anahtar;
}

/** Kullanıcının AÇIK kamera işlemi (düğme): tercihi günceller. */
export function kameraTercihiniKaydet(acik: boolean): void {
  oturumKamerasiYaz(etkinAnahtar, acik);
}
