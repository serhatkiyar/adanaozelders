import { useLocation } from "react-router-dom";

import { oauthStartUrl, type OAuthMod, type RegisterRole } from "@/api/auth";
import { useGoogleGirisi } from "@/hooks/useOAuthSaglayicilari";
import { donusAdresiUret } from "@/lib/guvenliDonus";
import { useAuthStore } from "@/store/authStore";
import { currentConsentVersion } from "@/lib/legalContent";

/**
 * Google logosu — INLINE SVG.
 *
 * Dış URL'den çekilmiyor: bu depo dış kaynak yüklemeyi KVKK gerekçesiyle
 * kapatmış durumda (`__guards__/disFont.test.ts`) ve CSP `img-src`/`script-src`
 * politikası da buna dayanıyor. Google'ın marka rehberi logonun kendi
 * varlıklarımızla çizilmesine izin veriyor; şart olan orantı ve renkler.
 */
function GoogleLogosu() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="h-[18px] w-[18px] shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

interface Props {
  mod: OAuthMod;
  /** Kayıt akışında hangi tabloya yazılacağı. Otorite, düğmeye basıldığı
   *  ANDAKİ sekme seçimidir; URL'deki `?role=` yalnız başlangıç değeridir. */
  rol?: RegisterRole;
  /** "Beni hatırla" tercihi. Tam sayfa gezinmeden ÖNCE yerele yazılır. */
  hatirla?: boolean;
  /** Kayıt akışında onaylanan yasal metinlerin sürümü (KVKK ispat kaydı). */
  onaySurumu?: string;
  /** Onay kutusu işaretli değilken kayıt akışı başlatılamaz. */
  devreDisi?: boolean;
  className?: string;
}

/**
 * "Google ile devam et" düğmesi.
 *
 * ## Tasarım
 *
 * Nötr: beyaz zemin, ince gri kenarlık, koyu yazı. Marka turuncusu
 * KULLANILMIYOR — ÜK-1'de aksan "birincil eylem" demek ve o rolü sayfanın kendi
 * düğmesi (`bg-marka`) taşıyor. Üçüncü taraf kimlik düğmesi ikinci sırada
 * durmalı; turuncu yapılsaydı aynı ekranda iki birincil eylem olurdu.
 *
 * ## Davranış
 *
 * Tam sayfa gezinme (`window.location.assign`), XHR değil: akış sunucu tarafı
 * yönlendirmedir. Dönüş adresi bulunduğumuz sayfadan üretilir, böylece mağaza
 * ya da ürün sayfasındaki bir kullanıcı girişten sonra oraya döner
 * (`AuthModal`ın "sayfada kal" davranışının OAuth karşılığı).
 */
export function GoogleGirisDugmesi({
  mod,
  rol,
  hatirla = true,
  onaySurumu,
  devreDisi = false,
  className = "",
}: Props) {
  const { acik, startUrl } = useGoogleGirisi();
  const konum = useLocation();
  const setRemember = useAuthStore((s) => s.setRemember);

  if (!acik || !startUrl) return null;

  const basildi = () => {
    // Tercih tam sayfa gezinmeden ÖNCE yerele yazılır: access token'ın
    // localStorage'da mı sessionStorage'da mı duracağını bu belirliyor ve
    // dönüş sayfası token'ı yazarken bayrağın hazır olması gerekiyor.
    setRemember(hatirla);
    window.location.assign(
      oauthStartUrl(startUrl, {
        mod,
        rol,
        hatirla,
        // Onay sürümü HER MODDA gider: giriş akışı da hesap açabiliyor
        // (e-posta hiçbir tabloda yoksa) ve KVKK ispat kaydı orada da gerekli.
        onaySurumu: onaySurumu ?? currentConsentVersion(),
        donus: donusAdresiUret(konum.pathname, konum.search),
      })
    );
  };

  return (
    <button
      type="button"
      onClick={basildi}
      disabled={devreDisi}
      className={`flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      <GoogleLogosu />
      Google ile devam et
    </button>
  );
}

/** Parola formu ile Google düğmesi arasındaki "veya" ayırıcısı. */
export function GirisAyirici() {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-slate-200" />
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
        veya
      </span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

