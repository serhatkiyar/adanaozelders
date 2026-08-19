/**
 * `Form.*` — admin panelinin form sözleşmesi (İP-A2).
 *
 * ## Ne çözüyor
 *
 * Bugün panelde form doğrulaması elle yazılıyor: her ekran kendi `useState`
 * bayraklarını tutuyor, doğrulama sonucunu TEK bir metne indirgiyor ve o metni
 * ya formun altına gri bir satır olarak ya da toast'a basıyor. Sonuç:
 *
 *   - Kullanıcı hangi ALANI düzelteceğini göremiyor.
 *   - Etiket ile kontrol arasında `htmlFor`/`id` bağı çoğu yerde yok
 *     (İP-A0 ölçümü: 58 `<label>`ın yalnız 3'ünde `htmlFor` var) — ekran
 *     okuyucu alanı adsız okuyor, etikete tıklamak odaklamıyor.
 *   - Hata belirince yerleşim zıplıyor: mesaj yeni bir düğüm olarak DOM'a
 *     giriyor ve altındaki her şeyi aşağı itiyor.
 *
 * Bu katman üçünü de sözleşme hâline getirir. Kullanıcı `id` yazmaz, `aria-*`
 * yazmaz, mesaj kabı açmaz; `Form.Item` bunları üretir.
 *
 * ## Sözleşme
 *
 * | Parça | Görevi |
 * |---|---|
 * | `Form.Field` | `react-hook-form` `Controller`'ı sarar; alanın hatasını bağlama koyar |
 * | `Form.Item` | `id` üretir, mesaj SLOT'unu açar, çocukları slot/üst diye ayırır |
 * | `Form.Label` | `htmlFor`u bağlamdan alır; **isteğe bağlı** alana "(opsiyonel)" ekler |
 * | `Form.Control` | Çocuğa `id`, `aria-invalid`, `aria-describedby` geçirir |
 * | `Form.Hint` | Yardım metni — hata YOKKEN slotta durur |
 * | `Form.ErrorMessage` | `role="alert"` mesaj — hata VARKEN slotta durur |
 *
 * **Tek slot.** `Hint` ve `ErrorMessage` kardeş değildir: `Form.Item` ikisini
 * çocuklar arasından ayıklar ve HER ZAMAN var olan tek bir kaba koyar. Kap
 * `min-h-*` ile yer ayırdığı için hata doğduğunda yerleşim itilmez. Bu, "hata
 * mesajını `&nbsp;` ile rezerve etme" hilesinden farklıdır: kap gerçekten tek
 * düğümdür, React onu yeniden oluşturmaz (bkz. `form.test.tsx` → M5).
 *
 * **Zorunluluk tersten işaretlenir.** Panel formlarında alanların çoğu
 * zorunlu; her birine yıldız koymak yıldızı anlamsızlaştırır. Bu yüzden
 * yıldız YOK, yalnız isteğe bağlı alanlara "(opsiyonel)" yazılır.
 *
 * ## Hata yönlendirme sözleşmesi (kasıtlı davranış değişikliği)
 *
 * | Hata türü | Nereye |
 * |---|---|
 * | Alan doğrulama hatası (zod, veya `loc`'u bir alana düşen 422) | **Yalnız alanın altına.** Toast'a GİTMEZ |
 * | Form geneli (500, ağ hatası, alana düşmeyen 422) | Toast veya form üstü uyarı şeridi |
 *
 * Aynı hatayı hem alanda hem toast'ta göstermek gürültüdür: kullanıcı iki
 * kanalı da okur, ikisi de aynı şeyi söyler ve toast kaybolduğunda geriye
 * kalan alan mesajı zaten oradadır.
 *
 * ## İP-A3a hazırlığı
 *
 * Kirli form bekçisi bir sonraki pakette gelir. `useFormDurumu` bugünden
 * `isDirty`/`isSubmitSuccessful`'ı tek yerden verir ki A3a bu katmanı
 * yeniden yazmak zorunda kalmasın.
 */
