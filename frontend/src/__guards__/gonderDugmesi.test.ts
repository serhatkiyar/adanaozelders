// @vitest-environment node
/**
 * İP-A8 · Görev 6 — **kilitli kararın panel geneli nöbetçisi** (B-10).
 *
 * ## Neden var
 *
 * Kilitli karar: **gönder düğmesi geçerlilikle kapanmaz.** Kullanıcı basar,
 * gitmemesinin sebebini ALANDA okur — ölü bir düğme "neden çalışmıyor"
 * sorusunun cevabını hiçbir yere yazmaz.
 *
 * Karar 21 göç eden ekranda uygulandı ama **panelin tamamında nöbetçisi
 * yoktu**. Bağımsız denetim #3 sonucu ölçtü (B-10): `DeliveryOrdersPage`in
 * "Kargola" düğmesi `disabled={!tracking.trim()}` yazıyordu, hata slotu yoktu
 * ve bu ekran hiçbir göç dalgasının kapsamına girmemişti. Elle bulunan bir
 * ihlal = nöbetçisi olmayan bir karar.
 *
 * ## Bu nöbetçinin İLK koşumunda bulduğu şey
 *
 * Kayıt kurulurken **B-10 sınıfının yedi üyesi daha** görünür oldu (aşağıda
 * `gecerlilik-borc` etiketiyle). Hiçbiri göç eden 21 ekranda değil; hepsi
 * kapsam dışı yüzeylerde. Bu paket B-10'un kendisini kapattı, kalan yediyi
 * **isimle ve gerekçesiyle** kayda geçirdi — sessiz kalmaları artık mümkün
 * değil ve sekizincisi doğduğu gün CI kırılır.
 *
 * Bu, bu turda tekrar tekrar öğrenilen şeyin bir örneği daha: bir nöbetçi
 * kurulduğunda ölçülen sayı genellikle YÜKSELİR ve bu bir regresyon değil,
 * ölçümün dürüstleşmesidir.
 *
 * ## Kimlik neden satır numarası taşımıyor — ve neden SAYI taşıyor
 *
 * `dosya + etiket + normalize edilmiş ifade`. Satır numarası taşısaydı
 * ilgisiz bir satır eklemek onlarca kaydı kaydırırdı; gürültülü nöbetçi
 * susturulan nöbetçidir (`beklemeButcesi` envanteri on kalemle bunu
 * kaldırabiliyor, altmış iki kalemle kaldıramazdı).
 *
 * **Ama satır numarasından vazgeçmenin ölçülmemiş bir bedeli vardı ve bağımsız
 * doğrulama turu onu ters provayla buldu (D-1):** tarama `new Set` ile
 * tekilleştirdiği için, aynı dosyaya **aynı ifadeyle** eklenen ikinci bir
 * geçerlilik kapısı nöbetçiye hiç görünmüyordu. Sonda `PackingStationPage`e
 * ikinci bir `<Button disabled={!kod.trim()}>` koydu ve bu dosya **8/8 yeşil**
 * kaldı. Yani yukarıdaki "sekizincisi/dokuzuncusu doğduğu gün CI kırılır"
 * vaadi, ihlalin ŞEKLİ yeniyse doğruydu; tekrarıysa değildi.
 *
 * Düzeltme satır numarasına dönmek değil, kimliğe **çağrı sayısını** eklemek:
 * `ADETLER` her kimliğin kaç kez geçtiğini dondurur (yazılmayan her kimlik
 * için 1). Tekrar da, tekrarın kapanması da kırmızı üretir; kaydırma gürültüsü
 * geri gelmez. Ölçülen: **67 benzersiz kimlik / 83 ham çağrı yeri**
 * (tedarikçi bağlama penceresinin "Vazgeç"i + devre kesici açıkken kapanan
 * iki senkron düğmesi eklendi).
 *
 * ## Panel paket 1 kapanışı — 2 ÖLÜ BORÇ KAYDI temizlendi (bu paket)
 *
 * `UrunFormu.tsx`teki "Grubu Oluştur" ve `VaryantPenceresi.tsx`teki "Önizle"
 * düğmeleri `gecerlilik-borc` diye kayıtlıydı (İ9 · Boşluk 1). Borç commit
 * `2287611`de ÖDENDİ: iki düğmeden de `disabled` kaldırıldı, artık tıklanınca
 * doğrulama çalışıyor ve eksik alan `HataDurumu` ile alanda gösteriliyor
 * (emsal: `VariantMatrixPanel::uret()` / `DeliveryOrdersPage`in
 * `KargolaSatiri`si). Tarama bunu kendisi doğruladı: kayıt silinmeden ÖNCE
 * `tabanTaramasi()` bu iki kimliği zaten döndürmüyordu (taban 67, kayıt 69 —
 * fark ölü kayıtların ta kendisiydi). Kayıt aşağıda kaldırıldı; bu bir eşik
 * GEVŞETMESİ değil, gerçeğin yansımasıdır — `GECERLILIK_BORCU` `KAYIT`tan
 * TÜREDİĞİ için sayı kendiliğinden 10 → 8'e sıkılaştı, yeni bir dokuzuncu üye
 * doğduğu gün nöbetçi yine kırmızı verir.
 */
