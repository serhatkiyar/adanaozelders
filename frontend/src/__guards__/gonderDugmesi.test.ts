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
 * ## Kimlik neden satır numarası taşımıyor
 *
 * `dosya + normalize edilmiş ifade`. Satır numarası taşısaydı ilgisiz bir
 * satır eklemek onlarca kaydı kaydırırdı; gürültülü nöbetçi susturulan
 * nöbetçidir (`beklemeButcesi` envanteri on kalemle bunu kaldırabiliyor,
 * altmış iki kalemle kaldıramazdı).
 */
import { describe, expect, it } from "vitest";

import { disabledDugmeleri, tabanTaramasi } from "../../scripts/gonder-dugmesi.mjs";

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
  "src/components/admin/ui2/duzenlemeYuzeyi.tsx <Button> islemSuruyor": "islem",
  "src/pages/DeliveryDriver.tsx <button> busy": "islem",
  "src/pages/DeliveryDriver.tsx <button> runAction.isPending": "islem",
  "src/pages/DeliveryDriver.tsx <button> sendOtp.isPending": "islem",
  "src/pages/DeliveryDriver.tsx <button> uploadPhoto.isPending": "islem",
  "src/pages/admin/AdminBookingsPage.tsx <Button> pending": "islem",
  "src/pages/admin/AdminDemandsPage.tsx <Button> cancel.isPending": "islem",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx <Button> addStops.isPending": "islem",
  "src/pages/admin/inventory/CountSessionDetailPage.tsx <Button> isPending": "islem",
  "src/pages/dashboards/AdminHome.tsx <Button> busy": "islem",
  "src/pages/dashboards/AdminHome.tsx <Button> verify.isPending": "islem",
  "src/pages/dashboards/AdminLibraries.tsx <Button> approve.isPending": "islem",
  "src/pages/dashboards/AdminLibraries.tsx <Button> reject.isPending": "islem",
  "src/pages/dashboards/CourierHome.tsx <button> isRefetching": "islem",
  "src/pages/dashboards/OperatorLibrary.tsx <Button> busy": "islem",
  // Ortak `Button`ın kendi prop geçişi — sınıflandırılacak bir karar değil.
  "src/components/admin/ui/Button.tsx <button> disabled || isPending": "islem",
  "src/components/LibraryMediaManager.tsx <button> disabled": "islem",

  // ── sinir: sayfalama ──
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
  "src/pages/admin/delivery/DeliveryBoardPage.tsx <Button> dispatchable === 0": "secim",
  "src/pages/admin/delivery/DeliveryOrdersPage.tsx <Button> addStops.isPending || target == null":
    "secim",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx <Button> run.stops.length === 0": "secim",
  "src/pages/admin/delivery/DeliveryTodayPage.tsx <Button> dispatchable === 0": "secim",
  "src/pages/admin/packing/PackagesPage.tsx <Button> seciliGorunen.length === 0": "secim",
  "src/components/LibraryMapPanel.tsx <button> !week": "secim",

  // ── onkosul: sebebi EKRANDA yazan durum kilidi ──
  //   • `engeller.length > 0` — engeller listeleniyor (CountSessionDetail:498-505,
  //     PackingStation'ın karşılığı).
  //   • `results_published` / `pendingCount > 0` / durum kontrolü — FSM durumu.
  //   • `locked_reason` — kilidin gerekçesi rozetle gösteriliyor.
  "src/components/ExamSessionsManager.tsx <Button> session.results_published": "onkosul",
  "src/pages/DeliveryDriver.tsx <button> s.status !== \"PENDING\" || run.status !== \"ACTIVE\"":
    "onkosul",
  "src/pages/admin/AdminSettingsPage.tsx <Button> !!flag.locked_reason && !flag.enabled": "onkosul",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx <Button> pendingCount > 0": "onkosul",
  "src/pages/admin/inventory/CountSessionDetailPage.tsx <Button> engeller.length > 0": "onkosul",
  "src/pages/admin/packing/PackingStationPage.tsx <Button> engeller.length > 0": "onkosul",
  "src/pages/DeliveryDriver.tsx <button> busy || deliverDrop.isPending || !stop.photo_url":
    "onkosul",

  // ── gecerlilik-borc: KİLİTLİ KARARIN İHLALİ (İP-A8'de kayda geçti) ──
  //
  // Yedisi de göç eden 21 ekranın DIŞINDA. Bu paket B-10'u (DeliveryOrdersPage
  // "Kargola") kapattı; bunlar kapsam dışı ve ayrı bir pakete bırakıldı.
  // Kayıtta durmalarının işlevi: sekizincisi doğduğu gün CI kırılır.
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
