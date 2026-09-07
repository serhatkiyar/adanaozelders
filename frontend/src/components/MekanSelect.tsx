import { useRef, useState } from "react";
import { SEARCH_PRIMARY_DISTRICTS, SEARCH_MORE_DISTRICTS } from "@/lib/districts";

/* ─────────────────────────────────────────────────────────────────────────
   Ders MEKÂNI seçici, ders kategorisi seçicisiyle AYNI etkileşim (kullanıcı
   kararı, 29 Ağu): yazılabilir kutu, altında düz satırlar; satıra TIKLAYINCA
   seçilir ve panel kapanır. Checkbox/Tamam/Temizle yok.

   Satırlar: Online · Yüz yüze · İkisi de olur, ardından İLÇE satırları
   (bir ilçeye tıklamak = o ilçede yüz yüze). Yazınca hepsi tek listede
   süzülür ("sey" → Seyhan, "onl" → Online).
   ──────────────────────────────────────────────────────────────────────── */

export interface MekanDegeri {
  online: boolean;
  yuzyuze: boolean;
  district: string[];
}

export function mekanOzeti(v: MekanDegeri): string {
  if (v.online && v.yuzyuze) return "Online + Yüz yüze";
  if (v.online) return "Online";
  if (v.yuzyuze) {
    if (v.district.length === 1) return `Yüz yüze · ${v.district[0]}`;
    if (v.district.length > 1) return `Yüz yüze · ${v.district.length} ilçe`;
    return "Yüz yüze";
  }
  return "Ders mekânı";
}

const kucult = (s: string) => s.toLocaleLowerCase("tr-TR").trim();

const MEKAN_SATIRLARI: { etiket: string; deger: Omit<MekanDegeri, "district"> }[] = [
  { etiket: "Online", deger: { online: true, yuzyuze: false } },
  { etiket: "Yüz yüze", deger: { online: false, yuzyuze: true } },
  { etiket: "İkisi de olur", deger: { online: true, yuzyuze: true } },
];

const PinSvg = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
  </svg>
);

