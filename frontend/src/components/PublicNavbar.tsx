import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useKayitAcik } from "@/hooks/useKayitAcik";
import { useGirisAdresi } from "@/hooks/useGirisKapisi";

// Anonim (oturumsuz) yüzeyin ortak üst barı — landing'de beğenilen navbar.
// Hem Landing hem PublicShell (public arama/profil) kullanır; böylece sitenin
// tüm oturumsuz sayfalarında aynı büyük logolu sticky navbar görünür.
// `center`: navbar'ın ortasına yerleşen içerik (Landing'de kategori sekmeleri).
// `bottom`: navbar'ın altına yerleşen ikinci satır (Landing'de arama çubuğu).
export function PublicNavbar({
  center,
  bottom,
  expanded = true,
}: {
  center?: ReactNode;
  bottom?: ReactNode;
  /** false iken alt arama satırı yumuşakça katlanır (Landing scroll daralması). */
  expanded?: boolean;
}) {
  const kayitAcik = useKayitAcik();
  // Gercek gezinme (niyet YOK) -> `<Link>` mesru. Adres mevcut sorguyu
  // KORUYARAK uretilir: mağaza/arama sayfasindan "Giris Yap"a basmak
  // kategoriyi ve filtreleri ucurmasin.
  const girisAdresiDegeri = useGirisAdresi();
  const egitmenKayitAdresi = useGirisAdresi("register", "tutor");
  return (
    // Zemin saf beyaz DEĞİL (#fafafa): akıştaki beyaz içerikten ayrışsın (29 Ağu).
    <header className="sticky top-0 z-40 border-b border-slate-100 bg-[#fafafa]/85 backdrop-blur-md ">
      <div className="mx-auto max-w-screen-2xl px-4 md:px-8">
        <div className="flex w-full items-start justify-between gap-4 pt-5 pb-2">
          <div className="flex-1 flex justify-start">
            <Link
              to="/"
              aria-label="Adana Özel Ders ana sayfa"
              className="flex shrink-0 items-center gap-2 transition hover:opacity-90 group"
            >
              {/* Küçük ekranda yazısız (yalnız simge) logo — kategori şeridine yer açar.
                  Eşik `md:` DEĞİL `xl:`: kelime logosu 257.7 px genişliğinde doğuyor ve
                  768-1279 arasında orta sütundaki kategori şeridinin ÜSTÜNE biniyordu
                  (ölçüm: 768'de 146.1 px, 1024'te hâlâ 88.6 px kesişim, yani `lg:`
                  eşiği de çakışmanın içine düşüyor). Kesişimin sıfır olduğu ilk üst
                  nokta 1280'dir.

                  Bu eşik KALICI BİR TASARIM KARARIDIR, kozmetik bir tercih değil:
                  navbar'ın üç sütunlu flex modeli (flex-1 · shrink-0 · flex-1)
                  değişirse eşik yeniden ÖLÇÜLMELİDİR, varsayılmaz. Ölçüm aracı
                  hazır: `node scripts/marka_logo_turu.mjs` (11 genişlik; kabul
                  ölçütü her genişlikte kesişim 0 ve yatay taşma 0).
                  Ayrıntı: docs/magaza-merge-dogrulama-raporu.md */}
              {/* 30 Ağu: telefonda da TAM (yazılı) logo — kategori şeridi <md'de
                  ikinci satıra indiği için üstte çakışacak orta sütun yok.
                  Simge logo yalnız md..xl bandında kalır (yukarıdaki ölçüm). */}
              <img src="/logo-compact.svg" alt="" aria-hidden className="hidden h-8 w-auto object-contain md:block xl:hidden" />
              <img
                src="/logo.svg"
                alt=""
                aria-hidden
                className="block h-8 w-auto object-contain md:hidden xl:block xl:h-9"
              />
            </Link>
          </div>
          {center && (
            <div className="hidden shrink-0 justify-center md:flex">
              {center}
            </div>
          )}
          <div className="flex-1 flex shrink-0 items-center justify-end gap-2">
            {/* ARZ TARAFININ TEK KAPISI — her genişlikte görünür.
                Sitede eğitmen kaydına giden hiçbir bağlantı yoktu; kayıt
                ekranındaki "Eğitmen" sekmesini ancak oraya kendi yolunu bulan
                görüyordu.

                Buraya üçüncü bir düğme sığmıyor: ÖLÇÜLDÜ, varsayılmadı —
                `node scripts/marka_logo_turu.mjs` üç düğmeyle 768px'te 3px
                yatay taşma raporladı (navbar üç sütunlu flex; orta sütundaki
                kategori şeridi 768'de 441px yer kaplıyor). Bu yüzden ayrı
                "Kayıt Ol" düğmesi KALDIRILDI — giriş modalı zaten "Hesabın yok
                mu? Kayıt ol" bağlantısını taşıyor, yani öğrenci kaydı tek
                dokunuş uzakta. Eğitmen kaydının ise başka hiçbir yolu yoktu.
                Düğme sayısı değişirse taşma yeniden ölçülmelidir. */}
            {kayitAcik && (
              <Link
                to={egitmenKayitAdresi}
                className="btn-neon-hover rounded-full px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:text-marka-metin-hover active:scale-95 sm:px-5"
              >
                Ders Ver
              </Link>
            )}
            <Link
              to={girisAdresiDegeri}
              className="btn-neon-hover rounded-full px-3 py-2.5 text-sm sm:px-5 font-semibold text-slate-700 transition hover:text-marka-metin-hover active:scale-95 "
            >
              Giriş Yap
            </Link>
          </div>
        </div>
      </div>
      {center && (
        <div className="flex justify-center overflow-x-auto px-4 pb-3 md:hidden" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          {center}
        </div>
      )}
      {bottom && (
        <div
          className={`overflow-hidden transition-all duration-300 ease-out ${
            expanded ? "max-h-24 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          {bottom}
        </div>
      )}
    </header>
  );
}