import { describe, expect, it } from "vitest";

import { disabledDugmeleri, tabanSayimi, tabanTaramasi } from "../../scripts/gonder-dugmesi.mjs";

/**
 * `disabled` çağrı yerlerinin TAM kaydı — sınıfıyla.
 *
 * Sınıflar:
 *
 *   `islem`     — gönderim UÇUŞTA. Meşru: ikinci tıklama ikinci isteği
 *                 gönderirdi. Kilitli kararın konusu bu değildir.
 *   `sinir`     — sayfalama sınırı (ilk/son sayfa). Basılacak bir şey yok.
 *   `secim`     — seçili kayıt yok / hedef seçilmemiş. Aksiyonun ÖZNESİ yok.
 *   `onkosul`   — ekranda GÖRÜNEN bir önkoşul sağlanmamış (engel listesi,
 *                 durum, kilit gerekçesi). Kullanıcı sebebi ekranda okuyor —
 *                 kilitli kararın istediği şey zaten bu.
 *   `gecerlilik-borc` — **KİLİTLİ KARARIN İHLALİ.** Düğme form geçerliliğiyle
 *                 kapanıyor ve sebep alanda yazmıyor. Kapatılması ayrı bir
 *                 paketin işi; burada isimle duruyor ki büyümesin.
 */
