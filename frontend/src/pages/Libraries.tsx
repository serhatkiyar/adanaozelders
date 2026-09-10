import { type CSSProperties, useMemo, useState } from "react";
import {Link} from "react-router-dom";
import {

  limitForPage,
  nextPageSearch,

} from "@/lib/pagination";
import { LibraryCard } from "@/components/LibraryCard";
import { LibrariesMap } from "@/components/LibrariesMap";
import { useLibrarySearch } from "@/hooks/useLibraries";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { Seo } from "@/components/Seo";
import { AMENITY_OPTIONS, amenityLabel } from "@/lib/amenities";
import { amenityIcon } from "@/lib/amenityIcons";
import { LibraryRow } from "@/components/VitrinSeridi";
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

const FilterIconSvg = () => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
  </svg>
);

/** Sayfa başına kütüphane sayısı. */
const PER_PAGE = 30;

/* ────────────────────────────────────────────────────────────────────────────
   KÜTÜPHANE LİSTESİ — artık yalnız GÖVDE.

   Üst bar, kategori şeridi, arama hapı ve tam ekran arama yüzeyi
   `components/kesif/KesifKabugu.tsx`e taşındı (10 Eyl 2026). Bu sayfa kendi
   kabuğunu basarken `/` ile buradaki her geçiş üst barı söküp yeniden
   kuruyordu; gerçek Chrome'la ölçüldü (tıklamadan önce ve sonra `header`
   FARKLI DOM nesneleriydi). Serbest metin ve yer artık kabuktaki hapta yaşıyor
   ve adrese yazılıyor; bu dosya onları YALNIZCA adresten OKUR.
   ──────────────────────────────────────────────────────────────────────── */
export default function Libraries() {

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
  const setDistrict = (v: string[]) => ayarla({ konum: { ...konum, ilce: v } });

  const [view, setView] = useState<ViewMode>("list");

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
        degerler,
        { limit, offset: 0, konumum: nearMe }
      ),
    [degerler, limit, nearMe]
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


  /* Filtre şeridi — üst barın PARÇASI DEĞİL, içeriğin ilk yapışkan satırı
     (10 Eyl 2026). Şerit eskiden navbar'ın `bottom` yuvasındaydı; o yuva artık
     keşif kabuğunun (arama hapının) ve şerit kategoriye ÖZEL olduğu için
     kabuğa çıkarılamıyor — kabuğa üç ayrı filtre modelini öğretmek demekti. */
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

  const content = (
    <>
      {/* FİLTRE ŞERİDİ — YALNIZ ARAMA/FİLTRE VARKEN (kullanıcı kararı,
          10 Eyl 2026).

          > *"filtre işlemi arama yapılınca olur, kütüphane kategorisine
          >  geçince değil."*

          Kategori değiştirmek bir arama DEĞİLDİR. Ana sayfadan Kütüphaneler'e
          geçen kişi keşfe gelmiştir; önüne sıralama ve olanak filtreleri
          koymak, sormadığı bir sorunun cevabını göstermektir. Şerit bir
          arama/filtre adreste yaşadığı anda belirir.

          Şerit üst barın PARÇASI DEĞİL, içeriğin ilk yapışkan satırı: navbar'ın
          `bottom` yuvasını keşif kabuğu (arama hapı) devraldı, ayrıca şeridi o
          yığına koymak üst barı 136'dan ~181 piksele çıkarıp `/` ile ikizliği
          bozuyordu. Konumunu `--yapiskan-ust`tan alır; zemin ve alt çizgi
          `PublicNavbar` ile bilerek aynı — göz onu üst barın devamı okur. */}
      {filtreli && (
        <div
          className="-mx-4 mb-3 border-b border-slate-100 bg-[#fafafa]/85 backdrop-blur-md sticky z-20 sm:-mx-6"
          style={{ top: "var(--yapiskan-ust, 0px)" }}
        >
          {filterBar}
        </div>
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

        {/* ── ARAMA SONUÇLARI — yalnız arama/filtre varken ──
            Filtre yokken bu blok HİÇ çizilmez: kategori değişimi ana sayfanın
            eğitmen vitrini gibi bir KEŞİF yüzeyi açar, arama sonucu değil.
            Liste/Harita anahtarı, sayaç, ızgara ve sayfalama sonuca aittir;
            ortada sonuç yokken hepsi anlamsızdır. */}
        {filtreli && (
        <>
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

  return content;
}
