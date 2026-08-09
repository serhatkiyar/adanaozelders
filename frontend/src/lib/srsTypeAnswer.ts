// İP-16 T-5/T-6/T-7 — yazarak cevaplama (TYPE_IN) karşılaştırma kuralları.
// Sözleşme (docs/ip16-flashcard-sozlesme.md §6 T-6): iki taraf da aynı
// normalizasyondan geçer; eşitlik normalize formda aranır. Karşılaştırma
// YALNIZ görsel geri bildirimdir — puanlamayı kullanıcı verir (Anki gibi).

export type DiffKind = "good" | "bad" | "missed";

export interface DiffSegment {
  text: string;
  kind: DiffKind;
}

export interface CompareResult {
  correct: boolean;
  segments: DiffSegment[];
}

/** trim → ardışık whitespace tek boşluğa → Unicode NFC. İki katlamanın ortak önü. */
function fold(s: string): string {
  return s.trim().replace(/\s+/g, " ").normalize("NFC");
}

/**
 * T-6 Türkçe katlaması: ortak ön + Türkçe küçük harf. Naif `toLowerCase()`
 * "İ" için "i" + U+0307 (combining dot) bırakır; bu yüzden İ→i ve I→ı
 * dönüşümü ÖNCE elle yapılır, kalanı tr-TR locale ile küçülür. Noktalama
 * korunur.
 */
export function normalizeAnswer(s: string): string {
  return fold(s)
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr-TR");
}

/**
 * B2 — locale'siz (invariant) katlama: ortak ön + `toLowerCase()`.
 *
 * Türkçe katlama tek başına yetmiyor: destede dil alanı YOKTUR ve aynı destede
 * "IELTS" gibi yabancı kısaltmalar ile "Isparta" gibi Türkçe adlar yan yana
 * durur. Türkçe kural `IELTS → ıelts` üretip kullanıcının yazdığı `ielts` ile
 * eşleşmez; invariant kural ise `İstanbul → i̇stanbul` üretip `istanbul` ile
 * eşleşmez. Deste alanı eklemek yerine (kullanıcıya iş yükü + geriye dönük
 * veri sorunu) iki katlama da üretilir ve `compareTypedAnswer` HERHANGİ biri
 * tutarsa cevabı doğru sayar.
 */
export function normalizeInvariantAnswer(s: string): string {
  return fold(s).toLowerCase();
}

/** Ardışık aynı türden karakterleri tek segmentte toplar. */
function pushChar(segments: DiffSegment[], kind: DiffKind, ch: string): void {
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) {
    last.text += ch;
  } else {
    segments.push({ text: ch, kind });
  }
}

/**
 * T-7: karakter-düzeyi LCS diff'i. `typed`'da olup `expected` ile eşleşen
 * parçalar "good", yalnız `typed`'da olanlar "bad" (fazla/yanlış), yalnız
 * `expected`'da olanlar "missed" (eksik). Segment metinleri normalize formdan
 * gelir. Bağımlılıksız, küçük girdiler için O(n·m) DP.
 */
export function compareTypedAnswer(
  expected: string,
  typed: string
): CompareResult {
  const b = normalizeAnswer(expected); // beklenen (Türkçe katlama)
  const a = normalizeAnswer(typed); // yazılan (Türkçe katlama)

  // Çift katlama (B2): iki katlamadan HERHANGİ biri tuttuğunda doğru sayılır.
  // Fark vurgusu yine Türkçe formda üretilir — kullanıcıya gösterilen metin
  // tek bir yazımda kalsın.
  if (
    a === b ||
    normalizeInvariantAnswer(expected) === normalizeInvariantAnswer(typed)
  ) {
    return {
      correct: true,
      segments: b.length > 0 ? [{ text: b, kind: "good" }] : [],
    };
  }

  // dp[i][j] = a[i:] ile b[j:] arasındaki LCS uzunluğu.
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushChar(segments, "good", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushChar(segments, "bad", a[i]);
      i++;
    } else {
      pushChar(segments, "missed", b[j]);
      j++;
    }
  }
  while (i < n) {
    pushChar(segments, "bad", a[i]);
    i++;
  }
  while (j < m) {
    pushChar(segments, "missed", b[j]);
    j++;
  }

  return { correct: false, segments };
}
