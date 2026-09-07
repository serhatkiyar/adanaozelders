import { useRef } from "react";

import { ImageCropModal } from "@/components/ImageCropModal";
import { PlainButton } from "@/components/ui/PlainButton";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";

import { SegmentSecim } from "@/components/form/alanlar";
import { Gender } from "@/types";

import { SECILI_SEGMENT } from "../tema";
import { TanitimVideosu } from "./Metinler";
import type { AdimProps } from "./ortak";

/** Sıra bilinçli: "Belirtmek istemiyorum" bir KAÇIŞ değil, geçerli bir cevap. */
const CINSIYETLER = [
  { deger: Gender.FEMALE, etiket: "Kadın" },
  { deger: Gender.MALE, etiket: "Erkek" },
  { deger: Gender.UNSPECIFIED, etiket: "Belirtmek istemiyorum" },
] as const;

/**
 * Adım 7 — profil fotoğrafı (ve isteğe bağlı tanıtım videosu).
 *
 * Fotoğraf `PATCH /tutors/me` ile DEĞİL, `useAvatarUpload` üzerinden kendi
 * ucuna yazılır; hesabın avatarı ilanın bir alanı değil, kullanıcının kendi
 * alanıdır ve sihirbaz dışında da aynı yerden güncellenir.
 */
export function AdimFotograf(props: AdimProps) {
  const { d, dis, guncelle } = props;
  const girdiRef = useRef<HTMLInputElement>(null);
  const {
    isUploading,
    cropImageSrc,
    onFileSelect,
    onCropComplete,
    onCropClose,
    deleteAvatar,
  } = useAvatarUpload();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-5">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100">
          {dis.avatarUrl ? (
            <img
              src={dis.avatarUrl}
              alt="Profil fotoğrafın"
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-slate-300"
              aria-hidden="true"
            >
              <svg
                className="h-10 w-10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 1115 0"
                />
              </svg>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <input
            ref={girdiRef}
            type="file"
            accept="image/*"
            onChange={onFileSelect}
            className="sr-only"
            aria-label="Profil fotoğrafı seç"
          />
          <PlainButton
            onClick={() => girdiRef.current?.click()}
            disabled={isUploading}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-300 px-4 text-[14px] font-medium text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
          >
            {isUploading
              ? "Yükleniyor…"
              : dis.avatarUrl
                ? "Fotoğrafı değiştir"
                : "Fotoğraf yükle"}
          </PlainButton>
          {dis.avatarUrl && (
            <PlainButton
              onClick={() => deleteAvatar.mutate()}
              className="ml-2 inline-flex min-h-[44px] items-center rounded-xl px-3 text-[14px] font-medium text-slate-400 transition hover:text-rose-600"
            >
              Kaldır
            </PlainButton>
          )}
          <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
            JPEG veya PNG, en fazla 5 MB. Yükledikten sonra kırpabilirsin.
          </p>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-7" data-alan="cinsiyet">
        <SegmentSecim
          aktifSinif={SECILI_SEGMENT}
          etiket="Cinsiyetin (isteğe bağlı)"
          ipucu="İlanında görünür ve öğrenciler ona göre filtreleyebilir. Boş bırakırsan cinsiyet filtresi kullanan aramalarda ilanın çıkmaz."
          deger={d.gender}
          onChange={(v) => guncelle({ gender: v as Gender | "" })}
          secenekler={CINSIYETLER}
        />
      </div>

      <div className="border-t border-slate-100 pt-7">
        <TanitimVideosu {...props} />
      </div>

      {cropImageSrc && (
        <ImageCropModal
          imageSrc={cropImageSrc}
          onCropComplete={onCropComplete}
          onClose={onCropClose}
          isUploading={isUploading}
        />
      )}
    </div>
  );
}
