/**
 * İP-A1/A2 nöbetçi eşikleri.
 *
 * Bu test bir KAYNAK SÖZLEŞMESİ testidir (CLAUDE.md §C: düşük güçlü sayılır).
 * Amacı davranışı kanıtlamak değil; Medusa UI geçişi boyunca erişilebilirlik ve
 * mimari borcun SESSİZCE BÜYÜMESİNİ engellemektir. Son iki eşik sıfır/sabit
 * olduğu için gerçek bekçidir: ihlal doğduğu gün CI kırılır.
 *
 * Sayacın kendi doğruluğu ayrı bir dosyada sınanır (`sayim.test.ts`): eşiği
 * ölçen alet bozulursa bu dosya sessizce yeşil kalırdı.
 *
 * ## Eşikler İP-A2'de yeniden ölçüldü
 *
 * | Ölçüm | İP-A1 (regex) | İP-A2 (AST) | Neden değişti |
 * |---|---|---|---|
 * | dosya | 78 | 64 | test dosyaları ölçüm dışına alındı |
 * | ham `<button` | 126 | 126 | değişmedi |
 *
 * ## İP-A3a: `<label htmlFor>` ORANI KALDIRILDI
 *
 * Eski eşik `htmlFor`lu etiket / toplam etiket oranıydı (A1'de 3/59, A2'de
 * 4/55) ve **ölçmeyi bırakmak üzereydi**. Mekanizma: `Form.*`'a göç eden her
 * form ham `<label>`larını Form.Label'a devreder — PAYDA düşer — ama paya
 * hiçbir şey eklenmez, çünkü tek `htmlFor`lu etiket `form.tsx`'in KENDİ iç
 * etiketidir. A6-A7'de elli dosya göç edince payda ~1'e iner, oran %100'e
 * çıkar ve nöbetçi hiçbir şey tutmaz hâle gelirdi.
 *
 * Daha kötüsü: hiç `<label>`ı olmayan bir `<input>` o metriğe **zaten
 * görünmüyordu**. Gerçek borç tam orada.
 *
 * Yerine gelen: **erişilebilir adı olmayan form kontrolü sayısı.** Bir
 * `<input>`/`<select>`/`<textarea>`, `Form.Control` içindeyse, `htmlFor` ile
 * kendisine bağlanan bir `<label>` varsa, `aria-label`/`aria-labelledby`
 * taşıyorsa ya da `<label>` içinde sarmalanmışsa adlandırılmış sayılır;
 * kalanı borçtur. Yön "artamaz", hedef 0 — ve göç ilerledikçe DÜŞER.
 *
 * `labels` / `labelsWithHtmlFor` sayaçta kaldı ama artık eşik değil, teşhis
 * sayısıdır (sayaç bunları `htmlFor`↔`id` eşleştirmesi için zaten üretiyor).
 *
 * ## İP-A3c: ölçüm tabanı İSİMLE SABİTLENDİ ve GENİŞLETİLDİ
 *
 * Bağımsız denetim iki kusur buldu (P1-2, P1-4) ve ikisi de aynı kökten
 * geliyordu: **tabanın kendisi ölçülmüyordu.**
 *
 * 1. Yanlış-yeşil koruması `kontrolToplam >= 140` idi, bugünkü değer 143,
 *    marj 3. Ama sayaç ham `input`/`select`/`textarea` etiketlerini sayıyor ve
 *    göçün TANIMI GEREĞİ bu etiketler sarmalayıcılara dönüşecek. `AdminStore`
 *    tek başına göç etse taban 140'ın altına iner ve CI **ilerleme yüzünden**
 *    kırılırdı. Bu, `htmlFor` oranı metriğinin kaldırılma gerekçesinin taban
 *    kontrolünde tekrarlanmış hâliydi.
 * 2. Taban `pages/dashboards/{Operator,Courier}*` ve `pages/Delivery*`
 *    ekranlarını hiç görmüyordu (34 ham buton + 15 adsız kontrol). Nöbetçi
 *    orada borcun büyümesine izin veriyordu, üstelik bir ekranı taban dışına
 *    TAŞIMAK eşiği düşürüp "ilerleme" gibi okunuyordu.
 *
 * Çözüm ikisine birden: taban dosya listesi **isimle sabitlendi**
 * (`OLCUM_TABANI`, overlay listesinde zaten yapıldığı gibi). Dosya kümesi
 * değişirse test kırılır — ve bu DOĞRU davranıştır: dosya eklendi/silindi/
 * taşındı demektir, liste bilinçli güncellenmelidir. Sayım metriklerinin
 * hiçbiri artık tabanın ayakta olduğunu ispatlamak zorunda değil.
 *
 * ### Eşikler İP-A3c'de yeniden ölçüldü (taban genişlemesi dahil)
 *
 * | Ölçüm | İP-A3a tabanı (65 dosya) | İP-A3c tabanı (71 dosya) |
 * |---|---|---|
 * | ham `<button` | 126 | **160** |
 * | adsız form kontrolü | 41 | **56** |
 * | etiketsiz overlay | 5 | 5 (değişmedi) |
 *
 * Artış bir regresyon DEĞİL, gizli borcun görünür olmasıdır.
 *
 * Eşiklerin hepsi gerçek JSX mutasyonuyla sınandı
 * (`docs/ip-a2-rapor.md` → Görev 6, `docs/ip-a3a-rapor.md` → Görev 5,
 * `docs/ip-a3c-rapor.md` → Görev 9).
 *
 * ## İ9 · Boşluk 1: `src/panel/**` (ikas tarzı yeni panel) ölçüme eklendi
 *
 * Bağımsız denetim: yeni panel `OLCUM_TABANI`nın (bu dosyanın kaynağı,
 * `scripts/ui-baseline-sayim.mjs`) DIŞINDA doğdu, dört eşik de onu hiç
 * ölçmeden yeşil kaldı — TB-A5-1'in (bkz. yukarıdaki İP-A6 notu) aynısı, yeni
 * ağaçta. `kesfedilenTaban()` artık `src/panel`i de DİZİN KURALIYLA yürüyor
 * (elle güncellenen tek yer aşağıdaki `OLCUM_TABANI` listesidir — yeni bir
 * panel dosyası doğduğunda `fazlaDosyalar` kırılır, bu satır bir daha
 * değişmez).
 *
 * Panel AntD kullanıyor (`<Button>`, `<Input.Search>`, `<Modal>`…), ham
 * `<button>`/`<input>` JSX etiketi YAZMIYOR — bu yüzden `rawButton`
 * (bugün 100, eşik değişmedi) ve `adsizKontrol`e (bugün 7, eşik değişmedi)
 * katkısı sıfır. Bu ikisinin doğruluk kaynağı zaten çalışma zamanı kapısıdır
 * (bkz. İP-A6b notu); panel orada GERÇEK DOM üzerinden ölçülüyor
 * (`calismaZamaniKapisi.test.tsx`) ve orada gerçek bir borç bulundu:
 * `ListePage`/`UrunListesi`nin arama kutusunun erişilebilir adı yok
 * (kayıt: o dosyadaki `CALISMA_ZAMANI_ADSIZ`).
 *
 * `modalDurumu` İSE panelde bir eşleşme buldu: `PanelShell.tsx`in mobil
 * gezinme çekmecesi `const [mobilAcik, setMobilAcik] = useState(false)`u
 * `<Drawer open={mobilAcik}>`e veriyor — bileşen adı (`Drawer`) + öznitelik
 * (`open`) deseni tam eşleşiyor. Bu mekanik olarak DOĞRU bir yakalama: gerçek
 * bir sözdizimsel pencere-durumu sinyali. Ama semantik olarak yanlış kovaya
 * düşüyordu.
 *
 * ## İ9 kapanışı: KAYIT DÜZENLEME ile GEZİNME ÇEKMECESİ ayrı kategoridir
 *
 * `useDuzenlemeYuzeyi` (`components/admin/ui2/yuzeyDurumu.ts`) bir KAYIT
 * düzenleme/yeni kayıt açma durum makinesidir: `ac(kayit)`, `yeniAc(baglam)`,
 * `hedef: {tur:"kayit"|"yeni"}`. `PanelShell`in mobil çekmecesi bir gezinme
 * MENÜSÜdür — kaydı yok, "yeni" hâli yok, kapanırken kirli form onayı
 * gerekmez. Onu `useDuzenlemeYuzeyi`ye taşımak hook'un anlamını bozardı
 * (menüyü "düzenlenen kayıt" gibi göstermek); eşiği gevşetmek de korumayı
 * değersizleştirirdi. Panel koduna DOKUNULMADI (nöbetçi koruduğu kodu
 * değiştirmez).
 *
 * Çözüm: sayaç artık İKİ ayrı kova tutuyor (`scripts/ui-baseline-sayim.mjs` →
 * `GEZINME_CEKMECELERI`). `modalDurumu` KAYIT DÜZENLEME içindir ve TABAN
 * `0`da KALDI. Gezinme çekmecesi ayrı `gezinmeCekmecesiDurumu`/
 * `gezinmeCekmecesiDosyalari` alanlarında, isimle ve KİMLİKLE dondurulmuş
 * (aşağıdaki testler). Eşleşme dar ve varsayılanı katı kovadır: bir bağ
 * ancak dosya+ad+TEK bileşen tam eşleşirse gezinme çekmecesi sayılır — yeni
 * dosyada aynı adla bir `Drawer`, aynı dosyada farklı adla ikinci bir
 * çekmece, ya da aynı adın GERÇEKTEN bir düzenleme penceresine de akması,
 * hepsi KAYIT DÜZENLEME kovasına düşer ve `modalDurumu`yu kırar (gerekçe ve
 * üç kaçamama senaryosu `GEZINME_CEKMECELERI`nin yanındaki yorumda).
 */