export function MekanSelect({
  value,
  onChange,
  triggerClassName = "",
  hizaRef,
}: {
  value: MekanDegeri;
  onChange: (next: MekanDegeri) => void;
  triggerClassName?: string;
  /** Panelin hizalanacağı öğe (ör. arama hapının form'u). Verilmezse kutunun kendisi. */
  hizaRef?: React.RefObject<HTMLElement>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLInputElement>(null);

  const secili = value.online || value.yuzyuze;

  const openPopover = () => {
    // Ders paneliyle AYNI hiza: panel rastgele kutunun altına değil,
    // hapın tamamına oturur (kullanıcı geri bildirimi, 29 Ağu).
    const r = (hizaRef?.current ?? triggerRef.current)?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: r.left, width: r.width });
    setOpen(true);
  };

  const sec = (next: MekanDegeri) => {
    onChange(next);
    setText("");
    setOpen(false);
    triggerRef.current?.blur();
  };

  const n = kucult(text);
  const mekanlar = n ? MEKAN_SATIRLARI.filter((m) => kucult(m.etiket).includes(n)) : MEKAN_SATIRLARI;
  const TUM_ILCELER = [...SEARCH_PRIMARY_DISTRICTS, ...SEARCH_MORE_DISTRICTS];
  const ilceler = n ? TUM_ILCELER.filter((x) => kucult(x).includes(n)) : TUM_ILCELER;

  return (
    <>
      <input
        ref={triggerRef}
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!open) openPopover();
        }}
        onFocus={openPopover}
        onBlur={() => setOpen(false)}
        placeholder={mekanOzeti(value)}
        aria-label="Ders mekânı"
        className={`${triggerClassName} ${
          secili ? "placeholder:font-semibold placeholder:text-slate-700 " : "placeholder:text-slate-400 "
        }`}
      />

      {open && pos && (
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
          className="z-[90] max-h-[min(360px,50vh)] overflow-y-auto rounded-2xl bg-white py-2 shadow-xl ring-1 ring-slate-100 "
        >
          {mekanlar.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 ">
                Ders mekânı
              </p>
              {mekanlar.map((m) => (
                <Satir
                  key={m.etiket}
                  etiket={m.etiket}
                  ikon={<PinSvg />}
                  onClick={() => sec({ ...m.deger, district: [] })}
                />
              ))}
            </>
          )}

          {ilceler.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 ">
                Yüz yüze · İlçe
              </p>
              {ilceler.map((dName) => (
                <Satir
                  key={dName}
                  etiket={dName}
                  ikon={<PinSvg />}
                  onClick={() => sec({ online: false, yuzyuze: true, district: [dName] })}
                />
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Ders önerileriyle aynı satır görünümü: ikon + etiket, tıkla-seç-kapan. */
function Satir({ etiket, ikon, onClick }: { etiket: string; ikon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 "
    >
      <span className="shrink-0 text-slate-400">{ikon}</span>
      <span>{etiket}</span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   İlçe seçici — `MekanSelect`in KÜTÜPHANE ikizi (kullanıcı kararı, 7 Eyl).

   Kütüphane fiziksel bir mekândır: "Online / Yüz yüze / İkisi de olur"
   satırları orada anlamsız. Geriye kalan TEK fark budur; etkileşim ve
   görünüm birebir aynı: yazılabilir kutu, altında düz satırlar, satıra
   TIKLAYINCA seçilir ve panel kapanır. Checkbox/Tamam/Temizle yok.

   Aynı dosyada duruyor ki satır görünümü (`Satir`), ikon ve panel kabuğu
   ikisinde de TEK yerden gelsin — ayrı dosyaya alınsaydı biri değişip
   diğeri kalabilirdi ve "tasarım benzesin" kararı sessizce bozulurdu.

   Not: seçim TEK ilçedir (`[d]`), tıpkı `MekanSelect`in ilçe satırları gibi.
   Çoklu ilçe hâlâ /kutuphaneler sayfasının `DistrictSelect`inde yaşıyor.
   ──────────────────────────────────────────────────────────────────────── */

export function IlceSelect({
  value,
  onChange,
  triggerClassName = "",
  hizaRef,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  triggerClassName?: string;
  /** Panelin hizalanacağı öğe (arama hapının form'u). */
  hizaRef?: React.RefObject<HTMLElement>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLInputElement>(null);

  const ozet =
    value.length === 1 ? value[0] : value.length > 1 ? `${value.length} ilçe` : "Tüm ilçeler";

  const openPopover = () => {
    const r = (hizaRef?.current ?? triggerRef.current)?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: r.left, width: r.width });
    setOpen(true);
  };

  const sec = (next: string[]) => {
    onChange(next);
    setText("");
    setOpen(false);
    triggerRef.current?.blur();
  };

  const n = kucult(text);
  const TUM_ILCELER = [...SEARCH_PRIMARY_DISTRICTS, ...SEARCH_MORE_DISTRICTS];
  const ilceler = n ? TUM_ILCELER.filter((x) => kucult(x).includes(n)) : TUM_ILCELER;
  // "Tüm ilçeler" satırı seçimi TEMİZLER. `MekanSelect`te karşılığı yok çünkü
  // orada mekân satırları zaten sıfırlıyor; burada olmasa seçim geri alınamazdı.
  const tumuGoster = !n || kucult("Tüm ilçeler").includes(n);

  return (
    <>
      <input
        ref={triggerRef}
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!open) openPopover();
        }}
        onFocus={openPopover}
        onBlur={() => setOpen(false)}
        placeholder={ozet}
        aria-label="İlçe"
        className={`${triggerClassName} ${
          value.length > 0
            ? "placeholder:font-semibold placeholder:text-slate-700 "
            : "placeholder:text-slate-400 "
        }`}
      />

      {open && pos && (
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
          className="z-[90] max-h-[min(360px,50vh)] overflow-y-auto rounded-2xl bg-white py-2 shadow-xl ring-1 ring-slate-100 "
        >
          {tumuGoster && (
            <Satir etiket="Tüm ilçeler" ikon={<PinSvg />} onClick={() => sec([])} />
          )}

          {ilceler.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 ">
                İlçe
              </p>
              {ilceler.map((d) => (
                <Satir key={d} etiket={d} ikon={<PinSvg />} onClick={() => sec([d])} />
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}
