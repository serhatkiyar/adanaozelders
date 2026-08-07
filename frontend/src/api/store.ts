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
} from "@/types";

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

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

export async function listProductsAdmin(): Promise<ProductSearchOut[]> {
  const { data } = await apiClient.get<ProductSearchOut[]>("/store/admin/products");
  return data;
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

export async function listOrdersAdmin(statusFilter?: string): Promise<OrderOut[]> {
  const { data } = await apiClient.get<OrderOut[]>("/store/admin/orders", {
    params: statusFilter ? { status: statusFilter } : undefined,
  });
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
