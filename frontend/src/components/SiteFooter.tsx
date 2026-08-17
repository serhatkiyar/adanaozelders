import { Link } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROUTES } from "@/lib/routes";
import { LEGAL_NAV } from "@/lib/legalNav";

/* ─── ortak site footer'ı ──────────────────────────────────
   Önceden iki ayrı footer vardı (Landing.tsx ve store/StoreLayout.tsx) ve
   PublicShell'de hiç yoktu: yasal sayfalar, SSS, iletişim, eğitmen arama ve
   eğitmen profili footer'sız kalıyordu. iyzico başvurusu footer'da ödeme
   rozetlerini şart koştuğu için tek bir bileşene çıkarıldı.

   Yasal linkler `lib/legalNav.ts`'ten TÜRETİLİR, burada elle liste tutulmaz —
   yeni bir yasal belge eklendiğinde footer kendiliğinden öğrenir. (legalNav
   bilerek hafiftir: metinleri taşıyan `legalContent.ts`'i import etmez, yoksa
   tüm sözleşme metinleri ana bundle'a girerdi.)

   Stil Landing.tsx'teki footer'dan alındı (border-slate-100 / py-10 /
   max-w-[1216px]); mağaza footer'ının `mt-auto w-full`'u korundu çünkü
   StoreLayout dikey flex kolonudur ve onsuz footer yukarı kayar. */

export function SiteFooter() {
  const token = useAuthStore((s) => s.token);
  const { data: user } = useCurrentUser();
  const loggedIn = !!token && !!user;

  const linkCls = "transition hover:text-slate-900 dark:hover:text-white";

  return (
    <footer className="mt-auto w-full border-t border-slate-100 bg-white py-10 dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto max-w-[1216px] px-6">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row sm:items-start">
          <Link to="/" className="flex shrink-0 items-center gap-2 transition hover:opacity-90">
            <img
              src="/logo.png"
              alt="Adana Özel Ders Logo"
              className="h-8 w-auto object-contain opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0 sm:h-10"
            />
          </Link>

          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-slate-500 sm:justify-end dark:text-slate-400">
            {/* Destek: mesafeli satışta erişilebilir iletişim kanalı zorunlu. */}
            <Link to={ROUTES.faq} className={linkCls}>
              SSS
            </Link>
            <Link to={ROUTES.contact} className={linkCls}>
              İletişim
            </Link>

            {/* Yasal belgelerin TAMAMI — tek kaynak lib/legalNav.ts. */}
            {LEGAL_NAV.map((doc) => (
              <Link key={doc.id} to={doc.path} className={linkCls}>
                {doc.title}
              </Link>
            ))}

            {!loggedIn && (
              <>
                <Link to="?modal=login" className={linkCls}>
                  Giriş Yap
                </Link>
                <Link to="?modal=register" className={linkCls}>
                  Kayıt Ol
                </Link>
              </>
            )}
          </nav>
        </div>

        <div className="mt-8 flex flex-col items-center gap-4 border-t border-slate-100 pt-6 text-sm text-slate-500 sm:flex-row sm:justify-between dark:border-slate-800 dark:text-slate-400">
          <p>© {new Date().getFullYear()} Adana Özel Ders. Tüm hakları saklıdır.</p>

          {/* Ödeme rozetleri — iyzico'nun resmî "logo band"i. Tek dosyada
              iyzico + Visa + Mastercard + American Express bulunur (429×32).
              Renkli sürüm açık temada, beyaz sürüm koyu temada okunur.
              TODO: Troy gibi ek kart şeması logoları temin edilirse bu satıra,
              bandın SAĞINA aynı yükseklikte (h-7) eklenir. */}
          <div className="flex items-center gap-3">
            <img
              src="/odeme/iyzico-logo-band.svg"
              alt="iyzico ile güvenli ödeme"
              loading="lazy"
              className="h-7 w-auto max-w-full object-contain dark:hidden"
            />
            <img
              src="/odeme/iyzico-logo-band-white.svg"
              alt="iyzico ile güvenli ödeme"
              loading="lazy"
              className="hidden h-7 w-auto max-w-full object-contain dark:block"
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
