// Kurye yönetiminin ORTAK zod sözleşmeleri — eski `CourierManager` ve yeni panel `KuryePencereleri` aynı
// nesneleri kullanır; iki ekran arasında doğrulama sapması olamaz. Üst sınırlar backend `schemas/delivery.py`
// (CourierCreate/Update, CourierAccountCreate, CourierPasswordResetIn) ile birebir; keyfî sınır eklenmez.
import { z } from "zod";

export const KURYE_AD_MAX = 150;
export const KURYE_TELEFON_MAX = 30;
export const HESAP_AD_MAX = 75;
export const HESAP_EPOSTA_MAX = 255;
export const HESAP_SIFRE_MAX = 128;

export const kuryeSemasi = z.object({
  name: z.string().trim().min(2, "İsim en az 2 karakter olmalı."),
  phone: z.string(),
});
export type KuryeFormDegerleri = z.infer<typeof kuryeSemasi>;

export const hesapSemasi = z.object({
  first_name: z.string().trim().min(1, "Ad gerekli."),
  last_name: z.string().trim().min(1, "Soyad gerekli."),
  email: z.string().trim().email("Geçerli bir e-posta girin."),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});
export type HesapFormDegerleri = z.infer<typeof hesapSemasi>;

export const sifreSemasi = z.object({
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});
export type SifreFormDegerleri = z.infer<typeof sifreSemasi>;

/** zod sonucunu `alan → ilk mesaj` haritasına çevirir (satır içi hata slotları için). */
export function zodAlanHatalari(sonuc: z.ZodSafeParseResult<unknown>): Record<string, string | undefined> {
  const hatalar: Record<string, string | undefined> = {};
  if (sonuc.success) return hatalar;
  for (const sorun of sonuc.error.issues) {
    const alan = String(sorun.path[0] ?? "");
    if (alan && !hatalar[alan]) hatalar[alan] = sorun.message;
  }
  return hatalar;
}
