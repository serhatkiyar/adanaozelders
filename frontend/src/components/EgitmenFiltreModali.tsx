import { useMemo } from "react";

import { FiyatAraligi, useHistogramParametreleri } from "@/components/FiyatAraligi";
import { MesafeSecici } from "@/components/MesafeSecici";
import { SeviyeSecici } from "@/components/SeviyeSecici";
import { useTutorGenderFacets } from "@/hooks/useTutorSearch";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import { useSeviyeSecenekleri } from "@/hooks/useSubjects";
import { EGITMEN_ARAMA } from "@/lib/aramaUrl";
import { bosDeger } from "@/lib/urlSemasi";
import { useKonumStore } from "@/store/konumStore";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Gender } from "@/types";

/**
 * Eğitmen arama filtreleri — İKİ YÜZEYİN ORTAK penceresi.
 *
 * ## Neden ortak (kullanıcı kararı, 9 Eyl 2026)
 *
 * Anonim yüzeyin "Filtrele ve Sırala" düğmesi bir REKLAM TUZAĞIYDI: pencere
 * açılıyor, içinde tek bir filtre olmuyor, yalnız "ücretsiz hesap oluşturun"
 * kartı duruyordu. İşlevsel görünen bir düğme, pazarlama gösteriyordu.
 *
 * "Anonime sade bir alt küme verelim" seçeneği elendi çünkü teknik engeli
 * yok: `/tutors/price-histogram` ve `/tutors/gender-facets` uçlarının
 * hiçbirinde `require_roles` yok — ikisi de anonime açık. Sunucunun bedavaya
 * verdiği sayıları göstermemek bir ürün kararı değil, eksiklik olurdu.
 *
 * Ayrıca bugünkü boş pencere, "ayrı yazılmış ikinci yüzey" yaklaşımının
 * cesediydi: ayrıştı, boşaldı ve kimse fark etmedi.
 *
 * ## Filtre PROP'U ALMAZ
 *
 * Paylaşılan durum URL'dir (`lib/aramaUrl` · `EGITMEN_ARAMA`); bileşen kendi
 * `useAramaDurumu` çağrısını yapar. Böylece iki sayfa aynı adresi okur, aynı
 * adresi yazar ve ayrışamazlar.
 */

/* DERS İŞLEME ŞEKLİ BU PENCEREDE YOK (kullanıcı kararı, 16 Eyl 2026): şekil
   arama hapının kendi adımı, burada ikinci bir yerden değiştirilmesi hapla
   çelişiyordu. */

/* Cinsiyet, Airbnb'nin "Yerin türü" bölmeli seçicisiyle (kullanıcı kararı,
   16 Eyl 2026): Tümü | Kadın | Erkek. "" = filtre yok. Faset sayısı etikete
   eklenir ki seçim yapılmadan kaç eğitmen olduğu görülsün. */
type CinsiyetSecimi = Gender.MALE | Gender.FEMALE | "";
const GENDER_OPTIONS: { value: CinsiyetSecimi; label: string }[] = [
  { value: "", label: "Tümü" },
  { value: Gender.FEMALE, label: "Kadın" },
  { value: Gender.MALE, label: "Erkek" },
];

