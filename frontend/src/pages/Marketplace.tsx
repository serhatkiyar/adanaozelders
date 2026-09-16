import { type CSSProperties, useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { AramaMobilBaslik, type FiltreCipi } from "@/components/AramaMobilBaslik";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { TutorCard } from "@/components/TutorCard";
import { FeaturedTutorBlock } from "@/components/FeaturedTutorBlock";
import { PriceRangeHistogram } from "@/components/PriceRangeHistogram";
import { useTutorSearch, useTutorPriceHistogram } from "@/hooks/useTutorSearch";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDebounce } from "@/hooks/useDebounce";
import { getErrorMessage } from "@/lib/errors";
import { useSurfaceStore } from "@/store/surfaceStore";
import { ROLE_IDS, TeachingMode } from "@/types";
import type { FeaturedTutorParams, TutorSearchParams } from "@/api/tutors";
import { CategoryBar, type CategoryKey } from "@/components/CategoryBar";
import { CompactSearch, DersArama, KutuphaneArama } from "@/components/HeroSearch";
import { MobilAramaAkisi } from "@/components/kesif/MobilAramaAkisi";
import { egitmenHapBasligi } from "@/lib/aramaBasligi";
import { ilceListesindenYer, konumOzeti, yerinIlceleri, type YerSecimi } from "@/lib/yerArama";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import { EgitmenFiltreModali } from "@/components/EgitmenFiltreModali";
import { useKonumStore } from "@/store/konumStore";
import { useYakinimdaKonum } from "@/hooks/useYakinimdaKonum";
import { bosDeger, filtreliMi } from "@/lib/urlSemasi";
import {
  EGITMEN_ARAMA,
  dersSorgusu,
  egitmenIstegi,
  kutuphaneAramaAdresi,
  type EgitmenAramasi,
} from "@/lib/aramaUrl";
import { type DersSekli } from "@/components/AramaSecicileri";

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

