import { apiClient } from "@/api/axios";

/** Formun isteğe bağlı bölümleri (profil, ders bilgileri, eğitim/belge). */
export interface TutorPreApplicationProfile {
  email?: string | null;
  district?: string | null;
  experience?: string | null;
  note?: string | null;
  headline?: string | null;
  bio?: string | null;
  intro_video_url?: string | null;
  teaching_mode?: string | null;
  hourly_rate?: string | null;
  availability_note?: string | null;
  education_note?: string | null;
  /** İsteğe bağlı diploma/sertifika ekleri (iki fazın toplamı en fazla 3). */
  documents?: File[];
  /** Kırpılmış profil fotoğrafı (webp blob). */
  photo?: Blob | null;
}

export interface TutorPreApplicationPayload extends TutorPreApplicationProfile {
  full_name: string;
  phone: string;
  subjects: string[];
  kvkk_accepted: boolean;
}

export interface TutorPreApplicationResponse {
  detail: string;
}

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

/** İsteğe bağlı alanları forma yazar; hiç doldurulmayanlar (undefined/null) atlanır. */
function profiliEkle(form: FormData, profil: TutorPreApplicationProfile): void {
  const metinler: (keyof TutorPreApplicationProfile)[] = [
    "email",
    "district",
    "experience",
    "note",
    "headline",
    "bio",
    "intro_video_url",
    "teaching_mode",
    "hourly_rate",
    "availability_note",
    "education_note",
  ];
  for (const alan of metinler) {
    const deger = profil[alan];
    if (deger === undefined || deger === null) continue;
    form.append(alan, String(deger));
  }
  if (profil.photo) form.append("photo", profil.photo, "profil.webp");
  for (const file of profil.documents ?? []) form.append("documents", file);
}

/**
 * Eğitmen ön başvurusu — oturum gerektirmez, hesap açmaz.
 *
 * Tek istek: zorunlu üç alan + doldurulmuş isteğe bağlı bölümler + fotoğraf ve
 * belgeler birlikte gider. Sunucu kaydı yazar, işletmeye e-postayı outbox'a
 * bırakır ve 202 döner.
 */
export async function submitTutorPreApplication(
  payload: TutorPreApplicationPayload
): Promise<TutorPreApplicationResponse> {
  const form = new FormData();
  form.append("full_name", payload.full_name);
  form.append("phone", payload.phone);
  form.append("subjects", JSON.stringify(payload.subjects));
  form.append("kvkk_accepted", String(payload.kvkk_accepted));
  profiliEkle(form, payload);
  const { data } = await apiClient.post<TutorPreApplicationResponse>(
    "/tutor-pre-applications",
    form,
    MULTIPART
  );
  return data;
}
