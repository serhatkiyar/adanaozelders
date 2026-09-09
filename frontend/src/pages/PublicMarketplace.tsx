import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  limitForPage,
  nextPageSearch,
} from "@/lib/pagination";
import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";
import { TutorCard } from "@/components/TutorCard";
import { FeaturedTutorBlock } from "@/components/FeaturedTutorBlock";
import { useTutorSearch } from "@/hooks/useTutorSearch";
import { useDebounce } from "@/hooks/useDebounce";
import { getErrorMessage } from "@/lib/errors";
import { TeachingMode, TutorSort } from "@/types";
import type { FeaturedTutorParams, TutorSearchParams } from "@/api/tutors";
import { CategoryBar } from "@/components/CategoryBar";
import { BigSearch, CompactSearch } from "@/components/HeroSearch";
import { type YerSecimi } from "@/lib/yerArama";
import { type DersSekli } from "@/components/AramaSecicileri";
import { TRENDING_SEARCHES } from "@/lib/trendingSearches";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import { EGITMEN_ARAMA, egitmenIstegi } from "@/lib/aramaUrl";
import { filtreliMi } from "@/lib/urlSemasi";
import { EgitmenFiltreModali } from "@/components/EgitmenFiltreModali";
import { useKonumStore } from "@/store/konumStore";

/* ─── options ─────────────────────────────────────────── */

const SORT_OPTIONS: { value: TutorSort; label: string }[] = [
  { value: TutorSort.RELEVANCE, label: "Sıralama: Önerilen" },
  { value: TutorSort.RATING_DESC, label: "Sıralama: En Yüksek Puan" },
  { value: TutorSort.PRICE_ASC, label: "Sıralama: En Düşük Fiyat" },
];

/* ─── icon helpers ─────────────────────────────────────── */

const FilterIconSvg = () => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
  </svg>
);

/* ─── main page ─────────────────────────────────────────── */

/** Sayfa başına eğitmen sayısı. */
const PER_PAGE = 20;

