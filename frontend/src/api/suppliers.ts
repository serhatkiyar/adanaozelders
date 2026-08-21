/**
 * Tedarikçi senkronu — `/store/admin/suppliers*` istemcisi (ADMIN).
 *
 * ## Bu katman ne YAPMAZ
 *
 * Karar vermez. Aralık alt sınırları, devre kesici, otomatik bağlama ve yetki
 * sunucudadır; burada yalnız istek kurulur ve tipli yanıt döner.
 *
 * ## İki davranış tip sistemiyle YAKALANAMAZ — ikisi de burada yaşar
 *
 * 1. **Boş token gövdeye KONMAZ.** Panelin token kutusu her açılışta boştur
 *    (D-5: sır ekranda görünmez). Yalnız aralığı değiştirip kaydeden yönetici
 *    `api_token: ""` gönderirse sunucu token'ı siler ve senkron SESSİZCE
 *    durur. Boş/boşluk-only kutu hiç gönderilmez; dolu token kırpılır.
 *
 *    Not: sunucu şeması da boş dizgiyi `None`a çeviriyor (`_bos_token_yok`).
 *    İki kat koruma bilinçli: istemci tarafı savunma, "sunucu nasılsa yakalar"
 *    varsayımına bağlı kalmaz — o varsayım bir refactor'da sessizce çürür.
 *
 * 2. **Kısmi PATCH.** Gönderilmeyen alan sunucuda `exclude_unset` ile korunur.
 *    Bütün alanları `undefined` olarak yollamak, şemaya bağlı olarak mevcut
 *    ayarı sıfırlama riski taşır — bu yüzden gövde AÇIKÇA verilen anahtarlardan
 *    kurulur.
 *
 * `reason` her yazma isteğinde vardır (D-10): gerekçesiz istek 422 alır,
 * kullanıcı "kaydedilmedi" der ama sebebini göremez.
 */
import { apiClient } from "@/api/axios";

import type {
  SupplierLinkIn,
  SupplierOut,
  SupplierProductOut,
  SupplierSettingsIn,
  SupplierUnlinkIn,
  SyncReportOut,
  SyncScope,
} from "@/types/supplier";

/** Tedarikçi listesi (sağlayıcı başına tek aktif satır). */
export async function fetchSuppliers(): Promise<SupplierOut[]> {
  const { data } = await apiClient.get<SupplierOut[]>("/store/admin/suppliers");
  return data;
}

/**
 * Gövdeyi AÇIKÇA verilen anahtarlardan kurar.
 *
 * `undefined` düşer, `false`/`0` DÜŞMEZ: "kapat" komutu da bir değerdir ve
 * genel bir "boş olanı at" süzgeci onu sessizce yutardı.
 */
function ayarGovdesi(payload: SupplierSettingsIn): Record<string, unknown> {
  const govde: Record<string, unknown> = {};
  for (const [anahtar, deger] of Object.entries(payload)) {
    if (deger === undefined) continue;
    if (anahtar === "api_token") continue; // aşağıda ayrı ele alınır
    govde[anahtar] = deger;
  }
  const token = payload.api_token?.trim();
  if (token) govde.api_token = token;
  return govde;
}

export async function updateSupplier(
  id: number,
  payload: SupplierSettingsIn,
): Promise<SupplierOut> {
  const { data } = await apiClient.patch<SupplierOut>(
    `/store/admin/suppliers/${id}`,
    ayarGovdesi(payload),
  );
  return data;
}

/**
 * Elle senkron.
 *
 * Varsayılan kapsam **stok**: yöneticinin en sık istediği şey stok
 * tazeliğidir; fiyat döngüsü token gerektirir ve saatlik ölçekte çalışır.
 * Döngünün advisory lock'unu alamazsa sunucu 409 döner (D-12).
 */
export async function syncSupplier(
  id: number,
  scope: SyncScope = "stock",
): Promise<SyncReportOut> {
  const { data } = await apiClient.post<SyncReportOut>(
    `/store/admin/suppliers/${id}/sync`,
    { scope },
  );
  return data;
}

export interface SupplierProductParams {
  /**
   * `false` = yalnız BAĞLANMAMIŞ satırlar.
   *
   * Süzgeç düşerse "eşleşmemişler" sekmesi TÜM satırları gösterir ve yönetici
   * zaten bağlı olanları yeniden bağlamaya çalışır — bu yüzden `undefined` ile
   * `false` ayrımı korunur.
   */
  linked?: boolean;
  flagged?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

/** Sayfalı tedarikçi ürünü listesi + EŞLEŞEN toplam. */
export interface SupplierProductPage {
  items: SupplierProductOut[];
  /** `X-Total-Count` yoksa -1: sayfa boyutunu "hepsi bu" diye göstermeyiz. */
  total: number;
}

export async function listSupplierProducts(
  id: number,
  params: SupplierProductParams = {},
): Promise<SupplierProductPage> {
  const sorgu: Record<string, unknown> = {};
  for (const [anahtar, deger] of Object.entries(params)) {
    // `false` KORUNUR (yukarıdaki nota bak); yalnız `undefined` ve boş arama
    // metni düşer.
    if (deger === undefined || deger === "") continue;
    sorgu[anahtar] = deger;
  }
  const response = await apiClient.get<SupplierProductOut[]>(
    `/store/admin/suppliers/${id}/products`,
    { params: sorgu },
  );
  const ham = response.headers["x-total-count"];
  const toplam = ham === undefined ? -1 : Number(ham);
  return {
    items: response.data,
    total: Number.isFinite(toplam) ? toplam : -1,
  };
}

/** Elle bağlama — `AUTO` bağın aksine yöneticinin kararıdır, gerekçesi zorunlu. */
export async function linkSupplierProduct(
  id: number,
  spId: number,
  payload: SupplierLinkIn,
): Promise<SupplierProductOut> {
  const { data } = await apiClient.post<SupplierProductOut>(
    `/store/admin/suppliers/${id}/products/${spId}/link`,
    { product_id: payload.product_id, reason: payload.reason },
  );
  return data;
}

export async function unlinkSupplierProduct(
  id: number,
  spId: number,
  payload: SupplierUnlinkIn,
): Promise<SupplierProductOut> {
  const { data } = await apiClient.post<SupplierProductOut>(
    `/store/admin/suppliers/${id}/products/${spId}/unlink`,
    { reason: payload.reason },
  );
  return data;
}