export function EgitmenFiltreModali({
  acik,
  kapat,
  onTemizle,
}: {
  acik: boolean;
  kapat: () => void;
  /** Sayfanın KENDİ yerel durumu (ör. "daha fazla göster" limiti). */
  onTemizle?: () => void;
}) {
  const { degerler, ayarla } = useAramaDurumu(EGITMEN_ARAMA);
  const unut = useKonumStore((s) => s.unut);

  const { cinsiyet: gender, yakinimda, ders } = degerler;

  // Filtre ÇUBUĞUNDAKİ "Seviye" çipiyle ORTAK hook (bkz. `useSubjects.ts`).
  const seviyeMerdivenleri = useSeviyeSecenekleri(ders);

  /* Fiyat gövdesi ve histogram kümesi `FiyatAraligi`de — şeritteki "Fiyat ⌄"
     açılırıyla ORTAK. Faset yalnız aynı kümeden kendi eksenini düşürür. */
  const histParams = useHistogramParametreleri();
  // Faset KENDİ eksenini saymaz: "Kadın" seçiliyken "Erkek 0" görünürdü ve
  // sayılar seçim yapmayı imkânsız kılardı.
  const fasetParams = useMemo(() => {
    const { gender: _atlandi, ...kalan } = histParams;
    return kalan;
  }, [histParams]);

  const { data: fasetler } = useTutorGenderFacets(fasetParams, acik);

  if (!acik) return null;

  const temizle = () => {
    unut();
    ayarla(bosDeger(EGITMEN_ARAMA));
    onTemizle?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-6">
      <div className="absolute inset-0" onClick={kapat} />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in slide-in-from-bottom-4 duration-200 sm:zoom-in-95">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 ">
          <h2 className="text-lg font-bold text-slate-900 ">Filtrele</h2>
          <button
            onClick={kapat}
            aria-label="Kapat"
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto p-6">
          {/* Mesafe — YALNIZ "Yakınımda" seçiliyken (kullanıcı kararı, 16 Eyl
              2026): konum niyeti arama hapında verilir, bu pencere yalnız
              yarıçapı ayarlar. Yatay sabit seçenekler: Farketmez | 1 | 3 | 5 |
              10 | 15 | 25 km; Farketmez niyeti kaldırır ve bölüm kapanır. */}
          {yakinimda && (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900 ">Mesafe</h3>
            <MesafeSecici
              yaricap={degerler.yaricap}
              sec={(km) => ayarla({ yakinimda: true, yaricap: km })}
              kaldir={() => ayarla({ yakinimda: false, yaricap: undefined })}
            />
          </div>
          )}

          {/* Fiyat aralığı */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 ">Fiyat Aralığı</h3>
            <p className="mb-4 mt-0.5 text-xs text-slate-500 ">Saatlik ders ücreti</p>
            <FiyatAraligi acik={acik} />
          </div>

          {/* Seviye — yalnız tek ders seçiliyken (aksi halde hangi dersin
              seviyesi olduğu belirsiz). */}
          {seviyeMerdivenleri.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900 ">Seviye</h3>
              <p className="mb-4 mt-0.5 text-xs text-slate-500 ">{ders[0]} için</p>
              <SeviyeSecici
                merdivenler={seviyeMerdivenleri}
                secili={degerler.seviye}
                sec={(id) => ayarla({ seviye: id })}
              />
            </div>
          )}

          {/* Eğitmen cinsiyeti — bölmeli seçici */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900 ">Eğitmen cinsiyeti</h3>
            <SegmentedControl<CinsiyetSecimi>
              options={GENDER_OPTIONS.map((opt) => {
                // Sayı, filtre TIKLANMADAN ÖNCE kendini açıklar.
                const adet = opt.value ? fasetler?.[opt.value] : undefined;
                return { value: opt.value, label: adet !== undefined ? `${opt.label} (${adet})` : opt.label };
              })}
              value={gender}
              onChange={(v) => ayarla({ cinsiyet: v })}
            />
            {/* SESSİZ ELEME artık sessiz değil: `gender == FEMALE`
                karşılaştırması hem NULL hem UNSPECIFIED satırları eliyor.
                Yalnız filtre ETKİNKEN gösterilir. */}
            {gender && !!fasetler?.gorunmeyen && (
              <p className="mt-2.5 text-xs leading-relaxed text-slate-500">
                Cinsiyetini belirtmemiş {fasetler.gorunmeyen} eğitmen bu
                filtreyle görünmüyor.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:px-6 sm:py-5">
          <button
            onClick={temizle}
            className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 "
          >
            Temizle
          </button>
          <button
            onClick={kapat}
            className="flex-[2] rounded-xl bg-marka px-4 py-3 text-sm font-semibold text-marka-fg shadow-sm shadow-marka/20 transition hover:bg-marka-hover active:scale-95"
          >
            Sonuçları Göster
          </button>
        </div>
      </div>
    </div>
  );
}
