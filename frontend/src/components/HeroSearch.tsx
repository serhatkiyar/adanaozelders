import { useId, useRef, useState } from "react";
import { SecenekSatiri } from "@/components/ui/SecenekSatiri";
import { DersSimgesi } from "@/components/kesif/AramaAdimlari";
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
// `text-base md:text-sm`: iOS Safari 16px'ten KUCUK bir girdiye odaklaninca
// sayfayi otomatik buyutur ve kullanici elle geri kucultmek zorunda kalir.
// Masaustunde olcu degismedi.
const GIRDI =
  "w-full min-w-0 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 md:text-sm";

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
        className="flex w-full flex-col items-stretch rounded-3xl border border-slate-200 bg-white p-1.5 shadow-[0_3px_16px_rgba(15,23,42,0.10)] transition focus-within:border-marka-mid focus-within:shadow-[0_6px_22px_rgba(15,23,42,0.13)] focus-within:ring-2 focus-within:ring-marka-focus/30 hover:shadow-[0_6px_22px_rgba(15,23,42,0.13)] md:flex-row md:items-center md:rounded-full "
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

        <div className="h-px w-full shrink-0 bg-slate-200 md:h-7 md:w-px " />

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
          className="mt-1.5 flex h-12 w-full shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-marka to-marka-hover text-marka-fg transition hover:from-marka-hover hover:to-marka-hover active:scale-95 md:ml-1 md:mt-0 md:h-11 md:w-11"
        >
          <SearchIconSvg />
          <span className="ml-2 text-base font-semibold md:hidden">Ara</span>
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
  yakinimda = false,
  setYakinimda,
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
  /** "Yakınımda" niyeti — telefonun adımlı yüzeyiyle aynı seçenek. */
  yakinimda?: boolean;
  setYakinimda?: (v: boolean) => void;
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

  /* ODAK BİR SONRAKİ BOŞ ALANA GEÇER (kullanıcı kararı, 16 Eyl 2026): telefon
     adımlı yüzeyde seçim yapılınca sıradaki adım açılıyor; masaüstü hapı
     seçimden sonra olduğu yerde kalıyordu. Seçiciler odaklanınca kendi
     panelini açtığı için (`useSecici.ac`) odağı taşımak paneli de açar.
     Zamanlayıcı `setTimeout(0)`: tıklama olayı bittiğinde React durumu
     zaten işlemiş oluyor (ayrık olayda eşzamanlı flush), hedef bölme (Yer)
     DOM'da. `requestAnimationFrame` DEĞİL: arka plandaki sekmede kare
     çağrıları ertelenir, odak hiç gelmezdi (ölçüldü). Seçicinin kendi
     `kapat`ı tetikleyiciyi eşzamanlı blur'lar; bizim odak ondan sonra gelir. */
  const odagiTasi = (id: string) => {
    window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  };
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
        className="flex w-full flex-col items-stretch rounded-3xl border border-slate-200 bg-white p-1.5 shadow-[0_3px_16px_rgba(15,23,42,0.10)] transition focus-within:border-marka-mid focus-within:shadow-[0_6px_22px_rgba(15,23,42,0.13)] focus-within:ring-2 focus-within:ring-marka-focus/30 hover:shadow-[0_6px_22px_rgba(15,23,42,0.13)] md:flex-row md:items-center md:rounded-full "
      >
        {/* İki bölme EŞİT genişlikte (flex-1 basis-0) — kullanıcı kararı.
            Sınıf artık INPUT'ta değil sarmalayıcıda: etiket ile girdi alt alta
            duruyor. Sayı bölme başına BİR kalmalı, `aramaHapiIkizligi`
            nöbetçisi bunu sayıyor. */}
        <div className={BOLME + " min-h-[52px] px-4 md:min-h-0 md:pl-5 md:pr-3"}>
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
            placeholder="Ders ekleyin"
            className={GIRDI}
          />
        </div>

        <div className="h-px w-full shrink-0 bg-slate-200 md:h-7 md:w-px " />

        {/* Ders girdisiyle AYNI his: hover zemini/hap yok, düz yazı alanı. */}
        <div className={BOLME + " min-h-[52px] px-4 md:min-h-0 md:pl-3 md:pr-2"}>
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
              if (v === TeachingMode.IN_PERSON && !yer && !yakinimda) odagiTasi(yerId);
              else if (!ders && !dersEtiket) odagiTasi(dersId);
            }}
            hizaRef={formRef}
            // cursor-pointer YOK: burası artık yazılabilir bir metin alanı,
            // el imleci "buraya yazılmaz" hissi veriyordu.
            triggerClassName="w-full min-w-0 bg-transparent text-base font-medium text-slate-700 outline-none md:text-sm"
          />
        </div>

        {/* ÜÇÜNCÜ bölme — yalnız yüz yüzede. Hapın dış genişliği sabit kalır,
            bölmeler kendi aralarında yeniden paylaşır. */}
        {yerGorunur && (
          <>
            <div className="h-px w-full shrink-0 bg-slate-200 md:h-7 md:w-px " />
            <div className={BOLME + " min-h-[52px] px-4 md:min-h-0 md:pl-3 md:pr-2"}>
              <label htmlFor={yerId} className={ETIKET}>
                Yer
              </label>
              <YerSelect
                id={yerId}
                value={yer}
                onChange={(v) => {
                  setYer(v);
                  // İlçe ya da "Tüm yerler" seçimi yakınımda niyetini düşürür:
                  // ikisi aynı anda anlamsız (aynı kural `AramaAdimlari`).
                  setYakinimda?.(false);
                }}
                yakinimda={yakinimda}
                onYakinimda={
                  setYakinimda
                    ? () => {
                        setYer(null);
                        setYakinimda(true);
                      }
                    : undefined
                }
                hizaRef={formRef}
                triggerClassName="w-full min-w-0 bg-transparent text-base font-medium text-slate-700 outline-none md:text-sm"
              />
            </div>
          </>
        )}

        <button
          type="submit"
          aria-label="Ara"
          className="mt-1.5 flex h-12 w-full shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-marka to-marka-hover text-marka-fg transition hover:from-marka-hover hover:to-marka-hover active:scale-95 md:ml-1 md:mt-0 md:h-11 md:w-11"
        >
          <SearchIconSvg />
          <span className="ml-2 text-base font-semibold md:hidden">Ara</span>
        </button>
      </form>

      {/* Kategori önerileri — yazdıkça süzülür; boşken tam taksonomi.
          Seçicilerle aynı desen: fixed konum + aynı kabuk görünümü. */}
      {acik && (
        <div
          style={{ position: "fixed", top: pos!.top, left: pos!.left, width: pos!.width }}
          className="z-[90] max-h-[min(360px,50vh)] overflow-y-auto rounded-2xl bg-white px-2 py-2 shadow-xl ring-1 ring-slate-100 "
        >
          {oneriler.map((g) => (
            <div key={g.grup}>
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 ">
                {g.baslik}
              </p>
              {g.dersler.map((s) => (
                /* Sitenin TEK seçenek satırı (`ui/SecenekSatiri`); simge
                   telefondaki ders satırıyla aynı kitap. */
                <SecenekSatiri
                  key={`${g.grup}:${s.id}`}
                  simge={<DersSimgesi />}
                  baslik={s.name}
                  onClick={() => {
                    // `setText` ÇAĞRILMAZ: kutu artık kontrollü ve `setText`
                    // "seçimi boşalt" anlamına geliyor — hemen ardından
                    // çağrılsaydı bu satırda yazılan seçimi siler, aramaya
                    // `?subject=` yerine `?q=` giderdi (gerçek tarayıcı
                    // turunda böyle yakalandı).
                    onDersChange(s.name, s.name);
                    setFocused(false);
                    if (!sekil) odagiTasi(sekilId);
                  }}
                />
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

/* AD KUTUSU YOK (kullanıcı kararı, 16 Eyl 2026): kimse kütüphaneyi adıyla
   aramıyor, semtiyle arıyor. Telefonun adımlı yüzeyi 10 Eyl'den beri böyleydi;
   masaüstü hapı da artık tek soru sorar: NEREDE? `q` alanı adres şemasında
   duruyor (paylaşılan eski bağlantılar kırılmasın) ama hiçbir hap yazmıyor. */
export function KutuphaneArama({
  yer,
  setYer,
  yakinimda = false,
  setYakinimda,
  onSubmit,
}: {
  /** Seçili yer — ilçe ya da mahalle (bkz. lib/yerArama.ts). Ayrı bir ilçe
   *  listesi taşınmaz: `YerSecimi` ilçeyi zaten içinde tutuyor. */
  yer: YerSecimi | null;
  setYer: (v: YerSecimi | null) => void;
  /** "Yakınımda" niyeti — adreste `yakinimda=1`. */
  yakinimda?: boolean;
  setYakinimda?: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const ilceId = useId();

  return (
    <div className="relative w-full max-w-2xl">
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="flex w-full flex-col items-stretch rounded-3xl border border-slate-200 bg-white p-1.5 shadow-[0_3px_16px_rgba(15,23,42,0.10)] transition focus-within:border-marka-mid focus-within:shadow-[0_6px_22px_rgba(15,23,42,0.13)] focus-within:ring-2 focus-within:ring-marka-focus/30 hover:shadow-[0_6px_22px_rgba(15,23,42,0.13)] md:flex-row md:items-center md:rounded-full "
      >
        {/* Tek bölme; kabuk sınıfı `DersArama` ile ortak (`BOLME`). */}
        <div className={BOLME + " min-h-[52px] px-4 md:min-h-0 md:pl-5 md:pr-2"}>
          <label htmlFor={ilceId} className={ETIKET}>
            Yer
          </label>
          <YerSelect
            id={ilceId}
            value={yer}
            onChange={(v) => {
              setYer(v);
              setYakinimda?.(false);
            }}
            yakinimda={yakinimda}
            onYakinimda={
              setYakinimda
                ? () => {
                    setYer(null);
                    setYakinimda(true);
                  }
                : undefined
            }
            hizaRef={formRef}
            triggerClassName="w-full min-w-0 bg-transparent text-base font-medium text-slate-700 outline-none md:text-sm"
          />
        </div>

        <button
          type="submit"
          aria-label="Ara"
          className="mt-1.5 flex h-12 w-full shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-marka to-marka-hover text-marka-fg transition hover:from-marka-hover hover:to-marka-hover active:scale-95 md:ml-1 md:mt-0 md:h-11 md:w-11"
        >
          <SearchIconSvg />
          <span className="ml-2 text-base font-semibold md:hidden">Ara</span>
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
  yer,
  onOpen,
}: {
  active: CategoryKey;
  placeholder: string;
  /** Aranan şey: seçili ders ya da serbest metin. Boşsa `placeholder`. */
  q: string;
  /** Konum özeti (`konumOzeti`): "Uzaktan" / "Yakınımda" / "Merkez" / ilçe /
   *  mahalle. Null ise seçim yok. Hap ilçe dizisini KENDİSİ yorumlamaz —
   *  Merkez'i "4 ilçe", Yakınımda'yı "Tüm ilçeler" diye basıyordu. */
  yer: string | null;
  onOpen: () => void;
}) {
  const meta = categoryMeta(active);
  const yerSecili = !!yer;
  const districtLabel = yer ?? "Tüm ilçeler";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Aramayı aç"
      className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white py-4 pl-4 pr-4 shadow-[0_1px_8px_rgba(15,23,42,0.10)] transition hover:shadow-md md:w-[460px] md:max-w-[82vw] md:justify-start md:py-1.5 md:pl-2.5 md:pr-1.5 "
    >
      {/* TELEFONDA yalnız büyüteç. Burada eskiden seçili kategorinin resmi
          (`meta.icon`) duruyordu; referans alınan Airbnb hapında öyle bir şey
          YOK ve kullanıcı bunu itiraz olarak bildirdi. Resim masaüstünde
          kalıyor — orada hap zaten geniş ve kategori bilgisini taşıyor. */}
      <SearchIconSvg className="h-5 w-5 shrink-0 text-slate-500 md:hidden" />
      <img
        src={meta.icon}
        alt={meta.label}
        className="hidden h-7 w-7 shrink-0 object-contain md:block"
      />

      {/* İlçe etiketi — TELEFONDA yalnız gerçekten bir yer seçiliyken.
          "Tüm ilçeler" hiçbir şey söylemeyen bir varsayılandır ve 390px'te
          kalan yerin üçte birini yiyip asıl arama yazısını kesiyordu
          ("Ders, eğitmen ya da ko…"). Masaüstünde ölçü bol, orada duruyor. */}
      <span
        className={`${yerSecili ? "inline" : "hidden"} shrink-0 text-sm md:inline ${
          yerSecili ? "font-semibold text-slate-800 " : "text-slate-500 "
        }`}
      >
        {districtLabel}
      </span>

      {/* Ayraç — etiketle birlikte görünür/gizlenir. */}
      <div
        className={`${yerSecili ? "block" : "hidden"} h-5 w-px shrink-0 bg-slate-200 md:block`}
      />

      {/* Arama yazısı — telefonda ortalı ve koyu (hapın tek içeriği o),
          masaüstünde sola yaslı ve ikincil. */}
      <span
        className={`min-w-0 truncate text-center text-[15px] font-semibold text-slate-800 md:flex-1 md:text-left md:text-sm md:font-normal ${
          q ? "md:text-slate-800 " : "md:text-slate-400 "
        }`}
      >
        {q || placeholder}
      </span>

      {/* Turuncu gönder düğmesi TELEFONDA YOK: hapın kendisi zaten düğme,
          içine ikinci bir düğme koymak hem yanıltıcı hem de referansta yok. */}
      <span className="ml-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-marka to-marka-hover text-marka-fg md:flex">
        <SearchIconSvg className="h-4 w-4" />
      </span>
    </button>
  );
}
