import { useEffect, useState, type ReactNode } from "react";

import { PlainButton } from "@/components/ui/PlainButton";
import { SecenekSatiri } from "@/components/ui/SecenekSatiri";
import { SEKIL_ADI, type DersSekli } from "@/components/AramaSecicileri";
import { useSubjects } from "@/hooks/useSubjects";
import { dersAra } from "@/lib/dersArama";
import { LIBRARY_TRENDING_SEARCHES, TRENDING_SEARCHES } from "@/lib/trendingSearches";
import { yerAra, yerEtiketi, type YerSecimi } from "@/lib/yerArama";
import { TeachingMode } from "@/types";

/* ────────────────────────────────────────────────────────────────────────────
   TELEFONDA ADIMLI ARAMA (Airbnb deseni) — kullanıcı kararı, 10 Eyl 2026.

   Referans ekran: Airbnb mobil arama yüzeyi. Tek açık kart + altında kapalı
   satırlar; her kapalı satırda solda alan adı, sağda ya seçili değer ya da
   davet metni. Altta "Hepsini temizle" ve birincil "Ara" düğmesi.

   ## Neden ayrı bir mobil form (MobilAramaSheet'teki eski karar DEĞİŞTİ)

   O dosya "kopya bir mobil form yazılmasın, aynı hap geçilsin" diyordu ve o
   gün doğruydu: hap dikeye dönüyor, `aramaHapiIkizligi` nöbetçisinin koruduğu
   teklik bozulmuyordu. Ama hap TEK BAKIŞTA tüm alanları gösteren bir yüzeydir;
   telefonda üç alan alt alta açık durunca ekran doluyor ve hiçbir alan
   önceliklenmiyordu. Airbnb deseni sırayı görünür kılıyor: önce ne, sonra
   nerede, sonra nasıl.

   İKİZLİK BOZULMADI: masaüstündeki iki hap (`DersArama`, `KutuphaneArama`)
   hâlâ tek tasarım ve kabukta yaşıyor. Bu dosya ÜÇÜNCÜ BİR HAP DEĞİL, farklı
   bir YÜZEY — telefonun tam ekran arama adımları. Nöbetçi, üçüncü hap
   tasarımının çağrıldığı yerleri HAM METİNLE tarar; burada hap
   bileşenlerinin hiçbiri çağrılmaz (bileşenin adını bu yorumda yazmak bile
   nöbetçiyi tetikler — ölçüldü).

   ## Veri

   Öneriler uydurulmaz: dersler `useSubjects("secim")` katalogundan
   (`dersAra` ile), yerler `lib/yerArama`dan, trend başlıklar
   `lib/trendingSearches`ten gelir.
   ──────────────────────────────────────────────────────────────────────── */

type Adim = "ne" | "nerede" | "nasil";

/** Kapalı satır: solda alan adı, sağda değer ya da davet. */
function KapaliSatir({
  etiket,
  deger,
  davet,
  onAc,
}: {
  etiket: string;
  deger: string | null;
  davet: string;
  onAc: () => void;
}) {
  return (
    <PlainButton
      onClick={onAc}
      /* 52px: referansta kapalı satır ekran genişliğinin ~%13'ü (390px'te
         ≈50px), bende 64px ile %16,4'tü — kapalıyken satır gereğinden kalın
         duruyordu. 44px'in (dokunma eşiği) altına inilmiyor. */
      className="flex min-h-[52px] w-full shrink-0 items-center justify-between gap-4 rounded-2xl bg-white px-5 text-left shadow-sm ring-1 ring-slate-100 transition active:scale-[0.99]"
    >
      <span className="text-sm font-medium text-slate-500">{etiket}</span>
      {/* Sağdaki yazı DEĞER OLMASA DA koyu ve kalın (referans ekran: "Tarih
          ekleyin" soluk değil). Soluk gri, dokunulabilir bir davet olduğunu
          gizliyordu. */}
      <span className="truncate text-base font-semibold text-slate-900">
        {deger || davet}
      </span>
    </PlainButton>
  );
}

