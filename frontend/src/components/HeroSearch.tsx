import { useRef, useState } from "react";
import { DistrictSelect } from "@/components/DistrictSelect";
import { MekanSelect, type MekanDegeri } from "@/components/MekanSelect";
import { categoryMeta, type CategoryKey } from "@/components/CategoryBar";
import { dersAra } from "@/lib/dersArama";
import { useSubjects } from "@/hooks/useSubjects";

/* ─── arama bileşenleri: büyük (açık) + kompakt (tetikleyici) ───────────
   Landing'in beğenilen Airbnb tarzı arama hapı. Hem ana sayfa hem de
   /egitmenler & /kutuphaneler gibi arama yüzeyleri ortak kullanır:
   • BigSearch  → geniş navbar'da gösterilen tek satır arama hapı.
   • CompactSearch → daralmış navbar'da bir buton; tıklanınca geniş hali açılır. */

const PinIconSvg = () => (
  <svg className="h-5 w-5 shrink-0 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
  /** "Uzaktan Eğitim" checkbox'ı — yalnız eğitmen aramasında anlamlı. */
  remote?: boolean;
  setRemote?: (v: boolean) => void;
  showRemoteOption?: boolean;
};

// Büyük (açık) arama — etiketsiz tek satır: ilçe (pin + değer) | yazı | ara.
export function BigSearch({
  q,
  setQ,
  district,
  setDistrict,
  onSubmit,
  placeholder,
  trending,
  remote,
  setRemote,
  showRemoteOption,
}: BigSearchProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="relative w-full max-w-2xl">
      <form
        onSubmit={onSubmit}
        // focus-within halkası: `outline-none` verilen girdide klavye
        // kullanıcısına "buradasın" işareti kalmıyordu; halka forma taşındı.
        className="flex w-full items-center rounded-full border border-slate-200 bg-white p-1.5 shadow-[0_3px_16px_rgba(15,23,42,0.10)] transition focus-within:border-indigo-400 focus-within:shadow-[0_6px_22px_rgba(15,23,42,0.13)] focus-within:ring-2 focus-within:ring-indigo-500/30 hover:shadow-[0_6px_22px_rgba(15,23,42,0.13)] "
      >
        <div className="flex shrink-0 items-center gap-2 rounded-full py-2.5 pl-4 pr-3 transition hover:bg-slate-50 ">
          <PinIconSvg />
          <DistrictSelect
            value={district}
            onChange={setDistrict}
            remote={remote}
            onRemoteChange={setRemote}
            showRemoteOption={showRemoteOption}
            triggerClassName="flex cursor-pointer items-center gap-1 bg-transparent text-sm font-medium text-slate-700 outline-none "
          />
        </div>

        <div className="h-7 w-px shrink-0 bg-slate-200 " />

        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          // Görsel etiket yok (placeholder tasarımın parçası); ekran okuyucu
          // için erişilebilir ad aria-label ile verilir.
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent px-5 text-sm text-slate-900 outline-none placeholder:text-slate-400 "
        />

        <button
          type="submit"
          aria-label="Ara"
          className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white transition hover:from-indigo-700 hover:to-violet-700 active:scale-95"
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
  mekan,
  setMekan,
  onSubmit,
}: {
  /** Seçili dersin kanonik `q` değeri; "" = seçim yok. */
  ders: string;
  /** Seçili dersin görünen adı (özet ve input değeri için). */
  dersEtiket: string;
  onDersChange: (q: string, label: string) => void;
  mekan: MekanDegeri;
  setMekan: (v: MekanDegeri) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const [text, setText] = useState(dersEtiket);
  const [focused, setFocused] = useState(false);
  // Öneri paneli MekanSelect ile AYNI desende `fixed` konumlanır: navbar'ın
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
        className="flex w-full items-center rounded-full border border-slate-200 bg-white p-1.5 shadow-[0_3px_16px_rgba(15,23,42,0.10)] transition focus-within:border-indigo-400 focus-within:shadow-[0_6px_22px_rgba(15,23,42,0.13)] focus-within:ring-2 focus-within:ring-indigo-500/30 hover:shadow-[0_6px_22px_rgba(15,23,42,0.13)] "
      >
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (ders) onDersChange("", ""); // yazmaya başlayınca seçim bozulur
          }}
          onFocus={odaklan}
          onBlur={() => setFocused(false)}
          placeholder='Ders "Matematik"'
          aria-label="Ders kategorisi"
          // İki bölme EŞİT genişlikte (flex-1 basis-0) — kullanıcı kararı.
          className="min-w-0 flex-1 basis-0 bg-transparent py-2.5 pl-5 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 "
        />

        <div className="h-7 w-px shrink-0 bg-slate-200 " />

        {/* Ders girdisiyle AYNI his: hover zemini/hap yok, düz yazı alanı. */}
        <div className="flex min-w-0 flex-1 basis-0 items-center py-2.5 pl-3 pr-2">
          <MekanSelect
            value={mekan}
            onChange={setMekan}
            hizaRef={formRef}
            // cursor-pointer YOK: burası artık yazılabilir bir metin alanı,
            // el imleci "buraya yazılmaz" hissi veriyordu.
            triggerClassName="w-full min-w-0 bg-transparent text-sm font-medium text-slate-700 outline-none"
          />
        </div>

        <button
          type="submit"
          aria-label="Ara"
          className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white transition hover:from-indigo-700 hover:to-violet-700 active:scale-95"
        >
          <SearchIconSvg />
        </button>
      </form>

      {/* Kategori önerileri — yazdıkça süzülür; boşken tam taksonomi.
          MekanSelect ile aynı desen: fixed konum + aynı kabuk görünümü. */}
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
                    onDersChange(s.name, s.name);
                    setText(s.name);
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
      <span className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white">
        <SearchIconSvg className="h-4 w-4" />
      </span>
    </button>
  );
}
