import { apiClient } from "@/api/axios";
import type {
  DuyuruAktifOut,
  DuyuruSeridiCreate,
  DuyuruSeridiOut,
  DuyuruSeridiUpdate,
} from "@/types";

/**
 * Storefront'un tepesindeki tek duyuru — **public** uç, kimlik doğrulaması
 * gerektirmez. Uygun kayıt yoksa backend 204 (gövdesiz) döner; burada `null`a
 * çevrilir — `data: ""` ile "veri yok" karışmasın diye `status` okunur.
 */
export async function fetchAktifDuyuru(): Promise<DuyuruAktifOut | null> {
  const { data, status } = await apiClient.get<DuyuruAktifOut | "">(
    "/duyuru-seridi/aktif",
    { validateStatus: (s) => s === 200 || s === 204 }
  );
  return status === 204 ? null : (data as DuyuruAktifOut);
}

// ── Admin CRUD ──

export async function fetchDuyuruSeridiList(): Promise<DuyuruSeridiOut[]> {
  const { data } = await apiClient.get<DuyuruSeridiOut[]>("/admin/duyuru-seridi");
  return data;
}

export async function createDuyuruSeridi(
  payload: DuyuruSeridiCreate
): Promise<DuyuruSeridiOut> {
  const { data } = await apiClient.post<DuyuruSeridiOut>("/admin/duyuru-seridi", payload);
  return data;
}

export async function updateDuyuruSeridi(
  id: number,
  payload: DuyuruSeridiUpdate
): Promise<DuyuruSeridiOut> {
  const { data } = await apiClient.patch<DuyuruSeridiOut>(
    `/admin/duyuru-seridi/${id}`,
    payload
  );
  return data;
}

export async function deleteDuyuruSeridi(id: number): Promise<void> {
  await apiClient.delete(`/admin/duyuru-seridi/${id}`);
}
