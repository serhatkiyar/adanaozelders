import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { MobilAramaAkisi } from "@/components/kesif/MobilAramaAkisi";
import { type DersSekli } from "@/components/AramaSecicileri";
import { TRENDING_SEARCHES } from "@/lib/trendingSearches";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import { EGITMEN_ARAMA, egitmenIstegi } from "@/lib/aramaUrl";
import { filtreliMi } from "@/lib/urlSemasi";
import { EgitmenFiltreModali } from "@/components/EgitmenFiltreModali";
import { useKonumStore } from "@/store/konumStore";
import { useYakinimdaKonum } from "@/hooks/useYakinimdaKonum";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { AramaMobilBaslik, type FiltreCipi } from "@/components/AramaMobilBaslik";
import { egitmenHapBasligi } from "@/lib/aramaBasligi";
import { konumOzeti, yerinIlceleri, type YerSecimi } from "@/lib/yerArama";

/* ─── options ─────────────────────────────────────────── */

const SORT_OPTIONS: { value: TutorSort; label: string; kisa: string }[] = [
  { value: TutorSort.RELEVANCE, label: "Sıralama: Önerilen", kisa: "Önerilen" },
  { value: TutorSort.RATING_DESC, label: "Sıralama: En Yüksek Puan", kisa: "En yüksek puan" },
  { value: TutorSort.PRICE_ASC, label: "Sıralama: En Düşük Fiyat", kisa: "En düşük fiyat" },
];

/* ─── icon helpers ─────────────────────────────────────── */

