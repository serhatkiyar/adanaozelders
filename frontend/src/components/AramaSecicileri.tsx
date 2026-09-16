import { useCallback, useEffect, useRef, useState } from "react";
import { SecenekSatiri } from "@/components/ui/SecenekSatiri";

import { yerAra, yerEtiketi, type YerSecimi } from "@/lib/yerArama";
import { TeachingMode } from "@/types";

/* ─────────────────────────────────────────────────────────────────────────
   Arama hapının iki seçicisi: DERS ŞEKLİ ve YER.

   ## Neden ayrıldılar (kullanıcı, 8 Eyl 2026)

   Eskiden tek bir "ders mekânı" seçicisi vardı ve içinde hem ders şekli
   (Online / Yüz yüze / İkisi de olur) hem de ilçe satırları yan yana
   duruyordu. İkisi birbirini eziyordu: bir şekle tıklamak ilçeyi siliyor,
   bir ilçeye tıklamak online'ı zorla kapatıyordu. Kullanıcının şikâyeti
   birebir şuydu: *"mevcut tasarım çok kafa karıştırıcı."*

   "İkisi de olur" satırı ayrıca YALAN söylüyordu: kutuda "Online + Yüz yüze"
   yazarken adrese hiçbir mod parametresi yazılmıyordu — yani filtre
   uygulanmıyor, KALDIRILIYORDU. Hiç seçim yapmamakla ürettiği adres birebir
   aynıydı.

   ## Bugünkü kural (kullanıcı kararı)

   Ders şekli TEK seçimdir: *"yalnızca bir seçenek seçilebilsin, yüz yüze veya
   uzaktan."* Ve **yer yalnız "Yüz yüze" seçiliyken sorulur.**

   Bu, sorunu kökünden kaldırıyor: "fark etmez + Seyhan" kombinasyonu artık
   OLUŞAMIYOR. Uzaktan ders arayan kimseye yer sorulmadığı için, ilçesi
   tasarım gereği boş olan (bkz. `tutorOnboarding/sozlesme.ts` — ilçe yalnız
   yüz yüzede zorunlu) uzaktan eğitmenlerin bir ilçe filtresiyle sessizce
   elenmesi imkânsız hâle geliyor.

   Nöbetçi: `__guards__/aramaHapiIkizligi.test.ts`.
   ──────────────────────────────────────────────────────────────────────── */

/** Ders şekli — tek seçim. `""` = fark etmez (filtre uygulanmaz). */
export type DersSekli = TeachingMode.ONLINE | TeachingMode.IN_PERSON | "";

/** Seçici kutularında ve özet satırlarında kullanılan tek sözlük.
 *  Aynı kavram bir zamanlar beş ayrı adla dolaşıyordu ("Ders mekânı",
 *  "İkisi de olur", "Eğitim Şekli", "Tümü", "Her İkisi"). */
export const SEKIL_ADI: Record<DersSekli, string> = {
  [TeachingMode.ONLINE]: "Uzaktan",
  [TeachingMode.IN_PERSON]: "Yüz yüze",
  "": "Fark etmez",
};

/** URL'den gelen ham `mode` değerini güvenle çözer.
 *  Elle yazılmış `?mode=abc` sunucuya ULAŞMAMALI; enum üyesi değilse
 *  "fark etmez"e düşer. `BOTH` de burada elenir: eğitmenin ilan değeridir,
 *  arama filtresi değil — kullanıcının "fark etmez"i filtresizliktir. */
export function sekliCoz(ham: string | null): DersSekli {
  return ham === TeachingMode.ONLINE || ham === TeachingMode.IN_PERSON ? ham : "";
}

/* Telefonla AYNI liste (kullanıcı kararı, 16 Eyl 2026): önce Yüz yüze, sonra
   Uzaktan; açıklama satırı yok. "Fark etmez" RAFTA — seçenek olarak
   çizilmez; boş değer adreste geçerli kalır ve `SEKIL_ADI`de durur. */
const SEKIL_SATIRLARI: { deger: DersSekli; aciklama?: string }[] = [
  { deger: TeachingMode.IN_PERSON },
  { deger: TeachingMode.ONLINE },
];

const kucult = (s: string) => s.toLocaleLowerCase("tr-TR").trim();

/* Satır simgesi: 24px siyah çizgi ikon, ölçü `ui/SecenekSatiri`nin kutusundan. */
const PinSvg = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
  </svg>
);

/* Ders şekli satırında TELEFONLA AYNI FOTOĞRAF (kullanıcı kararı, 16 Eyl
   2026): `/icons/ders-sekli/*.webp`, 40px yuvarlak kare. Çizgi ikon (ekran /
   iğne) telefondaki adımla ayrışıyordu. */
