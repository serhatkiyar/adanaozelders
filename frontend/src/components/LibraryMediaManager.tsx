import { useRef, useState } from "react";
import { useLibraryAdminDetail, useLibraryMedia } from "@/hooks/useLibraries";
import { ImageCropModal } from "@/components/ImageCropModal";
import { toast } from "@/store/toastStore";
import { getErrorMessage } from "@/lib/errors";
import type { LibraryImageOut } from "@/types";

// Kırpma ayarları: logo kare (1:1, 512×512), banner geniş (16:9, 1600×900).
const CROP_PRESET = {
  logo: { aspect: 1, w: 512, h: 512, title: "Logoyu kırp (kare)" },
  cover: { aspect: 16 / 9, w: 1600, h: 900, title: "Kapağı kırp (16:9)" },
} as const;

type CropKind = keyof typeof CROP_PRESET;

/**
 * Kütüphane görsel yönetimi (admin küratör): kurumsal logo (1:1), geniş kapak/banner
 * (16:9) ve galeri (çoklu yükleme + sil + sıra değiştir). Görseller backend'de WebP'ye
 * optimize edilip MinIO'ya yüklenir; DB'de yalnız URL tutulur.
 *
 * Yalnız KAYITLI kütüphane için çalışır (yükleme library id gerektirir) — yeni kayıt
 * önce kaydedilmeli.
 */
export function LibraryMediaManager({ libraryId }: { libraryId: number }) {
  const { data: lib, isLoading } = useLibraryAdminDetail(libraryId);
  const { uploadLogo, uploadCover, uploadImages, removeImage, reorder } =
    useLibraryMedia(libraryId);
  // Kırpma akışı: dosya seçilince doğrudan yüklemek yerine kırpma penceresi açılır.
  const [crop, setCrop] = useState<{ kind: CropKind; src: string } | null>(null);

  const onError = (e: unknown) =>
    toast.error(getErrorMessage(e, "Görsel işlemi başarısız."));

  if (isLoading || !lib) {
    return (
      <div className="h-32 animate-pulse rounded-xl bg-slate-100 " />
    );
  }

  const images = lib.images ?? [];

  const openCrop = (kind: CropKind, file: File) =>
    setCrop({ kind, src: URL.createObjectURL(file) });

  const closeCrop = () => {
    if (crop) URL.revokeObjectURL(crop.src);
    setCrop(null);
  };

  const onCropDone = (blob: Blob) => {
    if (!crop) return;
    const file = new File([blob], `${crop.kind}.webp`, { type: "image/webp" });
    const mutation = crop.kind === "logo" ? uploadLogo : uploadCover;
    mutation.mutate(file, {
      onSuccess: () => {
        toast.success(crop.kind === "logo" ? "Logo güncellendi." : "Kapak güncellendi.");
        closeCrop();
      },
      onError,
    });
  };

  const cropBusy = uploadLogo.isPending || uploadCover.isPending;

  const move = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= images.length) return;
    const ids = images.map((im) => im.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    reorder.mutate(ids, { onError });
  };

  return (
    <div className="space-y-5">
      {/* Logo + Banner yan yana */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SingleImageField
          label="Logo (1:1)"
          hint="Kurum amblemi · kare"
          url={lib.logo_url ?? null}
          rounded="rounded-2xl"
          aspect="aspect-square"
          busy={uploadLogo.isPending}
          onPick={(f) => openCrop("logo", f)}
        />
        <SingleImageField
          label="Kapak / Banner (16:9)"
          hint="İç mekândan geniş kare"
          url={lib.cover_url ?? null}
          rounded="rounded-2xl"
          aspect="aspect-video"
          busy={uploadCover.isPending}
          onPick={(f) => openCrop("cover", f)}
        />
      </div>

      {/* Galeri */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700 ">
            Galeri ({images.length})
          </span>
          <GalleryAddButton
            busy={uploadImages.isPending}
            onPick={(files) =>
              uploadImages.mutate(files, {
                onSuccess: () =>
                  toast.success(`${files.length} fotoğraf eklendi.`),
                onError,
              })
            }
          />
        </div>

        {images.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-xs text-slate-400 ">
            Henüz galeri fotoğrafı yok. Çalışma salonu, kafeterya, giriş…
            fotoğraflarını ekleyin.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {images.map((im, i) => (
              <GalleryThumb
                key={im.id}
                image={im}
                isFirst={i === 0}
                isLast={i === images.length - 1}
                onMoveLeft={() => move(i, -1)}
                onMoveRight={() => move(i, 1)}
                onDelete={() =>
                  removeImage.mutate(im.id, {
                    onSuccess: () => toast.success("Fotoğraf silindi."),
                    onError,
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {crop && (
        <ImageCropModal
          imageSrc={crop.src}
          aspectRatio={CROP_PRESET[crop.kind].aspect}
          outputWidth={CROP_PRESET[crop.kind].w}
          outputHeight={CROP_PRESET[crop.kind].h}
          title={CROP_PRESET[crop.kind].title}
          isUploading={cropBusy}
          onCropComplete={onCropDone}
          onClose={closeCrop}
        />
      )}
    </div>
  );
}

/* ── Tekil görsel (logo/banner) ── */

function SingleImageField({
  label,
  hint,
  url,
  rounded,
  aspect,
  busy,
  onPick,
}: {
  label: string;
  hint: string;
  url: string | null;
  rounded: string;
  aspect: string;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-slate-700 ">
        {label}
      </p>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className={`group relative w-full overflow-hidden ${aspect} ${rounded} bg-slate-100 ring-1 ring-slate-200 transition hover:ring-indigo-400 disabled:opacity-60 `}
      >
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-400">
            <span className="text-2xl">🖼️</span>
            <span className="text-[11px]">{hint}</span>
          </div>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-slate-900/60 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
          {busy ? "Yükleniyor…" : url ? "Değiştir" : "Yükle"}
        </span>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ── Galeri ekle butonu (çoklu) ── */

function GalleryAddButton({
  busy,
  onPick,
}: {
  busy: boolean;
  onPick: (files: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60 "
      >
        {busy ? "Yükleniyor…" : "+ Fotoğraf"}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onPick(files);
          e.target.value = "";
        }}
      />
    </>
  );
}

/* ── Galeri küçük resmi ── */

function GalleryThumb({
  image,
  isFirst,
  isLast,
  onMoveLeft,
  onMoveRight,
  onDelete,
}: {
  image: LibraryImageOut;
  isFirst: boolean;
  isLast: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative aspect-video overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200 ">
      <img src={image.url} alt="" className="h-full w-full object-cover" />
      <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-slate-900/50 opacity-0 transition group-hover:opacity-100">
        <ThumbBtn label="◀" disabled={isFirst} onClick={onMoveLeft} title="Sola al" />
        <ThumbBtn
          label="🗑"
          onClick={onDelete}
          title="Sil"
          danger
        />
        <ThumbBtn label="▶" disabled={isLast} onClick={onMoveRight} title="Sağa al" />
      </div>
    </div>
  );
}

function ThumbBtn({
  label,
  onClick,
  disabled,
  title,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shadow transition disabled:opacity-30 ${
        danger
          ? "bg-rose-500 text-white hover:bg-rose-600"
          : "bg-white text-slate-700 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );
}
