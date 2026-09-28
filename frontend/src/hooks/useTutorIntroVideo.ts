import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  cancelIntroVideoUpload,
  completeIntroVideoUpload,
  fetchMyIntroVideo,
  removeMyIntroVideo,
  startIntroVideoUpload,
  uploadToPresignedUrl,
} from "@/api/tutorVideo";
import { getErrorMessage } from "@/lib/errors";
import {
  ISLENIYOR_DURUMLAR,
  dosyaOnKontrol,
  videoBilgisiKontrol,
  videoBilgisiniOku,
} from "@/lib/tanitimVideo";
import type { TutorIntroVideo, TutorIntroVideoState } from "@/types";

export const INTRO_VIDEO_KEY = ["tutors", "me", "intro-video"] as const;

/**
 * Eğitmenin video durumu. Yolda bir kayıt sunucuda işleniyorsa 4 sn'de bir
 * yoklar (useDelivery deseni); bitince yoklama kendiliğinden kapanır.
 */
export function useMyIntroVideo(enabled = true) {
  return useQuery({
    queryKey: INTRO_VIDEO_KEY,
    queryFn: fetchMyIntroVideo,
    enabled,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const s = query.state.data?.pending?.status;
      return s && ISLENIYOR_DURUMLAR.has(s) ? 4_000 : false;
    },
  });
}

function useVideoDurumuYenile() {
  const qc = useQueryClient();
  return useCallback(
    (tutorId?: number) => {
      qc.invalidateQueries({ queryKey: INTRO_VIDEO_KEY });
      qc.invalidateQueries({ queryKey: ["tutors", "me"] });
      if (tutorId != null) qc.invalidateQueries({ queryKey: ["tutors", "detail", tutorId] });
    },
    [qc]
  );
}

export type YuklemeAsamasi =
  | { tur: "bos" }
  | { tur: "hazirlaniyor" }
  | { tur: "yukleniyor"; oran: number; videoId: number }
  | { tur: "tamamlaniyor"; videoId: number }
  | { tur: "bitti"; kayit: TutorIntroVideo }
  | { tur: "hata"; mesaj: string };

/**
 * Tarayıcıdan depoya doğrudan yükleme durum makinesi:
 * hazırlanıyor → yükleniyor (%) → tamamlanıyor → bitti | hata. İptal, süren
 * PUT'u keser ve sunucudaki kaydı siler.
 */
export function useIntroVideoUpload(opts: {
  maxBytes: number;
  maxSeconds: number;
  minSeconds: number;
  tutorId?: number;
}) {
  const [asama, setAsama] = useState<YuklemeAsamasi>({ tur: "bos" });
  const abortRef = useRef<AbortController | null>(null);
  const videoIdRef = useRef<number | null>(null);
  const yenile = useVideoDurumuYenile();

  const sifirla = useCallback(() => setAsama({ tur: "bos" }), []);

  const yukle = useCallback(
    async (file: File) => {
      const onHata = dosyaOnKontrol(file, opts.maxBytes);
      if (onHata) {
        setAsama({ tur: "hata", mesaj: onHata });
        return;
      }
      setAsama({ tur: "hazirlaniyor" });
      // Erken uyarı (süre, dikey): sunucu aynı kuralları yine uygular; burada
      // kullanıcıyı 300 MB yüklemeden ÖNCE durdurmak için. Okunamazsa geçilir.
      const erken = videoBilgisiKontrol(await videoBilgisiniOku(file), {
        minSeconds: opts.minSeconds,
        maxSeconds: opts.maxSeconds,
      });
      if (erken) {
        setAsama({ tur: "hata", mesaj: erken });
        return;
      }
      const abort = new AbortController();
      abortRef.current = abort;
      let videoId: number | null = null;
      try {
        const init = await startIntroVideoUpload(file);
        videoId = init.video_id;
        videoIdRef.current = videoId;
        setAsama({ tur: "yukleniyor", oran: 0, videoId });
        await uploadToPresignedUrl(init, file, {
          signal: abort.signal,
          onProgress: (oran) => setAsama({ tur: "yukleniyor", oran, videoId: init.video_id }),
        });
        setAsama({ tur: "tamamlaniyor", videoId });
        const kayit = await completeIntroVideoUpload(videoId);
        setAsama({ tur: "bitti", kayit });
        yenile(opts.tutorId);
      } catch (err) {
        if (axios.isCancel(err) || abort.signal.aborted) {
          setAsama({ tur: "bos" });
          return;
        }
        // Depoya PUT hatası (CORS/ağ) apiClient'tan geçmez: mesajı sadeleştir.
        const depoHatasi =
          axios.isAxiosError(err) && !err.response && videoId != null
            ? "Dosya depoya yüklenemedi (bağlantı kesildi ya da depo erişimi reddedildi). Yeniden dene."
            : null;
        setAsama({ tur: "hata", mesaj: depoHatasi ?? getErrorMessage(err, "Video yüklenemedi.") });
        // Yarım kalan kayıt yeni denemeyi engellemesin.
        if (videoId != null) {
          try {
            await cancelIntroVideoUpload(videoId);
          } catch {
            /* temizlik turu alır */
          }
          yenile(opts.tutorId);
        }
      } finally {
        abortRef.current = null;
        videoIdRef.current = null;
      }
    },
    [opts.maxBytes, opts.maxSeconds, opts.minSeconds, opts.tutorId, yenile]
  );

  const iptal = useCallback(async () => {
    abortRef.current?.abort();
    const id = videoIdRef.current;
    videoIdRef.current = null;
    setAsama({ tur: "bos" });
    if (id != null) {
      try {
        await cancelIntroVideoUpload(id);
      } catch {
        /* temizlik turu alır */
      }
      yenile(opts.tutorId);
    }
  }, [opts.tutorId, yenile]);

  return { asama, yukle, iptal, sifirla };
}

export function useCancelIntroVideo(tutorId?: number) {
  const yenile = useVideoDurumuYenile();
  return useMutation({
    mutationFn: (videoId: number) => cancelIntroVideoUpload(videoId),
    onSuccess: () => yenile(tutorId),
  });
}

export function useRemoveIntroVideo(tutorId?: number) {
  const yenile = useVideoDurumuYenile();
  return useMutation({
    mutationFn: () => removeMyIntroVideo(),
    onSuccess: () => yenile(tutorId),
  });
}

export type { TutorIntroVideoState };
