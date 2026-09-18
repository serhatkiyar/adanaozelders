import { Link } from "react-router-dom";
import { ACIKLAMA, DUGME_BIRINCIL, KART } from "@/components/pano/stil";
import { ROUTES } from "@/lib/routes";

/**
 * Hiç dersi olmayan öğrencinin panosu. Görsel yok (mock veri yasağı); tek
 * iddia sunucudan gelen sayıdır — 0 ise o satır hiç çizilmez.
 *
 * Arama sayfasında "ücretsiz ilk ders" filtresi olmadığı için düğme filtre
 * açmaz, yalnız eğitmen listesine gider.
 */
export function KesifKarti({ ucretsizIlkDersSayisi }: { ucretsizIlkDersSayisi: number }) {
  return (
    <section aria-label="Eğitmen bul" className={KART}>
      <h2 className="text-2xl font-bold leading-8 text-slate-900">
        Öğrenmek istediğin konuya bugün başla
      </h2>
      <p className={`mt-2 ${ACIKLAMA}`}>
        Eğitmenleri ders, fiyat ve yorumlarına göre karşılaştır; sana uyanla
        online ya da yüz yüze ders planla.
      </p>
      {ucretsizIlkDersSayisi > 0 && (
        <p className="mt-3 text-base font-semibold leading-6 text-slate-900">
          {ucretsizIlkDersSayisi} eğitmen ilk dersi ücretsiz veriyor.
        </p>
      )}
      <Link to={ROUTES.tutors} className={`mt-6 w-full sm:w-auto ${DUGME_BIRINCIL}`}>
        Eğitmenleri keşfet
      </Link>
    </section>
  );
}
