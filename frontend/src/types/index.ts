// FastAPI Pydantic şemalarının birebir TypeScript karşılıkları.
// Decimal -> STRING (Pydantic v2 JSON serileştirmesi; örn. "250.5"), datetime/date -> ISO string.
// Para alanlarını okurken @/lib/money parseMoney/formatTRY kullan.

/* ============================ ENUMS ============================ */

export enum RoleType {
  ADMIN = "ADMIN",
  TUTOR = "TUTOR",
  CLIENT = "CLIENT",
}

export const ROLE_IDS = {
  ADMIN: 1,
  TUTOR: 2,
  CLIENT: 3,
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
  role_id: number;
  avatar_url?: string | null;
  about?: string | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: Gender | null;
  created_at: string;
  last_seen_at?: string | null;
}

export interface UserUpdate {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  about?: string | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: Gender | null;
}

export interface PasswordChange {
  current_password: string;
  new_password: string;
}

export interface UserStats {
  completed_lessons: number;
}

/* ============================ EDUCATION ============================ */

export interface Education {
  id: number;
  school_name: string;
  degree?: string | null;
  field_of_study?: string | null;
  start_year?: number | null;
  end_year?: number | null;
}

export interface EducationCreate {
  school_name: string;
  degree?: string | null;
  field_of_study?: string | null;
  start_year?: number | null;
  end_year?: number | null;
}

export type EducationUpdate = EducationCreate;

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
  last_message?: string | null;
  last_message_at?: string | null;
  unread?: number;
}

export interface MessageOut {
  id: number;
  conversation_id: number;
  sender_role: "CLIENT" | "TUTOR";
  sender_id: number;
  body: string;
  created_at: string;
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
  hourly_rate?: number | null;
  teaching_mode?: TeachingMode | null;
  location_text?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  subjects?: string[] | null;
  availability?: Availability[] | null;
}

export interface TutorOut extends UserOut {
  status: TutorStatus;
  headline?: string | null;
  bio?: string | null;
  hourly_rate?: string | null; // Decimal -> string
  teaching_mode?: TeachingMode | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  gender?: Gender | null;
  location_text?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  subjects?: string[];
  availability?: Availability[];
}

export interface TutorSearchOut {
  id: number;
  full_name: string;
  avatar_url?: string | null;
  headline?: string | null;
  bio?: string | null;
  hourly_rate?: string | null; // Decimal -> string
  teaching_mode?: TeachingMode | null;
  gender?: Gender | null;
  birth_date?: string | null; // "YYYY-MM-DD"
  last_seen_at?: string | null;
  rating_count: number;
  rating_average?: number | null;
  bayesian_score: number;
  location_text?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  distance_km?: number | null;
  subjects?: string[];
  availability?: Availability[];
  educations?: Education[];
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
  price?: number | null;
  notes?: string | null;
  mode?: TeachingMode | null; // ONLINE | IN_PERSON
  location?: string | null;
}

export interface BookingResourceOut {
  id: number;
  booking_id: number;
  uploader_role: "CLIENT" | "TUTOR" | string;
  uploader_id: number;
  title: string;
  url: string;
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