import { describe, expect, it } from "vitest";
import {
  dosyaOlcumu,
  GEZINME_CEKMECELERI,
  OLCUM_TABANI,
  sayim,
  tsHamButonlari,
  UNLABELED_OVERLAY_FILES,
} from "../../scripts/ui-baseline-sayim.mjs";

/**
 * Ölçüm tabanının TAM dosya listesi ARTIK BURADA DEĞİL (İP-A6 · Görev 1).
 *
 * İP-A3c–A5 boyunca liste bu dosyada duruyordu ve sayım dizin yürüyüşünden
 * geliyordu; liste yalnız sonucun aynı olduğunu denetliyordu. İP-A5 bu
 * ayrımın bir kaçış ürettiğini ölçtü (TB-A5-1): ölçülen bir dosya ağacın
 * dışına taşındığında yürüyüş onu bulamıyor, dört eşik de geçmeye devam
 * ediyordu.
 *
 * Liste `scripts/ui-baseline-sayim.mjs`e taşındı ve ölçümün KAYNAĞI oldu.
 * Sayaç artık iki yönlü fark üretiyor: `eksikDosyalar` (listede var, diskte
 * yok) ve `fazlaDosyalar` (diskte var, listede yok). Aşağıdaki üç test bu
 * sözleşmenin nöbetçisidir.
 */


