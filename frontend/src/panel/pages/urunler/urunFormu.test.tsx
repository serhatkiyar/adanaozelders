import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { UrunFormu } from "@/panel/pages/urunler/UrunFormu";
import { PATHS } from "@/lib/routes";

const createProduct = vi.fn().mockResolvedValue({ id: 7 });
const updateProduct = vi.fn().mockResolvedValue({ id: 9 });
const fetchProductAdmin = vi.fn();
// Varyant grubu sözlüğü boş dizi ile YOKMUŞ gibi başlar; her test kendi
// `mockResolvedValueOnce`'unu koyar (bkz. `vi.clearAllMocks` — implementasyon
// KORUNUR, yalnız çağrı geçmişi silinir; bu yüzden varsayılan burada sabit).
const fetchVariantConfig = vi.fn().mockResolvedValue({ axes: ["Renk", "Beden"], book_root_slugs: [] });
const listVariantGroups = vi.fn().mockResolvedValue([]);
const createVariantGroup = vi.fn();
// Task 8b: toplu kardeş matrisi. Bu dosyanın testleri KAPIYI sınar (açılır
// mı); matrisin kendi davranışı (`previewVariantMatrix`/`createVariantMatrix`
// gövdesi, barkod doğrulaması) `varyant.test.tsx`te.
const previewVariantMatrix = vi.fn();
const createVariantMatrix = vi.fn();
// Madde 1 (kritik): Kategori seçici `useCategories()` → `fetchCategories`
// tüketir. Varsayılan tek leaf kategori — "kategori yok" durumunu ayrıca
// sınayan testler kendi `mockResolvedValueOnce([])`unu koyar.
const fetchCategories = vi.fn().mockResolvedValue([
  { id: 1, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 0, is_active: true },
]);
// Medya sekmesi (`MedyaSekmesi`) → `hooks/useStore.ts::useProductMedia` bu
// dördünü DOĞRUDAN çağırır (`storeApi.uploadProductCover` vb.) — mock
// olmadan `useProductMedia`nın gerçek gövdesi `storeApi.uploadProductCover`ı
// `undefined` bulup "is not a function" ile patlar.
const uploadProductCover = vi.fn();
const uploadProductImages = vi.fn();
const deleteProductImage = vi.fn();
const reorderProductImages = vi.fn();
vi.mock("@/api/store", () => ({
  createProduct: (...a: unknown[]) => createProduct(...a),
  updateProduct: (...a: unknown[]) => updateProduct(...a),
  fetchProductAdmin: (...a: unknown[]) => fetchProductAdmin(...a),
  fetchVariantConfig: (...a: unknown[]) => fetchVariantConfig(...a),
  listVariantGroups: (...a: unknown[]) => listVariantGroups(...a),
  createVariantGroup: (...a: unknown[]) => createVariantGroup(...a),
  previewVariantMatrix: (...a: unknown[]) => previewVariantMatrix(...a),
  createVariantMatrix: (...a: unknown[]) => createVariantMatrix(...a),
  fetchCategories: (...a: unknown[]) => fetchCategories(...a),
  uploadProductCover: (...a: unknown[]) => uploadProductCover(...a),
  uploadProductImages: (...a: unknown[]) => uploadProductImages(...a),
  deleteProductImage: (...a: unknown[]) => deleteProductImage(...a),
  reorderProductImages: (...a: unknown[]) => reorderProductImages(...a),
}));

afterEach(() => {
  // Her testte YENİ bir `render()` ile YENİ bir `UrunFormu` örneği kuruluyor
  // (kendi `Form` instance'ıyla); ama mock çağrı geçmişi paylaşılan modül
  // seviyesindeki spy'larda birikir — sıradaki testin `mock.calls[0]`
  // okuması bir önceki testin isteğini görmesin diye temizlenir. Varsayılan
  // `mockResolvedValue` implementasyonları KORUNUR (`clearAllMocks` yalnız
  // çağrı geçmişini siler, implementasyonu değil).
  vi.clearAllMocks();
});

const DUZENLENECEK_URUN = {
  id: 9,
  title: "Kırmızı Defter",
  kind: "PHYSICAL",
  price: "45.50",
  compare_at_price: null,
  tax_rate: "0.20",
  stock: 12,
  barcode: "8690000000012",
  variants: null,
  cover_url: null,
  images: [],
};

const DUZENLENECEK_URUN_VARYANTLI = {
  ...DUZENLENECEK_URUN,
  variant_group_id: 1,
  option1_value: "Kırmızı",
  option2_value: null,
  variants: {
    group_id: 1,
    title: "Defter Rengi",
    option1_name: "Renk",
    option2_name: null,
    members: [],
  },
};

// `MemoryRouter` doğrudan `UrunFormu`yu sarıyor (aradaki `<Routes>` YOK) —
// bu yüzden `useParams()` hep boş döner (id yok, hep YENİ kayıt akışı);
// `useSearchParams` ise Route eşleşmesine ihtiyaç duymaz, `?tip` bu yolla
// okunur.
function kur(baslangicYolu = "/yonetim-yeni/urunler/yeni") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[baslangicYolu]}>
          <UrunFormu />
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

