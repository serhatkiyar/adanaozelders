// FastAPI Pydantic şemalarının birebir TypeScript karşılıkları.
// Decimal -> STRING (Pydantic v2 JSON serileştirmesi; örn. "250.5"), datetime/date -> ISO string.
// Para alanlarını okurken @/lib/money parseMoney/formatTRY kullan.

/* ============================ ENUMS ============================ */

export enum RoleType {
  ADMIN = "ADMIN",
  TUTOR = "TUTOR",
  CLIENT = "CLIENT",
  LIBRARY_OPERATOR = "LIBRARY_OPERATOR",
}

export const ROLE_IDS = {
  ADMIN: 1,
  TUTOR: 2,
  CLIENT: 3,
  LIBRARY_OPERATOR: 4,
} as const;

export enum TutorStatus {
  DRAFT = "DRAFT",
  PENDING_APPROVAL = "PENDING_APPROVAL",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  SUSPENDED = "SUSPENDED",
}

export enum BookingStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  CANCELLED = "CANCELLED",
  COMPLETED = "COMPLETED",
}

export enum QAStatus {
  OPEN = "OPEN",
  ANSWERED = "ANSWERED",
  CLOSED = "CLOSED",
}

export enum DemandStatus {
  OPEN = "OPEN",
  CLOSED = "CLOSED",
  CANCELLED = "CANCELLED",
}

export enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  UNSPECIFIED = "UNSPECIFIED",
}

/* ============================ AUTH ============================ */

export interface Token {
  access_token: string;
  token_type: string;
  refresh_token?: string | null;
}

export interface RegisterRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  username: string;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: Gender | null;
}

/* ============================ USER ============================ */

export interface UserOut {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  username: string;
  full_name: string; // first_name + last_name (backend hybrid)
  is_active: boolean;
  email_verified: boolean;
  phone?: string | null;
  phone_verified?: boolean;
  role_id: number;
  avatar_url?: string | null;
  about?: string | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: Gender | null;
  created_at: string;
  last_seen_at?: string | null;
  // Ad-soyad / kullanıcı adı kaç kez değiştirildi (ilk değişiklik serbest).
  name_change_count?: number;
  username_change_count?: number;
  // Bir sonraki değişimin admin onayı gerektirip gerektirmediği (role/duruma göre;
  // örn. onaylı eğitmen ve kütüphane operatörü her zaman onaya gider).
  name_change_locked?: boolean;
  username_change_locked?: boolean;
  // update_me yanıtında ilgili alanın admin onayına gönderildiğini bildirir.
  pending_name_change?: boolean;
  pending_username_change?: boolean;
}

export interface UserUpdate {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  about?: string | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: Gender | null;
  // Ad-soyad/kullanıcı adının ikinci ve sonraki değişikliği için zorunlu gerekçe.
  reason?: string | null;
}

