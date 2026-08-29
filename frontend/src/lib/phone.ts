// Türk cep numarası normalizasyonu — backend `phone_service.normalize_phone`
// aynası. Form daha gönderilmeden geçersiz numarayı yakalamak için kullanılır;
// asıl doğrulama her zaman sunucudadır.

/** `05XX…`, `5XX…`, `905…`, `+905…` girişini E.164'e çevirir; geçersizse null. */
export function normalizePhoneTR(raw: string): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("90")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10 || !digits.startsWith("5")) return null;
  return "+90" + digits;
}