/**
 * Pencere (modal) durumunu HÂLÂ ekranda tutan dosyalar — İP-A4 tabanı.
 *
 * A6-A7'de her göç eden ekran bu listeden ÇIKAR. Listeye yeni dosya girmesi
 * göçün tersine işlediği anlamına gelir ve test kırılır.
 */
const MODAL_DURUM_DOSYALARI: string[] = [
  // İP-A7d4 · kapanış: SON İKİ dosya da ÇIKTI (2 → **0**). Liste artık BOŞ.
  //   • `AdminDemandsPage`  — talep iptali gerekçesi
  //   • `ReturnQueuePage`   — depoya kabul gerekçesi
  // İkisi de `ReasonDialog` taşıyordu (SK-7 ile zaten korumalı); göç yalnız
  // pencere durumunu yüzeye taşıdı. Metrik SIFIRLANDI ve eşik `toBe(0)`
  // oldu — yani artık bir TAVAN değil bir TABAN.
  //
  // İP-A7d4 · göç dalgası 4: ALTI dosya bu listeden ÇIKMIŞTI (9 → 2).
  //   • `AdminAccessPage`      — rol penceresi (SK-9: canlı veri kaybı)
  //   • `ClosedDays`           — resmî tatil yükleme onayı
  //   • `AdminOperationsPage`  — ölü işi yeniden kuyruğa alma onayı
  //   • `AdminSettingsPage`    — bayrak gerekçesi penceresi
  //   • `DeliveryBoardPage`    — günü optimize et onayı
  //   • `DeliveryTodayPage`    — günü optimize et + yeniden dene (2 bağ)
  // Listeden ÇIKMAK beklenen yöndür; listeye GİRMEK kırılma sebebidir.
  //
  // İP-A7d3 · göç dalgası 3: ALTI dosya bu listeden ÇIKTI (20 → 9).
  //   • `CountSessionDetailPage` — uygula + iptal + açıklama (3 bağ)
  //   • `PackingStationPage`     — elle doğrula + geri al + vazgeç (3 bağ)
  //   • `AdminHome`              — ilan silme + başvuru reddi (2 bağ)
  //   • `CountSessionsPage`      — yeni sayım oturumu
  //   • `AdminReportsPage`       — şikâyet kararı
  //   • `DeliveryRunDetailPage`  — tur iptali
  // Hepsi `useDuzenlemeYuzeyi`ye taşındı. Listeden ÇIKMAK beklenen yöndür;
  // listeye GİRMEK kırılma sebebidir.
  //
  // İP-A7d2 · göç dalgası 2: BEŞ dosya bu listeden ÇIKMIŞTI (28 → 20).
  //   `ExamSessionsManager` · `AdminExamCatalogs` · `CourierManager` ·
  //   `PackagesPage` · `DeliveryVehiclesPage`
  //
  // İP-A7d1 · göç dalgası 1: ÜÇ dosya ÇIKMIŞTI.
  //   `AdminAuditLogsPage` (tabanın TEK "prop olarak inen pencere durumu"
  //   örneğiydi) · `AdminBookingsPage` · `AdminLibraries`
  //
  // İP-A6 · Görev 4d: `store/` altındaki BEŞ dosya ÇIKMIŞTI.
];

const olcum = sayim();