const KAYIT: Record<string, "islem" | "sinir" | "secim" | "onkosul" | "gecerlilik-borc"> = {
  // ── islem: gönderim uçuşta ──
  "src/components/DashboardShell.tsx <button> resendVerify.isPending": "islem",
  "src/components/ImageCropModal.tsx <button> isUploading": "islem",
  "src/components/LibraryBookmarkButton.tsx <button> toggle.isPending": "islem",
  "src/components/LibraryMediaManager.tsx <button> busy": "islem",
  "src/components/MapPicker.tsx <button> isLocating": "islem",
  "src/components/MapPicker.tsx <button> isSearching": "islem",
  "src/components/admin/CourierManager.tsx <Button> closeAccount.isPending": "islem",
  "src/components/admin/delivery/ClosedDays.tsx <Button> remove.isPending": "islem",
  "src/components/admin/ui/ConfirmDialog.tsx <Button> isPending": "islem",
  // Diploma inceleme penceresinin red modundaki "Geri"si: karar uçarken moda dönmek sonucu gizlerdi.
  // Karar düğmeleri (`Doğrula`/`Belgeyi reddet`) `VarlikDugmesi`dir; önkoşul kapısı orada, kilitte tanımlı.
  "src/panel/pages/egitmenler/DiplomaDogrulamaPenceresi.tsx <Button> mesgul()": "islem",
  // Video onay penceresi — diploma penceresinin kopyası: "Geri" ve "Kapat" karar uçarken
  // kapanmaz; karar düğmeleri (`Onayla ve yayınla`/`Videoyu reddet`) `VarlikDugmesi`dir.
  "src/panel/pages/egitmenler/VideoOnayPenceresi.tsx <Button> mesgul()": "islem",
  // Kısmi teslimat penceresinin "Vazgeç"i. "Sonraki teslimata ayır"
  // düğmesi geçerlilikle KAPANMAZ (kilitli karar): seçim boşsa ya da kutu
  // tamamen boşalıyorsa gönderim iş yapmaz, sebep pencerede yazılır ve
  // odak ilk adet alanına gider — bu yüzden burada tek kayıt var.
  "src/components/admin/packing/SplitDialog.tsx <Button> isPending": "islem",
  // Tedarikçi bağlama penceresinin "Vazgeç"i — `ReasonDialog`ınkiyle aynı
  // gerekçe: istek uçarken kapatmak sonucu gizler. "Bağla" düğmesi
  // geçerlilikle KAPANMAZ (kilitli karar), bu yüzden burada tek kayıt var.
  "src/components/admin/store/SupplierLinkDialog.tsx <Button> link.isPending": "islem",
  "src/components/admin/ui2/duzenlemeYuzeyi.tsx <Button> islemSuruyor": "islem",
  "src/pages/DeliveryDriver.tsx <button> busy": "islem",
  "src/pages/DeliveryDriver.tsx <button> runAction.isPending": "islem",
  "src/pages/DeliveryDriver.tsx <button> sendOtp.isPending": "islem",
  "src/pages/DeliveryDriver.tsx <button> uploadPhoto.isPending": "islem",
  "src/pages/admin/AdminBookingsPage.tsx <Button> pending": "islem",
  "src/panel/pages/rezervasyonlar/RezervasyonListesi.tsx <Button> mesgul": "islem",
  "src/panel/pages/rezervasyonlar/TalepListesi.tsx <Button> iptal.isPending": "islem",
  "src/panel/pages/moderasyon/AdDegisiklikleri.tsx <Button> mesgul": "islem",
  // Ödeme çekmecesi kendi dosyasına taşındı (pencere durumu ekranda yaşamasın diye).
  "src/panel/pages/finans/OdemePenceresi.tsx <Button> mesgul": "islem",
  "src/pages/admin/AdminDemandsPage.tsx <Button> cancel.isPending": "islem",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx <Button> addStops.isPending": "islem",
  "src/pages/admin/inventory/CountSessionDetailPage.tsx <Button> isPending": "islem",
  "src/pages/dashboards/AdminHome.tsx <Button> busy": "islem",
  "src/pages/dashboards/AdminHome.tsx <Button> verify.isPending": "islem",
  "src/pages/dashboards/AdminLibraries.tsx <Button> approve.isPending": "islem",
  "src/pages/dashboards/AdminLibraries.tsx <Button> reject.isPending": "islem",
  "src/pages/dashboards/CourierHome.tsx <button> isRefetching": "islem",
  "src/pages/dashboards/OperatorLibrary.tsx <Button> busy": "islem",
  "src/components/LibraryMediaManager.tsx <button> disabled": "islem",
  // Mesaj şablonu "Kaydet"i yalnız istek uçarken kilitli; boş başlık/metin
  // basınca alanın altında yazılır (borç kaydı 24 Eyl 2026'da kapandı).
  "src/components/mesaj/SablonPaneli.tsx <button> olustur.isPending": "islem",

  // ── sinir: sayfalama ──
  // Medya sekmesi sıralama okları: ilkin ÜSTÜNDE, sonuncunun ALTINDA taşınacak
  // yer yok — `sinir` sınıfının tanımı bu ("basılacak bir şey yok"). Bileşik
  // koşuldaki `reorder.isPending` ise `islem` (uçuştaki istek, çift gönderim
  // koruması); iki bileşenin ikisi de meşru, geçerlilik borcu YOK.
  "src/panel/components/MedyaSekmesi.tsx <Button> index === 0 || reorder.isPending":
    "sinir",
  "src/panel/components/MedyaSekmesi.tsx <Button> index === gorseller.length - 1 || reorder.isPending":
    "sinir",
  "src/components/admin/StockLedgerPanel.tsx <Button> offset === 0": "sinir",
  "src/components/admin/StockLedgerPanel.tsx <Button> sonSayfa": "sinir",
  "src/components/admin/StockMovementsPanel.tsx <Button> offset === 0": "sinir",
  "src/components/admin/StockMovementsPanel.tsx <Button> sonSayfa": "sinir",
  "src/components/admin/data-table/DataTable.tsx <Button> page <= 1": "sinir",
  "src/components/admin/data-table/DataTable.tsx <Button> page >= totalPages": "sinir",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx <Button> isFirst": "sinir",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx <Button> isLast": "sinir",
  "src/pages/admin/delivery/DeliveryRunsPage.tsx <Button> isLastPage": "sinir",
  "src/pages/admin/delivery/DeliveryRunsPage.tsx <Button> page === 0": "sinir",
  "src/pages/admin/packing/PackingQueuePage.tsx <Button> sayfa <= 1": "sinir",
  "src/pages/admin/packing/PackingQueuePage.tsx <Button> sayfa >= sonSayfa": "sinir",
  "src/pages/admin/packing/ReturnQueuePage.tsx <Button> sayfa <= 1": "sinir",
  "src/pages/admin/packing/ReturnQueuePage.tsx <Button> sayfa >= sonSayfa": "sinir",

  // ── secim: aksiyonun öznesi yok ──
  "src/components/admin/packing/PackingLabelSheet.tsx <button> basilacaklar.length === 0": "secim",
  // Varyant matrisinde "Tümüne fiyat uygula": uygulanacak DEĞER yok.
  // Aksiyonun öznesi boş; form geçerliliği değil.
  "src/components/admin/store/VariantMatrixPanel.tsx <Button> !topluFiyat.trim()": "secim",
  "src/pages/admin/delivery/DeliveryBoardPage.tsx <Button> dispatchable === 0": "secim",
  "src/pages/admin/delivery/DeliveryOrdersPage.tsx <Button> addStops.isPending || target == null":
    "secim",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx <Button> run.stops.length === 0": "secim",
  "src/pages/admin/delivery/DeliveryTodayPage.tsx <Button> dispatchable === 0": "secim",
  // Yeni panel Bugün: araç sorgusu bitmeden/hatalıyken Yeni Tur, uygun sipariş sorgusu bitmeden/hatalıyken
  // ya da konumlu sipariş yokken optimize kapalı; sebep (yükleniyor / yüklenemedi / sipariş yok) ekranda yazılıdır.
  "src/panel/pages/dagitim/DagitimBugun.tsx <Button> !aracHazir": "onkosul",
  "src/panel/pages/dagitim/DagitimBugun.tsx <Button> !uygunHazir || dagitilabilir === 0": "onkosul",
  // Yeni panel Siparişler: bugün açık tur yokken "Tura ekle" kapalı; sebep ipucunda ve şeritte ("Bugün açık tur yok") yazılıdır.
  "src/panel/pages/dagitim/DagitimSiparisleri.tsx <Button> hedef == null": "onkosul",
  // Yeni panel Tur Detayı: tur düzeyi yazma koordinasyonu — başka özel yazım ya da ekleme kuyruğu sürerken
  // (`baskaIslem`) kontroller kapalı ve neden `title`da ("Turda başka bir işlem sürüyor." / "Tura sipariş
  // ekleniyor"). Ayrıca: durak yokken başlat, bekleyen durak varken tamamla (sayı ipucunda), ilk/son bekleyen
  // durakta yukarı/aşağı (sınır), özel yazım sürerken ekleme.
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx <Button> run.stops.length === 0 || baskaIslem": "onkosul",
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx <Button> bekleyenSayisi > 0 || baskaIslem": "onkosul",
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx <Button> baskaIslem": "islem",
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx <Button> ilkMi || baskaIslem": "sinir",
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx <Button> sonMu || baskaIslem": "sinir",
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx <Button> baskaIslem && !ucusta": "islem",
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx <Button> ozelYazim !== null": "islem",
  // Dağıtım ortak `VarlikDugmesi` (Kuryeler, Araçlar): aynı varlıkta BAŞKA bir işlem sürerken kapalı; neden `title`da okunur.
  "src/panel/components/varlikKilidi.tsx <Button> baska || Boolean(disabled)": "onkosul",
  // Tahta: ekleme/optimize önkoşulları (optimize sürüyor, tur yok, ekleme kuyruğu, konumlu sipariş yok) `title`da okunur.
  "src/panel/pages/dagitim/DagitimTahtasi.tsx <Button> engel !== null && !ekleniyorMu(o.order_id)": "onkosul",
  "src/panel/pages/dagitim/DagitimTahtasi.tsx <Button> optimizeNedeni !== null": "onkosul",
  "src/pages/admin/packing/PackagesPage.tsx <Button> seciliGorunen.length === 0": "secim",
  "src/panel/pages/paketleme/PaketListesi.tsx <Button> seciliGorunen.length === 0": "secim",
  // Paket detayı "Paketi tamamla": engel listesi ekranda yazılıdır (eksik adet / kalemsiz paket).
  "src/panel/pages/paketleme/PaketlemeDetayi.tsx <Button> engeller.length > 0": "onkosul",
  // Hak edişler "Ödedim": öğretmene ödeme ancak açık para çekme talebi varken
  // kaydedilir (23 Eyl 2026; sunucu 409 ile de korur). Sebep `title`da, talep
  // varsa satırda "Çekim talebi" etiketi görünür.
  "src/pages/admin/AdminPayoutsPage.tsx <Button> !odemeYapilabilir(b)": "onkosul",
  "src/panel/pages/finans/HakEdisler.tsx <Button> !odemeYapilabilir(kayit)": "onkosul",
  "src/components/LibraryMapPanel.tsx <button> !week": "secim",
  // 24 Eyl 2026 · mesaj önizleme panelinin gönder düğmesi (`uiBaseline`
  // tabanına `DashboardHeader` import grafiğiyle girdi): boş mesajda
  // gönderilecek ÖZNE yok — `VariantMatrixPanel` "Tümüne fiyat uygula"
  // (`!topluFiyat.trim()`) emsaliyle aynı sınıf; `isPending` kısmı `islem`.
  // Düğme 24 Eyl 2026'da panelin konuşma görünümüyle `SohbetGorunumu`ne taşındı
  // (canlı dersin yan panel sohbetiyle ortak); sınıf değişmedi.
  "src/components/mesaj/SohbetGorunumu.tsx <button> send.isPending || !metin.trim()": "secim",
  // 24 Eyl 2026 · öğretmen cüzdanı "Para çek": sunucunun verdiği engel
  // gerekçesi (`withdraw_block_reason`) düğmenin hemen altında yazılı,
  // açık talep varsa talebin durumu görünür; `isPending` kısmı `islem`.
  "src/components/CuzdanPaneli.tsx <button> engel !== null || paraCek.isPending": "onkosul",
  "src/components/CuzdanPaneli.tsx <button> indir.isPending": "islem",

  // ── onkosul: sebebi EKRANDA yazan durum kilidi ──
  //   • `engeller.length > 0` — engeller listeleniyor (CountSessionDetail:498-505,
  //     PackingStation'ın karşılığı).
  //   • `results_published` / `pendingCount > 0` / durum kontrolü — FSM durumu.
  //   • `locked_reason` — kilidin gerekçesi rozetle gösteriliyor.
  // CMS Faz 1: araç çubuğu düğmesi geri al/yinele YAPILAMAZKEN kapalıdır
  // (editör durumu önkoşulu); gönderim geçerliliğiyle ilgisi yok.
  "src/components/admin/content/BlogBodyEditor.tsx <button> disabled": "onkosul",
  // Varyant matrisinde "Önizle": eksene hiç değer girilmemiş ya da
  // kombinasyon sayısı tavanı aşmış. HER İKİ SEBEP DE düğmenin hemen
  // yanındaki canlı sayaçta yazılı ("her eksene en az bir değer girin" /
  // "N kombinasyon, X sınırını aşıyor. Bir ekseni ayrı bir ürüne bölün.").
  // Kullanıcı sebebi ekranda okuyor — kilitli kararın istediği bu.
  // Üretim düğmesi ("N varyant oluştur") geçerlilikle KAPANMAZ: basılır,
  // sebep şeritte yazar, odak ilk eksik barkod alanına gider.
  "src/components/admin/store/VariantMatrixPanel.tsx <Button> beklenenSayi === 0 || tavanAsildi": "onkosul",
  "src/components/ExamSessionsManager.tsx <Button> session.results_published": "onkosul",
  "src/pages/DeliveryDriver.tsx <button> s.status !== \"PENDING\" || run.status !== \"ACTIVE\"":
    "onkosul",
  "src/pages/admin/AdminSettingsPage.tsx <Button> !!flag.locked_reason && !flag.enabled": "onkosul",
  // Üretimde kilitli kapalı bayrak açılamaz; sebep satırdaki rozet ve kilit metninde yazar.
  "src/panel/pages/ayarlar/GenelAyarlar.tsx <Button> !!bayrak.locked_reason && !bayrak.enabled": "onkosul",
  // Devre kesici açıkken elle senkron düğmeleri kapalı: sunucu cooldown
  // yüzünden zaten reddeder. Sebep EKRANDA — hem `title`da hem düğmelerin
  // altındaki amber şeritte ("Devre kesici açık — N dk beklemede").
  "src/components/admin/store/SupplierPanel.tsx <Button> bekleyenDakika !== null": "onkosul",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx <Button> pendingCount > 0": "onkosul",
  "src/pages/admin/inventory/CountSessionDetailPage.tsx <Button> engeller.length > 0": "onkosul",
  // Yeni panel sayım detayı: aynı önkoşul — engeller hemen altındaki uyarıda listelenir.
  "src/panel/pages/urunler/StokSayimiDetayi.tsx <Button> engeller.length > 0": "onkosul",
  // Devre kesici açıkken senkron kapalı; sebep durum şeridindeki uyarıda yazar.
  "src/panel/pages/urunler/TedarikciListesi.tsx <Button> bekleyenDakika !== null": "onkosul",
  "src/pages/admin/packing/PackingStationPage.tsx <Button> engeller.length > 0": "onkosul",
  "src/pages/DeliveryDriver.tsx <button> busy || deliverDrop.isPending || !stop.photo_url":
    "onkosul",

  // ── gecerlilik-borc: KİLİTLİ KARARIN İHLALİ (İP-A8'de kayda geçti) ──
  //
  // Sekizi de göç eden 21 ekranın DIŞINDA. Bu paket B-10'u (DeliveryOrdersPage
  // "Kargola") kapattı; bunlar kapsam dışı ve ayrı bir pakete bırakıldı.
  // Kayıtta durmalarının işlevi: dokuzuncusu doğduğu gün CI kırılır.
  // (8 → 9 → 8, 24 Eyl 2026: `SablonPaneli` "Kaydet" aynı gün dokuzuncu üye
  // olarak kayda geçti ve aynı gün KAPANDI — düğme artık geçerlilikle
  // kapanmıyor, boş başlık/metin alanın altında yazılıyor; kaydı yukarıda
  // `islem` sınıfında, yalnız `olustur.isPending` ile.)
  //
  // (İ9 · Boşluk 1'de eklenen `UrunFormu.tsx` "Grubu Oluştur" ve
  // `VaryantPenceresi.tsx` "Önizle" kayıtları commit `2287611`de KAPANDI —
  // panel paket 1 kapanışında buradan kaldırıldı, bkz. dosya başı notu.)
  "src/components/ExamSessionsManager.tsx <Button> !dirty": "gecerlilik-borc",
  "src/components/QrScanner.tsx <button> !manual.trim()": "gecerlilik-borc",
  "src/components/admin/store/ProductForm.tsx <Button> !newTitle.trim() || !newAxis1 || createGroup.isPending":
    "gecerlilik-borc",
  "src/components/admin/store/ProductForm.tsx <Button> derive.isPending || !value1.trim() || !newBarcode.trim() || (!!group.option2_name && !value2.trim())":
    "gecerlilik-borc",
  "src/pages/DeliveryDriver.tsx <button> !kod.trim() || scanLabel.isPending": "gecerlilik-borc",
  "src/pages/DeliveryDriver.tsx <button> busy || note.trim().length < 3": "gecerlilik-borc",
  "src/pages/DeliveryRunHandover.tsx <button> !kod.trim() || scan.isPending": "gecerlilik-borc",
  "src/pages/admin/packing/PackingStationPage.tsx <Button> !kod.trim()": "gecerlilik-borc",
};

