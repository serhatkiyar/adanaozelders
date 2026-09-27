// Eğitmen tanıtım videosu — doğrudan yükleme akışı.
//
// Akış: `startIntroVideoUpload` (imzalı PUT adresi) → `uploadToPresignedUrl`
// (tarayıcı → depo, backend'e UĞRAMAZ) → `completeIntroVideoUpload` (sunucu
// nesneyi HEAD ile doğrular, kuyruğa koyar) → worker işler → `fetchMyIntroVideo`
// ile durum takibi (yolda kayıt varken hook 4 sn'de bir yoklar).
import axios from "axios";
import { apiClient } from "@/api/axios";
import type {
  AdminTutorIntroVideo,
  IntroVideoUploadInit,
  TutorIntroVideo,
  TutorIntroVideoState,
} from "@/types";

export async function fetchMyIntroVideo(): Promise<TutorIntroVideoState> {
  const { data } = await apiClient.get<TutorIntroVideoState>("/tutors/me/intro-video");
  return data;
}

export async function startIntroVideoUpload(file: File): Promise<IntroVideoUploadInit> {
  const { data } = await apiClient.post<IntroVideoUploadInit>("/tutors/me/intro-video/uploads", {
    filename: file.name,
    size_bytes: file.size,
    content_type: file.type,
  });
  return data;
}

/**
 * Dosyayı imzalı adrese PUT eder.
 *
 * `apiClient` KULLANILMAZ: o örnek `Authorization: Bearer` başlığı taşır ve S3
 * "yalnız tek kimlik doğrulama yolu" kuralıyla imzalı sorguya çarpar (400);
 * çerez de depoya gitmemeli. Başlıklar sunucunun verdiğiyle BİREBİR aynı
 * gönderilir (Content-Type imzalıdır; farklı değer 403 alır).
 */
export async function uploadToPresignedUrl(
  init: IntroVideoUploadInit,
  file: File,
  opts: { onProgress?: (oran: number) => void; signal?: AbortSignal } = {}
): Promise<void> {
  await axios.put(init.upload_url, file, {
    headers: init.headers,
    withCredentials: false,
    signal: opts.signal,
    // Büyük dosya: bağlantı zaman aşımı değil, toplam süre için üst sınır (30 dk).
    timeout: 30 * 60 * 1000,
    onUploadProgress: (e) => {
      const toplam = e.total ?? file.size;
      if (opts.onProgress && toplam > 0) opts.onProgress(Math.min(1, e.loaded / toplam));
    },
  });
}

export async function completeIntroVideoUpload(videoId: number): Promise<TutorIntroVideo> {
  const { data } = await apiClient.post<TutorIntroVideo>(
    `/tutors/me/intro-video/uploads/${videoId}/complete`
  );
  return data;
}

export async function cancelIntroVideoUpload(videoId: number): Promise<void> {
  await apiClient.delete(`/tutors/me/intro-video/uploads/${videoId}`);
}

export async function removeMyIntroVideo(): Promise<void> {
  await apiClient.delete("/tutors/me/intro-video");
}

// ── Admin: onay kuyruğu ──

export async function fetchPendingTutorVideos(): Promise<AdminTutorIntroVideo[]> {
  const { data } = await apiClient.get<AdminTutorIntroVideo[]>("/admin/tutor-videos/pending");
  return data;
}

export async function reviewTutorVideo(
  id: number,
  action: "approve" | "reject",
  note?: string
): Promise<AdminTutorIntroVideo> {
  const { data } = await apiClient.post<AdminTutorIntroVideo>(`/admin/tutor-videos/${id}/review`, {
    action,
    note: note ?? null,
  });
  return data;
}
