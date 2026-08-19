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
import { sayim, UNLABELED_OVERLAY_FILES } from "../../scripts/ui-baseline-sayim.mjs";

/**
 * Ölçüm tabanının TAM dosya listesi — nöbetçinin gerçek zemini.
 *
 * Bu liste elle bakılıp güncellenir. Kırıldığında sorulacak soru: "dosya
 * gerçekten panelin bir parçası mı, öyleyse listeye ekle" ya da "silindi mi,
 * öyleyse çıkar". Sessizce güncellenmesi eşikleri anlamsızlaştırır.
 */
const OLCUM_TABANI = [
  "src/components/admin/AccessState.tsx",
  "src/components/admin/CourierManager.tsx",
  "src/components/admin/ProductPicker.tsx",
  "src/components/admin/StockBadge.tsx",
  "src/components/admin/StockLedgerPanel.tsx",
  "src/components/admin/StockMovementTable.tsx",
  "src/components/admin/StockMovementsPanel.tsx",
  "src/components/admin/data-table/DataTable.tsx",
  "src/components/admin/data-table/index.ts",
  "src/components/admin/delivery/CapacityStrip.tsx",
  "src/components/admin/delivery/ClosedDays.tsx",
  "src/components/admin/delivery/ItemLines.tsx",
  "src/components/admin/delivery/LabelSheet.tsx",
  "src/components/admin/delivery/bits.tsx",
  "src/components/admin/inventory/DamageDialog.tsx",
  "src/components/admin/layout/AdminLayout.tsx",
  "src/components/admin/layout/AdminPageHeader.tsx",
  "src/components/admin/layout/AdminSidebar.tsx",
  "src/components/admin/layout/adminNavigation.ts",
  "src/components/admin/packing/PackageLabel.tsx",
  "src/components/admin/packing/PackingLabelSheet.tsx",
  "src/components/admin/ui/Badge.tsx",
  "src/components/admin/ui/Button.tsx",
  "src/components/admin/ui/ConfirmDialog.tsx",
  "src/components/admin/ui/Dialog.tsx",
  "src/components/admin/ui/PageState.tsx",
  "src/components/admin/ui/index.ts",
  "src/components/admin/ui2/duzenlemeYuzeyi.tsx",
  "src/components/admin/ui2/form.tsx",
  "src/components/admin/ui2/kirliFormBekcisi.tsx",
  "src/components/admin/ui2/medusa-tr.tsx",
  "src/pages/DeliveryDriver.tsx",
  "src/pages/DeliveryRunHandover.tsx",
  "src/pages/admin/AdminAccessPage.tsx",
  "src/pages/admin/AdminAuditLogsPage.tsx",
  "src/pages/admin/AdminBookingsPage.tsx",
  "src/pages/admin/AdminDashboardPage.tsx",
  "src/pages/admin/AdminDemandsPage.tsx",
  "src/pages/admin/AdminOperationsPage.tsx",
  "src/pages/admin/AdminPayoutsPage.tsx",
  "src/pages/admin/AdminReportsPage.tsx",
  "src/pages/admin/AdminSectionPage.tsx",
  "src/pages/admin/AdminSettingsPage.tsx",
  "src/pages/admin/AdminUserDetailPage.tsx",
  "src/pages/admin/AdminUsersPage.tsx",
  "src/pages/admin/delivery/DeliveryBoardPage.tsx",
  "src/pages/admin/delivery/DeliveryCouriersPage.tsx",
  "src/pages/admin/delivery/DeliveryLayout.tsx",
  "src/pages/admin/delivery/DeliveryOrdersPage.tsx",
  "src/pages/admin/delivery/DeliveryPerformancePage.tsx",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx",
  "src/pages/admin/delivery/DeliveryRunsPage.tsx",
  "src/pages/admin/delivery/DeliveryTodayPage.tsx",
  "src/pages/admin/delivery/DeliveryVehiclesPage.tsx",
  "src/pages/admin/inventory/CountSessionDetailPage.tsx",
  "src/pages/admin/inventory/CountSessionsPage.tsx",
  "src/pages/admin/inventory/DamageEventsPage.tsx",
  "src/pages/admin/inventory/InventoryLayout.tsx",
  "src/pages/admin/inventory/InventoryOverviewPage.tsx",
  "src/pages/admin/packing/PackagesPage.tsx",
  "src/pages/admin/packing/PackingLayout.tsx",
  "src/pages/admin/packing/PackingQueuePage.tsx",
  "src/pages/admin/packing/PackingStationPage.tsx",
  "src/pages/admin/packing/ReturnQueuePage.tsx",
  "src/pages/dashboards/AdminExamCatalogs.tsx",
  "src/pages/dashboards/AdminHome.tsx",
  "src/pages/dashboards/AdminLibraries.tsx",
  "src/pages/dashboards/AdminStore.tsx",
  "src/pages/dashboards/CourierHome.tsx",
  "src/pages/dashboards/OperatorHome.tsx",
  "src/pages/dashboards/OperatorLibrary.tsx",
  "src/pages/dashboards/OperatorSessions.tsx",
];

/**
 * Pencere (modal) durumunu HÂLÂ ekranda tutan dosyalar — İP-A4 tabanı.
 *
 * A6-A7'de her göç eden ekran bu listeden ÇIKAR. Listeye yeni dosya girmesi
 * göçün tersine işlediği anlamına gelir ve test kırılır.
 */