const MODE_ALL = "ALL" as const;
/** Aramada yalnız iki şekil vardır; `BOTH` filtre olarak anlamsızdır. */
type AramaSekli = EgitmenAramasi["sekil"][number];

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
    yakinimda,
  } = degerler;
  const district = konum.ilce;
  const yer = konum.yer;

  const setExam = (v: string) => ayarla({ sinav: v });

  // Serbest metin YEREL: her tuş vuruşunda adres yazmak geçmişi kirletir.
  const [q, setQ] = useState(degerler.q);
  useEffect(() => {
    setQ((onceki: string) => (degerler.q !== onceki ? degerler.q : onceki));
  }, [degerler.q]);

  const [showFilters, setShowFilters] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobilAramaAcik, setMobilAramaAcik] = useState(false);
  const mobil = useMobil();
  const navigate = useNavigate();
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
  // Konum artık `store/konumStore`da: YAZAN yer filtre penceresi (ortak
  // bileşen), OKUYAN yer bu sayfa. Yerel state ile paylaşılamazdı.
  const konumum = useKonumStore((s) => s.konum);
  /* Adresteki "yakınımda" niyeti koordinat ister; izin yoksa bayrak düşer. */
  useYakinimdaKonum(yakinimda, () =>
    ayarla({ yakinimda: false, yaricap: undefined }, { replace: true })
  );

  const modeSegment: AramaSekli | typeof MODE_ALL = modes[0] ?? MODE_ALL;


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
        { limit, offset: 0, konumum }
      ),
    [degerler, debouncedQ, limit, konumum]
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


  const hasModalFilters =
    !!minRate || !!maxRate || !!gender || !!minAge || !!maxAge || yakinimda;
  /* Filtre PENCERESİNDEKİ etkin grup sayısı (başlıktaki rozet); fiyat ve yaş
     aralığı birer grup. */
  const mobilFiltreSayisi =
    (minRate || maxRate ? 1 : 0) +
    (gender ? 1 : 0) +
    (minAge || maxAge ? 1 : 0) +
    (yakinimda ? 1 : 0);

  // "Filtre var mı" artık şemadan gelir: yeni bir alan eklendiğinde bu satırı
  // güncellemeyi unutmak, temizle düğmesini sessizce yanlış gösterirdi.
  const hasFilters = filtreliMi(EGITMEN_ARAMA, degerler) || !!q;

  const clearAll = () => {
    setQ("");
    setMinRate(""); setMaxRate(""); setMinAge(""); setMaxAge("");
    useKonumStore.getState().unut();
    ayarla(bosDeger(EGITMEN_ARAMA));
    setLimit(20);
  };

  // Geniş aramada arama butonuna basınca (q/district zaten canlı state'i
  // sürdüğü için) yalnızca geniş paneli kapat.
  /* Taslak: geniş hap her AÇILIŞTA adresten yeniden çözülür — kullanıcı
     hapı kapatıp çipten filtre değiştirse bile bir sonraki açılış güncel. */
  const taslagiCoz = () => ({
    ders: subjects[0] ?? "",
    dersEtiket: subjects[0] ?? q,
    sekil: (modes[0] ?? "") as DersSekli,
    yer: ilceListesindenYer(yer, district),
    yakinimda: yakinimda,
  });
  const [taslak, setTaslak] = useState(taslagiCoz);
  /* Geniş aramadaki sekme (16 Eyl 2026): "Kütüphaneler"e basmak sayfayı
     değiştirmez, formu kütüphane hapına çevirir; Ara → /kutuphaneler. Eğitmen
     taslağı bu arada durur, sekme geri gelince aynen görünür. */
  const [aramaKategori, setAramaKategori] = useState<CategoryKey>("egitmenler");
  const [kTaslak, setKTaslak] = useState<{ yer: YerSecimi | null; yakinimda: boolean }>({
    yer: null,
    yakinimda: false,
  });
  const [oncekiAcik, setOncekiAcik] = useState(false);
  if (searchOpen !== oncekiAcik) {
    setOncekiAcik(searchOpen);
    if (searchOpen) {
      setTaslak(taslagiCoz());
      setAramaKategori("egitmenler");
    }
  }
  const submitKutuphane = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(
      kutuphaneAramaAdresi({
        konum: {
          yer: kTaslak.yer?.tur === "mahalle" ? kTaslak.yer : null,
          ilce: yerinIlceleri(kTaslak.yer),
        },
        yakinimda: kTaslak.yakinimda,
      })
    );
    setSearchOpen(false);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    ayarla({
      ...dersSorgusu(taslak.ders, taslak.dersEtiket),
      sekil: taslak.sekil ? [taslak.sekil] : [],
      konum: {
        yer: taslak.yer?.tur === "mahalle" ? taslak.yer : null,
        ilce: yerinIlceleri(taslak.yer),
      },
      yakinimda: taslak.yakinimda,
    });
    setSearchOpen(false);
  };

  /* ── Navbar ortası ──
     Kapalı: kompakt arama pill'i (tıklayınca geniş hali açar).
     Açık:  ana sayfadaki kategori çubuğu (sekmeler başka sayfaya götürür). */
  /* Hapın iki satırı (telefonda başlık, masaüstünde daralmış hap) `lib/aramaBasligi`den: konum seçiliyse başlık konumu
     söyler ("Çukurova bölgesindeki eğitmenler"), alt satır ders + şekil. */
  const mobilHap = egitmenHapBasligi({
    q,
    dersler: subjects,
    konum: konumOzeti({
      yer,
      ilce: district,
      yakinimda: yakinimda,
      uzaktan: modeSegment === TeachingMode.ONLINE,
    }),
    sekil: modeSegment,
  });

  const navCenter = (
    <div key={searchOpen ? "cats" : "compact"} className="w-full animate-in fade-in duration-300">
      {searchOpen ? (
        <CategoryBar active={aramaKategori} onSec={setAramaKategori} />
      ) : (
        <div className="flex w-full justify-center">
          <CompactSearch
            active="egitmenler"
            placeholder="Ders ekleyin"
            /* Seçili ders de görünür (kullanıcı, 16 Eyl 2026: "Matematik
               seçiyorum, çubukta yazmıyor"): `q` yalnız serbest metindi,
               katalogdan seçilen `ders` hapa hiç gitmiyordu. */
            /* Telefon başlığıyla aynı kaynaktan; masaüstünde "|" ile
               ayrılmış parçalar: "Çukurova | Matematik | Yüz yüze". */
            parcalar={mobilHap.parcalar}
            onOpen={() => setSearchOpen(true)}
          />
        </div>
      )}
    </div>
  );

  /* ── Navbar altı ──
     Açık: ana sayfadaki büyük arama hapı. Kapalı: filtre çubuğu. */
  /* GENİŞ ARAMA = ANA SAYFADAKİ HAP, ADRESTEN DOLU (kullanıcı kararı,
     16 Eyl 2026: "tekrar çubuğa tıklayınca aramayı yaparkenki bilgiler
     orada girili olmalı"). Eskiden burada ayrı bir `BigSearch` vardı (yer +
     ders); ders şeklini ve Yakınımda'yı bilmiyor, seçilmiş dersi de
     göstermiyordu. Taslak hap açıldığında adresten çözülür; Ara adrese
     yazar. Telefonun adımlı yüzeyi (`MobilAramaAkisi`) aynı şeyi yapıyor. */
  const bigSearchRow = (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">
      {aramaKategori === "kutuphaneler" ? (
        <KutuphaneArama
          yer={kTaslak.yer}
          /* Fonksiyonel güncelleme ŞART: hap yer seçince art arda setYer ve
             setYakinimda(false) çağırır; ikincisi eski kapanıştaki `yer`i
             (null) geri yazıyordu, Merkez seçimi kayboluyordu (ölçüldü). */
          setYer={(v) =>
            setKTaslak((o) => ({ yer: v, yakinimda: v ? false : o.yakinimda }))
          }
          yakinimda={kTaslak.yakinimda}
          setYakinimda={(v) =>
            setKTaslak((o) => ({ yer: v ? null : o.yer, yakinimda: v }))
          }
          onSubmit={submitKutuphane}
        />
      ) : (
      <DersArama
        ders={taslak.ders}
        dersEtiket={taslak.dersEtiket}
        onDersChange={(qDeger, etiket) =>
          setTaslak((o) => ({ ...o, ders: qDeger, dersEtiket: etiket }))
        }
        sekil={taslak.sekil}
        setSekil={(v) => setTaslak((o) => ({ ...o, sekil: v }))}
        yer={taslak.yer}
        setYer={(v) => setTaslak((o) => ({ ...o, yer: v }))}
        yakinimda={taslak.yakinimda}
        setYakinimda={(v) => setTaslak((o) => ({ ...o, yakinimda: v }))}
        onSubmit={submitSearch}
      />
      )}
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
        className={`relative flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold shadow-sm transition hover:shadow ${
          hasModalFilters
            ? "border-slate-900 bg-white text-slate-900 "
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 "
        }`}
      >
        <FilterIconSvg />
        Filtreler
        {/* Etkin filtre SAYISI, telefon başlığındaki rozetle aynı dil
            (koyu, küçük). Turuncu onay işareti marka aksanını aksiyon dışı
            bir yerde kullanıyordu. */}
        {hasModalFilters && (
          <span
            aria-hidden
            className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-slate-900 px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-white"
          >
            {mobilFiltreSayisi}
          </span>
        )}
      </button>

      {/* SIRALAMA YOK (kullanıcı kararı, 16 Eyl 2026): şerit "Filtreler |
          uygulanan filtreler" — tek ayraç. */}

      <div className="h-5 w-px shrink-0 bg-slate-200 " />

      {/* Fiyat Popover Butonu */}
      <div className="relative shrink-0">
        <button
          ref={pricePopoverRef}
          type="button"
          onClick={togglePricePopover}
          className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
            minRate || maxRate
              ? "border-slate-900 bg-white text-slate-900 "
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

      {/* DERS ÇİPİ ve DERS ŞEKLİ ŞERİTTE YOK (kullanıcı kararı, 16 Eyl 2026):
          ikisi de üstteki hapta yazıyor ("Çukurova bölgesindeki eğitmenler /
          Matematik • Yüz yüze"); şeritte tekrar gürültüydü. Değiştirmek için
          hap açılır. Sınav çipi kalıyor — hap onu taşımıyor. */}
      </div>
    </div>
  );

  const navBottom = searchOpen ? bigSearchRow : filterBar;

  /* ── TELEFON: geri · hap · filtre, altında yatay filtre şeridi ──
     Anonim taraftaki (`PublicMarketplace`) ekranla AYNI görünüm; ortak bileşen
     `AramaMobilBaslik`. İkisi aynı ekrandır, iki kez yazılsaydı zamanla
     birbirine benzemez hâle gelirdi.

     Filtre modeli iki sayfada farklıdır ve bu yüzden çipleri her sayfa KENDİ
     durumundan üretir: burada ders şekli `modes` DİZİSİdir (`selectMode` tek
     değere indirger), anonim tarafta tek bir `sekil` değeridir. */
  /* Hap İKİ bilgiyi HER ZAMAN söyler (kullanıcı kararı, 16 Eyl 2026; Airbnb
     "Herhangi hafta • Misafir ekleyin" gibi): yer yoksa "Tüm Adana", ders
     şekli yoksa "Ders şekli ekleyin" daveti. Boş parça gizlenmez — kullanıcı
     neyi SEÇMEDİĞİNİ de görür ve hap onu tamamlamaya çağırır. */

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
      cipler={mobilCipler}
      filtreIkonu={<FilterIconSvg />}
    />
  ) : undefined;

  return (
    <DashboardShell
      title="Eğitmen Bul"
      navItems={navItems}
      center={mobil ? undefined : navCenter}
      bottom={mobil ? undefined : navBottom}
      mobilUst={mobilUst}
      mobilSade={mobil}
      sekmeler={null}
    >
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
      {/*
        * Pencere `components/EgitmenFiltreModali`ye çıktı: anonim yüzeyle
        * ORTAK. Ayrı yazılan ikinci yüzey ayrışmış ve boşalmıştı; ortak
        * bileşen o kusurun tekrarını imkânsız kılıyor.
        */}
      <EgitmenFiltreModali
        acik={showFilters}
        kapat={() => setShowFilters(false)}
        onTemizle={() => {
          // Sayfanın KENDİ yerel durumu: "daha fazla göster" ile büyüyen
          // liste sınırı ve serbest metin kutusu.
          setQ("");
          setLimit(20);
        }}
      />
    </DashboardShell>
  );
}
