import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as storeApi from "@/api/store";
import type { ProductSearchParams } from "@/api/store";
import type {
  OrderReturnCreate,
  ProductDetailOut,
  VariantMatrixRow,
} from "@/types";

/* ── Public katalog ── */

export function useCategories() {
  return useQuery({
    queryKey: ["store", "categories"],
    queryFn: storeApi.fetchCategories,
    staleTime: 5 * 60 * 1000,
  });
}

/** Aramaya kapsamlı kategori sayaçları — yalnız arama modunda çekilir. */
export function useCategoryFacets(
  params: Parameters<typeof storeApi.fetchCategoryFacets>[0],
  enabled: boolean
) {
  return useQuery({
    queryKey: ["store", "category-facets", params],
    queryFn: () => storeApi.fetchCategoryFacets(params),
    enabled,
    staleTime: 60 * 1000,
  });
}

/** Kitap künyesi filtre seçenekleri; kategori değişince yeniden çekilir. */
export function useBookFacets(categoryId?: number) {
  return useQuery({
    queryKey: ["store", "book-facets", categoryId ?? null],
    queryFn: () => storeApi.fetchBookFacets(categoryId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useProducts(params: ProductSearchParams, enabled = true) {
  return useQuery({
    queryKey: ["store", "products", params],
    queryFn: () => storeApi.searchProducts(params),
    enabled,
  });
}

/** Sayfalı katalog ("Daha fazla yükle"); offset bazlı, sonuçları biriktirir. */
export function useInfiniteProducts(params: ProductSearchParams) {
  const pageSize = params.limit ?? 24;
  return useInfiniteQuery({
    queryKey: ["store", "products", "infinite", { ...params, limit: pageSize }],
    queryFn: ({ pageParam }) =>
      storeApi.searchProducts({ ...params, limit: pageSize, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === pageSize ? allPages.length * pageSize : undefined,
  });
}

export function useProduct(idOrSlug: string | number | undefined) {
  return useQuery({
    queryKey: ["store", "product", idOrSlug],
    queryFn: () => storeApi.fetchProduct(idOrSlug!),
    enabled: idOrSlug !== undefined && idOrSlug !== "",
  });
}

export function useProductReviews(productId: number | undefined) {
  return useQuery({
    queryKey: ["store", "product", productId, "reviews"],
    queryFn: () => storeApi.fetchProductReviews(productId!),
    enabled: !!productId,
  });
}

export function useNotifyWhenInStock(productId: number) {
  return useMutation({
    mutationFn: (email: string) => storeApi.notifyWhenInStock(productId, email),
  });
}

export function useProductRatingDistribution(productId: number | undefined) {
  return useQuery({
    queryKey: ["store", "product", productId, "rating-distribution"],
    queryFn: () => storeApi.fetchProductRatingDistribution(productId!),
    enabled: !!productId,
  });
}

export function useCreateProductReview(productId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof storeApi.createProductReview>[1]) =>
      storeApi.createProductReview(productId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", "product", productId] });
    },
  });
}

/* ── Sipariş (CLIENT) ── */

export function useMyOrders() {
  return useQuery({
    queryKey: ["store", "orders", "mine"],
    queryFn: storeApi.fetchMyOrders,
  });
}

export function useOrder(orderId: number | undefined) {
  return useQuery({
    queryKey: ["store", "orders", orderId],
    queryFn: () => storeApi.fetchOrder(orderId!),
    enabled: orderId !== undefined && !Number.isNaN(orderId),
  });
}

/**
 * Sipariş faturası. 404 (uç kapalı) ve 409 (kırılım eksik) BEKLENEN
 * durumlardır; yeniden denemek anlamsızdır, o yüzden retry kapalı.
 */
export function useOrderInvoice(orderId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ["store", "orders", orderId, "invoice"],
    queryFn: () => storeApi.fetchOrderInvoice(orderId!),
    enabled: enabled && orderId !== undefined && !Number.isNaN(orderId),
    retry: false,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: storeApi.createOrder,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["store", "orders", "mine"] }),
  });
}

export function usePayOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) => storeApi.payOrder(orderId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["store", "orders", "mine"] }),
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) => storeApi.cancelOrder(orderId),
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ["store", "orders", "mine"] });
      qc.invalidateQueries({ queryKey: ["store", "orders", order.id] });
    },
  });
}

