// İP-16 — Aralıklı Tekrar (FSRS) tipleri. Backend `/srs` pydantic
// şemalarıyla birebir eşleşir (docs/ip16-flashcard-sozlesme.md §8).
// Bilinçli olarak types/index.ts'ten AYRI dosyadadır.

export type SrsNoteType = "BASIC" | "BASIC_REVERSED" | "CLOZE" | "TYPE_IN";

export type SrsCardState = "NEW" | "LEARNING" | "REVIEW" | "RELEARNING";

export type SrsDeckVisibility = "PRIVATE" | "PLATFORM";

/** 1=Tekrar, 2=Zor, 3=İyi, 4=Kolay. */
export type SrsRating = 1 | 2 | 3 | 4;

export interface SrsCounts {
  new: number;
  learning: number;
  review: number;
}

export interface SrsDeck {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  visibility: SrsDeckVisibility;
  new_per_day: number | null;
  reviews_per_day: number | null;
  counts?: SrsCounts;
}

export interface SrsDeckList {
  own: SrsDeck[];
  assigned: SrsDeck[];
}

export interface SrsDeckCreate {
  name: string;
  description?: string;
  parent_id?: number;
  new_per_day?: number | null;
  reviews_per_day?: number | null;
}

export type SrsDeckUpdate = Partial<SrsDeckCreate>;

export interface SrsAssignment {
  client_id: number;
  client_name?: string | null;
  assigned_at?: string;
}

export interface SrsNote {
  id: number;
  deck_id: number;
  note_type: SrsNoteType;
  front: string;
  back: string;
  tags: string[];
}

export interface SrsNoteCreate {
  note_type: SrsNoteType;
  front: string;
  back: string;
  tags: string[];
}

export type SrsNoteUpdate = Partial<Omit<SrsNoteCreate, "note_type">>;

export interface SrsCard {
  id: number;
  note_id: number;
  deck_id: number;
  template_ord: number;
  note_type: SrsNoteType;
  front: string;
  back: string;
  tags: string[];
  state: SrsCardState;
  due_at: string | null;
  suspended: boolean;
  /** Q-8: 8. lapse'te işaretlenir ve kart otomatik askıya alınır. */
  is_leech: boolean;
}

export interface SrsCardListParams {
  deck_id?: number;
  state?: SrsCardState;
  tag?: string;
  q?: string;
  suspended?: boolean;
  page?: number;
  page_size?: number;
}

export interface SrsCardList {
  items: SrsCard[];
  total: number;
  /** Kapsamdaki askıda kart sayısı — uygulanan filtreden bağımsız. */
  suspended_total: number;
  /** Kapsamdaki leech kart sayısı (askıda olanların alt kümesi). */
  leech_total: number;
}

export type SrsBulkAction =
  | "suspend"
  | "unsuspend"
  | "bury"
  | "unbury"
  | "move_deck"
  | "add_tag"
  | "remove_tag";

export interface SrsBulkPayload {
  ids: number[];
  action: SrsBulkAction;
  target_deck_id?: number;
  tag?: string;
}

export interface SrsBulkResult {
  affected: number;
}

/** 4 rating için sonraki aralık önizlemesi — dakika cinsinden. */
export type SrsPreviews = Record<"1" | "2" | "3" | "4", number>;

export interface SrsQueueCard {
  id: number;
  note_type: SrsNoteType;
  front: string;
  back: string;
  template_ord: number;
  previews: SrsPreviews;
}

export interface SrsQueue {
  counts: SrsCounts;
  card: SrsQueueCard | null;
}

export interface SrsAnswerPayload {
  card_id: number;
  rating: SrsRating;
  client_token: string;
}

export interface SrsAnswerResult {
  card_id: number;
  state: SrsCardState;
  step: number | null;
  due_at: string | null;
  introduced_new: boolean;
  counts: SrsCounts;
}

export interface SrsUndoResult {
  card_id: number;
  state: SrsCardState;
}

export interface SrsTag {
  id: number;
  name: string;
}

export interface SrsFutureLoadDay {
  day: string;
  due: number;
}

export interface SrsStats {
  review_count: number;
  retention_rate: number | null;
  future_load: SrsFutureLoadDay[];
  counts?: SrsCounts;
}
