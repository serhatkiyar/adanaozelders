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
 */
import { describe, expect, it } from "vitest";
import {
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
const MODAL_DURUM_DOSYALARI = [
  // İP-A7d2 · göç dalgası 2: BEŞ dosya bu listeden ÇIKTI (28 → 20).
  //   • `ExamSessionsManager` — iptal + yayın onayı (2 bağ)
  //   • `AdminExamCatalogs`   — katalog silme onayı
  //   • `CourierManager`      — hesap kapatma + kurye silme (2 bağ)
  //   • `PackagesPage`        — yeniden paketle + bozuldu damgası (2 bağ)
  //   • `DeliveryVehiclesPage` — araç silme onayı
  // Hepsi `useDuzenlemeYuzeyi`ye taşındı. Listeden ÇIKMAK beklenen yöndür;
  // listeye GİRMEK kırılma sebebidir.
  "src/components/admin/delivery/ClosedDays.tsx",
  // İP-A6 · Görev 4d: `store/` altındaki BEŞ dosya bu listeden ÇIKTI.
  // İP-A5'te `AdminStore.tsx`in dört adı (`decision`, `deleting`,
  // `iadeSiparisi`, `teslimSiparisi`) altı bağ olarak bu dosyalara dağılmıştı;
  // hepsi `ui2/duzenlemeYuzeyi`ne taşındı. Bu, göçün TERSİ değil kendisidir:
  // listeden ÇIKMAK beklenen yöndür, listeye GİRMEK kırılma sebebidir.
  "src/pages/admin/AdminAccessPage.tsx",
  // İP-A7d1 · Görev 3: ÜÇ dosya bu listeden ÇIKTI (göç dalgası 1).
  //   • `AdminAuditLogsPage` — tabanın TEK "prop olarak inen pencere durumu"
  //     örneğiydi (İP-A6b · BULGU-3); detay yüzeyi `DuzenlemePenceresi`ye geçti.
  //   • `AdminBookingsPage` — `decision` bağı yüzeye taşındı.
  //   • `AdminLibraries` — dört pencerenin dördü de yüzeye taşındı
  //     (`decision` + `deleting`, ikisi de sayılıyordu).
  "src/pages/admin/AdminDemandsPage.tsx",
  "src/pages/admin/AdminOperationsPage.tsx",
  "src/pages/admin/AdminReportsPage.tsx",
  "src/pages/admin/AdminSettingsPage.tsx",
  "src/pages/admin/delivery/DeliveryBoardPage.tsx",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx",
  "src/pages/admin/delivery/DeliveryTodayPage.tsx",
  "src/pages/admin/inventory/CountSessionDetailPage.tsx",
  "src/pages/admin/inventory/CountSessionsPage.tsx",
  "src/pages/admin/packing/PackingStationPage.tsx",
  "src/pages/admin/packing/ReturnQueuePage.tsx",
  "src/pages/dashboards/AdminHome.tsx",
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

  it("ham <button sayısı artamaz (taban 131)", () => {
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
    expect(olcum.rawButton).toBeLessThanOrEqual(130);
  });

  it("erişilebilir adı olmayan form kontrolü artamaz (taban 30)", () => {
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
    expect(olcum.adsizKontrol).toBeLessThanOrEqual(26);
  });


  // ── İP-A4 · Görev 6: ekranda yaşayan pencere (modal) durumu ──
  //
  // Pencere yönetimi `ui2/duzenlemeYuzeyi.tsx`'e taşındı. Bu iki test geri
  // kaymayı ve YAYILMAYI ayrı ayrı tutar: sayı artamaz, VE listeye yeni dosya
  // giremez. Sadece sayıya bakmak yetmezdi — göç eden bir ekran borcunu
  // kapatırken başka bir ekran yenisini ekleyebilir ve toplam sabit kalırdı.
  it("ekranda yaşayan pencere durumu artamaz (taban 29)", () => {
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
    expect(olcum.modalDurumu).toBeLessThanOrEqual(20);
  });

  it("pencere durumu tutan dosya listesi sabittir (pilot listede DEĞİL)", () => {
    expect(olcum.modalDurumDosyalari.map((d) => d.dosya)).toEqual(MODAL_DURUM_DOSYALARI);
    // Pilot ekran göç etti: listede olmaması bu paketin kabul kriteridir.
    expect(MODAL_DURUM_DOSYALARI).not.toContain(
      "src/pages/admin/inventory/DamageEventsPage.tsx"
    );
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

  it("role=dialog/aria-modal taşımayan overlay sayısı artamaz (taban 4)", () => {
    // İP-A6'da 5 → 4: `store/EditProductModal.tsx` ortak yüzeye geçti.
    // İP-A6b'de 4 → 6: import grafiğiyle görünen `ExamSessionsManager` ve
    // `LibraryEditorModal` kendi katmanlarını etiketsiz kuruyor (Görev 3).
    // İP-A7d1'de 6 → 3: `LibraryEditorModal` ve `AdminLibraries`in iki iç
    // penceresi ortak `DuzenlemePenceresi`ye geçti.
    // İP-A7d2'de 3 → **0**: kalan üçü de (`ExamSessionsManager`,
    // `AdminExamCatalogs`, `AdminPayoutsPage`) ortak pencereye geçti. Eşik
    // artık SIFIR ve bu metriğin en sert hâlidir: panelde etiketsiz bir
    // overlay doğduğu gün CI kırılır.
    expect(olcum.unlabeledOverlays).toBe(0);
  });

  it("etiketsiz overlay'i olan dosya listesi sabittir", () => {
    // Yeni bir dosya listeye girerse test kırılır — borç sessizce yayılamaz.
    expect(olcum.overlayOffenders).toEqual([...UNLABELED_OVERLAY_FILES].sort());
  });
});
