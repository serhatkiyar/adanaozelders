/**
 * Kirli form bekçisi (İP-A3a).
 *
 * ## Ne çözüyor
 *
 * Panelde bir form doldurup pencereyi yanlışlıkla kapatan kullanıcı yazdığı
 * her şeyi UYARISIZ kaybediyor. Kapatma yolları üç tane ve üçü de tek
 * tıklamalık: kapatma düğmesi, ESC, dış tıklama. Bir de tarayıcı yolu var —
 * sekmeyi kapatmak ya da yenilemek.
 *
 * Bu bekçi dördünü de kapsar: ilk üçünde onay penceresi açar, sonuncusunda
 * `beforeunload` kaydeder.
 *
 * ## Uygulama içi rota gezinmesi (İP-A6'da EKLENDİ)
 *
 * `useBlocker` / `unstable_usePrompt` hâlâ **kullanılmıyor** — kasıtlı. Proje
 * klasik `<BrowserRouter>` + `<Routes>` kullanıyor (126 rota); `useBlocker`
 * data router ister ve bu mimaride ÇALIŞMAZ, hata fırlatır (İP-A0 ölçümü).
 *
 * İP-A3a bu yüzden rota gezinmesini kapsam dışı bırakmıştı. İP-A6 yolu
 * router'a dokunmadan kapattı: bu hook "korumalıyım" diye kaydolur
 * (`ui2/gezinmeBekcisi`), gezinme bileşenleri tıklama anında kayda bakıp onay
 * sorar. Router göçüne karar verilirse o dosyanın İÇİ `useBlocker`a devreder;
 * bu hook ve ekranlar değişmez.
 *
 * Kapsam ve sınırları `gezinmeBekcisi.tsx` başında yazılı (tarayıcının geri
 * tuşu bu mimaride kapatılamaz).
 *
 * ## "Kirli" ne demek — ve `isSubmitSuccessful` neden yetmez
 *
 * `react-hook-form`'un `isSubmitSuccessful`'ı yalnız **"gönderim işleyicisi
 * patlamadı"** demektir. Bu kod tabanında işleyiciler `mutate(...)` çağırıp
 * geri döner: ağ isteği daha yola çıkmadan bayrak `true` olur. Sunucu 500
 * dönse bile bekçi susardı ve kullanıcı, kaydedilmemiş verisini uyarısız
 * kaybederdi.
 *
 * Bu yüzden hook `sunucuHatasi`yı da okur: gerçekten kaydedilmiş sayılmak için
 * **hem** gönderim başarılı olmalı **hem** ortada sunucu hatası olmamalı.
 *
 * `sunucuHatasi` **ZORUNLUDUR** (İP-A3c · P1-3). Eskiden `= null` varsayılanı
 * vardı ve o varsayılan, paketin çözdüğü hatanın ta kendisiydi: unutulan her
 * çağrı yerinde bekçi gönderimden sonra susardı, `tsc` uyarmazdı, hiçbir eşik
 * ölçmezdi. Hata takibi olmayan çağrı yeri niyetini `HATA_TAKIBI_YOK` ile
 * AÇIKÇA yazar — sessizce varsayılana düşemez.
 *
 * ## Bilinen sınırlar (kapsam dışı, sessiz kalmasın)
 *
 * 1. **Tarayıcının geri/ileri tuşu** — `popstate` ancak gezinme
 *    gerçekleştikten sonra ateşlenir; iptal etmek geçmişi bozar
 *    (`gezinmeBekcisi.tsx` → Bilinen sınırlar).
 * 2. **Ebeveynin kendi kapatması** (İP-A3c · denetim P2-9). Bekçi yalnız
 *    `kapatmayiDene`den geçen kapatma girişimlerini karşılar. Ebeveyn
 *    `open`/`kind` durumunu KENDİ değiştirirse (WebSocket push'u, query
 *    invalidation, hata sonrası sıfırlama, üst seviye bir "Kapat") hiçbir onay
 *    sorulmadan form sökülür ve veri gider.
 *
 *    **Neden kapatılmadı:** bir hook, ebeveynin `setState` çağrısını
 *    engelleyemez — durum ebeveynde yaşar ve React'te render sonucu geri
 *    alınamaz. Kapatmanın tek yolu kapatma yetkisini de bu katmana taşımaktı
 *    (ör. formu açan durumu hook'un yönetmesi); bu, göç edecek elli ekranın
 *    pencere durumunu yeniden yazmak demektir ve bu paketin kapsamı dışıdır.
 *
 *    **Bu arada ne yapılmalı:** pencereyi kapatan HER yol `kapatmayiDene`den
 *    geçmelidir. Ebeveyn bir yan etkiyle (push, invalidation) formu kapatmak
 *    istiyorsa, kullanıcının yazdığını korumak için o yolu da bu fonksiyona
 *    bağlamalıdır.
 */
