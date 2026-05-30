import { Gender } from "@/types";

export const GENDER_LABEL: Record<Gender, string> = {
  [Gender.MALE]: "Erkek",
  [Gender.FEMALE]: "Kadın",
  [Gender.UNSPECIFIED]: "Belirtilmemiş",
};

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
