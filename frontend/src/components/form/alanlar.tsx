import { type ReactNode } from "react";

import { Field } from "@/components/ui/Field";
import { PlainButton } from "@/components/ui/PlainButton";

/**
 * Form alan parçaları — ön başvuru ve ilan sihirbazının ortak tabanı.
 *
 * Neden ayrı bir katman: public tarafta ortak bir Input/Select primitifi yok
 * ve bu formun kendine has iki kuralı var — (1) yazı boyu mobilde 16px'in
 * altına inmez, yoksa iOS Safari alana odaklanınca sayfayı yakınlaştırır ve
 * kullanıcı sihirbazın ortasında kaybolur; (2) dokunma hedefi 44px'in altına
 * inmez. Bunları global `.input` sınıfına taşımak tüm siteyi değiştirirdi.
 *
 * `data-alan`: gönderimde ilk hatalı alana odaklanmak için kancadır (ref
 * defteri tutmak yerine kabuk formu tek bir sorguyla bulur).
 */

const GIRDI =
  "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base " +
  "text-slate-900 outline-none transition placeholder:text-slate-400 " +
  "focus:border-marka-mid focus:ring-2 focus:ring-marka/20";

const HATALI = "border-rose-300 focus:border-rose-400 focus:ring-rose-100";

/**
 * Dolgulu varyant — kenarlık yerine gri zemin.
 *
 * Yalnız ilan sihirbazı kullanır (5 Eyl 2026): o ekranlar Superprof'un
 * görünüşünü aldı ve orada alanlar kenarlıksız, dolgulu ve daha büyük
 * yarıçaplı. Varsayılan `false` — ön başvuru ve diğer public formlar hiç
 * değişmez.
 *
 * KİLİTLİ KURALLAR BURADA DA GEÇERLİ: yazı `text-base` (16px) altına inmez
 * (iOS Safari odakta sayfayı yakınlaştırıp kullanıcıyı formun ortasında
 * kaybediyor) ve dokunma hedefi 44px altına inmez.
 */
const DOLGU =
  "mt-1.5 w-full rounded-2xl border border-transparent bg-slate-100 px-5 py-4 text-base " +
  "text-slate-900 outline-none transition placeholder:text-slate-400 " +
  "focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-200";

/** Alanın taban sınıfı: dolgulu varyant mı, kenarlıklı varsayılan mı. */
function taban(dolgu?: boolean): string {
  return dolgu ? DOLGU : GIRDI;
}

interface OrtakProps {
  ad: string;
  /** Gri dolgulu, kenarlıksız varyant (ilan sihirbazı). */
  dolgu?: boolean;
  etiket: string;
  ipucu?: string;
  hata?: string;
  zorunlu?: boolean;
  deger: string;
  onChange: (deger: string) => void;
  onBlur?: () => void;
}

interface MetinProps extends OrtakProps {
  tip?: "text" | "tel" | "email" | "url";
  inputMode?: "text" | "tel" | "email" | "decimal" | "url";
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  /** Ad ve e-posta gibi alanlarda otomatik düzeltme/büyütme kapatılır. */
  duzeltmeKapali?: boolean;
  /**
   * Sihirbazda adım açılınca ilk alana odaklanmak için. MASAÜSTÜNDE istenir;
   * mobilde çağıran taraf kapatır — dokunmatikte otomatik odak klavyeyi açıp
   * adımın yarısını örter.
   */
  odakla?: boolean;
}

export function Metin({
  ad,
  etiket,
  ipucu,
  hata,
  zorunlu,
  deger,
  onChange,
  onBlur,
  dolgu,
  tip = "text",
  inputMode,
  autoComplete,
  placeholder,
  maxLength,
  duzeltmeKapali,
  odakla,
}: MetinProps) {
  return (
    <Field label={etiket} hint={ipucu} error={hata} required={zorunlu}>
      {(id, describedBy) => (
        <input
          id={id}
          data-alan={ad}
          type={tip}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus={odakla}
          autoCapitalize={duzeltmeKapali ? "off" : undefined}
          autoCorrect={duzeltmeKapali ? "off" : undefined}
          spellCheck={duzeltmeKapali ? false : undefined}
          value={deger}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={hata ? true : undefined}
          aria-describedby={describedBy}
          className={`${taban(dolgu)} ${hata ? HATALI : ""}`}
        />
      )}
    </Field>
  );
}

interface CokSatirProps extends OrtakProps {
  satir?: number;
  placeholder?: string;
  maxLength?: number;
  /** Bkz. `MetinProps.odakla`. */
  odakla?: boolean;
}

