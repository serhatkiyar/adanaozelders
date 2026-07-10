import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as storeApi from "@/api/store";
import type { ProductSearchParams } from "@/api/store";

/* ── Public katalog ── */

export function useCategories() {
  return useQuery({
    queryKey: ["store", "categories"],
    queryFn: storeApi.fetchCategories,
    staleTime: 5 * 60 * 1000,
  });
}

export function useProducts(params: ProductSearchParams) {
  return useQuery({
    queryKey: ["store", "products", params],
    queryFn: () => storeApi.searchProducts(params),
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
    mutationFn: (reason: string) => storeApi.requestReturn(orderId, reason),
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

/* ── Admin ── */

export function useAdminProducts() {
  return useQuery({
    queryKey: ["store", "admin", "products"],
    queryFn: storeApi.listProductsAdmin,
  });
}

export function useAdminProduct(id: number | undefined) {
  return useQuery({
    queryKey: ["store", "admin", "product", id],
    queryFn: () => storeApi.fetchProductAdmin(id!),
    enabled: id != null,
  });
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

export function useAdminOrders(statusFilter?: string) {
  return useQuery({
    queryKey: ["store", "admin", "orders", statusFilter ?? "all"],
    queryFn: () => storeApi.listOrdersAdmin(statusFilter),
  });
}

export function useAdminReturns(statusFilter?: string) {
  return useQuery({
    queryKey: ["store", "admin", "returns", statusFilter ?? "all"],
    queryFn: () => storeApi.listReturnsAdmin(statusFilter),
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

export function useCoupons() {
  return useQuery({
    queryKey: ["store", "admin", "coupons"],
    queryFn: storeApi.listCoupons,
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
