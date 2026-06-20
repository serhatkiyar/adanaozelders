import { apiClient } from "@/api/axios";
import type {
  NameChangeRequest,
  PasswordChange,
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

export async function changePassword(payload: PasswordChange): Promise<void> {
  await apiClient.post("/auth/me/password", payload);
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