/** Açık kart: başlık + içerik. */
function AcikKart({
  baslik,
  dolgu = false,
  children,
}: {
  baslik: string;
  /** Kart, kapalı satırlar ve alt çubuktan ARTAN yeri doldurur (liste adımları). */
  dolgu?: boolean;
  children: ReactNode;
}) {
  return (
    /* ESNEK KART (kullanıcı kararı, 16 Eyl 2026, referans: Airbnb telefon
       arama yüzeyi): seçim ekranı KAYDIRMAZ. Liste adımlarında kart artan yeri
       doldurur, öneri listesi kartın altında KESİLİR (son satır yarım kalır,
       aşağı ok devamını açar). Seçenek adımında (ders şekli) kart içerik
       kadar; ekranın altındaki boşluk orada doğal. */
    <section
      className={`flex min-h-0 shrink flex-col rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-100 ${
        dolgu ? "flex-1" : ""
      }`}
    >
      <h2 className="text-2xl font-bold leading-tight text-slate-900">{baslik}</h2>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** Arama kutusu — kart içindeki tek satırlık girdi. */
function Kutu({
  deger,
  onDegis,
  ipucu,
  etiket,
}: {
  deger: string;
  onDegis: (v: string) => void;
  ipucu: string;
  etiket: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-marka-mid focus-within:ring-2 focus-within:ring-marka-focus/30">
      <svg
        className="h-5 w-5 shrink-0 text-slate-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
      </svg>
      <input
        type="text"
        value={deger}
        onChange={(e) => onDegis(e.target.value)}
        placeholder={ipucu}
        aria-label={etiket}
        className="min-h-[48px] w-full border-0 bg-transparent text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
      />
    </div>
  );
}

/** Öneri satırı = sitenin TEK seçenek satırı (`ui/SecenekSatiri`): ölçü ve
 *  görünüm orada, burada yalnız ad çevrilir. Ders önerilerinde simge yoktur
 *  (kullanıcı kararı, 11 Eyl 2026): her derse aynı kitabı koymak hiçbir
 *  dersi ötekinden ayırmıyordu. Yer ve ders şekli satırlarında simge
 *  gerçekten ayırt edici olduğu için orada duruyor. */
function OneriSatiri({
  simge,
  baslik,
  altBaslik,
  onSec,
}: {
  simge?: ReactNode;
  baslik: string;
  altBaslik?: string;
  onSec: () => void;
}) {
  return <SecenekSatiri simge={simge} baslik={baslik} altBaslik={altBaslik} onClick={onSec} />;
}

/**
 * Ders öneri satırlarının simgesi: siyah çizgi AÇIK KİTAP.
 *
 * HEPSİNDE AYNI (kullanıcı kararı, 11 Eyl 2026). Derse özgü görsel 846
 * derslik katalogda üretilemez; her derse ayrı emoji de denendi ve hiçbir
 * dersi ötekinden ayırmadığı için kaldırıldı.
 *
 * Sırasıyla büyüteç ve mezuniyet kepi denendi, kullanıcı kitabı seçti.
 * Büyüteç yalnız "arama" diyordu — üstündeki kutunun içinde zaten aynı
 * büyüteç duruyor. Kitabın bilinen riski: kitap aynı zamanda KÜTÜPHANELER
 * kategorisinin dili. Karışmıyor çünkü bu liste yalnız Eğitmenler sekmesinde
 * çiziliyor ve satırın yanında ders adı yazıyor.
 */
export function DersSimgesi() {
  return (
    <svg
      className="h-6 w-6 text-slate-900"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Ortadaki sırt */}
      <path d="M12 7.2v12.3" />
      {/* İki sayfa: dışa doğru açılıp altta hafifçe kıvrılıyor */}
      <path d="M12 7.2C10.4 5.6 8 4.7 5 4.7H2.8v12.6H5c2.9 0 5.4.8 7 2.2" />
      <path d="M12 7.2c1.6-1.6 4-2.5 7-2.5h2.2v12.6H19c-2.9 0-5.4.8-7 2.2" />
    </svg>
  );
}

/**
 * Yer öneri satırlarının simgesi: siyah çizgi konum iğnesi.
 *
 * HEPSİNDE AYNI (kullanıcı kararı, 11 Eyl 2026): Çukurova, Seyhan ve Yüreğir
 * için çizilmiş ilçe illüstrasyonları da bırakıldı. Üç ilçe resimli, on üçü
 * simgeliyken liste iki ayrı dil konuşuyordu; resimli olanlar ayrıca kendi
 * zemin renklerini (yeşil, pembe) getirip listeyi alacalandırıyordu.
 * `lib/ilceGorselleri` ve görseller yerinde duruyor — karar dönerse tek satır.
 *
 * Emoji de DEĞİL: 📍 her platformda başka çiziliyor ve kendi kırmızısını
 * getiriyor. Çizgi ikon dosyadaki öteki ikonlarla (büyüteç, ok, geri) aynı
 * ailede ve rengi bizde.
 */
function KonumSimgesi() {
  return (
    <svg
      className="h-6 w-6 text-slate-900"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"
      />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

/**
 * Kartı kesen aşağı ok — adımı TAM EKRAN listeye açar.
 *
 * Üstündeki saç-teli çizgi listenin bittiğini değil DEVAM ETTİĞİNİ söyler;
 * referans ekranda da kart bir okla kesiliyor.
 */
function AsagiOk({ onAc }: { onAc: () => void }) {
  return (
    <div className="-mb-2 mt-1 shrink-0 border-t border-slate-100">
      {/* İNCE şerit (kullanıcı kararı, 16 Eyl 2026): 44px'lik düğme ve kartın
          alt boşluğu üst üste binince ok kartın altında koca bir boşlukta
          yüzüyordu. Düğme 32px, kartın p-5 alt boşluğunu -mb-3 ile yiyor;
          tam genişlik olduğu için dokunma alanı yine rahat. */}
      <PlainButton
        onClick={onAc}
        aria-label="Tümünü göster"
        className="flex min-h-[32px] w-full items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-50 active:scale-[0.99]"
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </PlainButton>
    </div>
  );
}

export function AramaAdimlari({
  kutuphaneMi,
  duzenleme = false,
  ders,
  dersEtiket,
  onDersChange,
  sekil,
  setSekil,
  yer,
  setYer,
  kutuphaneQ,
  setKutuphaneQ,
  yakinimda,
  setYakinimda,
  onAra,
  onTemizle,
}: {
  kutuphaneMi: boolean;
  /** Adreste zaten bir arama var; yüzey onu DÜZENLİYOR (bkz. `MobilAramaAkisi`). */
  duzenleme?: boolean;
  ders: string;
  dersEtiket: string;
  onDersChange: (q: string, etiket: string) => void;
  sekil: DersSekli;
  setSekil: (v: DersSekli) => void;
  yer: YerSecimi | null;
  setYer: (v: YerSecimi | null) => void;
  kutuphaneQ: string;
  setKutuphaneQ: (v: string) => void;
  /** "Yakınımda" seçili mi — konum izni ekranı açan sayfa tarafında istenir. */
  yakinimda: boolean;
  setYakinimda: (v: boolean) => void;
  onAra: () => void;
  onTemizle: () => void;
}) {
  /* Kütüphanede İSİM ADIMI YOK (kullanıcı kararı, 10 Eyl 2026): kimse
     kütüphaneyi adıyla aramıyor, semtiyle arıyor. Yüzey doğrudan "Nerede?"
     ile açılır ve ilk satır "Yakınımda"dır. Ad araması masaüstü hapında
     duruyor; kaldırılmadı, telefonun ilk adımı olmaktan çıktı. */
  const [adim, setAdim] = useState<Adim>(kutuphaneMi ? "nerede" : "ne");
  const [yerMetni, setYerMetni] = useState("");
  /* Kart varsayılan olarak KISA: üç öneri + aşağı ok. Ok, adımı TAM EKRAN
     listeye açar (kullanıcı kararı, 10 Eyl 2026 — referans ekran): kutu yukarı
     çıkar, içine geri oku girer, altında listenin tamamı akar. Sekmeler ve alt
     eylem çubuğu o görünümde yoktur; ekranda tek iş vardır. */
  const [tamListe, setTamListe] = useState<Adim | null>(null);
  /* Görünen sayıyı ekran belirler (liste kartın altında kesilir); bu yalnız
     üst sınır — kesilen satırların hepsi zaten tam listede. */
  const KISA = 6;

  /* "Fark etmez" GEÇERLİ bir seçimdir ama değeri boş dizedir; yani `sekil`e
     bakarak kullanıcının bu adımı geçip geçmediği anlaşılamaz. Adres zaten bir
     şekil taşıyorsa — ya da düzenlenen bir arama varsa — adım yapılmış
     sayılır. */
  const [sekilSecildi, setSekilSecildi] = useState(sekil !== "" || duzenleme);
  const [araBekliyor, setAraBekliyor] = useState(false);

  /* OTOMATİK ARAMA (kullanıcı kararı, 11 Eyl 2026): son eksik adım da
     doldurulunca "Ara"ya basmayı beklemeden arama çalışır.

     Neden `useEffect`: seçim değerlerinin sahibi ÜST bileşen (`KesifKabugu`)
     ve `onAra` o değerleri kapatarak (closure) geliyor. Aynı olay içinde
     `setYer(...)` deyip hemen `onAra()` çağırmak ESKİ değerlerle arama
     yapardı. Bayrak bir sonraki commit'e taşıyor; o commit'te üst bileşen
     yeni değerlerle yeniden çizildiği için elimizdeki `onAra` tazedir. */
  useEffect(() => {
    if (!araBekliyor) return;
    setAraBekliyor(false);
    onAra();
  }, [araBekliyor, onAra]);

  const { data: katalog } = useSubjects("secim");
  const metin = kutuphaneMi ? kutuphaneQ : dersEtiket;

  /* ── ADIM İLERLETME — TEK KARAR YERİ ──────────────────────────────────
     Bir seçim yapılınca sıradaki EKSİK adım açılır; eksik adım kalmadıysa
     arama kendiliğinden çalışır. Daha önce her satır kendi "sıradaki adım"ını
     yazıyordu ve üçü birbirini tutmuyordu (trend ders yeri açıyor, ders şekli
     başa dönüyordu).

     `sonra`: bu tıklamayla DEĞİŞEN değerler. State güncellemeleri bu satırda
     henüz görünür olmadığı için karar taze değerlerle verilir. */
  const ilerle = (sonra?: {
    neDolu?: boolean;
    sekilSecildi?: boolean;
    sekilDegeri?: DersSekli;
    yerDolu?: boolean;
  }) => {
    const neDolu = sonra?.neDolu ?? metin.trim().length > 0;
    const secildi = sonra?.sekilSecildi ?? sekilSecildi;
    const sekilDegeri = sonra?.sekilDegeri ?? sekil;
    const yerDolu = sonra?.yerDolu ?? (yakinimda || yer !== null);

    setTamListe(null);
    /* Kütüphanede ders ve ders şekli adımı YOKTUR; tek adım yerdir. */
    if (!kutuphaneMi && !neDolu) return setAdim("ne");
    if (!kutuphaneMi && !secildi) return setAdim("nasil");
    /* Yer YALNIZ yüz yüzede sorulur — uzaktan ders arayana semt sormak
       anlamsız (mevcut kural, `DersArama`). */
    const yerGerekli = kutuphaneMi || sekilDegeri === TeachingMode.IN_PERSON;
    if (yerGerekli && !yerDolu) return setAdim("nerede");
    setAraBekliyor(true);
  };

  /* Ders önerileri: kutu boşken trend başlıklar, yazarken katalog araması.
     Kütüphanede katalog yok — orada yalnız trend başlıklar var. */
  /* `dersAra` GRUPLU döner (Matematik ▸ TYT Matematik…); adım listesi düz bir
     satır dizisi istiyor, o yüzden gruplar düzleştirilip ilk altısı alınır. */
  const dersOnerileri = kutuphaneMi
    ? []
    : dersAra(katalog, ders && metin === dersEtiket ? "" : metin).flatMap(
        (g) => g.dersler
      );
  /* Liste kart içinde birkaç satır kalır (referansta da öyle): tamamı
     basılırsa kapalı adımlar ve "Ara" düğmesi katlamanın altına düşer. */
  /* Sıra ANLAMLI: `trendingSearches` rakibin gerçek talep sayılarına göre
     sıralı, o yüzden ilk üç doğrudan oradan gelir. */
  const trendTumu = kutuphaneMi ? LIBRARY_TRENDING_SEARCHES : TRENDING_SEARCHES;
  /* Kutuda yazı varsa katalog sonuçları, yoksa trend başlıklar. */
  const aramaSonucu = metin.trim().length > 0 && dersOnerileri.length > 0;

  /* Ders listesiyle AYNI kural: kart içinde birkaç satır. Tam liste
     basılırsa alttaki adımlar ve "Ara" düğmesi katlamanın altına düşer. */
  /* `slice` ŞART: `yerAra` boş sorguda `limit`i UYGULAMIYOR — o dalda tüm
     ilçeleri döndürüyor (`lib/yerArama.ts`). Sınırı burada koymazsak liste
     alttaki adımları ve "Ara" düğmesini katlamanın altına itiyor. */
  const yerOnerileri = yerAra(yerMetni, 40);

  /* Başlık ALAN ADIDIR, soru değil (kullanıcı kararı, 10 Eyl 2026):
     referanstaki "Yer" gibi tek kelime. Davet metni kutunun içinde duruyor,
     başlıkta ikinci kez sorulmuyor. */
  const neBasligi = kutuphaneMi ? "Kütüphane" : "Ders";
  const neDegeri = kutuphaneMi ? kutuphaneQ : dersEtiket;

  /* Satırlar TEK yerden üretilir: kart üç tanesini, tam ekran liste hepsini
     basıyor. İki yerde ayrı ayrı yazılsaydı seçim davranışı (hangi adıma
     geçtiği) sessizce ayrışırdı. */
  const neSatirlari = (limit?: number) =>
    aramaSonucu
      ? dersOnerileri.slice(0, limit).map((d) => (
          <OneriSatiri
            key={d.id}
            simge={<DersSimgesi />}
            baslik={d.name}
            onSec={() => {
              onDersChange(d.name, d.name);
              ilerle({ neDolu: true });
            }}
          />
        ))
      : trendTumu.slice(0, limit).map((t) => (
          <OneriSatiri
            key={t}
            simge={<DersSimgesi />}
            baslik={t}
            onSec={() => {
              if (kutuphaneMi) setKutuphaneQ(t);
              else onDersChange("", t);
              ilerle({ neDolu: true });
            }}
          />
        ));

  /* Listenin İLK satırı her zaman "Yakınımda": kullanıcı semt adı bilmek
     zorunda kalmadan çevresindekini bulabilsin. Koordinat adrese YAZILMAZ —
     adres yalnız niyeti (`yakinimda=1`) taşır, konum sayfayı açandan yeniden
     istenir (bkz. `lib/aramaUrl` gizlilik notu). */
  const yakinimdaSatiri = (
    <OneriSatiri
      key="yakinimda"
      /* Kendi görseli var: ilçe illüstrasyonlarıyla aynı dilde çizilmiş bir
         kare, emoji değil. Bu satır listenin ilki ve en çok tıklanacak olanı;
         yanındaki üç ilçe çizgi işken burada emoji durması sırıtıyordu. */
      simge={
        <img
          src="/icons/ilceler/yakinimda.webp"
          alt=""
          aria-hidden
          width={48}
          height={48}
          decoding="async"
          className="h-full w-full object-cover"
        />
      }
      baslik="Yakınımda"
      altBaslik="Çevrendekileri bul"
      onSec={() => {
        setYakinimda(true);
        setYer(null);
        setYerMetni("");
        ilerle({ yerDolu: true });
      }}
    />
  );

  const yerSatirlari = (limit?: number) =>
    yerOnerileri.slice(0, limit).map((o) => (
      <OneriSatiri
        key={`${o.secim.tur}-${o.baslik}-${o.altBaslik}`}
        simge={<KonumSimgesi />}
        baslik={o.baslik}
        /* Alt başlık YOK: liste yalnız ilçelerden oluşuyor ve hepsinin altında
           aynı "Adana" yazıyordu — hiçbir şey ayırt etmeyen bir tekrar. */
        onSec={() => {
          /* Semt seçmek "yakınımda"yı iptal eder: ikisi aynı anda anlamsız. */
          setYakinimda(false);
          setYer(o.secim);
          setYerMetni("");
          ilerle({ yerDolu: true });
        }}
      />
    ));

  /* ── TAM EKRAN LİSTE ──────────────────────────────────────────────────
     Aşağı oka basılınca açılır. `fixed inset-0`: yalnız kart değil, arama
     yüzeyinin TAMAMI (kategori sekmeleri ve alt eylem çubuğu dahil) örtülür —
     referansta o görünümde ekranda tek iş var. Kutu yukarı çıkar ve geri oku
     onun İÇİNDE durur; ayrı bir başlık satırı yoktur. */
  if (tamListe) {
    const yerAdimi = tamListe === "nerede";
    return (
      <div className="fixed inset-0 z-[110] flex flex-col bg-white">
        <div className="px-4 pb-2 pt-4">
          <div className="flex items-center gap-1 rounded-2xl bg-slate-100 px-2">
            <PlainButton
              onClick={() => setTamListe(null)}
              aria-label="Geri"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-700 transition hover:bg-slate-200 active:scale-90"
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </PlainButton>
            <input
              type="text"
              autoFocus
              value={yerAdimi ? yerMetni : metin}
              onChange={(e) =>
                yerAdimi
                  ? setYerMetni(e.target.value)
                  : kutuphaneMi
                    ? setKutuphaneQ(e.target.value)
                    : onDersChange("", e.target.value)
              }
              placeholder={
                yerAdimi
                  ? "İlçe seçin"
                  : kutuphaneMi
                    ? "Kütüphane adı giriniz"
                    : "Ders ekleyin"
              }
              aria-label={yerAdimi ? "Yer" : neBasligi}
              className="min-h-[56px] w-full border-0 bg-transparent pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
            />
          </div>
        </div>
        <p className="px-4 pb-1 text-base font-medium text-slate-500">
          {yerAdimi
            ? "Önerilen yerler"
            : aramaSonucu
              ? "Sonuçlar"
              : "Popüler aramalar"}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {yerAdimi ? [yakinimdaSatiri, ...yerSatirlari()] : neSatirlari()}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* `min-h-0` ŞART: flex çocuğunun varsayılan `min-height:auto`'su
          içeriğe göre büyür ve `overflow-y-auto` hiçbir şey yapmaz — alt
          eylem çubuğu ekranın dışına taşardı (ölçüldü, 10 Eyl 2026). */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2">
        {/* ── 1. NE ── */}
        {kutuphaneMi ? null : adim === "ne" ? (
          <AcikKart baslik={neBasligi} dolgu>
            <Kutu
              deger={metin}
              onDegis={(v) =>
                kutuphaneMi ? setKutuphaneQ(v) : onDersChange("", v)
              }
              ipucu={kutuphaneMi ? "Kütüphane adı giriniz" : "Ders ekleyin"}
              etiket={neBasligi}
            />
            <p className="mt-3 shrink-0 text-base font-medium text-slate-500">
              {metin.trim() ? "Sonuçlar" : "Popüler aramalar"}
            </p>
            <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-hidden">{neSatirlari(KISA)}</div>
            {/* Kartın altındaki aşağı ok: listenin devamını açar (referans
                ekranda da kart bir okla kesiliyor). Üstündeki saç-teli çizgi
                listenin bittiğini değil DEVAM ETTİĞİNİ söyler. */}
            <AsagiOk onAc={() => setTamListe("ne")} />
          </AcikKart>
        ) : (
          <KapaliSatir
            etiket="Ders"
            deger={neDegeri || null}
            davet="Ders ekle"
            onAc={() => setAdim("ne")}
          />
        )}

        {/* ── 2. NASIL (yalnız eğitmen) ── */}
        {!kutuphaneMi &&
          (adim === "nasil" ? (
            <AcikKart baslik="Ders nasıl işlensin?">
              <div className="flex min-h-0 flex-col gap-1">
                {/* SIRA ve İÇERİK (kullanıcı kararı, 16 Eyl 2026): önce Yüz
                    yüze, sonra Uzaktan; açıklama satırı YOK — iki ad kendini
                    anlatıyor. "Fark etmez" RAFTA: seçenek olarak çizilmiyor,
                    ama boş değer (`""`) adreste hâlâ geçerli ve `SEKIL_ADI`
                    sözlüğünde duruyor; geri gelirse buraya bir satır eklenir. */}
                {([
                  [TeachingMode.IN_PERSON, SEKIL_ADI[TeachingMode.IN_PERSON]],
                  [TeachingMode.ONLINE, SEKIL_ADI[TeachingMode.ONLINE]],
                ] as const).map(([deger, baslik]) => (
                  <OneriSatiri
                    key={baslik}
                    simge={
                      <img
                        src={`/icons/ders-sekli/${
                          deger === TeachingMode.ONLINE ? "uzaktan" : "yuzyuze"
                        }.webp`}
                        alt=""
                        aria-hidden
                        width={48}
                        height={48}
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    }
                    baslik={baslik}
                    onSec={() => {
                      setSekil(deger as DersSekli);
                      setSekilSecildi(true);
                      ilerle({ sekilSecildi: true, sekilDegeri: deger });
                    }}
                  />
                ))}
              </div>
            </AcikKart>
          ) : (
            <KapaliSatir
              etiket="Ders şekli"
              deger={sekil ? SEKIL_ADI[sekil] : null}
              davet="Seçin"
              onAc={() => setAdim("nasil")}
            />
          ))}

        {/* ── 3. NEREDE ── */}
        {adim === "nerede" ? (
          <AcikKart baslik="Nerede?" dolgu>
            <Kutu
              deger={yerMetni}
              onDegis={setYerMetni}
              ipucu="İlçe seçin"
              etiket="Yer"
            />
            <p className="mt-3 shrink-0 text-base font-medium text-slate-500">Önerilen yerler</p>
            <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-hidden">
              {yer && (
                <OneriSatiri
                  simge="✕"
                  baslik="Yer seçimini kaldır"
                  altBaslik={yerEtiketi(yer)}
                  onSec={() => {
                    setYer(null);
                    setYerMetni("");
                  }}
                />
              )}
              {yakinimdaSatiri}
              {/* Görünen ilçe sayısını artık EKRAN BOYU belirler (16 Eyl 2026):
                  liste kartın altında kesilir, kalanı aşağı ok açar. Uzun
                  telefonlarda üç büyük ilçe ("Yakınımda" hariç) yine görünür. */}
              {yerSatirlari(KISA)}
            </div>
            <AsagiOk onAc={() => setTamListe("nerede")} />
          </AcikKart>
        ) : (
          <KapaliSatir
            etiket="Yer"
            deger={yakinimda ? "Yakınımda" : yerEtiketi(yer) || null}
            davet="Konum ekle"
            onAc={() => setAdim("nerede")}
          />
        )}
      </div>

      {/* ── Alt eylem çubuğu ── */}
      <div
        /* Çizgi YOK: referansta alt çubuk gri zeminde serbest duruyor,
           üstünde ayırıcı bir hat bulunmuyor. */
        className="flex shrink-0 items-center justify-between gap-4 px-1 pt-3"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <PlainButton
          onClick={onTemizle}
          className="min-h-[44px] px-2 text-sm font-semibold text-slate-900 transition active:scale-95"
        >
          Hepsini temizle
        </PlainButton>
        <PlainButton
          onClick={onAra}
          className="flex min-h-[52px] items-center gap-2 rounded-full bg-marka px-7 text-base font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
          </svg>
          Ara
        </PlainButton>
      </div>
    </div>
  );
}
