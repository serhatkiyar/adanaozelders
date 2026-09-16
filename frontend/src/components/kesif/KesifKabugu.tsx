import { Suspense, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { CategoryBar, type CategoryKey } from "@/components/CategoryBar";
import { DashboardShell } from "@/components/DashboardShell";
import { PublicShell } from "@/components/PublicShell";
import { CompactSearch, DersArama, KutuphaneArama } from "@/components/HeroSearch";
import { MobilAramaAkisi } from "@/components/kesif/MobilAramaAkisi";
import { kutuphaneHapBasligi } from "@/lib/aramaBasligi";
import { FullScreenSpinner } from "@/components/Spinner";
import type { DersSekli } from "@/components/AramaSecicileri";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import {
  KUTUPHANE_ARAMA,
  dersSorgusu,
  egitmenAramaAdresi,
  kutuphaneAramaAdresi,
} from "@/lib/aramaUrl";
import { TUTOR_NAV, UYE_NAV } from "@/lib/nav";
import { PATHS } from "@/lib/routes";
import {
  type YerSecimi,
  ilceListesindenYer,
  konumOzeti,
  yerinIlceleri,
} from "@/lib/yerArama";
import { useAuthStore } from "@/store/authStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { ROLE_IDS, TeachingMode } from "@/types";

/* ────────────────────────────────────────────────────────────────────────────
   KEŞİF KABUĞU — kategori değişiminde YERİNDE KALAN üst bar.

   ## Ölçülmüş kusur (10 Eyl 2026)

   Kullanıcı: *"kütüphaneler butonuna bastığımızda neden sayfa tamamen
   değişiyor? Airbnb'de diğer kategoriye tıklayınca sayfa yenilenmiyor."*

   Kategori şeridi zaten `<Link>`ti, yani tarayıcı yenilemesi YOKTU. Kusur
   rota mimarisindeydi: `/` ve `/kutuphaneler` iki AYRI üst-seviye rotaydı ve
   her biri KENDİ kabuğunu (`PublicShell`/`DashboardShell` + navbar) basıyordu.
   React her geçişte üst barı söküp yeniden kuruyordu.

   Gerçek Chrome'la ölçüldü (390px, `docs/anasayfa-mobil`): tıklamadan önce ve
   sonra `document.querySelector("header")` FARKLI DOM nesneleriydi ve geçiş
   boyunca header belgeden bir kez tamamen kayboluyordu. Üstelik sayfalar
   `lazy()` ile bölünmüş ve tek `<Suspense>` sınırı `<Routes>`un DIŞINDA
   `FullScreenSpinner` ile duruyor — yani parça inerken ekranın TAMAMI
   spinner'a dönüyordu.

   ## Çözüm

   Bir layout route: kabuk ebeveyn, sayfalar çocuk. React Router çocuk
   eşleşmesi değişse de aynı ebeveyni aynı konumda, aynı tipte reconcile eder;
   kabuk mount kalır, yalnız `<Outlet/>`in çözdüğü gövde değişir.

   İki şart var ve ikisi de sessizce bozulabilir:

   1. **Bu bileşen modül kapsamında tanımlı olmalı.** `App()` gövdesinin
      içinde satır içi tanımlansaydı her render'da YENİ bir bileşen tipi
      doğar ve kabuk yine remount olurdu.
   2. **`<Suspense>` kabuğun İÇİNDE ve `key={pathname}` ile olmalı.** Dışarıda
      kalırsa tembel çocuk askıya alınınca üst barı da fallback'e gömer;
      `key`siz kalırsa React 18 geçişlerinde mevcut sınır fallback GÖSTERMEZ,
      eski gövdeyi tutar ve "hiçbir şey olmadı, sonra hepsi birden değişti"
      hissi doğar.

   Nöbetçi: `__guards__/kesifKabuguKalir.test.tsx`.

   ## Sınır: `/egitmenler` bu kabukta DEĞİL

   Kullanıcı kararı (10 Eyl): telefondaki eğitmen sonuç ekranının başlığına
   (`AramaMobilBaslik`: geri · hap · filtre + çipler) DOKUNULMAYACAK. O ekran
   kendi kromunu taşıyor ve kabuğunkiyle aynı değil; kabuğa alınsaydı ya o
   başlık bozulur ya da kabuk üçüncü bir krom kipi öğrenmek zorunda kalırdı.
   `/egitmenler` bu yüzden kendi kabuğunu basmaya devam ediyor.
   ──────────────────────────────────────────────────────────────────────── */

export function KesifKabugu() {
  const token = useAuthStore((s) => s.token);
  const { data: currentUser } = useCurrentUser();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mobil = useMobil();

  const kategori: CategoryKey =
    pathname === PATHS.libraries ? "kutuphaneler" : "egitmenler";
  const kutuphaneMi = kategori === "kutuphaneler";

  /* ── TEK KAÇIŞ: kökte kendi kabuğunu çizen roller ────────────────────────
     `RootDispatcher` (`App.tsx`) `/`te kütüphane operatörünü `OperatorHome`a,
     kuryeyi `CourierHome`a düşürüyor ve o ekranlar KENDİ `DashboardShell`ini
     basıyor. Keşif kabuğu üstlerine ikinci bir yapışkan üst bar koyarsa ikisi
     üst üste biner.

     Bu kaçış rota seviyesinde ifade EDİLEMEZ: aynı adres (`/`), iki farklı
     kabuk. O yüzden burada, tek satırda ve isimle duruyor. Kökten workspace'e
     ayrı bir adres verildiği gün bu blok silinir. */
  const kendiKabuguVar =
    pathname === PATHS.home &&
    (currentUser?.role_id === ROLE_IDS.LIBRARY_OPERATOR ||
      currentUser?.role_id === ROLE_IDS.COURIER);

  /* /hesabim bağlama duyarlı navbar: son yüzey = keşif. Üç sayfada ayrı ayrı
     yazılıydı, artık tek yerde. */
  const setSurface = useSurfaceStore((s) => s.setSurface);
  useEffect(() => {
    setSurface("discover");
  }, [setSurface]);

  /* ── Arama modeli ──
     Eğitmen hapı ders + mekân sorar, kütüphane hapı ad + yer. İkisi ayrı
     state: biri ötekini ezmesin. Eğitmen tarafı SUBMIT'te gezinir (ana sayfada
     canlı filtrelenecek bir liste yok); kütüphane tarafı yazdıkça adrese
     yazar, çünkü altındaki liste onu canlı okuyor. */
  /* Buradaki durum MASAÜSTÜ hapınındır; telefonun adımlı yüzeyi kendi
     taslağını `MobilAramaAkisi` içinde tutuyor. İkisi aynı anda ekranda
     olmadığı için ayrışmaları görünür değil. "Yakınımda" artık burada da
     var (16 Eyl 2026): yer seçicinin ilk satırı, telefondakiyle aynı. */
  const [ders, setDers] = useState("");
  const [dersEtiket, setDersEtiket] = useState("");
  const [sekil, setSekil] = useState<DersSekli>("");
  const [yer, setYer] = useState<YerSecimi | null>(null);
  const [yakinimda, setYakinimda] = useState(false);

  const {
    degerler: kDegerler,
    ayarla: kAyarla,
    filtreli: kFiltreli,
  } = useAramaDurumu(KUTUPHANE_ARAMA);
  /* Kütüphane ad kutusu KALKTI (16 Eyl 2026); hap yalnız yer sorar. Eski
     `q` senkron/debounce mantığı onunla gitti. */

  /* Kutu ADRESİ okur: mahalle seçiliyse o, değilse tek ilçe seçiliyse ilçe.
     Eskiden yalnız `konum.yer`e (mahalle) bakılıyordu; ilçe seçilince adres
     `?ilce=Seyhan` oluyor ama kutu "İlçe seçin" demeye devam ediyordu
     (ölçüldü, 16 Eyl 2026). */
  const kIlce = kDegerler.konum.ilce;
  const kYer: YerSecimi | null = ilceListesindenYer(kDegerler.konum.yer, kIlce);
  /* "Tüm yerler" (null) ilçeyi de DÜŞÜRÜR. Eskiden `ilce: kIlce` ile eski
     ilçe korunuyordu; seçim kutudan silinmiş gibi görünüp adreste kalıyordu —
     "Tüm yerler çalışmıyor" dediğin buydu. */
  const setKYer = (v: YerSecimi | null) =>
    kAyarla({
      konum: { yer: v?.tur === "mahalle" ? v : null, ilce: yerinIlceleri(v) },
    });
  /* Kütüphanede niyet doğrudan adreste; koordinatı liste sayfası ister
     (`useYakinimdaKonum`). Açılınca ilçe/mahalle düşer — ikisi birlikte
     anlamsız. */
  const setKYakinimda = (v: boolean) =>
    kAyarla(
      v
        ? { yakinimda: true, konum: { yer: null, ilce: [] } }
        : { yakinimda: false }
    );

  /* ── Üst barın açık/kapalı hâli ──
     Airbnb davranışı: birazcık kaydırınca daralt. TELEFONDA ÇALIŞMAZ ve bu
     bilinçli: (1) mobil üst bar zaten kompakt, daraltacak bir şey yok;
     (2) yumuşak klavye açılınca sayfa kayar, dinleyici de her kaymada aramayı
     kapatırdı — kullanıcı yazmaya başlar başlamaz arama kendi üstüne
     kapanıyordu. `Landing`den olduğu gibi taşındı. */
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /* Geniş aramadaki sekme seçimi — YALNIZ hap tıklanarak açıldığında (16 Eyl
     2026). Sayfa değişmez, yalnız hangi hapın çizildiği değişir; Ara'ya
     basınca gidilir. Kapanınca sıfırlanır: bir sonraki açılış sayfanın kendi
     kategorisinden başlar. */
  const [aramaKategori, setAramaKategori] = useState<CategoryKey | null>(null);
  useEffect(() => {
    if (!searchOpen) setAramaKategori(null);
  }, [searchOpen]);
  const hapKategori: CategoryKey = (searchOpen && aramaKategori) || kategori;
  const hapKutuphane = hapKategori === "kutuphaneler";
  /* Eğitmen sayfasındayken kütüphane sekmesine geçilirse taslak YERELDİR:
     adres bu sayfanın; kütüphane şemasına yazılamaz. Ara → /kutuphaneler. */
  const [kYerTaslak, setKYerTaslak] = useState<YerSecimi | null>(null);
  const [kYakinimdaTaslak, setKYakinimdaTaslak] = useState(false);
  const [mobilAramaAcik, setMobilAramaAcik] = useState(false);

  useEffect(() => {
    if (mobil) {
      setScrolled(false);
      return;
    }
    let bekleyen = false;
    const onScroll = () => {
      if (bekleyen) return;
      bekleyen = true;
      requestAnimationFrame(() => {
        bekleyen = false;
        setScrolled(window.scrollY > 56);
        setSearchOpen(false);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mobil]);

  /* SONUÇ ekranında hap DARALMIŞ açılır (11 Eyl 2026). Kütüphane listesi
     filtreliyken ekranın işi keşif değil sonuç göstermek; eğitmen sonuç
     ekranı da tam olarak böyle davranıyor (daralmış hap + filtre şeridi).
     Açık hap orada 90px yer kaplayıp ilk kartı katlamanın altına itiyordu ve
     iki sonuç ekranı yan yana konunca ayrışıyordu. Dokununca yine açılır. */
  const sonucEkrani = kutuphaneMi && kFiltreli;
  const expanded = searchOpen || (!scrolled && !sonucEkrani);

  /* Kategori değişince başa dön. `location.search`e BAĞLANMAZ: her filtre
     değişimi ve `?sayfa=` sayfayı başa fırlatırdı. */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  /* Gezinme kısmı olaydan AYRI: adımlı arama yüzeyinde `form` yok, düğme
     doğrudan çağırıyor. */
  const araEgitmen = () => {
    navigate(
      egitmenAramaAdresi({
        ...dersSorgusu(ders, dersEtiket),
        sekil: sekil ? [sekil] : [],
        konum: {
          yer: yer?.tur === "mahalle" ? yer : null,
          ilce: yerinIlceleri(yer),
        },
        yakinimda,
      })
    );
    setMobilAramaAcik(false);
  };

  const submitEgitmen = (e: React.FormEvent) => {
    e.preventDefault();
    araEgitmen();
  };

  const submitKutuphane = (e: React.FormEvent) => {
    e.preventDefault();
    /* Zaten kütüphane listesindeyiz ve q/yer adrese canlı yazılıyor; yapılacak
       tek şey paneli kapatmak. */
    setSearchOpen(false);
    setMobilAramaAcik(false);
  };

  /* Hap SEKMEYE bakar: eğitmende ders + mekân, kütüphanede ad/semt + ilçe.
     İkisi TASARIM OLARAK ikiz (7 Eyl kullanıcı kararı) — aynı kabuk, aynı
     sıralama, aynı eşit bölmeler; fark yalnız sağ bölmenin seçicisinde.
     Nöbetçi: `__guards__/aramaHapiIkizligi.test.ts`. */
  const hap = hapKutuphane ? (
    kutuphaneMi ? (
      <KutuphaneArama
        yer={kYer}
        setYer={setKYer}
        yakinimda={kDegerler.yakinimda}
        setYakinimda={setKYakinimda}
        onSubmit={submitKutuphane}
      />
    ) : (
      <KutuphaneArama
        yer={kYerTaslak}
        setYer={(v) => {
          setKYerTaslak(v);
          if (v) setKYakinimdaTaslak(false);
        }}
        yakinimda={kYakinimdaTaslak}
        setYakinimda={(v) => {
          setKYakinimdaTaslak(v);
          if (v) setKYerTaslak(null);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          navigate(
            kutuphaneAramaAdresi({
              konum: {
                yer: kYerTaslak?.tur === "mahalle" ? kYerTaslak : null,
                ilce: yerinIlceleri(kYerTaslak),
              },
              yakinimda: kYakinimdaTaslak,
            })
          );
          setSearchOpen(false);
        }}
      />
    )
  ) : (
    <DersArama
      ders={ders}
      dersEtiket={dersEtiket}
      onDersChange={(qDeger, etiket) => {
        setDers(qDeger);
        setDersEtiket(etiket);
      }}
      sekil={sekil}
      setSekil={setSekil}
      yer={yer}
      setYer={setYer}
      yakinimda={yakinimda}
      setYakinimda={setYakinimda}
      onSubmit={submitEgitmen}
    />
  );

  /* Kompakt hapın metni: kütüphanede yer (ya da "Yakınımda"), eğitmende ders. */
  /* Kütüphanede aranan "şey" yok (ad kutusu kalktı); konum sağdaki etikette. */
  const hapMetni = kutuphaneMi ? "" : dersEtiket;
  /* Konum özeti tek yardımcıdan: eğitmende Uzaktan/Yakınımda/yer, kütüphanede
     Yakınımda/yer. Yer yalnız yüz yüzede anlamlı; uzaktan seçiliyken "Uzaktan". */
  const hapYer = kutuphaneMi
    ? konumOzeti({ yer: kYer, ilce: kIlce, yakinimda: kDegerler.yakinimda })
    : konumOzeti({
        yer: sekil === TeachingMode.IN_PERSON ? yer : null,
        ilce: [],
        yakinimda: sekil === TeachingMode.IN_PERSON && yakinimda,
        uzaktan: sekil === TeachingMode.ONLINE,
      });
  /* Kompakt hapın parçaları: kütüphanede sonuç başlığıyla aynı kaynak
     ("Çukurova bölgesindeki kütüphaneler"), eğitmende taslak [yer, ders]. */
  const hapParcalari = kutuphaneMi
    ? kutuphaneHapBasligi({ konum: hapYer, olanakSayisi: kDegerler.olanaklar.length }).parcalar
    : [hapYer ?? "", hapMetni];

  /* Telefonda swap YOK: kompakt hap `mobilUst` yuvasında kalıcı durur, bu yuva
     her zaman kategori çiplerini taşır. İkisi birden basılsaydı aynı hapın iki
     kopyası mount edilir, `htmlFor` kimlikleri belgede ikilenirdi
     (bkz. `hooks/useMedyaSorgusu.ts`). */
  const center = (
    <div
      key={expanded || mobil ? "cats" : "compact"}
      className="w-full animate-in fade-in duration-300"
    >
      {expanded || mobil ? (
        <CategoryBar
          active={hapKategori}
          /* Hap tıklanarak açıldıysa sekme formu değiştirir; ana sayfanın
             kendi açık hâlinde (kaydırılmamış) sekmeler gezinmedir. */
          onSec={searchOpen && !mobil ? setAramaKategori : undefined}
        />
      ) : (
        <div className="flex w-full justify-center">
          <CompactSearch
            active={kategori}
            placeholder="Aramaya başlayın"
            parcalar={hapParcalari}
            onOpen={() => setSearchOpen(true)}
          />
        </div>
      )}
    </div>
  );

  const bottom = mobil ? undefined : (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">{hap}</div>
  );

  const mobilUst = mobil ? (
    <CompactSearch
      active={kategori}
      // Telefonda hap kategoriye göre değişen bir metin taşımaz: kategori zaten
      // hemen altındaki çip şeridinde seçili, hapın işi davet etmek.
      placeholder="Aramaya başlayın"
      parcalar={hapParcalari}
      onOpen={() => setMobilAramaAcik(true)}
    />
  ) : undefined;

  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? UYE_NAV
        : undefined;

  const govde = (
    <>
      {/* Geniş arama açıkken sayfayı hafifçe karart; tıklayınca kapat.
          Üç sayfada birebir kopyalanmıştı, artık tek yerde. */}
      {searchOpen && !mobil && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 animate-in fade-in duration-200"
          onClick={() => setSearchOpen(false)}
        />
      )}
      {/* `key={pathname}`: bkz. dosya başındaki 2. şart. */}
      <Suspense key={pathname} fallback={<FullScreenSpinner />}>
        <Outlet />
      </Suspense>
      {/* Telefonda ADIMLI arama (Airbnb deseni) — masaüstündeki hap değil.
          Akışın tamamı (taslak seçimler, kategori, "Ara"nın nereye gittiği)
          `MobilAramaAkisi`nde: aynı yüzey eğitmen SONUÇ ekranından da
          açılıyor ve o ekran bu kabuğun çocuğu değil. */}
      <MobilAramaAkisi
        acik={mobilAramaAcik}
        onKapat={() => setMobilAramaAcik(false)}
      />
    </>
  );

  if (kendiKabuguVar) {
    return (
      <Suspense key={pathname} fallback={<FullScreenSpinner />}>
        <Outlet />
      </Suspense>
    );
  }

  return token ? (
    <DashboardShell
      title={kutuphaneMi ? "Kütüphaneler" : "Keşfet"}
      navItems={navItems}
      sekmeler={null}
      center={center}
      bottom={bottom}
      mobilUst={mobilUst}
      mobilSade={mobil}
      /* Kütüphane SONUÇ ekranı telefonda kendi başlığını çiziyor (geri · hap ·
         filtre + filtre şeridi), bkz. `Libraries.tsx`. Kabuğun hapı ve
         kategori şeridi orada ikinci bir başlık olurdu. */
      mobilUstGizle={sonucEkrani}
      expanded={expanded}
      icerikSiki
    >
      {govde}
    </DashboardShell>
  ) : (
    <PublicShell
      center={center}
      bottom={bottom}
      mobilUst={mobilUst}
      mobilSade={mobil}
      /* Kütüphane SONUÇ ekranı telefonda kendi başlığını çiziyor (geri · hap ·
         filtre + filtre şeridi), bkz. `Libraries.tsx`. Kabuğun hapı ve
         kategori şeridi orada ikinci bir başlık olurdu. */
      mobilUstGizle={sonucEkrani}
      expanded={expanded}
      icerikSiki
    >
      {govde}
    </PublicShell>
  );
}
