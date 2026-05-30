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
  password: string
): Promise<Token> {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);

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

export async function fetchMe(): Promise<UserOut> {
  const { data } = await apiClient.get<UserOut>("/auth/me");
  return data;
}

export async function fetchMyStats(): Promise<UserStats> {
  const { data } = await apiClient.get<UserStats>("/auth/me/stats");
  return data;
}