const MODAL_DURUM_DOSYALARI = [
  "src/components/admin/CourierManager.tsx",
  "src/components/admin/delivery/ClosedDays.tsx",
  "src/pages/admin/AdminAccessPage.tsx",
  "src/pages/admin/AdminBookingsPage.tsx",
  "src/pages/admin/AdminDemandsPage.tsx",
  "src/pages/admin/AdminOperationsPage.tsx",
  "src/pages/admin/AdminReportsPage.tsx",
  "src/pages/admin/AdminSettingsPage.tsx",
  "src/pages/admin/delivery/DeliveryBoardPage.tsx",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx",
  "src/pages/admin/delivery/DeliveryTodayPage.tsx",
  "src/pages/admin/delivery/DeliveryVehiclesPage.tsx",
  "src/pages/admin/inventory/CountSessionDetailPage.tsx",
  "src/pages/admin/inventory/CountSessionsPage.tsx",
  "src/pages/admin/packing/PackagesPage.tsx",
  "src/pages/admin/packing/PackingStationPage.tsx",
  "src/pages/admin/packing/ReturnQueuePage.tsx",
  "src/pages/dashboards/AdminExamCatalogs.tsx",
  "src/pages/dashboards/AdminHome.tsx",
  "src/pages/dashboards/AdminLibraries.tsx",
  "src/pages/dashboards/AdminStore.tsx",
];

const olcum = sayim();

describe("İP-A1 nöbetçi eşikleri", () => {
  it("ölçüm tabanı dosya listesi SABİTTİR (yanlış yeşil koruması)", () => {
    // Taban çökerse tüm sayımlar 0'a düşer ve her eşik "geçer". Eski koruma
    // sayı tabanlıydı (`files >= 60`, `kontrolToplam >= 140`) ve göçün
    // kendisi tarafından kırılacaktı; artık taban KİMLİKLE doğrulanıyor.
    expect(olcum.dosyalar).toEqual(OLCUM_TABANI);
  });

  it("ham <button sayısı artamaz (taban 158)", () => {
    // İP-A3c'de 126 → 160: taban altı ekran genişledi (Operator*/Courier*/
    // Delivery*), bu ekranlarda zaten duran 34 ham buton görünür oldu.
    //
    // İP-A4'te 160 → 158: `DataTable`ın sayfalama düğmeleri ortak `Button`a
    // geçti. Pilot ekranın (`DamageEventsPage`) KENDİ ham butonu YOKTU —
    // İP-A2/A3c'de zaten temizlenmişti; göç bu sayıyı oradan düşüremezdi ve
    // düşmüş gibi yazmak sahte ilerleme olurdu (rapor → Görev 6).
    expect(olcum.rawButton).toBeLessThanOrEqual(158);
  });

  it("erişilebilir adı olmayan form kontrolü artamaz (taban 56)", () => {
    // İP-A3a'da eski `<label htmlFor>` ORANININ yerini aldı. Gerekçe için
    // dosya başındaki nota bak. İP-A3c'de 41 → 56: taban genişlemesiyle
    // görünür olan 15 borç (OperatorLibrary 7, DeliveryDriver 4,
    // OperatorHome 3, OperatorSessions 1).
    //
    // "Sayaç bozulursa sessizce geçer" riski artık DOSYA LİSTESİ testiyle
    // kapatılıyor; eski `kontrolToplam >= 140` koruması KALDIRILDI çünkü göçün
    // kendisi onu kıracaktı (bkz. dosya başı notu).
    expect(olcum.adsizKontrol).toBeLessThanOrEqual(56);
  });


  // ── İP-A4 · Görev 6: ekranda yaşayan pencere (modal) durumu ──
  //
  // Pencere yönetimi `ui2/duzenlemeYuzeyi.tsx`'e taşındı. Bu iki test geri
  // kaymayı ve YAYILMAYI ayrı ayrı tutar: sayı artamaz, VE listeye yeni dosya
  // giremez. Sadece sayıya bakmak yetmezdi — göç eden bir ekran borcunu
  // kapatırken başka bir ekran yenisini ekleyebilir ve toplam sabit kalırdı.
  it("ekranda yaşayan pencere durumu artamaz (taban 33)", () => {
    expect(olcum.modalDurumu).toBeLessThanOrEqual(33);
  });

  it("pencere durumu tutan dosya listesi sabittir (pilot listede DEĞİL)", () => {
    expect(olcum.modalDurumDosyalari.map((d) => d.dosya)).toEqual(MODAL_DURUM_DOSYALARI);
    // Pilot ekran göç etti: listede olmaması bu paketin kabul kriteridir.
    expect(MODAL_DURUM_DOSYALARI).not.toContain(
      "src/pages/admin/inventory/DamageEventsPage.tsx"
    );
  });

  it("ui2/ dışında @medusajs/ui import eden dosya yok", () => {
    // Kalıcı kural: ekran dosyaları Medusa'yı doğrudan import etmez.
    expect(olcum.medusaDirectImports).toEqual([]);
  });

  it("role=dialog/aria-modal taşımayan overlay sayısı artamaz (taban 5)", () => {
    expect(olcum.unlabeledOverlays).toBeLessThanOrEqual(5);
  });

  it("etiketsiz overlay'i olan dosya listesi sabittir", () => {
    // Yeni bir dosya listeye girerse test kırılır — borç sessizce yayılamaz.
    expect(olcum.overlayOffenders).toEqual([...UNLABELED_OVERLAY_FILES].sort());
  });
});