/**
 * ── Aynı kimlikten BİRDEN ÇOK çağrı yeri taşıyan kayıtlar (doğrulama turu · D-1) ──
 *
 * Yazılmayan her kimliğin beklenen adedi **1**'dir. Buradaki sekiz kayıt bugün
 * ölçülen tekrarlardır ve **hepsi `islem` sınıfındadır** (`isPending`/`busy`)
 * — yani bugün tekrar eden tek bir geçerlilik borcu yok. Bir kimlik burada
 * yazılı olmadan ikinci kez doğarsa da, buradaki bir sayı değişirse de
 * (tekrar arttı ya da kapandı) nöbetçi kırmızıdır.
 *
 * `1` yazmak YASAK: varsayılan zaten 1'dir ve "1" yazan bir kayıt, tekrarların
 * listesini gereksiz yere şişirip okunmaz hâle getirirdi. Aşağıdaki test bunu
 * ayrıca sınıyor.
 */
const ADETLER: Record<string, number> = {
  // Diploma inceleme penceresinde aynı kilit ifadesi iki düğmede: red modundaki "Geri" ve inceleme "Kapat".
  "src/panel/pages/egitmenler/DiplomaDogrulamaPenceresi.tsx <Button> mesgul()": 2,
  // Video onay penceresi: aynı desen — red modundaki "Geri" ve inceleme "Kapat".
  "src/panel/pages/egitmenler/VideoOnayPenceresi.tsx <Button> mesgul()": 2,
  // Tur Detayı: optimize + iptal aynı kilit ifadesi; Ekle + Tümünü ekle aynı ifade.
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx <Button> baskaIslem": 2,
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx <Button> ozelYazim !== null": 2,
  "src/components/ImageCropModal.tsx <button> isUploading": 3,
  "src/components/LibraryBookmarkButton.tsx <button> toggle.isPending": 2,
  "src/components/LibraryMediaManager.tsx <button> busy": 2,
  "src/components/admin/store/SupplierPanel.tsx <Button> bekleyenDakika !== null": 2,
  "src/panel/pages/urunler/TedarikciListesi.tsx <Button> bekleyenDakika !== null": 2,
  "src/components/admin/ui/ConfirmDialog.tsx <Button> isPending": 2,
  "src/pages/DeliveryDriver.tsx <button> busy": 2,
  "src/pages/admin/AdminBookingsPage.tsx <Button> pending": 3,
  // 2 → 4 (17 Eyl 2026): ihtilaf kararı düğmeleri "Öğrenciye iade et" ve
  // "Eğitmene öde" eklendi; işlem sürerken kilitlenen aynı "islem" deseni.
  "src/panel/pages/rezervasyonlar/RezervasyonListesi.tsx <Button> mesgul": 4,
  "src/panel/pages/moderasyon/AdDegisiklikleri.tsx <Button> mesgul": 2,
  "src/pages/admin/AdminDemandsPage.tsx <Button> cancel.isPending": 2,
  "src/pages/dashboards/AdminHome.tsx <Button> busy": 7,
};