export function useRequestReturn(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OrderReturnCreate) =>
      storeApi.requestReturn(orderId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", "orders", "mine"] });
      qc.invalidateQueries({ queryKey: ["store", "orders", orderId] });
    },
  });
}

/* ── Koleksiyon (Listelerim) ── */

export function useCollections(enabled = true) {
  return useQuery({
    queryKey: ["store", "collections"],
    queryFn: storeApi.listCollections,
    // Koleksiyonlar oturum ister; anonim yüzeyde fetch edilmez (401 gürültüsü olmasın).
    enabled,
  });
}

export function useCollection(id: number | undefined) {
  return useQuery({
    queryKey: ["store", "collections", id],
    queryFn: () => storeApi.fetchCollection(id!),
    enabled: id != null,
  });
}

export function useSharedCollection(token: string | undefined) {
  return useQuery({
    queryKey: ["store", "collections", "shared", token],
    queryFn: () => storeApi.fetchSharedCollection(token!),
    enabled: !!token,
  });
}

function useInvalidateCollections() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["store", "collections"] });
}

export function useCreateCollection() {
  const invalidate = useInvalidateCollections();
  return useMutation({
    mutationFn: (name: string) => storeApi.createCollection(name),
    onSuccess: invalidate,
  });
}

export function useRenameCollection() {
  const invalidate = useInvalidateCollections();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      storeApi.renameCollection(id, name),
    onSuccess: invalidate,
  });
}

export function useDeleteCollection() {
  const invalidate = useInvalidateCollections();
  return useMutation({
    mutationFn: (id: number) => storeApi.deleteCollection(id),
    onSuccess: invalidate,
  });
}

export function useAddToCollection() {
  const invalidate = useInvalidateCollections();
  return useMutation({
    mutationFn: ({ collectionId, productId }: { collectionId: number; productId: number }) =>
      storeApi.addToCollection(collectionId, productId),
    onSuccess: invalidate,
  });
}

export function useRemoveFromCollection() {
  const invalidate = useInvalidateCollections();
  return useMutation({
    mutationFn: ({ collectionId, productId }: { collectionId: number; productId: number }) =>
      storeApi.removeFromCollection(collectionId, productId),
    onSuccess: invalidate,
  });
}

/** Düşük stok eşiği gibi paylaşılan sabitler — istemci kendi kopyasını tutmaz.
 *
 *  `staleTime` uzun: bu değerler bir ürün kararıdır, oturum içinde değişmez.
 *  Uç düşerse `LOW_STOCK_THRESHOLD` bilinmez; çağıran taraf rozetleri nötr
 *  gösterir (yanlış eşikle amber basmaktansa renksiz basmak dürüsttür).
 */
export function useStoreConfig(enabled = true) {
  return useQuery({
    queryKey: ["store", "config"],
    queryFn: storeApi.fetchStoreConfig,
    staleTime: 60 * 60 * 1000,
    enabled,
  });
}

/* ── Admin ── */

/** Yönetim ürün listesi — filtre/arama/sıralama/sayfa SUNUCUDA uygulanır.
 *
 *  `query` queryKey'in parçasıdır: filtre değiştiğinde React Query yeni bir
 *  anahtar görür ve GERÇEK bir istek atar. Anahtarı sabit bırakıp istemcide
 *  filtrelemek, "sayfalama var" sanılan ama aslında ilk 100 kaydı dilimleyen
 *  bir listeye yol açardı.
 *
 *  `placeholderData`: sayfa/filtre değişiminde önceki sayfa ekranda kalır,
 *  tablo boşalıp zıplamaz.
 */
