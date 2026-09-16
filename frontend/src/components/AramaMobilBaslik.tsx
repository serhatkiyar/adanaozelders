import { type CSSProperties, type ReactNode, useEffect, useState } from "react";

/**
 * Eğitmen arama SONUÇ ekranının telefon başlığı — geri · hap · filtre, altında
 * yatay filtre şeridi (kullanıcı kararı, 9 Eyl 2026; referans Airbnb arama
 * ekranı).
 *
 * ## Neden ortak bileşen
 *
 * `/egitmenler` iki ayrı sayfadan çizilir: anonim ziyaretçiye
 * `PublicMarketplace`, oturumlu kullanıcıya `Marketplace` (bkz.
 * `MarketplacePage` delegatörü). İkisi AYNI ekrandır; başlığı iki kez yazmak,
 * birinin öbürüne sessizce benzemez hâle gelmesi demekti — sitede tam olarak
 * bu sınıftan bir kusur zaten yaşandı ve `__guards__/aramaHapiIkizligi.test.ts`
 * ile çıpalandı.
 *
 * Bu yüzden GÖRÜNÜM burada tek yerdedir; her sayfa yalnız KENDİ durumunu
 * çiplere çevirir. Bu ayrım gerekli: iki sayfanın filtre modeli farklıdır
 * (anonim tarafta ders şekli TEK değer, oturumlu tarafta çoklu `modes`
 * dizisi). Ortak bir "şekil" varsayımı ikisinden birini bozardı.
 *
 * ## Görünen ölçü ile dokunma alanı AYRIDIR
 *
 * İlk sürümde çipler 44px'ti (proje dokunma eşiği,
 * `scripts/sihirbaz_mobil_turu.mjs`) ve şerit kalın duruyordu — kullanıcı
 * itirazı. Doğrusu: dış kabuk 44px ama ZEMİNSİZ, görünen hap içerideki 34px.
 * Parmak aynı alanı bulur, göz ince bir çip görür. Aynı ayrım
 * `ui/DaireDugme`de de var.
 */

/** Şeritteki tek bir filtre çipi. `aktif` çipi doldurur (seçili filtre). */
export type FiltreCipi = {
  id: string;
  etiket: string;
  aktif: boolean;
  onClick: () => void;
};

/** Dokunma kabuğu — 44px, zeminsiz. */
const KABUK = "flex h-11 shrink-0 snap-start items-center py-[5px]";

/** Görünen hap — 34px.
 *
 * SEÇİLİ ÇİP DOLMAZ (kullanıcı kararı, 16 Eyl 2026; referans Airbnb): siyah
 * dolgu şeridi lekeliyordu. Seçili çip aynı beyaz zeminde KALIN (2px) koyu
 * çerçeve alır; seçilmemiş çip ince, orta gri çerçevedir. `box-border` ve
 * sabit yükseklik sayesinde kalın çerçeve çipi büyütmez. */
export function cipSinifi(aktif: boolean): string {
  return `box-border flex h-[34px] items-center gap-1 rounded-full bg-white px-3.5 text-sm text-slate-900 transition active:scale-95 ${
    aktif
      ? "border-2 border-slate-900 font-medium"
      : "border border-slate-300 hover:border-slate-500"
  }`;
}

/**
 * Arama özeti hapı.
 *
 * Ana sayfanın hapı (`HeroSearch/CompactSearch`) DEĞİLDİR ve olmamalıdır.
 * Orada hap bir DAVETtir: "Aramaya başlayın" der, büyüteç taşır, boştur.
 * Burada bir ÖZETtir: kullanıcı zaten aramış, hapın işi ne aradığını geri
 * okutmak. İlk sürümde ana sayfanınki olduğu gibi taşınmıştı; kalın duruyordu
 * ve içeriği bu ekrana ait değildi (kullanıcı itirazı).
 */
function AramaOzetiHapi({
  baslik,
  ozet,
  onClick,
}: {
  baslik: string;
  ozet: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Aramayı değiştir"
      className="flex h-[52px] w-full min-w-0 flex-col items-center justify-center rounded-full border border-slate-200 bg-white px-4 shadow-[0_1px_6px_rgba(15,23,42,0.08)] transition hover:shadow-md active:scale-[0.99]"
    >
      <span className="w-full truncate text-[15px] font-semibold leading-tight text-slate-900">
        {baslik}
      </span>
      <span className="w-full truncate text-[13px] leading-tight text-slate-500">
        {ozet}
      </span>
    </button>
  );
}

