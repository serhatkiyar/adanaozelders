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

  const linkCls = "transition hover:text-slate-900 ";
  const baslikCls = "text-sm font-semibold text-slate-900";

  // 29 Ağu (3. tur, kullanıcı kararı): footer'da SEKİZ sözleşme DEĞİL,
  // Amazon paritesinde ÜÇ link durur (Kullanım Koşulları · Gizlilik · Çerez).
  // Diğer belgeler footer'a bağımlı değildir: ödeme/kayıt akışları ilgili
  // sözleşmeyi kendi adımında linkler, tümü kendi sayfalarında yaşar.
  const hakkimizda = LEGAL_NAV.find((doc) => doc.id === "about");
  // Airbnb'deki gibi KISA adlarla, telif satırının içinde "·" ayraçlı.
  const FOOTER_YASAL: { id: string; kisaAd: string }[] = [
    { id: "privacy", kisaAd: "Gizlilik" },
    { id: "terms", kisaAd: "Şartlar" },
    { id: "cookies", kisaAd: "Çerezler" },
  ];
  const yasalBelgeler = FOOTER_YASAL.map(({ id, kisaAd }) => ({
    ...LEGAL_NAV.find((d) => d.id === id)!,
    kisaAd,
  }));

  return (
    // Zemin saf beyaz DEĞİL (#fafafa): akıştaki beyaz içerikten ayrışsın (29 Ağu).
    <footer className="mt-auto w-full border-t border-slate-100 bg-[#fafafa] py-12 ">
      <div className="mx-auto max-w-[1216px] px-6">
        <nav
          aria-label="Site bağlantıları"
          className="grid grid-cols-2 gap-x-10 gap-y-8 text-sm text-slate-500 sm:gap-x-14"
        >
            <div className="space-y-2.5">
              <p className={baslikCls}>Kurumsal</p>
              {hakkimizda && (
                <Link to={hakkimizda.path} className={`block ${linkCls}`}>
                  {hakkimizda.title}
                </Link>
              )}
              <Link to={ROUTES.blog} className={`block ${linkCls}`}>
                Blog
              </Link>
              {/* Destek: mesafeli satışta erişilebilir iletişim kanalı zorunlu. */}
              <Link to={ROUTES.faq} className={`block ${linkCls}`}>
                SSS
              </Link>
              <Link to={ROUTES.contact} className={`block ${linkCls}`}>
                İletişim
              </Link>
            </div>

            {!loggedIn && (
              <div className="space-y-2.5">
                <p className={baslikCls}>Hesap</p>
                <Link to="?modal=login" className={`block ${linkCls}`}>
                  Giriş Yap
                </Link>
                <Link to="?modal=register" className={`block ${linkCls}`}>
                  Kayıt Ol
                </Link>
              </div>
            )}
          </nav>

        {/* Logo + ödeme rozetleri — ayırıcı ÇİZGİNİN ÜSTÜNDE (Amazon deseni).
            iyzico bandı logodan bir tık KÜÇÜK (h-6 < h-7) durur.
            Band tek dosyada iyzico + Visa + Mastercard + Amex taşır (429×32);
            Troy vb. eklenecekse bandın SAĞINA aynı yükseklikte gelir. */}
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <Link to="/" className="shrink-0 transition hover:opacity-90">
            <img
              src="/logo.svg"
              alt="Adana Özel Ders Logo"
              className="h-7 w-auto object-contain opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0"
            />
          </Link>
          <img
            src="/odeme/iyzico-logo-band.svg"
            alt="iyzico ile güvenli ödeme"
            loading="lazy"
            className="h-6 w-auto max-w-full object-contain "
          />
        </div>

        {/* Çizginin ALTINDA, Amazon'un alt şeridi gibi iki ortalı satır:
            önce yasal linkler, en altta telif. */}
        <div className="mt-6 border-t border-slate-100 pt-6 text-center text-xs text-slate-400">
          <p className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            {yasalBelgeler.map((doc) => (
              <Link key={doc.id} to={doc.path} className="transition hover:text-slate-600">
                {doc.kisaAd}
              </Link>
            ))}
          </p>
          <p className="mt-2.5">© {new Date().getFullYear()} Adana Özel Ders. Tüm hakları saklıdır.</p>
        </div>
      </div>
    </footer>
  );
}
