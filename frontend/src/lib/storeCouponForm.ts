/**
 * Kupon formunun saf kuralları (İP-A6 · Görev 4a).
 *
 * Kurallar ekranda değil BURADA yaşar: aynı kural hem alan hatasını hem
 * gövdeyi üretir, ikisi tek kaynaktan gelmezse saparlar (İP-A3c'nin "kapı ile
 * alan hataları iki ayrı doğruluk kaynağıdır" tespitinin aynısı).
 *
 * Form değerleri METİNDİR. Sebebi: sayısal bir `<input>`ün boş hâli `""`dir ve
 * `Number("")` sıfırdır — eski ekran `min_subtotal`ı böyle sessizce 0
 * yapıyordu. Metinden sayıya çevirme TEK yerde, `kuponGovdesi`de olur.
 */
import { z } from "zod";

import type { CouponCreate, CouponDiscountType } from "@/types";

export interface KuponFormDegerleri {
  kod: string;
  indirimTuru: CouponDiscountType;
  indirimDegeri: string;
  minSepet: string;
  maksKullanim: string;
  kisiBasi: string;
}

export const BOS_KUPON: KuponFormDegerleri = {
  kod: "",
  indirimTuru: "PERCENT",
  indirimDegeri: "10",
  minSepet: "0",
  maksKullanim: "",
  kisiBasi: "1",
};

/** Boş bırakılabilen sayısal alan: boşsa `null`, doluysa pozitif tam sayı. */
const opsiyonelSayac = (etiket: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), {
      message: `${etiket} boş bırakılabilir; yazılacaksa sıfırdan büyük bir tam sayı olmalı.`,
    });

export const kuponFormSemasi = z
  .object({
    // Kod sunucuda benzersizdir; biçim kuralı burada yalnız "boş olamaz" ve
    // "boşluk içeremez" — kalanı 409 ile sunucudan gelir ve alana yazılır.
    kod: z
      .string()
      .trim()
      .min(1, "Kupon kodu zorunlu.")
      .regex(/^\S+$/, "Kupon kodu boşluk içeremez."),
    indirimTuru: z.enum(["PERCENT", "FIXED"]),
    indirimDegeri: z
      .string()
      .trim()
      .min(1, "İndirim değeri zorunlu.")
      .refine((v) => Number(v) > 0, "İndirim değeri sıfırdan büyük olmalı."),
    minSepet: z
      .string()
      .trim()
      .refine((v) => v === "" || Number(v) >= 0, "Minimum sepet negatif olamaz."),
    maksKullanim: opsiyonelSayac("Maksimum kullanım"),
    kisiBasi: opsiyonelSayac("Kişi başı limit"),
  })
  // Yüzde indirimi 100'ü aşamaz: sunucu da reddeder, ama kullanıcı hatayı
  // ALANIN altında ve Türkçe görmeli.
  .refine(
    (d) => d.indirimTuru !== "PERCENT" || Number(d.indirimDegeri) <= 100,
    { path: ["indirimDegeri"], message: "Yüzde indirimi 100'ü aşamaz." }
  );

/** Form değerlerinden sunucu gövdesi. Kod BÜYÜK HARFE burada çevrilir. */
export function kuponGovdesi(d: KuponFormDegerleri): CouponCreate {
  const sayiVeyaNull = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    code: d.kod.trim().toUpperCase(),
    discount_type: d.indirimTuru,
    discount_value: Number(d.indirimDegeri),
    min_subtotal: d.minSepet.trim() === "" ? 0 : Number(d.minSepet),
    max_uses: sayiVeyaNull(d.maksKullanim),
    per_user_limit: sayiVeyaNull(d.kisiBasi),
    is_active: true,
  };
}
