import { Suspense, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { CategoryBar, type CategoryKey } from "@/components/CategoryBar";
import { DashboardShell } from "@/components/DashboardShell";
import { PublicShell } from "@/components/PublicShell";
import { CompactSearch, DersArama, KutuphaneArama } from "@/components/HeroSearch";
import { MobilAramaSheet } from "@/components/MobilAramaSheet";
import { FullScreenSpinner } from "@/components/Spinner";
import type { DersSekli } from "@/components/AramaSecicileri";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDebounce } from "@/hooks/useDebounce";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import {
  KUTUPHANE_ARAMA,
  dersSorgusu,
  egitmenAramaAdresi,
} from "@/lib/aramaUrl";
import { TUTOR_NAV, UYE_NAV } from "@/lib/nav";
import { PATHS } from "@/lib/routes";
import { type YerSecimi } from "@/lib/yerArama";
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
  const [ders, setDers] = useState("");
  const [dersEtiket, setDersEtiket] = useState("");
  const [sekil, setSekil] = useState<DersSekli>("");
  const [yer, setYer] = useState<YerSecimi | null>(null);

  const { degerler: kDegerler, ayarla: kAyarla } = useAramaDurumu(KUTUPHANE_ARAMA);
  const [kQ, setKQ] = useState(kDegerler.q);
  const kDebounced = useDebounce(kQ);

  /* Dış gezinme (geri/ileri, paylaşılan bağlantı) kutuyu günceller. */
  useEffect(() => {
    if (!kutuphaneMi) return;
    setKQ((onceki) => (kDegerler.q !== onceki ? kDegerler.q : onceki));
  }, [kDegerler.q, kutuphaneMi]);

  /* Debounce'lu metin adrese `replace` ile yazılır: her harf ayrı bir geçmiş
     girdisi olsaydı geri tuşu harf harf geri alırdı. `ayarla` tabanı KORUR,
     yani olanak/sıralama/sayfa parametreleri düşmez. */
  useEffect(() => {
    if (!kutuphaneMi) return;
    if (kDebounced.trim() !== kDegerler.q) kAyarla({ q: kDebounced }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kDebounced, kutuphaneMi]);

  const kYer = kDegerler.konum.yer;
  const kIlce = kDegerler.konum.ilce;
  const setKYer = (v: YerSecimi | null) =>
    kAyarla({ konum: { yer: v, ilce: v ? [v.ilce] : kIlce } });

  /* ── Üst barın açık/kapalı hâli ──
     Airbnb davranışı: birazcık kaydırınca daralt. TELEFONDA ÇALIŞMAZ ve bu
     bilinçli: (1) mobil üst bar zaten kompakt, daraltacak bir şey yok;
     (2) yumuşak klavye açılınca sayfa kayar, dinleyici de her kaymada aramayı
     kapatırdı — kullanıcı yazmaya başlar başlamaz arama kendi üstüne
     kapanıyordu. `Landing`den olduğu gibi taşındı. */
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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

  const expanded = !scrolled || searchOpen;

  /* Kategori değişince başa dön. `location.search`e BAĞLANMAZ: her filtre
     değişimi ve `?sayfa=` sayfayı başa fırlatırdı. */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const submitEgitmen = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(
      egitmenAramaAdresi({
        ...dersSorgusu(ders, dersEtiket),
        sekil: sekil ? [sekil] : [],
        konum: {
          yer: yer?.tur === "mahalle" ? yer : null,
          ilce: yer ? [yer.ilce] : [],
        },
      })
    );
    setMobilAramaAcik(false);
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
  const hap = kutuphaneMi ? (
    <KutuphaneArama
      q={kQ}
      setQ={setKQ}
      yer={kYer}
      setYer={setKYer}
      onSubmit={submitKutuphane}
    />
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
      onSubmit={submitEgitmen}
    />
  );

  const hapMetni = kutuphaneMi ? kQ : dersEtiket;
  const hapIlce = kutuphaneMi
    ? kIlce
    : sekil === TeachingMode.IN_PERSON && yer
      ? [yer.ilce]
      : [];

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
        <CategoryBar active={kategori} />
      ) : (
        <div className="flex w-full justify-center">
          <CompactSearch
            active={kategori}
            placeholder="Aramaya başlayın"
            q={hapMetni}
            district={hapIlce}
            remote={!kutuphaneMi && sekil === TeachingMode.ONLINE}
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
      q={hapMetni}
      district={hapIlce}
      remote={!kutuphaneMi && sekil === TeachingMode.ONLINE}
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
      <MobilAramaSheet open={mobilAramaAcik} onClose={() => setMobilAramaAcik(false)}>
        {hap}
      </MobilAramaSheet>
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
      expanded={expanded}
    >
      {govde}
    </DashboardShell>
  ) : (
    <PublicShell
      center={center}
      bottom={bottom}
      mobilUst={mobilUst}
      mobilSade={mobil}
      expanded={expanded}
    >
      {govde}
    </PublicShell>
  );
}
