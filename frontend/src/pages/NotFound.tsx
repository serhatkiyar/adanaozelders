import { Link } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { ROUTES } from "@/lib/routes";

// Bilinmeyen URL'ler için 404. Tam-ekran, kenardan kenara kedi görseli
// (hafif bulanık + karartılmış); içerik üstte ortalanır. Kart/çerçeve yok,
// shell sarmalaması yok — immersive bir hata ekranı.
//
// `meta={false}`: ekran aynı çizilir ama head'e dokunulmaz. Kök adresi çözen
// istek GEÇİCİ olarak düştüğünde (5xx/ağ) kullanılır — geçerli bir ilan/ders
// sayfasına noindex basılıp dizinden düşürülmesin.
export default function NotFound({ meta = true }: { meta?: boolean } = {}) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {meta && <Seo title="Sayfa bulunamadı" noindex />}

      {/* Kenardan kenara arka plan görseli */}
      <div
        aria-hidden
        className="absolute inset-0 scale-105 bg-cover bg-center blur-[2px]"
        style={{ backgroundImage: "url('/images/404-cat.png')" }}
      />
      {/* Okunabilirlik için karartma örtüsü */}
      <div aria-hidden className="absolute inset-0 bg-slate-950/55" />

      {/* Sol üstte marka logosu — hangi site olduğu belli olsun */}
      <Link
        to={ROUTES.home}
        className="absolute left-4 top-5 z-20 flex items-center transition hover:opacity-90 md:left-8"
      >
        <img
          src="/logo.svg"
          alt="Adana Özel Ders"
          className="h-8 w-auto object-contain drop-shadow-lg md:h-9"
        />
      </Link>

      {/* İçerik */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="text-8xl font-bold tracking-tight text-white drop-shadow-lg sm:text-9xl">
          404
        </p>
        <h1 className="mt-6 text-xl font-medium text-white drop-shadow sm:text-2xl">
          Aradığınız sayfa bulunamadı
        </h1>
        <p className="mt-2 max-w-md text-sm text-slate-200 drop-shadow sm:text-base">
          Bağlantı taşınmış, silinmiş ya da hiç var olmamış olabilir.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to={ROUTES.home}
            className="rounded-xl border border-white/70 bg-white/10 px-6 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            Ana sayfaya dön
          </Link>
          <Link
            to={ROUTES.tutors}
            className="rounded-xl border border-white/70 bg-white/10 px-6 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            Öğretmen ara
          </Link>
        </div>
      </div>
    </div>
  );
}
