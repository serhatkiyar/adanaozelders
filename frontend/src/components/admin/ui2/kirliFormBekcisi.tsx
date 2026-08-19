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
 * ## Kapsam DIŞI: uygulama içi rota gezinmesi
 *
 * `useBlocker` / `unstable_usePrompt` **kullanılmadı** — kasıtlı. Proje klasik
 * `<BrowserRouter>` + `<Routes>` kullanıyor (126 rota); `useBlocker` data
 * router ister ve bu mimaride ÇALIŞMAZ, hata fırlatır (İP-A0 ölçümü). Rota
 * engellemesi için router göçü gerekir; o ayrı ve ertelenmiş bir karardır ve
 * bu pakete sızmadı.
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
 */
import { useCallback, useEffect } from "react";
import { usePrompt } from "@medusajs/ui";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { useFormDurumu } from "./form";
import { kirliFormPromptTr } from "./medusa-tr";

export interface KirliFormBekcisiSecenekleri<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  /**
   * Ekranın elinde duran sunucu hatası (varsa). Gönderim ağa çıkıp başarısız
   * olduysa form KİRLİ sayılmaya devam eder.
   */
  sunucuHatasi?: unknown;
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
  sunucuHatasi = null,
  etkin = true,
}: KirliFormBekcisiSecenekleri<TFieldValues>): KirliFormBekcisi {
  const { kirli, gonderimBasarili } = useFormDurumu(form);

  const kaydedildi = gonderimBasarili && !sunucuHatasi;
  const korumali = etkin && kirli && !kaydedildi;

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

  const kapatmayiDene = useCallback(
    (kapat: () => void) => {
      if (!korumali) {
        kapat();
        return;
      }
      void prompt(kirliFormPromptTr).then((onay) => {
        if (onay) kapat();
      });
    },
    [korumali, prompt]
  );

  return { korumali, kapatmayiDene };
}
