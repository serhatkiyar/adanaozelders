import { formatDate, formatDateTime } from "@/lib/datetime";
import type { SrsCardState } from "@/types/srs";

/**
 * Kart vadesinin kullanıcıya gösterilecek metni (İP-17).
 *
 * REVIEW kartlarının vadesi sunucuda **çalışma gününün başına** yuvarlanır
 * (bkz. `srs_service.answer` + sözleşme §4.3/G-5), yani saat her review
 * kartında aynıdır ve hiçbir bilgi taşımaz — "11 Ağustos 2026 04:00"un
 * "04:00"ı, kartın sabah 04:00'te çalışılacağını değil, o GÜNE ait olduğunu
 * söyler. Anki de gün ölçekli vadeyi yalnız tarih olarak gösterir.
 *
 * LEARNING/RELEARNING kartları intraday'dir (1 dk / 10 dk adımları); orada
 * saat gerçek bilgidir ve gösterilir. NEW kartın vadesi yoktur.
 */
export function srsDueLabel(
  state: SrsCardState,
  iso: string | null | undefined,
): string {
  if (!iso) return "-";
  return state === "REVIEW" ? formatDate(iso) : formatDateTime(iso);
}
