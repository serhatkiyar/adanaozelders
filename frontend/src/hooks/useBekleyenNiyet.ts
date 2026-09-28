import { useEffect, useRef } from "react";

import {
  niyetiGozle,
  niyetiTemizle,
  type BekleyenNiyet,
} from "@/lib/bekleyenNiyet";
import { useAuthStore } from "@/store/authStore";

/**
 * Sayfaya ait bekleyen niyeti giriş tamamlanınca uygular.
 *
 * `favori` gibi saf API çağrıları global `NiyetUygulayici`dedir. Ama "ders
 * talebi" ya da "kütüphane rezervasyonu" niyeti *"bu sayfanın penceresini aç"*
 * demektir; global bir karşılığı yoktur, o yüzden sayfanın kendisi tüketir.
 *
 * ## `esler` neden zorunlu
 *
 * Kullanıcı 42 numaralı eğitmende kapıyı açıp başka bir sekmeden 99'a geçerse,
 * 99'un sayfası niyeti ne uygulamalı ne de YEMELİ. Eşleşme kontrolü olmadan
 * niyet sessizce tüketilir ve 42'ye dönen kullanıcı için hiçbir şey olmaz.
 *
 * ## `hazir` neden var
 *
 * Niyet, uygulanacağı verinin (ör. eğitmen kaydı) gelmesinden önce
 * tüketilirse pencere boş açılır ya da hiç açılmaz. `hazir` false iken niyete
 * dokunulmaz.
 *
 * ## `at` neden var
 *
 * Giriş yapan hesap bu eylemi yapamıyorsa (ör. ders talebi niyetiyle eğitmen
 * hesabına girildi) niyet uygulanmaz ama SİLİNİR; yoksa sekmede kalır ve
 * sonraki bir üye girişinde beklenmedik bir pencere açar.
 */
export function useBekleyenNiyet<T extends BekleyenNiyet["tip"]>(o: {
  tip: T;
  /** Veri gelmeden uygulama. */
  hazir: boolean;
  /** Bu sayfa o niyetin hedefi mi? Eşleşmezse niyet TÜKETİLMEZ. */
  esler: (niyet: Extract<BekleyenNiyet, { tip: T }>) => boolean;
  /** true ise eşleşen niyet uygulanmadan silinir (rol bu eylemi yapamaz). */
  at?: boolean;
  /** Eşleşen niyeti alır (ör. ders talebindeki önseçili saat). */
  uygula: (niyet: Extract<BekleyenNiyet, { tip: T }>) => void;
}): void {
  const user = useAuthStore((s) => s.user);

  // `uygula`/`esler` her render'da yeni referans olur; efekt bağımlılığına
  // girerse niyet uygulandıktan sonra tekrar tekrar koşmaya çalışır.
  const ref = useRef(o);
  ref.current = o;

  useEffect(() => {
    if (!user || !ref.current.hazir) return;
    const niyet = niyetiGozle();
    if (!niyet || niyet.tip !== ref.current.tip) return;
    const eslesen = niyet as Extract<BekleyenNiyet, { tip: T }>;
    if (!ref.current.esler(eslesen)) return;
    niyetiTemizle();
    if (ref.current.at) return;
    ref.current.uygula(eslesen);
  }, [user, o.hazir, o.at]);
}
