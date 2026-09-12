import { apiClient } from "@/api/axios";
import type {
  CartLineIn,
  CartValidateOut,
  Collection,
  CollectionDetail,
  Coupon,
  CouponCreate,
  OrderCreate,
  OrderOut,
  OrderReturn,
  OrderReturnCreate,
  ProductCategory,
  ProductCategoryWrite,
  ProductCreate,
  ProductDetailOut,
  ProductReviewCreate,
  ProductReviewOut,
  BulkImportResult,
  ProductSearchOut,
  ProductUpdate,
  RatingDistribution,
  SellerEarnings,
  OrderInvoiceOut,
  SellerProductCreate,
  DeriveVariantPayload,
  VariantConfig,
  VariantGroup,
  VariantGroupDetail,
  VariantGroupWrite,
  VariantMatrixPreview,
  VariantMatrixRow,
  VariantMatrixResult,
} from "@/types";

/**
 * FormData gövdesi için Content-Type ELLE YAZILMAZ.
 *
 * `"multipart/form-data"` sabit değeri boundary parametresi olmadan gider —
 * sunucu gövdeyi ayrıştıramaz (ölçüldü: gerçek tarayıcıda header'da boundary
 * YOK, gövde WebKit boundary'siyle kodlu). `Content-Type: undefined` de
 * çözmüyor: kurulu axios'un `dispatchRequest.js`'i post/put/patch'te
 * `setContentType('application/x-www-form-urlencoded', false)` çağırıyor ve
 * bu, header değeri tam olarak `undefined` iken `rewrite:false`'a rağmen
 * ÜZERİNE YAZIYOR (bkz. `AxiosHeaders.set` → `self[key] === undefined`
 * koşulu) — sonuç FormData'ya `application/x-www-form-urlencoded` gitmesi.
 * Header'ı tamamen silmek de yanlış: bu instance'ın varsayılanı
 * `Content-Type: application/json` (bkz. `api/axios.ts`) devreye girer ve
 * axios'un `transformRequest`'i `hasJSONContentType` dalına düşüp FormData'yı
 * `JSON.stringify(formDataToJSON(...))` ile YOK EDER (ölçüldü: dosya içeriği
 * kaybolup `{"file":{}}` gibi bir gövdeye dönüşüyor).
 *
 * Doğru sentinel `false`: axios bunu "bu header'ı hiç gönderme" olarak ele
 * alıyor, `dispatchRequest`'in url-encoded düşüşü onu ÜZERİNE YAZMIYOR
 * (`self[key] === false`, `undefined` değil) ve `xhr.js`'e giden gerçek
 * header listesinde Content-Type hiç YOK — tarayıcı XHR.send(FormData)
 * çağrısında boundary'yi kendisi ekliyor. (Üç senaryo da yerel axios
 * kaynağı okunarak ve sahte adapter'la ölçüldü.)
 */
const MULTIPART = { headers: { "Content-Type": false as const } };

/* ── Public katalog ── */

export interface ProductSearchParams {
  q?: string;
  category_id?: number;
  tutor_id?: number;
  kind?: "PHYSICAL" | "DIGITAL";
  min_price?: number;
  max_price?: number;
  in_stock?: boolean;
  min_rating?: number;
  /** Kitap künyesi daraltmaları (çoklu seçim; /store/book-facets listeler). */
  publisher?: string[];
  author?: string[];
  cover_type?: string[];
  /** Varyant eksen daraltması: "Eksen:Değer" öğeleri (ör. "Renk:Sarı"). */
  variant?: string[];
  sort?: "price_asc" | "price_desc" | "newest" | "rating";
  limit?: number;
  offset?: number;
}

export async function searchProducts(
  params: ProductSearchParams
): Promise<ProductSearchOut[]> {
  const { data } = await apiClient.get<ProductSearchOut[]>("/store/products", {
    params,
  });
  return data;
}

export interface BookFacet {
  value: string;
  count: number;
}

export interface BookFacets {
  publisher: BookFacet[];
  author: BookFacet[];
  cover_type: BookFacet[];
  /** Eksen ADI → değerler (ör. {"Renk": [...], "Ebat": [...]}). */
  variant_axes?: Record<string, BookFacet[]>;
}

