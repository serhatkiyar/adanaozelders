import { useId, useRef, useState } from "react";
import { DistrictSelect } from "@/components/DistrictSelect";
import {
  SekilSelect,
  YerSelect,
  type DersSekli,
} from "@/components/AramaSecicileri";
import type { YerSecimi } from "@/lib/yerArama";
import { TeachingMode } from "@/types";
import { categoryMeta, type CategoryKey } from "@/components/CategoryBar";
import { dersAra } from "@/lib/dersArama";
import { useSubjects } from "@/hooks/useSubjects";

/* ─── Alan başlığı deseni (Airbnb, kullanıcı kararı 8 Eyl) ──────────────
   Alan adı önce PLACEHOLDER'ın kendisiydi (`Ders "Matematik"`) ve kod bunu
   bilinçli yazmıştı. İki kusuru vardı: kullanıcı yazmaya başlayınca alanın ne
   olduğu kayboluyor, ve iki bölmeli hapta hangi kutunun ne olduğu ancak içine
   tıklayınca anlaşılıyordu. Airbnb ikisini ayırır: etiket KALICI, ipucu
   placeholder'da. Bizde eksik olan yalnız üstteki satırdı.

   `flex-1 basis-0` artık BÖLME sarmalayıcısında (eskiden input'taydı) ve bölme
   başına BİR kez geçer — `__guards__/aramaHapiIkizligi.test.ts` bunu sayıyor.

   Etiket varken girdilere `aria-label` YAZILMAZ: ikisi birlikteyken ekran
   okuyucu `aria-label`ı okur ve görünen etiket sessizce yok sayılır. */
const BOLME = "flex min-w-0 flex-1 basis-0 flex-col justify-center py-1";
// 12px: ilk deneme 11px'di ve kullanıcı "yazılar küçük" dedi. Airbnb'nin alan
// başlığı da 12px — girdi metninden (14px) ayrışacak kadar küçük, okunacak
// kadar büyük.
const ETIKET = "cursor-pointer text-xs font-semibold leading-tight text-slate-700";
const GIRDI =
  "w-full min-w-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400";

/* ─── arama bileşenleri: büyük (açık) + kompakt (tetikleyici) ───────────
   Landing'in beğenilen Airbnb tarzı arama hapı. Hem ana sayfa hem de
   /egitmenler & /kutuphaneler gibi arama yüzeyleri ortak kullanır:
   • BigSearch  → geniş navbar'da gösterilen tek satır arama hapı.
   • CompactSearch → daralmış navbar'da bir buton; tıklanınca geniş hali açılır. */

const PinIconSvg = () => (
  <svg className="h-5 w-5 shrink-0 text-marka-metin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
  </svg>
);

export const SearchIconSvg = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
  </svg>
);

const TrendIconSvg = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8M21 7v5m0-5h-5" />
  </svg>
);

export type BigSearchProps = {
  q: string;
  setQ: (v: string) => void;
  district: string[];
  setDistrict: (v: string[]) => void;
  onSubmit: (e: React.FormEvent) => void;
  placeholder: string;
  /** Verilirse input boş+odaktayken trend aramalar popover'ı açılır. */
  trending?: readonly string[];
  /* Alan başlıkları çağıranda yaşar: aynı hap eğitmen sonuçlarında "Ders",
     kütüphane sonuçlarında "Kütüphane" arıyor.

     `sagBaslik` ZORUNLU. Nötr bir varsayılan ("Ara") denendi ve ölçüldü:
     hapın gönder düğmesinin erişilebilir adı da "Ara" — ekran okuyucuda aynı
     hapta iki "Ara" oluyordu. Sol taraf "İlçe" her yüzeyde aynı olduğu için
     varsayılan kalabiliyor. */
  solBaslik?: string;
  sagBaslik: string;
  /** Mahalle çapası (bkz. lib/yerArama.ts). Verilmezse yalnız ilçe seçilir. */
  yer?: YerSecimi | null;
  setYer?: (v: YerSecimi | null) => void;
};

