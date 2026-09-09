import { Link } from "react-router-dom";
import { LEGAL_ROUTES, ROUTES } from "@/lib/routes";
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

/** Sosyal hesaplar — URL'i BOŞ olan çizilmez. Gerçek hesap adresleri
 *  açıldıkça buraya yazılır (uydurma handle koymuyoruz: yanlış hesaba
 *  işaret etmek hiç ikon göstermemekten kötü). */
const SOSYAL_HESAPLAR: { ad: string; url: string; ikon: React.ReactNode }[] = [
  {
    ad: "Instagram",
    url: "https://www.instagram.com/adanaozeldersofficial/",
    ikon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    ad: "TikTok",
    url: "https://www.tiktok.com/@adanaozeldersofficial",
    ikon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.6 3c.4 2 1.7 3.4 3.9 3.6v3c-1.5 0-2.8-.4-3.9-1.2v5.9c0 3.7-2.4 6.1-5.8 6.1-3.2 0-5.5-2.3-5.5-5.3 0-3.4 2.9-5.6 6.3-5.1v3.1c-.3-.1-.7-.2-1.1-.2-1.4 0-2.4 1-2.4 2.3 0 1.4 1 2.3 2.5 2.3 1.7 0 2.9-1.2 2.9-3.4V3h3.1z" />
      </svg>
    ),
  },
  {
    ad: "YouTube",
    url: "https://www.youtube.com/@adanaozeldersofficial",
    ikon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" />
        <path d="M10 9.5v5l4.5-2.5L10 9.5z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    ad: "Facebook",
    url: "https://www.facebook.com/adanaozeldersofficial",
    ikon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.2-1.5 1.5-1.5h1.4V4.9c-.3 0-1.1-.1-2.1-.1-2.1 0-3.6 1.3-3.6 3.7V11H8.3v3h2.4v7h2.8z" />
      </svg>
    ),
  },
  {
    ad: "X",
    url: "https://x.com/adanaozelderstr",
    ikon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.7 3H21l-7.3 8.3L22.2 21h-6.7l-5.3-6.5L4.2 21H1l7.8-8.9L1.8 3h6.9l4.8 5.9L17.7 3zm-1.2 16h1.9L7.6 4.9H5.5L16.5 19z" />
      </svg>
    ),
  },
];

export function SiteFooter() {

  // Telefonda `py-1.5` + `min-h-[36px]`: bu linkler 20px yükseklikte ve 10px
  // aralıkla duruyordu, parmakla yanlış satıra basmak kolaydı. Masaüstünde
  // ölçü değişmez.
  const linkCls = "min-h-[44px] py-2.5 transition hover:text-slate-900 md:min-h-0 md:py-0 ";
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
    <footer className="mt-auto w-full border-t border-slate-100 bg-[#fafafa] ">
      {/* "Başa dön" — Amazon deseni (30 Ağu): yüzen FAB yerine footer'ın hemen
          üstünde tam genişlik şerit. Gerekçe: FAB içerik/aksiyonların üstünde
          yüzüp mobilde parmak alanı çalar; şerit ise tam kullanıcının "sayfa
          bitti, şimdi ne yapacağım" anına yerleşir, layout'la yarışmaz ve tüm
          sayfalarda (ortak footer) kendiliğinden var olur. */}
      <button
        type="button"
        onClick={() => {
          const az = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          window.scrollTo({ top: 0, behavior: az ? "auto" : "smooth" });
        }}
        className="block w-full bg-slate-100 py-3.5 text-center text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
      >
        Başa dön
      </button>
      <div className="mx-auto max-w-[1216px] px-6 py-8 md:py-12">
        <nav
          aria-label="Site bağlantıları"
          className="grid grid-cols-2 gap-x-10 gap-y-8 text-sm text-slate-500 sm:grid-cols-3 sm:gap-x-14"
        >
            {/* 31 Ağu (kullanıcı kararları): Destek EN SOLDA, sonra Hakkımızda.
                Destek linkleri — mesafeli satışta erişilebilir iletişim
                kanalı zorunlu. */}
            <div className="space-y-2.5">
              <p className={baslikCls}>Destek</p>
              {/* Kısa "İletişim" iki uzun satır arasında güdük kalıyordu — en üste. */}
              <Link to={ROUTES.contact} className={`block ${linkCls}`}>
                İletişim
              </Link>
              <Link to={ROUTES.faq} className={`block ${linkCls}`}>
                Sıkça Sorulan Sorular
              </Link>
              <Link to={LEGAL_ROUTES.refund} className={`block ${linkCls}`}>
                Nasıl iade edebilirim
              </Link>
            </div>

            <div className="space-y-2.5">
              <p className={baslikCls}>Hakkımızda</p>
              {hakkimizda && (
                <Link to={hakkimizda.path} className={`block ${linkCls}`}>
                  Biz Kimiz
                </Link>
              )}
              <Link to={ROUTES.blog} className={`block ${linkCls}`}>
                Blog
              </Link>
            </div>

            {/* "Hesap" sütunu KALDIRILDI (31 Ağu): giriş/kayıt navbar'da. */}

            {/* Güvenli ödeme — Trendyol'daki "Güvenli Alışveriş" gibi kendi
                sütununda (iyzico bandı: iyzico+Visa+MC+Amex tek dosyada). */}
            <div className="space-y-2.5">
              <p className={baslikCls}>Güvenli Ödeme</p>
              <img
                src="/odeme/iyzico-logo-band.svg"
                alt="iyzico ile güvenli ödeme"
                loading="lazy"
                className="h-6 w-auto max-w-full object-contain "
              />
            </div>
          </nav>

        {/* Alt bölge — Trendyol deseni (31 Ağu): sosyal ikonlar da BURADA.
            Satır 1: sosyaller (solda). Satır 2: solda telif, sağda yasal. */}
        <div className="mt-10 space-y-4 border-t border-slate-100 pt-6">
          {SOSYAL_HESAPLAR.some((h) => h.url) && (
            <div className="flex items-center gap-4">
              {SOSYAL_HESAPLAR.filter((h) => h.url).map((h) => (
                <a
                  key={h.ad}
                  href={h.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={h.ad}
                  className="flex h-11 w-11 items-center justify-center text-slate-400 transition hover:text-slate-700 md:h-auto md:w-auto"
                >
                  {h.ikon}
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} Adana Özel Ders. Tüm hakları saklıdır.</p>
            <p className="flex flex-wrap items-center gap-x-5 gap-y-1">
              {yasalBelgeler.map((doc) => (
                <Link
                  key={doc.id}
                  to={doc.path}
                  className="inline-flex min-h-[44px] items-center py-2.5 transition hover:text-slate-600 md:min-h-0 md:py-0"
                >
                  {doc.kisaAd}
                </Link>
              ))}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