import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import {
  Controller,
  type ControllerProps,
  type FieldError,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { z } from "zod";

import { getErrorDetail } from "@/lib/errors";

/* ═══════════════════════ zod Türkçe hata haritası ═══════════════════════ */

/**
 * zod'un varsayılan mesajları İngilizce ("Invalid input: expected string,
 * received number"). Bunlar kullanıcıya çıkar — her şema kendi mesajını
 * yazmadıkça. Harita TEK YERDE, bu modül yüklenirken kurulur; şemalar
 * yalnız iş kuralına özgü metinleri kendileri yazar.
 *
 * zod 4 kendi Türkçe yerelini getiriyor (`z.locales.tr`); elle yazılmış bir
 * eşleme sürüm yükseltmelerinde sessizce eksik kalırdı.
 */
z.config(z.locales.tr());

/* ═══════════════════════════ bağlamlar ═══════════════════════════ */

interface AlanBaglami {
  ad: string;
  hata?: FieldError;
}
const AlanCtx = createContext<AlanBaglami | null>(null);

interface KimlikBaglami {
  id: string;
  hintId: string;
  hataId: string;
  hintVar: boolean;
}
const KimlikCtx = createContext<KimlikBaglami | null>(null);

/** Alanın hatasını okur; `Form.Field` dışında çağrılırsa `undefined` döner. */
function useAlanHatasi(): FieldError | undefined {
  return useContext(AlanCtx)?.hata;
}

/* ═══════════════════════════ parçalar ═══════════════════════════ */

/**
 * Bir form alanı. `react-hook-form`'un `Controller`'ıyla aynı props'u alır;
 * ek olarak alanın hata durumunu alt parçalara bağlamla dağıtır.
 */
function Field<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  const { render, ...kalan } = props;
  return (
    <Controller
      {...kalan}
      render={(arg) => (
        <AlanCtx.Provider
          value={{ ad: String(props.name), hata: arg.fieldState.error }}
        >
          {render(arg)}
        </AlanCtx.Provider>
      )}
    />
  );
}

/** Mesaj slotunun sınıfı — yüksekliği burada rezerve edilir. */
const SLOT_SINIFI = "mt-1.5 min-h-[1.125rem] text-xs leading-[1.125rem]";

/* ═══════════════ sözleşmenin yanlış kullanımını görünür kılan katman ═══════════════ */

/**
 * Sözleşme denetimleri YALNIZ geliştirmede çalışır (İP-A3c · P1-1).
 *
 * ## Neden var
 *
 * Nöbetçi sayacı (`ui-baseline-sayim.mjs`) bir kontrolü, JSX atalarında
 * `Form.Control` varsa **adlandırılmış** sayar. Bu bir VEKİLDİR: kaynak
 * düzeyinde bir ata, çalışma zamanında bir özelliği (erişilebilir ad)
 * ölçemez. Bağımsız denetim vekilin en az üç yazımda yanlış olduğunu çalışma
 * zamanında kanıtladı — üçünde de `id` DOM'a inmiyor, etiket bağı kurulmuyor
 * ve **hiçbir uyarı çıkmıyor**:
 *
 *   1. `Form.Control`'un çocuğu bir **Fragment** (`<><input/><span>TL</span></>`)
 *   2. `Form.Control` var ama ortada **`Form.Item` yok** (bağlam null)
 *   3. Çocuk, prop'ları DOM'a **iletmeyen** bir bileşen
 *
 * Çözüm daha akıllı bir AST kuralı değil: vekili **inşa yoluyla doğru**
 * yapmak. Bu üç yazım geliştirmede sessiz kalamazsa, "içindeyse
 * adlandırılmıştır" gerçekten doğru olur ve sayaç o dalı dürüstçe affeder.
 *
 * İlk ikisi statik olarak anlaşılır → `throw` (programlama hatasıdır; sessiz
 * bir `console.warn` göç sırasında ekrandaki yüzlerce satır arasında kaybolur).
 * Üçüncüsü statik olarak anlaşılamaz → mount sonrası DOM'dan ÖLÇÜLÜR.
 */
const GELISTIRME: boolean = !!import.meta.env?.DEV;

/** Hata mesajlarında bileşeni adıyla anmak için. */
function elemanAdi(tip: unknown): string {
  if (typeof tip === "string") return tip;
  if (tip === Fragment) return "React.Fragment";
  const f = tip as { displayName?: string; name?: string } | null;
  return f?.displayName || f?.name || "Bilinmeyen bileşen";
}

