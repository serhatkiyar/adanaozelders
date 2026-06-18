// Mesaj arama sonuçlarında eşleşen terimi vurgulamak için saf yardımcılar.
// Gövdeyi eşleşme etrafından kırpılmış bir kesite indirir ve vurgulama için
// eşleşen/eşleşmeyen parçalara böler.

export interface SnippetSegment {
  text: string;
  /** Bu parça aranan terimle eşleşiyor mu (vurgulanmalı mı)? */
  match: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `body` içinde `term` geçen yeri bulur, etrafından `context` karakterlik bir
 * pencere kırpar (gerekirse baş/sona "…" ekler) ve vurgulama için parçalara
 * böler. Eşleşme yoksa gövde tek (vurgusuz) parça olarak döner.
 */
export function buildSnippet(
  body: string,
  term: string,
  context = 48
): SnippetSegment[] {
  const t = term.trim();
  if (!t) return body ? [{ text: body, match: false }] : [];

  const first = body.search(new RegExp(escapeRegExp(t), "iu"));

  // Kesit penceresi: ilk eşleşmeden `context` kadar önce başlat.
  let start = 0;
  let prefix = "";
  if (first > context) {
    start = first - context;
    prefix = "…";
  }
  const maxLen = context * 2 + t.length + 40;
  let slice = body.slice(start);
  let suffix = "";
  if (slice.length > maxLen) {
    slice = slice.slice(0, maxLen);
    suffix = "…";
  }

  const segments: SnippetSegment[] = [];
  if (prefix) segments.push({ text: prefix, match: false });

  const re = new RegExp(escapeRegExp(t), "giu");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    if (m.index > last) {
      segments.push({ text: slice.slice(last, m.index), match: false });
    }
    segments.push({ text: m[0], match: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // sonsuz döngü güvenliği
  }
  if (last < slice.length) {
    segments.push({ text: slice.slice(last), match: false });
  }
  if (suffix) segments.push({ text: suffix, match: false });
  return segments;
}