export function useAdminProducts(query: storeApi.AdminProductQuery = {}, enabled = true) {
  return useQuery({
    queryKey: ["store", "admin", "products", query],
    queryFn: () => storeApi.listProductsAdmin(query),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useAdminProduct(id: number | undefined) {
  return useQuery({
    queryKey: ["store", "admin", "product", id],
    queryFn: () => storeApi.fetchProductAdmin(id!),
    enabled: id != null,
  });
}

/**
 * Ürün galerisi yönetimi (admin): kapak, çoklu yükleme, silme, sıralama,
 * alt metin.
 *
 * Beş uç da tazelenmiş `ProductDetailOut` döndürür; onu doğrudan önbelleğe
 * yazıyoruz (`setQueryData`) — yeniden çekme turu beklemeden galeri güncellenir.
 * Vitrin anahtarları ayrıca geçersizleştirilir: aynı ürünün müşteri yüzü
 * `["store", "product", slug]` altında ve id ile YAZILAMAZ.
 */
export function useProductMedia(productId: number | undefined) {
  const qc = useQueryClient();
  const onSuccess = (fresh: ProductDetailOut) => {
    qc.setQueryData(["store", "admin", "product", productId], fresh);
    qc.invalidateQueries({ queryKey: ["store", "admin", "products"] });
    qc.invalidateQueries({ queryKey: ["store", "product"] });
    qc.invalidateQueries({ queryKey: ["store", "products"] });
  };

  const uploadCover = useMutation({
    mutationFn: (file: File) => storeApi.uploadProductCover(productId!, file),
    onSuccess,
  });
  const uploadImages = useMutation({
    mutationFn: (files: File[]) => storeApi.uploadProductImages(productId!, files),
    onSuccess,
  });
  const removeImage = useMutation({
    mutationFn: (imageId: number) => storeApi.deleteProductImage(productId!, imageId),
    onSuccess,
  });
  const reorder = useMutation({
    mutationFn: (imageIds: number[]) =>
      storeApi.reorderProductImages(productId!, imageIds),
    onSuccess,
  });
  const updateMeta = useMutation({
    mutationFn: ({ imageId, alt_text }: { imageId: number; alt_text: string }) =>
      storeApi.updateProductImage(productId!, imageId, { alt_text }),
    onSuccess,
  });

  return { uploadCover, uploadImages, removeImage, reorder, updateMeta };
}

/**
 * Varyant matrisi: kuru çalıştırma (önizleme) + toplu üretim.
 *
 * Önizleme bir MUTASYON olarak modellendi, sorgu olarak değil: yazma yapmasa
 * da girdiyi kullanıcı belirler ve "önizle"ye basılmadan çalışmamalıdır.
 * `useQuery` olsaydı her tuş vuruşunda anahtar değişir ve sunucuya gereksiz
 * tur atardı.
 */
export function useVariantMatrix(productId: number | undefined) {
  const qc = useQueryClient();

  const preview = useMutation({
    mutationFn: (payload: {
      option1_values: string[];
      option2_values?: string[] | null;
    }) => storeApi.previewVariantMatrix(productId!, payload),
  });

  const create = useMutation({
    mutationFn: (rows: VariantMatrixRow[]) =>
      storeApi.createVariantMatrix(productId!, rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", "admin", "products"] });
      qc.invalidateQueries({ queryKey: ["store", "admin", "variant-groups"] });
      qc.invalidateQueries({ queryKey: ["store", "admin", "product", productId] });
      qc.invalidateQueries({ queryKey: ["store", "products"] });
    },
  });

  return { preview, create };
}

export function useBulkImportProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => storeApi.bulkImportProducts(file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", "admin", "products"] });
      qc.invalidateQueries({ queryKey: ["store", "products"] });
    },
  });
}

/* ── Varyant grupları (Faz 2) ── */

export function useVariantConfig() {
  return useQuery({
    queryKey: ["store", "admin", "variant-config"],
    queryFn: storeApi.fetchVariantConfig,
    // Sözlük oturum boyunca değişmez (değişimi bir migration'dır).
    staleTime: Infinity,
  });
}

export function useVariantGroups(enabled = true) {
  return useQuery({
    queryKey: ["store", "admin", "variant-groups"],
    queryFn: storeApi.listVariantGroups,
    enabled,
  });
}

export function useVariantGroup(id: number | null | undefined) {
  return useQuery({
    queryKey: ["store", "admin", "variant-group", id],
    queryFn: () => storeApi.fetchVariantGroup(id!),
    enabled: id != null,
  });
}

export function useCreateVariantGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: storeApi.createVariantGroup,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", "admin", "variant-groups"] });
    },
  });
}