/**
 * `Hint`/`ErrorMessage` slot ayıklaması — Fragment'ların İÇİNE de bakar.
 *
 * `Children.toArray` bir Fragment'ı TEK çocuk olarak verir; içindeki
 * `Form.Hint` bulunamaz, üst bölüme düşer, slot boş kalır ve `hintVar` false
 * olduğu için `aria-describedby` HİÇ kurulmaz (denetim: P2-4, kanıt D2b/D2c).
 * Paketin ana vaadi — "hata doğduğunda yerleşim itilmez" — sessizce kaybolur.
 *
 * Seçilen yol: **Fragment'a girilir, başka elemana girilmez.**
 * Gerekçe: Fragment'ın DOM karşılığı YOKTUR, içinden bir çocuğu çıkarıp slota
 * taşımak görünen yerleşimi değiştirmez. Bir `<div>`den çıkarmak ise
 * kullanıcının yazdığı düzeni sessizce bozardı — orada doğru davranış taşımak
 * değil, **geliştiricinin haberdar olması**dır: `throw`.
 */
function slotAyikla(dugumler: ReactNode[]): {
  ust: ReactNode[];
  hint: ReactNode | null;
  hataMesaji: ReactNode | null;
} {
  const ust: ReactNode[] = [];
  let hint: ReactNode | null = null;
  let hataMesaji: ReactNode | null = null;

  for (const c of dugumler) {
    if (isValidElement(c)) {
      if (c.type === Hint) {
        hint = c;
        continue;
      }
      if (c.type === ErrorMessage) {
        hataMesaji = c;
        continue;
      }
      if (c.type === Fragment) {
        const ic = slotAyikla(
          Children.toArray((c.props as { children?: ReactNode }).children)
        );
        hint = ic.hint ?? hint;
        hataMesaji = ic.hataMesaji ?? hataMesaji;
        ust.push(cloneElement(c, { key: c.key }, ...ic.ust));
        continue;
      }
      if (GELISTIRME) gomuluSlotAra(c);
    }
    ust.push(c);
  }

  return { ust, hint, hataMesaji };
}

/** Bir elemanın altında gömülü `Hint`/`ErrorMessage` varsa geliştirmede patlat. */
function gomuluSlotAra(eleman: ReactElement): void {
  const gez = (dugum: ReactNode): void => {
    Children.toArray(dugum).forEach((c) => {
      if (!isValidElement(c)) return;
      if (c.type === Hint || c.type === ErrorMessage) {
        throw new Error(
          `Form.Item: <Form.${c.type === Hint ? "Hint" : "ErrorMessage"}> ` +
            `<${elemanAdi(eleman.type)}> içine gömülmüş. Mesaj slotu yalnız ` +
            "DOĞRUDAN çocukları (ve Fragment içindekileri) toplar; buradan " +
            "slota giremez, üst bölüme düşer ve tek-slot garantisi bozulur. " +
            "Hint/ErrorMessage'ı Form.Item'ın doğrudan çocuğu yapın."
        );
      }
      gez((c.props as { children?: ReactNode }).children);
    });
  };
  gez((eleman.props as { children?: ReactNode }).children);
}

/**
 * Bir alanın kabı: `id`leri üretir ve mesaj slotunu açar.
 *
 * Çocuklar İKİYE ayrılır: `Hint`/`ErrorMessage` slota, geri kalan üst bölüme
 * gider. Bu ayrım olmadan "tek slot" kurulamazdı — iki ayrı kardeş düğüm,
 * biri görünüp diğeri kaybolduğunda yerleşimi iter.
 */
function Item({
  children,
  className = "block",
}: {
  children: ReactNode;
  className?: string;
}) {
  const uid = useId();
  const hata = useAlanHatasi();

  const {
    ust,
    hint: hintCocuk,
    hataMesaji: hataCocuk,
  } = slotAyikla(Children.toArray(children));

  const hintVar = hintCocuk !== null;
  const kimlik = useMemo<KimlikBaglami>(
    () => ({
      id: `${uid}kontrol`,
      hintId: `${uid}hint`,
      hataId: `${uid}hata`,
      hintVar,
    }),
    [uid, hintVar]
  );

  return (
    <KimlikCtx.Provider value={kimlik}>
      <div className={className}>
        {ust}
        {/* HER ZAMAN var: içi boş olsa bile yer ayırır. */}
        <div data-form-slot className={SLOT_SINIFI}>
          {hata ? hataCocuk : hintCocuk}
        </div>
      </div>
    </KimlikCtx.Provider>
  );
}

