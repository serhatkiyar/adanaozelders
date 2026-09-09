import { type CSSProperties, useMemo, useState, useEffect, useRef } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { TutorCard } from "@/components/TutorCard";
import { FeaturedTutorBlock } from "@/components/FeaturedTutorBlock";
import { PriceRangeHistogram } from "@/components/PriceRangeHistogram";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useTutorSearch, useTutorPriceHistogram, useTutorGenderFacets } from "@/hooks/useTutorSearch";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDebounce } from "@/hooks/useDebounce";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { Gender, ROLE_IDS, TeachingMode, TutorSort } from "@/types";
import type { FeaturedTutorParams, TutorSearchParams } from "@/api/tutors";
import { CategoryBar } from "@/components/CategoryBar";
import { BigSearch, CompactSearch } from "@/components/HeroSearch";
import { type YerSecimi } from "@/lib/yerArama";
import { TRENDING_SEARCHES } from "@/lib/trendingSearches";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import { bosDeger, filtreliMi } from "@/lib/urlSemasi";
import {
  EGITMEN_ARAMA,
  VARSAYILAN_YARICAP_KM,
  egitmenIstegi,
  type EgitmenAramasi,
} from "@/lib/aramaUrl";

/**
 * Sayısal alanın kutu metni ↔ şema değeri çevirisi.
 *
 * Boş kutu = filtre YOK (`undefined`), "0" ise geçerli bir alt sınır. İkisini
 * ayırmayan bir çeviri "0 TL üstü" filtresini sessizce siler.
 */
const sayiMetni = (n: number | undefined) => (n === undefined ? "" : String(n));
const metinSayisi = (t: string): number | undefined => {
  const kirpik = t.trim();
  if (!kirpik) return undefined;
  const n = Number(kirpik);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
/** Adresten gelen değer kutudakinden farklıysa kutuyu güncelle. */
const esitle = (kutu: string, deger: number | undefined) =>
  metinSayisi(kutu) === deger ? kutu : sayiMetni(deger);

/* ─── options ─────────────────────────────────────────── */

const SORT_OPTIONS: { value: TutorSort; label: string }[] = [
  { value: TutorSort.RELEVANCE, label: "Sıralama: Önerilen" },
  { value: TutorSort.RATING_DESC, label: "Sıralama: En Yüksek Puan" },
  { value: TutorSort.PRICE_ASC, label: "Sıralama: En Düşük Fiyat" },
];

const MODE_ALL = "ALL" as const;
/** Aramada yalnız iki şekil vardır; `BOTH` filtre olarak anlamsızdır. */
type AramaSekli = EgitmenAramasi["sekil"][number];
const MODE_SEGMENTS: { value: AramaSekli | typeof MODE_ALL; label: string }[] = [
  { value: MODE_ALL, label: "Tümü" },
  { value: TeachingMode.ONLINE, label: "Uzaktan" },
  { value: TeachingMode.IN_PERSON, label: "Yüzyüze" },
];

const GENDER_OPTIONS: { value: Gender.MALE | Gender.FEMALE; label: string }[] = [
  { value: Gender.FEMALE, label: "Kadın" },
  { value: Gender.MALE, label: "Erkek" },
];

/* ─── icon helpers ─────────────────────────────────────── */

const FilterIconSvg = () => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
  </svg>
);

/* ─── main page ─────────────────────────────────────────── */

