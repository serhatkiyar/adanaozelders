import { type CSSProperties, useMemo, useState, useEffect } from "react";
import {Link} from "react-router-dom";
import {

  limitForPage,
  nextPageSearch,

} from "@/lib/pagination";
import { DashboardShell } from "@/components/DashboardShell";
import { PublicShell } from "@/components/PublicShell";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { LibraryCard } from "@/components/LibraryCard";
import { LibrariesMap } from "@/components/LibrariesMap";
import { useLibrarySearch } from "@/hooks/useLibraries";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDebounce } from "@/hooks/useDebounce";
import { useAuthStore } from "@/store/authStore";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { Seo } from "@/components/Seo";
import { AMENITY_OPTIONS, amenityLabel } from "@/lib/amenities";
import { amenityIcon } from "@/lib/amenityIcons";
import { ROLE_IDS } from "@/types";
import { CategoryBar } from "@/components/CategoryBar";
import { CompactSearch, KutuphaneArama } from "@/components/HeroSearch";
import { MobilAramaSheet } from "@/components/MobilAramaSheet";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { LibraryRow } from "@/components/VitrinSeridi";
import { type YerSecimi } from "@/lib/yerArama";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import { KUTUPHANE_ARAMA, kutuphaneIstegi } from "@/lib/aramaUrl";
import type { LibrarySearchParams } from "@/api/libraries";

type ViewMode = "list" | "map";
type LibrarySort = "rating" | "distance" | "";

const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: "", label: "Önerilen" },
  { value: "rating", label: "★ Puan" },
  { value: "distance", label: "📍 Yakınımda" },
];

// Alan başlığı ("Kütüphane") ne aradığını söylüyor; ipucu yalnız ÖRNEK verir.
const SEARCH_PLACEHOLDER = "Kütüphane adı";

const FilterIconSvg = () => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
  </svg>
);

/** Sayfa başına kütüphane sayısı. */
const PER_PAGE = 30;