/** Kitap filtrelerinin seçilebilir değerleri (+ ürün sayısı). */
export async function fetchBookFacets(categoryId?: number): Promise<BookFacets> {
  const { data } = await apiClient.get<BookFacets>("/store/book-facets", {
    params: categoryId ? { category_id: categoryId } : undefined,
  });
  return data;
}

export async function fetchProduct(
  idOrSlug: string | number
): Promise<ProductDetailOut> {
  const { data } = await apiClient.get<ProductDetailOut>(
    `/store/products/${idOrSlug}`
  );
  return data;
}

export async function fetchCategories(): Promise<ProductCategory[]> {
  const { data } = await apiClient.get<ProductCategory[]>("/store/categories");
  return data;
}

/** Aramaya KAPSAMLI kategori sayaçları (kenar çubuğu "İlgili kategoriler"):
 *  yalnız eşleşme içeren kategoriler, alt-ağaç toplamı sayılarla. Filtre
 *  semantiği ürün aramasıyla aynı kaynaktan (backend tek koşul listesi). */
export async function fetchCategoryFacets(
  params: Pick<
    ProductSearchParams,
    "q" | "kind" | "min_price" | "max_price" | "min_rating" | "publisher" | "author" | "cover_type" | "variant"
  >
): Promise<ProductCategory[]> {
  const { data } = await apiClient.get<ProductCategory[]>("/store/category-facets", {
    params,
    paramsSerializer: { indexes: null },
  });
  return data;
}

export async function fetchProductReviews(
  productId: number
): Promise<ProductReviewOut[]> {
  const { data } = await apiClient.get<ProductReviewOut[]>(
    `/store/products/${productId}/reviews`
  );
  return data;
}

export async function fetchProductRatingDistribution(
  productId: number
): Promise<RatingDistribution> {
  const { data } = await apiClient.get<RatingDistribution>(
    `/store/products/${productId}/reviews/distribution`
  );
  return data;
}

export async function createProductReview(
  productId: number,
  payload: ProductReviewCreate
): Promise<ProductReviewOut> {
  const { data } = await apiClient.post<ProductReviewOut>(
    `/store/products/${productId}/reviews`,
    payload
  );
  return data;
}

export async function deleteProductReview(reviewId: number): Promise<void> {
  await apiClient.delete(`/store/reviews/${reviewId}`);
}

export async function notifyWhenInStock(
  productId: number,
  email: string
): Promise<void> {
  await apiClient.post(`/store/products/${productId}/notify-me`, { email });
}

/* ── Mağaza favorileri (kalp) — hesapla senkron ── */

export async function listFavorites(): Promise<ProductSearchOut[]> {
  const { data } = await apiClient.get<ProductSearchOut[]>("/store/favorites");
  return data;
}

export async function addFavorite(productId: number): Promise<void> {
  await apiClient.put(`/store/favorites/${productId}`);
}

export async function removeFavorite(productId: number): Promise<void> {
  await apiClient.delete(`/store/favorites/${productId}`);
}

/* ── Koleksiyon (Listelerim) ── */

export async function listCollections(): Promise<Collection[]> {
  const { data } = await apiClient.get<Collection[]>("/store/collections");
  return data;
}

export async function fetchCollection(id: number): Promise<CollectionDetail> {
  const { data } = await apiClient.get<CollectionDetail>(`/store/collections/${id}`);
  return data;
}

export async function fetchSharedCollection(
  token: string
): Promise<CollectionDetail> {
  const { data } = await apiClient.get<CollectionDetail>(
    `/store/collections/shared/${token}`
  );
  return data;
}

export async function createCollection(name: string): Promise<Collection> {
  const { data } = await apiClient.post<Collection>("/store/collections", { name });
  return data;
}

export async function renameCollection(
  id: number,
  name: string
): Promise<Collection> {
  const { data } = await apiClient.patch<Collection>(`/store/collections/${id}`, {
    name,
  });
  return data;
}

export async function deleteCollection(id: number): Promise<void> {
  await apiClient.delete(`/store/collections/${id}`);
}

export async function addToCollection(
  collectionId: number,
  productId: number
): Promise<Collection> {
  const { data } = await apiClient.post<Collection>(
    `/store/collections/${collectionId}/items`,
    { product_id: productId }
  );
  return data;
}

