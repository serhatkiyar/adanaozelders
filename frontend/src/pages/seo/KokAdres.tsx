import { Navigate, useLocation, useParams } from "react-router-dom";

import { FullScreenSpinner } from "@/components/Spinner";
import { useSeoSayfa } from "@/hooks/useSeo";
import { kokAdresBiciminde } from "@/lib/kokAdres";
import { detayDurumu } from "@/lib/seo";
import NotFound from "@/pages/NotFound";
import TutorProfilePage from "@/pages/TutorProfilePage";
import { DersSayfasi } from "@/pages/seo/DersSayfasi";

/**
 * Kök SEO adresleri (Modül 6) — rota tablosunda 404'ten hemen önce.
 *
 *   /:kokSlug              ilan (eğitmen profili) ya da ders sayfası
 *   /:ilce/:dersSayfasi    ilçe + ders sayfası
 *
 * Adresin ne olduğunu sunucu söyler (`GET /seo/sayfa`); istemci tahmin
 * etmez. Biçime uymayan adres (büyük harf, `-ozel-ders` ile bitmeyen iki
 * parçalı yol) sunucuya hiç sorulmadan 404'tür — mevcut 404 davranışı korunur.
 */
export default function KokAdres() {
  const { kokSlug, ilce, dersSayfasi } = useParams();
  const { search } = useLocation();

  const gecerli = kokAdresBiciminde({ kokSlug, ilce, dersSayfasi });
  const yol = kokSlug ? `/${kokSlug}` : `/${ilce}/${dersSayfasi}`;
  const { data, isLoading, isError, error } = useSeoSayfa(yol, gecerli);

  if (!gecerli) return <NotFound />;
  if (isLoading) return <FullScreenSpinner />;
  // noindex YALNIZ sunucu "yok" dediğinde (404); geçici hatada meta basılmaz.
  if (isError || !data)
    return <NotFound meta={detayDurumu({ isLoading, data, error }) === "not_found"} />;
  if (data.tur === "yonlendir") return <Navigate to={data.hedef + search} replace />;
  if (data.tur === "ilan") {
    // `key`: iki ilan arasında gezinirken profil sayfası sıfırdan kurulsun.
    return <TutorProfilePage key={data.tutor_id} tutorId={data.tutor_id} ilanSeo={data} />;
  }
  return <DersSayfasi veri={data} />;
}
