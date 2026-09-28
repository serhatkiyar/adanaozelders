import { KART_IZGARASI } from "@/components/kartIzgarasi";
import { type CSSProperties, useEffect, useMemo, useState, useCallback } from "react";
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
import { TeachingMode } from "@/types";
import type { FeaturedTutorParams, TutorSearchParams } from "@/api/tutors";
import { CategoryBar, type CategoryKey } from "@/components/CategoryBar";
import { CompactSearch, DersArama, KutuphaneArama } from "@/components/HeroSearch";
import { MobilAramaAkisi } from "@/components/kesif/MobilAramaAkisi";
import { type DersSekli } from "@/components/AramaSecicileri";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import { EGITMEN_ARAMA, dersSorgusu, egitmenIstegi, kutuphaneAramaAdresi } from "@/lib/aramaUrl";
import { bosDeger, filtreliMi } from "@/lib/urlSemasi";
import { EgitmenFiltreModali } from "@/components/EgitmenFiltreModali";
import { useKonumStore } from "@/store/konumStore";
import { useYakinimdaKonum } from "@/hooks/useYakinimdaKonum";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { AramaMobilBaslik, type FiltreCipi } from "@/components/AramaMobilBaslik";
import { FiltreAcilir } from "@/components/FiltreAcilir";
import { FiyatAraligi } from "@/components/FiyatAraligi";
import { MesafeSecici } from "@/components/MesafeSecici";
import { SeviyeSecici } from "@/components/SeviyeSecici";
import { useSeviyeSecenekleri } from "@/hooks/useSubjects";
import { egitmenHapBasligi, uzaklikCipi } from "@/lib/aramaBasligi";
import { ilceListesindenYer, konumOzeti, yerinIlceleri, type YerSecimi } from "@/lib/yerArama";

