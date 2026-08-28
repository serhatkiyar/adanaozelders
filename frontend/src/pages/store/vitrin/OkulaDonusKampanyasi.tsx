/**
 * Okula Dönüş kampanya sayfası — KODDA YAŞAR (manuel vitrin, bkz. AnaVitrin).
 * Eski CMS'teki yayın içeriği birebir taşındı: başlık + dört kategori kartı.
 * Değişiklik: kullanıcı tarif eder, bu dosya düzenlenir.
 */
import { Link } from "react-router-dom";

import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";

const KARTLAR = [
  { etiket: "Çantalar", gorsel: "/vitrin/kart-cantalar.webp" },
  { etiket: "Suluk", gorsel: "/vitrin/kart-suluk.webp" },
  { etiket: "Beslenme Çantaları", gorsel: "/vitrin/kart-beslenme.webp" },
  { etiket: "Resim Malzemeleri", gorsel: "/vitrin/kart-resim-malzemeleri.webp" },
];

export default function OkulaDonusKampanyasi() {
  return (
    <StoreLayout title="Okula Dönüş Kampanyası">
      <Seo
        title="Okula Dönüş Kampanyası"
        description="Okula dönüş sezonunda çanta, suluk, beslenme çantası ve kırtasiye ürünleri."
        canonicalPath="/magaza/okula-donus"
      />
      <div className="mx-auto w-full max-w-[1464px] px-4 py-8 md:px-8">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F1111]">
          Okula Dönüş Kampanyası
        </h1>
        <section aria-label="Kategoriler" className="mt-6">
          <h2 className="text-[21px] font-bold leading-[27px] text-[#0F1111]">Kategoriler</h2>
          <div className="mt-4 grid grid-cols-2 gap-5 md:grid-cols-4">
            {KARTLAR.map((kart) => (
              <div key={kart.etiket} className="bg-white p-4 shadow-[0_2px_5px_rgba(15,17,17,0.08)]">
                <div className="aspect-square overflow-hidden bg-white">
                  <img src={kart.gorsel} alt={kart.etiket} loading="lazy" className="h-full w-full object-cover" />
                </div>
                <p className="mt-2 text-[13px] leading-[17px] text-[#0F1111]">{kart.etiket}</p>
              </div>
            ))}
          </div>
        </section>
        <p className="mt-8 text-sm text-slate-500">
          Tüm ürünlere göz atmak için{" "}
          <Link to="/magaza" className="text-[#007185] hover:text-[#C7511F] hover:underline">
            mağazaya dönün
          </Link>
          .
        </p>
      </div>
    </StoreLayout>
  );
}
