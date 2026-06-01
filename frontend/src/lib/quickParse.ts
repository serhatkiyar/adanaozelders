// Todoist tarzı doğal-dil "Hızlı Ekleme" ayrıştırıcısı (Türkçe). Saf fonksiyon.
//
// Örnekler:
//   "Rapor yarın 17:00 !1 #İş @acil"
//   "Matematik ödevi her Pazartesi #Okul"
//   "Faturayı öde her ay 5 haziran"
//
// Tarih/saat, öncelik (!1-4 veya p1-4), proje (#proje), etiket (@etiket) ve
// tekrar (her gün/hafta/ay/yıl, hafta içi, her <gün>) çıkarılır; kalan metin başlık olur.

export interface QuickParseRef {
  id: number;
  name: string;
}

export interface QuickParseContext {
  projects: QuickParseRef[];
  labels: QuickParseRef[];
  now?: Date;
}

export interface QuickParseResult {
  title: string;
  priority?: number; // 1-4
  dueIso: string | null;
  recurrence: string | null;
  listId?: number; // eşleşen proje
  labelIds: number[]; // eşleşen mevcut etiketler
  newLabelNames: string[]; // eşleşmeyen @token'lar (oluşturulacak)
}

const trLower = (s: string) => s.toLocaleLowerCase("tr");

const MONTHS: Record<string, number> = {
  ocak: 0, şubat: 1, subat: 1, mart: 2, nisan: 3, mayıs: 4, mayis: 4,
  haziran: 5, temmuz: 6, ağustos: 7, agustos: 7, eylül: 8, eylul: 8,
  ekim: 9, kasım: 10, kasim: 10, aralık: 11, aralik: 11,
};

// JS getDay(): 0=Pazar … 6=Cumartesi
const WEEKDAYS: Record<string, number> = {
  pazar: 0, pazartesi: 1, salı: 2, sali: 2, çarşamba: 3, carsamba: 3,
  perşembe: 4, persembe: 4, cuma: 5, cumartesi: 6,
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function nextWeekday(now: Date, target: number, includeToday: boolean): Date {
  const base = startOfDay(now);
  let diff = (target - base.getDay() + 7) % 7;
  if (diff === 0 && !includeToday) diff = 7;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + diff);
}