export type NameChangeKind = "NAME" | "USERNAME";
export type NameChangeStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface NameChangeRequest {
  id: number;
  user_id: number;
  role_id: number;
  kind: NameChangeKind;
  new_first_name?: string | null;
  new_last_name?: string | null;
  new_username?: string | null;
  reason: string;
  status: NameChangeStatus;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface PasswordChange {
  current_password: string;
  new_password: string;
}

export interface UserStats {
  completed_lessons: number;
}

/* ============================ EDUCATION ============================ */

export type DocumentType = "DIPLOMA" | "DENKLIK" | "OGRENCI_BELGESI";
export type VerificationStatus = "NONE" | "PENDING" | "VERIFIED" | "REJECTED";

export interface Education {
  id: number;
  school_name: string;
  degree?: string | null;
  field_of_study?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  // Yalnız eğitmen eğitimlerinde dolu (diploma/belge).
  document_url?: string | null;
  document_name?: string | null;
  // Diploma doğrulama (public: tür + durum; barkod/TCKN/not yalnız sahibe/admin'e döner).
  document_type?: DocumentType | null;
  verification_status?: VerificationStatus;
  verified_at?: string | null;
  verification_code?: string | null;
  verification_tckn?: string | null;
  verification_note?: string | null;
}

export interface EducationCreate {
  school_name: string;
  degree?: string | null;
  field_of_study?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  document_type?: DocumentType | null;
  verification_code?: string | null;
  verification_tckn?: string | null;
}

export type EducationUpdate = EducationCreate;

/** Admin diploma doğrulama kuyruğu öğesi. */
export interface AdminEducation extends Education {
  tutor_id: number;
  tutor_name?: string | null;
}

/* ============================ FLASHCARDS (Öğren) ============================ */

export interface FlashcardDeck {
  id: number;
  name: string;
  description?: string | null;
  card_count: number;
  due_count: number;
  created_at: string;
}

export interface Flashcard {
  id: number;
  deck_id: number;
  front: string;
  back: string;
  interval_minutes: number;
  repetitions: number;
  ease_factor: number;
  due_at: string;
  last_reviewed_at?: string | null;
}

export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface DeckCreate {
  name: string;
  description?: string | null;
}

export interface CardCreate {
  front: string;
  back: string;
}

/* ============================ HABITS (Alışkanlıklar) ============================ */

export type HabitPeriod = "daily" | "weekly";

export interface Habit {
  id: number;
  name: string;
  color?: string | null;
  icon?: string | null;
  period: HabitPeriod;
  target_per_period: number;
  created_at: string;
  // Sunucuda hesaplanan metrikler:
  current_streak: number;
  longest_streak: number;
  total_completions: number;
  period_count: number;
  today_count: number;
  done: boolean;
  // Isı haritası: { "YYYY-MM-DD": count } (son ~17 hafta).
  recent: Record<string, number>;
}

export interface HabitCreate {
  name: string;
  color?: string | null;
  icon?: string | null;
  period: HabitPeriod;
  target_per_period: number;
}

/* ============================ TASKS (Görevlerim / To-Do) ============================ */

// Öncelik tamsayı (Todoist deseni): 1=P1 (acil) … 4=P4 (varsayılan).
export type TaskPriority = 1 | 2 | 3 | 4;

// Tekrar kuralı; backend ile aynı sözcükler.
export type TaskRecurrence =
  | "daily"
  | "weekly"
  | "weekdays"
  | "monthly"
  | "yearly";

export interface TaskLabel {
  id: number;
  name: string;
  color?: string | null;
  is_favorite: boolean;
}

export interface TaskList {
  id: number;
  name: string;
  color?: string | null;
  position: number;
  is_inbox: boolean;
  is_favorite: boolean;
  active_count: number;
  overdue_count: number;
  created_at: string;
}

export interface Subtask {
  id: number;
  task_id: number;
  title: string;
  is_done: boolean;
  position: number;
}

// ── Hatırlatıcılar (Todoist 'Reminders') ──
export type ReminderType = "relative" | "absolute";

export interface TaskReminder {
  id: number;
  type: ReminderType;
  offset_minutes?: number | null; // relative: son tarihe göre dakika (negatif = önce)
  remind_at?: string | null; // absolute: mutlak an (ISO/UTC)
  trigger_at: string;
  status: string; // pending | sent | failed
}

// İç içe gönderilen hatırlatma (create/update payload).
export interface ReminderInput {
  type: ReminderType;
  offset_minutes?: number | null;
  remind_at?: string | null;
}

export interface Task {
  id: number;
  list_id: number;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  due_at?: string | null;
  recurrence?: string | null;
  completed_at?: string | null;
  position: number;
  booking_id?: number | null;
  parent_id?: number | null;
  subtasks: Subtask[];
  labels: TaskLabel[];
  reminders: TaskReminder[];
  created_at: string;
}

export interface TaskListCreate {
  name: string;
  color?: string | null;
}

export interface LabelCreate {
  name: string;
  color?: string | null;
}

export interface TaskCreate {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  due_at?: string | null;
  recurrence?: string | null;
  booking_id?: number | null;
  label_ids?: number[];
  reminders?: ReminderInput[];
  timezone?: string;
}

export interface TaskUpdate {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  due_at?: string | null;
  recurrence?: string | null;
  booking_id?: number | null;
  label_ids?: number[];
  list_id?: number;
  parent_id?: number | null;
  reminders?: ReminderInput[];
  timezone?: string;
}

export type TaskStatusFilter = "active" | "completed" | "all";

// ── Kayıtlı filtreler (Todoist 'Filtreler') ──
export type TaskSort = "smart" | "due" | "priority" | "alpha";
export type DueGroupKey = "overdue" | "today" | "upcoming" | "none";

// Backend ile birebir (snake_case) — depolanan kriter şekli.
export interface TaskFilterCriteria {
  q?: string | null;
  priorities: TaskPriority[];
  label_ids: number[];
  due: DueGroupKey[];
  sort: TaskSort;
}

export interface TaskFilter {
  id: number;
  name: string;
  color?: string | null;
  criteria: TaskFilterCriteria;
  position: number;
  is_favorite: boolean;
  created_at: string;
}

export interface TaskFilterCreate {
  name: string;
  color?: string | null;
  criteria: TaskFilterCriteria;
  is_favorite?: boolean;
}

// Bir öğrencinin herkese açık profili (öğretmenler görüntüler).
export interface ClientPublicOut {
  id: number;
  full_name: string;
  username: string;
  avatar_url?: string | null;
  about?: string | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: Gender | null;
  created_at: string;
  last_seen_at?: string | null;
  completed_lessons: number;
  educations: Education[];
}

// Öğrencinin kayıtlı (yeniden kullanılabilir) buluşma adresi.
export interface SavedAddress {
  id: number;
  title: string;
  address_line: string;
  /** Yapısal il/ilçe (Cıncık Teslimat bölge kontrolü; eski adreslerde null). */
  city?: string | null;
  district?: string | null;
  door_no?: string | null;
  apt_no?: string | null;
  directions?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  is_default: boolean;
}

export interface SavedAddressCreate {
  title: string;
  address_line: string;
  city?: string | null;
  district?: string | null;
  door_no?: string | null;
  apt_no?: string | null;
  directions?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  is_default?: boolean;
}

export type SavedAddressUpdate = Partial<SavedAddressCreate>;

// Öğrenci arama sonucu kartı (eğitmen tarafından aranır).
export interface ClientSearchOut {
  id: number;
  full_name: string;
  username: string;
  avatar_url?: string | null;
  about?: string | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: Gender | null;
  last_seen_at?: string | null;
}

/* ============================ NOTIFICATION ============================ */

export interface NotificationOut {
  id: number;
  message: string;
  link?: string | null;
  is_read: boolean;
  created_at: string;
}

/* ============================ MESSAGING ============================ */

export interface ConversationOut {
  id: number;
  client_id: number;
  tutor_id: number;
  created_at: string;
  counterparty_id?: number | null;
  counterparty_name?: string | null;
  counterparty_avatar_url?: string | null;
  /** Karşı tarafın türü: CLIENT | TUTOR | LIBRARY. */
  counterparty_role?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  unread?: number;
  /** Karşı tarafın bu sohbeti en son okuduğu an ("Görüldü" göstergesi için). */
  counterparty_last_read_at?: string | null;
  /** İstek sahibi bu sohbeti arşivlemiş mi? */
  archived?: boolean;
}

/** Mesaj aramasında gövdesi eşleşen tek bir mesaj (her eşleşme ayrı satır). */
export interface MessageSearchHit {
  message_id: number;
  conversation_id: number;
  counterparty_id?: number | null;
  counterparty_name?: string | null;
  counterparty_avatar_url?: string | null;
  counterparty_role?: string | null;
  sender_role: "CLIENT" | "TUTOR" | "LIBRARY";
  body: string;
  created_at: string;
}

/** Arama sonucu iki bölüm: isim eşleşmeleri (chats) + gövde eşleşmeleri (messages). */
export interface MessageSearchResults {
  chats: ConversationOut[];
  messages: MessageSearchHit[];
}

/** Okunmamış mesaj sayısı, gelen kutusu (arşivlenmemiş) ve arşiv olarak ayrı. */
export interface MessagesUnreadCounts {
  inbox: number;
  archived: number;
}

export interface MessageReplyPreview {
  id: number;
  sender_role: "CLIENT" | "TUTOR";
  body: string;
}

export interface MessageReactionOut {
  emoji: string;
  count: number;
  reacted: boolean;
}

export interface MessageOut {
  id: number;
  conversation_id: number;
  sender_role: "CLIENT" | "TUTOR" | "SYSTEM";
  sender_id: number;
  body: string;
  created_at: string;
  reply_to_id?: number | null;
  reply_preview?: MessageReplyPreview | null;
  reactions?: MessageReactionOut[];
  /** Mesaj türü: "text" (varsayılan sohbet), "booking_card" (gömülü ders kartı). */
  msg_type?: string;
  /** Zengin mesajlar (booking_card vb.) için JSON yük. */
  meta_data?: BookingCardMetadata | null;
}

/** booking_card tipi mesajlarda metadata yapısı. */
export interface BookingCardMetadata {
  booking_id: number;
  status: BookingStatus;
  start_at: string;
  end_at: string;
  price?: string | null;
  is_free_lesson?: boolean;
  mode?: string | null;
  notes?: string | null;
  client_name?: string | null;
}

/* ============================ TUTOR ============================ */

export interface Availability {
  weekday: number; // 0=Pazartesi … 6=Pazar
  start_minute: number; // gece yarısından dakika
  end_minute: number;
}

export interface TutorProfileUpdate {
  headline?: string | null;
  bio?: string | null;
  lesson_info?: string | null;
  intro_video_url?: string | null;
  first_lesson_free?: boolean | null;
  hourly_rate?: number | null;
  teaching_mode?: TeachingMode | null;
  location_text?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  district?: string | null;
  subjects?: string[] | null;
  availability?: Availability[] | null;
}

export interface TutorOut extends UserOut {
  status: TutorStatus;
  slug: string; // backend computed: isim-soyisim-{id}
  headline?: string | null;
  bio?: string | null;
  lesson_info?: string | null;
  intro_video_url?: string | null;
  first_lesson_free?: boolean;
  hourly_rate?: string | null; // Decimal -> string
  teaching_mode?: TeachingMode | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: Gender | null;
  location_text?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  district?: string | null;
  subjects?: string[];
  availability?: Availability[];
}

export interface TutorSearchOut {
  id: number;
  slug: string; // backend computed: isim-soyisim-{id}
  full_name: string;
  avatar_url?: string | null;
  headline?: string | null;
  bio?: string | null;
  lesson_info?: string | null; // "Ders Hakkında" — yalnız detay yanıtında dolu
  intro_video_url?: string | null; // Tanıtım videosu — yalnız detay yanıtında dolu
  first_lesson_free?: boolean; // İlk ders ücretsiz mi (kart/profil rozeti)
  hourly_rate?: string | null; // Decimal -> string
  teaching_mode?: TeachingMode | null;
  gender?: Gender | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  last_seen_at?: string | null;
  // Güven sinyalleri (profilde rozet): hesap açılış tarihi + tamamlanan ders sayısı.
  created_at?: string | null;
  completed_lessons?: number;
  // Ortalama ilk-yanıt süresi (saniye); yalnız profil detayında dolu, listede yok.
  avg_response_seconds?: number | null;
  rating_count: number;
  rating_average?: number | null;
  bayesian_score: number;
  location_text?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  district?: string | null;
  distance_km?: number | null;
  subjects?: string[];
  availability?: Availability[];
  educations?: Education[];
  /** Ödeme hesabı (alt üye) onaylı → "Kimliği Doğrulanmış" rozeti. */
  identity_verified?: boolean;
}

export type PayoutStatus = "NONE" | "PENDING" | "ACTIVE" | "REJECTED";

export interface PayoutOut {
  payout_status: PayoutStatus;
  iban_masked?: string | null;
  identity_last4?: string | null;
  payout_updated_at?: string | null;
}

export interface PayoutSubmit {
  iban: string;
  tckn: string;
  gsm?: string | null;
}

export enum TutorSort {
  RELEVANCE = "relevance",
  PRICE_ASC = "price_asc",
  PRICE_DESC = "price_desc",
  RATING_DESC = "rating_desc",
}

export enum TeachingMode {
  ONLINE = "ONLINE", // Uzaktan
  IN_PERSON = "IN_PERSON", // Yüzyüze
  BOTH = "BOTH", // Her ikisi
}

/* ============================ BOOKING ============================ */

export interface BookingCreate {
  tutor_id: number;
  start_at: string;
  end_at: string;
  // Fiyat gönderilmez; backend eğitmen ücreti × süre ile hesaplar.
  notes?: string | null;
  mode?: TeachingMode | null; // ONLINE | IN_PERSON
  location?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  // Ücretsiz ilk ders talebi; uygunluk sunucuda doğrulanır.
  free_lesson?: boolean;
}

export interface BookingResourceOut {
  id: number;
  booking_id: number;
  uploader_role: "CLIENT" | "TUTOR" | string;
  uploader_id: number;
  title: string;
  kind: "link" | "file" | string;
  url: string;
  file_name?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  created_at: string;
}

export interface BookingCommentOut {
  id: number;
  booking_id: number;
  sender_role: "CLIENT" | "TUTOR" | string;
  sender_id: number;
  body: string;
  created_at: string;
}

export interface BookingPrivateNoteOut {
  id: number;
  booking_id: number;
  owner_role: number;
  owner_id: number;
  body: string;
  created_at: string;
}

export interface BookingOut {
  id: number;
  tutor_id: number;
  client_id: number;
  status: BookingStatus;
  start_at: string;
  end_at: string;
  price?: string | null; // Decimal -> string
  is_free_lesson?: boolean;
  notes?: string | null;
  cancel_reason?: string | null;
  mode?: string | null; // ONLINE | IN_PERSON
  location?: string | null;
  location_lat: number | null;
  location_lng: number | null;
  meeting_room?: string | null;
  created_at: string;
  tutor_name?: string | null;
  tutor_avatar_url?: string | null;
  client_name?: string | null;
  client_avatar_url: string | null;
  reviewed: boolean;
  resources: BookingResourceOut[];
  comments: BookingCommentOut[];
  private_notes: BookingPrivateNoteOut[];
  payment?: Payment | null;
}

/* ============================ PAYMENT ============================ */

export enum PaymentStatus {
  PENDING = "PENDING", // tutor kabul etti; öğrencinin ödemesi bekleniyor
  HELD = "HELD", // ödendi; tutar emanette (escrow)
  RELEASED = "RELEASED", // ders tamamlandı; eğitmene aktarıldı
  REFUNDING = "REFUNDING", // iade süreci başladı; sağlayıcı teyidi bekleniyor
  REFUNDED = "REFUNDED", // iptal; öğrenciye iade
  FAILED = "FAILED", // ödeme başarısız
}

export interface Payment {
  id: number;
  booking_id: number;
  amount: string; // Decimal -> string
  commission_amount: string;
  tutor_earning: string;
  commission_rate: string;
  currency: string;
  status: PaymentStatus;
  provider: string;
  paid_at?: string | null;
  released_at?: string | null;
  refunded_at?: string | null;
  created_at: string;
  redirect_url?: string | null; // prod 3DS; fake'te null
}

export interface EarningsSummary {
  released: string;
  pending: string;
  this_month?: string;
  refunded?: string;
  currency?: string;
}

// Bakiye sayfasındaki tek bir kazanç hareketi (ders / deneme / çalışma).
// status backend'de Payment sözlüğüne normalize edilir → PaymentBadge ile tek mantık.
export interface EarningTransaction {
  id: number;
  source: "LESSON" | "EXAM" | "STUDY" | "STORE";
  title: string;
  counterparty?: string | null;
  gross: string;
  commission: string;
  net: string;
  status: PaymentStatus;
  currency: string;
  occurred_at?: string | null;
  created_at: string;
}

/* ============================ REPORT ============================ */

export enum ReportReason {
  SPAM = "SPAM",
  HARASSMENT = "HARASSMENT",
  INAPPROPRIATE = "INAPPROPRIATE",
  CONTACT_INFO = "CONTACT_INFO",
  SCAM = "SCAM",
  OTHER = "OTHER",
}

export enum ReportStatus {
  OPEN = "OPEN",
  RESOLVED = "RESOLVED",
  DISMISSED = "DISMISSED",
}

export interface ReportCreate {
  target_type: string;
  target_id: number;
  reason: ReportReason;
  description?: string | null;
}

export interface ReportOut {
  id: number;
  reporter_role: number;
  reporter_id: number;
  target_type: string;
  target_id: number;
  reason: ReportReason;
  description?: string | null;
  status: ReportStatus;
  resolution?: string | null;
  resolved_at?: string | null;
  created_at: string;
}

/* ============================ REVIEW ============================ */

export interface ReviewCreate {
  booking_id: number;
  rating: number;
  comment_text?: string | null;
}

export interface ReviewUpdate {
  rating?: number | null;
  comment_text?: string | null;
}

export interface ReviewOut {
  id: number;
  booking_id: number;
  client_id: number;
  tutor_id: number;
  rating: number;
  comment_text?: string | null;
  tutor_reply?: string | null;
  created_at: string;
  client_name?: string | null;
  client_avatar_url?: string | null; // yalnızca liste uçlarında dolu
}

/** Yıldız puan dağılımı — özet başlık + 5→1 dağılım çubukları için (eğitmen + kütüphane ortak). */
export interface RatingDistribution {
  count: number;
  average?: number | null;
  /** Yıldız ("1".."5") → adet. */
  distribution: Record<string, number>;
}

/* ============================ QA ============================ */

export interface QAThreadCreate {
  booking_id: number;
  subject?: string | null;
  question: string;
}

export interface QAAnswer {
  answer: string;
}

export interface QAMessageCreate {
  body: string;
}

export interface QAMessageOut {
  id: number;
  sender_role: "CLIENT" | "TUTOR";
  body: string;
  created_at: string;
}

export interface QAThreadOut {
  id: number;
  client_id: number;
  tutor_id: number;
  booking_id?: number | null;
  subject?: string | null;
  question: string;
  answer?: string | null;
  status: QAStatus;
  answered_at?: string | null;
  created_at: string;
  messages: QAMessageOut[];
  tutor_name?: string | null;
  tutor_avatar_url?: string | null;
  client_name?: string | null;
  client_avatar_url?: string | null;
}

export interface LessonQuestionGroup {
  booking_id: number;
  tutor_id: number;
  tutor_name?: string | null;
  tutor_avatar_url?: string | null;
  tutor_headline?: string | null;
  start_at: string;
  end_at: string;
  quota: number;
  used: number;
  remaining: number;
  can_ask: boolean;
  expired: boolean;
  days_left: number;
  threads: QAThreadOut[];
}

/* ============================ DEMAND ============================ */

export interface DemandCreate {
  title: string;
  description?: string | null;
  subject: string;
  level?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
}

export interface DemandOut {
  id: number;
  client_id: number;
  title: string;
  description?: string | null;
  subject: string;
  level?: string | null;
  budget_min?: string | null; // Decimal -> string
  budget_max?: string | null; // Decimal -> string
  status: DemandStatus;
  created_at: string;
  client_name?: string | null; // eğitmen browse'ında öğrencinin görünen adı
  responded?: boolean; // eğitmen browse'ında: bu eğitmen yanıtladı mı
  response_count?: number; // öğrenci kendi talebinde: gelen yanıt sayısı
}

export interface DemandResponseOut {
  tutor_id: number;
  tutor_name: string;
  tutor_avatar_url?: string | null;
  headline?: string | null;
  responded_at: string;
}

export interface DemandRespondResult {
  conversation_id: number;
  client_id: number;
  client_name: string;
}

/* ============================ EXAM ============================ */

export interface ExamSubjectCreate {
  subject: string;
  correct_count: number;
  wrong_count: number;
  blank_count?: number;
}

export interface ExamSubjectOut {
  id: number;
  subject: string;
  correct_count: number;
  wrong_count: number;
  blank_count: number;
  net_score?: string | null; // Decimal -> string
}

export interface PracticeExamCreate {
  title: string;
  exam_type?: string | null;
  exam_date?: string | null;
  tutor_id?: number | null;
  subjects?: ExamSubjectCreate[];
  correct_count?: number;
  wrong_count?: number;
  blank_count?: number;
  wrong_penalty?: number;
}

export interface PracticeExamOut {
  id: number;
  client_id: number;
  tutor_id?: number | null;
  title: string;
  exam_type?: string | null;
  exam_date?: string | null;
  correct_count: number;
  wrong_count: number;
  blank_count: number;
  net_score?: string | null; // Decimal -> string
  created_at: string;
  subjects: ExamSubjectOut[];
}

/* ============================ ADMIN ============================ */

export interface AdminStats {
  total_clients: number;
  total_tutors: number;
  total_admins: number;
  approved_tutors: number;
  pending_tutors: number;
  total_bookings: number;
  active_bookings: number;
  completed_bookings: number;
  total_reviews: number;
}

/* ============================ LEADERBOARD ============================ */

export interface LeaderboardEntry {
  id: number;
  name: string;
  value: number;
}

export interface LeaderboardOut {
  tutors_by_lessons: LeaderboardEntry[];
  tutors_by_rating: LeaderboardEntry[];
  students_by_lessons: LeaderboardEntry[];
  students_by_net: LeaderboardEntry[];
}

/* ============================ ADMIN ============================ */

export interface AdminUserOut {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface AdminBookingOut {
  id: number;
  tutor_id: number;
  client_id: number;
  status: BookingStatus | string;
  start_at: string;
  end_at: string;
  price?: number | null;
  notes?: string | null;
  cancel_reason?: string | null;
  is_disputed: boolean;
  admin_notes?: string | null;
  created_at: string;
  tutor_name?: string | null;
  client_name?: string | null;
}

/* ============================ LIBRARY (Kütüphane) ============================ */

export interface LibraryHours {
  weekday: number; // 0=Pazartesi … 6=Pazar
  is_closed: boolean;
  open_minute?: number | null;
  close_minute?: number | null;
}

export interface LibrarySpeedTestOut {
  id: number;
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  created_at: string;
}

export interface LibrarySpeedTestStats {
  count: number;
  avg_download_mbps: number | null;
  avg_upload_mbps: number | null;
  avg_ping_ms: number | null;
  last_tested_at: string | null;
  recent: LibrarySpeedTestOut[];
}

export interface SpeedTestResult {
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
}

export interface LibraryImageOut {
  id: number;
  url: string;
  caption?: string | null;
  sort_order: number;
}

export interface LibrarySearchOut {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  cover_url?: string | null;
  logo_url?: string | null;
  location_text?: string | null; // yapısal alanlardan derlenen tam adres
  location_lat?: number | null;
  location_lng?: number | null;
  city?: string | null; // İl
  district?: string | null; // İlçe
  google_place_id?: string | null; // varsa "Haritada Görüntüle" gerçek Google profilini açar
  capacity?: number | null;
  study_hourly_price?: string | null; // Decimal -> string; doluysa çalışma alanı rez. açık
  amenities: string[];
  rating_count: number;
  rating_average?: number | null;
  bayesian_score?: number | null;
  distance_km?: number | null;
  status?: string; // ACTIVE | HIDDEN | PENDING | REJECTED (admin listesinde anlamlı)
  open_now?: boolean | null;
}

/** İlçe filtresi dropdown'ı: ilçe adı + o ilçedeki aktif kütüphane sayısı. */
export interface LibraryDistrictOut {
  district: string;
  count: number;
}

export interface LibraryDetailOut extends LibrarySearchOut {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  neighborhood?: string | null; // Mahalle
  street?: string | null; // Sokak/Cadde
  building_no?: string | null; // Kapı No
  status: string; // ACTIVE | HIDDEN | PENDING | REJECTED
  rejection_reason?: string | null; // self-kayıt reddedildiyse admin gerekçesi
  hours: LibraryHours[];
  images: LibraryImageOut[];
  created_at?: string | null;
}

/** Self-servis "kütüphaneni listele" kayıt yükü (operatör hesabı + temel bilgi). */
export interface LibraryRegisterPayload {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  name: string;
  phone?: string | null;
  description?: string | null;
  city?: string | null;
  district?: string | null;
  location_text?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
}

export interface LibraryReviewOut {
  id: number;
  library_id: number;
  client_id: number;
  rating: number;
  comment_text?: string | null;
  created_at: string;
  client_name?: string | null;
  client_avatar_url?: string | null;
  verified?: boolean;
}

export interface LibraryReviewCreate {
  rating: number;
  comment_text?: string | null;
}

export interface LibraryEarningsOut {
  currency: string;
  released_earning: string; // kütüphaneye serbest bırakılmış net kazanç
  held_earning: string; // emanette bekleyen
  commission_total: string; // platform komisyonu
  released_count: number;
  held_count: number;
  this_month_earning?: string; // bu ay serbest bırakılan net kazanç
  refunded_total?: string; // iade edilen brüt tutar
}

export interface LibraryWrite {
  name: string;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  cover_url?: string | null;
  logo_url?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  // Yapısal adres (elle girilir; location_text backend'de bunlardan derlenir).
  city?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  street?: string | null;
  building_no?: string | null;
  capacity?: number | null;
  study_hourly_price?: number | null;
  status?: string;
  amenities?: string[];
  hours?: LibraryHours[];
}

/* ===================== STUDY RESERVATION (Çalışma alanı) ===================== */

export interface StudyQuoteOut {
  available: boolean;
  capacity: number;
  remaining: number;
  hourly_price: string;
  hours: number;
  amount: string;
  currency: string;
  reason?: string | null;
}

export interface StudyReservationOut {
  id: number;
  library_id: number;
  library_name?: string | null;
  library_slug?: string | null;
  client_id: number;
  client_name?: string | null;
  starts_at: string;
  ends_at: string;
  status: RegistrationStatus;
  amount: string;
  currency: string;
  paid_at?: string | null;
  attended_at?: string | null;
  qr_token?: string | null;
  short_code?: string | null;
  created_at: string;
}

export interface StudyPayResult {
  reservation: StudyReservationOut;
  redirect_url?: string | null;
}

/* ===================== LIBRARY EXAM (Deneme oturumu) ===================== */

export type RegistrationStatus =
  | "PENDING_PAYMENT"
  | "PAID"
  | "ATTENDED"
  | "CANCELLED"
  | "REFUNDING"
  | "REFUNDED";

export interface ExamSessionOut {
  id: number;
  library_id: number;
  library_name?: string | null;
  library_slug?: string | null;
  exam_type: string; // TYT/AYT/YKS…
  title: string;
  description?: string | null;
  starts_at: string; // ISO
  duration_minutes: number;
  capacity: number;
  price: string; // Decimal -> string
  currency: string;
  status: string; // SCHEDULED/CANCELLED/COMPLETED
  registered_count: number;
  available: number;
  my_status?: RegistrationStatus | null;
  my_registration_id?: number | null;
  // Katalog (blueprint) + sonuç durumu.
  catalog_id?: number | null;
  catalog_name?: string | null;
  is_nationwide?: boolean;
  answer_key_url?: string | null; // yalnız sonuç yayınlandıysa dolu
  results_published?: boolean;
  results_entered_count?: number;
}

export interface ExamSessionWrite {
  catalog_id?: number | null;
  exam_type: string;
  title: string;
  description?: string | null;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
  price: number;
}

export interface RegistrationOut {
  id: number;
  session_id: number;
  client_id: number;
  status: RegistrationStatus;
  amount: string;
  currency: string;
  paid_at?: string | null;
  attended_at?: string | null;
  qr_token?: string | null;
  short_code?: string | null;
  created_at: string;
  session?: ExamSessionOut | null;
  // Sınav sonucu (yalnız oturum yayınlandıysa dolu). Birincil = karne (PDF/görsel).
  result_published?: boolean;
  result_document_url?: string | null;
  result_net?: string | null; // opsiyonel toplam net
  result_rank?: number | null; // opsiyonel sıralama
}

// ── Deneme katalogu (blueprint) ──
export interface CatalogOut {
  id: number;
  exam_name: string;
  exam_type: string;
  publisher_name?: string | null;
  description?: string | null;
  question_count?: number | null;
  duration_minutes?: number | null;
  is_public: boolean;
  is_nationwide: boolean;
  answer_key_url?: string | null;
  has_answer_key_data: boolean;
  created_at?: string | null;
  session_count: number;
}

export interface CatalogWrite {
  exam_name: string;
  exam_type: string;
  publisher_name?: string | null;
  description?: string | null;
  question_count?: number | null;
  duration_minutes?: number | null;
  is_public?: boolean;
  is_nationwide?: boolean;
}

export interface PayResult {
  registration: RegistrationOut;
  redirect_url?: string | null;
}

export interface AttendanceResult {
  registration_id: number;
  client_name: string;
  exam_title: string;
  status: RegistrationStatus;
  already: boolean;
  message: string;
}

export interface RosterEntry {
  registration_id: number;
  client_name: string;
  status: RegistrationStatus;
  attended_at?: string | null;
  result_document_url?: string | null;
  result_net?: string | null;
  result_rank?: number | null;
}

export interface ResultSummaryIn {
  net?: number | null;
  rank?: number | null;
}

export interface BulkDocumentOut {
  matched: number;
  skipped: number;
  errors: string[];
}

export interface PublishResultsOut {
  published_count: number;
  message: string;
}

export interface OperatorOut {
  id: number;
  email: string;
  full_name: string;
  library_id: number;
  is_active: boolean;
  created_at: string;
  library_name?: string | null;
}

export interface OperatorCreate {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}

/* ============================ Mağaza (Store) ============================ */

export type ProductKind = "PHYSICAL" | "DIGITAL";
export type SellerType = "PLATFORM" | "TUTOR";
export type ProductStatus = "ACTIVE" | "HIDDEN" | "DRAFT" | "PENDING";

export interface ProductCategory {
  id: number;
  slug: string;
  name: string;
  parent_id?: number | null;
  icon_url?: string | null;
  sort_order: number;
  product_count?: number | null;
}

export interface ProductCategoryWrite {
  name: string;
  parent_id?: number | null;
  icon_url?: string | null;
  sort_order?: number;
}

export interface ProductImageOut {
  id: number;
  url: string;
  caption?: string | null;
  sort_order: number;
}

export interface ProductSearchOut {
  id: number;
  slug: string;
  title: string;
  kind: ProductKind;
  seller_type: SellerType;
  tutor_id?: number | null;
  tutor_name?: string | null;
  price: string;
  compare_at_price?: string | null;
  currency: string;
  cover_url?: string | null;
  in_stock: boolean;
  category_id?: number | null;
  rating_count: number;
  rating_average?: number | null;
  bayesian_score?: number | null;
  status?: string | null;
}

/** Kitap künyesi (opsiyonel) — ürün detayında "Ürün Özellikleri" tablosu + admin formu. */
export interface BookSpecFields {
  author?: string | null;
  publisher?: string | null;
  isbn?: string | null;
  page_count?: number | null;
  dimensions?: string | null;
  publication_year?: number | null;
  edition?: string | null;
  language?: string | null;
  cover_type?: string | null;
}

export interface ProductDetailOut extends ProductSearchOut, BookSpecFields {
  description?: string | null;
  stock?: number | null;
  weight_grams?: number | null;
  digital_asset_name?: string | null;
  images: ProductImageOut[];
  created_at?: string | null;
}

/* ── Koleksiyon (Listelerim) ── */
export interface Collection {
  id: number;
  name: string;
  share_token: string;
  product_ids: number[];
  preview: ProductSearchOut[];
}

export interface CollectionDetail {
  id: number;
  name: string;
  share_token: string;
  items: ProductSearchOut[];
}

export interface CollectionCreate {
  name: string;
}

export interface ProductCreate extends BookSpecFields {
  title: string;
  description?: string | null;
  kind: ProductKind;
  price: string | number;
  compare_at_price?: string | number | null;
  stock?: number | null;
  weight_grams?: number | null;
  category_id?: number | null;
  status?: "ACTIVE" | "HIDDEN" | "DRAFT";
  cover_url?: string | null;
}

export interface ProductUpdate extends BookSpecFields {
  title?: string;
  description?: string | null;
  price?: string | number;
  compare_at_price?: string | number | null;
  stock?: number | null;
  weight_grams?: number | null;
  category_id?: number | null;
  status?: ProductStatus;
  cover_url?: string | null;
}

export interface SellerProductCreate {
  title: string;
  description?: string | null;
  price: string | number;
  compare_at_price?: string | number | null;
  category_id?: number | null;
  cover_url?: string | null;
}

export interface ProductReviewCreate {
  rating: number;
  comment_text?: string | null;
}

export interface ProductReviewOut {
  id: number;
  rating: number;
  comment_text?: string | null;
  created_at: string;
  client_name?: string | null;
  client_avatar_url?: string | null;
}

export interface CartLineIn {
  product_id: number;
  quantity: number;
}

export interface OrderItemOut {
  id: number;
  product_id?: number | null;
  title: string;
  cover_url?: string | null;
  unit_price: string;
  quantity: number;
  kind: ProductKind;
  seller_type: SellerType;
  download_url?: string | null;
}

export interface OrderOut {
  id: number;
  status: string;
  payment_status: string;
  subtotal: string;
  shipping_fee: string;
  discount?: string;
  coupon_code?: string | null;
  total: string;
  currency: string;
  has_physical: boolean;
  ship_recipient?: string | null;
  ship_phone?: string | null;
  ship_address?: string | null;
  ship_city?: string | null;
  ship_district?: string | null;
  ship_lat?: number | null;
  ship_lng?: number | null;
  /** Söz verilen teslim günü (Cıncık Teslimat 16:00 cutoff) — dijital/eski siparişlerde null. */
  promised_delivery_date?: string | null;
  /** true=Cıncık bölgesi (kendi filo), false=dış kargo, null=belirsiz. */
  ship_in_zone?: boolean | null;
  tracking_no?: string | null;
  track_token?: string | null;
  return_status?: string | null;
  created_at: string;
  items: OrderItemOut[];
  redirect_url?: string | null;
}

export type ReturnStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface OrderReturn {
  id: number;
  order_id: number;
  status: ReturnStatus;
  reason: string;
  admin_note?: string | null;
  created_at: string;
  resolved_at?: string | null;
  // Admin listesinde sipariş özeti gömülü; müşteri yanıtında null.
  order?: OrderOut | null;
}

export interface CartValidateOut {
  items: OrderItemOut[];
  subtotal: string;
  shipping_fee: string;
  discount: string;
  coupon_code?: string | null;
  coupon_error?: string | null;
  total: string;
  currency: string;
  has_physical: boolean;
  issues: string[];
}

export interface OrderCreate {
  items: CartLineIn[];
  address_id?: number | null;
  coupon_code?: string | null;
}

export type CouponDiscountType = "PERCENT" | "FIXED";

export interface Coupon {
  id: number;
  code: string;
  discount_type: CouponDiscountType;
  discount_value: string;
  min_subtotal: string;
  max_uses?: number | null;
  per_user_limit?: number | null;
  used_count: number;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active: boolean;
}

export interface CouponCreate {
  code: string;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_subtotal?: number;
  max_uses?: number | null;
  per_user_limit?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
}

export interface SellerProductStat {
  product_id?: number | null;
  title: string;
  units_sold: number;
  gross: string;
  earnings: string;
}

export interface SellerEarnings {
  total_units: number;
  total_orders: number;
  total_gross: string;
  total_earnings: string;
  products: SellerProductStat[];
}

export interface BulkImportResult {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

/* ── Kendi-filo teslimat (mağaza dağıtım turları — ADMIN) ── */

export type DeliveryVehicle = "LADA" | "COROLLA";
export type DeliveryRunStatus = "PLANNED" | "ACTIVE" | "DONE" | "CANCELLED";
export type DeliveryStopStatus = "PENDING" | "DELIVERED" | "FAILED";

export interface DeliveryStopItem {
  title: string;
  quantity: number;
}

export interface DeliveryStop {
  id: number;
  run_id: number;
  order_id: number;
  sequence: number;
  status: DeliveryStopStatus;
  /** Paket etiketi QR içeriği ("{id}:{token}"). */
  qr_payload: string;
  recipient?: string | null;
  phone?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  items: DeliveryStopItem[];
  order_total?: string | null;
  /** Rota optimizasyonu (Faz B) */
  eta?: string | null;
  detour_km?: number | null;
  /** Rotaya kattığı ek yol eşiği aştı → "rotayı bozan" (dış kurye adayı). */
  is_outlier?: boolean;
  otp_sent_at?: string | null;
  delivered_at?: string | null;
  proof?: "OTP" | "ADMIN" | null;
  courier_note?: string | null;
}

export interface DeliveryRun {
  id: number;
  run_date: string;
  vehicle: DeliveryVehicle;
  status: DeliveryRunStatus;
  notes?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  depot_lat: number;
  depot_lng: number;
  /** Rota optimizasyonu (Faz B) — son optimize snapshot'ı */
  optimized_at?: string | null;
  optimize_provider?: string | null;
  total_distance_km?: number | null;
  total_duration_seconds?: number | null;
  /** Encoded polyline5 (vroom); haversine'de null → düz çizgi çizilir. */
  route_geometry?: string | null;
  stops: DeliveryStop[];
}

export interface DeliveryEligibleOrder {
  order_id: number;
  recipient?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  lat?: number | null;
  lng?: number | null;
  total: string;
  item_count: number;
  created_at: string;
  /** Söz verilen teslim günü (16:00 cutoff) — eski siparişlerde null. */
  promised_delivery_date?: string | null;
  /** true=Cıncık bölgesi, false=bölge dışı, null=belirlenemedi. */
  in_zone?: boolean | null;
}

/** Public teslimat sözü bilgisi (GET /store/delivery-info — sunucu saati esas). */
export interface DeliveryInfo {
  cutoff_hour: number;
  /** Şimdi ödenirse söz verilen teslim günü (yerel takvim günü, ISO date). */
  promised_date_now: string;
  /** Bugünkü cutoff'a kalan saniye; cutoff geçtiyse null. */
  countdown_seconds?: number | null;
  districts: string[];
}

export interface DeliveryScanResult {
  stop: DeliveryStop;
  run_status: DeliveryRunStatus;
}

/** Müşterinin sipariş canlı takibi (Faz C). */
export type OrderTrackingStatus =
  | "NOT_DISPATCHED"
  | "EN_ROUTE"
  | "DELIVERED"
  | "FAILED";

export interface OrderTracking {
  status: OrderTrackingStatus;
  sequence?: number | null;
  stops_ahead?: number | null;
  eta?: string | null;
  courier_lat?: number | null;
  courier_lng?: number | null;
  courier_age_seconds?: number | null;
  ship_lat?: number | null;
  ship_lng?: number | null;
}

export interface CourierPosition {
  lat: number | null;
  lng: number | null;
  age_seconds: number | null;
}
