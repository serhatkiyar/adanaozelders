// FastAPI Pydantic şemalarının birebir TypeScript karşılıkları.
// Decimal -> STRING (Pydantic v2 JSON serileştirmesi; örn. "250.5"), datetime/date -> ISO string.
// Para alanlarını okurken @/lib/money parseMoney/formatTRY kullan.

// Tedarikçi senkronu tipleri AYRI dosyada (`types/supplier.ts`) yaşar ve
// buradan yeniden dışa verilir: ürün şeması onlara bağımlı (D-6 maliyet
// bloğu), ama tedarikçi paneli bu dev dosyayı import etmek zorunda değil.
export * from "./supplier";
import type { ProductFulfillment, ProductSupplierOut } from "./supplier";

/* ============================ ENUMS ============================ */

export enum RoleType {
  ADMIN = "ADMIN",
  TUTOR = "TUTOR",
  CLIENT = "CLIENT",
  LIBRARY_OPERATOR = "LIBRARY_OPERATOR",
  COURIER = "COURIER",
}

export const ROLE_IDS = {
  ADMIN: 1,
  TUTOR: 2,
  CLIENT: 3,
  LIBRARY_OPERATOR: 4,
  COURIER: 5,
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

/**
 * Oturum yanıtı — yalnız access token.
 *
 * Refresh token burada YOKTUR: `httpOnly` çerezde taşınır ve JavaScript onu
 * hiç görmez. Gövdede dönseydi saklamak zorunda kalırdık ve tek bir XSS
 * 30 günlük hesap devrine yeterdi.
 */
export interface Token {
  access_token: string;
  token_type: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  username: string;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: Gender | null;
  /**
   * Onaylanan yasal metinlerin sürümü ("YYYY-MM-DD").
   * Backend bunu `user_consents`'a ispat kaydı olarak yazar (KVKK); ZORUNLUDUR
   * — gönderilmezse kayıt 422 döner. Değeri `currentConsentVersion()` verir.
   */
  consent_version: string;
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
  admin_role_code?: string | null;
  admin_permissions?: string[];
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
  birth_date?: string | null; // "YYYY-MM-DD" — yalnız admin yanıtında dolu (KVKK)
  age?: number | null; // eğitmen yüzeyi yaş bilgisini buradan alır
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
  /** Alıcı adı + telefon (boşsa sipariş anında hesap sahibi kullanılır). */
  recipient_name?: string | null;
  phone?: string | null;
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
  recipient_name?: string | null;
  phone?: string | null;
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

export interface AdminDemandOut extends Omit<DemandOut, "client_name" | "response_count"> {
  client_name: string;
  client_email: string;
  response_count: number;
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

export interface AdminPermissionOut {
  id: number;
  code: string;
  name: string;
  group: string;
  description?: string | null;
}

export interface AdminRoleOut {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  is_system: boolean;
  permission_codes: string[];
  assignment_count: number;
}

export interface AdminRoleInput {
  name: string;
  description?: string | null;
  permission_codes: string[];
}

export interface AdminRoleCreate extends AdminRoleInput {
  code: string;
}

export interface AdminRoleAssignmentOut {
  admin_id: number;
  admin_name: string;
  admin_email: string;
  role_id?: number | null;
  role_code?: string | null;
  role_name?: string | null;
}

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

export type AdminUserRole = "ADMIN" | "TUTOR" | "CLIENT";
export type AdminUserRolePath = "admin" | "tutor" | "client";

export interface AdminUserOut {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  full_name: string;
  email: string;
  role: AdminUserRole;
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
  // Yalnız admin küratör listesinde (GET /exam-catalogs) dolu gelir;
  // operatörün gördüğü /exam-catalogs/usable listesinde daima null.
  answer_key_url?: string | null;
  // Anahtar yüklenmiş mi — URL vermeden gösterilebilen güvenli bilgi.
  has_answer_key: boolean;
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
  is_active: boolean;
  product_count?: number | null;
  /** Kategorinin KENDİ varsayılan KDV oranı (ORAN, yüzde değil). Değerler
   *  mali müşavir onayı bekliyor — kod hiçbir oran yazmaz, admin girer. */
  default_tax_rate?: string | number | null;
  /** Miras çözülmüş varsayılan (sunucu çözer; yalnız form ön-doldurması). */
  effective_tax_rate?: string | number | null;
}

export interface ProductCategoryWrite {
  name: string;
  parent_id?: number | null;
  icon_url?: string | null;
  sort_order?: number;
  is_active?: boolean;
  default_tax_rate?: string | number | null;
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
  /** KDV oranı — ORAN (0.20 = %20), yüzde değil. Admin formu bunu yüzdeye çevirip gösterir. */
  tax_rate?: string | number | null;
  currency: string;
  cover_url?: string | null;
  in_stock: boolean;
  /**
   * Kalan adet. `in_stock` yalnız 0/0-değil ayrımı yapar ve "kaç adet var"
   * sorusunu cevaplayamaz.
   *
   * DİJİTALDE `null`, 0 DEĞİL: dijital ürün tükenmez; 0 "Tükendi" rozeti
   * bastırırdı.
   */
  stock?: number | null;
  category_id?: number | null;
  rating_count: number;
  rating_average?: number | null;
  bayesian_score?: number | null;
  status?: string | null;
  /** Kitapta yazar — kartta başlığın altında gösterilir. */
  author?: string | null;
  /** Künye satırı (yazar · yayınevi · ISBN) — yönetim listesinde başlık altı. */
  publisher?: string | null;
  isbn?: string | null;
  /** Stok kalemi kimliği (`FZK-000042`); sunucu üretir, aranabilir. */
  sku?: string | null;
  /* ── Varyant üyeliği (Faz 2) — admin formu ve kardeş seçici bunlardan okur. */
  variant_group_id?: number | null;
  option1_value?: string | null;
  option2_value?: string | null;
  variant_sort?: number;
  barcode?: string | null;
  /** Kartın temsil ettiği grup üye sayısı (tekilde 1). >1 iken `in_stock`
   *  grubun durumudur ve fiyat `group_min_price` ile "X TL'den başlayan". */
  variant_count?: number;
  group_min_price?: string | null;
  /**
   * Vitrindeki uygunluğun KAYNAĞI (tedarikçi senkronu · D-2).
   *
   * `in_stock` yalnız "satılabilir mi" der; `SUPPLIER` ise mal bizim rafımızda
   * DEĞİL, tedarikçidedir ve teslim süresi uzayabilir. Public detayda tek
   * satırlık nötr bir not olarak görünür.
   */
  fulfillment?: ProductFulfillment;
  /**
   * "Kendi stoğum bitince tedarikçi stoğu vitrinde sayılsın" anahtarı.
   *
   * `Product`ta yaşar (bağ tablosunda değil): bağ çözülüp yeniden kurulunca
   * kaybolmamalı ve "temin açık ama bağlantı yok" uyarısı ancak böyle
   * ifade edilebilir. Yönetim listesinde rozet, formda checkbox.
   */
  supplier_backed?: boolean;
  /**
   * Tedarikçi maliyet/marj özeti — **YALNIZ ADMIN yanıtlarında dolu** (D-6).
   *
   * Public aramada her zaman `null`/`undefined`dır; maliyet ticari sırdır ve
   * rakip de müşteri olabilir.
   */
  supplier?: ProductSupplierOut | null;
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

/** Detay sayfası kardeş seçicisindeki tek varyant (public). */
export interface ProductVariantMember {
  id: number;
  slug: string;
  title: string;
  option1_value?: string | null;
  option2_value?: string | null;
  variant_sort: number;
  /** Tükenen kardeş listede kalır ama işaretlenir. */
  in_stock: boolean;
  price: string;
}

/** Detaydaki varyant bloğu — eksen ADLARI gruptan gelir. */
export interface ProductVariants {
  group_id: number;
  title: string;
  option1_name: string;
  option2_name?: string | null;
  members: ProductVariantMember[];
}

export interface ProductDetailOut extends ProductSearchOut, BookSpecFields {
  description?: string | null;
  stock?: number | null;
  weight_grams?: number | null;
  digital_asset_name?: string | null;
  images: ProductImageOut[];
  created_at?: string | null;
  /** Varyant grubundaysa kardeş seçici verisi; grupsuzda null. */
  variants?: ProductVariants | null;
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

/** Ürünün varyant üyeliği alanları (create/update ortak). */
export interface VariantMemberFields {
  variant_group_id?: number | null;
  option1_value?: string | null;
  option2_value?: string | null;
  variant_sort?: number | null;
  /** Gruplu ürün barkodsuz olamaz (DB CHECK); grupsuzda opsiyonel kimlik. */
  barcode?: string | null;
}

export interface ProductCreate extends BookSpecFields, VariantMemberFields {
  title: string;
  description?: string | null;
  kind: ProductKind;
  price: string | number;
  compare_at_price?: string | number | null;
  /** ZORUNLU — sunucuda varsayılanı yoktur (bkz. sözleşme S-5). ORAN, yüzde değil. */
  tax_rate: string | number;
  stock?: number | null;
  weight_grams?: number | null;
  category_id?: number | null;
  status?: "ACTIVE" | "HIDDEN" | "DRAFT";
  cover_url?: string | null;
  /**
   * "Kendi stoğum bitince tedarikçi stoğu vitrinde sayılsın" anahtarı.
   *
   * Bir MERCHANDISING kararıdır ve `Product`ta yaşar, bağ tablosunda değil:
   * bağ çözülüp yeniden kurulunca kaybolmamalı. Yalnız FİZİKSEL üründe
   * anlamlıdır (dijital tükenmez).
   */
  supplier_backed?: boolean;
}

export interface ProductUpdate extends BookSpecFields, VariantMemberFields {
  title?: string;
  description?: string | null;
  price?: string | number;
  compare_at_price?: string | number | null;
  /** Gönderilmezse mevcut oran korunur. ORAN, yüzde değil. */
  tax_rate?: string | number;
  stock?: number | null;
  weight_grams?: number | null;
  category_id?: number | null;
  status?: ProductStatus;
  cover_url?: string | null;
  /** Bkz. `ProductCreate.supplier_backed`. Gönderilmezse mevcut değer korunur. */
  supplier_backed?: boolean;
}

/* ── Varyant grubu (Faz 2) ── */

export interface VariantGroup {
  id: number;
  title: string;
  option1_name: string;
  option2_name?: string | null;
  member_count: number;
}

export interface VariantMember {
  id: number;
  title: string;
  option1_value?: string | null;
  option2_value?: string | null;
  variant_sort: number;
  price: string;
  stock?: number | null;
  status?: string | null;
  cover_url?: string | null;
  sku?: string | null;
  barcode?: string | null;
}

export interface VariantGroupDetail extends VariantGroup {
  members: VariantMember[];
}

/** Sözlükler backend'den gelir — istemcide kopya sabit tutulmaz. */
export interface VariantConfig {
  axes: string[];
  book_root_slugs: string[];
}

export interface VariantGroupWrite {
  title: string;
  option1_name: string;
  option2_name?: string | null;
}

export interface DeriveVariantPayload {
  option1_value: string;
  option2_value?: string | null;
  barcode: string;
  title?: string | null;
  price?: string | number | null;
  variant_sort?: number | null;
  stock?: number | null;
}

export interface SellerProductCreate {
  title: string;
  description?: string | null;
  price: string | number;
  compare_at_price?: string | number | null;
  /** ZORUNLU — eğitmen dijital ürünü de fatura satırıdır. ORAN, yüzde değil. */
  tax_rate: string | number;
  category_id?: number | null;
  cover_url?: string | null;
}

/* ── Sunucu taraflı fatura (İP-5) ──
 * Kırılım sipariş anında SAKLANMIŞ değerlerden gelir; istemci hiçbir vergi
 * hesabı yapmaz. e-Arşiv formatına HAZIR ama hiçbir dış servise bağlı değil.
 */
export interface InvoiceTaxLine {
  /** Oran, 4 basamaklı metin ("0.2000") — Numeric(5,4) ile birebir. */
  rate: string;
  base: string;
  tax: string;
}

export interface OrderInvoiceOut {
  order_id: number;
  issued_for: string;
  paid_at: string;
  currency: string;
  seller: {
    name: string;
    tax_number: string;
    tax_office: string;
    address: string;
    phone: string;
    email: string;
  };
  buyer: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    district?: string | null;
  };
  payment: {
    provider?: string | null;
    provider_ref?: string | null;
    status: string;
    paid_at: string;
  };
  items: {
    order_item_id: number;
    title: string;
    quantity: number;
    unit_price: string;
    line_gross: string;
    tax_rate: string;
    tax_amount: string;
  }[];
  tax_lines: InvoiceTaxLine[];
  shipping: {
    fee: string;
    tax_rate?: string | null;
    tax_amount?: string | null;
  };
  totals: {
    subtotal: string;
    discount: string;
    coupon_code?: string | null;
    net_total: string;
    tax_total: string;
    grand_total: string;
  };
  refund: {
    refunded_amount: string;
    net_total: string;
    tax_total: string;
    tax_lines: InvoiceTaxLine[];
  };
  notice: string;
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
  /** Teslimat talimatı + KOMSUYA notunda komşu adı/daire; erteleme sayacı (max 2). */
  delivery_pref?: DeliveryPref | string;
  delivery_pref_note?: string | null;
  postpone_count?: number;
  tracking_no?: string | null;
  track_token?: string | null;
  return_status?: string | null;
  /** Teslim anı + son iade tarihi (teslim + 14 gün). Teslim edilmemiş/eski siparişlerde null. */
  delivered_at?: string | null;
  return_deadline?: string | null;
  created_at: string;
  items: OrderItemOut[];
  redirect_url?: string | null;
}

export type ReturnStatus = "PENDING" | "APPROVED" | "REJECTED";

/**
 * İadenin hukuki dayanağı.
 * CAYMA: 14 gün koşulsuz cayma (Mesafeli Sözleşmeler Yönetmeliği m.9) —
 * otomatik onaylanır, satıcı REDDEDEMEZ.
 * AYIPLI / DIGER: admin incelemesi gerektirir.
 */
export type ReturnType = "CAYMA" | "AYIPLI" | "DIGER";

/** İade talebine bağlı paranın durumu (talebin durumundan ayrıdır). */
export type ReturnRefundStatus = "NONE" | "REFUNDING" | "REFUNDED";

export interface OrderReturnItem {
  order_item_id: number;
  title?: string | null;
  quantity: number;
  amount: string;
}

export interface OrderReturnItemIn {
  order_item_id: number;
  quantity: number;
}

export interface OrderReturnCreate {
  type: ReturnType;
  reason?: string;
  /** Boş bırakılırsa siparişin tamamı iade edilir. */
  items?: OrderReturnItemIn[];
}

export interface OrderReturn {
  id: number;
  order_id: number;
  type: ReturnType;
  status: ReturnStatus;
  reason: string;
  admin_note?: string | null;
  created_at: string;
  resolved_at?: string | null;
  refund_status: ReturnRefundStatus;
  refund_amount: string;
  refunded_at?: string | null;
  is_partial: boolean;
  items: OrderReturnItem[];
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
  /** Sepetteki kalemler için kapalı ödeme kolları (backend `payment_gates`). */
  blocked_payment_branches?: string[];
}

export interface OrderCreate {
  items: CartLineIn[];
  address_id?: number | null;
  coupon_code?: string | null;
  attribution_token?: string | null;
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

/** Filo aracı (İP-19: sabit LADA/COROLLA enum'u tabloya taşındı — admin CRUD). */
export interface Vehicle {
  id: number;
  /** Değişmez kısa kod (^[A-Z0-9_-]+$) — oluşturulduktan sonra düzenlenemez. */
  code: string;
  label: string;
  plate: string | null;
  profile: "car" | "bike" | "foot";
  /** Rota planında araç başına durak tavanı; null = PLATFORM VARSAYILANI
   *  (`DELIVERY_MAX_STOPS_PER_RUN`) — "sınırsız" değil (denetim B-2). */
  max_stops: number | null;
  /** "HH:MM:SS" (backend time) — form "HH:MM" gönderebilir. */
  shift_start: string | null;
  shift_end: string | null;
  fixed_cost: number;
  /** Turun başladığı nokta; null = varsayılan BASE noktası. */
  start_point_id: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface VehicleCreate {
  code: string;
  label: string;
  plate?: string | null;
  profile?: "car" | "bike" | "foot";
  max_stops?: number | null;
  shift_start?: string | null;
  shift_end?: string | null;
  fixed_cost?: number;
  start_point_id?: number | null;
  sort_order?: number;
}

/** code oluşturmadan sonra değiştirilemez. */
export type VehicleUpdate = Partial<Omit<VehicleCreate, "code">> & {
  is_active?: boolean;
};

/** Başlangıç/toplama noktası (K-9: depo .env sabiti yerine veri).
 *  Varsayılan başlangıç = aktif BASE kayıtlarından sırası en küçük olan. */
export interface PickupPoint {
  id: number;
  name: string;
  kind: "BASE" | "SUPPLIER";
  address: string | null;
  lat: number;
  lng: number;
  sort_order: number;
  is_active: boolean;
}

export interface PickupPointCreate {
  name: string;
  kind: "BASE" | "SUPPLIER";
  address?: string | null;
  lat: number;
  lng: number;
  sort_order?: number;
}

/** Nokta düzenleme (denetim B-9). `kind` DEĞİŞTİRİLEMEZ: bir BASE'i SUPPLIER'a
 *  çevirmek, ona bağlı araçların turunu sessizce başka yerden başlatırdı. */
export interface PickupPointUpdate {
  name?: string;
  address?: string | null;
  lat?: number;
  lng?: number;
  sort_order?: number;
  is_active?: boolean;
}

export type DeliveryRunStatus = "PLANNED" | "ACTIVE" | "DONE" | "CANCELLED";
export type DeliveryStopStatus =
  | "PENDING"
  | "DELIVERED"
  | "FAILED"
  | "RESCHEDULED"
  /** Sipariş iptal/iade edildiği için durak düştü (kurye performansına sayılmaz). */
  | "CANCELLED";

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
  /** Müşteri teslimat talimatı (siparişten; kurye ekranında belirgin bant). */
  delivery_pref?: DeliveryPref | string | null;
  delivery_pref_note?: string | null;
  /** Rota optimizasyonu (Faz B) */
  eta?: string | null;
  detour_km?: number | null;
  /** Rotaya kattığı ek yol eşiği aştı → "rotayı bozan" (dış kurye adayı). */
  is_outlier?: boolean;
  otp_sent_at?: string | null;
  delivered_at?: string | null;
  proof?: "OTP" | "ADMIN" | "PHOTO" | null;
  /** Teslim kanıtı fotoğrafı (kapıya/komşuya bırakma; opsiyonel ek kanıt). */
  photo_url?: string | null;
  courier_note?: string | null;
  /** Söz verilen teslim günü (geçmişse "söz riski"). */
  promised_delivery_date?: string | null;
  /** Bu sipariş kaç kez teslim edilemedi (>0 → öncelikli yeniden deneme). */
  failed_attempts?: number;
  /** Teslim edilememe neden kodu (FailReason) — FAILED durakta dolu. */
  fail_reason?: string | null;
}

export interface DeliveryRun {
  id: number;
  run_date: string;
  vehicle_id: number;
  /** Aracın görünen ETİKETİ ("Lada") — İP-19'dan beri kod değil, ad. */
  vehicle: string;
  status: DeliveryRunStatus;
  notes?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  /** Başlangıç (BASE) noktası koordinatı; hiç BASE tanımlı değilse null. */
  depot_lat: number | null;
  depot_lng: number | null;
  /** Rota optimizasyonu (Faz B) — son optimize snapshot'ı */
  optimized_at?: string | null;
  optimize_provider?: string | null;
  total_distance_km?: number | null;
  total_duration_seconds?: number | null;
  /** Encoded polyline5 (vroom); haversine'de null → düz çizgi çizilir. */
  route_geometry?: string | null;
  courier?: Courier | null;
  stops: DeliveryStop[];
}

/** POST /delivery/runs gövdesi — İP-19: araç FK ile seçilir (eski {vehicle:"LADA"} yok). */
export interface DeliveryRunCreate {
  run_date: string;
  vehicle_id: number;
  notes?: string | null;
  courier_id?: number | null;
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
  /** Toplanacak fiziksel kalemler (başlık + adet). Dijital kalemler dönmez.
   *  Eski istemci/şema ile gelmeyebilir → `hasItemDetail` ile kontrol edin. */
  items?: DeliveryStopItem[];
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

/** Admin kapasite şeridi satırı (GET /delivery/capacity) — bir günün söz doluluğu.
 *  retry_debt: o güne sözlü siparişlerden başarısız denemesi olanlar (söz borcu). */
export interface CapacityDay {
  day: string; // ISO tarih
  is_working_day: boolean;
  /** 0 = kapasite kontrolü kapalı. */
  capacity: number;
  booked: number;
  retry_debt: number;
}

/** Teslimat KPI özeti (GET /delivery/kpi) — ham sayı + oran; hedef YOK (baseline).
 *  Oranlar payda 0 iken null (henüz veri yok). */
export interface DeliveryKpi {
  window_days: number;
  delivered: number;
  failed: number;
  rescheduled: number;
  delivered_count: number;
  first_attempt_delivered: number;
  first_attempt_rate: number | null;
  on_time_delivered: number;
  promised_delivered: number;
  on_time_rate: number | null;
  failure_rate: number | null;
  failed_not_courier_fault: number;
  fail_by_reason: Record<string, number>;
  feedback_up: number;
  feedback_down: number;
  satisfaction_rate: number | null;
  feedback_problems: Record<string, number>;
}

export interface AdminDashboardOut {
  range: "day" | "week" | "month";
  period_start: string;
  previous_period_start: string;
  new_clients: number;
  previous_new_clients: number;
  new_tutors: number;
  previous_new_tutors: number;
  new_orders: number;
  previous_new_orders: number;
  pending_tutors: number;
  pending_diplomas: number;
  active_bookings: number;
  open_demands: number;
  disputed_bookings: number;
  open_reports: number;
  paid_orders: number;
  pending_returns: number;
  low_stock_products: number;
  pending_libraries: number;
  active_delivery_runs: number;
  period_audit_logs: number;
}

export interface DeliveryFeedback {
  id: number;
  order_id: number;
  thumbs_up: boolean;
  problem_codes: string[];
  comment: string | null;
  source: "CLIENT" | "PUBLIC";
  created_at: string;
}

export interface AdminUserDetailOut extends AdminUserOut {
  updated_at: string;
  last_seen_at?: string | null;
  email_verified: boolean;
  tutor_status?: string | null;
  booking_count: number;
  review_count: number;
  demand_count: number;
  order_count: number;
}

export interface AuditLogOut {
  id: number;
  actor_id: number;
  actor_role: number;
  action: string;
  target_type: string;
  target_id?: number | null;
  details?: string | null;
  /** Zorunlu gerekçe (şifre reset, iade kararı vb. kritik aksiyonlarda dolu). */
  reason?: string | null;
  /** Yapılandırılmış önce/sonra özetleri — hassas alanlar sunucuda maskelenir. */
  before_values?: Record<string, unknown> | null;
  after_values?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  ip_address?: string | null;
  /** HTTP request-id — sunucu loglarıyla korelasyon için. */
  request_id?: string | null;
  created_at: string;
}

/** Teslimata kapalı gün (admin takvimi). source: 'holiday' | 'manual'. */
export interface ClosedDay {
  id: number;
  day: string; // ISO tarih
  label: string | null;
  source: string;
}

export interface DeliveryScanResult {
  stop: DeliveryStop;
  run_status: DeliveryRunStatus;
}

/** Müşterinin sipariş canlı takibi (Faz C). POSTPONED = müşteri erteledi. */
export type OrderTrackingStatus =
  | "NOT_DISPATCHED"
  | "EN_ROUTE"
  | "DELIVERED"
  | "FAILED"
  | "POSTPONED";

/** Müşteri teslimat talimatı (siparişte yaşar; kurye ekranında bant olarak görünür). */
export type DeliveryPref =
  | "ADRESIMDEYIM"
  | "KAPIYA_BIRAK"
  | "KOMSUYA_BIRAK"
  | "BENI_ARA";

/** Müşteri olay akışı kodları (Türkçe metin lib/deliveryTimeline.ts sözlüğünde). */
export type TimelineEventCode =
  | "ORDER_RECEIVED"
  | "PAYMENT_CONFIRMED"
  | "PLANNED_FOR_DELIVERY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERY_FAILED"
  | "POSTPONED"
  | "DELIVERED"
  | "CANCELLED"
  | "REFUNDED";

export interface TimelineEvent {
  code: TimelineEventCode | string;
  at: string;
}

export interface OrderTracking {
  status: OrderTrackingStatus;
  can_feedback: boolean;
  feedback_given: boolean;
  sequence?: number | null;
  stops_ahead?: number | null;
  /** Turdaki toplam durak ("önünde 3 / toplam 12" bağlamı). */
  total_stops?: number | null;
  eta?: string | null;
  /** Müşteri sözü penceresi ("18:00–19:00") — nokta ETA yerine bu gösterilir. */
  eta_window_start?: string | null;
  eta_window_end?: string | null;
  courier_lat?: number | null;
  courier_lng?: number | null;
  courier_age_seconds?: number | null;
  ship_lat?: number | null;
  ship_lng?: number | null;
  tracking_no?: string | null;
  recipient_masked?: string | null;
  promised_delivery_date?: string | null;
  /** Kurye kimlik kartı (yalnız EN_ROUTE'ta dolu). */
  courier_name?: string | null;
  courier_photo_url?: string | null;
  courier_plate?: string | null;
  /** Self-servis (token'lı sayfadan da): mevcut talimat + erteleme hakkı. */
  delivery_pref?: DeliveryPref | string | null;
  delivery_pref_note?: string | null;
  can_postpone?: boolean;
  timeline?: TimelineEvent[];
  /** Teslim kanıtı (yalnız DELIVERED'da). */
  delivered_at?: string | null;
  proof?: "OTP" | "ADMIN" | "PHOTO" | string | null;
  proof_photo_url?: string | null;
}

/** Kurye profili (ADMIN yönetir; müşteri takip sayfasında kimlik kartı).
 *  İP-19: plaka kuryeden kalktı — araç kimliği `Vehicle.plate`'te yaşar. */
export interface Courier {
  id: number;
  name: string;
  phone?: string | null;
  photo_url?: string | null;
  is_active: boolean;
}

export interface CourierCreate {
  name: string;
  phone?: string | null;
}

export type CourierUpdate = Partial<CourierCreate> & { is_active?: boolean };

export interface CourierPosition {
  lat: number | null;
  lng: number | null;
  age_seconds: number | null;
}


/** Yönetim para metrikleri (/admin/revenue). Tutarlar string: Decimal
 *  yuvarlama hatası para raporunda kabul edilemez, formatlama istemcide. */
export interface AdminRevenueOut {
  range: string;
  period_start: string;
  previous_period_start: string;
  gmv: string;
  revenue: string;
  commission_revenue: string;
  direct_sales_revenue: string;
  /** Emanetteki para — henüz gelir değil. */
  held: string;
  refunded: string;
  refund_rate: number;
  orders: number;
  aov: string;
  lesson_gmv: string;
  library_gmv: string;
  store_gmv: string;
  previous_gmv: string;
  previous_revenue: string;
  previous_commission_revenue: string;
  previous_direct_sales_revenue: string;
  previous_held: string;
  previous_refunded: string;
  previous_orders: number;
  previous_aov: string;
  previous_lesson_gmv: string;
  previous_library_gmv: string;
  previous_store_gmv: string;
}

/* ─── Admin operasyon kurtarma (İP-4 / P1-4) ─────────────────────────────── */

/** Sıkışmış para kaydının sebebi (backend `StuckReason`). */
export type StuckEscrowReason = "MANUAL_REVIEW" | "RETRY_EXHAUSTED";

export type StuckEscrowEntity =
  | "payment"
  | "exam_registration"
  | "study_reservation"
  | "order"
  | "order_return";

export interface StuckEscrowRecord {
  entity: StuckEscrowEntity;
  entity_id: number;
  order_id: number | null;
  reason: StuckEscrowReason;
  money_status: string;
  amount: string | null;
  currency: string | null;
  refund_attempts: number;
  refund_requested_at: string | null;
  provider_ref: string | null;
  updated_at: string | null;
}

/**
 * Outbox dead-letter satırı. Ham `payload` BİLİNÇLİ OLARAK YOK: alıcının
 * telefonu/e-postası orada yaşıyor ve backend whitelist projeksiyonu uyguluyor.
 */
export interface FailedOutboxEvent {
  id: number;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  order_id: number | null;
  next_attempt_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface OutboxRetryResult extends FailedOutboxEvent {
  /** `false` = iş bu çağrıdan ÖNCE zaten kuyruğa alınmıştı (idempotent no-op). */
  requeued: boolean;
}

// ── Mağaza hero carousel ────────────────────────────────────────────────

export interface StoreHeroSlidePublic {
  id: number;
  image_url: string;
  mobile_image_url: string | null;
  alt_text: string;
  link_url: string | null;
}

export interface StoreHeroSlide extends StoreHeroSlidePublic {
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StoreShowcaseProduct {
  id: number;
  slug: string;
  title: string;
  cover_url: string | null;
}

export type StoreShowcaseContentMode = "PRODUCTS" | "CUSTOM";

export interface StoreShowcaseCustomTile {
  image_url: string;
  label: string;
  alt_text: string;
  link_url: string;
}

export interface StoreShowcaseCustomTileInput {
  file: File | null;
  existing_index: number | null;
  label: string;
  alt_text: string;
  link_url: string;
}

export interface StoreShowcaseCardPublic {
  id: number;
  title: string;
  description: string;
  link_url: string;
  link_label: string;
  content_mode: StoreShowcaseContentMode;
  products: StoreShowcaseProduct[];
  custom_tiles: StoreShowcaseCustomTile[];
}

export interface StoreShowcaseFeed {
  configured: boolean;
  cards: StoreShowcaseCardPublic[];
}

export interface StoreShowcaseCard extends StoreShowcaseCardPublic {
  product_ids: number[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StoreShowcaseCardInput {
  title: string;
  description: string;
  link_url: string;
  link_label: string;
  product_ids: number[];
  is_active: boolean;
  sort_order: number;
}

export interface StoreShowcaseCustomCardInput {
  title: string;
  description: string;
  link_url: string;
  link_label: string;
  tiles: StoreShowcaseCustomTileInput[];
  is_active: boolean;
  sort_order: number;
}

export type StoreHomeSectionType = "PRODUCT_RAIL" | "IMAGE_GRID" | "RECENTLY_VIEWED";

export interface StoreHomeImageTile {
  image_url: string;
  label: string;
  alt_text: string;
  link_url: string;
}

export interface StoreHomeImageTileInput {
  file: File | null;
  existing_index: number | null;
  label: string;
  alt_text: string;
  link_url: string;
}

export interface StoreHomeSectionPublic {
  id: number;
  title: string;
  description: string;
  section_type: StoreHomeSectionType;
  link_url: string | null;
  link_label: string;
  products: ProductSearchOut[];
  image_tiles: StoreHomeImageTile[];
}

export interface StoreHomeFeed {
  configured: boolean;
  sections: StoreHomeSectionPublic[];
}

export interface StoreHomeSection extends StoreHomeSectionPublic {
  product_ids: number[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StoreHomeSectionMetaInput {
  title: string;
  description: string;
  link_url: string | null;
  link_label: string;
  is_active: boolean;
  sort_order: number;
}

export interface StoreHomeProductSectionInput extends StoreHomeSectionMetaInput {
  product_ids: number[];
}

export interface StoreHomeImageSectionInput extends StoreHomeSectionMetaInput {
  tiles: StoreHomeImageTileInput[];
}

export interface StoreHeroSlideUpdate {
  alt_text?: string;
  link_url?: string | null;
  is_active?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  sort_order?: number;
}

/* ── Mağaza vitrin sayfaları ve akıllı ürün grupları ── */

export interface ProductAttributeValue {
  id: number;
  definition_id: number;
  label: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}

export interface ProductAttributeDefinition {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
  values: ProductAttributeValue[];
}

export type ProductSetRule =
  | { field: "CATEGORY"; operator: "IN" | "NOT_IN"; values: number[]; include_descendants: boolean }
  | { field: "ATTRIBUTE"; operator: "IN" | "NOT_IN"; values: number[] }
  | { field: "KIND"; operator: "IN" | "NOT_IN"; values: ProductKind[] }
  | { field: "AVAILABLE"; operator: "EQ"; value: boolean }
  | { field: "PRICE"; operator: "BETWEEN"; minimum?: number | null; maximum?: number | null };

export interface ProductSetRevisionInput {
  match_mode: "ALL" | "ANY";
  rules: ProductSetRule[];
  pinned_product_ids: number[];
  excluded_product_ids: number[];
  sort_mode: "MANUAL" | "NEWEST" | "POPULAR" | "RATING" | "PRICE_ASC" | "PRICE_DESC";
  max_items: number;
}

export interface ProductSetRevision extends ProductSetRevisionInput {
  id: number;
  product_set_id: number;
  version: number;
  status: "DRAFT" | "PUBLISHED";
  published_at?: string | null;
}

export interface ProductSetInput {
  name: string;
  description: string;
  is_active: boolean;
  revision: ProductSetRevisionInput;
}

export interface ProductSet {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  revision: ProductSetRevision;
  published_revision_id?: number | null;
  matched_count: number;
  preview_products: ProductSearchOut[];
  warnings: string[];
}

export type LandingPageBlockType =
  | "HERO_CAROUSEL" | "IMAGE_CARD_GRID" | "CATEGORY_GRID"
  | "PRODUCT_RAIL" | "BANNER" | "RICH_TEXT" | "RECENTLY_VIEWED";

export interface LandingPageBlockInput {
  block_key?: string | null;
  block_type: LandingPageBlockType;
  title: string;
  description: string;
  link_label: string;
  link_url?: string | null;
  config: Record<string, unknown>;
  product_set_id?: number | null;
  product_set_revision_id?: number | null;
  is_active: boolean;
  sort_order: number;
}

export interface LandingPageBlock extends LandingPageBlockInput {
  id: number;
  block_key: string;
  products: ProductSearchOut[];
  categories: ProductCategory[];
  warnings: string[];
}

export interface LandingPageRevisionInput {
  title: string;
  seo_title: string;
  seo_description: string;
  og_image_url?: string | null;
  blocks: LandingPageBlockInput[];
}

export interface LandingPageRevision extends LandingPageRevisionInput {
  id: number;
  page_id: number;
  version: number;
  status: "DRAFT" | "PUBLISHED";
  published_at?: string | null;
  blocks: LandingPageBlock[];
}

export interface LandingPageCreate {
  internal_name: string;
  slug: string;
  page_type: "HOME" | "CAMPAIGN" | "SEASONAL" | "EXAM" | "BRAND" | "CURATED";
  revision: LandingPageRevisionInput;
}

export interface LandingPageSummary {
  id: number;
  internal_name: string;
  slug: string;
  page_type: string;
  is_archived: boolean;
  state: "DRAFT" | "UPCOMING" | "LIVE" | "ENDED" | "ARCHIVED";
  latest_revision_id: number;
  latest_version: number;
  starts_at?: string | null;
  ends_at?: string | null;
  has_unpublished_changes?: boolean;
}

export interface LandingPagePublication {
  id: number;
  page_id: number;
  revision_id: number;
  starts_at: string;
  ends_at?: string | null;
  state: "UPCOMING" | "LIVE" | "ENDED";
}

export interface LandingPage {
  id: number;
  internal_name: string;
  slug: string;
  page_type: string;
  is_archived: boolean;
  state: "DRAFT" | "UPCOMING" | "LIVE" | "ENDED" | "ARCHIVED";
  starts_at?: string | null;
  ends_at?: string | null;
  canonical_url: string;
  revision: LandingPageRevision;
}

export interface StoreMediaAsset {
  id: number;
  image_url: string;
  alt_text: string;
  mime_type: string;
  width: number;
  height: number;
  file_size: number;
  created_at: string;
}

export interface StorePageMetric {
  page_id: number;
  page_revision_id: number;
  page_views: number;
  block_clicks: number;
  product_clicks: number;
  paid_orders: number;
  attributed_revenue: string;
}

// ── İP-C2: Duyuru şeridi ────────────────────────────────────────────────

export type DuyuruVaryant = "bilgi" | "dikkat";

/** Public uç (`GET /duyuru-seridi/aktif`) — yalnız gösterime gereken alanlar. */
export interface DuyuruAktifOut {
  metin: string;
  link_url: string | null;
  link_metni: string | null;
  varyant: DuyuruVaryant;
}

/** Admin liste/detay — tüm alanlar. */
export interface DuyuruSeridiOut {
  id: number;
  metin: string;
  link_url: string | null;
  link_metni: string | null;
  varyant: DuyuruVaryant;
  aktif: boolean;
  baslangic_at: string | null;
  bitis_at: string | null;
  sira: number;
  created_at: string;
  updated_at: string;
}

export interface DuyuruSeridiCreate {
  metin: string;
  link_url?: string | null;
  link_metni?: string | null;
  varyant?: DuyuruVaryant;
  aktif?: boolean;
  baslangic_at?: string | null;
  bitis_at?: string | null;
  sira?: number;
}

export type DuyuruSeridiUpdate = Partial<DuyuruSeridiCreate>;
