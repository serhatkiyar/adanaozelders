import { srsDueLabel } from "@/lib/srsDue";
import type { SrsCardState } from "@/types/srs";

/**
 * Kart vadesi. Gün ölçekli (REVIEW) vadede yalnız tarih, intraday
 * (LEARNING/RELEARNING) vadede tarih + saat gösterilir — gerekçe
 * `lib/srsDue.ts`.
 */
export function SrsDueLabel({
  state,
  dueAt,
}: {
  state: SrsCardState;
  dueAt: string | null;
}) {
  return <>{srsDueLabel(state, dueAt)}</>;
}