export function parseQuickAdd(
  raw: string,
  ctx: QuickParseContext
): QuickParseResult {
  const now = ctx.now ?? new Date();
  let rest = ` ${raw} `;

  let priority: number | undefined;
  let recurrence: string | null = null;
  let listId: number | undefined;
  const labelIds: number[] = [];
  const newLabelNames: string[] = [];
  let dateOnly: Date | null = null; // gün (saat hariç)
  let time: { h: number; m: number } | null = null;
  let recurrenceWeekday: number | null = null;

  const cut = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = rest.match(re);
    if (m) {
      fn(m);
      rest = rest.replace(m[0], " ");
    }
  };

  // ── Tekrar ──
  cut(/\bhafta\s*içi\b/iu, () => {
    recurrence = "weekdays";
  });
  cut(/\bher\s+gün\b/iu, () => {
    recurrence = "daily";
  });
  cut(/\b(her\s+hafta|haftalık)\b/iu, () => {
    recurrence = "weekly";
  });
  cut(/\b(her\s+ay|aylık)\b/iu, () => {
    recurrence = "monthly";
  });
  cut(/\b(her\s+yıl|yıllık)\b/iu, () => {
    recurrence = "yearly";
  });
  cut(/\bher\s+(pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar)\b/iu, (m) => {
    recurrence = "weekly";
    recurrenceWeekday = WEEKDAYS[trLower(m[1])];
  });

  // ── Öncelik (!1-4 / p1-4) ──
  cut(/\s(?:!|p)([1-4])\b/iu, (m) => {
    priority = Number(m[1]);
  });

  // ── Proje (#...) ──
  cut(/\s#([^\s#@]+)/u, (m) => {
    const name = trLower(m[1]);
    const found =
      ctx.projects.find((p) => trLower(p.name) === name) ??
      ctx.projects.find((p) => trLower(p.name).startsWith(name));
    if (found) listId = found.id;
  });

  // ── Etiketler (@...) — birden çok olabilir ──
  let labelMatch: RegExpMatchArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((labelMatch = rest.match(/\s@([^\s#@]+)/u))) {
    const token = labelMatch[1];
    const name = trLower(token);
    const found =
      ctx.labels.find((l) => trLower(l.name) === name) ??
      ctx.labels.find((l) => trLower(l.name).startsWith(name));
    if (found) {
      if (!labelIds.includes(found.id)) labelIds.push(found.id);
    } else if (!newLabelNames.some((n) => trLower(n) === name)) {
      newLabelNames.push(token);
    }
    rest = rest.replace(labelMatch[0], " ");
  }

  // ── Göreli gün sözcükleri ──
  cut(/\böbür\s*gün\b/iu, () => {
    dateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  });
  cut(/\byarın\b/iu, () => {
    dateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  });
  cut(/\b(bugün|bugun)\b/iu, () => {
    dateOnly = startOfDay(now);
  });
  cut(/\bhaftaya\b/iu, () => {
    dateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  });

  // ── "N gün/hafta sonra" ──
  if (!dateOnly) {
    cut(/\b(\d{1,3})\s*gün\s*sonra\b/iu, (m) => {
      dateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(m[1]));
    });
    cut(/\b(\d{1,2})\s*hafta\s*sonra\b/iu, (m) => {
      dateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(m[1]) * 7);
    });
  }

  // ── Açık tarih: "15 haziran [2026]" ──
  if (!dateOnly) {
    cut(/\b(\d{1,2})\s+(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)(?:\s+(\d{4}))?\b/iu, (m) => {
      const day = Number(m[1]);
      const month = MONTHS[trLower(m[2])];
      const year = m[3] ? Number(m[3]) : now.getFullYear();
      const d = new Date(year, month, day);
      // Yıl verilmemiş ve tarih geçmişse gelecek yıla taşı.
      if (!m[3] && d < startOfDay(now)) d.setFullYear(year + 1);
      dateOnly = d;
    });
  }

  // ── Açık tarih: "15.06[.2026]" veya "15/06[/2026]" ──
  if (!dateOnly) {
    const m = rest.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/u);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]) - 1;
      let year = m[3] ? Number(m[3]) : now.getFullYear();
      if (m[3] && year < 100) year += 2000;
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        const d = new Date(year, month, day);
        if (!m[3] && d < startOfDay(now)) d.setFullYear(year + 1);
        dateOnly = d;
        rest = rest.replace(m[0], " ");
      }
    }
  }

  // ── Hafta günü adı (tekil) ──
  if (!dateOnly && recurrenceWeekday === null) {
    cut(/\b(pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar)\b/iu, (m) => {
      dateOnly = nextWeekday(now, WEEKDAYS[trLower(m[1])], false);
    });
  }

  // ── Saat: "17:00" | "17.00" | "saat 17" ──
  cut(/\b([01]?\d|2[0-3]):([0-5]\d)\b/u, (m) => {
    time = { h: Number(m[1]), m: Number(m[2]) };
  });
  if (!time) {
    cut(/\bsaat\s+([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\b/iu, (m) => {
      time = { h: Number(m[1]), m: m[2] ? Number(m[2]) : 0 };
    });
  }

  // ── Tarih/saat birleştir ──
  let dueIso: string | null = null;
  if (recurrenceWeekday !== null && !dateOnly) {
    dateOnly = nextWeekday(now, recurrenceWeekday, true);
  }
  // Saat var ama gün yok -> bugün. Tekrar var ama gün yok -> bugün (çapa).
  if (!dateOnly && (time || recurrence)) {
    dateOnly = startOfDay(now);
  }
  const fixedDate = dateOnly as Date | null;
  const fixedTime = time as { h: number; m: number } | null;
  if (fixedDate) {
    if (fixedTime) {
      fixedDate.setHours(fixedTime.h, fixedTime.m, 0, 0);
    } else {
      fixedDate.setHours(23, 59, 0, 0); // saat verilmediyse gün sonu
    }
    dueIso = fixedDate.toISOString();
  }

  const title = rest.replace(/\s+/g, " ").trim();

  return { title, priority, dueIso, recurrence, listId, labelIds, newLabelNames };
}
