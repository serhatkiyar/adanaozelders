/**
 * "İçeriğim korumasız" dedektörü (İP-A7d4 · Görev 1).
 *
 * ## Yakalanan sınıf
 *
 * Bir düzenleme yüzeyi kullanıcı verisi tutuyor ama kirli form bekçisine HİÇ
 * bağlanmamış. Sonuç: ×/ESC/dış tıklama yazılanı **sormadan** siliyor.
 *
 * Bu sınıf bu göç boyunca İKİ KEZ üretimde canlı bulundu ve ikisi de ELLE
 * arayarak bulundu:
 *
 *   | | Nerede | Etki |
 *   |---|---|---|
 *   | **SK-4** (A7d2) | `store/ProductForm` | 25 alanlık ürün formu |
 *   | **SK-7** (A7d3) | `ui/ConfirmDialog → ReasonDialog` | 13 çağrı yeri |
 *
 * A7d2'nin `pencereSiz` beyanı bu sınıfı **yakalayamaz**: o beyan
 * `useYuzeyKirliFormBekcisi` ÇAĞRILDIĞINDA denetlenir, buradaki kusur ise
 * kancanın hiç çağrılmamasıdır. Olmayan çağrının beyanı olmaz.
 *
 * ## Neden ÇALIŞMA ZAMANI (ve statik olan neden ayrıca var)
 *
 * Bu dedektör gerçek DOM'a bakar: pencerenin panelinde düzenlenebilir bir
 * kontrol var mı, ve o pencereye bir bekçi kaydolmuş mu. Gerekçe:
 *
 *   1. **Kusur çapraz dosyalıdır.** SK-4'te pencere `EditProductModal`,
 *      alanlar `ProductForm`daydı. Tek dosyaya bakan bir tarayıcı pencereyi
 *      "içinde alan yok" diye temiz sayardı. Çalışma zamanı ikisini birlikte
 *      görür — çünkü kullanıcı da birlikte görür.
 *   2. **"Korumalı mı" sorusunun cevabı ancak koşarken bilinir.** Bekçi bir
 *      kancadır; kaydı render sırasında oluşur ve koşullu olabilir.
 *   3. Aynı gerekçeyle A6b `adsiz kontrol` kapısını da kaynaktan çalışma
 *      zamanına taşımıştı (BULGU-1): kaynak sayacı bir alan FABRİKASINI bir
 *      kontrol sayıyordu.
 *
 * **Sınırı da A3c'nin `Form.Control` sınırının aynısıdır: yalnız RENDER
 * EDİLEN yüzeyleri görür.** Hiçbir testte açılmayan bir pencere bu dedektöre
 * görünmez. O delik ayrı bir kaynak nöbetçisiyle kapatılır
 * (`__guards__/korumasizPencere.test.ts`): o tarama render gerektirmez ama
 * yalnız TEK DOSYA içini görebilir. İkisi birbirinin kör noktasını kapatır ve
 * ikisi de tek başına yeterli değildir — rapor bunu böyle yazar.
 *
 * ## Sözleşme (sessiz varsayılan → açık beyan)
 *
 *   | Panelde girdi | Bekçi kaydı | Beyan (`korumasiz`) | Sonuç |
 *   |---|---|---|---|
 *   | var | var | yok | geçer — doğru yazım |
 *   | var | yok | **yok** | **geliştirmede `throw`** |
 *   | var | yok | var | geçer — beyan edilmiş meşru kullanım |
 *   | yok | yok | yok | geçer — onay/salt-okunur pencere |
 *
 * Korumasız pencere MEŞRU olabilir (salt-okunur detay penceresi, tek bir
 * süzgeç kutusu taşıyan seçici). O zaman kendini beyan eder. Bu, projede beş
 * kez işe yarayan desenin altıncısıdır: `sunucuHatasi` zorunlu yapıldı,
 * `Form.Control` sessiz yazımda patlatıldı, `pencereSiz` beyanı kondu,
 * `HATA_TAKIBI_YOK` yazıldı, ikinci korumalı içerik `throw` ettirildi.
 */
import { createContext } from "react";

/** Geliştirmede patlayan koruma; üretim derlemesinde elenir. */
export const GELISTIRME: boolean = !!import.meta.env?.DEV;

