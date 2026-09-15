import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/axios";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

/**
 * Profil fotoğrafı yükleme/silme + kırpma akışı (ortak).
 *
 * Tek kaynak: dosya seç → `cropImageSrc` (object URL) → ImageCropModal → webp blob
 * → `/auth/me/avatar`. Tüketen bileşen gizli `<input type=file onChange={onFileSelect}>`
 * ve `cropImageSrc` varsa `<ImageCropModal .../>` render eder; `me` cache'i tazelenir.
 */
export function useAvatarUpload() {
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  const uploadAvatar = useMutation({
    mutationFn: async (blob: Blob) => {
      const formData = new FormData();
      formData.append("file", blob, "avatar.webp");
      // FormData'da Content-Type ELLE YAZILMAZ; doğru sentinel `false`.
      // Gerekçesi `api/store.ts`teki MULTIPART yorumunda ölçümle yazılı:
      // sabit "multipart/form-data" boundary'siz gidiyor, `undefined` axios
      // tarafından x-www-form-urlencoded'a çevriliyor, header'ı silmek ise
      // instance varsayılanı application/json'u devreye sokup FormData'yı
      // JSON'a çevirerek dosya içeriğini YOK EDİYOR.
      const { data } = await apiClient.post("/auth/me/avatar", formData, {
        headers: { "Content-Type": false as const },
      });
      return data;
    },
    onSuccess: () => {
      toast.success("Profil fotoğrafı güncellendi.");
      queryClient.refetchQueries({ queryKey: ["me"] });
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, "Fotoğraf yüklenemedi."));
    },
    onSettled: () => {
      setIsUploading(false);
      setCropImageSrc((src) => {
        if (src) URL.revokeObjectURL(src);
        return null;
      });
    },
  });

  const deleteAvatar = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.delete("/auth/me/avatar");
      return data;
    },
    onSuccess: () => {
      toast.success("Profil fotoğrafı silindi.");
      queryClient.refetchQueries({ queryKey: ["me"] });
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, "Fotoğraf silinemedi."));
    },
  });

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // aynı dosya tekrar seçilebilsin
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Dosya boyutu 5MB'dan küçük olmalıdır.");
      return;
    }
    setCropImageSrc(URL.createObjectURL(file));
  }, []);

  const onCropComplete = useCallback(
    (blob: Blob) => {
      setIsUploading(true);
      uploadAvatar.mutate(blob);
    },
    [uploadAvatar]
  );

  const onCropClose = useCallback(() => {
    setCropImageSrc((src) => {
      if (src) URL.revokeObjectURL(src);
      return null;
    });
  }, []);

  return {
    isUploading,
    cropImageSrc,
    onFileSelect,
    onCropComplete,
    onCropClose,
    deleteAvatar,
  };
}