/** Kilitli kararın bugünkü açık borcu — sayı DEĞİL, kimlik. */
const GECERLILIK_BORCU = Object.entries(KAYIT)
  .filter(([, sinif]) => sinif === "gecerlilik-borc")
  .map(([k]) => k)
  .sort();

describe("İP-A8 · gönder düğmesi nöbetçisi (kilitli karar)", () => {
  const taban = tabanTaramasi();

  it("her `disabled` çağrı yeri SINIFIYLA kayıtlıdır (üçüncü ihtimal yok)", () => {
    // İki yön de kırar: kayıtsız yeni bir çağrı yeri de, kaydı kalmış ölü bir
    // giriş de. İkincisi önemlidir — kapanan bir borcun kaydı silinmezse
    // "kapandı" ile "hiç yoktu" ayırt edilemez (A6c · Görev 7'nin dersi).
    expect(taban.filter((s) => !(s in KAYIT)), "sınıflandırılmamış disabled").toEqual([]);
    expect(Object.keys(KAYIT).filter((s) => !taban.includes(s)), "ölü kayıt").toEqual([]);
  });

  it("kilitli kararın açık borcu KİMLİKLE sabittir", () => {
    // Bu bir TAVAN değil, dondurulmuş bir kimliktir: yeni bir "geçerlilikle
    // kapanan gönder düğmesi" bu satırı kıramadan doğamaz.
    expect(taban.filter((s) => KAYIT[s] === "gecerlilik-borc")).toEqual(GECERLILIK_BORCU);
  });

  it("her kimliğin ÇAĞRI SAYISI da dondurulmuştur (tekrar eden ihlal sessizce doğamaz)", () => {
    // D-1'in ters provası kalıcı hâle geldi: `taban` tekilleştirilmiş bir liste
    // olduğu sürece, aynı dosyaya AYNI ifadeyle eklenen ikinci bir geçerlilik
    // kapısı hiçbir iddiayı kırmıyordu. Kimlik artık sayıyı da kapsıyor.
    //
    // İki yön de kırar: adet artarsa (yeni tekrar) da, azalırsa (tekrar
    // kapandı ama kayıt bayat kaldı) da kırmızıdır.
    const beklenen = Object.fromEntries(
      Object.keys(KAYIT)
        .sort()
        .map((kimlik) => [kimlik, ADETLER[kimlik] ?? 1])
    );
    expect(tabanSayimi()).toEqual(beklenen);
  });

  it("ADETLER kaydının kendisi sağlıklıdır (ölü giriş yok, gereksiz `1` yok)", () => {
    // Kaydın kendisi de bir kaçış kapısı olmasın: `KAYIT`ta olmayan bir kimlik
    // için adet yazmak, ya da varsayılanla aynı olan `1`i yazmak, listeyi
    // okunmaz yapıp tekrarları gizlerdi.
    expect(Object.keys(ADETLER).filter((k) => !(k in KAYIT)), "ölü adet kaydı").toEqual([]);
    expect(
      Object.entries(ADETLER).filter(([, adet]) => adet < 2),
      "varsayılanla aynı olan adet kaydı (1 YAZILMAZ)"
    ).toEqual([]);
  });

  it("bugün tekrar eden hiçbir kimlik GEÇERLİLİK BORCU değildir", () => {
    // Bu iddia bir kaydı değil bir OLGUYU dondurur: tekrarların hepsi bugün
    // `islem` sınıfında. Bir geçerlilik borcu tekrar etmeye başlarsa —yani
    // kilitli kararın ihlali çoğalırsa— burası kırmızı düşer ve bunun ayrı
    // okunması gerekir.
    expect(Object.keys(ADETLER).filter((k) => KAYIT[k] === "gecerlilik-borc")).toEqual([]);
  });

  it("B-10 KAPANDI: `DeliveryOrdersPage` artık geçerlilikle kapanan düğme taşımıyor", () => {
    // Denetimin bulduğu tam satır: `disabled={!(trackingByOrder[...] ?? "").trim()}`.
    const kargola = taban.filter((s) => s.includes("DeliveryOrdersPage"));
    expect(kargola.every((s) => KAYIT[s] !== "gecerlilik-borc")).toBe(true);
    expect(kargola.some((s) => s.includes("trim()"))).toBe(false);
  });
});

