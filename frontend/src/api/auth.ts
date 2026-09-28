import { apiClient } from "@/api/axios";
import type {
  RegisterRequest,
  Token,
  TutorOut,
  UserOut,
  UserStats,
} from "@/types";

export type RegisterRole = "tutor" | "client";

// Yoldaki çıkış isteği. Giriş bunu bekler: çıkış yanıtı yeni girişten SONRA
// gelirse sunucunun çerez silme başlığı yeni oturumun refresh çerezini de
// siler (yavaş ağda çıkıp hemen başka hesapla girerken ölçüldü, 28 Eyl 2026).
let bekleyenCikis: Promise<unknown> | null = null;

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

  if (bekleyenCikis) await bekleyenCikis.catch(() => {});
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
  const istek = apiClient.post("/auth/logout");
  bekleyenCikis = istek;
  try {
    await istek;
  } finally {
    if (bekleyenCikis === istek) bekleyenCikis = null;
  }
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


// ── Google ile giriş ─────────────────────────────────────────────────────────

export type OAuthMod = "giris" | "kayit";

/**
 * Google akışını başlatan TAM SAYFA adresi. Axios ile ÇAĞRILMAZ.
 *
 * `kok` SUNUCUDAN gelir (`/auth/oauth/providers` → `google_start_url`) ve
 * MUTLAKTIR. Bu zorunlu, ölçülmüş bir kusurun düzeltmesi: önce göreli adres
 * (`/api/v1/...`) üretiliyordu ve geliştirmede tarayıcı oraya Vite dev
 * sunucusu üzerinden gidiyordu; Vite proxy'si dış bir siteye
 * (accounts.google.com) giden 303'ü iletemeyip **500** veriyordu. Akış bir XHR
 * değil, tam sayfa gezinmedir — proxy'ye hiç uğramamalı.
 *
 * Google'ın tarayıcı kütüphanesi (GSI) bilerek kullanılmıyor: o script sayfa
 * açılır açılmaz Google'a istek atar, yani kullanıcı hiçbir onay vermeden
 * üçüncü tarafa veri gider (KVKK) ve CSP'deki `script-src 'self'` delinirdi.
 */
export function oauthStartUrl(
  kok: string,
  secenekler: {
    mod: OAuthMod;
    rol?: RegisterRole;
    donus?: string;
    onaySurumu?: string;
    hatirla?: boolean;
  }
): string {
  const q = new URLSearchParams({ mod: secenekler.mod });
  if (secenekler.rol) q.set("rol", secenekler.rol);
  if (secenekler.donus) q.set("donus", secenekler.donus);
  if (secenekler.onaySurumu) q.set("onay_surumu", secenekler.onaySurumu);
  q.set("hatirla", secenekler.hatirla === false ? "false" : "true");
  return `${kok}?${q.toString()}`;
}

/**
 * Access token'ı refresh çerezinden alır.
 *
 * Google callback'i access token ÜRETMEZ ve URL'de taşımaz (tarayıcı geçmişine,
 * `Referer`a ve ara sunucu loglarına yazılırdı); yalnız refresh çerezini yazar.
 * Dönüş sayfası oturumu buradan tamamlar. `axios.ts` içindeki 401 interceptor'ı
 * DEĞİŞMEZ; bu onun paralel bir kopyası değil, açık bir çağrıdır.
 */
export async function refreshSession(): Promise<Token> {
  const { data } = await apiClient.post<Token>("/auth/refresh", null, {
    withCredentials: true,
  });
  return data;
}

export interface OAuthSaglayicilari {
  google: boolean;
  /** Akışın başlatılacağı MUTLAK adres; kapalıyken `null`. */
  google_start_url: string | null;
}

export async function fetchOAuthProviders(): Promise<OAuthSaglayicilari> {
  const { data } = await apiClient.get<OAuthSaglayicilari>("/auth/oauth/providers");
  return data;
}
