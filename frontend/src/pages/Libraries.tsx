import { type CSSProperties, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {

  limitForPage,
  nextPageSearch,

} from "@/lib/pagination";
import { LibraryCard } from "@/components/LibraryCard";
import { LibrariesMap } from "@/components/LibrariesMap";
import { useLibrarySearch } from "@/hooks/useLibraries";
import { getErrorMessage } from "@/lib/errors";
import { Seo } from "@/components/Seo";
import { AMENITY_OPTIONS, amenityLabel } from "@/lib/amenities";
import { amenityIcon } from "@/lib/amenityIcons";
import { LibraryRow } from "@/components/VitrinSeridi";
import { AramaMobilBaslik, type FiltreCipi } from "@/components/AramaMobilBaslik";
import { MobilAramaAkisi } from "@/components/kesif/MobilAramaAkisi";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { useGeriDonus } from "@/hooks/useGeriDonus";
import { ROUTES } from "@/lib/routes";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import { kutuphaneHapBasligi } from "@/lib/aramaBasligi";
import { konumOzeti } from "@/lib/yerArama";
import { useYakinimdaKonum } from "@/hooks/useYakinimdaKonum";
import { useKonumStore } from "@/store/konumStore";
import { KUTUPHANE_ARAMA, kutuphaneIstegi } from "@/lib/aramaUrl";
import type { LibrarySearchParams } from "@/api/libraries";

type ViewMode = "list" | "map";
type LibrarySort = "rating" | "distance" | "";

/* `label` masaüstü açılır menüsü için ("Sıralama:" öneki menü kapalıyken ne
   seçildiğini söyler), `kisa` telefon şeridindeki çip için — orada yer dar ve
   önek her çipte tekrar ederdi. Eğitmen ekranındaki ayrımın aynısı. */
const SORT_OPTIONS: { value: LibrarySort; label: string; kisa: string }[] = [
  { value: "", label: "Sıralama: Önerilen", kisa: "Önerilen" },
  /* "Sıralama:" öneki menü KAPALIYKEN ne seçildiğini söyler — eğitmen
     ekranındaki kuralın aynısı. Emoji YOK: her platformda başka çiziliyor ve
     kendi rengini getiriyor. */
  { value: "rating", label: "Sıralama: En Yüksek Puan", kisa: "En yüksek puan" },
  { value: "distance", label: "Sıralama: Yakınımda", kisa: "Yakınımda" },
];

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
  const mobil = useMobil();
  /* Geri: geçmiş varsa bir adım geri, YOKSA filtresiz kütüphane listesine.
     Paylaşılan bir `?ilce=` bağlantısıyla gelen kullanıcıda `navigate(-1)`
     siteden ÇIKARIYOR — aynı tuzak eğitmen profilinde ölçülmüştü. */
  const geriDon = useGeriDonus(ROUTES.libraries);
  /* Telefon başlığındaki hap adımlı arama yüzeyini açar. Yüzey kendi kendine
     yeten bir bileşen (`MobilAramaAkisi`); eğitmen sonuç ekranı da onu böyle
     açıyor. Kabuktaki kopyası bu ekranda gizli üst barla birlikte erişilemez
     olduğu için sayfa kendi örneğini çiziyor. */
  const [aramaAcik, setAramaAcik] = useState(false);

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
  /* KONUM ORTAK DEPODAN (16 Eyl 2026). Eskiden bu sayfa kendi `nearMe`
     state'ini tutup yalnız "mesafe" sıralaması seçilince konum istiyordu;
     adresteki `yakinimda=1` niyeti (telefonun adımlı yüzeyi, masaüstü hapı,
     paylaşılan bağlantı) HİÇ okunmuyordu — liste "Tüm Adana" dönüyordu.
     Artık niyet nereden gelirse gelsin tek hook konum ister; izin yoksa
     niyet adresten düşer. Eğitmen sonuç sayfalarıyla aynı depo. */
  const konumum = useKonumStore((s) => s.konum);
  const geoLoading = useKonumStore((s) => s.yukleniyor);
  const [showFilters, setShowFilters] = useState(false);
  // Sayfa durumu URL'de (bkz. lib/pagination.ts) — paylaşılan bağlantı
  // karşı tarafta ilk sayfaya dönmesin, geri tuşu listeyi sıfırlamasın.
  const limit = limitForPage(page, PER_PAGE);
  useYakinimdaKonum(degerler.yakinimda || degerler.sirala === "distance", () =>
    ayarla({ yakinimda: false, yaricap: undefined, sirala: "" }, { replace: true })
  );

  const setSort = (value: LibrarySort) => ayarla({ sirala: value });

  // "Mesafe" sıralaması konumu `useYakinimdaKonum` üzerinden ister.
  const handleSortChange = (value: LibrarySort) => setSort(value);

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
        { limit, offset: 0, konumum }
      ),
    [degerler, limit, konumum]
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
      {/* `justify-center` + `overflow-x-auto` telefonda ŞERİDİ İKİ UCUNDAN
          KIRPIYORDU: içerik kaptan genişse ortalama taşmayı iki yana eşit
          dağıtır, yani şerit ortasından açılır — soldaki "Filtreler" düğmesi
          yarım görünüyordu (ölçüldü, 11 Eyl 2026). Telefonda soldan başlar
          (eğitmen sonuç ekranındaki çip şeridi gibi), sığdığı genişlikten
          itibaren yine ortalanır. */}
      <div
        className="flex items-center justify-start gap-2 overflow-x-auto px-4 pb-2.5 pt-3 md:justify-center md:px-6"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as CSSProperties}
      >
      {/* Filtreler (olanaklar) butonu */}
      <button
        onClick={() => setShowFilters(true)}
        /* `min-h-[44px] md:min-h-0`: şerit telefonda gövdeye indi ve gerçek
           Chrome turu çipleri 34px ölçtü (eşik 44). Masaüstünde şerit
           bugünkü inceliğini korur — büyüyen yalnız parmak alanı. */
        /* Dolgu kuralı eğitmen ekranıyla AYNI: yalnız "olanaklar" değil,
           aramada etkin BİR filtre varsa düğme dolu çizilir. Eskiden ilçeye
           göre filtrelenmiş bir listede bile boş görünüyordu. */
        className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold shadow-sm transition hover:shadow md:min-h-0 ${
          filtreli
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

      {/* Sıralama AÇILIR MENÜ — eğitmen sonuç ekranıyla birebir aynı bileşen
          dili (11 Eyl 2026). Burada üç ayrı çip vardı: aynı şeridin içinde
          "Filtreler" bir düğme, sıralama üç çip, aktif filtreler yine çip
          oluyordu — üç ayrı anlam tek bir görsel dille yazılınca hangisinin ne
          yaptığı okunmuyordu. Sıralama tek bir yerden seçilen TEK değerdir,
          açılır menü tam olarak bunu söyler ve şeridin genişliğini de üç
          çipten tek kutuya indirir. */}
      <div className="relative shrink-0">
        <select
          value={sort}
          onChange={(e) => handleSortChange(e.target.value as LibrarySort)}
          aria-label="Sıralama"
          className={`min-h-[44px] appearance-none rounded-full border px-3.5 py-1.5 pr-8 text-sm font-medium outline-none transition focus:ring-2 focus:ring-marka-focus/20 md:min-h-0 ${
            sort
              ? "border-slate-900 bg-slate-900 text-white "
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 "
          }`}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value || "default"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div
          className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${
            sort ? "text-white " : "text-slate-400 "
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

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

  /* ── TELEFON BAŞLIĞI — eğitmen sonuç ekranıyla AYNI bileşen ──
     Kullanıcı kararı, 11 Eyl 2026: *"arama çubuğunun altında direkt filtreler
     olması gerekiyor, burada tekrar kategoriler gösteriyor… geri çıkma butonu
     yok arama çubuğunun solunda ve filtre butonu da sağında olmalı."*

     Kabuğun telefon üst barı (hap + kategori şeridi) bu ekranda GİZLENİR
     (`mobilUstGizle`) ve sayfa kendi başlığını çizer. Çipler ve sıralama
     `AramaMobilBaslik`in kendi şeridinde; masaüstündeki geniş filtre şeridi
     `md:` altında çizilmez, ikisi aynı anda görünmez. */
  const mobilCipler: FiltreCipi[] = [
    ...district.map((d) => ({
      id: `ilce-${d}`,
      etiket: `${d} ✕`,
      aktif: true,
      onClick: () => setDistrict(district.filter((x) => x !== d)),
    })),
    ...amenities.map((a) => ({
      id: `olanak-${a}`,
      etiket: `${amenityLabel(a)} ✕`,
      aktif: true,
      onClick: () => toggleAmenity(a),
    })),
  ];

  const mobilHap = kutuphaneHapBasligi({
    konum: konumOzeti({ yer: konum.yer, ilce: district, yakinimda: degerler.yakinimda }),
    olanakSayisi: amenities.length,
  });
  const mobilBaslik = (
    <div
      className="-mx-4 mb-3 border-b border-slate-100 bg-[#fafafa]/95 px-4 pb-2 pt-3 backdrop-blur-md sticky z-30 md:hidden"
      style={{ top: "var(--yapiskan-ust, 0px)" }}
    >
      <AramaMobilBaslik
        baslik={mobilHap.baslik}
        ozet={mobilHap.ozet}
        onHap={() => setAramaAcik(true)}
        onGeri={geriDon}
        onFiltre={() => setShowFilters(true)}
        filtreSayisi={amenities.length}
        siralama={{
          deger: sort,
          secenekler: SORT_OPTIONS.map((o) => ({ value: o.value, kisa: o.kisa })),
          onChange: (v) => handleSortChange(v as LibrarySort),
          varsayilan: "",
        }}
        cipler={mobilCipler}
        filtreIkonu={<FilterIconSvg />}
      />
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
      {filtreli && mobil && mobilBaslik}
      {filtreli && (
        <div
          className="-mx-4 mb-3 hidden border-b border-slate-100 bg-[#fafafa]/85 backdrop-blur-md sticky z-20 sm:-mx-6 md:block"
          style={{ top: "var(--yapiskan-ust, 0px)" }}
        >
          {filterBar}
        </div>
      )}
      {/* Başlıktaki hapın açtığı adımlı arama yüzeyi. */}
      {mobil && (
        <MobilAramaAkisi acik={aramaAcik} onKapat={() => setAramaAcik(false)} />
      )}
      <Seo
        title="Kütüphaneler ve Etüt Merkezleri"
        description="Bölgendeki çalışma kütüphanelerini ve etüt merkezlerini keşfet, değerlendirmeler, konum ve çalışma saatleriyle."
      />

      {/* KEŞİF ŞERİTLERİ — ana sayfadaki eğitmen vitriniyle AYNI ÖLÇEK.
          Şeritler `max-w-[1100px]` kabının ve `-mx-4` negatif margin'inin
          DIŞINDA durur; ikisi de kartı küçültüp/büyütüp ana sayfayla ayrışmaya
          yol açıyordu.

          ÖLÇÜLDÜ (gerçek Chrome, 10 Eyl 2026 — kullanıcı: *"kütüphanelerde
          farklı ölçek kullanılıyor, eğitmenlerde farklı"*):

            telefon   eğitmen kartı 157px · kütüphane kartı 173px
            masaüstü  eğitmen kartı 218px · kütüphane kartı 204px

          Kart sınıfı (`VITRIN_KART`) ve boşluklar İKİSİNDE DE AYNIYDI; ayrışan
          şey KAPTI. Genişlik kaptan yüzde hesabıyla türediği için farklı taban
          = farklı kart. `VitrinSeridi` zaten kendi `max-w-[1216px] px-4`ünü
          uyguluyor; sayfanın ikinci bir kap koymaması yeter.

          YALNIZ FİLTRE YOKKEN görünür (kullanıcı kararı): Seyhan'a
          filtrelenmiş bir listenin üstünde "Çukurova Kütüphaneleri" şeridi hem
          çelişki hem de her tuş vuruşunda dört ek sorgu demek. */}
      {!filtreli && (
        <div className="space-y-2">
          {["Çukurova", "Seyhan", "Yüreğir", "Sarıçam"].map((ilce) => (
            <LibraryRow
              key={ilce}
              heading={`${ilce} Kütüphaneleri`}
              params={{ limit: 20, offset: 0, district: [ilce] }}
            />
          ))}
        </div>
      )}

      <div className="mx-auto max-w-[1100px] space-y-5">

        {/* ── ARAMA SONUÇLARI — yalnız arama/filtre varken ──
            Filtre yokken bu blok HİÇ çizilmez: kategori değişimi ana sayfanın
            eğitmen vitrini gibi bir KEŞİF yüzeyi açar, arama sonucu değil.
            Liste/Harita anahtarı, sayaç, ızgara ve sayfalama sonuca aittir;
            ortada sonuç yokken hepsi anlamsızdır. */}
        {filtreli && (
        <>
        {/* ── Sonuç satırı: solda sayaç, sağda Liste/Harita ──
            Anahtar eskiden TEK BAŞINA sağa yaslı bir satırdaydı: 64px boş yer
            yiyor, hiçbir şeye tutunmuyor ve ilk kartı katlamanın altına
            itiyordu (eğitmen sonuç ekranında böyle bir satır yok). Sayaç
            aşağıdan buraya çıktı; ikisi tek satırda dengeleniyor. */}
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-slate-400">
            {view === "list" && data && data.length > 0
              ? `${data.length} kütüphane listeleniyor`
              : ""}
            {isFetching && <span className="animate-pulse"> Güncelleniyor…</span>}
          </p>
          <div className="flex shrink-0 rounded-full bg-slate-100 p-1 ">
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
                {m === "list" ? "Liste" : "Harita"}
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
            {/* Izgara boşluğu eğitmen sonuç ekranıyla AYNI (`gap-8`);
                `gap-6`ydı ve iki liste yan yana konunca ayrışıyordu. */}
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
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
