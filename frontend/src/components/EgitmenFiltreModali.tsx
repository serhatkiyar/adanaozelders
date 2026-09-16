import { useEffect, useMemo, useState } from "react";

import { PriceRangeHistogram } from "@/components/PriceRangeHistogram";
import {
  useTutorGenderFacets,
  useTutorPriceHistogram,
} from "@/hooks/useTutorSearch";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import {
  EGITMEN_ARAMA,
  VARSAYILAN_YARICAP_KM,
  egitmenIstegi,
} from "@/lib/aramaUrl";
import { bosDeger } from "@/lib/urlSemasi";
import { useKonumStore } from "@/store/konumStore";
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

const GENDER_OPTIONS: { value: Gender.MALE | Gender.FEMALE; label: string }[] = [
  { value: Gender.FEMALE, label: "Kadın" },
  { value: Gender.MALE, label: "Erkek" },
];

/** Kutu metni ↔ şema değeri: boş kutu = filtre YOK, "0" geçerli alt sınır. */
const sayiMetni = (n: number | undefined) => (n === undefined ? "" : String(n));
const metinSayisi = (t: string): number | undefined => {
  const kirpik = t.trim();
  if (!kirpik) return undefined;
  const n = Number(kirpik);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

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
  const { konum, yukleniyor, iste, unut } = useKonumStore();

  const { cinsiyet: gender, yakinimda } = degerler;
  const radiusKm = degerler.yaricap ?? VARSAYILAN_YARICAP_KM;

  // Fiyat kutusunun anlık metni YEREL, değeri adreste: her sürüklemede adres
  // yazmak geçmişi kirletir.
  const [minRate, setMinRate] = useState(sayiMetni(degerler.minFiyat));
  const [maxRate, setMaxRate] = useState(sayiMetni(degerler.maxFiyat));

  // Adres → kutu (geri tuşu, paylaşılan bağlantı, "Temizle").
  useEffect(() => {
    setMinRate((o) => (metinSayisi(o) === degerler.minFiyat ? o : sayiMetni(degerler.minFiyat)));
    setMaxRate((o) => (metinSayisi(o) === degerler.maxFiyat ? o : sayiMetni(degerler.maxFiyat)));
  }, [degerler.minFiyat, degerler.maxFiyat]);

  /*
   * Histogram ve fasetler, SONUÇ LİSTESİYLE AYNI kümeyi ölçmeli — yoksa
   * çubuklar listede olmayan eğitmenleri sayar. Küme elle ikinci kez
   * kurulmuyor, listenin isteğinden ÇIKARILARAK türetiliyor.
   */
  const istek = useMemo(
    () => egitmenIstegi(degerler, { konumum: konum }),
    [degerler, konum]
  );
  const histParams = useMemo(() => {
    const {
      sort: _sort,
      exam: _exam,
      limit: _limit,
      offset: _offset,
      min_rate: _min,
      max_rate: _max,
      ...rest
    } = istek;
    return rest;
  }, [istek]);
  // Faset KENDİ eksenini saymaz: "Kadın" seçiliyken "Erkek 0" görünürdü ve
  // sayılar seçim yapmayı imkânsız kılardı.
  const fasetParams = useMemo(() => {
    const { gender: _atlandi, ...kalan } = histParams;
    return kalan;
  }, [histParams]);

  const { data: rateDist, isLoading: histLoading } = useTutorPriceHistogram(
    histParams,
    acik
  );
  const { data: fasetler } = useTutorGenderFacets(fasetParams, acik);

  if (!acik) return null;

  const temizle = () => {
    setMinRate("");
    setMaxRate("");
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
          {/* Mesafe */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900 ">Mesafe</h3>
            <div className="relative">
              <select
                aria-label="Mesafe"
                value={yakinimda ? radiusKm : ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) {
                    unut();
                    ayarla({ yakinimda: false, yaricap: undefined });
                    return;
                  }
                  // Niyet ADRESTE, koordinat yalnız bellekte. İzin
                  // verilmezse niyet geri alınır, yoksa adreste hiçbir şey
                  // yapmayan bir filtre asılı kalırdı.
                  ayarla({ yakinimda: true, yaricap: Number(val) });
                  if (!konum) iste(() => ayarla({ yakinimda: false, yaricap: undefined }));
                }}
                className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
              >
                <option value="">Farketmez (Her Yer)</option>
                <option value="5">En fazla 5 km</option>
                <option value="10">En fazla 10 km</option>
                <option value="25">En fazla 25 km</option>
                <option value="50">En fazla 50 km</option>
                <option value="100">En fazla 100 km</option>
              </select>
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </div>
            {yukleniyor && (
              <p className="mt-2 animate-pulse text-xs font-medium text-marka-metin">Konum alınıyor…</p>
            )}
            {konum && !yukleniyor && (
              <p className="mt-2 text-xs font-medium text-emerald-600">✓ Konumunuz kullanılıyor</p>
            )}
          </div>

          {/* Fiyat aralığı */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 ">Fiyat Aralığı</h3>
            <p className="mb-4 mt-0.5 text-xs text-slate-500 ">Saatlik ders ücreti</p>
            <PriceRangeHistogram
              rates={rateDist ?? []}
              loading={histLoading}
              minRate={minRate}
              maxRate={maxRate}
              onChange={(mn, mx) => {
                setMinRate(mn);
                setMaxRate(mx);
                ayarla(
                  { minFiyat: metinSayisi(mn), maxFiyat: metinSayisi(mx) },
                  { replace: true }
                );
              }}
            />
          </div>

          {/* Cinsiyet */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900 ">Cinsiyet</h3>
            <div className="flex flex-wrap gap-2">
              {GENDER_OPTIONS.map((opt) => {
                const adet = fasetler?.[opt.value];
                return (
                  <button
                    key={opt.value}
                    onClick={() =>
                      ayarla({ cinsiyet: gender === opt.value ? "" : opt.value })
                    }
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                      gender === opt.value
                        ? "bg-marka text-marka-fg shadow-sm ring-1 ring-marka-focus"
                        : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 "
                    }`}
                  >
                    {opt.label}
                    {/* Sayı, filtre TIKLANMADAN ÖNCE kendini açıklar. */}
                    {adet !== undefined && (
                      <span className={gender === opt.value ? "ml-1.5 opacity-80" : "ml-1.5 text-slate-400"}>
                        {adet}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
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