/* ── Taramanın kendi ters provaları ── */

describe("İP-A8 · gönder düğmesi taramasının ters provası", () => {
  it("`disabled` taşıyan düğme YAKALANIR (Button ve button)", () => {
    const kaynak = `
      export function E() {
        return (<div>
          <Button disabled={!ad.trim()}>Gönder</Button>
          <button disabled={busy}>Kaydet</button>
        </div>);
      }
    `;
    expect(disabledDugmeleri(kaynak, "a.tsx")).toEqual([
      { etiket: "Button", ifade: "!ad.trim()" },
      { etiket: "button", ifade: "busy" },
    ]);
  });

  it("YORUMDA ve DİZEDE geçen `disabled` sayılmaz (AST, metin değil)", () => {
    const kaynak = `
      // <Button disabled={!ad.trim()}>Gönder</Button> — bu bir yorumdur
      const ornek = "<button disabled={x}>y</button>";
      export function E() { return <p>{ornek}</p>; }
    `;
    expect(disabledDugmeleri(kaynak, "a.tsx")).toEqual([]);
  });

  it("`disabled` OLMAYAN düğme sayılmaz", () => {
    const kaynak = `export function E() { return <Button isPending={p}>Gönder</Button>; }`;
    expect(disabledDugmeleri(kaynak, "a.tsx")).toEqual([]);
  });

  it("düğme DIŞINDAKİ `disabled` (input/select) sayılmaz", () => {
    const kaynak = `export function E() { return <input disabled={kilitli} />; }`;
    expect(disabledDugmeleri(kaynak, "a.tsx")).toEqual([]);
  });

  it("ifade NORMALİZE edilir (satır kırılması kimliği değiştirmez)", () => {
    const kaynak = `
      export function E() {
        return (<Button
          disabled={
            !ad.trim() ||
            gonder.isPending
          }
        >Gönder</Button>);
      }
    `;
    expect(disabledDugmeleri(kaynak, "a.tsx")[0].ifade).toBe("!ad.trim() || gonder.isPending");
  });
});
