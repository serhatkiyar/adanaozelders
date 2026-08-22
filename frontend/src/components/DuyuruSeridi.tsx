import { useLocation } from "react-router-dom";

import { useAktifDuyuru } from "@/hooks/useDuyuru";
import { PATHS } from "@/lib/routes";
import type { DuyuruVaryant } from "@/types";

/**
 * Storefront'un TEPESİNDEKİ tek yatay duyuru şeridi (İP-C2).
 *
 * ## Konum sözleşmesi (kritik)
 *
 * Bu bileşen `App.tsx`de `<BrowserRouter>`in İÇİNDE ama routed sayfa
 * içeriğinin (dolayısıyla `PublicNavbar`/`DashboardHeader`in `sticky top-0`
 * konteynerinin) DIŞINDA ve ÖNÜNDE render edilir — normal belge akışında
 * durur, sticky DEĞİLDİR. Aşağı kaydırınca şerit yukarı kayıp kaybolur,
 * navbar kendi sticky davranışıyla tepeye yapışır. Geri gelmez.
 *
 * ## Kapatılamaz
 *
 * Kapatma düğmesi yok, localStorage yok — panel dışındaki HER sayfada,
 * uygun bir kayıt olduğu sürece gösterilir.
 *
 * ## Panel'de görünmez
 *
 * `/yonetim` (ADMIN paneli) kendi ayrı `h-dvh` kabuğunu kullanır ve genel
 * site akışının parçası değildir; bileşen kendi rotasını denetler ki App.tsx
 * çağrı yerinde unutulabilecek bir koşula ihtiyaç duyulmasın.
 */
const VARYANT_SINIF: Record<DuyuruVaryant, string> = {
  // Düzeltme turu (Ç-3 kapanış): zemin lacivert OLAMAZ — karar "nötr yüzey +
  // lacivert aksan"dır, `#1A365D` etkin gezinme/odak/birincil düğme rengidir,
  // dolu bir zemin değil. Panelin kendi nötr yüzey token'ları kullanılır
  // (`docs/tasarim-dili.md` §1.2); `dark:` ikizi yazılmaz, token temaya zaten
  // duyarlı. Aksan solda 3px dikey kenarlıkla girer.
  bilgi:
    "border-b border-b-panel-border border-l-[3px] border-l-panel-accent " +
    "bg-panel-surface text-panel-fg",
  // `#F6AD55` dikkat rengi — aksan değil, DOĞRUDAN zemin. Amber açık bir ton
  // olduğundan her iki temada da koyu metin gerekir. Düzeltme turunda
  // BİLİNÇLİ OLARAK değişmedi: turuncu zaten dolu zemin olarak kullanılmak
  // içindir, istisna burada değil.
  dikkat: "bg-[#F6AD55] text-[#3D2200] dark:bg-[#F6AD55] dark:text-[#3D2200]",
};

const LINK_SINIFI: Record<DuyuruVaryant, string> = {
  // Zemin nötr olduğundan link artık aksan rengiyle (`panel-accent`) kendini
  // metinden ayırır; eski beyaz/koyu-lacivert dekorasyon renkleri zeminle
  // birlikte anlamsızlaştı. Odak halkası da aynı sebeple `ring-panel-focus`a
  // taşındı — eski `outline-white` yeni beyaza-yakın zeminde görünmezdi.
  bilgi:
    "text-panel-accent underline underline-offset-2 decoration-panel-accent/70 " +
    "hover:decoration-panel-accent focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-panel-focus focus-visible:ring-offset-2 " +
    "focus-visible:ring-offset-panel-surface",
  dikkat:
    "underline underline-offset-2 decoration-[#3D2200]/70 hover:decoration-[#3D2200] " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "focus-visible:outline-[#3D2200]",
};

export function DuyuruSeridi() {
  const location = useLocation();
  const { data } = useAktifDuyuru();

  if (location.pathname.startsWith(PATHS.admin)) return null;
  if (!data) return null;

  return (
    <div
      role="region"
      aria-label="Duyuru"
      data-varyant={data.varyant}
      className={`w-full px-4 py-2 text-center text-sm font-medium ${VARYANT_SINIF[data.varyant]}`}
    >
      <p className="mx-auto max-w-screen-2xl leading-snug">
        {/* `data-duyuru-metin`/`data-duyuru-link`: kontrast ölçüm scripti
            (scripts/duyuru_kontrast_cls.mjs) metin ile linkin glyph
            kutularını AYRI hedefler — ikisinin zemine karşı kontrastı
            bağımsız ölçülür. */}
        <span data-duyuru-metin>{data.metin}</span>
        {data.link_url && data.link_metni && (
          <a
            data-duyuru-link
            href={data.link_url}
            className={`ml-2 rounded-sm font-semibold ${LINK_SINIFI[data.varyant]}`}
          >
            {data.link_metni}
          </a>
        )}
      </p>
    </div>
  );
}
