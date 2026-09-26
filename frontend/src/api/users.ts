import { apiClient } from "@/api/axios";
import type {
  NameChangeRequest,
  PasswordChange,
  Token,
  UserOut,
  UserUpdate,
} from "@/types";

export async function updateMe(payload: UserUpdate): Promise<UserOut> {
  const { data } = await apiClient.patch<UserOut>("/auth/me", payload);
  return data;
}

// Kullanıcının kendi ad/kullanıcı adı değişiklik talepleri (durumlarıyla).
export async function listMyNameChangeRequests(): Promise<NameChangeRequest[]> {
  const { data } = await apiClient.get<NameChangeRequest[]>(
    "/auth/me/name-change-requests"
  );
  return data;
}

// Şifre değişimi sunucuda TÜM refresh token'ları iptal eder (çalınmış oturum
// şifre değişiminden sonra yaşamasın) ve bu cihaz için yeni bir çift döner —
// çağıran tarafın döneni store'a yazması gerekir, yoksa oturum kopar.
export async function changePassword(payload: PasswordChange): Promise<Token> {
  const { data } = await apiClient.post<Token>("/auth/me/password", payload);
  return data;
}

export type OtpKanali = "whatsapp" | "sms";

// Telefon doğrulama: numara kaydet + OTP iste. Sunucu WhatsApp ayarlıysa önce
// WhatsApp'tan, olmazsa SMS'le gönderir; `channel: "sms"` doğrudan SMS ister.
// Maskeli numara ve kodun fiilen gittiği kanal döner.
export async function requestPhoneOtp(
  phone: string,
  channel?: OtpKanali
): Promise<{ phone_masked: string; channel: OtpKanali }> {
  const { data } = await apiClient.post<{ phone_masked: string; channel: OtpKanali }>(
    "/auth/me/phone",
    channel ? { phone, channel } : { phone }
  );
  return data;
}

// SMS kodunu doğrula → güncel kullanıcı (phone_verified=true) döner.
export async function verifyPhoneOtp(code: string): Promise<UserOut> {
  const { data } = await apiClient.post<UserOut>("/auth/me/phone/verify", {
    code,
  });
  return data;
}

// ── KVKK: veri taşınabilirliği ve hesap silme ──

/** Kullanıcının kendi verisini JSON olarak indirir (KVKK m.20). */
export async function downloadMyData(): Promise<Blob> {
  const { data } = await apiClient.get("/auth/me/data-export", {
    responseType: "blob",
  });
  return data as Blob;
}

export interface DeletionEligibility {
  can_delete: boolean;
  reason?: string | null;
}

/** Hesap şu an silinebilir mi (açık sipariş/ders var mı)? */
export async function checkDeletionEligibility(): Promise<DeletionEligibility> {
  const { data } = await apiClient.get<DeletionEligibility>(
    "/auth/me/deletion-eligibility"
  );
  return data;
}

/**
 * Hesabı anonimleştirip kapatır — GERİ ALINAMAZ.
 *
 * İki kanıt kolu var ve hangisinin geçerli olduğunu HESABIN DURUMU belirler:
 * parolalı hesap parolasıyla, parolasız (Google ile açılmış) hesap e-postasına
 * gönderilen tek kullanımlık bağlantıyla onaylar. İkinci kol olmasaydı Google
 * ile açılan hesap KVKK silme hakkını hiç kullanamazdı.
 */
export async function deleteMyAccount(
  kanit: { password: string } | { token: string }
): Promise<void> {
  await apiClient.post("/auth/me/delete", kanit);
}

/** Parolasız hesap için silme onay bağlantısı ister. */
export async function requestAccountDeletion(): Promise<{ detail: string }> {
  const { data } = await apiClient.post<{ detail: string }>("/auth/me/delete/request");
  return data;
}
