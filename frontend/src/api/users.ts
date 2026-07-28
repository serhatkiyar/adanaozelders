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

// Telefon doğrulama: numara kaydet + SMS OTP iste (maskeli numara döner).
export async function requestPhoneOtp(
  phone: string
): Promise<{ phone_masked: string }> {
  const { data } = await apiClient.post<{ phone_masked: string }>(
    "/auth/me/phone",
    { phone }
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

/** Hesabı anonimleştirip kapatır — GERİ ALINAMAZ. Parola doğrulaması ister. */
export async function deleteMyAccount(password: string): Promise<void> {
  await apiClient.post("/auth/me/delete", { password });
}
