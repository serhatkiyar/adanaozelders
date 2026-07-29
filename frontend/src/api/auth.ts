import { apiClient } from "@/api/axios";
import type {
  RegisterRequest,
  Token,
  TutorOut,
  UserOut,
  UserStats,
} from "@/types";

export type RegisterRole = "tutor" | "client";

export async function login(
  username: string,
  password: string,
  remember = true
): Promise<Token> {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);
  // "Beni hatırla" sunucuya gider: refresh token çerezinin kalıcı mı yoksa
  // oturumluk mu olacağını belirler. Bu tercih istemcide tutulamaz — çerezi
  // yazan taraf sunucudur.
  body.append("remember", remember ? "true" : "false");

  const { data } = await apiClient.post<Token>("/auth/login", body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return data;
}

export async function register(
  role: RegisterRole,
  payload: RegisterRequest
): Promise<UserOut | TutorOut> {
  const { data } = await apiClient.post<UserOut | TutorOut>(
    `/auth/register/${role}`,
    payload
  );
  return data;
}

export async function logout(): Promise<void> {
  // Sunucu tarafında access token'ı (denylist) ve refresh token'ı iptal eder,
  // ayrıca çerezi siler. Refresh token gövdede GÖNDERİLMEZ — sunucu onu
  // `httpOnly` çerezden okur. Hata olsa da akış bozulmamalı.
  await apiClient.post("/auth/logout");
}

export async function fetchMe(): Promise<UserOut> {
  const { data } = await apiClient.get<UserOut>("/auth/me");
  return data;
}

export async function fetchMyStats(): Promise<UserStats> {
  const { data } = await apiClient.get<UserStats>("/auth/me/stats");
  return data;
}

interface MessageResponse {
  detail: string;
}

// --- E-posta doğrulama & şifre sıfırlama (self-service) ---

export async function confirmEmailVerification(
  token: string
): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>(
    "/auth/verify-email/confirm",
    { token }
  );
  return data;
}

export async function resendEmailVerification(): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>(
    "/auth/verify-email/resend"
  );
  return data;
}

export async function requestPasswordReset(
  email: string
): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>(
    "/auth/password-reset/request",
    { email }
  );
  return data;
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string
): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>(
    "/auth/password-reset/confirm",
    { token, new_password: newPassword }
  );
  return data;
}