describe("İP-A1 nöbetçi eşikleri", () => {
  it("ölçüm tabanı listesindeki HER dosya diskte durur (kaçış kapısı)", () => {
    // İP-A6 · Görev 1 / TB-A5-1. Bir ekranı ölçüm ağacının dışına taşımak
    // eşikleri sessizce düşürüyordu; artık liste ölçümün kaynağı olduğu için
    // taşınan dosya BURADA isimle görünür. Eşikler bu testten sonra okunur:
    // eksik dosya varken düşen bir sayı ilerleme değil, kayıptır.
    expect(olcum.eksikDosyalar).toEqual([]);
  });

  it("panel ağacındaki her dosya listede yazılıdır (borç ölçüme girmeden doğamaz)", () => {
    // Ters yön: yeni bir panel dosyası listeye eklenmeden ölçüme giremez.
    expect(olcum.fazlaDosyalar).toEqual([]);
  });

  it("ölçülen dosya kümesi listenin TA KENDİSİDİR", () => {
    // Taban çökerse tüm sayımlar 0'a düşer ve her eşik "geçer". Eski koruma
    // sayı tabanlıydı (`files >= 60`, `kontrolToplam >= 140`) ve göçün
    // kendisi tarafından kırılacaktı; artık taban KİMLİKLE doğrulanıyor.
    expect(olcum.dosyalar).toEqual(OLCUM_TABANI);
  });

  it("ham <button sayısı artamaz (bugünkü taban 102)", () => {
    // İP-A3c'de 126 → 160: taban altı ekran genişledi (Operator*/Courier*/
    // Delivery*), bu ekranlarda zaten duran 34 ham buton görünür oldu.
    //
    // İP-A4'te 160 → 158: `DataTable`ın sayfalama düğmeleri ortak `Button`a
    // geçti. Pilot ekranın (`DamageEventsPage`) KENDİ ham butonu YOKTU —
    // İP-A2/A3c'de zaten temizlenmişti; göç bu sayıyı oradan düşüremezdi ve
    // düşmüş gibi yazmak sahte ilerleme olurdu (rapor → Görev 6).
    //
    // İP-A6'da 158 → 131 (**-27**): `AdminStore`un sekiz bölümünün ham
    // düğmeleri ortak `Button`a geçti. Kalan tek ham `<button>` o ekranda
    // `ProductForm`un katlanır bölüm başlığıdır (`KatlanirBaslik`) ve
    // BİLİNÇLİDİR: bir aksiyon değil, `aria-expanded` taşıyan bir açma/kapama
    // denetimi; ortak `Button`ın dolgu/gölge varyantları oraya uymuyor.
    // İP-A6b'de 131 → 199 (**+68**): import grafiği (Görev 3) tabana 27 dosya
    // ekledi. Borç ARTMADI — bugüne dek ölçülmüyordu: `ExamSessionsManager` 14,
    // `MapPicker` 9, `PersonalizeModal` 7, `ImageCropModal` 6, `LibraryEditorModal` 5…
    //
    // İP-A7d1'de 199 → 182 (**-17**): göç dalgası 1. `AdminLibraries` 13
    // (kart aksiyonları + operatör formu + iki pencere başlığı) ve
    // `LibraryEditorModal` 4 düğme ortak `Button`a geçti. Editörde KALAN tek
    // ham `<button>` olanak rozetleridir (`aria-pressed` taşıyan yuvarlak
    // seçim çipi) ve BİLİNÇLİDİR: bir aksiyon değil bir seçim durumu; ortak
    // `Button`ın dolgu/gölge varyantları oraya uymuyor — `AdminStore`daki
    // `KatlanirBaslik` istisnasının aynısı.
    //
    // İP-A7d2'de 182 → 130 (**-52**): göç dalgası 2, altı ekran.
    //   `CourierManager` 15 · `ExamSessionsManager` 14 ·
    //   `DeliveryVehiclesPage` 14 · `AdminExamCatalogs` 6 ·
    //   `AdminPayoutsPage` 3 (sekme şeridinin İKİ düğmesi KALDI).
    //
    // Kalan bilinçli istisnalar aynı ailedendir ve hepsi `aria-pressed`
    // taşıyan SEÇİM DURUMLARIDIR, aksiyon değil: `AdminStore`un katlanır
    // bölüm başlığı, kütüphane editörünün olanak rozetleri, `PackagesPage`in
    // durum süzgeci çipleri ve `AdminPayoutsPage`in sekme şeridi. Ortak
    // `Button`ın dolgu/gölge varyantları bu görsel dili taşımıyor.
    // İP-A7d3'te 130 → 104 (**-26**): göç dalgası 3, on ekran.
    //   `AdminHome` 12 · `DeliveryRunDetailPage` 5 · `OperatorLibrary` 3 ·
    //   `OperatorHome` 3 · `OperatorSessions` 3.
    //
    // `OperatorLibrary` ve `AdminHome`da BİRER ham `<button>` bilerek KALDI ve
    // ikisi de aynı aileden: `aria-pressed` taşıyan SEÇİM DURUMLARI (olanak
    // rozeti, süzgeç çipi), aksiyon değil. A7d3'te ikisine de eksik olan
    // `aria-pressed` EKLENDİ — yani sayı düşmedi ama borç azaldı: bir çipin
    // seçili olduğu artık ekran okuyucuda görünüyor.
    // İP-A7d4'te 104 → 102 (**-2**): göç dalgası 4. `ClosedDays`in "günü
    // yeniden aç" ikonu ve `AdminOperationsPage`in "yeniden dene" düğmesi
    // ortak `Button`a geçti. Düşüş KÜÇÜK ve bu BEKLENENDİ: kalan 102'nin
    // 41'i saha ekranı + üç paylaşılan widget, ~55'i kabuk bileşenlerinin
    // kendi iç denetimleri, 5'i `aria-pressed` taşıyan seçim çipleri —
    // hepsi A7d3 raporunda isimle ve gerekçesiyle yazılı. Bu metrik sıfıra
    // İNMEYECEK ve inmemeli; doğru kapanış hedefi "kalanın her biri isimle
    // ve gerekçesiyle yazılı" olmasıdır.
    // İP-B1'de 102 → 99 (**-3**): panel kabuğu. Mobil çekmecenin hamburger'ı
    // ve kapatma düğmesi ortak `Button`a geçti; zemin katmanı ham bir
    // `<button aria-label="…kapat">` iken `aria-hidden` bir katmana indi —
    // odak sırasından da çıktı, yani düşüş erişilebilirlik kazancının yan
    // ürünü. Kabuk YENİ denetimler getirdi (arama, katlama, profil, tema)
    // ama hiçbiri ham düğme değil: hepsi ortak `Button` ya da `<label>` içine
    // sarılı `<input type="radio">`. Komut penceresi de sonuç başına bir ham
    // düğme yazan eski palet desenini değil listbox desenini kullanıyor.
    // CMS Faz 1'de 99 → 100 (**+1**): blog editörünün araç çubuğu
    // (`BlogBodyEditor`). Tek ham `<button>` biçim SEÇİM durumlarıdır
    // (`aria-pressed` taşıyan kalın/italik/liste anahtarları) — `AdminStore`
    // KatlanirBaslik ailesinin aynısı; ortak `Button`ın dolgu/gölge
    // varyantları kompakt araç çubuğuna uymuyor. Editörün diğer düğmeleri
    // (bağlantı formu, kapak kaldırma) ortak `Button`dadır.
    expect(olcum.rawButton).toBeLessThanOrEqual(100);
  });

  it("erişilebilir adı olmayan form kontrolü artamaz (bugünkü taban 7)", () => {
    // İP-A3a'da eski `<label htmlFor>` ORANININ yerini aldı. Gerekçe için
    // dosya başındaki nota bak. İP-A3c'de 41 → 56: taban genişlemesiyle
    // görünür olan 15 borç (OperatorLibrary 7, DeliveryDriver 4,
    // OperatorHome 3, OperatorSessions 1).
    //
    // "Sayaç bozulursa sessizce geçer" riski artık DOSYA LİSTESİ testiyle
    // kapatılıyor; eski `kontrolToplam >= 140` koruması KALDIRILDI çünkü göçün
    // kendisi onu kıracaktı (bkz. dosya başı notu).
    //
    // İP-A6'da 56 → 30 (**-26**): `AdminStore`un 26 adsız kontrolünün TAMAMI
    // kapandı (`ProductForm` 17, `CouponsPanel` 6, `BulkImportPanel` /
    // `CategoriesPanel` / `OrdersPanel` 1'er). Hepsi aynı desendeydi —
    // `placeholder` etiket yerine kullanılıyordu — ve hepsi `Form.Item` +
    // `Form.Label` + `Form.Control`a geçti. `store/` ağacında artık SIFIR
    // adsız kontrol var.
    // ── İP-A6b · Görev 2: BU EŞİK ARTIK DOĞRULUK KAYNAĞI DEĞİLDİR ──
    //
    // Sayaç kaynakta YAZILANI sayar; kullanıcı RENDER EDİLENİ görür. On iki
    // çağrılı tek yazımlık bir alan fabrikası buraya **bir** kontrol gibi
    // görünür (M-A · `mA.kacis.test.tsx`: gerçek borç +11, bu sayı +0).
    //
    // Kapı çalışma zamanına devredildi:
    //   - `calismaZamaniKapisi.test.tsx` — mount edilebilen 68 taban ekranı
    //     render edilir, adsız kontrol DOM'dan sayılır (bugün: 0)
    //   - `adminStoreDalAdlari.acceptance.test.tsx` — göç eden formların TÜM
    //     koşullu dalları açılır
    //
    // Buradaki tavan TEŞHİS olarak duruyor: kaynakta yazılı borcun sessizce
    // büyümemesini tutar ve `adsizKontrolDosyalari` göç edene nereye bakacağını
    // söyler. Tek başına "adsız alan yok" kanıtı DEĞİLDİR.
    // İP-A6b'de 30 → 41 (**+11**): import grafiğinin getirdiği dosyalarda
    // zaten duran borç (`LibraryPayoutForm` 5, `ExamSessionsManager` 2,
    // `PersonalizeModal` 2, `ImageCropModal` 1, `MapPicker` 1).
    //
    // İP-A7d1'de 41 → 37 (**-4**): `AdminLibraries`in operatör ekleme formunun
    // dört alanı `placeholder`ı etiket yerine kullanıyordu; `htmlFor`/`id`
    // bağıyla ve hata slotuyla yeniden yazıldı.
    //
    // İP-A7d2'de 37 → 26 (**-11**): tabanın en büyük kalemi `CourierManager`
    // (9) kapandı — dört satır içi formun tamamı `Form.*`a geçti; gizli
    // vesikalık `<input type="file">`ına da gerçek bir ad verildi (`hidden`
    // ÖZNİTELİĞİ kullanılmadı: o, borcu kapatmadan ölçümden düşürürdü).
    // Ayrıca `ExamSessionsManager`in sonuç tablosundaki iki sayısal alan (net
    // ve sıra) öğrenci adını içeren `aria-label` aldı.
    //
    // **Ölçüm sırasında bulunan bir tuzak (rapor · Görev 4):**
    // `DeliveryVehiclesPage`in alanları önce tek bir render-prop
    // sarmalayıcısından geçirilmişti. Çalışma zamanı kapısı ve dal testi
    // "adsız kontrol 0" diyordu ama BU SAYAÇ 13 sahte borç raporladı — sayaç
    // `Form.Control` içindeki `<input>`u bir fonksiyon gövdesinin ardında
    // göremez. Alanlar açık `Form.Field` bloklarına çevrildi. İP-A6b'nin M-A
    // kaçışının aynadaki hâli: orada gerçek borç gizleniyordu, burada sahte
    // borç üretiliyordu.
    // İP-A7d3'te 26 → 7 (**-19**): göç dalgası 3.
    //   `OperatorLibrary` 7 (beş adres kutusu + iki saat kutusu) ·
    //   `LibraryPayoutForm` 5 (IBAN/TCKN/unvan — `Form.*`a geçti) ·
    //   `OperatorHome` 3 (şifre paneli) · `AdminHome` 2 (iki red notu) ·
    //   `OperatorSessions` 1 (elle bilet kodu) · `MapPicker` 1 (adres arama).
    //
    // `MapPicker` A7d2'nin kapanış notunda "dalga 3'te kapatılmalı" diye
    // yazılıydı ve üç ayrı testte "bilinen istisna" olarak taşınıyordu;
    // `aria-label` ile kapandı ve `CALISMA_ZAMANI_ADSIZ` tabanından çıktı.
    //
    // KALAN 7'nin tamamı bu dalganın kapsamı dışındaki üç dosyada:
    //   `DeliveryDriver` 4 (saha/mobil ekran, kendi dalgasını bekliyor) ·
    //   `PersonalizeModal` 2 · `ImageCropModal` 1 (paylaşılan widget'lar).
    expect(olcum.adsizKontrol).toBeLessThanOrEqual(7);
  });


  // ── İP-A4 · Görev 6: ekranda yaşayan pencere (modal) durumu ──
  //
  // Pencere yönetimi `ui2/duzenlemeYuzeyi.tsx`'e taşındı. Bu iki test geri
  // kaymayı ve YAYILMAYI ayrı ayrı tutar: sayı artamaz, VE listeye yeni dosya
  // giremez. Sadece sayıya bakmak yetmezdi — göç eden bir ekran borcunu
  // kapatırken başka bir ekran yenisini ekleyebilir ve toplam sabit kalırdı.
  it("ekranda yaşayan pencere durumu SIFIR (tavan değil TABAN)", () => {
    // İP-A5'te 33 → 35: BORÇ ARTMADI, sayaç düzeltildi. Metriğin yazılı
    // sözleşmesi "bağ başına bir kez" idi ama uygulama dosya başına bir
    // `Set<ad>` tutuyordu; `AdminStore.tsx`teki ÜÇ ayrı `deleting` bağı
    // (ürün satırı, kategori satırı, kupon satırı) tek bağ sayılıyordu.
    //
    // Kusuru İP-A5'in bölmesi görünür etti: üç bağ üç ayrı dosyaya
    // gidince eski sayaç aynı JSX için 33 yerine 35 diyecekti — yani ölçüm,
    // ölçtüğü şeyin dosyalara nasıl dağıldığına bağlıydı. Sayaç artık bağı
    // ADIYLA değil BİLDİRİM YERİYLE ayırt ediyor (sözlüksel kapsam) ve
    // sonuç bölmeden ÖNCE de SONRA da 35'tir.
    //
    // İP-A6'da 35 → 29 (**-6**): `store/` altındaki ALTI bağ
    // (`ProductsPanel`de `editing` + `deleting`, `CategoriesPanel`,
    // `CouponsPanel`, `ReturnsPanel`, `OrdersPanel`de iki) düzenleme
    // yüzeyine taşındı. İP-A5'in öngördüğü düşüş buydu; ölçülen -6 (öngörü
    // -5 idi, `editing` de sayıldığı için bir fazla).
    // İP-A6b'de 29 → 32. İki ayrı sebep, ikisi de ölçümün dürüstleşmesi:
    //   +2  import grafiği (Görev 3) → `ExamSessionsManager`ın iki bağı
    //   +1  prop olarak inen durum (Görev 4 · BULGU-3) → `AdminAuditLogsPage`
    //
    // Saha sayımı (Görev 4'ün açık bıraktığı soru): tüm tabanda prop-ile-inen
    // pencere durumunun TEK örneği vardır. Denetim bunu sentetik mutasyonla
    // kanıtlamıştı; gerçek sayı ölçülmemişti ve tahmin eşiğe yazılmamıştı.
    // İP-A7d2'de 28 → 20 (**-8**): göç dalgası 2'nin altı ekranından beşi
    // pencere durumu taşıyordu; sekiz bağın hepsi `useDuzenlemeYuzeyi`ye
    // geçti (dosya listesi aşağıda).
    // İP-A7d3'te 20 → 9 (**-11**): göç dalgası 3'ün altı ekranı pencere
    // durumu taşıyordu; on bir bağın hepsi `useDuzenlemeYuzeyi`ye geçti
    // (dosya listesi yukarıda).
    // İP-A7d4'te 9 → 2 (**-7**): göç dalgası 4'ün altı ekranı yedi bağ
    // taşıyordu; hepsi `useDuzenlemeYuzeyi`ye geçti.
    //   `AdminAccessPage` (SK-9) · `ClosedDays` · `AdminOperationsPage` ·
    //   `AdminSettingsPage` · `DeliveryBoardPage` · `DeliveryTodayPage` (2)
    //
    // İP-A7d4 kapanışında 2 → **0**: son iki bağ da (`AdminDemandsPage`,
    // `ReturnQueuePage`) düzenleme yüzeyine taşındı.
    //
    // Eşik artık `toBe(0)` ve bu, metriğin EN SERT hâlidir — etiketsiz
    // overlay'de A7d2'de yapılanın aynısı. Bir TAVAN "borç büyümesin" der;
    // bir TABAN "borç YOK" der: panelde ekranda yaşayan bir pencere durumu
    // doğduğu gün CI kırılır ve hangi dosyada doğduğu alttaki liste
    // testinde isimle görünür.
    //
    // İ9 kapanışı: `src/panel/**` ölçüme girince `PanelShell.tsx`in mobil
    // gezinme çekmecesi bu metriğe TAKILDI (dosya başı notuna bak). Metrik
    // ARTAN bir borç değildi — bir GEZİNME MENÜSÜ ile bir KAYIT DÜZENLEME
    // yüzeyi aynı sözdizimsel desene (`<XDialog open={..}>`) sahip olduğu
    // için aynı kovaya düşüyordu. Kova ikiye ayrıldı
    // (`GEZINME_CEKMECELERI`); bu test KAYIT DÜZENLEME kovasını ölçmeye
    // devam ediyor ve TABAN yine `0`dır — gezinme çekmecesi kendi testinde
    // (aşağıda) ayrıca ve KİMLİKLE tutuluyor.
    expect(olcum.modalDurumu).toBe(0);
  });

  it("pencere durumu tutan dosya listesi BOŞTUR", () => {
    // Sayı sıfırlanınca bu test bir tekrar gibi görünür ama değildir: sayı
    // eşiği "kaç tane" der, bu test "HANGİ dosyada" der. Bir bağ doğduğunda
    // ikisi birden kırılır ve yalnız bu ikincisi nereye bakılacağını söyler.
    expect(olcum.modalDurumDosyalari.map((d) => d.dosya)).toEqual(MODAL_DURUM_DOSYALARI);
    // İP-A4'ten beri burada duran "pilot ekran listede DEĞİL" iddiası
    // (`not.toContain(DamageEventsPage)`) KALDIRILDI: liste boşaldığı için
    // artık boş küme üzerinde çalışan, her koşulda doğru bir iddiaydı —
    // canlı bir nöbetçi gibi okunan ölü bir kontrol. Yerini alan iddia
    // yukarıdaki satırdır ve daha güçlüdür: liste BOŞ, yani pilot ekran da
    // dahil HİÇBİR dosya listede değil.
  });

  // ── İ9 · Boşluk 1 kapanışı: GEZİNME ÇEKMECESİ — ayrı kategori, KİMLİKLE ──
  //
  // `useDuzenlemeYuzeyi` (`components/admin/ui2/yuzeyDurumu.ts`) bir KAYIT
  // düzenleme durum makinesidir (`ac(kayit)`/`yeniAc(baglam)`,
  // `hedef:{tur:"kayit"|"yeni"}`). `PanelShell`in mobil çekmecesi bir gezinme
  // MENÜSÜdür: kaydı yok, "yeni" hâli yok, kirli form onayı gerekmez. İkisini
  // aynı kovada tutmak ya eşiği gevşetirdi (borcu gizlerdi) ya da çekmeceyi
  // `useDuzenlemeYuzeyi`ye taşımayı gerektirirdi (hook'un anlamını bozardı).
  //
  // Bu iki test yukarıdaki ikilinin İKİZİDİR, ama TERS yönde: yukarıdaki iki
  // test "kayıt düzenleme borcu SIFIR" der, bunlar "bilinen gezinme
  // çekmeceleri İSİMLE sabit" der. Üçüncü bir gezinme çekmecesi (ya da
  // ikincisi) `GEZINME_CEKMECELERI`ye elle eklenmeden bu testleri KIRAR —
  // sessizce geçemez. Sözdizimsel tespit ve "yanlış tarafa kaçamaz" kanıtı
  // `scripts/ui-baseline-sayim.mjs`teki `GEZINME_CEKMECELERI` sabitinin
  // yanındaki yorumda.
  it("gezinme çekmecesi durumu KİMLİKLE sabittir (tavan değil, sayılı liste)", () => {
    expect(olcum.gezinmeCekmecesiDurumu).toBe(GEZINME_CEKMECELERI.length);
  });

  it("gezinme çekmecesi tutan dosya + bağ listesi BİLİNEN listenin TA KENDİSİDİR", () => {
    const beklenen = GEZINME_CEKMECELERI.map((g) => ({ dosya: g.dosya, adlar: [g.ad] }));
    expect(olcum.gezinmeCekmecesiDosyalari).toEqual(beklenen);
  });

  // ── Nöbetçinin kendini sınaması: İKİ uydurma ihlal, ikisi de kırmızı ──
  //
  // `sayim()` yalnız `OLCUM_TABANI`ndaki dosyaları okur; panel koduna
  // dokunmadan yeni bir ihlal ÜRETMENİN yolu `dosyaOlcumu`yu sentetik
  // kaynakla, GERÇEK dosya adıyla (`dosyaAdi = "src/panel/layout/
  // PanelShell.tsx"`) çağırmaktır — sayaç dosya+ad eşleşmesini bu isim
  // üzerinden yapar, gerçek dosyayı okumaz.
  it("[kendini sınama 1] panelde GERÇEK bir kayıt düzenleme durumu doğarsa kırmızı", () => {
    // Yeni bir alan (`kayitAcik`) gerçek bir düzenleme penceresine akıyor.
    // `GEZINME_CEKMECELERI`de bu isim yok → varsayılan kovaya (KAYIT
    // DÜZENLEME) düşmeli.
    const kaynak = `
      export function PanelShell() {
        const [kayitAcik, setKayitAcik] = useState(false);
        return <KayitDuzenlemeDialog open={kayitAcik} />;
      }
    `;
    const o = dosyaOlcumu(kaynak, "src/panel/layout/PanelShell.tsx");
    expect(o.modalDurumAdlari).toEqual(["kayitAcik"]);
    expect(o.gezinmeCekmecesiAdlari).toEqual([]);
  });

  it("[kendini sınama 2] İKİNCİ bir gezinme çekmecesi (yeni ad ya da yeni dosya) kaçamaz", () => {
    // (a) Aynı dosyada, farklı adlı ikinci bir `Drawer` — ad eşleşmiyor.
    const ikinciCekmeceAyniDosya = `
      export function PanelShell() {
        const [ikinciAcik, setIkinciAcik] = useState(false);
        return <Drawer open={ikinciAcik} />;
      }
    `;
    const a = dosyaOlcumu(ikinciCekmeceAyniDosya, "src/panel/layout/PanelShell.tsx");
    expect(a.modalDurumAdlari).toEqual(["ikinciAcik"]);
    expect(a.gezinmeCekmecesiAdlari).toEqual([]);

    // (b) Başka bir dosyada, AYNI adla ve AYNI bileşenle bir `Drawer` —
    // dosya eşleşmiyor. Kimlik dosyaya bağlıdır, yalnız ada değil.
    const ayniAdBaskaDosya = `
      export function BaskaEkran() {
        const [mobilAcik, setMobilAcik] = useState(false);
        return <Drawer open={mobilAcik} />;
      }
    `;
    const b = dosyaOlcumu(ayniAdBaskaDosya, "src/panel/pages/BaskaEkran.tsx");
    expect(b.modalDurumAdlari).toEqual(["mobilAcik"]);
    expect(b.gezinmeCekmecesiAdlari).toEqual([]);

    // (c) Bilinen çekmecenin adı (`mobilAcik`, aynı dosya) GERÇEKTEN bir
    // düzenleme penceresine de akarsa — bağlandığı bileşen kümesi tek
    // başına `Drawer` olmadığı için — yine KAYIT DÜZENLEME kovasına düşer.
    const ayniAdIkiFarkliBilesen = `
      export function PanelShell() {
        const [mobilAcik, setMobilAcik] = useState(false);
        return (
          <>
            <Drawer open={mobilAcik} />
            <KayitDialog open={mobilAcik} />
          </>
        );
      }
    `;
    const c = dosyaOlcumu(ayniAdIkiFarkliBilesen, "src/panel/layout/PanelShell.tsx");
    expect(c.modalDurumAdlari).toEqual(["mobilAcik"]);
    expect(c.gezinmeCekmecesiAdlari).toEqual([]);

    // Ters prova: gerçek (bugünkü) `PanelShell.tsx` GEZİNME kovasına düşer —
    // yukarıdaki üç senaryonun KAYIT DÜZENLEME kovasına düşmesi bir yanlış
    // pozitif değil, sınıflandırıcının farkı gerçekten ayırt ettiğinin
    // kanıtıdır.
    const bugunkuPanelShell = `
      export function PanelShell() {
        const [mobilAcik, setMobilAcik] = useState(false);
        return <Drawer open={mobilAcik} />;
      }
    `;
    const d = dosyaOlcumu(bugunkuPanelShell, "src/panel/layout/PanelShell.tsx");
    expect(d.modalDurumAdlari).toEqual([]);
    expect(d.gezinmeCekmecesiAdlari).toEqual(["mobilAcik"]);
  });

  it("hiçbir .ts dosyası createElement(\"button\") ile ham düğme üretmiyor", () => {
    // İP-A6b · Görev 3: import grafiği `.ts` modüllerinde DURUYOR (JSX
    // taşıyamazlar). Kapanışın orada durmasının bıraktığı tek delik budur ve
    // bütün kaynak ağacında aranarak kapatılır — taban ile sınırlı değil.
    expect(tsHamButonlari()).toEqual([]);
  });

  it("ui2/ dışında @medusajs/ui import eden dosya yok", () => {
    // Kalıcı kural: ekran dosyaları Medusa'yı doğrudan import etmez.
    expect(olcum.medusaDirectImports).toEqual([]);
  });

  it("role=dialog/aria-modal taşımayan overlay SIFIR (tavan değil TABAN)", () => {
    // İP-A6'da 5 → 4: `store/EditProductModal.tsx` ortak yüzeye geçti.
    // İP-A6b'de 4 → 6: import grafiğiyle görünen `ExamSessionsManager` ve
    // `LibraryEditorModal` kendi katmanlarını etiketsiz kuruyor (Görev 3).
    // İP-A7d1'de 6 → 3: `LibraryEditorModal` ve `AdminLibraries`in iki iç
    // penceresi ortak `DuzenlemePenceresi`ye geçti.
    // İP-A7d2'de 3 → **0**: kalan üçü de (`ExamSessionsManager`,
    // `AdminExamCatalogs`, `AdminPayoutsPage`) ortak pencereye geçti. Eşik
    // artık SIFIR ve bu metriğin en sert hâlidir: panelde etiketsiz bir
    // overlay doğduğu gün CI kırılır.
    // İP-A7d3: SIFIRDA KALDI. Bu dalga on ekran göç ettirdi ve hiçbiri yeni
    // bir katman kurmadı — `toBe(0)` bir tavan değil TABANDIR ve bir tane
    // bile doğsa CI kırılır.
    expect(olcum.unlabeledOverlays).toBe(0);
  });

  it("etiketsiz overlay'i olan dosya listesi sabittir", () => {
    // Yeni bir dosya listeye girerse test kırılır — borç sessizce yayılamaz.
    expect(olcum.overlayOffenders).toEqual([...UNLABELED_OVERLAY_FILES].sort());
  });
});