/**
 * Alan etiketi. `htmlFor` bağlamdan gelir — çağıran taraf `id` yazmaz.
 *
 * `optional` verilirse etiketin yanına "(opsiyonel)" eklenir. Yıldız YOKTUR:
 * panel formlarında çoğunluk zorunlu olduğu için işaret tersten konur.
 */
function Label({
  children,
  optional = false,
  className = "mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200",
}: {
  children: ReactNode;
  optional?: boolean;
  className?: string;
}) {
  const kimlik = useContext(KimlikCtx);
  if (GELISTIRME && !kimlik) {
    throw new Error(
      "Form.Label, Form.Item dışında kullanıldı: htmlFor bağlamdan gelir, " +
        "bağlam yoksa etiket HİÇBİR kontrole bağlanmaz (htmlFor=null) ve alan " +
        "ekran okuyucuya adsız görünür. Alanı <Form.Item> ile sarın."
    );
  }
  return (
    <label htmlFor={kimlik?.id} className={className}>
      {children}
      {optional && (
        <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">
          (opsiyonel)
        </span>
      )}
    </label>
  );
}

/**
 * Kontrolü sarar ve erişilebilirlik köprülerini kurar.
 *
 * Tek çocuk alır (`input`, `select`, `textarea` ya da bunlardan birini
 * yönlendiren bir bileşen) ve ona `id` + `aria-invalid` + `aria-describedby`
 * geçirir. `aria-describedby` hata varken hatayı, yokken hint'i gösterir:
 * ikisini birden vermek ekran okuyucuya iki cümle okutur, hata sırada
 * ikinciyse kullanıcı önce yardım metnini duyar.
 */
