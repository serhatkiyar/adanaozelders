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
  /** `yenidenDenenebilir`: geçici hata (ağ/depo PUT, 5xx, 408, 429) — aynı
   *  dosya yeniden denenebilir. Ön kontrol ve 4xx reddinde false. */
  | { tur: "hata"; mesaj: string; yenidenDenenebilir: boolean };

/** Hata geçici mi (aynı dosyayla yeniden denemek anlamlı mı)? */
function geciciHataMi(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const status = err.response?.status;
  if (status == null) return true; // ağ kesintisi / depo PUT (CORS) hatası
  return status >= 500 || status === 408 || status === 429;
}

/**
 * Tarayıcıdan depoya doğrudan yükleme durum makinesi:
 * hazırlanıyor → yükleniyor (%) → tamamlanıyor → bitti | hata. İptal, süren
 * PUT'u keser ve sunucudaki kaydı siler.
 */
export function useIntroVideoUpload(opts: {
  maxBytes: number;
  maxSeconds: number;
  minSeconds: number;
  /** Kısa kenar alt sınırı (px); verilmezse istemci bu kuralı sunucuya bırakır. */
  minShortSide?: number;
  tutorId?: number;
}) {
  const [asama, setAsama] = useState<YuklemeAsamasi>({ tur: "bos" });
  const abortRef = useRef<AbortController | null>(null);
  const videoIdRef = useRef<number | null>(null);
  // Geçici hatadan sonra "Aynı videoyu yeniden dene" için son denenen dosya.
  const sonDosyaRef = useRef<File | null>(null);
  const yenile = useVideoDurumuYenile();

  const sifirla = useCallback(() => {
    sonDosyaRef.current = null;
    setAsama({ tur: "bos" });
  }, []);

  const yukle = useCallback(
    async (file: File) => {
      sonDosyaRef.current = null;
      const onHata = dosyaOnKontrol(file, opts.maxBytes);
      if (onHata) {
        setAsama({ tur: "hata", mesaj: onHata, yenidenDenenebilir: false });
        return;
      }
      // Denetleyici en başta kurulur: "Hazırlanıyor" sırasında gelen iptal de
      // akışı durdurur (bölümden ayrılma onayı bunu kullanır).
      const abort = new AbortController();
      abortRef.current = abort;
      setAsama({ tur: "hazirlaniyor" });
      // Erken uyarı (süre, dikey, düşük çözünürlük): sunucu aynı kuralları yine uygular; burada
      // kullanıcıyı 300 MB yüklemeden ÖNCE durdurmak için. Okunamazsa geçilir.
      const erken = videoBilgisiKontrol(await videoBilgisiniOku(file), {
        minSeconds: opts.minSeconds,
        maxSeconds: opts.maxSeconds,
        minShortSide: opts.minShortSide,
      });
      if (abort.signal.aborted) return;
      if (erken) {
        abortRef.current = null;
        setAsama({ tur: "hata", mesaj: erken, yenidenDenenebilir: false });
        return;
      }
      let videoId: number | null = null;
      // İptalden sonra yeni bir yükleme başladıysa bu akış eskidir: ortak
      // ref'lere ve ekrana artık yeni akış sahiptir, eskisi onlara dokunmaz.
      const guncel = () => abortRef.current === abort;
      // Kimlik `iptal`e verildiyse silme onun işidir (ref'i boşaltır).
      let kimlikPaylasildi = false;
      try {
        const init = await startIntroVideoUpload(file);
        videoId = init.video_id;
        if (guncel()) {
          videoIdRef.current = videoId;
          kimlikPaylasildi = true;
        }
        // İptal init sürerken geldiyse kimliği göremedi; aşağıdaki dal siler.
        if (abort.signal.aborted) throw new Error("iptal");
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
          // `iptal` kimliği aldıysa ref'i boşaltıp kendisi siler; ref hâlâ bu
          // kimlikteyse ya da kimlik hiç paylaşılmadıysa iptal kimlik gelmeden
          // gelmiştir: yarım kayıt burada silinir.
          if (videoId != null && (!kimlikPaylasildi || videoIdRef.current === videoId)) {
            try {
              await cancelIntroVideoUpload(videoId);
            } catch {
              /* temizlik turu alır */
            }
            yenile(opts.tutorId);
          }
          if (guncel()) setAsama({ tur: "bos" });
          return;
        }
        // Depoya PUT hatası (CORS/ağ) apiClient'tan geçmez: mesajı sadeleştir.
        const depoHatasi =
          axios.isAxiosError(err) && !err.response && videoId != null
            ? "Dosya depoya yüklenemedi (bağlantı kesildi ya da depo erişimi reddedildi). Yeniden dene."
            : null;
        const yenidenDenenebilir = geciciHataMi(err);
        if (yenidenDenenebilir) sonDosyaRef.current = file;
        setAsama({
          tur: "hata",
          mesaj: depoHatasi ?? getErrorMessage(err, "Video yüklenemedi."),
          yenidenDenenebilir,
        });
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
        if (guncel()) {
          abortRef.current = null;
          videoIdRef.current = null;
        }
      }
    },
    [opts.maxBytes, opts.maxSeconds, opts.minSeconds, opts.minShortSide, opts.tutorId, yenile]
  );

  const iptal = useCallback(async () => {
    sonDosyaRef.current = null;
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

  /** Geçici hatadan sonra aynı dosyayı baştan (yeni init ile) yükler. */
  const yeniden = useCallback(() => {
    const f = sonDosyaRef.current;
    if (f) void yukle(f);
  }, [yukle]);

  return { asama, yukle, iptal, sifirla, yeniden };
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
