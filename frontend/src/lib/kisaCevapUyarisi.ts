/**
 * Eğitmenin yeni bir potansiyel öğrenciye (deneme öncesi, INQUIRY) ilk cevabı
 * çok kısaysa bir öneri gösterilir (Preply karşılaştırması — canlı testte
 * eğitmenin kısa cevabı "Lütfen daha uzun bir yanıt yaz..." uyarısıyla
 * karşılandı, bkz. `preply-arastirma/preply-mesaj-kontrol.png`).
 *
 * Preply'nin GERÇEK eşiği hiçbir yerde belgeli değil (yardım makalelerinde
 * yok); burada kullandığımız sayı KENDİ seçimimiz, onlarınkiyle aynı olmak
 * zorunda değil.
 */
export const KISA_CEVAP_ESIGI = 30;

export function cevapCokKisaMi(body: string): boolean {
  const temiz = body.trim();
  return temiz.length > 0 && temiz.length < KISA_CEVAP_ESIGI;
}