// Düzenleme akışı `useParams()`e ihtiyaç duyar; bunun için gerçek bir
// `<Route path=":id">` eşleşmesi kurulur.
function kurDuzenleme(id: number | string = 9) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[`/yonetim-yeni/urunler/${id}`]}>
          <Routes>
            <Route path={PATHS.adminNewProductEdit} element={<UrunFormu />} />
            {/* Kayıt sonrası `navigate(ROUTES.adminNewProducts)` gerçekleşir —
                eşleşen bir rota olmadan RR konsola uyarı basar. */}
            <Route path={PATHS.adminNewProducts} element={<div>Ürünler</div>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

/**
 * AntD Form alanına TEK olayla değer yazar.
 *
 * `userEvent.type` karakter karakter yazar; her tuş bir React render + AntD
 * Form doğrulaması tetikler. Bu dosyanın ağır testleri (13 haneli barkod, üç
 * zorunlu alan, ardından Select tıklamaları) bu yüzden ölçülmüş 9000 ms
 * bütçesini YÜK ALTINDA aşıyordu: tek başına koşulunca geçiyor, tam suite'te
 * düşüyordu. `vitest.config.ts`'teki politika açık — "Bir test bu bütçeye
 * sığmıyorsa çözüm bütçeyi büyütmek değil, testi incelemektir." Depodaki
 * emsal: `components/admin/inventory/DamageDialog.test.tsx`.
 *
 * Tuş tuş yazmak sınanan bir davranış DEĞİL; sınanan şey alanın değerinin
 * gövdeye doğru gitmesi. Tuş davranışının kendisi önemli olan yerlerde
 * (klavyeyle seçim, canlı zorunluluk tepkisi) `userEvent` KORUNDU.
 */
function yaz(alan: HTMLElement, deger: string) {
  fireEvent.change(alan, { target: { value: deger } });
}

describe("UrunFormu", () => {
  it("zorunlu alanlar boşken kaydetmez", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(createProduct).not.toHaveBeenCalled();
  });

  // Not: brief yalnız "ad ve fiyat" varsayıyordu; gerçek sözleşmede
  // (`ProductCreate.tax_rate`) KDV oranının sunucuda varsayılanı YOK ve
  // formda da sessizce doldurulmuyor (eski panelle aynı kural) — bu yüzden
  // üçüncü alan da girilmeden istek atılmıyor.
  //
  // `tax_rate` bir STRING olarak gider ("0.2000") — `lib/tax.ts::yuzdedenOran`
  // sabit 4 ondalıklı bir dize üretir (Madde 3); eski kod `d.tax_rate_yuzde /
  // 100` ile kayan nokta SAYISI üretiyordu.
  it("ad, fiyat ve KDV oranı girilince createProduct çağrılır", async () => {
    kur();
    yaz(screen.getByLabelText("Ürün Adı"), "Deneme Kalem Seti");
    yaz(screen.getByLabelText("Satış Fiyatı"), "120");
    yaz(screen.getByLabelText("KDV Oranı (%)"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Deneme Kalem Seti", price: 120, tax_rate: "0.2000" }),
    );
  });

  // Madde 1 (kritik): Durum + Kategori formda yoksa panelde yaratılan ürün
  // hiçbir zaman yayına alınamıyordu (`status` varsayılanı sunucuda DRAFT).
  describe("durum ve kategori", () => {
    it("Durum ve Kategori alanları formda görünür", () => {
      kur();
      expect(screen.getByLabelText("Durum")).toBeInTheDocument();
      expect(screen.getByLabelText("Kategori")).toBeInTheDocument();
    });

    it("durum seçilmezse gövde varsayılan olarak DRAFT taşır", async () => {
      kur();
      yaz(screen.getByLabelText("Ürün Adı"), "Taslak Ürün");
      yaz(screen.getByLabelText("Satış Fiyatı"), "80");
      yaz(screen.getByLabelText("KDV Oranı (%)"), "18");
      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
      await waitFor(() => expect(createProduct).toHaveBeenCalled());
      expect(createProduct.mock.calls[0][0]).toMatchObject({ status: "DRAFT" });
    });

    it("durum ACTIVE seçilip kategori seçilmezse kaydedilemez (backend kuralının istemci aynası)", async () => {
      kur();
      yaz(screen.getByLabelText("Ürün Adı"), "Yeni Ürün");
      yaz(screen.getByLabelText("Satış Fiyatı"), "100");
      yaz(screen.getByLabelText("KDV Oranı (%)"), "20");

      await userEvent.click(screen.getByLabelText("Durum"));
      await userEvent.click(await screen.findByTitle("Yayında"));

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      expect(await screen.findByText("Aktif ürün için kategori zorunludur.")).toBeInTheDocument();
      expect(createProduct).not.toHaveBeenCalled();
    });

    it("durum ACTIVE ve kategori seçilince gövde status ve category_id taşır", async () => {
      kur();
      yaz(screen.getByLabelText("Ürün Adı"), "Yeni Ürün");
      yaz(screen.getByLabelText("Satış Fiyatı"), "100");
      yaz(screen.getByLabelText("KDV Oranı (%)"), "20");

      await userEvent.click(screen.getByLabelText("Durum"));
      await userEvent.click(await screen.findByTitle("Yayında"));
      await userEvent.click(screen.getByLabelText("Kategori"));
      await userEvent.click(await screen.findByTitle("Kırtasiye"));

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      await waitFor(() => expect(createProduct).toHaveBeenCalled());
      expect(createProduct.mock.calls[0][0]).toMatchObject({ status: "ACTIVE", category_id: 1 });
    });

    it("düzenlemede dokunulmayan durum ve kategori mevcut değeriyle gövdeye gider", async () => {
      fetchProductAdmin.mockResolvedValueOnce({ ...DUZENLENECEK_URUN, status: "HIDDEN", category_id: 1 });
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ status: "HIDDEN", category_id: 1 });
    });
  });

  // Madde 2 (önemli): boş bırakılan "Eski Fiyat" sessizce DB'de kalıyordu
  // (`undefined` → JSON'dan düşer → backend `exclude_unset` eski değeri korur).
  describe("eski fiyat (compare_at_price)", () => {
    it("dolu eski fiyat silinip kaydedilince gövde compare_at_price: null taşır", async () => {
      fetchProductAdmin.mockResolvedValueOnce({ ...DUZENLENECEK_URUN, compare_at_price: "60.00" });
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");

      const eskiFiyatAlani = screen.getByLabelText("Eski Fiyat");
      expect(eskiFiyatAlani).toHaveValue("60");
      await userEvent.clear(eskiFiyatAlani);

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ compare_at_price: null });
    });

    it("eski fiyat satış fiyatından küçük ya da eşitse kaydedilemez", async () => {
      kur();
      yaz(screen.getByLabelText("Ürün Adı"), "Test Ürün");
      yaz(screen.getByLabelText("Satış Fiyatı"), "100");
      yaz(screen.getByLabelText("Eski Fiyat"), "80");
      yaz(screen.getByLabelText("KDV Oranı (%)"), "20");

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      expect(
        await screen.findByText("Eski fiyat satış fiyatından büyük olmalı."),
      ).toBeInTheDocument();
      expect(createProduct).not.toHaveBeenCalled();
    });
  });

  // Madde 3 (önemli): `lib/tax.ts` atlanmış — yüklerken kayan nokta artığı.
  describe("KDV oranı dönüşümü (lib/tax.ts)", () => {
    it("%7'lik oran forma artıksız (\"7\") yüklenir", async () => {
      fetchProductAdmin.mockResolvedValueOnce({ ...DUZENLENECEK_URUN, tax_rate: "0.0700" });
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");
      expect(screen.getByLabelText("KDV Oranı (%)")).toHaveValue("7");
    });
  });

  // Madde 4 (önemli): `lib/errors.ts::getErrorDetail` atlanmış — sunucunun
  // anlamlı mesajı jenerik "Ürün kaydedilemedi." ile eziliyordu.
  it("sunucunun anlamlı hata mesajı jenerik metin yerine gösterilir", async () => {
    fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN);
    updateProduct.mockRejectedValueOnce({
      response: { data: { detail: "İndirimli fiyat eski fiyattan küçük olmalı" } },
    });
    kurDuzenleme();
    await screen.findByDisplayValue("Kırmızı Defter");

    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(
      await screen.findByText("İndirimli fiyat eski fiyattan küçük olmalı"),
    ).toBeInTheDocument();
  });

  it("?tip=varyantli ile açılınca varyant sekmesi görünür", () => {
    kur("/yonetim-yeni/urunler/yeni?tip=varyantli");
    expect(screen.getByRole("tab", { name: "Varyantlar" })).toBeInTheDocument();
  });

  it("?tip=basit ile varyant sekmesi görünmez", () => {
    kur("/yonetim-yeni/urunler/yeni?tip=basit");
    expect(screen.queryByRole("tab", { name: "Varyantlar" })).not.toBeInTheDocument();
  });

  it("tip parametresi yokken (elle açılmış URL) varyant sekmesi görünmez", () => {
    kur("/yonetim-yeni/urunler/yeni");
    expect(screen.queryByRole("tab", { name: "Varyantlar" })).not.toBeInTheDocument();
  });

  describe("düzenleme modu", () => {
    it("mevcut ürün verisi forma dolar", async () => {
      fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN);
      kurDuzenleme();

      expect(await screen.findByDisplayValue("Kırmızı Defter")).toBeInTheDocument();
      expect(screen.getByLabelText("Satış Fiyatı")).toHaveValue("45.5");
      expect(screen.getByLabelText("KDV Oranı (%)")).toHaveValue("20");

      await userEvent.click(screen.getByRole("tab", { name: "Envanter" }));
      expect(screen.getByLabelText("Stok")).toHaveValue("12");
      expect(screen.getByLabelText("Barkod")).toHaveValue("8690000000012");
    });

    it("kayıt çekilemediğinde hata alanı gösterir, Kaydet yok ve updateProduct çağrılmaz", async () => {
      fetchProductAdmin.mockRejectedValueOnce(new Error("ağ hatası"));
      kurDuzenleme();

      expect(await screen.findByText("Ürün yüklenemedi.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tekrar dene" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Kaydet" })).not.toBeInTheDocument();
      expect(updateProduct).not.toHaveBeenCalled();
    });

    it("stok değiştirilip gerekçe seçilince updateProduct'a giden gövde stock ve stock_reason_code içerir", async () => {
      fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN);
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");

      await userEvent.click(screen.getByRole("tab", { name: "Envanter" }));
      const stokAlani = screen.getByLabelText("Stok");
      await userEvent.clear(stokAlani);
      yaz(stokAlani, "20");

      await userEvent.click(screen.getByLabelText("Stok Gerekçesi"));
      await userEvent.click(await screen.findByTitle("Sayım farkı"));

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ stock: 20, stock_reason_code: "SAYIM_FARKI" }),
      );
    });

    it("stok değişmediyse gövdede stock alanı hiç gitmez", async () => {
      fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN);
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      const govde = updateProduct.mock.calls[0][1];
      expect(govde).not.toHaveProperty("stock");
      expect(govde).not.toHaveProperty("stock_reason_code");
    });

    it("stok değiştirilip gerekçe seçilmezse form uyarır ve istek atılmaz", async () => {
      fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN);
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");

      await userEvent.click(screen.getByRole("tab", { name: "Envanter" }));
      const stokAlani = screen.getByLabelText("Stok");
      await userEvent.clear(stokAlani);
      yaz(stokAlani, "20");

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      expect(await screen.findByText("Stok değiştiyse gerekçe zorunludur.")).toBeInTheDocument();
      expect(updateProduct).not.toHaveBeenCalled();
    });

    // Bulgu 1 — sessiz veri hatası: grup Select'i `allowClear` taşıyor ama
    // gövdeye `variant_group_id` anahtarı hiç girmiyordu; backend
    // `exclude_unset=True` kullandığından eski grup + eski eksen değerleri +
    // eski barkod DB'de aynen kalıyordu (bkz. UrunFormu.tsx `varyantUyelikGovdesi`).
    describe("gruptan çıkarma", () => {
      it("gruplu ürünün grubu temizlenip kaydedilince gövde variant_group_id, option değerleri ve barkodu null taşır", async () => {
        listVariantGroups.mockResolvedValueOnce([
          { id: 1, title: "Defter Rengi", option1_name: "Renk", option2_name: null, member_count: 3 },
        ]);
        fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN_VARYANTLI);
        const { container } = kurDuzenleme();
        await screen.findByDisplayValue("Kırmızı Defter");

        await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
        await screen.findByLabelText("Varyant Grubu");

        const temizleDugmesi = container.querySelector(".ant-select-clear");
        expect(temizleDugmesi).toBeTruthy();
        await userEvent.click(temizleDugmesi as Element);

        await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

        await waitFor(() => expect(updateProduct).toHaveBeenCalled());
        const govde = updateProduct.mock.calls[0][1];
        expect(govde).toMatchObject({
          variant_group_id: null,
          option1_value: null,
          option2_value: null,
          barcode: null,
        });
      });

      it("grup temizlendikten SONRA yazılan yeni barkod gövdede korunur", async () => {
        // Bulgu: `barcode` açık satırı spread'den ÖNCE yazıldığı için,
        // `varyantUyelikGovdesi` çıkış dalındaki `barcode: null` onu eziyordu;
        // kullanıcı grubu temizleyip yeni bir barkod yazsa bile değeri
        // sessizce siliniyordu. Gövde ALANIN GERÇEK DEĞERİNİ taşımalı.
        listVariantGroups.mockResolvedValueOnce([
          { id: 1, title: "Defter Rengi", option1_name: "Renk", option2_name: null, member_count: 3 },
        ]);
        fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN_VARYANTLI);
        const { container } = kurDuzenleme();
        await screen.findByDisplayValue("Kırmızı Defter");

        await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
        await screen.findByLabelText("Varyant Grubu");

        await userEvent.click(container.querySelector(".ant-select-clear") as Element);

        // Grup gittikten sonra kullanıcı barkodu yeniden yazıyor.
        const barkodAlani = screen.getByLabelText("Barkod");
        await userEvent.clear(barkodAlani);
        yaz(barkodAlani, "99998888");

        await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

        await waitFor(() => expect(updateProduct).toHaveBeenCalled());
        expect(updateProduct.mock.calls[0][1]).toMatchObject({
          variant_group_id: null,
          barcode: "99998888",
        });
      });

      it("Varyant sekmesine hiç dokunulmadan kaydedilince bu alanlar gövdeye hiç girmez", async () => {
        fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN_VARYANTLI);
        kurDuzenleme();
        await screen.findByDisplayValue("Kırmızı Defter");

        // Varyant sekmesi hiç açılmıyor — mevcut "dokunulmadı" davranışı
        // (stok gerekçesi desenindeki gibi) korunmalı.
        await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

        await waitFor(() => expect(updateProduct).toHaveBeenCalled());
        const govde = updateProduct.mock.calls[0][1];
        expect(govde).not.toHaveProperty("variant_group_id");
        expect(govde).not.toHaveProperty("option1_value");
        expect(govde).not.toHaveProperty("option2_value");
        // `barcode` — Varyant alanlarından FARKLI olarak her zaman gövdede
        // literal bir anahtardır (bkz. `guncelleGovdesi`, koşulsuz alan);
        // dokunulmadığında değeri `undefined` kalır ve istek gövdesi
        // serileştirilirken (JSON.stringify) düşer — "gönderilmedi" ile
        // eşdeğerdir. Bu test yalnız Bulgu 1'in konusu olan üç varyant
        // alanının GERÇEKTEN spread'e bağlı (var/yok) davrandığını sınar.
        expect(govde.barcode).toBeUndefined();
      });
    });
  });

  describe("varyant grubu üyeliği", () => {
    it("grup seçilince seçili grubun eksen adlarına göre değer alanları görünür", async () => {
      listVariantGroups.mockResolvedValueOnce([
        { id: 1, title: "Kalem Rengi", option1_name: "Renk", option2_name: "Beden", member_count: 2 },
      ]);
      kur("/yonetim-yeni/urunler/yeni?tip=varyantli");

      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
      await userEvent.click(await screen.findByLabelText("Varyant Grubu"));
      await userEvent.click(await screen.findByTitle("Kalem Rengi (Renk × Beden)"));

      expect(await screen.findByLabelText("Renk")).toBeInTheDocument();
      expect(screen.getByLabelText("Beden")).toBeInTheDocument();
      expect(screen.getByLabelText("Barkod")).toBeInTheDocument();
    });

    it("gruba bağlı üründe barkod boşken kaydedilemez (istek atılmaz)", async () => {
      listVariantGroups.mockResolvedValueOnce([
        { id: 1, title: "Kalem Rengi", option1_name: "Renk", option2_name: null, member_count: 1 },
      ]);
      kur("/yonetim-yeni/urunler/yeni?tip=varyantli");
      yaz(screen.getByLabelText("Ürün Adı"), "Fosforlu Kalem");
      yaz(screen.getByLabelText("Satış Fiyatı"), "50");
      yaz(screen.getByLabelText("KDV Oranı (%)"), "20");

      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
      await userEvent.click(await screen.findByLabelText("Varyant Grubu"));
      await userEvent.click(await screen.findByTitle("Kalem Rengi (Renk)"));
      yaz(await screen.findByLabelText("Renk"), "Sarı");
      // Barkod BİLEREK boş bırakılıyor.

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      expect(
        await screen.findByText("Varyant grubundaki ürün için barkod zorunludur."),
      ).toBeInTheDocument();
      expect(createProduct).not.toHaveBeenCalled();
    });

    it("gruba bağlı olmayan (basit) üründe barkod zorunlu değildir", async () => {
      kur();
      yaz(screen.getByLabelText("Ürün Adı"), "Defter");
      yaz(screen.getByLabelText("Satış Fiyatı"), "30");
      yaz(screen.getByLabelText("KDV Oranı (%)"), "10");

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      await waitFor(() => expect(createProduct).toHaveBeenCalled());
      expect(createProduct.mock.calls[0][0]).not.toHaveProperty("variant_group_id");
    });

    it("kaydetme gövdesi variant_group_id, option1_value, option2_value ve barcode alanlarını taşır", async () => {
      listVariantGroups.mockResolvedValueOnce([
        { id: 3, title: "Kalem Rengi", option1_name: "Renk", option2_name: "Beden", member_count: 0 },
      ]);
      kur("/yonetim-yeni/urunler/yeni?tip=varyantli");
      yaz(screen.getByLabelText("Ürün Adı"), "Fosforlu Kalem Sarı L");
      yaz(screen.getByLabelText("Satış Fiyatı"), "60");
      yaz(screen.getByLabelText("KDV Oranı (%)"), "20");

      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
      await userEvent.click(await screen.findByLabelText("Varyant Grubu"));
      await userEvent.click(await screen.findByTitle("Kalem Rengi (Renk × Beden)"));
      yaz(await screen.findByLabelText("Renk"), "Sarı");
      yaz(screen.getByLabelText("Beden"), "L");
      yaz(screen.getByLabelText("Barkod"), "8690000000029");

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      await waitFor(() => expect(createProduct).toHaveBeenCalled());
      expect(createProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          variant_group_id: 3,
          option1_value: "Sarı",
          option2_value: "L",
          barcode: "8690000000029",
        }),
      );
    });

    it("yeni grup için eksen adları sözlükten seçilir, serbest metin girilemez", async () => {
      fetchVariantConfig.mockResolvedValueOnce({ axes: ["Renk", "Beden", "Boyut"], book_root_slugs: [] });
      kur("/yonetim-yeni/urunler/yeni?tip=varyantli");

      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
      await userEvent.click(await screen.findByRole("button", { name: "+ Yeni grup oluştur" }));

      expect(screen.queryByRole("textbox", { name: "1. eksen" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByLabelText("1. eksen"));
      expect(await screen.findByTitle("Renk")).toBeInTheDocument();
      expect(screen.getByTitle("Beden")).toBeInTheDocument();
      expect(screen.getByTitle("Boyut")).toBeInTheDocument();
    });

    // Bulgu 2 — tek `barcode` alanı, zorunluluğu grup seçimine CANLI
    // tepki verir: aynı oturumda grup seçilince engeller, temizlenince
    // serbest bırakır (alan kaybolmaz/yeniden mount olmaz, aynı Form.Item).
    it("barkod zorunluluğu grup seçimine canlı tepki verir: seçiliyken engeller, temizlenince serbest bırakır", async () => {
      listVariantGroups.mockResolvedValueOnce([
        { id: 1, title: "Kalem Rengi", option1_name: "Renk", option2_name: null, member_count: 1 },
      ]);
      const { container } = kur("/yonetim-yeni/urunler/yeni?tip=varyantli");
      yaz(screen.getByLabelText("Ürün Adı"), "Fosforlu Kalem");
      yaz(screen.getByLabelText("Satış Fiyatı"), "50");
      yaz(screen.getByLabelText("KDV Oranı (%)"), "20");

      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
      await userEvent.click(await screen.findByLabelText("Varyant Grubu"));
      await userEvent.click(await screen.findByTitle("Kalem Rengi (Renk)"));
      yaz(await screen.findByLabelText("Renk"), "Sarı");

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
      expect(
        await screen.findByText("Varyant grubundaki ürün için barkod zorunludur."),
      ).toBeInTheDocument();
      expect(createProduct).not.toHaveBeenCalled();

      const temizleDugmesi = container.querySelector(".ant-select-clear");
      expect(temizleDugmesi).toBeTruthy();
      await userEvent.click(temizleDugmesi as Element);

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
      await waitFor(() => expect(createProduct).toHaveBeenCalled());
      expect(createProduct.mock.calls[0][0]).toMatchObject({ variant_group_id: null, barcode: null });
    });

    // Bulgu 3 — backend `ProductUpdate.barcode`/`VariantMemberFields.barcode`
    // (`backend/schemas/store.py:291,527,578`) `min_length=4, max_length=32`
    // ister; istemci önceden yalnız boş olmadığını kontrol ediyordu, kısa
    // barkod sunucudan jenerik 422/"Ürün kaydedilemedi." ile dönüyordu.
    it("çok kısa barkod istemcide reddedilir, istek atılmaz", async () => {
      kur();
      yaz(screen.getByLabelText("Ürün Adı"), "Kısa Barkodlu Ürün");
      yaz(screen.getByLabelText("Satış Fiyatı"), "40");
      yaz(screen.getByLabelText("KDV Oranı (%)"), "10");

      await userEvent.click(screen.getByRole("tab", { name: "Envanter" }));
      yaz(screen.getByLabelText("Barkod"), "12");

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      expect(await screen.findByText("Barkod 4-32 karakter olmalıdır.")).toBeInTheDocument();
      expect(createProduct).not.toHaveBeenCalled();
    });
  });

  // İP-A8 gönder düğmesi nöbetçisi (`gecerlilik-borc`): "Grubu Oluştur"
  // düğmesi FORM GEÇERLİLİĞİYLE kapanıyordu (`disabled={!yeniBaslik.trim()
  // || !yeniEksen1}`) ve eksik alan hiçbir yerde YAZMIYORDU — kilitli
  // kararın ihlali. Düğme artık kapanmaz: tıklanınca doğrulama çalışır,
  // eksik alan alanda görünür ve odak ona gider (`VariantMatrixPanel`
  // `uret()`/`KargolaSatiri` ile aynı desen).
  describe("yeni varyant grubu oluşturma (Grubu Oluştur — gönder düğmesi geçerlilikle kapanmaz)", () => {
    it("her iki alan da boşken tıklanınca istek atılmaz, hata görünür ve odak grup adına gider", async () => {
      kur("/yonetim-yeni/urunler/yeni?tip=varyantli");
      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
      await userEvent.click(await screen.findByRole("button", { name: "+ Yeni grup oluştur" }));

      await userEvent.click(screen.getByRole("button", { name: "Grubu Oluştur" }));

      expect(await screen.findByText("Grup adı zorunludur.")).toBeInTheDocument();
      expect(createVariantGroup).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Grup adı")).toHaveFocus();
    });

    it("grup adı dolu, 1. eksen boşken tıklanınca istek atılmaz, hata görünür ve odak 1. eksene gider", async () => {
      kur("/yonetim-yeni/urunler/yeni?tip=varyantli");
      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
      await userEvent.click(await screen.findByRole("button", { name: "+ Yeni grup oluştur" }));

      yaz(screen.getByLabelText("Grup adı"), "Kalem Rengi");
      await userEvent.click(screen.getByRole("button", { name: "Grubu Oluştur" }));

      expect(await screen.findByText("1. eksen zorunludur.")).toBeInTheDocument();
      expect(createVariantGroup).not.toHaveBeenCalled();
    });

    it("her iki alan da dolduğunda createVariantGroup doğru gövdeyle çağrılır", async () => {
      createVariantGroup.mockResolvedValueOnce({
        id: 9,
        title: "Kalem Rengi",
        option1_name: "Renk",
        option2_name: null,
      });
      kur("/yonetim-yeni/urunler/yeni?tip=varyantli");
      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
      await userEvent.click(await screen.findByRole("button", { name: "+ Yeni grup oluştur" }));

      yaz(screen.getByLabelText("Grup adı"), "Kalem Rengi");
      await userEvent.click(screen.getByLabelText("1. eksen"));
      await userEvent.click(await screen.findByTitle("Renk"));

      await userEvent.click(screen.getByRole("button", { name: "Grubu Oluştur" }));

      // `useCreateVariantGroup` `mutationFn: storeApi.createVariantGroup`yi
      // DOĞRUDAN referans verir; TanStack Query mutationFn'i ikinci bir
      // bağlam argümanıyla çağırır (`{client, meta, mutationKey}`) — bu
      // yüzden yalnız ilk argüman sınanır (diğer testlerdeki sarmalayıcı
      // `mutationFn`lerin aksine).
      await waitFor(() => expect(createVariantGroup).toHaveBeenCalled());
      expect(createVariantGroup.mock.calls[0][0]).toEqual({
        title: "Kalem Rengi",
        option1_name: "Renk",
        option2_name: null,
      });
    });
  });

  // Denetim bulgusu: varyant alanları (`VaryantAlanlari`) panelin geri
  // kalanından FARKLI bir dil konuşuyordu (düz `Typography.Text`, "Tekrar
  // dene" yok) — artık paneldeki tek dili (`HataDurumu`/`YukleniyorDurumu`,
  // bkz. `panel/components/Durum.tsx`) kullanıyor.
  describe("varyant bilgileri yükleniyor/hata durumu", () => {
    it("varyant bilgileri yüklenirken panelin geri kalanıyla tutarlı bir yükleniyor göstergesi gösterir", async () => {
      let cozGetir: (v: { axes: string[]; book_root_slugs: string[] }) => void = () => {};
      fetchVariantConfig.mockImplementationOnce(
        () => new Promise((resolve) => { cozGetir = resolve; }),
      );
      kur("/yonetim-yeni/urunler/yeni?tip=varyantli");

      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));

      expect(screen.getByText("Varyant bilgileri yükleniyor…")).toBeInTheDocument();
      expect(screen.queryByLabelText("Varyant Grubu")).not.toBeInTheDocument();

      cozGetir({ axes: ["Renk"], book_root_slugs: [] });
      expect(await screen.findByLabelText("Varyant Grubu")).toBeInTheDocument();
    });

    it("varyant bilgileri yüklenemediğinde diğer hatalarla aynı gösterim + Tekrar dene aksiyonu görünür, tıklanınca yeniden denenir", async () => {
      fetchVariantConfig.mockRejectedValueOnce(new Error("ağ hatası"));
      kur("/yonetim-yeni/urunler/yeni?tip=varyantli");

      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));

      expect(await screen.findByText("Varyant bilgileri yüklenemedi.")).toBeInTheDocument();
      const tekrarDugmesi = screen.getByRole("button", { name: "Tekrar dene" });

      fetchVariantConfig.mockResolvedValueOnce({ axes: ["Renk"], book_root_slugs: [] });
      await userEvent.click(tekrarDugmesi);

      expect(await screen.findByLabelText("Varyant Grubu")).toBeInTheDocument();
    });
  });

  // Task 8b — toplu kardeş matrisi yalnız DÜZENLEME modunda VE ürün zaten
  // bir gruba bağlıyken açılır (karar belgesi, Faz 2). Matrisin kendi
  // davranışı `varyant.test.tsx`te; burada yalnız KAPI sınanır.
  describe("toplu kardeş varyant üretimi (kapı)", () => {
    it("yeni üründe (kaydedilmemiş) toplu kardeş üretimi tetikleyicisi görünmez", async () => {
      listVariantGroups.mockResolvedValueOnce([
        { id: 1, title: "Kalem Rengi", option1_name: "Renk", option2_name: null, member_count: 1 },
      ]);
      kur("/yonetim-yeni/urunler/yeni?tip=varyantli");

      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));
      await userEvent.click(await screen.findByLabelText("Varyant Grubu"));
      await userEvent.click(await screen.findByTitle("Kalem Rengi (Renk)"));
      // Grup seçili olsa bile — bu ürünün henüz `productId`si yok.
      await screen.findByLabelText("Renk");

      expect(screen.queryByRole("button", { name: "Kardeş Varyant Üret" })).not.toBeInTheDocument();
      expect(previewVariantMatrix).not.toHaveBeenCalled();
    });

    it("düzenlemede gruba bağlı üründe toplu kardeş üretimi tetikleyicisi görünür", async () => {
      fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN_VARYANTLI);
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");

      await userEvent.click(screen.getByRole("tab", { name: "Varyantlar" }));

      expect(await screen.findByRole("button", { name: "Kardeş Varyant Üret" })).toBeInTheDocument();
    });
  });

  // Paket 2'nin ilk işi (bkz. `UrunFormu.tsx` dosya başı yorumu) —
  // `MedyaSekmesi` kapak + galeri yönetimini bu sekmeye bağlar.
  describe("Medya sekmesi", () => {
    it("yeni kayıtta (henüz productId yok) kapı 'önce kaydedin' mesajı gösterir, yükleme UI'ı yok", async () => {
      kur();
      await userEvent.click(screen.getByRole("tab", { name: "Medya" }));

      expect(await screen.findByText("Önce ürünü kaydedin")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Görsel Ekle" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Kapak Yükle" })).not.toBeInTheDocument();
    });

    it("düzenlemede kapak ve galeri görselleri listelenir", async () => {
      fetchProductAdmin.mockResolvedValueOnce({
        ...DUZENLENECEK_URUN,
        cover_url: "https://cdn.example.com/kapak.jpg",
        images: [
          { id: 101, url: "https://cdn.example.com/1.jpg", sort_order: 0, alt_text: null, caption: null },
          { id: 102, url: "https://cdn.example.com/2.jpg", sort_order: 1, alt_text: null, caption: null },
        ],
      });
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");

      await userEvent.click(screen.getByRole("tab", { name: "Medya" }));

      expect(await screen.findByAltText("Kapak")).toBeInTheDocument();
      expect(screen.getByAltText("Görsel 1")).toBeInTheDocument();
      expect(screen.getByAltText("Görsel 2")).toBeInTheDocument();
    });

    it("görsel yükleme sunucuda başarısız olursa kullanıcı sunucunun mesajını görür", async () => {
      fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN);
      uploadProductImages.mockRejectedValueOnce({
        response: { data: { detail: "Depolama alanı dolu." } },
      });
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");
      await userEvent.click(screen.getByRole("tab", { name: "Medya" }));

      const gorselInput = screen.getByLabelText("Görsel seç") as HTMLInputElement;
      const dosya = new File(["içerik"], "gorsel.png", { type: "image/png" });
      await userEvent.upload(gorselInput, dosya);

      expect(await screen.findByText("Depolama alanı dolu.")).toBeInTheDocument();
    });

    it("silme onay ister; onaylanmadan deleteProductImage çağrılmaz, onaylanınca çağrılır", async () => {
      fetchProductAdmin.mockResolvedValueOnce({
        ...DUZENLENECEK_URUN,
        images: [{ id: 101, url: "https://cdn.example.com/1.jpg", sort_order: 0, alt_text: null, caption: null }],
      });
      deleteProductImage.mockResolvedValueOnce({ ...DUZENLENECEK_URUN, images: [] });
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");
      await userEvent.click(screen.getByRole("tab", { name: "Medya" }));
      await screen.findByAltText("Görsel 1");

      await userEvent.click(screen.getByRole("button", { name: "1. görseli sil" }));
      expect(await screen.findByText("Görseli sil")).toBeInTheDocument();
      expect(deleteProductImage).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Sil" }));

      await waitFor(() => expect(deleteProductImage).toHaveBeenCalledWith(9, 101));
    });

    it("sıralama değişikliği sunucuya doğru id dizisiyle gider", async () => {
      fetchProductAdmin.mockResolvedValueOnce({
        ...DUZENLENECEK_URUN,
        images: [
          { id: 101, url: "https://cdn.example.com/1.jpg", sort_order: 0, alt_text: null, caption: null },
          { id: 102, url: "https://cdn.example.com/2.jpg", sort_order: 1, alt_text: null, caption: null },
        ],
      });
      reorderProductImages.mockResolvedValueOnce({
        ...DUZENLENECEK_URUN,
        images: [
          { id: 102, url: "https://cdn.example.com/2.jpg", sort_order: 0, alt_text: null, caption: null },
          { id: 101, url: "https://cdn.example.com/1.jpg", sort_order: 1, alt_text: null, caption: null },
        ],
      });
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");
      await userEvent.click(screen.getByRole("tab", { name: "Medya" }));
      await screen.findByAltText("Görsel 1");

      await userEvent.click(screen.getByRole("button", { name: "2. görseli yukarı taşı" }));

      await waitFor(() => expect(reorderProductImages).toHaveBeenCalledWith(9, [102, 101]));
    });
  });
});
