import { apiClient } from "@/api/axios";

export interface ContactRequest {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export interface ContactResponse {
  detail: string;
}

/**
 * İletişim formu — oturum gerektirmez.
 * Sunucu mesajı outbox'a yazar (SMTP anlık erişilemezse kaybolmaz) ve 202 döner.
 */
export async function submitContact(
  payload: ContactRequest
): Promise<ContactResponse> {
  const { data } = await apiClient.post<ContactResponse>(
    "/support/contact",
    payload
  );
  return data;
}