import { useCallback, useEffect, useRef } from "react";
import { usePrompt } from "@medusajs/ui";
import { useWatch, type FieldValues, type UseFormReturn } from "react-hook-form";

import { useFormDurumu } from "./form";
import { useGezinmeKorumasi } from "./gezinmeBekcisi";
import { kirliFormPromptTr } from "./medusa-tr";

/**
 * "Bu ekranda sunucu hatası takibi yok" niyetinin AÇIK yazımı.
 *
 * `sunucuHatasi` zorunlu olduğu için hata izlemeyen bir çağrı yeri bir şey
 * yazmak zorundadır; `null` yazmak "hata yok" demektir ve yanlış olabilir.
 * Bu sabit "hiç bakmıyorum" demenin yoludur ve `grep`lenebilir.
 */
export const HATA_TAKIBI_YOK = "hata-takibi-yok" as const;

export interface KirliFormBekcisiSecenekleri<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  /**
   * Ekranın elinde duran sunucu hatası (varsa). Gönderim ağa çıkıp başarısız
   * olduysa form KİRLİ sayılmaya devam eder.
   *
   * ZORUNLU. Hata takibi olmayan ekran `HATA_TAKIBI_YOK` yazar.
   */
  sunucuHatasi: unknown | typeof HATA_TAKIBI_YOK;
  /** Form kapalıyken (pencere kapalı) bekçi uyumalı. */
  etkin?: boolean;
}

export interface KirliFormBekcisi {
  /** Bekçi şu an devrede mi — test ve teşhis için okunabilir. */
  korumali: boolean;
  /**
   * Kapatma girişimini karşılar. Form temizse `kapat` DOĞRUDAN çağrılır;
   * kirliyse önce onay penceresi açılır ve yalnız onaylanırsa çağrılır.
   */
  kapatmayiDene: (kapat: () => void) => void;
}

