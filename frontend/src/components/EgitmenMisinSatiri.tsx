import { SIMGE_KUTUSU } from "@/components/ui/SecenekSatiri";

/**
 * "Eğitmen misin?" satırı — giriş ve ÜYE KAYIT pencerelerinin ORTAK alt
 * satırı (kullanıcı kararı, 16 Eyl 2026: kayıt penceresindeki "Üye olarak
 * kaydoluyorsun · Eğitmen olarak kaydol" metin satırı kalktı, yerine giriş
 * penceresindeki resimli satır geldi). Gerekçe `AuthModal`daki notta:
 * renk (nötr), geometri (saç teli çizgi + simge·başlık·alt başlık·ok) ve dil
 * (soru formu kendi kendini eler) ile birincil formdan ayrışır.
 *
 * Görsel kategori şeridindeki "Eğitmenler" ile AYNI kaynak; kutu ölçüsü
 * sitenin tek seçenek satırı standardından (`SIMGE_KUTUSU`).
 */
export function EgitmenMisinSatiri({ onSec }: { onSec: () => void }) {
  return (
    <div className="mt-5 border-t border-slate-200 pt-3">
      <button
        type="button"
        onClick={onSec}
        className="flex w-full items-center gap-4 rounded-xl px-1 py-2 text-left transition hover:bg-slate-50 active:scale-[0.99]"
      >
        <span className={SIMGE_KUTUSU}>
          <img
            src="/icons/egitmen-misin.webp"
            alt=""
            aria-hidden
            width={48}
            height={48}
            decoding="async"
            className="h-full w-full object-contain"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">Öğretmen misin?</span>
          <span className="block text-xs text-slate-500">İlanını oluştur, öğrencilerle buluş</span>
        </span>
        <svg
          className="h-5 w-5 shrink-0 text-slate-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