const SekilSvg = ({ deger }: { deger: DersSekli }) => (
  <img
    src={`/icons/ders-sekli/${deger === TeachingMode.ONLINE ? "uzaktan" : "yuzyuze"}.webp`}
    alt=""
    aria-hidden
    width={40}
    height={40}
    decoding="async"
    className="h-full w-full object-cover"
  />
);

/** Panelin ortak kabuğu — iki seçici de AYNI görünümü paylaşır. */
function Panel({
  pos,
  children,
}: {
  pos: { top: number; left: number; width: number };
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
      className="z-[90] max-h-[min(360px,50vh)] overflow-y-auto rounded-2xl bg-white px-2 py-2 shadow-xl ring-1 ring-slate-100 "
    >
      {children}
    </div>
  );
}

/** Seçici satırı = sitenin TEK seçenek satırı (`ui/SecenekSatiri`); ölçü
 *  orada. Bu sarmalayıcı yalnız ad çevirir (`aramaHapiIkizligi` nöbetçisi
 *  dosyada tek bir `Satir` tanımı sayar).
 *  `altEtiket` mahalle satırlarında ilçeyi gösterir — Adana'da aynı mahalle
 *  adı birden fazla ilçede var, kırılım olmadan hangisi olduğu anlaşılmaz. */
function Satir({
  etiket,
  altEtiket,
  ikon,
  secili,
  onClick,
}: {
  etiket: string;
  altEtiket?: string;
  ikon: React.ReactNode;
  secili?: boolean;
  onClick: () => void;
}) {
  return (
    <SecenekSatiri
      simge={ikon}
      baslik={etiket}
      altBaslik={altEtiket}
      secili={secili}
      onClick={onClick}
    />
  );
}

/** Yazılabilir kutu + `fixed` panel — iki seçicinin ortak iskeleti.
 *  `fixed` şart: navbar'ın `max-height`la katlanan kabı `absolute` paneli
 *  akışa karıştırıyor ("seçenekler ana akışın altına yükleniyor" hatası). */
function useSecici(hizaRef?: React.RefObject<HTMLElement>) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLInputElement>(null);

  const olc = useCallback(() => {
    const r = (hizaRef?.current ?? triggerRef.current)?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: r.left, width: r.width });
  }, [hizaRef]);

  /**
   * Konum YALNIZ açılışta ölçülüyordu ve bu telefonda gözle görülür bir
   * kusurdu: girdiye dokununca yumuşak klavye açılır, görsel viewport küçülür
   * ve sayfa kayar — panel ise eski koordinatında, tetikleyicisinden kopmuş
   * biçimde havada asılı kalırdı. `fixed` olduğu için sayfa kaydırması da onu
   * taşımaz. Açıkken yeniden ölçmek bunun tek çözümü.
   *
   * `visualViewport` masaüstünde de vardır ama orada olay üretmez; dinleyici
   * yalnız klavye/zoom durumunda çalışır.
   */
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    window.addEventListener("scroll", olc, { passive: true, capture: true });
    window.addEventListener("resize", olc);
    vv?.addEventListener("resize", olc);
    vv?.addEventListener("scroll", olc);
    return () => {
      window.removeEventListener("scroll", olc, { capture: true });
      window.removeEventListener("resize", olc);
      vv?.removeEventListener("resize", olc);
      vv?.removeEventListener("scroll", olc);
    };
  }, [open, olc]);

  const ac = () => {
    olc();
    setOpen(true);
  };

  const kapat = () => {
    setText("");
    setOpen(false);
    triggerRef.current?.blur();
  };

  return { open, setOpen, text, setText, pos, triggerRef, ac, kapat };
}

/* ─── Ders şekli seçici ──────────────────────────────────────────────── */

export function SekilSelect({
  value,
  onChange,
  triggerClassName = "",
  hizaRef,
  id,
}: {
  value: DersSekli;
  onChange: (next: DersSekli) => void;
  triggerClassName?: string;
  /** Görünür etiketin `htmlFor` ile bağlanacağı id. Etiketle `aria-label`
   *  BİRLİKTE kullanılmaz: ikisi varken ekran okuyucu `aria-label`ı okur ve
   *  görünen etiket sessizce yok sayılır. */
  id?: string;
  /** Panelin hizalanacağı öğe (arama hapının form'u). */
  hizaRef?: React.RefObject<HTMLElement>;
}) {
  const { open, setOpen, text, setText, pos, triggerRef, ac, kapat } = useSecici(hizaRef);

  const sec = (next: DersSekli) => {
    onChange(next);
    kapat();
  };

  const n = kucult(text);
  const satirlar = n
    ? SEKIL_SATIRLARI.filter((s) => kucult(SEKIL_ADI[s.deger]).includes(n))
    : SEKIL_SATIRLARI;

  return (
    <>
      <input
        ref={triggerRef}
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!open) ac();
        }}
        onFocus={ac}
        onBlur={() => setOpen(false)}
        id={id}
        /* Boşken davet ("Seçin"), telefondaki kapalı satırla aynı; "Fark
           etmez" artık bir seçenek değil, yazılırsa seçilebilir sanılırdı. */
        placeholder={value ? SEKIL_ADI[value] : "Seçin"}
        aria-label={id ? undefined : "Ders şekli"}
        className={`${triggerClassName} ${
          value
            ? "placeholder:font-semibold placeholder:text-slate-700 "
            : "placeholder:text-slate-400 "
        }`}
      />

      {open && pos && (
        <Panel pos={pos}>
          {satirlar.map((s) => (
            <Satir
              key={s.deger || "farketmez"}
              etiket={SEKIL_ADI[s.deger]}
              altEtiket={s.aciklama}
              ikon={<SekilSvg deger={s.deger} />}
              secili={s.deger === value}
              onClick={() => sec(s.deger)}
            />
          ))}
        </Panel>
      )}
    </>
  );
}

