/**
 * Mağaza yönetimi API'lerinin KALAN kısmı (manuel vitrin kararı, 28 Ağu 2026).
 *
 * Vitrin/landing/koleksiyon uçları söküldü — vitrin artık kodda yaşar
 * (pages/store/vitrin/). Burada yalnız iki canlı tüketicinin ihtiyacı durur:
 *   • MEDYA: blog kapak görseli yüklemesi (AdminBlogEditorPage),
 *   • ÖZNİTELİKLER: ürün formu + kategori sekmesindeki taksonomi yönetimi.
 */
import { apiClient } from "@/api/axios";
import type {
  ProductAttributeDefinition,
  StoreMediaAsset,
} from "@/types";

/**
 * FormData gövdesi için Content-Type ELLE YAZILMAZ — sentinel `false` şart.
 * Gerekçe (boundary'siz sabit → sunucu ayrıştıramaz; `undefined` axios'un
 * post/put/patch url-encoded düşüşüyle ÜZERİNE YAZILIYOR; header'ı tamamen
 * silmek bu instance'ın `application/json` varsayılanına düşüp FormData'yı
 * JSON'a çeviriyor) ayrıntısıyla `api/store.ts`'teki aynı isimli sabitte.
 */
const MULTIPART = { headers: { "Content-Type": false as const } };

/* ── Medya kütüphanesi ── */

export async function fetchStoreMedia(): Promise<StoreMediaAsset[]> {
  const { data } = await apiClient.get<StoreMediaAsset[]>("/admin/store-merchandising/media");
  return data;
}

export async function uploadStoreMedia(image: File, altText: string): Promise<StoreMediaAsset> {
  const form = new FormData();
  form.append("image", image);
  form.append("alt_text", altText);
  const { data } = await apiClient.post<StoreMediaAsset>(
    "/admin/store-merchandising/media",
    form,
    MULTIPART,
  );
  return data;
}

/* ── Ürün öznitelikleri (taksonomi) ── */

export async function fetchStoreAttributes(admin = false): Promise<ProductAttributeDefinition[]> {
  const path = admin ? "/admin/store-merchandising/attributes" : "/store/attributes";
  const { data } = await apiClient.get<ProductAttributeDefinition[]>(path);
  return data;
}

export async function createStoreAttribute(payload: { name: string; sort_order: number; is_active: boolean }) {
  const { data } = await apiClient.post<ProductAttributeDefinition>("/admin/store-merchandising/attributes", payload);
  return data;
}

export async function createStoreAttributeValue(definitionId: number, payload: { label: string; sort_order: number; is_active: boolean }) {
  const { data } = await apiClient.post(`/admin/store-merchandising/attributes/${definitionId}/values`, payload);
  return data;
}

export async function setProductAttributes(productId: number, valueIds: number[]): Promise<void> {
  await apiClient.put(`/admin/store-merchandising/products/${productId}/attributes`, {
    value_ids: valueIds,
  });
}

export async function fetchProductAttributeValueIds(productId: number): Promise<number[]> {
  const { data } = await apiClient.get<{ value_ids: number[] }>(
    `/admin/store-merchandising/products/${productId}/attributes`,
  );
  return data.value_ids;
}
