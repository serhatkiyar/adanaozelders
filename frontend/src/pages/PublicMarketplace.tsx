import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  PAGE_PARAM,
  limitForPage,
  nextPageSearch,
  pageFromParam,
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
import { ROUTES } from "@/lib/routes";
import { CategoryBar } from "@/components/CategoryBar";
import { BigSearch, CompactSearch } from "@/components/HeroSearch";
import { yeriOku, yeriYaz, yerinArananKonumu, type YerSecimi } from "@/lib/yerArama";
import { sekliCoz, type DersSekli } from "@/components/AramaSecicileri";
import { TRENDING_SEARCHES } from "@/lib/trendingSearches";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [district, setDistrict] = useState<string[]>(() => searchParams.getAll("district"));
  // Mahalle çapası — `?mahalle=Reşatbey` paylaşılabilir bağlantıdır.
  const [yer, setYer] = useState<YerSecimi | null>(() => yeriOku(searchParams).yer);
  // Ders şekli TEK değer. Eskiden burada `remote` adında bir boolean vardı ve
  // yalnız ONLINE'ı ifade edebiliyordu: ana sayfadan "yüz yüze" ile gelen
  // ANONİM ziyaretçinin filtresi bu ekranda okunmuyor, aşağıdaki URL
  // senkronunda da geri yazılmıyordu — yani sessizce BUHARLAŞIYORDU.
  const [sekil, setSekil] = useState<DersSekli>(() => sekliCoz(searchParams.get("mode")));
  const [subjects, setSubjects] = useState<string[]>(() => searchParams.getAll("subject"));
  const [exam, setExam] = useState(() => searchParams.get("exam") ?? "");
  const [sort, setSort] = useState<TutorSort>(TutorSort.RELEVANCE);
  // Sayfa durumu URL'de: filtreler zaten query string'de tutuluyordu ama
  // kaçıncı sayfada olunduğu state'teydi — paylaşılan bağlantı karşı tarafta
  // ilk 20 sonuca dönüyordu (bkz. lib/pagination.ts).
  const page = pageFromParam(searchParams.get(PAGE_PARAM));
  const limit = limitForPage(page, PER_PAGE);
  const [showFilters, setShowFilters] = useState(false);
  // Daralmış arama pill'ine tıklayınca geniş navbar'ı (kategoriler + büyük
  // arama) yerinde açar — ana sayfadaki davranışın aynısı.
  const [searchOpen, setSearchOpen] = useState(false);

  // Dış navigasyon (geri/ileri, link) state'i günceller.
  useEffect(() => {
    const qp = searchParams.get("q") ?? "";
    const sp = searchParams.getAll("subject");
    const dp = searchParams.getAll("district");
    const urlYer = yeriOku(searchParams).yer;
    const ep = searchParams.get("exam") ?? "";
    const rp = sekliCoz(searchParams.get("mode"));
    if (qp !== q) setQ(qp);
    if (JSON.stringify(urlYer) !== JSON.stringify(yer)) setYer(urlYer);
    if (JSON.stringify(sp) !== JSON.stringify(subjects)) setSubjects(sp);
    if (JSON.stringify(dp) !== JSON.stringify(district)) setDistrict(dp);
    if (ep !== exam) setExam(ep);
    if (rp !== sekil) setSekil(rp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const debouncedQ = useDebounce(q);

  // ── URL ↔ state senkronizasyonu ──────────────────────────────────────
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedQ.trim()) next.set("q", debouncedQ.trim());
    subjects.forEach((s) => next.append("subject", s));
    yeriYaz(next, yer, district);
    if (sekil) next.set("mode", sekil);
    if (exam.trim()) next.set("exam", exam.trim());
    setSearchParams(next, { replace: true });
  }, [debouncedQ, subjects, district, yer, sekil, exam, setSearchParams]);

  const removeSubject = (s: string) =>
    setSubjects((p) => p.filter((x) => x !== s));

  const params = useMemo<TutorSearchParams>(() => {
    const p: TutorSearchParams = { limit, offset: 0, sort };
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    if (subjects.length) p.subject = subjects;
    if (district.length) p.district = district;
    // Mahalle seçiliyse ÇEVRESİNDE aranır (konum çapası, eşitlik filtresi
    // değil). İlçe filtresi yanında kalır: yarıçap koordinatsız eğitmeni
    // eler, ilçe onu yakalamaya devam eder.
    const yerKonumu = yerinArananKonumu(yer);
    if (yerKonumu) {
      p.lat = yerKonumu.lat;
      p.lng = yerKonumu.lng;
      p.radius_km = yerKonumu.radius_km;
    }
    if (sekil) p.mode = [sekil];
    if (exam.trim()) p.exam = exam.trim();
    return p;
  }, [debouncedQ, subjects, district, yer, sekil, exam, sort, limit]);

  const { data, isLoading, isFetching, isError, error } = useTutorSearch(params);

  // ── Öne çıkarma bloğu ──
  // Arama ile AYNI filtreler; `sort`/`exam` GEÇMEZ (blokta sıralama satın
  // alınmaz). Yalnız ilk sayfada çizilir: 2. sayfada reklam beklenmez ve
  // aynı kartın iki sayfada birden çıkması kafa karıştırır.
  const featuredParams = useMemo<FeaturedTutorParams>(() => {
    const p: FeaturedTutorParams = {};
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    if (subjects.length) p.subject = subjects;
    if (district.length) p.district = district;
    if (sekil) p.mode = [sekil];
    return p;
  }, [debouncedQ, subjects, district, sekil]);

  const featuredOnFirstPage = page === 1;
  const [featuredIds, setFeaturedIds] = useState<number[]>([]);
  // Blokta gösterilen eğitmen organik listede TEKRAR çizilmez.
  const organicTutors = (data ?? []).filter(
    (t) => !(featuredOnFirstPage && featuredIds.includes(t.id))
  );

  const hasActiveFilters = sort !== TutorSort.RELEVANCE;

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
        {/* Login CTA banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-marka to-marka-hover px-5 py-3.5 text-marka-fg">
          <p className="text-sm font-medium">
            Eğitmenleri keşfet. Ders talebi ve mesaj için ücretsiz hesap aç.
          </p>
          <div className="flex shrink-0 gap-2">
            <Link
              to="?modal=login"
              className="rounded-xl bg-white/15 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/25"
            >
              Giriş Yap
            </Link>
            <Link
              to={ROUTES.register}
              className="rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-marka-metin-hover transition hover:bg-marka-soft"
            >
              Kayıt Ol
            </Link>
          </div>
        </div>

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

      {/* ── Filtre Modalı ── */}
      {showFilters && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-6">
          <div className="absolute inset-0" onClick={() => setShowFilters(false)} />
          <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in slide-in-from-bottom-4 duration-200 sm:zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 ">
              <h2 className="text-lg font-bold text-slate-900 ">Filtrele ve Sırala</h2>
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
              {/* Daha fazla filtre için kayıt CTA */}
              <div className="rounded-2xl border border-marka-line bg-marka-soft/50 p-4 ">
                <h3 className="text-sm font-semibold text-marka-soft-fg ">Daha fazla filtre mi arıyorsunuz?</h3>
                <p className="mt-1 text-xs text-marka-metin-hover ">
                  Konum, cinsiyet, fiyat aralığı ve daha fazlası için ücretsiz hesap oluşturun.
                </p>
                <Link
                  to="?modal=register"
                  className="mt-3 inline-block rounded-xl bg-marka px-4 py-2 text-xs font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover"
                  onClick={() => setShowFilters(false)}
                >
                  Kayıt Ol
                </Link>
              </div>
            </div>

            <div className="flex gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:px-6 sm:py-5">
              <button
                onClick={() => setSort(TutorSort.RELEVANCE)}
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
    </PublicShell>
  );
}