export async function removeFromCollection(
  collectionId: number,
  productId: number
): Promise<Collection> {
  const { data } = await apiClient.delete<Collection>(
    `/store/collections/${collectionId}/items/${productId}`
  );
  return data;
}

/* ── Sepet / sipariş (CLIENT) ── */

export async function validateCart(
  items: CartLineIn[],
  couponCode?: string | null
): Promise<CartValidateOut> {
  const { data } = await apiClient.post<CartValidateOut>("/store/cart/validate", {
    items,
    coupon_code: couponCode ?? null,
  });
  return data;
}

export async function createOrder(payload: OrderCreate): Promise<OrderOut> {
  const { data } = await apiClient.post<OrderOut>("/store/orders", payload);
  return data;
}

export async function fetchMyOrders(): Promise<OrderOut[]> {
  const { data } = await apiClient.get<OrderOut[]>("/store/orders/mine");
  return data;
}

export async function fetchOrder(orderId: number): Promise<OrderOut> {
  const { data } = await apiClient.get<OrderOut>(`/store/orders/${orderId}`);
  return data;
}

export async function payOrder(orderId: number): Promise<OrderOut> {
  const { data } = await apiClient.post<OrderOut>(`/store/orders/${orderId}/pay`);
  return data;
}

export async function cancelOrder(orderId: number): Promise<OrderOut> {
  const { data } = await apiClient.post<OrderOut>(`/store/orders/${orderId}/cancel`);
  return data;
}

export async function requestReturn(
  orderId: number,
  payload: OrderReturnCreate
): Promise<OrderReturn> {
  const { data } = await apiClient.post<OrderReturn>(
    `/store/orders/${orderId}/return`,
    payload
  );
  return data;
}

/* ── Admin ── */

/** Mağaza yüzeylerinin paylaştığı sunucu sabitleri. */
export interface StoreConfig {
  low_stock_threshold: number;
  /** Ücretsiz kargo eşiği (TL). İstemci kendi kopyasını TAŞIMAZ: `.env`'den
   *  değişen bir eşik vitrinde eski değeriyle görünürdü. */
  shipping_free_threshold?: string;
  /** Eşik altı fiziksel siparişin sabit kargo ücreti (TL). */
  shipping_flat_fee?: string;
}

export async function fetchStoreConfig(): Promise<StoreConfig> {
  const { data } = await apiClient.get<StoreConfig>("/store/config");
  return data;
}

/** Yönetim ürün listesinin sunucuya gönderdiği tüm parametreler. */
export interface AdminProductQuery {
  q?: string;
  stok?: string;
  publisher?: string;
  author?: string;
  sort?: string;
  order?: string;
  /**
   * Tedarikçi süzgeci (tedarikçi senkronu).
   *
   * `linked` = bir tedarikçi satırına bağlı · `backed` = tedarikçiden temin
   * açık (`supplier_backed`) · `below_cost` = satış fiyatı maliyetin ALTINDA.
   * Sonuncusu bir para kaybı alarmıdır: fiyatı elle girilmiş bir ürünün
   * maliyeti tedarikçi zammıyla sessizce geçmesi, ancak burada görülür.
   */
  supplier?: "linked" | "backed" | "below_cost";
  limit?: number;
  offset?: number;
}

/** Sayfalı liste + EŞLEŞEN toplam kayıt (dönen satır sayısı değil). */
export interface AdminProductPage {
  items: ProductSearchOut[];
  total: number;
}

export async function listProductsAdmin(
  query: AdminProductQuery = {}
): Promise<AdminProductPage> {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params[k] = v;
  }
  const response = await apiClient.get<ProductSearchOut[]>("/store/admin/products", {
    params,
  });
  // Toplam `X-Total-Count` başlığında. Başlık yoksa dönen satır sayısına
  // düşmek YANLIŞ olurdu: sayfa boyutu kadar bir sayı gösterip "hepsi bu"
  // demek, sessiz kesilmenin ta kendisi. Bilinmiyorsa -1 ile işaretlenir ve
  // ekran toplamı göstermez.
  const ham = response.headers["x-total-count"];
  const total = ham === undefined ? -1 : Number(ham);
  return {
    items: response.data,
    total: Number.isFinite(total) ? total : -1,
  };
}

export async function fetchProductAdmin(id: number): Promise<ProductDetailOut> {
  const { data } = await apiClient.get<ProductDetailOut>(`/store/admin/products/${id}`);
  return data;
}