export function CokSatir({
  ad,
  etiket,
  ipucu,
  hata,
  zorunlu,
  deger,
  onChange,
  onBlur,
  dolgu,
  satir = 3,
  placeholder,
  maxLength,
  odakla,
}: CokSatirProps) {
  return (
    <Field label={etiket} hint={ipucu} error={hata} required={zorunlu}>
      {(id, describedBy) => (
        <textarea
          id={id}
          data-alan={ad}
          rows={satir}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus={odakla}
          value={deger}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={hata ? true : undefined}
          aria-describedby={describedBy}
          className={`${taban(dolgu)} resize-y ${hata ? HATALI : ""}`}
        />
      )}
    </Field>
  );
}

interface ListeProps extends OrtakProps {
  secenekler: readonly { deger: string; etiket: string }[];
  bosEtiket: string;
}

export function Liste({
  ad,
  etiket,
  ipucu,
  hata,
  deger,
  onChange,
  secenekler,
  bosEtiket,
  dolgu,
}: ListeProps) {
  return (
    <Field label={etiket} hint={ipucu} error={hata}>
      {(id, describedBy) => (
        <select
          id={id}
          data-alan={ad}
          value={deger}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          className={taban(dolgu)}
        >
          <option value="">{bosEtiket}</option>
          {secenekler.map((s) => (
            <option key={s.deger} value={s.deger}>
              {s.etiket}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * Az seçenekli alanlarda açılır liste yerine tam genişlik düğmeler.
 * Mobilde açılır liste fazladan iki dokunuş ve bir sistem katmanı demek;
 * üç-dört seçenek doğrudan görünürse seçim tek dokunuşa iner.
 */
export function SegmentSecim({
  etiket,
  ipucu,
  deger,
  onChange,
  secenekler,
  aktifSinif,
}: {
  etiket: string;
  ipucu?: string;
  deger: string;
  onChange: (deger: string) => void;
  secenekler: readonly { deger: string; etiket: string }[];
  /**
   * Seçili seçeneğin sınıfları. Verilmezse varsayılan indigo kullanılır.
   *
   * RENK BURADA YAZILMAZ: ilan sihirbazı mercan aksan kullanıyor ve o hex'in
   * bu dosyaya girmesi `__guards__/sihirbazMercani.test.ts` tarafından
   * yasaklı — kapsam kilidi tam olarak bunun için var. Çağıran taraf kendi
   * temasından geçirir.
   */
  aktifSinif?: string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">{etiket}</legend>
      {ipucu && <p className="mt-1 text-xs text-slate-500">{ipucu}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {secenekler.map((s) => {
          const secili = deger === s.deger;
          return (
            <PlainButton
              key={s.deger}
              onClick={() => onChange(secili ? "" : s.deger)}
              aria-pressed={secili}
              className={`rounded-xl border px-4 py-3 text-left text-[15px] transition ${
                secili
                  ? (aktifSinif ??
                    "border-marka bg-marka-soft font-medium text-marka-soft-fg")
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {s.etiket}
            </PlainButton>
          );
        })}
      </div>
    </fieldset>
  );
}

export function OnayKutusu({
  ad,
  isaretli,
  onChange,
  hata,
  children,
}: {
  ad: string;
  isaretli: boolean;
  onChange: (deger: boolean) => void;
  hata?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3 py-2.5">
        <input
          type="checkbox"
          data-alan={ad}
          checked={isaretli}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={hata ? true : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-marka focus:ring-marka-focus"
        />
        <span className="text-sm leading-relaxed text-slate-600">{children}</span>
      </label>
      {hata && (
        <p role="alert" className="mt-1 text-xs text-rose-600">
          {hata}
        </p>
      )}
    </div>
  );
}

/** Birincil aksiyon — adımın sonundaki tam genişlik düğme. */
export function AnaDugme({
  children,
  bekliyor,
  onClick,
  tip = "button",
}: {
  children: ReactNode;
  bekliyor?: boolean;
  onClick?: () => void;
  tip?: "button" | "submit";
}) {
  return (
    <button
      type={tip}
      onClick={onClick}
      disabled={bekliyor}
      className="w-full rounded-xl bg-marka px-5 py-3.5 text-[15px] font-semibold text-white transition hover:bg-marka-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marka disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/** İkincil aksiyon — "atla", "sonra tamamlarım". */
export function YanDugme({
  children,
  onClick,
  soluk,
}: {
  children: ReactNode;
  onClick: () => void;
  soluk?: boolean;
}) {
  return (
    <PlainButton
      onClick={onClick}
      className={`w-full rounded-lg py-2.5 text-sm transition hover:text-slate-900 ${
        soluk ? "text-slate-400" : "font-medium text-slate-600"
      }`}
    >
      {children}
    </PlainButton>
  );
}