/* ─── options ─────────────────────────────────────────── */

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

  const setExam = (v: string) => ayarla({ sinav: v });

  // Sıralama ADRESTE (9 Eyl 2026). Yerel state'teyken paylaşılamıyor,
  // yenilemede sıfırlanıyor ve geri tuşu onu geri almıyordu — incelenen yedi
  const [showFilters, setShowFilters] = useState(false);
  /* Şeritteki açılır çipler: tek seferde tek pencere. */
  const [acikFiltre, setAcikFiltre] = useState<"fiyat" | "uzaklik" | "seviye" | null>(null);
  const kapatAcilir = useCallback(() => setAcikFiltre(null), []);
  // Filtre ÇUBUĞUNDAKİ "Seviye" çipiyle filtre penceresi ORTAK hook kullanır.
  const seviyeMerdivenleri = useSeviyeSecenekleri(subjects);
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

  const { data, isLoading, isFetching, isError, error, refetch } = useTutorSearch(params);

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
    (degerler.yakinimda ? 1 : 0) +
    (degerler.seviye !== undefined ? 1 : 0);

  const seoTitle = subjects.length
    ? `${subjects.join(", ")} Öğretmenleri`
    : debouncedQ.trim()
      ? `"${debouncedQ.trim()}" için öğretmenler`
      : "Öğretmen Ara";
  const seoDesc = subjects.length
    ? `Adana'da ${subjects.join(", ")} dersi veren onaylı, uzman özel ders öğretmenlerini keşfet.`
    : "Adana'daki onaylı özel ders öğretmenlerini puan, fiyat ve branşa göre ara.";

  // Geniş aramada arama butonuna basınca (q/district zaten canlı state'i
  // sürdüğü için) yalnızca geniş paneli kapat.
  /* Taslak: geniş hap her AÇILIŞTA adresten yeniden çözülür — kullanıcı
     hapı kapatıp çipten filtre değiştirse bile bir sonraki açılış güncel. */
  const taslagiCoz = () => ({
    ders: subjects[0] ?? "",
    dersEtiket: subjects[0] ?? q,
    sekil: sekil as DersSekli,
    yer: ilceListesindenYer(yer, district),
    yakinimda: degerler.yakinimda,
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
      yakinimda: degerler.yakinimda,
      uzaktan: sekil === TeachingMode.ONLINE,
    }),
    sekil: sekil,
  });

  const navCenter = (
    <div key={searchOpen ? "cats" : "compact"} className="w-full animate-in fade-in duration-300">
      {searchOpen ? (
        <CategoryBar active={aramaKategori} onSec={setAramaKategori} />
      ) : (
        <div className="flex w-full justify-center">
          <CompactSearch
            active="egitmenler"
            placeholder="Aramaya başlayın"
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
          hasActiveFilters
            ? "border-slate-900 bg-white text-slate-900 "
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 "
        }`}
      >
        <FilterIconSvg />
        Filtreler
        {mobilFiltreSayisi > 0 && (
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

      {/* AÇILIR ÇİPLER — Airbnb "Fiyat ⌄ / Yerin türü ⌄" (kullanıcı kararı,
          16 Eyl 2026). Gövdeler filtre penceresiyle ORTAK bileşen. */}
      <FiltreAcilir
        etiket="Fiyat"
        aktif={degerler.minFiyat !== undefined || degerler.maxFiyat !== undefined}
        acik={acikFiltre === "fiyat"}
        onAc={() => setAcikFiltre("fiyat")}
        onKapat={kapatAcilir}
        onTemizle={() => ayarla({ minFiyat: undefined, maxFiyat: undefined })}
      >
        <FiyatAraligi acik={acikFiltre === "fiyat"} />
      </FiltreAcilir>
      {/* Seviye çipi — yalnız tek ders seçiliyken (aksi halde hangi dersin
          seviyesi olduğu belirsiz). Fiyat ile Cinsiyet arasında (kullanıcı
          kararı, 20 Eyl 2026: "fiyat, seviye, cinsiyet şeklinde
          sıralanabilir"); Cinsiyet'in zaten masaüstü çipi yok, yalnız
          pencerede. */}
      {seviyeMerdivenleri.length > 0 && (
        <FiltreAcilir
          etiket="Seviye"
          aktif={degerler.seviye !== undefined}
          acik={acikFiltre === "seviye"}
          onAc={() => setAcikFiltre("seviye")}
          onKapat={kapatAcilir}
          onTemizle={() => ayarla({ seviye: undefined })}
        >
          <SeviyeSecici
            merdivenler={seviyeMerdivenleri}
            secili={degerler.seviye}
            sec={(id) => ayarla({ seviye: id })}
          />
        </FiltreAcilir>
      )}
      {degerler.yakinimda && (
        <FiltreAcilir
          etiket={uzaklikCipi(degerler.yaricap)}
          aktif
          acik={acikFiltre === "uzaklik"}
          onAc={() => setAcikFiltre("uzaklik")}
          onKapat={kapatAcilir}
          onTemizle={() => ayarla({ yakinimda: false, yaricap: undefined })}
          genislik="w-[460px]"
        >
          <MesafeSecici
            yaricap={degerler.yaricap}
            sec={(km) => ayarla({ yakinimda: true, yaricap: km })}
            kaldir={() => ayarla({ yakinimda: false, yaricap: undefined })}
          />
        </FiltreAcilir>
      )}

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
          ikisi de üstteki hapta yazıyor ("Çukurova bölgesindeki öğretmenler /
          Matematik • Yüz yüze"); şeritte tekrar gürültüydü. Değiştirmek için
          hap açılır. Sınav çipi kalıyor — hap onu taşımıyor. */}
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

  /* Çipler UYDURMA DEĞİL: hepsi zaten adreste yaşayan ve arama isteğine giden
     filtrelerdir. Ders şekli TEK seçimdir — aynı çipe tekrar dokunmak filtreyi
     kaldırır; iki çip birden seçili görünseydi kullanıcıya olmayan bir
     kombinasyon vaat edilirdi. */
  /* Şeritte DERS ŞEKLİ ve DERS ÇİPİ YOK (kullanıcı kararı, 16 Eyl 2026):
     ikisi de hapın iki satırında zaten yazıyor ("Matematik • Uzaktan");
     şeritte tekrarı gürültüydü. Değiştirmek için hap dokunulur. Sınav çipi
     kalıyor — hap onu taşımıyor. */
  const mobilCipler: FiltreCipi[] = [
    ...(degerler.minFiyat !== undefined || degerler.maxFiyat !== undefined
      ? [{ id: "fiyat", etiket: "Fiyat", aktif: true, onClick: () => setShowFilters(true) }]
      : []),
    ...(degerler.seviye !== undefined
      ? [{ id: "seviye", etiket: "Seviye", aktif: true, onClick: () => setShowFilters(true) }]
      : []),
    ...(degerler.yakinimda
      ? [{ id: "uzaklik", etiket: uzaklikCipi(degerler.yaricap), aktif: true, onClick: () => setShowFilters(true) }]
      : []),
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
    <PublicShell
      navGri
      basaDon
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
        {/* Sayfanın tek h1'i; görsel başlık arama hapıdır. Ekran okuyucu
            kullanıcısı başlıkla gezinince sonuçların ne olduğunu duysun. */}
        <h1 className="sr-only">{seoTitle}</h1>
        {/*
          * KAYIT BANDI SÖKÜLDÜ (kullanıcı kararı, 9 Eyl 2026 · ÜK-10).
          *
          * Buradaki koşulsuz turuncu bant, ziyaretçi tek bir eğitmen bile
          * görmeden hesap istiyordu — NN/g'nin "Login Walls" başlığında
          * ölçtüğü kusur. Üstelik yanlış vaat veriyordu: "mesaj için hesap aç"
          * diyordu ama mesajlaşma giriş + telefon doğrulaması ister; ders
          * öncesi yazışma da sınırlıdır (Modül 5), yani hesap açmak tek
          * başına mesajlaşmayı AÇMIYOR.
          *
          * Kapı artık eylemde: kalbe ya da "Ders Talep Et"e basıldığında
          * pencere açılıyor ve sayfa kaybolmuyor. Yerine hiçbir şey KONMADI —
          * navbar'daki "Giriş Yap" zaten duruyor. Nöbetçi:
          * `__guards__/anonimBantSokumu`.
          */}

        {/* Sonuçlar */}
        <div>
          {isLoading ? (
            <div className={KART_IZGARASI}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-52 animate-pulse rounded-2xl bg-slate-100 " />
              ))}
            </div>
          ) : isError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 "
            >
              <span aria-hidden="true">⚠</span>
              <span className="flex-1">{getErrorMessage(error, "Öğretmenler yüklenemedi.")}</span>
              {/* Hata bir çıkmaz sokak olmasın: sayfa yenilemeden yeniden dene. */}
              <button
                type="button"
                onClick={() => void refetch()}
                className="min-h-[44px] rounded-xl bg-white px-4 text-sm font-semibold text-red-700 ring-1 ring-red-200 transition hover:bg-red-100"
              >
                Tekrar dene
              </button>
            </div>
          ) : organicTutors.length === 0 && featuredIds.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center ">
              <div aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl ">
                🔍
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700 ">
                Kriterlere uyan öğretmen bulunamadı
              </p>
              {/* Boş sonuç çıkmaz sokak olmasın: filtreler tek dokunuşla sıfırlanır. */}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    // Oturumlu listenin `clearAll`ı ile aynı sıfırlama.
                    setQ("");
                    useKonumStore.getState().unut();
                    ayarla(bosDeger(EGITMEN_ARAMA));
                  }}
                  className="mt-4 min-h-[44px] rounded-xl bg-white px-5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 transition hover:bg-slate-50"
                >
                  Tüm filtreleri temizle
                </button>
              )}
            </div>
          ) : (
            <>
              <FeaturedTutorBlock
                params={featuredParams}
                enabled={featuredOnFirstPage}
                onIds={setFeaturedIds}
              />
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 ">
                <span>{organicTutors.length} öğretmen listeleniyor</span>
                {isFetching && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-marka-mid" />
                    Güncelleniyor
                  </span>
                )}
              </div>
              {/* Anonim de kalbi görür — tıklayınca giriş modalı, giriş sonrası niyet uygulanır */}
              <div className={KART_IZGARASI}>
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