export function useKirliFormBekcisi<TFieldValues extends FieldValues>({
  form,
  sunucuHatasi,
  etkin = true,
}: KirliFormBekcisiSecenekleri<TFieldValues>): KirliFormBekcisi {
  const { kirli, gonderimBasarili } = useFormDurumu(form);

  // ── "Kaydedildi" damgası GÖNDERİM ANINDAKİ veriye aittir (İP-A3c · P2-2) ──
  //
  // `isSubmitSuccessful` bir sonraki `handleSubmit`/`reset()`'e kadar `true`
  // kalır. Pencere açık kalan formlarda ("kaydet ve açık kal", ayar panelleri,
  // çok adımlı formlar) kullanıcının SONRADAN yazdığı her şey korumasız
  // kalıyordu: bayrak hâlâ "kaydedildi" diyor, bekçi susuyor, veri gidiyor.
  //
  // Çözüm: başarı anındaki değerler damgalanır; değerler o damgadan sapınca
  // form yeniden korunur. Damga ref'te tutulur ve RENDER SIRASINDA kurulur —
  // `useEffect` bir tik geç çalışır ve o tikte kapatılan pencere korumasız
  // kalırdı.
  const anlikDegerler = JSON.stringify(useWatch({ control: form.control }) ?? {});
  const damgaRef = useRef<string | null>(null);

  const hataVar = sunucuHatasi !== HATA_TAKIBI_YOK && !!sunucuHatasi;
  const gonderimTemiz = gonderimBasarili && !hataVar;
  if (!gonderimTemiz) damgaRef.current = null;
  else if (damgaRef.current === null) damgaRef.current = anlikDegerler;

  const kaydedildi = gonderimTemiz && damgaRef.current === anlikDegerler;
  const korumali = etkin && kirli && !kaydedildi;

  // ── Beşinci kapatma yolu: uygulama içi rota gezinmesi (İP-A6 · Görev 3) ──
  //
  // Kayıt BURADA kurulur, ekranda değil. Gerekçe: "korumalı mı" kararının tek
  // doğruluk kaynağı bu hook'tur (gönderim damgası, sunucu hatası, `etkin`
  // hepsi burada birleşiyor). Ekranların ayrıca kaydolması gerekseydi, her
  // ekranda ayrı ayrı unutulabilirdi — İP-A3c'de `sunucuHatasi`nın varsayılan
  // değeriyle yaşanan hatanın aynısı.
  //
  // Uyarıyı GÖSTEREN taraf `ui2/gezinmeBekcisi`nin `GezinmeBaglantisi`sidir;
  // ikisi birbirini tanımaz.
  useGezinmeKorumasi(korumali);

  // `beforeunload` YALNIZ korumalıyken kayıtlı. Kalıcı bir kayıt, formda
  // hiçbir şey yazmamış kullanıcıya bile her yenilemede tarayıcı uyarısı
  // gösterir — uyarı anlamını yitirir ve insanlar refleksle onaylamayı öğrenir.
  useEffect(() => {
    if (!korumali) return;
    const uyar = (olay: BeforeUnloadEvent) => {
      // Metin tarayıcıya bırakılır: Chrome/Firefox özel mesajı yıllar önce
      // kaldırdı, kendi standart uyarısını gösterir.
      olay.preventDefault();
      olay.returnValue = "";
    };
    window.addEventListener("beforeunload", uyar);
    return () => window.removeEventListener("beforeunload", uyar);
  }, [korumali]);

  const prompt = usePrompt();

  // ── Öksüz onay penceresi (İP-A3c · P2-1) ──
  //
  // `usePrompt` her çağrıda `createRoot` ile bir kök mount eder ve o kökü
  // YALNIZ onay/iptal işleyicilerinde söker. Söz çözülmeden bileşen giderse
  // (ebeveyn `kind`'ı null yapar, WS push'u, query invalidation, rota
  // değişimi) pencere `document.body`'de öksüz kalır; Radix modal olduğu için
  // arkadaki sayfayı `pointer-events` ile de kilitler. Denetim bunu çalışma
  // zamanında ölçtü: unmount sonrası `alertdialog` sayısı 1.
  //
  // Elimizde o köke referans YOK (Medusa'nın içinde kapalı). Ama pencerenin
  // kendi ESC dinleyicisi `document` üzerindedir ve `onCancel`'a bağlıdır —
  // yani sözü çözen, kökü söken ve `pointer-events`i geri veren GERÇEK yol.
  // Temizlik onu tetikler: kapatma pencerenin kendi mekanizmasıyla olur.
  const bekleyenRef = useRef(false);
  const sokulduRef = useRef(false);
  useEffect(
    () => () => {
      sokulduRef.current = true;
      if (!bekleyenRef.current) return;
      bekleyenRef.current = false;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    },
    []
  );

  const kapatmayiDene = useCallback(
    (kapat: () => void) => {
      if (!korumali) {
        kapat();
        return;
      }
      bekleyenRef.current = true;
      void prompt(kirliFormPromptTr).then((onay) => {
        bekleyenRef.current = false;
        // Bileşen bu arada söküldüyse bayat bir closure'daki `onClose`
        // çalışmasın: kapatılacak bir şey kalmadı.
        if (onay && !sokulduRef.current) kapat();
      });
    },
    [korumali, prompt]
  );

  return { korumali, kapatmayiDene };
}