export async function bulkImportProducts(file: File): Promise<BulkImportResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<BulkImportResult>(
    "/store/admin/products/bulk",
    form,
    MULTIPART
  );
  return data;
}

/**
 * Sipariş faturası (sunucu tarafı).
 *
 * Uç `INVOICE_ENABLED` kapalıyken 404, kırılımı eksik/ödenmemiş siparişte
 * 409 döner. Çağıran bunları HATA olarak değil, "belge henüz üretilemiyor"
 * durumu olarak ele almalıdır (bkz. OrderInvoiceModal).
 */
export async function fetchOrderInvoice(
  orderId: number
): Promise<OrderInvoiceOut> {
  const { data } = await apiClient.get<OrderInvoiceOut>(
    `/store/orders/${orderId}/invoice`
  );
  return data;
}

export async function createProduct(
  payload: ProductCreate
): Promise<ProductDetailOut> {
  const { data } = await apiClient.post<ProductDetailOut>(
    "/store/admin/products",
    payload
  );
  return data;
}

export async function updateProduct(
  id: number,
  payload: ProductUpdate
): Promise<ProductDetailOut> {
  const { data } = await apiClient.patch<ProductDetailOut>(
    `/store/admin/products/${id}`,
    payload
  );
  return data;
}

export async function deleteProduct(id: number): Promise<void> {
  await apiClient.delete(`/store/admin/products/${id}`);
}

export async function uploadProductCover(
  id: number,
  file: File
): Promise<ProductDetailOut> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<ProductDetailOut>(
    `/store/admin/products/${id}/cover`,
    form,
    MULTIPART
  );
  return data;
}

export async function uploadProductImages(
  id: number,
  files: File[]
): Promise<ProductDetailOut> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const { data } = await apiClient.post<ProductDetailOut>(
    `/store/admin/products/${id}/images`,
    form,
    MULTIPART
  );
  return data;
}

export async function deleteProductImage(
  id: number,
  imageId: number
): Promise<ProductDetailOut> {
  const { data } = await apiClient.delete<ProductDetailOut>(
    `/store/admin/products/${id}/images/${imageId}`
  );
  return data;
}

/** Galeri sırası. Dizide GEÇMEYEN görsel silinmez; sunucu onu sona alır —
 *  başka bir yönetici bu sırada görsel yüklediyse kaybolmasın. */
export async function reorderProductImages(
  id: number,
  imageIds: number[]
): Promise<ProductDetailOut> {
  const { data } = await apiClient.patch<ProductDetailOut>(
    `/store/admin/products/${id}/images/reorder`,
    { image_ids: imageIds }
  );
  return data;
}

/** Görsel üstverisi. Yalnız gönderilen alan güncellenir; boş dize temizler. */
export async function updateProductImage(
  id: number,
  imageId: number,
  payload: { alt_text?: string | null; caption?: string | null }
): Promise<ProductDetailOut> {
  const { data } = await apiClient.patch<ProductDetailOut>(
    `/store/admin/products/${id}/images/${imageId}`,
    payload
  );
  return data;
}

export async function createCategory(
  payload: ProductCategoryWrite
): Promise<ProductCategory> {
  const { data } = await apiClient.post<ProductCategory>(
    "/store/admin/categories",
    payload
  );
  return data;
}

export async function updateCategory(
  id: number,
  payload: Partial<ProductCategoryWrite>
): Promise<ProductCategory> {
  const { data } = await apiClient.patch<ProductCategory>(
    `/store/admin/categories/${id}`,
    payload
  );
  return data;
}

export async function deleteCategory(id: number): Promise<void> {
  await apiClient.delete(`/store/admin/categories/${id}`);
}

/* ── Varyant grupları (Faz 2) ── */

export async function fetchVariantConfig(): Promise<VariantConfig> {
  const { data } = await apiClient.get<VariantConfig>(
    "/store/admin/variant-config"
  );
  return data;
}

export async function listVariantGroups(): Promise<VariantGroup[]> {
  const { data } = await apiClient.get<VariantGroup[]>(
    "/store/admin/variant-groups"
  );
  return data;
}