// Büyük (açık) arama — tek satır: ilçe (pin + değer) | yazı | ara.
export function BigSearch({
  q,
  setQ,
  district,
  setDistrict,
  onSubmit,
  placeholder,
  trending,
  solBaslik = "Yer",
  sagBaslik,
  yer = null,
  setYer,
}: BigSearchProps) {
  const [focused, setFocused] = useState(false);
  const ilceId = useId();
  const qId = useId();

  return (
    <div className="relative w-full max-w-2xl">
      <form
        onSubmit={onSubmit}
        // focus-within halkası: `outline-none` verilen girdide klavye
        // kullanıcısına "buradasın" işareti kalmıyordu; halka forma taşındı.
        className="flex w-full items-center rounded-full border border-slate-200 bg-white p-1.5 shadow-[0_3px_16px_rgba(15,23,42,0.10)] transition focus-within:border-marka-mid focus-within:shadow-[0_6px_22px_rgba(15,23,42,0.13)] focus-within:ring-2 focus-within:ring-marka-focus/30 hover:shadow-[0_6px_22px_rgba(15,23,42,0.13)] "
      >
        <div className="flex shrink-0 items-center gap-2 rounded-full py-1.5 pl-4 pr-3 transition hover:bg-slate-50 ">
          <PinIconSvg />
          {/* Tetikleyici bir <button>; `<label htmlFor>` ona bağlanmaz ve
              ESLint de kabul etmez. Görünür başlık bir <span>, erişilebilir ad
              `aria-labelledby` ile ona bağlanıyor. */}
          <div className="flex min-w-0 flex-col justify-center py-1">
            <span id={ilceId} className={ETIKET}>
              {solBaslik}
            </span>
            <DistrictSelect
              value={district}
              onChange={setDistrict}
              yer={yer}
              onYerChange={setYer}
              triggerLabelledBy={ilceId}
              triggerClassName="flex cursor-pointer items-center gap-1 bg-transparent text-sm font-medium text-slate-700 outline-none "
            />
          </div>
        </div>

        <div className="h-7 w-px shrink-0 bg-slate-200 " />

        <div className="flex min-w-0 flex-1 flex-col justify-center px-5 py-1">
          <label htmlFor={qId} className={ETIKET}>
            {sagBaslik}
          </label>
          <input
            id={qId}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            className={GIRDI}
          />
        </div>

        <button
          type="submit"
          aria-label="Ara"
          className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-marka to-marka-hover text-marka-fg transition hover:from-marka-hover hover:to-marka-hover active:scale-95"
        >
          <SearchIconSvg />
        </button>
      </form>

      {/* Trend aramalar popover */}
      {trending && focused && !q.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl bg-white py-2 shadow-xl ring-1 ring-slate-100 ">
          <p className="flex items-center gap-1.5 px-4 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 ">
            <TrendIconSvg />
            Trend aramalar
          </p>
          {trending.map((t) => (
            <button
              key={t}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQ(t);
                setFocused(false);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 "
            >
              <span className="shrink-0 text-slate-400">
                <SearchIconSvg className="h-4 w-4" />
              </span>
              <span>{t}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── DersArama: Landing'in yeni arama hapı (kullanıcı tasarımı, 29 Ağu) ───
   Solda YAZILABİLİR ders kategorisi seçici (yazdıkça taksonomiden öneriler),
   ortada ders mekânı (Online/Yüz yüze checkbox'ları; yüz yüze → ilçe),
   sağda Ara. Serbest metin arama KALDIRILDI, kategori seçimi onun yerini
   aldı (eğitmen adıyla arama /egitmenler sayfasında yaşar). Diğer yüzeyler
   (Libraries/Marketplace) BigSearch'ü kullanmaya devam eder. */

export function DersArama({
  ders,
  dersEtiket,
  onDersChange,
  sekil,
  setSekil,
  yer,
  setYer,
  onSubmit,
}: {
  /** Seçili dersin kanonik `q` değeri; "" = seçim yok. */
  ders: string;
  /** Seçili dersin görünen adı (özet ve input değeri için). */
  dersEtiket: string;
  /**
   * Seçim değişti. `label` aynı zamanda kutuda GÖRÜNEN metindir.
   *
   * Ham metin de yukarı çıkar (kontrollü bileşen): eskiden burada yerel bir
   * `text` state'i vardı ve dışarı hiç sızmıyordu; yazmaya başlayınca seçim
   * bozulduğu için (`onDersChange("","")`) sayfa yalnız SEÇİLMİŞ dersi
   * yazabiliyordu. Sonuç: "matematik" yazıp listeden seçmeden Ara'ya basan
   * kullanıcının yazdığı şey hiçbir yere gitmiyordu.
   */
  onDersChange: (q: string, label: string) => void;
  /** Ders şekli — TEK seçim, `""` = fark etmez. */
  sekil: DersSekli;
  setSekil: (v: DersSekli) => void;
  /** Yer YALNIZ "Yüz yüze" seçiliyken sorulur (bkz. AramaSecicileri.tsx). */
  yer: YerSecimi | null;
  setYer: (v: YerSecimi | null) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  // Kutunun metni = `dersEtiket`. Seçim yapılınca etiket, yazılırken ham
  // metin — ikisi de yukarıda tek state'te tutulur (kontrollü bileşen).
  const text = dersEtiket;
  const [focused, setFocused] = useState(false);
  const dersId = useId();
  const sekilId = useId();
  const yerId = useId();
  // Üçüncü bölme YALNIZ yüz yüze seçiliyken var. Kullanıcının tasarımı:
  // uzaktan ders arayana yer sormak anlamsız, üstelik uzaktan eğitmenlerin
  // ilçesi tasarım gereği boş olduğu için onları sessizce elerdi.
  const yerGorunur = sekil === TeachingMode.IN_PERSON;
  // Öneri paneli seçicilerle AYNI desende `fixed` konumlanır: navbar'ın
  // max-height'la katlanan kabı `absolute` paneli akışa karıştırıyordu
  // ("seçenekler ana akışın altına yükleniyor" hatası).
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Öneri kutusu TAM katalogdan beslenir. Küratörlü listeyle sınırlamak
  // ölçüldü ve kırıktı: "yazılım", "hukuk", "psikoloji", "Kuran" gibi gerçek
  // aramalar hiçbir şey döndürmüyordu. Arkasında eğitmen olmayan ders
  // gizlenmez, sıralamada aşağı iner (bkz. dersAra).
  const { data: katalog } = useSubjects("secim");
  const oneriler = dersAra(katalog, ders && text === dersEtiket ? "" : text);
  const acik = focused && oneriler.length > 0 && pos != null;

  const odaklan = () => {
    const r = formRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: r.left, width: r.width });
    setFocused(true);
  };

  return (
    <div className="relative w-full max-w-2xl">
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="flex w-full items-center rounded-full border border-slate-200 bg-white p-1.5 shadow-[0_3px_16px_rgba(15,23,42,0.10)] transition focus-within:border-marka-mid focus-within:shadow-[0_6px_22px_rgba(15,23,42,0.13)] focus-within:ring-2 focus-within:ring-marka-focus/30 hover:shadow-[0_6px_22px_rgba(15,23,42,0.13)] "
      >
        {/* İki bölme EŞİT genişlikte (flex-1 basis-0) — kullanıcı kararı.
            Sınıf artık INPUT'ta değil sarmalayıcıda: etiket ile girdi alt alta
            duruyor. Sayı bölme başına BİR kalmalı, `aramaHapiIkizligi`
            nöbetçisi bunu sayıyor. */}
        <div className={BOLME + " pl-5 pr-3"}>
          <label htmlFor={dersId} className={ETIKET}>
            Ders
          </label>
          <input
            id={dersId}
            type="text"
            value={text}
            // Yazmaya başlayınca SEÇİM bozulur ama METİN korunur: yazılan
            // şey artık `q=` olarak aramaya gidiyor (bkz. aramaUrl.dersSorgusu).
            onChange={(e) => onDersChange("", e.target.value)}
            onFocus={odaklan}
            onBlur={() => setFocused(false)}
            placeholder="Matematik, İngilizce…"
            className={GIRDI}
          />
        </div>

        <div className="h-7 w-px shrink-0 bg-slate-200 " />

        {/* Ders girdisiyle AYNI his: hover zemini/hap yok, düz yazı alanı. */}
        <div className={BOLME + " pl-3 pr-2"}>
          <label htmlFor={sekilId} className={ETIKET}>
            Ders şekli
          </label>
          <SekilSelect
            id={sekilId}
            value={sekil}
            onChange={(v) => {
              setSekil(v);
              // Yüz yüzeden çıkıldığında yer seçimi de düşer: görünmeyen bir
              // alanın sessizce aramaya karışması, kullanıcının göremediği
              // bir filtre demektir.
              if (v !== TeachingMode.IN_PERSON) setYer(null);
            }}
            hizaRef={formRef}
            // cursor-pointer YOK: burası artık yazılabilir bir metin alanı,
            // el imleci "buraya yazılmaz" hissi veriyordu.
            triggerClassName="w-full min-w-0 bg-transparent text-sm font-medium text-slate-700 outline-none"
          />
        </div>

        {/* ÜÇÜNCÜ bölme — yalnız yüz yüzede. Hapın dış genişliği sabit kalır,
            bölmeler kendi aralarında yeniden paylaşır. */}
        {yerGorunur && (
          <>
            <div className="h-7 w-px shrink-0 bg-slate-200 " />
            <div className={BOLME + " pl-3 pr-2"}>
              <label htmlFor={yerId} className={ETIKET}>
                Yer
              </label>
              <YerSelect
                id={yerId}
                value={yer}
                onChange={setYer}
                hizaRef={formRef}
                triggerClassName="w-full min-w-0 bg-transparent text-sm font-medium text-slate-700 outline-none"
              />
            </div>
          </>
        )}

        <button
          type="submit"
          aria-label="Ara"
          className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-marka to-marka-hover text-marka-fg transition hover:from-marka-hover hover:to-marka-hover active:scale-95"
        >
          <SearchIconSvg />
        </button>
      </form>

      {/* Kategori önerileri — yazdıkça süzülür; boşken tam taksonomi.
          Seçicilerle aynı desen: fixed konum + aynı kabuk görünümü. */}
      {acik && (
        <div
          style={{ position: "fixed", top: pos!.top, left: pos!.left, width: pos!.width }}
          className="z-[90] max-h-[min(360px,50vh)] overflow-y-auto rounded-2xl bg-white py-2 shadow-xl ring-1 ring-slate-100 "
        >
          {oneriler.map((g) => (
            <div key={g.grup}>
              <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 ">
                {g.baslik}
              </p>
              {g.dersler.map((s) => (
                <button
                  key={`${g.grup}:${s.id}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    // `setText` ÇAĞRILMAZ: kutu artık kontrollü ve `setText`
                    // "seçimi boşalt" anlamına geliyor — hemen ardından
                    // çağrılsaydı bu satırda yazılan seçimi siler, aramaya
                    // `?subject=` yerine `?q=` giderdi (gerçek tarayıcı
                    // turunda böyle yakalandı).
                    onDersChange(s.name, s.name);
                    setFocused(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 "
                >
                  <span className="shrink-0 text-slate-400">
                    <SearchIconSvg className="h-4 w-4" />
                  </span>
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── KutuphaneArama: `DersArama`nın kütüphane ikizi (kullanıcı kararı, 7 Eyl) ──
   Ana sayfada iki sekme iki AYRI arama tasarımı gösteriyordu: eğitmende
   yazılabilir iki bölme, kütüphanede pin + açılır ilçe menüsü + serbest metin.
   Aynı çubuğun iki farklı hâli olmasının bir gerekçesi yoktu.

   Sıralama ve görünüm artık birebir aynı: solda yazılan alan, ayraç, sağda
   mekân alanı, sağ uçta Ara. TEK fark sağ bölmenin içeriği — eğitmende
   "Online / Yüz yüze / İkisi de olur" satırları var, kütüphanede yok
   (fiziksel mekân). Kabuk sınıfları `DersArama` ile ortak; biri değişirse
   diğeri de değişmeli — nöbetçi: `__guards__/aramaHapiIkizligi.test.ts`. */

export function KutuphaneArama({
  q,
  setQ,
  yer,
  setYer,
  onSubmit,
  // Konum YANDAKİ alanda seçiliyor; ad kutusunda semtin işi yok
  // (kullanıcı, 8 Eyl: "kütüphane semt araması ne alaka").
  placeholder = "Kütüphane adı",
}: {
  q: string;
  setQ: (v: string) => void;
  /** Seçili yer — ilçe ya da mahalle (bkz. lib/yerArama.ts). Ayrı bir ilçe
   *  listesi taşınmaz: `YerSecimi` ilçeyi zaten içinde tutuyor. */
  yer: YerSecimi | null;
  setYer: (v: YerSecimi | null) => void;
  onSubmit: (e: React.FormEvent) => void;
  placeholder?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const adId = useId();
  const ilceId = useId();

  return (
    <div className="relative w-full max-w-2xl">
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="flex w-full items-center rounded-full border border-slate-200 bg-white p-1.5 shadow-[0_3px_16px_rgba(15,23,42,0.10)] transition focus-within:border-marka-mid focus-within:shadow-[0_6px_22px_rgba(15,23,42,0.13)] focus-within:ring-2 focus-within:ring-marka-focus/30 hover:shadow-[0_6px_22px_rgba(15,23,42,0.13)] "
      >
        {/* İki bölme EŞİT genişlikte (flex-1 basis-0) — `DersArama` ile aynı. */}
        <div className={BOLME + " pl-5 pr-3"}>
          <label htmlFor={adId} className={ETIKET}>
            Kütüphane
          </label>
          <input
            id={adId}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className={GIRDI}
          />
        </div>

        <div className="h-7 w-px shrink-0 bg-slate-200 " />

        <div className={BOLME + " pl-3 pr-2"}>
          <label htmlFor={ilceId} className={ETIKET}>
            Yer
          </label>
          <YerSelect
            id={ilceId}
            value={yer}
            onChange={setYer}
            hizaRef={formRef}
            triggerClassName="w-full min-w-0 bg-transparent text-sm font-medium text-slate-700 outline-none"
          />
        </div>

        <button
          type="submit"
          aria-label="Ara"
          className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-marka to-marka-hover text-marka-fg transition hover:from-marka-hover hover:to-marka-hover active:scale-95"
        >
          <SearchIconSvg />
        </button>
      </form>
    </div>
  );
}

// Kompakt (daralmış) arama — navbar ortasında bir buton. Tıklayınca geniş
// navbar (kategoriler + büyük arama) YERİNDE açılır; sayfa kaymaz.
export function CompactSearch({
  active,
  placeholder,
  q,
  district,
  remote = false,
  onOpen,
}: {
  active: CategoryKey;
  placeholder: string;
  q: string;
  district: string[];
  remote?: boolean;
  onOpen: () => void;
}) {
  const meta = categoryMeta(active);
  const districtLabel =
    district.length > 0
      ? district.length === 1
        ? district[0]
        : `${district.length} ilçe`
      : remote
        ? "Uzaktan Eğitim"
        : "Tüm ilçeler";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Aramayı aç"
      className="flex w-[460px] max-w-[82vw] items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-2.5 pr-1.5 shadow-[0_1px_8px_rgba(15,23,42,0.10)] transition hover:shadow-md "
    >
      {/* Seçili kategori ikonu */}
      <img src={meta.icon} alt={meta.label} className="h-7 w-7 shrink-0 object-contain" />

      {/* İlçe etiketi */}
      <span className={`shrink-0 text-sm ${district.length > 0 || remote ? "font-semibold text-slate-800 " : "text-slate-500 "}`}>
        {districtLabel}
      </span>

      {/* Ayraç */}
      <div className="h-5 w-px shrink-0 bg-slate-200 " />

      {/* Arama yazısı */}
      <span className={`flex-1 truncate text-left text-sm ${q ? "text-slate-800 " : "text-slate-400 "}`}>
        {q || placeholder}
      </span>

      {/* Arama butonu */}
      <span className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-marka to-marka-hover text-marka-fg">
        <SearchIconSvg className="h-4 w-4" />
      </span>
    </button>
  );
}