/* ─── Yer seçici ─────────────────────────────────────────────────────────
   Hem eğitmen hapının ÜÇÜNCÜ bölmesinde (yalnız "Yüz yüze" seçiliyken)
   hem de kütüphane hapında kullanılır. Tek bileşen olması bilinçli: iki
   yüzey aynı öneri listesini, aynı satır görünümünü ve aynı Türkçe katlamalı
   eşleşmeyi paylaşsın diye. Ayrı yazılsalardı biri değişip diğeri kalırdı.
   ──────────────────────────────────────────────────────────────────────── */

export function YerSelect({
  value,
  onChange,
  triggerClassName = "",
  hizaRef,
  id,
  // Telefondaki yer adımıyla aynı metin.
  placeholder = "İlçe seçin",
  yakinimda = false,
  onYakinimda,
}: {
  value: YerSecimi | null;
  onChange: (next: YerSecimi | null) => void;
  triggerClassName?: string;
  id?: string;
  hizaRef?: React.RefObject<HTMLElement>;
  placeholder?: string;
  /** "Yakınımda" seçili mi — kutuda o yazar, ilçe seçimi yok sayılır. */
  yakinimda?: boolean;
  /**
   * "Yakınımda" satırı YALNIZ bu verilince çizilir (kullanıcı sorusu, 16 Eyl
   * 2026: "masaüstünde neden yakındakileri bulma yok"). Telefonun adımlı
   * yüzeyiyle aynı satır: ilk sırada, kendi görseliyle. Seçilince çağıran
   * konum niyetini adrese yazar; koordinatı sonuç sayfası ister
   * (`useYakinimdaKonum`).
   */
  onYakinimda?: () => void;
}) {
  const { open, setOpen, text, setText, pos, triggerRef, ac, kapat } = useSecici(hizaRef);

  const sec = (next: YerSecimi | null) => {
    onChange(next);
    kapat();
  };

  const n = kucult(text);
  /* "Tüm yerler" satırı YOK (kullanıcı kararı, 16 Eyl 2026): listenin ilk
     satırı "Merkez" (`yerAra` üretir). Seçimi geri almanın yolu başka bir
     yer seçmek ya da sonuç ekranındaki çipi kaldırmak. */
  const yerler = yerAra(text);
  const yakinimdaGoster = !!onYakinimda && (!n || kucult("Yakınımda").includes(n));

  return (
    <>
      <input
        ref={triggerRef}
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!open) ac();
        }}
        onFocus={ac}
        onBlur={() => setOpen(false)}
        id={id}
        placeholder={yakinimda ? "Yakınımda" : value ? yerEtiketi(value) : placeholder}
        aria-label={id ? undefined : "Yer"}
        className={`${triggerClassName} ${
          value || yakinimda
            ? "placeholder:font-semibold placeholder:text-slate-700 "
            : "placeholder:text-slate-400 "
        }`}
      />

      {open && pos && (
        <Panel pos={pos}>
          {yakinimdaGoster && (
            <Satir
              etiket="Yakınımda"
              altEtiket="Çevrendekileri bul"
              ikon={
                <img
                  src="/icons/ilceler/yakinimda.webp"
                  alt=""
                  aria-hidden
                  width={40}
                  height={40}
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              }
              secili={yakinimda}
              onClick={() => {
                onYakinimda?.();
                kapat();
              }}
            />
          )}
          {yerler.map((y) => (
            <Satir
              key={`${y.secim.tur}:${y.altBaslik}:${y.baslik}`}
              etiket={y.baslik}
              /* İlçe satırında alt yazı YOK (kullanıcı kararı, 16 Eyl 2026):
                 her ilçenin altında "Adana" yazması bilgi değil gürültüydü.
                 Mahallede ilçe adı kalır — onu ayırt ettiren o. */
              altEtiket={y.secim.tur === "ilce" ? undefined : y.altBaslik}
              ikon={<PinSvg />}
              onClick={() => sec(y.secim)}
            />
          ))}
        </Panel>
      )}
    </>
  );
}
