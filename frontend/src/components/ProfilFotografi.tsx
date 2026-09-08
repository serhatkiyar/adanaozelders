import { createPortal } from "react-dom";
import { ImageCropModal } from "@/components/ImageCropModal";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Profil fotoğrafı — göster / değiştir / kaldır.
 *
 * İKİ yüzey kullanıyor: eğitmenin ilan sayfası (`TutorSettings`) ve yöneticinin
 * profil ekranı (`Profile`). Bileşen eskiden `Profile` içinde yerel bir bloktu;
 * fotoğraf eğitmenin İLANINA taşınınca (kullanıcı kararı, 8 Eyl 2026 — Hesabım
 * sekmesi kalktı) kopyalanmak yerine buraya çıkarıldı.
 *
 * Kırpma penceresi `createPortal` ile `body`ye taşınır: `TutorSettings` panel
 * kabuğunun içinde çiziliyor ve kabuğun yapışkan başlık yığını `backdrop-blur`
 * taşıyor — blur'lu bir ata, içindeki `position: fixed` katmanı kendi kutusuna
 * hapseder ve pencere ekranın ortasına değil formun içine düşer.
 */
export function ProfilFotografi({
  duzenlenebilir = true,
  boyutClass = "h-20 w-20",
}: {
  duzenlenebilir?: boolean;
  boyutClass?: string;
}) {
  const { data: user } = useCurrentUser();
  const avatar = useAvatarUpload();

  if (!user) return null;

  const gorsel = user.avatar_url ? (
    <img
      src={user.avatar_url}
      alt={user.full_name}
      className={`${boyutClass} rounded-full object-cover ring-1 ring-slate-200`}
    />
  ) : (
    <div
      className={`${boyutClass} flex items-center justify-center rounded-full bg-slate-100 text-2xl font-bold text-slate-500 ring-1 ring-slate-200`}
    >
      {user.first_name?.[0]?.toUpperCase() ?? "?"}
    </div>
  );

  return (
    <>
      <div className="relative shrink-0">
        {duzenlenebilir ? (
          <label
            className={`group relative block cursor-pointer ${boyutClass}`}
            title="Profil fotoğrafını değiştir"
          >
            {gorsel}
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
              </svg>
              <span className="text-[9px] font-bold uppercase tracking-wide">Değiştir</span>
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={avatar.onFileSelect}
            />
          </label>
        ) : (
          gorsel
        )}

        {duzenlenebilir && user.avatar_url && (
          <button
            type="button"
            onClick={() => avatar.deleteAvatar.mutate()}
            disabled={avatar.deleteAvatar.isPending}
            title="Profil fotoğrafını kaldır"
            aria-label="Profil fotoğrafını kaldır"
            className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-500 shadow ring-1 ring-slate-200 transition hover:text-rose-600 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {avatar.cropImageSrc &&
        createPortal(
          <ImageCropModal
            imageSrc={avatar.cropImageSrc}
            onCropComplete={avatar.onCropComplete}
            onClose={avatar.onCropClose}
            isUploading={avatar.isUploading}
          />,
          document.body
        )}
    </>
  );
}