/**
 * Sayfa AŞAĞI kaydırılırken `true`: filtre şeridi katlanır, yalnız hap satırı
 * kalır (kullanıcı kararı, 16 Eyl 2026; Airbnb aynısını yapar). Yukarı
 * kaydırmaya başlayınca veya tepeye dönünce şerit geri açılır.
 *
 * Eşik 8px: parmağın küçük titremesi şeridi açıp kapatmasın. Tepeden 24px
 * içindeyken hep açık: sayfa daha kaydırılmamışken şerit gizlenmemeli.
 */
function useAsagiKaydiriliyor(): boolean {
  const [asagi, setAsagi] = useState(false);
  useEffect(() => {
    let son = window.scrollY;
    let bekliyor = false;
    /* Şerit katlanıp açılırken başlığın boyu değişir; tarayıcının kaydırma
       çıpası (scroll anchoring) sayfayı o kadar kaydırır ve bu da yeni bir
       "aşağı/yukarı" olayı doğurur — şerit çırpınıyordu (ölçüldü, 16 Eyl
       2026). Bir karar verildikten sonra geçiş süresi boyunca (300ms) olaylar
       yok sayılır ve referans nokta geçiş bittiğinde yeniden alınır. */
    let donmusa = 0;
    const karar = (deger: boolean) => {
      setAsagi(deger);
      donmusa = performance.now() + 350;
    };
    const oku = () => {
      bekliyor = false;
      const y = window.scrollY;
      if (performance.now() < donmusa) {
        son = y;
        return;
      }
      if (y < 24) karar(false);
      else if (y > son + 8) karar(true);
      else if (y < son - 8) karar(false);
      else return;
      son = y;
    };
    const onScroll = () => {
      if (bekliyor) return;
      bekliyor = true;
      requestAnimationFrame(oku);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return asagi;
}

export function AramaMobilBaslik({
  baslik,
  ozet,
  onHap,
  onGeri,
  onFiltre,
  filtreSayisi,
  cipler,
  filtreIkonu,
}: {
  /** Hapın üst satırı — aranan şey. */
  baslik: string;
  /** Hapın alt satırı — yer/şekil özeti. */
  ozet: string;
  onHap: () => void;
  onGeri: () => void;
  onFiltre: () => void;
  /** Filtre penceresindeki ETKİN filtre sayısı — düğmenin köşesinde rozet
   *  olur (Airbnb'deki gibi). 0 ise rozet çizilmez. */
  filtreSayisi: number;
  cipler: FiltreCipi[];
  filtreIkonu: ReactNode;
}) {
  const seritKatli = useAsagiKaydiriliyor();
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onGeri}
          aria-label="Geri"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 active:scale-95"
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
        </button>
        <div className="min-w-0 flex-1">
          <AramaOzetiHapi baslik={baslik} ozet={ozet} onClick={onHap} />
        </div>
        {/* Filtre düğmesi DOLMAZ: etkin filtre varsa çerçeve kalınlaşır ve
            köşede sayı rozeti belirir. Siyah dolu daire "basılı" gibi
            okunuyordu ve kaç filtre olduğunu söylemiyordu. */}
        <button
          type="button"
          onClick={onFiltre}
          aria-label={
            filtreSayisi > 0 ? `Filtreler, ${filtreSayisi} etkin` : "Filtreler"
          }
          className={`relative box-border flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-slate-900 transition active:scale-95 ${
            filtreSayisi > 0
              ? "border-2 border-slate-900"
              : "border border-slate-300 hover:border-slate-500"
          }`}
        >
          {filtreIkonu}
          {filtreSayisi > 0 && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-slate-900 px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-white"
            >
              {filtreSayisi}
            </span>
          )}
        </button>
      </div>
      {/* Şerit `grid-template-rows` ile katlanır (0fr ↔ 1fr): yükseklik
          animasyonu için içeriğin ölçüsünü bilmek gerekmez. Üstteki boşluk
          iç kapta, böylece katlıyken o da kaybolur. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: seritKatli ? "0fr" : "1fr" }}
        aria-hidden={seritKatli}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-2">
            <FiltreSeridi cipler={cipler} />
          </div>
        </div>
      </div>
    </div>
  );
}

function FiltreSeridi({ cipler }: { cipler: FiltreCipi[] }) {

  return (
    <div
      className="arama-filtre-serit flex snap-x items-center gap-2 overflow-x-auto"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as CSSProperties}
    >
      {/* SIRALAMA ÇİPİ YOK (kullanıcı kararı, 16 Eyl 2026): şeritte yalnız
          uygulanan filtreler. */}
      {cipler.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={c.onClick}
          aria-pressed={c.aktif}
          className={KABUK}
        >
          <span className={cipSinifi(c.aktif)}>{c.etiket}</span>
        </button>
      ))}
      <style>{`.arama-filtre-serit::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