export default function Marketplace() {
  const { data: currentUser } = useCurrentUser();
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? UYE_NAV
        : undefined;
  /*
   * URL ↔ state `useAramaDurumu` üzerinden (Paket 2). Elle yazılmış senkron
   * bloğu üç kararı burada yeniden veriyordu (varsayılan yazılsın mı, sayfa
   * sıfırlansın mı, push mu replace mi) ve `?gender=abc` gibi çöp değerin
   * API'ye ulaşmaması da elle yazılmıştı — ikisi de artık şemada.
   */
  const { degerler, ayarla } = useAramaDurumu(EGITMEN_ARAMA);
  const {
    konum,
    ders: subjects,
    sekil: modes,
    sinav: exam,
    cinsiyet: gender,
    sirala,
    yakinimda,
  } = degerler;
  const sort = sirala || TutorSort.RELEVANCE;
  const radiusKm = degerler.yaricap ?? VARSAYILAN_YARICAP_KM;
  const district = konum.ilce;
  const yer = konum.yer;

  const setSubjects = (v: string[]) => ayarla({ ders: v });
  const setDistrict = (v: string[]) => ayarla({ konum: { ...konum, ilce: v } });
  const setYer = (v: YerSecimi | null) =>
    ayarla({ konum: { yer: v, ilce: v ? [v.ilce] : konum.ilce } });
  const setExam = (v: string) => ayarla({ sinav: v });
  const setModes = (v: AramaSekli[]) => ayarla({ sekil: v });
  const setGender = (v: EgitmenAramasi["cinsiyet"]) => ayarla({ cinsiyet: v });
  const setSort = (v: TutorSort) =>
    // `RELEVANCE` varsayılan: adrese yazılmaz, boşa çekilir.
    ayarla({ sirala: v === TutorSort.RELEVANCE ? "" : v });
  const setRadiusKm = (v: number) => ayarla({ yaricap: v });

  // Serbest metin YEREL: her tuş vuruşunda adres yazmak geçmişi kirletir.
  const [q, setQ] = useState(degerler.q);
  useEffect(() => {
    setQ((onceki: string) => (degerler.q !== onceki ? degerler.q : onceki));
  }, [degerler.q]);

  const [showFilters, setShowFilters] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pricePopoverOpen, setPricePopoverOpen] = useState(false);
  const [pricePopoverPos, setPricePopoverPos] = useState<{top: number, left: number} | null>(null);
  const pricePopoverRef = useRef<HTMLButtonElement>(null);

  const setSurface = useSurfaceStore((s) => s.setSurface);

  // /hesabim bağlama duyarlı navbar: son yüzey = keşif.
  useEffect(() => {
    setSurface("discover");
  }, [setSurface]);

  const togglePricePopover = () => {
    if (pricePopoverOpen) {
      setPricePopoverOpen(false);
      return;
    }
    const r = pricePopoverRef.current?.getBoundingClientRect();
    if (r) {
      setPricePopoverPos({ top: r.bottom + 8, left: r.left });
    }
    setPricePopoverOpen(true);
  };

  /*
   * Dış navigasyon (geri/ileri, paylaşılan link) için AYRI bir efekt YOK:
   * değerler doğrudan adresten türüyor. Eskiden burada bir "URL → state"
   * efekti vardı ve karşısındaki "state → URL" efektiyle sonsuz döngüyü
   * engellemek için elle JSON karşılaştırması yapıyordu. İki yönlü kopya
   * ortadan kalkınca o guard da gereksizleşti.
   *
   * Elle yazılmış `?gender=abc` API'ye ULAŞMAZ: enum doğrulaması artık
   * şemanın alanında (`cinsiyetAlani`), ekranda değil.
   */
  /*
   * Sayısal aralıklar: değer ADRESTE, kutunun anlık metni YEREL.
   *
   * Serbest metinle aynı gerekçe — her tuş vuruşunda adres yazmak geçmişi
   * kirletir ve "18" yazarken bir an "1" filtresi uygulanır. Yerel metin
   * debounce'lanıp adrese `replace` ile iner; dışarıdan gelen adres
   * değişimi (geri tuşu, paylaşılan link) kutuya geri yansır.
   */
  const [minRate, setMinRate] = useState(sayiMetni(degerler.minFiyat));
  const [maxRate, setMaxRate] = useState(sayiMetni(degerler.maxFiyat));
  const [minAge, setMinAge] = useState(sayiMetni(degerler.minYas));
  const [maxAge, setMaxAge] = useState(sayiMetni(degerler.maxYas));
  const [limit, setLimit] = useState(20);

  /*
   * KOORDİNAT ADRESE YAZILMAZ — yalnız `yakinimda=1&yaricap=…` niyeti.
   * Paylaşılan bir arama bağlantısı kullanıcının bulunduğu yeri taşımamalı.
   * Bağlantıyı açan kişi için konum tarayıcıdan YENİDEN istenir.
   */
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  const requestNearMe = () => {
    if (!navigator.geolocation) {
      toast.error("Tarayıcınız konum servisini desteklemiyor.");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNearMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        ayarla({ yakinimda: true });
        setGeoLoading(false);
      },
      () => {
        toast.error("Konum alınamadı. Lütfen izin verin.");
        // Niyet adreste kalmasın: izin verilmediyse "yakınımda" filtresi
        // sessizce açık görünmemeli.
        ayarla({ yakinimda: false });
        setGeoLoading(false);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const modeSegment: AramaSekli | typeof MODE_ALL = modes[0] ?? MODE_ALL;
  const selectMode = (v: AramaSekli | typeof MODE_ALL) =>
    setModes(v === MODE_ALL ? [] : [v]);
  const isAllMode = modes.length === 0;

  const removeSubject = (s: string) =>
    setSubjects(subjects.filter((x) => x !== s));

  const debouncedQ = useDebounce(q);

  // Debounce'lu metin adrese `replace` ile yazılır.
  useEffect(() => {
    if (debouncedQ.trim() !== degerler.q) ayarla({ q: debouncedQ }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const debouncedMin = useDebounce(minRate);
  const debouncedMax = useDebounce(maxRate);
  const debouncedMinAge = useDebounce(minAge);
  const debouncedMaxAge = useDebounce(maxAge);

  // Kutu → adres (debounce'lu, `replace`: her rakam geçmişe girmesin).
  useEffect(() => {
    const yama = {
      minFiyat: metinSayisi(debouncedMin),
      maxFiyat: metinSayisi(debouncedMax),
      minYas: metinSayisi(debouncedMinAge),
      maxYas: metinSayisi(debouncedMaxAge),
    };
    const ayni =
      yama.minFiyat === degerler.minFiyat &&
      yama.maxFiyat === degerler.maxFiyat &&
      yama.minYas === degerler.minYas &&
      yama.maxYas === degerler.maxYas;
    if (!ayni) ayarla(yama, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedMin, debouncedMax, debouncedMinAge, debouncedMaxAge]);

  // Adres → kutu (geri tuşu, paylaşılan bağlantı).
  useEffect(() => {
    setMinRate((o) => esitle(o, degerler.minFiyat));
    setMaxRate((o) => esitle(o, degerler.maxFiyat));
    setMinAge((o) => esitle(o, degerler.minYas));
    setMaxAge((o) => esitle(o, degerler.maxYas));
  }, [degerler.minFiyat, degerler.maxFiyat, degerler.minYas, degerler.maxYas]);

  /*
   * Şema değeri → API isteği. Bu çeviri eskiden bu dosyada iki kez
   * (arama + histogram), `PublicMarketplace`te bir kez daha yazılıydı ve
   * ayrışmıştı. Artık `aramaUrl`de tek yerde yaşıyor.
   *
   * `debouncedQ` istisna: kutunun anlık metni adrese inmeden ÖNCE aramayı
   * tetiklemeli, yoksa yazarken sonuçlar bir tur geriden gelir.
   */
  const params = useMemo<TutorSearchParams>(
    () =>
      egitmenIstegi(
        { ...degerler, q: debouncedQ },
        { limit, offset: 0, konumum: nearMe }
      ),
    [degerler, debouncedQ, limit, nearMe]
  );

  const { data, isLoading, isFetching, isError, error } = useTutorSearch(params);

  // ── Öne çıkarma bloğu ──
  // Arama ile AYNI sert filtreler; `sort`/`exam` GEÇMEZ (blokta sıralama
  // satın alınmaz). Bu sayfa "daha fazla göster" ile kümülatif büyür, yani
  // tek bir sayfadır: blok en üstte kalır ve dedupe her zaman uygulanır.
  // (Gerçek sayfalaması olan anonim sayfada blok yalnız 1. sayfada çizilir.)
  const featuredParams = useMemo<FeaturedTutorParams>(() => {
    const { sort: _sort, exam: _exam, limit: _limit, offset: _offset, ...rest } =
      params;
    return rest;
  }, [params]);

  const [featuredIds, setFeaturedIds] = useState<number[]>([]);
  const organicTutors = (data ?? []).filter((t) => !featuredIds.includes(t.id));

  /*
   * Fiyat histogramı sonuç listesiyle AYNI kümeyi ölçmeli, yoksa çubuklar
   * listede olmayan eğitmenleri sayar. Eskiden bu küme ELLE ikinci kez
   * kuruluyordu ve mahalle çapası kuralı iki yere kopyalanmıştı. Artık
   * listenin isteğinden ÇIKARARAK türetiliyor: kendi ekseni (fiyat) ve
   * sayıyı etkilemeyen alanlar düşer.
   */
  const histParams = useMemo(() => {
    const {
      sort: _sort,
      exam: _exam,
      limit: _limit,
      offset: _offset,
      min_rate: _min,
      max_rate: _max,
      ...rest
    } = params;
    return rest;
  }, [params]);

  const { data: rateDist, isLoading: histLoading } = useTutorPriceHistogram(histParams, showFilters);

  // Faset KENDİ eksenini saymaz: `gender` çıkarılır. Kalsaydı "Kadın" seçili
  // iken "Erkek 0" görünür ve sayılar seçim yapmayı imkânsız kılardı.
  const fasetParams = useMemo(() => {
    const { gender: _atlandi, ...kalan } = histParams;
    return kalan;
  }, [histParams]);
  const { data: fasetler } = useTutorGenderFacets(fasetParams, showFilters);

  const hasModalFilters =
    !!minRate || !!maxRate || !!gender || !!minAge || !!maxAge || yakinimda;

  // "Filtre var mı" artık şemadan gelir: yeni bir alan eklendiğinde bu satırı
  // güncellemeyi unutmak, temizle düğmesini sessizce yanlış gösterirdi.
  const hasFilters = filtreliMi(EGITMEN_ARAMA, degerler) || !!q;

  const clearAll = () => {
    setQ("");
    setMinRate(""); setMaxRate(""); setMinAge(""); setMaxAge("");
    setNearMe(null);
    ayarla(bosDeger(EGITMEN_ARAMA));
    setLimit(20);
  };

  // Geniş aramada arama butonuna basınca (q/district zaten canlı state'i
  // sürdüğü için) yalnızca geniş paneli kapat.
  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchOpen(false);
  };

  /* ── Navbar ortası ──
     Kapalı: kompakt arama pill'i (tıklayınca geniş hali açar).
     Açık:  ana sayfadaki kategori çubuğu (sekmeler başka sayfaya götürür). */
  const navCenter = (
    <div key={searchOpen ? "cats" : "compact"} className="w-full animate-in fade-in duration-300">
      {searchOpen ? (
        <CategoryBar active="egitmenler" />
      ) : (
        <div className="flex w-full justify-center">
          <CompactSearch
            active="egitmenler"
            placeholder="Ders ara… (ör. Lise Matematik)"
            q={q}
            district={district}
            remote={modeSegment === TeachingMode.ONLINE}
            onOpen={() => setSearchOpen(true)}
          />
        </div>
      )}
    </div>
  );

  /* ── Navbar altı ──
     Açık: ana sayfadaki büyük arama hapı. Kapalı: filtre çubuğu. */
  const bigSearchRow = (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">
      <BigSearch
        q={q}
        setQ={setQ}
        district={district}
        setDistrict={setDistrict}
        onSubmit={submitSearch}
        placeholder="Matematik, İngilizce…"
        yer={yer}
        setYer={setYer}
        solBaslik="Yer"
        sagBaslik="Ders"
        trending={TRENDING_SEARCHES}
      />
    </div>
  );

  const filterBar = (
    <div className="flex justify-center w-full">
      <div
        className="flex items-center justify-center gap-2 overflow-x-auto px-6 pb-2.5 pt-3"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as CSSProperties}
      >
      {/* Filtreler butonu */}
      <button
        onClick={() => setShowFilters(true)}
        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold shadow-sm transition hover:shadow ${
          hasModalFilters
            ? "border-slate-900 bg-slate-900 text-white "
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 "
        }`}
      >
        <FilterIconSvg />
        Filtreler
        {hasModalFilters && (
          <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-marka text-[9px] font-bold text-marka-fg ">
            ✓
          </span>
        )}
      </button>

      <div className="h-5 w-px shrink-0 bg-slate-200 " />

      {/* Sıralama açılır menüsü */}
      <div className="relative shrink-0">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as TutorSort)}
          className={`appearance-none rounded-full border px-3.5 py-1.5 pr-8 text-sm font-medium outline-none transition focus:ring-2 focus:ring-marka-focus/20 ${
            sort !== TutorSort.RELEVANCE
              ? "border-slate-900 bg-slate-900 text-white "
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 "
          }`}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${sort !== TutorSort.RELEVANCE ? 'text-white ' : 'text-slate-400 '}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>

      <div className="h-5 w-px shrink-0 bg-slate-200 " />

      {/* Fiyat Popover Butonu */}
      <div className="relative shrink-0">
        <button
          ref={pricePopoverRef}
          type="button"
          onClick={togglePricePopover}
          className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
            minRate || maxRate
              ? "border-slate-900 bg-slate-900 text-white "
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 "
          }`}
        >
          {minRate || maxRate ? `${minRate || "0"} TL - ${maxRate ? `${maxRate} TL` : "Üstü"}` : "Fiyat"}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={pricePopoverOpen ? "rotate-180 transition-transform" : "transition-transform"}><path d="M6 9l6 6 6-6"/></svg>
        </button>
        
        {pricePopoverOpen && pricePopoverPos && (
          <>
            <div className="fixed inset-0 z-[80]" onClick={() => setPricePopoverOpen(false)} />
            <div 
              style={{ position: "fixed", top: pricePopoverPos.top, left: pricePopoverPos.left }}
              className="z-[90] w-80 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:w-96"
            >
              <h3 className="mb-4 font-semibold text-slate-900 ">Fiyat Aralığı (Saatlik)</h3>
              <PriceRangeHistogram
                rates={rateDist ?? []}
                loading={histLoading}
                minRate={minRate}
                maxRate={maxRate}
                onChange={(mn, mx) => { setMinRate(mn); setMaxRate(mx); }}
              />
            </div>
          </>
        )}
      </div>

      <div className="h-5 w-px shrink-0 bg-slate-200 " />

      {/* Ders şekli açılır menüsü */}
      <div className="relative shrink-0">
        <select
          value={modeSegment}
          onChange={(e) => selectMode(e.target.value as any)}
          className={`appearance-none rounded-full border px-3.5 py-1.5 pr-8 text-sm font-medium outline-none transition focus:ring-2 focus:ring-marka-focus/20 ${
            !isAllMode
              ? "border-slate-900 bg-slate-900 text-white "
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 "
          }`}
        >
          <option value={MODE_ALL}>Eğitim Şekli</option>
          <option value={TeachingMode.ONLINE}>Uzaktan</option>
          <option value={TeachingMode.IN_PERSON}>Yüzyüze</option>
        </select>
        <div className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${!isAllMode ? 'text-white ' : 'text-slate-400 '}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>

      {/* Aktif sınav chip'i */}
      {exam && (
        <button
          onClick={() => setExam("")}
          className="shrink-0 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100 "
        >
          {exam}
          <span aria-hidden className="ml-0.5 text-xs">✕</span>
        </button>
      )}

      {/* Aktif ders chip'leri */}
      {subjects.map((s) => (
        <button
          key={s}
          onClick={() => removeSubject(s)}
          className="shrink-0 inline-flex items-center gap-1 rounded-full border border-marka-line bg-marka-soft px-3.5 py-1.5 text-sm font-medium text-marka-metin-hover transition hover:bg-marka-line "
        >
          {s}
          <span aria-hidden className="ml-0.5 text-xs">✕</span>
        </button>
      ))}
      </div>
    </div>
  );

  const navBottom = searchOpen ? bigSearchRow : filterBar;

  return (
    <DashboardShell title="Eğitmen Bul" navItems={navItems} center={navCenter} bottom={navBottom} sekmeler={null}>
      {/* Geniş arama açıkken sayfayı hafifçe karart; tıklayınca kapat. */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 animate-in fade-in duration-200"
          onClick={() => setSearchOpen(false)}
        />
      )}
      <div className="mx-auto max-w-[1050px] pt-4">
        {/* ── Sonuçlar ── */}
        <div>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-52 animate-pulse rounded-2xl bg-slate-100 " />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 ">
              <span>⚠</span>
              {getErrorMessage(error, "Eğitmenler yüklenemedi.")}
            </div>
          ) : !data || data.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center ">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl ">
                🔍
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700 ">
                Kriterlere uyan eğitmen bulunamadı
              </p>
              <p className="mt-1 text-xs text-slate-400 ">
                Filtrelerini değiştirerek tekrar dene
              </p>
              {hasFilters && (
                <button
                  onClick={clearAll}
                  className="mt-4 rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover"
                >
                  Tüm filtreleri temizle
                </button>
              )}
            </div>
          ) : (
            <>
              <FeaturedTutorBlock params={featuredParams} onIds={setFeaturedIds} />
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-400 ">
                <span>{organicTutors.length} eğitmen listeleniyor</span>
                {isFetching && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-marka-mid" />
                    Güncelleniyor
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {organicTutors.map((tutor) => (
                  <TutorCard key={tutor.id} tutor={tutor} />
                ))}
              </div>
              {data.length === limit && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setLimit((l) => l + 20)}
                    disabled={isFetching}
                    className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-marka-soft-fg shadow-sm ring-1 ring-slate-200 transition hover:bg-marka-soft active:scale-95 disabled:opacity-60 "
                  >
                    {isFetching ? "Yükleniyor…" : "Daha fazla göster"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Filtre Modalı ── */}
      {showFilters && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-6">
          <div className="absolute inset-0" onClick={() => setShowFilters(false)} />
          <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in slide-in-from-bottom-4 duration-200 sm:zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 ">
              <h2 className="text-lg font-bold text-slate-900 ">Filtrele</h2>
              <button
                onClick={() => setShowFilters(false)}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-8 overflow-y-auto p-6">
              {/* Ders işleme şekli */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-900 ">Ders İşleme Şekli</h3>
                <SegmentedControl options={MODE_SEGMENTS} value={modeSegment} onChange={selectMode} />
              </div>

              {/* Konum */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-900 ">Mesafe</h3>
                <div className="relative">
                  <select
                    value={yakinimda ? radiusKm : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        setNearMe(null);
                        ayarla({ yakinimda: false, yaricap: undefined });
                        return;
                      }
                      setRadiusKm(Number(val));
                      // Niyet adreste; koordinat yalnız bellekte.
                      if (!nearMe) requestNearMe();
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
                {geoLoading && <p className="mt-2 animate-pulse text-xs font-medium text-marka-metin">Konum alınıyor…</p>}
                {nearMe && !geoLoading && <p className="mt-2 text-xs font-medium text-emerald-600">✓ Konumunuz kullanılıyor</p>}
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
                  onChange={(mn, mx) => { setMinRate(mn); setMaxRate(mx); }}
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
                        onClick={() => setGender(gender === opt.value ? "" : opt.value)}
                        className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                          gender === opt.value
                            ? "bg-marka text-marka-fg shadow-sm ring-1 ring-marka-focus"
                            : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 "
                        }`}
                      >
                        {opt.label}
                        {/* Sayı, filtre TIKLANMADAN ÖNCE kendini açıklar —
                            asıl düzeltme budur. */}
                        {adet !== undefined && (
                          <span className={gender === opt.value ? "ml-1.5 opacity-80" : "ml-1.5 text-slate-400"}>
                            {adet}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* SESSİZ ELEME artık sessiz değil.
                    `Tutor.gender == FEMALE` karşılaştırması hem NULL hem
                    UNSPECIFIED satırları eler; öğrenci bugüne kadar bunu
                    göremiyordu. Yalnız filtre ETKİNKEN gösterilir: filtre
                    kapalıyken kimse elenmiyor. */}
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
                onClick={clearAll}
                className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 "
              >
                Temizle
              </button>
              <button
                onClick={() => setShowFilters(false)}
                className="flex-[2] rounded-xl bg-marka px-4 py-3 text-sm font-semibold text-marka-fg shadow-sm shadow-marka/20 transition hover:bg-marka-hover active:scale-95"
              >
                Sonuçları Göster
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
