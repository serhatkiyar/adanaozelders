/**
 * Tedarikçi senkronu — React Query katmanı.
 *
 * ## Anahtar hiyerarşisi bilinçlidir
 *
 * `["suppliers"]` · `["suppliers", id, "products", params]`
 *
 * Ürün listesi anahtarı tedarikçi anahtarının ALTINDA yaşar; böylece tek bir
 * `invalidateQueries({ queryKey: ["suppliers"] })` hem durum şeridini hem
 * açık olan liste sekmesini tazeler. Ayrı köklerde dursalardı her mutasyon
 * ikisini de tek tek saymak zorunda kalır ve biri eninde sonunda unutulurdu.
 *
 * ## Mağaza ürün listesi de tazelenir
 *
 * Bağlama/çözme ve elle senkron ürünün tedarikçi bloğunu (maliyet, marj,
 * "Tedarikçi: N" rozeti) değiştirir. `["store","admin","products"]`
 * invalidate edilmezse yönetici Ürünler sekmesine geçtiğinde BAYAT maliyet
 * görür — ve maliyet, fiyat kararının girdisidir.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchSuppliers,
  linkSupplierProduct,
  listSupplierProducts,
  syncSupplier,
  unlinkSupplierProduct,
  updateSupplier,
  type SupplierProductParams,
} from "@/api/suppliers";

import type {
  SupplierLinkIn,
  SupplierSettingsIn,
  SupplierUnlinkIn,
  SyncScope,
} from "@/types/supplier";

export const TEDARIKCI_ANAHTARI = ["suppliers"] as const;
/** Mağaza yönetim listesinin anahtarı (`hooks/useStore.ts::useAdminProducts`). */
const URUN_LISTESI_ANAHTARI = ["store", "admin", "products"] as const;

export function useSuppliers(enabled = true) {
  return useQuery({
    queryKey: TEDARIKCI_ANAHTARI,
    queryFn: fetchSuppliers,
    enabled,
  });
}

/**
 * Tedarikçi kataloğunun sayfalı listesi.
 *
 * `params` anahtarın parçasıdır: süzgeç değişince React Query yeni bir anahtar
 * görür ve GERÇEK bir istek atar. `placeholderData` sayfa değişiminde tabloyu
 * boşaltmaz — 11.915 satırlık bir katalogda zıplayan tablo okunamaz.
 */
export function useSupplierProducts(
  supplierId: number | undefined,
  params: SupplierProductParams = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["suppliers", supplierId, "products", params],
    queryFn: () => listSupplierProducts(supplierId!, params),
    enabled: enabled && supplierId != null,
    placeholderData: (onceki) => onceki,
  });
}

/** Mutasyon sonrası ortak tazeleme — tek yerde, unutulmasın diye. */
function useTedarikciTazele() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: TEDARIKCI_ANAHTARI });
    void qc.invalidateQueries({ queryKey: URUN_LISTESI_ANAHTARI });
  };
}

export function useUpdateSupplier(id: number | undefined) {
  const tazele = useTedarikciTazele();
  return useMutation({
    mutationFn: (payload: SupplierSettingsIn) => updateSupplier(id!, payload),
    onSuccess: tazele,
  });
}

export function useSyncSupplier(id: number | undefined) {
  const tazele = useTedarikciTazele();
  return useMutation({
    mutationFn: (scope: SyncScope = "stock") => syncSupplier(id!, scope),
    onSuccess: tazele,
  });
}

export function useLinkSupplierProduct(id: number | undefined) {
  const tazele = useTedarikciTazele();
  return useMutation({
    mutationFn: ({ spId, ...payload }: SupplierLinkIn & { spId: number }) =>
      linkSupplierProduct(id!, spId, payload),
    onSuccess: tazele,
  });
}

export function useUnlinkSupplierProduct(id: number | undefined) {
  const tazele = useTedarikciTazele();
  return useMutation({
    mutationFn: ({ spId, ...payload }: SupplierUnlinkIn & { spId: number }) =>
      unlinkSupplierProduct(id!, spId, payload),
    onSuccess: tazele,
  });
}
