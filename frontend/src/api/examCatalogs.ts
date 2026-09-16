import { apiClient } from "@/api/axios";
import type { CatalogOut, CatalogWrite } from "@/types";

/**
 * FormData gövdesi için Content-Type ELLE YAZILMAZ — sentinel `false` şart.
 * Gerekçe (boundary'siz sabit → sunucu ayrıştıramaz; `undefined` axios'un
 * post/put/patch url-encoded düşüşüyle ÜZERİNE YAZILIYOR; header'ı tamamen
 * silmek bu instance'ın `application/json` varsayılanına düşüp FormData'yı
 * JSON'a çeviriyor) ayrıntısıyla `api/store.ts`'teki aynı isimli sabitte.
 */
const MULTIPART = { headers: { "Content-Type": false as const } };

/* ── Admin küratör CRUD ── */

export async function listCatalogs(): Promise<CatalogOut[]> {
  const { data } = await apiClient.get<CatalogOut[]>("/exam-catalogs");
  return data;
}

export async function createCatalog(payload: CatalogWrite): Promise<CatalogOut> {
  const { data } = await apiClient.post<CatalogOut>("/exam-catalogs", payload);
  return data;
}

export async function updateCatalog(
  id: number,
  payload: Partial<CatalogWrite>
): Promise<CatalogOut> {
  const { data } = await apiClient.patch<CatalogOut>(`/exam-catalogs/${id}`, payload);
  return data;
}

export async function deleteCatalog(id: number): Promise<void> {
  await apiClient.delete(`/exam-catalogs/${id}`);
}

export async function uploadCatalogAnswerKey(
  id: number,
  file: File
): Promise<CatalogOut> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<CatalogOut>(
    `/exam-catalogs/${id}/answer-key`,
    form,
    MULTIPART
  );
  return data;
}

/** Oturum açarken seçilebilecek public kataloglar (admin + operatör). */
export async function listUsableCatalogs(): Promise<CatalogOut[]> {
  const { data } = await apiClient.get<CatalogOut[]>("/exam-catalogs/usable");
  return data;
}
