import { apiClient } from "@/api/axios";

export interface TutorPreApplicationPayload {
  full_name: string;
  phone: string;
  email?: string | null;
  subjects: string[];
  district?: string | null;
  experience?: string | null;
  note?: string | null;
  kvkk_accepted: boolean;
  /** İsteğe bağlı diploma/sertifika ekleri (en fazla 3, dosya başı 10 MB). */
  documents?: File[];
}

export interface TutorPreApplicationResponse {
  detail: string;
}

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

/**
 * Eğitmen ön başvurusu — oturum gerektirmez, hesap açmaz.
 * Multipart gider (belge taşıyabilir); sunucu kaydı yazar, işletmeye
 * e-postayı outbox'a bırakır ve 202 döner.
 */
export async function submitTutorPreApplication(
  payload: TutorPreApplicationPayload
): Promise<TutorPreApplicationResponse> {
  const form = new FormData();
  form.append("full_name", payload.full_name);
  form.append("phone", payload.phone);
  form.append("subjects", JSON.stringify(payload.subjects));
  if (payload.email) form.append("email", payload.email);
  if (payload.district) form.append("district", payload.district);
  if (payload.experience) form.append("experience", payload.experience);
  if (payload.note) form.append("note", payload.note);
  form.append("kvkk_accepted", String(payload.kvkk_accepted));
  for (const file of payload.documents ?? []) {
    form.append("documents", file);
  }
  const { data } = await apiClient.post<TutorPreApplicationResponse>(
    "/tutor-pre-applications",
    form,
    MULTIPART
  );
  return data;
}