export default function Libraries() {
  const token = useAuthStore((s) => s.token);
  const { data: currentUser } = useCurrentUser();
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? UYE_NAV
        : undefined;

  /*
   * URL ↔ state artık `useAramaDurumu` üzerinden (Paket 2).
   *
   * Buradaki elle senkron bloğu bir bug taşıyordu: yazma efekti URL'i
   * `new URLSearchParams()` ile SIFIRDAN kuruyordu, yani aynı dosyanın
   * okuduğu `?sayfa=` parametresini siliyordu. `/kutuphaneler?sayfa=3`
   * bağlantısı karşı tarafta 1. sayfaya düşüyordu — hata yok, sessiz kayıp.
   * (Aynı kusur `PublicMarketplace`te de vardı; ikisi tek düzeltmeyle öldü.)
   *
   * `ayarla` tabanı KORUR: şemanın tanımadığı hiçbir anahtar kaybolmaz.
   */
  const { degerler, ayarla, filtreli, params: searchParams } = useAramaDurumu(KUTUPHANE_ARAMA);
  const { konum, sayfa: page } = degerler;
  const district = konum.ilce;
  const yer = konum.yer;
  const setDistrict = (v: string[]) => ayarla({ konum: { ...konum, ilce: v } });
  const setYer = (v: YerSecimi | null) =>
    ayarla({ konum: { yer: v, ilce: v ? [v.ilce] : konum.ilce } });

  // Serbest metin YEREL kalır: her tuş vuruşunda adres yazmak geçmişi
  // kirletir. Debounce sonrası `replace` ile tek girdi olarak yazılır.
  const [q, setQ] = useState(degerler.q);
  const [view, setView] = useState<ViewMode>("list");

  // Dış navigasyon (geri/ileri, paylaşılan link) kutuyu günceller.
  useEffect(() => {
    setQ((onceki: string) => (degerler.q !== onceki ? degerler.q : onceki));
  }, [degerler.q]);

  /*
   * Olanaklar ve sıralama ADRESTE (9 Eyl 2026).
   *
   * Yerel state'teyken "Wi-Fi + otoparklı, puana göre" bir liste
   * paylaşılamıyor, yenilemede sıfırlanıyor ve geri tuşu onları geri
   * almıyordu — oysa `q` ve ilçe adreste yaşıyordu. Aynı ekranda bir filtre
   * URL'de, ötekisi değil.
   */
  const amenities = degerler.olanaklar;
  const sort = degerler.sirala;

  /*
   * KOORDİNAT ADRESE YAZILMAZ. Adres yalnız niyeti taşır
   * (`sirala=mesafe`); konum bağlantıyı açan kişiden yeniden istenir.
   */
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Sayfa durumu URL'de (bkz. lib/pagination.ts) — paylaşılan bağlantı
  // karşı tarafta ilk sayfaya dönmesin, geri tuşu listeyi sıfırlamasın.
  const limit = limitForPage(page, PER_PAGE);
  // Daralmış arama pill'ine tıklayınca geniş navbar'ı (kategoriler + büyük
  // arama) yerinde açar — eğitmen aramasındaki davranışın aynısı.
  const [searchOpen, setSearchOpen] = useState(false);
  /*
   * TELEFON KROMU — ana sayfayla AYNI (kullanıcı kararı, 10 Eyl 2026).
   *
   * Bu sayfa `useMobil()`i hiç çağırmıyordu: telefonda tam masaüstü
   * navbar'ı (logo + "Ders Ver" + "Giriş Yap") basılıyordu. Ana sayfada ise
   * `mobilSade` yüzünden o satır yok, yerinde kompakt arama hapı + kategori
   * çip şeridi duruyor. Sonuç: kategori şeridinden "Kütüphaneler"e basınca
   * üst bar bambaşka bir şeye dönüşüyor ve ekran "başka siteye gittim" gibi
   * okunuyordu. Kullanıcı: *"Airbnb'de diğer kategoriye tıklayınca sayfa
   * yenilenmiyor."*
   *
   * `Landing.tsx:167-178` ile bilinçli olarak BİREBİR aynı çağrı; iki yüzey
   * ortak keşif kabuğunda birleşene kadar bu ikizlik korunmalı.
   */
  const mobil = useMobil();
  const [mobilAramaAcik, setMobilAramaAcik] = useState(false);

  const debouncedQ = useDebounce(q);
  const setSurface = useSurfaceStore((s) => s.setSurface);

  // /hesabim bağlama duyarlı navbar: son yüzey = keşif.
  useEffect(() => {
    setSurface("discover");
  }, [setSurface]);

  // Debounce'lu metin adrese yazılır — `replace`, çünkü her harf ayrı bir
  // geçmiş girdisi olsaydı geri tuşu harf harf geri alırdı.
  useEffect(() => {
    if (debouncedQ.trim() !== degerler.q) ayarla({ q: debouncedQ }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  // "Yakınımda" sıralaması konum ister; reddedilirse sıralamayı geri al.
  const requestNearMe = (onFail?: () => void) => {
    if (!navigator.geolocation) {
      toast.error("Tarayıcınız konum servisini desteklemiyor.");
      onFail?.();
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNearMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoLoading(false);
      },
      () => {
        toast.error("Konum alınamadı. Lütfen izin verin.");
        setGeoLoading(false);
        onFail?.();
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const setSort = (value: LibrarySort) => ayarla({ sirala: value });

  // Sıralama seçimi: "Yakınımda" ilk kez seçilince konum iste.
  const handleSortChange = (value: LibrarySort) => {
    setSort(value);
    if (value === "distance" && !nearMe) requestNearMe(() => setSort(""));
  };

  const toggleAmenity = (a: string) =>
    ayarla({
      olanaklar: amenities.includes(a)
        ? amenities.filter((x) => x !== a)
        : [...amenities, a],
    });

  /*
   * Şema değeri → API isteği. Mahalle çapası ile "yakınımda" arasındaki
   * öncelik kuralı burada değil `aramaUrl`de yaşar: aynı kural eğitmen
   * aramasında da geçerliydi ve iki dosyaya kopyalanmıştı.
   */
  const params = useMemo<LibrarySearchParams>(
    () =>
      kutuphaneIstegi(
        { ...degerler, q: debouncedQ },
        { limit, offset: 0, konumum: nearMe }
      ),
    [degerler, debouncedQ, limit, nearMe]
  );

  const { data, isLoading, isFetching, isError, error } = useLibrarySearch(params);

  // Harita görünümü liste sayfalamasına takılmamalı: aynı filtrelerle TÜM eşleşen
  // kütüphaneleri tek seferde çek (yalnız harita açıkken). Liste 30'arlı kalır.
  const mapParams = useMemo<LibrarySearchParams>(
    () => ({ ...params, limit: 500, offset: 0 }),
    [params]
  );
  const { data: mapData, isLoading: mapLoading } = useLibrarySearch(
    mapParams,
    view === "map"
  );

  // Geniş aramada arama butonuna basınca (q/district zaten canlı state'i
  // sürdüğü için) yalnızca geniş paneli kapat.
  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchOpen(false);
  };

  /* ── Navbar ortası ──
     Kapalı: kompakt arama pill'i (tıklayınca geniş hali açar).
     Açık:  kategori çubuğu (sekmeler başka sayfaya götürür). */
  const navCenter = (
    <div key={searchOpen ? "cats" : "compact"} className="w-full animate-in fade-in duration-300">
      {/* Telefonda swap YOK: kompakt hap `mobilUst` yuvasında kalıcı durur,
          bu yuva her zaman kategori çiplerini taşır. İkisi birden basılsaydı
          aynı hapın iki kopyası mount edilir, `htmlFor` kimlikleri belgede
          ikilenirdi (bkz. `hooks/useMedyaSorgusu.ts`). */}
      {searchOpen || mobil ? (
        <CategoryBar active="kutuphaneler" />
      ) : (
        <div className="flex w-full justify-center">
          <CompactSearch
            active="kutuphaneler"
            placeholder={SEARCH_PLACEHOLDER}
            q={q}
            district={district}
            onOpen={() => setSearchOpen(true)}
          />
        </div>
      )}
    </div>
  );

  /* ── Navbar altı ──
     Açık: büyük arama hapı. Kapalı: sıralama + filtre chip çubuğu. */
  const bigSearchRow = (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">
      {/* Ana sayfadaki kütüphane hapının AYNISI (9 Eyl 2026).
          `KutuphaneArama` ana sayfada yaşıyordu; sekmeler gerçek gezinmeye
          dönünce orası tek vitrin oldu ve hap buraya taşındı. Üçüncü bir hap
          tasarımı (`BigSearch`) kalmadı — ikizlik nöbetçisi
          (`__guards__/aramaHapiIkizligi.test.ts`) artık bu dosyayı ölçüyor. */}
      <KutuphaneArama
        q={q}
        setQ={setQ}
        yer={yer}
        setYer={setYer}
        onSubmit={submitSearch}
      />
    </div>
  );

  /* Telefonun üst satırı: tek kompakt hap. Ana sayfadakiyle AYNI bileşen ve
     AYNI davranış — dokununca tam ekran arama yüzeyi açılır. */
  const mobilUst = mobil ? (
    <CompactSearch
      active="kutuphaneler"
      // Telefonda hap kategoriye göre değişen bir metin taşımaz: kategori
      // zaten hemen altındaki çip şeridinde seçili, hapın işi davet etmek.
      placeholder="Aramaya başlayın"
      q={q}
      district={district}
      onOpen={() => setMobilAramaAcik(true)}
    />
  ) : undefined;

  const filterBar = (
    <div className="flex justify-center w-full">
      <div
        className="flex items-center justify-center gap-2 overflow-x-auto px-6 pb-2.5 pt-3"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as CSSProperties}
      >
      {/* Filtreler (olanaklar) butonu */}
      <button
        onClick={() => setShowFilters(true)}
        /* `min-h-[44px] md:min-h-0`: şerit telefonda gövdeye indi ve gerçek
           Chrome turu çipleri 34px ölçtü (eşik 44). Masaüstünde şerit
           bugünkü inceliğini korur — büyüyen yalnız parmak alanı. */
        className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold shadow-sm transition hover:shadow md:min-h-0 ${
          amenities.length > 0
            ? "border-slate-900 bg-slate-900 text-white "
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 "
        }`}
      >
        <FilterIconSvg />
        Filtreler
        {amenities.length > 0 && (
          <span className="ml-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-marka px-1 text-[9px] font-bold text-marka-fg ">
            {amenities.length}
          </span>
        )}
      </button>

      <div className="h-5 w-px shrink-0 bg-slate-200 " />

      {/* Sıralama chip'leri */}
      {SORT_OPTIONS.map((opt) => (
        <button
          key={opt.value || "default"}
          onClick={() => handleSortChange(opt.value)}
          className={`min-h-[44px] shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition md:min-h-0 ${
            sort === opt.value
              ? "border-slate-900 bg-slate-900 text-white "
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 "
          }`}
        >
          {opt.label}
        </button>
      ))}

      {/* Aktif ilçe chip'leri */}
      {district.map((d) => (
        <button
          key={d}
          onClick={() => setDistrict(district.filter((x) => x !== d))}
          className="shrink-0 inline-flex items-center gap-1 rounded-full border border-marka-line bg-marka-soft px-3.5 py-1.5 text-sm font-medium text-marka-metin-hover transition hover:bg-marka-line "
        >
          {d}
          <span aria-hidden className="ml-0.5 text-xs">✕</span>
        </button>
      ))}

      {/* Aktif olanak chip'leri */}
      {amenities.map((a) => (
        <button
          key={a}
          onClick={() => toggleAmenity(a)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-marka-line bg-marka-soft px-3.5 py-1.5 text-sm font-medium text-marka-metin-hover transition hover:bg-marka-line "
        >
          {(() => { const I = amenityIcon(a); return <I size={14} stroke={1.75} aria-hidden />; })()}
          {amenityLabel(a)}
          <span aria-hidden className="ml-0.5 text-xs">✕</span>
        </button>
      ))}
      </div>
    </div>
  );

  const navBottom = searchOpen ? bigSearchRow : filterBar;

  const content = (
    <>
      {/* Telefonda tam ekran arama yüzeyi — ana sayfayla AYNI bileşen.
          Hap tek kopya olarak yalnız burada yaşar; navbar'ın alt yuvası
          telefonda bilerek boş bırakılıyor (bkz. `mobilUst`). */}
      <MobilAramaSheet
        open={mobilAramaAcik}
        onClose={() => setMobilAramaAcik(false)}
      >
        <KutuphaneArama
          q={q}
          setQ={setQ}
          yer={yer}
          setYer={setYer}
          onSubmit={(e) => {
            e.preventDefault();
            setMobilAramaAcik(false);
          }}
        />
      </MobilAramaSheet>
      {/* FİLTRE ŞERİDİ TELEFONDA GÖVDEDE (10 Eyl 2026).
          Navbar'ın `bottom` yuvasının `md:hidden`ı YOKTUR, yani şerit orada
          telefonda da çiziliyordu. Ama telefon kromu artık ana sayfayla aynı
          (hap + kategori çipleri) ve şeridi o yığına eklemek üst barı 136'dan
          ~181 piksele çıkarıyordu — iki rota ikiz olmaktan çıkardı ve tavan
          (140) aşılırdı.

          Çözüm: telefonda şerit üst barın PARÇASI değil, içeriğin ilk
          yapışkan satırı. Kaydırınca üst barın altına yapışır; `--yapiskan-ust`
          kabuklar tarafından yayınlanıyor (`PublicShell`, `DashboardShell`) ve
          bu onun ilk gerçek tüketicisi. Zemin ve alt çizgi `PublicNavbar` ile
          bilerek aynı: göz onu üst barın devamı olarak okur. */}
      {mobil && (
        <div
          className="-mx-4 mb-3 border-b border-slate-100 bg-[#fafafa]/85 backdrop-blur-md sticky z-20 md:hidden"
          style={{ top: "var(--yapiskan-ust, 0px)" }}
        >
          {filterBar}
        </div>
      )}
      {/* Geniş arama açıkken sayfayı hafifçe karart; tıklayınca kapat. */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 animate-in fade-in duration-200"
          onClick={() => setSearchOpen(false)}
        />
      )}
      <div className="mx-auto max-w-[1100px] space-y-5">
        <Seo
          title="Kütüphaneler ve Etüt Merkezleri"
          description="Bölgendeki çalışma kütüphanelerini ve etüt merkezlerini keşfet, değerlendirmeler, konum ve çalışma saatleriyle."
        />

        {/* KEŞİF ŞERİTLERİ — ana sayfadan taşındı (9 Eyl 2026).
            Sekmeler gerçek gezinmeye dönünce ana sayfa tek vitrin oldu ve
            ilçe şeritleri buraya geldi.

            YALNIZ FİLTRE YOKKEN görünür (kullanıcı kararı): Seyhan'a
            filtrelenmiş bir listenin üstünde "Çukurova Kütüphaneleri" şeridi
            hem çelişki hem de her tuş vuruşunda dört ek sorgu demek.
            `filtreli`, sayfayı filtre saymaz — 2. sayfaya geçmek şeritleri
            kaybettirmez. */}
        {!filtreli && (
          <div className="-mx-4 space-y-2 sm:-mx-6">
            {["Çukurova", "Seyhan", "Yüreğir", "Sarıçam"].map((ilce) => (
              <LibraryRow
                key={ilce}
                heading={`${ilce} Kütüphaneleri`}
                params={{ limit: 20, offset: 0, district: [ilce] }}
              />
            ))}
          </div>
        )}

        {/* ── Liste/Harita geçişi ── */}
        <div className="flex flex-wrap items-end justify-end gap-3">
          {/* Liste / Harita geçişi */}
          <div className="flex rounded-full bg-slate-100 p-1 ">
            {(["list", "map"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setView(m)}
                /* `min-h-[44px]` telefonda: gerçek Chrome turu bu iki
                   düğmeyi 32px ölçtü. `md:min-h-0` ile masaüstünde şerit
                   bugünkü inceliğini korur — büyüyen yalnız parmak alanı. */
                className={`min-h-[44px] rounded-full px-4 py-1.5 text-sm font-semibold transition md:min-h-0 ${
                  view === m
                    ? "bg-white text-marka-metin shadow-sm "
                    : "text-slate-500 hover:text-slate-700 "
                }`}
              >
                {m === "list" ? "☰ Liste" : "🗺️ Harita"}
              </button>
            ))}
          </div>
        </div>

        {geoLoading && (
          <p className="text-xs font-medium text-marka-metin animate-pulse">Konum bilgin alınıyor…</p>
        )}

        {/* ── Sonuçlar ── */}
        {isError ? (
          <div className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ">
            {getErrorMessage(error, "Kütüphaneler yüklenemedi.")}
          </div>
        ) : view === "map" ? (
          mapLoading && !mapData ? (
            <div className="h-[70vh] animate-pulse rounded-2xl bg-slate-100 " />
          ) : (
            <LibrariesMap libraries={mapData ?? []} />
          )
        ) : isLoading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-60 animate-pulse rounded-2xl bg-slate-100 "
              />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center ">
            <div className="text-4xl">📚</div>
            <p className="mt-4 text-sm font-medium text-slate-700 ">
              Kriterlere uyan kütüphane bulunamadı
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{data.length} kütüphane listeleniyor</span>
              {isFetching && <span className="animate-pulse">Güncelleniyor…</span>}
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.map((lib) => (
                <LibraryCard key={lib.id} library={lib} />
              ))}
            </div>
            {data.length === limit && (
              <div className="mt-2 flex justify-center">
                {/* Gerçek bağlantı: crawler takip edebilsin, kullanıcı yeni
                    sekmede açabilsin. Tıklama SPA içinde kalır. */}
                <Link
                  to={nextPageSearch(searchParams, page)}
                  className="inline-flex min-h-[44px] items-center rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-marka-soft-fg shadow-sm ring-1 ring-slate-200 transition hover:bg-marka-soft disabled:opacity-60 "
                >
                  {isFetching ? "Yükleniyor…" : "Daha fazla göster"}
                </Link>
              </div>
            )}
          </>
        )}

        {/* ── Filtre modalı (olanaklar) ── */}
        {showFilters && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center sm:p-6">
            <div className="absolute inset-0" onClick={() => setShowFilters(false)} />
            <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 ">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 ">
                <h2 className="text-lg font-bold text-slate-900 ">Olanaklar</h2>
                <button
                  onClick={() => setShowFilters(false)}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
                  aria-label="Kapat"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <p className="mb-3 text-sm text-slate-500 ">
                  Aradığın özelliklere sahip mekânları süz.
                </p>
                <div className="flex flex-wrap gap-2">
                  {AMENITY_OPTIONS.map((a) => {
                    const active = amenities.includes(a);
                    return (
                      <button
                        key={a}
                        onClick={() => toggleAmenity(a)}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition ${
                          active
                            ? "bg-marka text-marka-fg shadow-sm ring-1 ring-marka-focus"
                            : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 "
                        }`}
                      >
                        {(() => { const I = amenityIcon(a); return <I size={14} stroke={1.75} aria-hidden />; })()}
                        {amenityLabel(a)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:px-6 sm:py-5">
                <button
                  onClick={() => ayarla({ olanaklar: [] })}
                  className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 "
                >
                  Temizle
                </button>
                <button
                  onClick={() => setShowFilters(false)}
                  className="flex-[2] rounded-xl bg-marka px-4 py-3 text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95"
                >
                  Sonuçları Göster
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return token ? (
    <DashboardShell
      title="Kütüphaneler"
      navItems={navItems}
      center={navCenter}
      bottom={mobil ? undefined : navBottom}
      mobilUst={mobilUst}
      mobilSade={mobil}
      sekmeler={null}
    >
      {content}
    </DashboardShell>
  ) : (
    <PublicShell
      center={navCenter}
      bottom={mobil ? undefined : navBottom}
      mobilUst={mobilUst}
      mobilSade={mobil}
    >
      {content}
    </PublicShell>
  );
}
