export const FEEDBACK_PROBLEMS = [
  { code: "GEC_TESLIMAT", label: "Geç geldi" },
  { code: "HASARLI_PAKET", label: "Paket hasarlıydı" },
  { code: "YANLIS_EKSIK_URUN", label: "Yanlış/eksik ürün" },
  { code: "KURYE_DAVRANISI", label: "Kurye davranışı" },
  { code: "TESLIM_YERI", label: "Yanlış yere bırakıldı" },
  { code: "BILDIRIM_SORUNU", label: "Bilgilendirme/kod ulaşmadı" },
  { code: "DIGER", label: "Diğer" },
] as const;

export const FEEDBACK_PROBLEM_LABEL: Record<string, string> = Object.fromEntries(
  FEEDBACK_PROBLEMS.map(({ code, label }) => [code, label]),
);

/** Olumsuz değerlendirmede en az bir sorun seçilmelidir. */
export function canSubmitFeedback(thumbsUp: boolean, codes: string[]): boolean {
  return thumbsUp || codes.length > 0;
}
