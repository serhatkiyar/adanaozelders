/**
 * Düzenleme yüzeyinin DURUMU — saf, bağımlılıksız (İP-A6'da ayrıldı).
 *
 * ## Neden ayrı dosya
 *
 * `useDuzenlemeYuzeyi` İP-A4'te `duzenlemeYuzeyi.tsx` içindeydi ve o dosya
 * `Dialog` + kirli form bekçisi + Medusa'ya bağlı. İP-A6'da rota gezinmesi
 * bekçisi de bir pencere durumuna ihtiyaç duyunca DÖNGÜ doğdu:
 *
 *     duzenlemeYuzeyi → kirliFormBekcisi → gezinmeBekcisi → duzenlemeYuzeyi
 *
 * Durumun kendisinde hiçbir görsel bağımlılık yok; ayrılınca döngü kırıldı ve
 * kanca Medusa/DOM olmadan da test edilebilir hâle geldi.
 *
 * Sözleşme İP-A4'te yazıldığı gibidir ve DEĞİŞMEDİ; `duzenlemeYuzeyi.tsx`
 * buradan yeniden dışa aktarır, yani mevcut çağrı yerleri etkilenmez.
 */
import { useCallback, useMemo, useState } from "react";

/** Yüzeyin hedefi: bir kayıt ya da "yeni". Kapalıyken `null`. */
export type DuzenlemeHedefi<TKayit, TBaglam> =
  | { tur: "kayit"; kayit: TKayit }
  | { tur: "yeni"; baglam: TBaglam };

export interface DuzenlemeYuzeyiDurumu<TKayit, TBaglam> {
  /** Yüzey açık mı. */
  acik: boolean;
  /** Hedef "yeni" mi (kayıt düzenleme değil). */
  yeni: boolean;
  /** Düzenlenen kayıt; "yeni"de ve kapalıyken `null`. */
  kayit: TKayit | null;
  /** "Yeni"ye verilen bağlam (ör. hangi işlem türü); yoksa `null`. */
  baglam: TBaglam | null;
  /** Ham hedef — `useEffect` bağımlılığı olarak kullanışlı. */
  hedef: DuzenlemeHedefi<TKayit, TBaglam> | null;
  /** Var olan kaydı düzenlemek için aç. */
  ac: (kayit: TKayit) => void;
  /** Yeni kayıt için aç; bağlam ekranın verdiği serbest bir ayrımdır. */
  yeniAc: (baglam?: TBaglam) => void;
  /**
   * KOŞULSUZ kapat — bekçiye sormaz. Kaydedildikten sonra çağrılır.
   * Kullanıcı kaynaklı kapatma yollarını yüzey kendisi bekçiye bağlar.
   */
  kapat: () => void;
}

/** `DuzenlemeYuzeyi` bileşeninin ihtiyaç duyduğu asgari sözleşme. */
export interface DuzenlemeYuzeyiKapisi {
  acik: boolean;
  kapat: () => void;
  /**
   * Ham hedef — yüzey bunu bekçiye damga olarak verir: onay beklerken hedef
   * değişirse onay ESKİ hedefe uygulanmaz (İP-A6c · BULGU-8).
   *
   * Tipi `unknown`: bu kapı hedefin ne olduğunu bilmez, yalnız DEĞİŞTİĞİNİ
   * bilmesi yeter.
   */
  hedef: unknown;
}

export function useDuzenlemeYuzeyi<TKayit = never, TBaglam = void>(): DuzenlemeYuzeyiDurumu<
  TKayit,
  TBaglam
> {
  const [hedef, setHedef] = useState<DuzenlemeHedefi<TKayit, TBaglam> | null>(null);

  const ac = useCallback((kayit: TKayit) => setHedef({ tur: "kayit", kayit }), []);
  const yeniAc = useCallback(
    (baglam?: TBaglam) => setHedef({ tur: "yeni", baglam: baglam as TBaglam }),
    []
  );
  const kapat = useCallback(() => setHedef(null), []);

  return useMemo(
    () => ({
      acik: hedef !== null,
      yeni: hedef?.tur === "yeni",
      kayit: hedef?.tur === "kayit" ? hedef.kayit : null,
      baglam: hedef?.tur === "yeni" ? (hedef.baglam ?? null) : null,
      hedef,
      ac,
      yeniAc,
      kapat,
    }),
    [ac, hedef, kapat, yeniAc]
  );
}