export default function PublicMarketplace() {
  /*
   * URL ↔ state `useAramaDurumu` üzerinden (Paket 2).
   *
   * Buradaki elle senkron bloğu `Libraries` ile AYNI bug'ı taşıyordu: yazma
   * efekti URL'i `new URLSearchParams()` ile sıfırdan kuruyor, dolayısıyla
   * aynı dosyanın okuduğu `?sayfa=` parametresini siliyordu.
   * `/egitmenler?sayfa=3` bağlantısı karşı tarafta ilk 20 sonuca dönüyordu.
   * Tek kök, iki yüzey → tek düzeltme.
   */
  const { degerler, ayarla, params: searchParams } = useAramaDurumu(EGITMEN_ARAMA);
  const { konum, ders: subjects, sinav: exam, sayfa: page } = degerler;
  // Anonim yüzey ders şeklini TEK değer gibi kullanıyor (UI'da değiştirilmiyor,
  // yalnız ana sayfadan gelen filtre korunuyor); şema çoklu tuttuğu için ilki
  // alınır.
  const sekil = (degerler.sekil[0] ?? "") as DersSekli;
  const district = konum.ilce;
  const yer = konum.yer;
  const limit = limitForPage(page, PER_PAGE);

  const setSubjects = (v: string[]) => ayarla({ ders: v });
  const setDistrict = (v: string[]) => ayarla({ konum: { ...konum, ilce: v } });
  const setYer = (v: YerSecimi | null) =>
    ayarla({ konum: { yer: v, ilce: v ? [v.ilce] : konum.ilce } });
  const setExam = (v: string) => ayarla({ sinav: v });

  // Sıralama ADRESTE (9 Eyl 2026). Yerel state'teyken paylaşılamıyor,
  // yenilemede sıfırlanıyor ve geri tuşu onu geri almıyordu — incelenen yedi
  // platformun yedisinde de sıralama adreste.
  const sort = degerler.sirala || TutorSort.RELEVANCE;
  const setSort = (v: TutorSort) =>
    ayarla({ sirala: v === TutorSort.RELEVANCE ? "" : v });
  const [showFilters, setShowFilters] = useState(false);
  // Koordinat adrese YAZILMAZ; yalnız istekte kullanılır.
  const konumum = useKonumStore((s) => s.konum);
  // Daralmış arama pill'ine tıklayınca geniş navbar'ı (kategoriler + büyük
  // arama) yerinde açar — ana sayfadaki davranışın aynısı.
  const [searchOpen, setSearchOpen] = useState(false);

  // Serbest metin YEREL: her tuş vuruşunda adres yazmak geçmişi kirletir.
  const [q, setQ] = useState(degerler.q);
  useEffect(() => {
    setQ((onceki: string) => (degerler.q !== onceki ? degerler.q : onceki));
  }, [degerler.q]);

  const debouncedQ = useDebounce(q);
  useEffect(() => {
    if (debouncedQ.trim() !== degerler.q) ayarla({ q: debouncedQ }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const removeSubject = (s: string) =>
    setSubjects(subjects.filter((x) => x !== s));

  /*
   * Şema değeri → API isteği: `Marketplace` ile AYNI fonksiyon.
   *
   * Bu çeviri burada elle yazılıyken bir kusur barındırıyordu: eski `remote:
   * boolean` alanı seçilen ders şeklini sessizce buharlaştırıyordu. Aynı
   * çevirinin dört kopyası olmasının bedeli buydu.
   */
  const params = useMemo<TutorSearchParams>(
    () =>
      egitmenIstegi({ ...degerler, q: debouncedQ }, { limit, offset: 0, konumum }),
    [degerler, debouncedQ, limit, konumum]
  );

  const { data, isLoading, isFetching, isError, error } = useTutorSearch(params);

  // ── Öne çıkarma bloğu ──
  // Arama ile AYNI filtreler; `sort`/`exam` GEÇMEZ (blokta sıralama satın
  // alınmaz). Yalnız ilk sayfada çizilir: 2. sayfada reklam beklenmez ve
  // aynı kartın iki sayfada birden çıkması kafa karıştırır.
  const featuredParams = useMemo<FeaturedTutorParams>(() => {
    // Aramanın isteğinden ÇIKARARAK türetilir: elle ikinci kez kurulunca
    // (bugüne kadar öyleydi) blok ile liste sessizce ayrışıyordu.
    const {
      sort: _sort,
      exam: _exam,
      limit: _limit,
      offset: _offset,
      ...rest
    } = params;
    return rest;
  }, [params]);

  const featuredOnFirstPage = page === 1;
  const [featuredIds, setFeaturedIds] = useState<number[]>([]);
  // Blokta gösterilen eğitmen organik listede TEKRAR çizilmez.
  const organicTutors = (data ?? []).filter(
    (t) => !(featuredOnFirstPage && featuredIds.includes(t.id))
  );

  // Şemadan türer: yeni bir filtre eklendiğinde bu satırı güncellemeyi
  // unutmak, rozeti sessizce yanlış gösterirdi. Eskiden yalnız `sort`a
  // bakıyordu ve anonim yüzeyde başka filtre de yoktu.
  const hasActiveFilters = filtreliMi(EGITMEN_ARAMA, degerler);

  const seoTitle = subjects.length
    ? `${subjects.join(", ")} Eğitmenleri`
    : debouncedQ.trim()
      ? `"${debouncedQ.trim()}" için eğitmenler`
      : "Eğitmen Ara";
  const seoDesc = subjects.length
    ? `Adana'da ${subjects.join(", ")} dersi veren onaylı, uzman özel ders eğitmenlerini keşfet.`
    : "Adana'daki onaylı özel ders eğitmenlerini puan, fiyat ve branşa göre ara.";

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
            remote={sekil === TeachingMode.ONLINE}
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
          hasActiveFilters
            ? "border-slate-900 bg-slate-900 text-white "
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 "
        }`}
      >
        <FilterIconSvg />
        Filtreler
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
    <PublicShell center={navCenter} bottom={navBottom}>
      <Seo title={seoTitle} description={seoDesc} canonicalPath="/egitmenler" />
      {/* Geniş arama açıkken sayfayı hafifçe karart; tıklayınca kapat. */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 animate-in fade-in duration-200"
          onClick={() => setSearchOpen(false)}
        />
      )}
      <div className="mx-auto max-w-[1050px] space-y-4 pt-4">
        {/*
          * KAYIT BANDI SÖKÜLDÜ (kullanıcı kararı, 9 Eyl 2026 · ÜK-10).
          *
          * Buradaki koşulsuz turuncu bant, ziyaretçi tek bir eğitmen bile
          * görmeden hesap istiyordu — NN/g'nin "Login Walls" başlığında
          * ölçtüğü kusur. Üstelik yanlış vaat veriyordu: "mesaj için hesap aç"
          * diyordu ama mesajlaşma aktif rezervasyona bağlı
          * (`TutorProfile` · `hasActiveBooking`), yani hesap açmak tek başına
          * mesajlaşmayı AÇMIYOR.
          *
          * Kapı artık eylemde: kalbe ya da "Ders Talep Et"e basıldığında
          * pencere açılıyor ve sayfa kaybolmuyor. Yerine hiçbir şey KONMADI —
          * navbar'daki "Giriş Yap" zaten duruyor. Nöbetçi:
          * `__guards__/anonimBantSokumu`.
          */}

        {/* Sonuçlar */}
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
          ) : organicTutors.length === 0 && featuredIds.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center ">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl ">
                🔍
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700 ">
                Kriterlere uyan eğitmen bulunamadı
              </p>
            </div>
          ) : (
            <>
              <FeaturedTutorBlock
                params={featuredParams}
                enabled={featuredOnFirstPage}
                onIds={setFeaturedIds}
              />
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-400 ">
                <span>{organicTutors.length} eğitmen listeleniyor</span>
                {isFetching && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-marka-mid" />
                    Güncelleniyor
                  </span>
                )}
              </div>
              {/* Anonim de kalbi görür — tıklayınca giriş modalı, giriş sonrası niyet uygulanır */}
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {organicTutors.map((tutor) => (
                  <TutorCard key={tutor.id} tutor={tutor} />
                ))}
              </div>
              {(data?.length ?? 0) === limit && (
                <div className="mt-6 flex justify-center">
                  {/* Gerçek bağlantı: crawler takip edebilsin ve kullanıcı
                      yeni sekmede açabilsin. Tıklama SPA içinde kalır. */}
                  <Link
                    to={nextPageSearch(searchParams, page)}
                    className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-marka-soft-fg shadow-sm ring-1 ring-slate-200 transition hover:bg-marka-soft active:scale-95 disabled:opacity-60 "
                  >
                    {isFetching ? "Yükleniyor…" : "Daha fazla göster"}
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/*
        * Boş "Filtrele ve Sırala" penceresi SÖKÜLDÜ (ÜK-10). Gövdesinde tek
        * bir filtre yoktu, yalnız "ücretsiz hesap oluşturun" reklam kartı
        * duruyordu: işlevsel görünen bir düğme pazarlama gösteriyordu.
        *
        * Yerine oturumlu yüzeyle AYNI pencere geliyor. Teknik engel yoktu —
        * `/tutors/price-histogram` ve `/tutors/gender-facets` uçları anonime
        * açık, yani sunucu bu sayıları zaten bedavaya veriyordu.
        */}
      <EgitmenFiltreModali
        acik={showFilters}
        kapat={() => setShowFilters(false)}
      />
    </PublicShell>
  );
}
