import { apiClient } from "@/api/axios";
import type { PasswordChange, UserOut, UserUpdate } from "@/types";

export async function updateMe(payload: UserUpdate): Promise<UserOut> {
  const { data } = await apiClient.patch<UserOut>("/auth/me", payload);
  return data;
}

export async function changePassword(payload: PasswordChange): Promise<void> {
  await apiClient.post("/auth/me/password", payload);
}
