// İP-16 §6 — CLOZE kart render yardımcısı.
// `front` içindeki {{cN::metin}} / {{cN::metin::ipucu}} desenlerini parçalar.
// Aktif kartın N'i (template_ord + 1) ön yüzde [...] ya da [ipucu] olarak
// gizlenir, arka yüzde açılmış (vurgulu) gösterilir; diğer N'ler her iki
// yüzde düz metindir. İç içe cloze v1'de desteklenmez (backend 422 verir).

export type ClozeSegmentKind =
  /** Düz metin (cloze dışı ya da aktif olmayan cloze'un içeriği). */
  | "plain"
  /** Aktif cloze, ön yüz: gizli boşluk ("[...]" ya da "[ipucu]"). */
  | "blank"
  /** Aktif cloze, arka yüz: açılmış cevap (vurgulanır). */
  | "answer";

export interface ClozeSegment {
  text: string;
  kind: ClozeSegmentKind;
}

const CLOZE_RE = /\{\{c(\d+)::(.+?)\}\}/g;

/** {{cN::metin::ipucu}} iç gövdesini metin + opsiyonel ipucuna ayırır. */
function splitBody(body: string): { text: string; hint: string | null } {
  const idx = body.indexOf("::");
  if (idx === -1) return { text: body, hint: null };
  return { text: body.slice(0, idx), hint: body.slice(idx + 2) || null };
}

/**
 * Cloze metnini render segmentlerine çevirir.
 *
 * @param front     Notun ön yüz metni (cloze desenli).
 * @param activeN   Aktif cloze numarası (1 tabanlı — template_ord + 1).
 * @param revealed  false = ön yüz (aktif boşluk gizli), true = arka yüz.
 */
export function renderCloze(
  front: string,
  activeN: number,
  revealed: boolean
): ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  const push = (text: string, kind: ClozeSegmentKind) => {
    if (text.length === 0) return;
    const last = segments[segments.length - 1];
    if (last && last.kind === kind && kind === "plain") {
      last.text += text;
    } else {
      segments.push({ text, kind });
    }
  };

  let cursor = 0;
  CLOZE_RE.lastIndex = 0;
  for (const match of front.matchAll(CLOZE_RE)) {
    const [full, num, body] = match;
    const start = match.index ?? 0;
    push(front.slice(cursor, start), "plain");
    cursor = start + full.length;

    const { text, hint } = splitBody(body);
    if (Number(num) === activeN) {
      if (revealed) {
        push(text, "answer");
      } else {
        push(hint ? `[${hint}]` : "[...]", "blank");
      }
    } else {
      push(text, "plain");
    }
  }
  push(front.slice(cursor), "plain");
  return segments;
}

/** front içinde geçen farklı cloze numaraları (artan sırada) — önizleme için. */
export function clozeNumbers(front: string): number[] {
  const nums = new Set<number>();
  CLOZE_RE.lastIndex = 0;
  for (const match of front.matchAll(CLOZE_RE)) {
    nums.add(Number(match[1]));
  }
  return [...nums].sort((a, b) => a - b);
}