export async function fetchVariantGroup(
  id: number
): Promise<VariantGroupDetail> {
  const { data } = await apiClient.get<VariantGroupDetail>(
    `/store/admin/variant-groups/${id}`
  );
  return data;
}

export async function createVariantGroup(
  payload: VariantGroupWrite
): Promise<VariantGroup> {
  const { data } = await apiClient.post<VariantGroup>(
    "/store/admin/variant-groups",
    payload
  );
  return data;
}

export async function updateVariantGroup(
  id: number,
  payload: Partial<VariantGroupWrite>
): Promise<VariantGroup> {
  const { data } = await apiClient.patch<VariantGroup>(
    `/store/admin/variant-groups/${id}`,
    payload
  );
  return data;
}

export async function deleteVariantGroup(id: number): Promise<void> {
  await apiClient.delete(`/store/admin/variant-groups/${id}`);
}

export async function deriveVariant(
  productId: number,
  payload: DeriveVariantPayload
): Promise<ProductDetailOut> {
  const { data } = await apiClient.post<ProductDetailOut>(
    `/store/admin/products/${productId}/derive-variant`,
    payload
  );
  return data;
}

/** Kombinasyon önizlemesi — KURU ÇALIŞTIRMA, hiçbir şey yazmaz. */
export async function previewVariantMatrix(
  productId: number,
  payload: { option1_values: string[]; option2_values?: string[] | null }
): Promise<VariantMatrixPreview> {
  const { data } = await apiClient.post<VariantMatrixPreview>(
    `/store/admin/products/${productId}/variant-matrix/preview`,
    payload
  );
  return data;
}

/** Kardeş varyantları toplu üretir — hepsi ya da hiçbiri (tek transaction). */
export async function createVariantMatrix(
  productId: number,
  rows: VariantMatrixRow[]
): Promise<VariantMatrixResult> {
  const { data } = await apiClient.post<VariantMatrixResult>(
    `/store/admin/products/${productId}/variant-matrix`,
    { rows }
  );
  return data;
}

/** Sipariş listesi + EŞLEŞEN toplam (dönen satır sayısı değil). */
export interface AdminOrderPage {
  items: OrderOut[];
  total: number;
  /** Sunucuya gönderilen sayfa boyutu — kesilme uyarısı buna göre karar verir. */
  limit: number;
}

/**
 * `limit` AÇIKÇA gönderilir.
 *
 * Önceden istemci hiç `limit` göndermiyordu ve sunucu varsayılanı (100)
 * sessizce uygulanıyordu; frontend ise kesilmeyi sabit 200'e göre ölçüyordu.
 * Sonuç: 130 siparişten 100'ü dönüyor, uyarı ASLA tetiklenmiyordu (P1-5).
 * Tavanı istemcinin bilmesi şart — yoksa "hepsini gördüm mü" sorusu
 * cevaplanamaz.
 *
 * `offset` — EKLENTİ (bkz. `backend/api/routers/store.py` `list_orders_admin`,
 * uç bunu baştan beri destekliyordu; eksik olan tek şey istemcinin onu hiç
 * göndermemesiydi, bkz. `SiparisListesi` sunucu sayfalaması). Opsiyoneldir
 * ve `undefined` bırakıldığında isteğe HİÇ eklenmez — eski çağrı yerleri
 * (ör. `OrdersPanel.tsx`nin `useAdminOrders(durum)` çağrısı) birebir eski
 * davranışı korur. `0` özel olarak "verilmedi" ile KARIŞTIRILMAZ (ilk sayfa
 * da açıkça `offset=0` gönderir) — kontrol `undefined` kontrolüdür, `!offset`
 * değil.
 */
export async function listOrdersAdmin(
  statusFilter?: string,
  limit = 100,
  offset?: number
): Promise<AdminOrderPage> {
  const response = await apiClient.get<OrderOut[]>("/store/admin/orders", {
    params: {
      ...(statusFilter ? { status: statusFilter } : {}),
      limit,
      ...(offset !== undefined ? { offset } : {}),
    },
  });
  const ham = response.headers["x-total-count"];
  const total = ham === undefined ? -1 : Number(ham);
  return {
    items: response.data,
    total: Number.isFinite(total) ? total : -1,
    limit,
  };
}

/** Yönetim tekil sipariş okuma — `orders.view`; kalemler ve iade durumu dahil. */
export async function getOrderAdmin(id: number): Promise<OrderOut> {
  const { data } = await apiClient.get<OrderOut>(`/store/admin/orders/${id}`);
  return data;
}

