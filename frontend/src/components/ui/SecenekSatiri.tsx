import type { ReactNode } from "react";

import { PlainButton } from "@/components/ui/PlainButton";

/**
 * SEÇENEK SATIRI — TEK STANDART (kullanıcı kararı, 16 Eyl 2026).
 *
 * "Simge + başlık + alt başlık" satırı sitede dört yerde ayrı ayrı yazılmıştı
 * ve her biri kendi ölçüsünü taşıyordu: telefonun adımlı arama yüzeyi 48px
 * kutu / 64px satır, masaüstü seçici paneli önce 16px çıplak ikon sonra 40px
 * kutu / 56px satır, giriş penceresindeki "Eğitmen misin?" 36px kutu.
 * Kullanıcı farkı gördü: *"bir standart olması lazım."*
 *
 * Ölçü BURADA yazılır, başka yerde yazılmaz (ikinci küçültme, 16 Eyl 2026 —
 * kullanıcı: "seçenekler çok kalın, büyükler"):
 *   - Simge kutusu 40px, köşe `rounded-lg`, zemin `slate-100`. Çizgi ikon
 *     20px ve siyah — ikonun kendi sınıfı ne olursa olsun kutu onu 20px'e
 *     çeker (`[&_svg]`), yani ölçü çağıranın eline bırakılmaz. Fotoğraf
 *     kutuyu doldurur (`h-full w-full object-cover`).
 *   - Satır 56px, yatay boşluk 12px, başlık 14px orta ağırlık, alt başlık
 *     12px gri.
 *
 * `h-14` blok akışta sabit yüksekliktir; flex sütunda taban ölçüdür ve
 * `shrink-0` ile küçülmez — telefondaki kart listenin altında kesilir,
 * satırlar cılızlaşmaz (bkz. `AramaAdimlari`).
 *
 * `onMouseDown` varsayılan olarak engellenir: seçici panelleri girdi
 * odağını kaybedince kapanır; engellenmezse tıklama paneli seçim
 * gerçekleşmeden kapatır. Telefonda zararsız.
 */
export const SIMGE_KUTUSU =
  "grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100 text-slate-900 [&_svg]:h-5 [&_svg]:w-5";

export function SecenekSatiri({
  simge,
  baslik,
  altBaslik,
  secili = false,
  onClick,
  className = "",
}: {
  /** Kutunun içeriği: 24px çizgi ikon ya da kutuyu dolduran görsel. Yoksa satır simgesiz çizilir. */
  simge?: ReactNode;
  baslik: string;
  altBaslik?: string;
  /** Seçili satır: başlık koyu, sağda marka renginde onay işareti. */
  secili?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <PlainButton
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-pressed={secili || undefined}
      className={`flex h-14 w-full shrink-0 items-center gap-3 rounded-xl px-2 text-left transition hover:bg-slate-50 active:scale-[0.99] ${className}`}
    >
      {simge && <span className={SIMGE_KUTUSU}>{simge}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{baslik}</span>
        {altBaslik && <span className="block truncate text-xs text-slate-500">{altBaslik}</span>}
      </span>
      {secili && (
        <svg
          className="h-4 w-4 shrink-0 text-marka-metin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L20 7" />
        </svg>
      )}
    </PlainButton>
  );
}