const FilterIconSvg = () => (
  /* Çizgi "ayar sürgüleri" (Airbnb'deki ikon dili): dolu huni, dolu siyah
     daireyle birlikte ağır duruyordu (kullanıcı itirazı, 16 Eyl 2026). */
  <svg
    className="h-5 w-5 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M4 7h16M4 17h16" />
    <circle cx="9" cy="7" r="2.2" fill="white" />
    <circle cx="15" cy="17" r="2.2" fill="white" />
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
  /* "Tüm yerler" (null) ilçeyi de düşürür; eskiden `konum.ilce` korunup
     seçim kutudan silinmiş görünürken adreste kalıyordu (16 Eyl 2026). */
  const setYer = (v: YerSecimi | null) =>
    ayarla({
      konum: { yer: v?.tur === "mahalle" ? v : null, ilce: yerinIlceleri(v) },
    });
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
  /* Adresteki "yakınımda" niyeti koordinat ister; izin yoksa bayrak düşer. */
  useYakinimdaKonum(degerler.yakinimda, () =>
    ayarla({ yakinimda: false, yaricap: undefined }, { replace: true })
  );
  // Daralmış arama pill'ine tıklayınca geniş navbar'ı (kategoriler + büyük
  // arama) yerinde açar — ana sayfadaki davranışın aynısı.
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobilAramaAcik, setMobilAramaAcik] = useState(false);
  const mobil = useMobil();
  const navigate = useNavigate();

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
  /* Filtre PENCERESİNDEKİ etkin grup sayısı (rozet). Hapta zaten görünen
     ders/yer/şekil sayılmaz; fiyat ve yaş aralığı birer grup. */
  const mobilFiltreSayisi =
    (degerler.minFiyat || degerler.maxFiyat ? 1 : 0) +
    (degerler.cinsiyet ? 1 : 0) +
    (degerler.minYas || degerler.maxYas ? 1 : 0) +
    (degerler.yakinimda ? 1 : 0);

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
            placeholder="Ders ekleyin"
            /* Seçili ders de görünür (kullanıcı, 16 Eyl 2026: "Matematik
               seçiyorum, çubukta yazmıyor"): `q` yalnız serbest metindi,
               katalogdan seçilen `ders` hapa hiç gitmiyordu. */
            q={
              q ||
              (subjects.length === 1
                ? subjects[0]
                : subjects.length
                  ? `${subjects.length} ders`
                  : "")
            }
            yer={konumOzeti({
              yer,
              ilce: district,
              yakinimda: degerler.yakinimda,
              uzaktan: sekil === TeachingMode.ONLINE,
            })}
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
        placeholder="Ders ekleyin"
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

  /* ── TELEFON: geri · hap · filtre, altında yatay filtre şeridi ──
     Kullanıcı kararı (9 Eyl 2026), referans Airbnb arama ekranı. Burada
     eskiden ana sayfanın kabuğu vardı: logo, "Ders Ver", "Giriş Yap",
     kategori şeridi ve ayrı bir "Filtreler" düğmesi. Sonuç ekranında gereken
     üç şey var — nereden geldiğin, ne aradığın, nasıl daraltacağın.

     Görünüm `Marketplace` (oturumlu) ile ORTAK bileşenden gelir; durum
     değil — iki sayfanın filtre modeli farklıdır. */
  /* Hap İKİ bilgiyi HER ZAMAN söyler (kullanıcı kararı, 16 Eyl 2026; Airbnb
     "Herhangi hafta • Misafir ekleyin" gibi): yer yoksa "Tüm Adana", ders
     şekli yoksa "Ders şekli ekleyin" daveti. Boş parça gizlenmez — kullanıcı
     neyi SEÇMEDİĞİNİ de görür ve hap onu tamamlamaya çağırır. */
  /* Hapın iki satırı `lib/aramaBasligi`den: konum seçiliyse başlık konumu
     söyler ("Çukurova bölgesindeki eğitmenler"), alt satır ders + şekil. */
  const mobilHap = egitmenHapBasligi({
    q,
    dersler: subjects,
    konum: konumOzeti({
      yer,
      ilce: district,
      yakinimda: degerler.yakinimda,
      uzaktan: sekil === TeachingMode.ONLINE,
    }),
    sekil: sekil,
  });

  /* Çipler UYDURMA DEĞİL: hepsi zaten adreste yaşayan ve arama isteğine giden
     filtrelerdir. Ders şekli TEK seçimdir — aynı çipe tekrar dokunmak filtreyi
     kaldırır; iki çip birden seçili görünseydi kullanıcıya olmayan bir
     kombinasyon vaat edilirdi. */
  /* Şeritte DERS ŞEKLİ ve DERS ÇİPİ YOK (kullanıcı kararı, 16 Eyl 2026):
     ikisi de hapın iki satırında zaten yazıyor ("Matematik • Uzaktan");
     şeritte tekrarı gürültüydü. Değiştirmek için hap dokunulur. Sınav çipi
     kalıyor — hap onu taşımıyor. */
  const mobilCipler: FiltreCipi[] = [
    ...(exam
      ? [{ id: "exam", etiket: `${exam} ✕`, aktif: true, onClick: () => setExam("") }]
      : []),
  ];

  const mobilUst = mobil ? (
    <AramaMobilBaslik
      baslik={mobilHap.baslik}
      ozet={mobilHap.ozet}
      onHap={() => setMobilAramaAcik(true)}
      onGeri={() => navigate(-1)}
      onFiltre={() => setShowFilters(true)}
      filtreSayisi={mobilFiltreSayisi}
      siralama={{
        deger: sort,
        secenekler: SORT_OPTIONS.map((o) => ({ value: o.value, kisa: o.kisa })),
        onChange: (v) => setSort(v as TutorSort),
        varsayilan: TutorSort.RELEVANCE,
      }}
      cipler={mobilCipler}
      filtreIkonu={<FilterIconSvg />}
    />
  ) : undefined;

  return (
    <PublicShell
      center={mobil ? undefined : navCenter}
      bottom={mobil ? undefined : navBottom}
      mobilUst={mobilUst}
      mobilSade={mobil}
    >
      <Seo title={seoTitle} description={seoDesc} canonicalPath="/egitmenler" />
      {/* Geniş arama açıkken sayfayı hafifçe karart; tıklayınca kapat. */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 animate-in fade-in duration-200"
          onClick={() => setSearchOpen(false)}
        />
      )}
      {/* Telefonda arama çubuğuna dokununca adımlı arama yüzeyi (kullanıcı
          kararı, 11 Eyl 2026). Önceden `searchOpen` telefonda yalnız ekranı
          karartıyordu: geniş hap `center`/`bottom` yuvalarına basılıyor, o
          yuvalar da telefonda hiç çizilmiyor — yani dokunuşun görünür
          karşılığı YOKTU. */}
      <MobilAramaAkisi
        acik={mobilAramaAcik}
        onKapat={() => setMobilAramaAcik(false)}
      />

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