function Control({ children }: { children: ReactElement }) {
  const kimlik = useContext(KimlikCtx);
  const alan = useContext(AlanCtx);
  const hata = alan?.hata;
  const cocuk = Children.only(children);

  // ── Statik olarak anlaşılan iki kör nokta: geliştirmede PATLA ──
  if (GELISTIRME) {
    if (!kimlik) {
      throw new Error(
        "Form.Control, Form.Item dışında kullanıldı: id/aria bağları bağlamdan " +
          "gelir, bağlam yoksa kontrole id=undefined geçer ve etiket bağı " +
          "kurulmaz. Alanı <Form.Item> ile sarın."
      );
    }
    if (cocuk.type === Fragment) {
      throw new Error(
        "Form.Control'un çocuğu Fragment olamaz: prop'lar Fragment'a geçer, " +
          "içindeki kontrollere İNMEZ (id=\"\", etiket yok). Birim eki gibi " +
          "yan düğümler için kontrolü tek çocuk bırakıp kalanı Form.Item'ın " +
          "doğrudan çocuğu yapın."
      );
    }
  }

  // ── Çocuğun kendi bağları KORUNUR (denetim P2-3) ──
  //
  // Eski sürüm `aria-describedby`yi `undefined` ile eziyordu: karakter
  // sayacına, para birimi açıklamasına veya harici bir yardım düğümüne bağlı
  // kontroller göç sırasında bağlarını SESSİZCE kaybediyordu. Artık slotun
  // düğümü ile çocuğun kendi düğümleri BİRLEŞTİRİLİR — slotunki önce, çünkü
  // ekran okuyucu sırayla okur ve hata mesajı ilk duyulmalıdır.
  const cocukProps = cocuk.props as Record<string, unknown>;
  const slotTanimi = hata
    ? kimlik?.hataId
    : kimlik?.hintVar
      ? kimlik?.hintId
      : undefined;
  const cocukTanimi = cocukProps["aria-describedby"];
  const tanim =
    [slotTanimi, typeof cocukTanimi === "string" ? cocukTanimi : null]
      .filter(Boolean)
      .join(" ") || undefined;

  // `id` ezilemez: `Form.Label`ın `htmlFor`u bağlamdaki id'yi gösterir, çocuğun
  // id'sine saygı göstermek etiket bağını KOPARIRDI. Sessiz kalmasın diye
  // geliştirmede bildirilir (denetim P2-3'ün ikinci yarısı).
  if (GELISTIRME && typeof cocukProps.id === "string" && cocukProps.id) {
    console.error(
      `Form.Control: <${elemanAdi(cocuk.type)}> kendi id'sini ("${cocukProps.id}") ` +
        `veriyor ama id'nin sahibi Form.Item'dır ("${kimlik?.id}") — ` +
        "etiket bağı ona kurulu. Çocuğun id'si kullanılmayacak; " +
        "document.getElementById ile bu kontrolü arayan kod varsa kırılır."
    );
  }

  // ── Statik olarak anlaşılMAYAN kör nokta: prop iletmeyen bileşen ──
  //
  // Çocuk `id`yi DOM'a indirmezse hiçbir statik kural bunu göremez; ölçüm
  // ancak çalışma zamanında yapılabilir. Ref DOM düğümüne ulaşırsa oradan,
  // ulaşamazsa (bileşen ref'i de iletmiyor) belgeden doğrulanır.
  const dugumRef = useRef<HTMLElement | null>(null);
  const cocukRef = (cocuk as unknown as { ref?: Ref<HTMLElement> }).ref;
  const birlesikRef = useCallback(
    (dugum: HTMLElement | null) => {
      dugumRef.current = dugum;
      // Çocuğun kendi ref'i EZİLMEZ: `react-hook-form` odaklamayı onunla yapar.
      if (typeof cocukRef === "function") cocukRef(dugum);
      else if (cocukRef && typeof cocukRef === "object") {
        (cocukRef as { current: HTMLElement | null }).current = dugum;
      }
    },
    [cocukRef]
  );

  useEffect(() => {
    if (!GELISTIRME || !kimlik) return;
    const dugum = dugumRef.current ?? document.getElementById(kimlik.id);
    if (dugum instanceof HTMLElement && dugum.id === kimlik.id) return;
    console.error(
      `Form.Control: <${elemanAdi(cocuk.type)}> id'yi DOM'a indirmedi ` +
        `(alan: "${alan?.ad ?? "bilinmiyor"}", beklenen id: "${kimlik.id}"). ` +
        "Etiket bağı kurulmadı — kontrol ekran okuyucuya ADSIZ görünüyor. " +
        "Bileşen id/aria-* prop'larını iç kontrole iletmeli " +
        "(ör. `({ id, ...p }) => <input id={id} {...p} />`)."
    );
  });

  return cloneElement(cocuk, {
    id: kimlik?.id,
    "aria-invalid": hata ? true : undefined,
    "aria-describedby": tanim,
    ref: birlesikRef,
  } as Partial<typeof cocuk.props>);
}

/** Yardım metni — hata yokken slotta durur. */
function Hint({
  children,
  className = "text-slate-500 dark:text-slate-400",
}: {
  children: ReactNode;
  className?: string;
}) {
  const kimlik = useContext(KimlikCtx);
  return (
    <p id={kimlik?.hintId} className={className}>
      {children}
    </p>
  );
}

/**
 * Alan hata mesajı — hata varken slotta durur.
 *
 * `role="alert"` ekran okuyucunun mesajı odak değişmeden duyurmasını sağlar;
 * anlık doğrulamada kullanıcı alandan çıkmadan hata belirdiği için bu şart.
 */
function ErrorMessage({
  className = "text-rose-600 dark:text-rose-400",
}: {
  className?: string;
} = {}) {
  const kimlik = useContext(KimlikCtx);
  const hata = useAlanHatasi();
  if (!hata?.message) return null;
  return (
    <p id={kimlik?.hataId} role="alert" className={className}>
      {hata.message}
    </p>
  );
}

export const Form = {
  Field,
  Item,
  Label,
  Control,
  Hint,
  ErrorMessage,
};

/* ═════════════════════ sunucu hatası eşlemesi ═════════════════════ */

interface Fastapi422Ogesi {
  loc?: unknown;
  msg?: unknown;
}