/**
 * "Bu pencerenin içeriği korumalı mı" sorusunu cevaplayan bağlam.
 *
 * Sağlayan taraf pencere sözleşmesinin sahibidir (`DuzenlemeYuzeyi` bekçiyi
 * kendisi bağladığı için her zaman `true`; `DuzenlemePenceresi` kayıt
 * defterine bakar). Soran taraf `ui/Dialog`tır — panelin TEK overlay
 * boğazıdır (`etiketsiz overlay = 0` nöbetçisi bunu ayrıca tutuyor), yani
 * dedektörü oraya koymak "her pencere" demektir.
 *
 * Bağlam bu YAPRAK modülde yaşıyor: `ui/Dialog` `ui2/duzenlemeYuzeyi`yi
 * import edemez (o zaten `ui/Dialog`ı import ediyor — döngü olurdu).
 */
export const IcerikKorumasiCtx = createContext<(() => boolean) | null>(null);

/**
 * Panelde kullanıcı verisi taşıyan kontroller.
 *
 * Gizli/düğme türleri sayılmaz (veri taşımazlar); `disabled` ve `readonly`
 * kontroller de sayılmaz — kullanıcı onlara bir şey yazamaz, dolayısıyla
 * kapatınca kaybedeceği bir şey yoktur.
 */
const GIRDI_SECICI = [
  "input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image])",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(",");

export function girdiTasiyanKontroller(kok: ParentNode): HTMLElement[] {
  return [...kok.querySelectorAll<HTMLElement>(GIRDI_SECICI)].filter(
    (el) => !el.matches("[disabled],[readonly]")
  );
}

export interface KorumaDenetimi {
  /** Pencerenin paneli (children burada yaşıyor). */
  kok: ParentNode | null;
  /** İçerik bir kirli form bekçisi kaydetti mi. */
  korumaVar: boolean;
  /** "Bu pencere bilerek korumasız" beyanı. */
  korumasiz?: true;
  /** Hata mesajında pencereyi tanıtmak için. */
  baslik: string;
}

/**
 * Geliştirmede patlar; üretimde hiçbir şey yapmaz.
 *
 * Denetim **her render sonrası** çalıştırılır (tek seferlik değil): içerik
 * bekçisini koşullu kaydedebilir ve alanlar veri geldikten SONRA basılabilir.
 * Aynı commit'te çocuk efektleri ebeveyn efektinden önce koştuğu için kayıt
 * her zaman tazedir.
 */
export function icerikKorumasiDenetle({ kok, korumaVar, korumasiz, baslik }: KorumaDenetimi): void {
  if (!GELISTIRME || korumaVar || korumasiz || !kok) return;
  const girdiler = girdiTasiyanKontroller(kok);
  if (!girdiler.length) return;
  const ornekler = girdiler
    .slice(0, 5)
    .map((el) => `  · <${el.tagName.toLowerCase()}${el.getAttribute("type") ? ` type="${el.getAttribute("type")}"` : ""}> ${el.getAttribute("name") ?? el.getAttribute("aria-label") ?? el.id ?? ""}`)
    .join("\n");
  throw new Error(
    `"${baslik}" penceresi ${girdiler.length} düzenlenebilir kontrol taşıyor ama ` +
      "hiçbir kirli form bekçisi kaydolmadı. Bu hâliyle ×/ESC/dış tıklama " +
      "kullanıcının yazdığını SORMADAN siler (İP-A7d2 · SK-4 ve İP-A7d3 · SK-7 " +
      "tam olarak buydu ve ikisi de üretimde canlıydı).\n" +
      `Panelde bulunan kontroller:\n${ornekler}\n` +
      "Üç doğru yazımdan birini seç: (1) pencereyi `DuzenlemePenceresi` ile kur " +
      "ve İÇERİK bileşeninde `useYuzeyKirliFormBekcisi` çağır; (2) formu " +
      "pencereye ver `DuzenlemeYuzeyi` bekçiyi kendisi bağlar; (3) pencere " +
      "GERÇEKTEN korunmaya değer bir şey tutmuyorsa (salt-okunur detay, tek " +
      "süzgeç kutusu) `korumasiz` beyanını yaz ve gerekçesini yanına not düş."
  );
}
