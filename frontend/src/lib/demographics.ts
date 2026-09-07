import { Gender } from "@/types";

export const GENDER_LABEL: Record<Gender, string> = {
  [Gender.MALE]: "Erkek",
  [Gender.FEMALE]: "Kadın",
  [Gender.UNSPECIFIED]: "Belirtilmemiş",
};

/**
 * Başkasına GÖSTERİLECEK cinsiyet etiketi — yoksa `null`.
 *
 * İki ayrı "boş" durumu tek bir cevaba indirir:
 *
 *     null / undefined  = hiç sorulmadı
 *     UNSPECIFIED       = soruldu, söylemek istemedi
 *
 * Veri katmanında bu ayrım KORUNUR (birleştirmek "tekrar sormak meşru mu"
 * sorusunun cevabını yok ederdi); sadeleşen şey ifadedir. Aynı üçlü koşul
 * dört ekranda tekrarlanıyordu ve dördünden birinde `UNSPECIFIED` kontrolü
 * unutulsa kullanıcının söylemek istemediği şey ekrana basılırdı.
 *
 * Başkasına gösterilen yüzeylerde boş durumda **hiçbir şey yazılmaz**:
 * "Belirtilmemiş" yazmak yokluğu ilan etmektir. Kişinin KENDİ gördüğü
 * yüzeylerde (Ayarlar, sihirbaz özeti) `?? "Belirtilmemiş"` ile tamamlanır —
 * orada yokluk eyleme dönüştürülebilir bir bilgidir. Asimetri kasıtlıdır.
 */
export function gorunurCinsiyet(g?: Gender | null): string | null {
  if (!g || g === Gender.UNSPECIFIED) return null;
  return GENDER_LABEL[g];
}

// "YYYY-MM-DD" -> tam yaş (geçersiz/aralık dışı ise null).
export function ageFromBirthDate(iso?: string | null): number | null {
  if (!iso) return null;
  const birth = new Date(iso);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}