export function useDeriveVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      productId,
      payload,
    }: {
      productId: number;
      payload: import("@/types").DeriveVariantPayload;
    }) => storeApi.deriveVariant(productId, payload),
    onSuccess: (yeni) => {
      qc.invalidateQueries({ queryKey: ["store", "admin", "products"] });
      qc.invalidateQueries({ queryKey: ["store", "admin", "variant-groups"] });
      qc.invalidateQueries({
        queryKey: ["store", "admin", "variant-group", yeni.variant_group_id],
      });
    },
  });
}

/**
 * `offset` — EKLENTİ (bkz. `api/store.ts` `listOrdersAdmin` yorumu). Opsiyonel
 * üçüncü parametre; verilmediğinde `storeApi.listOrdersAdmin`e `undefined`
 * geçer ve istek eskisi gibi `offset` İÇERMEZ — eski panelin
 * `useAdminOrders(durum)` (tek argümanlı) çağrısı birebir eskisi gibi
 * çalışmaya devam eder. `queryKey`e dahil edilmesi şart: dahil olmasaydı
 * sayfa değişince React Query aynı anahtarı görür ve önbellekteki ilk
 * sayfayı döndürürdü (yeni istek atılmazdı).
 */
/** `enabled=false` (ör. `orders.view` yokken) isteği tamamen kapatır. */
export function useAdminOrders(
  statusFilter?: string,
  limit?: number,
  offset?: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      "store",
      "admin",
      "orders",
      statusFilter ?? "all",
      limit ?? 100,
      offset ?? 0,
    ],
    queryFn: () => storeApi.listOrdersAdmin(statusFilter, limit, offset),
    enabled,
  });
}

/**
 * Tekil yönetim siparişi. Anahtar `["store","admin","orders","detail",id]`:
 * `useInvalidateAdminStore`ın `["store","admin"]` öneki bunu da tazeler.
 * Liste sayfalarını taramak ya da önbellekte sipariş aramak yok.
 */
export function useAdminOrder(id: number, enabled = true) {
  const gecerli = Number.isSafeInteger(id) && id > 0;
  return useQuery({
    queryKey: ["store", "admin", "orders", "detail", id],
    queryFn: () => storeApi.getOrderAdmin(id),
    enabled: enabled && gecerli,
  });
}

/** `enabled=false` (ör. `returns.view` yokken) isteği tamamen kapatır. */
export function useAdminReturns(statusFilter?: string, enabled = true) {
  return useQuery({
    queryKey: ["store", "admin", "returns", statusFilter ?? "all"],
    queryFn: () => storeApi.listReturnsAdmin(statusFilter),
    enabled,
  });
}

export function useResolveReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      adminNote,
    }: {
      id: number;
      action: "approve" | "reject";
      adminNote?: string | null;
    }) =>
      action === "approve"
        ? storeApi.approveReturn(id, adminNote)
        : storeApi.rejectReturn(id, adminNote),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", "admin", "returns"] });
      qc.invalidateQueries({ queryKey: ["store", "admin", "orders"] });
    },
  });
}

export function useInvalidateAdminStore() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["store", "admin"] });
    qc.invalidateQueries({ queryKey: ["store", "products"] });
    qc.invalidateQueries({ queryKey: ["store", "categories"] });
  };
}

/* ── Kupon (ADMIN) ── */

export function useCoupons(enabled = true) {
  return useQuery({
    queryKey: ["store", "admin", "coupons"],
    queryFn: storeApi.listCoupons,
    enabled,
  });
}

export function useCreateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: storeApi.createCoupon,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["store", "admin", "coupons"] }),
  });
}

export function useUpdateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<import("@/types").CouponCreate> }) =>
      storeApi.updateCoupon(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["store", "admin", "coupons"] }),
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => storeApi.deleteCoupon(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["store", "admin", "coupons"] }),
  });
}

/* ── Eğitmen ── */

export function useSellerProducts() {
  return useQuery({
    queryKey: ["store", "seller", "products"],
    queryFn: storeApi.listSellerProducts,
  });
}

export function useSellerEarnings() {
  return useQuery({
    queryKey: ["store", "seller", "earnings"],
    queryFn: storeApi.fetchSellerEarnings,
  });
}

export function useInvalidateSellerStore() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["store", "seller"] });
}