export async function shipOrder(
  id: number,
  trackingNo?: string | null
): Promise<OrderOut> {
  const { data } = await apiClient.post<OrderOut>(
    `/store/admin/orders/${id}/ship`,
    { tracking_no: trackingNo ?? null }
  );
  return data;
}

export async function deliverOrder(id: number): Promise<OrderOut> {
  const { data } = await apiClient.post<OrderOut>(
    `/store/admin/orders/${id}/deliver`
  );
  return data;
}

/**
 * Yönetici tam iadesi. Gerekçe **zorunludur** (backend `AdminOrderActionIn`):
 * para hareketi başlatan aksiyon gerekçesiz kaydedilemez, değer hem
 * `audit_logs.reason`'a hem sipariş durum geçmişine yazılır.
 */
export async function refundOrder(id: number, reason: string): Promise<OrderOut> {
  const { data } = await apiClient.post<OrderOut>(
    `/store/admin/orders/${id}/refund`,
    { reason }
  );
  return data;
}

/* ── İade talepleri (RMA, ADMIN) ── */

export async function listReturnsAdmin(
  statusFilter?: string
): Promise<OrderReturn[]> {
  const { data } = await apiClient.get<OrderReturn[]>("/store/admin/returns", {
    params: statusFilter ? { status: statusFilter } : undefined,
  });
  return data;
}

export async function approveReturn(
  id: number,
  adminNote?: string | null
): Promise<OrderReturn> {
  const { data } = await apiClient.post<OrderReturn>(
    `/store/admin/returns/${id}/approve`,
    { admin_note: adminNote ?? null }
  );
  return data;
}

export async function rejectReturn(
  id: number,
  adminNote?: string | null
): Promise<OrderReturn> {
  const { data } = await apiClient.post<OrderReturn>(
    `/store/admin/returns/${id}/reject`,
    { admin_note: adminNote ?? null }
  );
  return data;
}

/* ── Kupon (ADMIN) ── */

export async function listCoupons(): Promise<Coupon[]> {
  const { data } = await apiClient.get<Coupon[]>("/store/admin/coupons");
  return data;
}

export async function createCoupon(payload: CouponCreate): Promise<Coupon> {
  const { data } = await apiClient.post<Coupon>("/store/admin/coupons", payload);
  return data;
}

export async function updateCoupon(
  id: number,
  payload: Partial<CouponCreate>
): Promise<Coupon> {
  const { data } = await apiClient.patch<Coupon>(`/store/admin/coupons/${id}`, payload);
  return data;
}

export async function deleteCoupon(id: number): Promise<void> {
  await apiClient.delete(`/store/admin/coupons/${id}`);
}

/* ── Eğitmen dijital ürünleri ── */

export async function listSellerProducts(): Promise<ProductSearchOut[]> {
  const { data } = await apiClient.get<ProductSearchOut[]>("/store/seller/products");
  return data;
}

export async function fetchSellerEarnings(): Promise<SellerEarnings> {
  const { data } = await apiClient.get<SellerEarnings>("/store/seller/earnings");
  return data;
}

export async function createSellerProduct(
  payload: SellerProductCreate
): Promise<ProductDetailOut> {
  const { data } = await apiClient.post<ProductDetailOut>(
    "/store/seller/products",
    payload
  );
  return data;
}

export async function updateSellerProduct(
  id: number,
  payload: ProductUpdate
): Promise<ProductDetailOut> {
  const { data } = await apiClient.patch<ProductDetailOut>(
    `/store/seller/products/${id}`,
    payload
  );
  return data;
}

export async function deleteSellerProduct(id: number): Promise<void> {
  await apiClient.delete(`/store/seller/products/${id}`);
}

export async function uploadSellerCover(
  id: number,
  file: File
): Promise<ProductDetailOut> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<ProductDetailOut>(
    `/store/seller/products/${id}/cover`,
    form,
    MULTIPART
  );
  return data;
}

export async function uploadSellerAsset(
  id: number,
  file: File
): Promise<ProductDetailOut> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<ProductDetailOut>(
    `/store/seller/products/${id}/asset`,
    form,
    MULTIPART
  );
  return data;
}