/** FastAPI `loc` yolundan alan adını çıkarır: `["body","qty"]` → `"qty"`. */
function locAlanAdi(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  const parcalar = loc.filter((p): p is string => typeof p === "string");
  // İlk parça gövde/sorgu/başlık kaynağıdır, alan adı değildir.
  const anlamli = parcalar.filter(
    (p) => !["body", "query", "path", "header", "cookie"].includes(p)
  );
  return anlamli.length ? anlamli[anlamli.length - 1] : null;
}

/**
 * Sunucu hatasını alanlara dağıtır; alana düşmeyen kısmı GERİ DÖNDÜRÜR.
 *
 * Dönen değer `null` ise hata tamamen alanlara yazılmıştır ve **toast
 * atılmamalıdır**. Metin dönerse çağıran taraf onu genel kanala (toast ya da
 * form üstü şerit) verir.
 *
 * `alanlar` beyaz listedir: sunucunun ürettiği bir `loc` formda karşılığı
 * olmayan bir alanı gösteriyorsa (şema değişmiş, iç alan reddedilmiş) mesaj
 * SESSİZCE KAYBOLMAZ, genel kanala düşer.
 */
export function sunucuHatasiniUygula<TFieldValues extends FieldValues>(
  hata: unknown,
  form: Pick<UseFormReturn<TFieldValues>, "setError">,
  alanlar: readonly string[],
  esleme?: Readonly<Record<string, string>>,
  /**
   * 422 DIŞI hataların metnini üreten fonksiyon (İP-A3a'da eklendi).
   *
   * Varsayılan genel bir çeviridir; ama bazı alanların kendi sözlüğü vardır
   * (envanterde defter bütünlüğü uyarısı, 409'da "sayfayı yenileyin"). Bu
   * kanca olmadan pilot ekran ya o metinleri kaybederdi ya da 422 tespitini
   * ikinci kez kendi yazardı.
   */
  genelMesaj: (hata: unknown) => string = (h) =>
    getErrorDetail(h, "İşlem tamamlanamadı.")
): string | null {
  const yanit = (
    hata as { response?: { status?: number; data?: { detail?: unknown } } }
  )?.response;

  const detay = yanit?.data?.detail;
  if (yanit?.status !== 422 || !Array.isArray(detay)) {
    return genelMesaj(hata);
  }

  const kalanlar: string[] = [];
  let alanaYazildi = 0;

  for (const oge of detay as Fastapi422Ogesi[]) {
    const mesaj =
      typeof oge?.msg === "string" && oge.msg.trim()
        ? oge.msg
        : "Bu alan geçersiz.";
    const ham = locAlanAdi(oge?.loc);
    const alan = ham ? (esleme?.[ham] ?? ham) : null;

    if (alan && alanlar.includes(alan)) {
      form.setError(alan as FieldPath<TFieldValues>, {
        type: "server",
        message: mesaj,
      });
      alanaYazildi += 1;
    } else {
      kalanlar.push(mesaj);
    }
  }

  if (!kalanlar.length) {
    // Hiçbir öğe alana düşmediyse (boş `detail` dizisi) kullanıcı hatasız
    // kalmasın: en azından genel bir mesaj döner.
    return alanaYazildi ? null : "Gönderilen bilgi geçersiz.";
  }
  return kalanlar.join(" ");
}

/* ═══════════════════════ İP-A3a için form durumu ═══════════════════════ */

/**
 * Kirli form bekçisinin (İP-A3a) ihtiyaç duyacağı iki bayrağı tek yerden verir.
 *
 * Doğrudan `form.formState.isDirty` okumak da mümkün; ama o okuma
 * `formState`'in Proxy'sine abone olmayı gerektirir ve ekranlar bunu
 * unutunca bayrak GÜNCELLENMEZ. Buradan okuyan her ekran aboneliği doğru
 * kurar.
 */
export function useFormDurumu<TFieldValues extends FieldValues>(
  form: UseFormReturn<TFieldValues>
): { kirli: boolean; gonderimBasarili: boolean } {
  const { isDirty, isSubmitSuccessful } = form.formState;
  return { kirli: isDirty, gonderimBasarili: isSubmitSuccessful };
}
