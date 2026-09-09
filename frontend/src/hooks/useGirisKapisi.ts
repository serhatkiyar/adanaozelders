import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { girisAdresi, type GirisModu, type GirisRolu } from "@/lib/girisAdresi";
import { niyetiSakla, type BekleyenNiyet } from "@/lib/bekleyenNiyet";
import { useAuthStore } from "@/store/authStore";

/**
 * Korumalı eylemin giriş kapısı — ÜK-10: kapı gezinmede değil EYLEMDE.
 *
 * Ziyaretçi serbestçe gezer; hesap yalnız korumalı bir eyleme tıklandığında
 * istenir ve istendiğinde SAYFA KAYBOLMAZ: giriş penceresi mevcut adrese bir
 * parametre ekleyerek açılır, filtreler ve sayfa numarası yerinde kalır.
 *
 * ## Kimlik `token`dan okunur, `user`dan değil
 *
 * `useCurrentUser().data` token varken kısa bir süre `undefined` kalır (istek
 * uçuşta). Kapı ona baksaydı GİRİŞLİ kullanıcı o pencerede kalbe bastığında
 * kendisine giriş penceresi açılırdı. `token` senkron okunur, bu yanlış
 * pozitif yoktur. ROL kapısı `user`da kalmaya devam eder (rol bilgisi lazım).
 *
 * ## Kullanım
 *
 *     const { girisGerekli } = useGirisKapisi();
 *     onClick={() => {
 *       if (girisGerekli({ tip: "favori", hedef: "egitmen", id })) return;
 *       toggle.mutate(...);
 *     }}
 */
export function useGirisKapisi() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const girisGerekli = useCallback(
    (niyet?: BekleyenNiyet, mod: GirisModu = "login"): boolean => {
      if (token) return false;
      if (niyet) niyetiSakla(niyet);
      // `push`, `replace` DEĞİL: `AuthModal` kapanırken parametreleri zaten
      // `replace` ile siliyor, dolayısıyla geri tuşu kullanıcıyı tıklama
      // öncesine götürür. Burada `replace` kullanılsaydı geri tuşu onu
      // sayfadan tamamen atardı.
      navigate(girisAdresi(params, mod));
      return true;
    },
    [token, navigate, params]
  );

  return { girisli: !!token, girisGerekli };
}

/**
 * Gerçek bir bağlantı gereken yerler için adres (navbar "Giriş Yap" / "Ders
 * Ver", mağaza hesap menüsü).
 *
 * NİYET TAŞIYAN kapılar bunu KULLANMAZ, `<button>` + `girisGerekli` kullanır:
 * bir `<Link>` orta tıkla yeni sekmede açılabilir, `sessionStorage` ise
 * sekmeye özeldir — niyet yeni sekmede yoktur ve sessizce kaybolur.
 */
export function useGirisAdresi(mod: GirisModu = "login", rol?: GirisRolu): string {
  const [params] = useSearchParams();
  return girisAdresi(params, mod, rol);
}
