import { apiClient } from "./axios";
import type {
  FailedOutboxEvent,
  OutboxRetryResult,
  StuckEscrowRecord,
} from "@/types";

/** Otomatiğin çözemediği para kayıtları (salt okunur teşhis). */
export async function fetchStuckEscrow(): Promise<StuckEscrowRecord[]> {
  const { data } = await apiClient.get<StuckEscrowRecord[]>("/admin/escrow/stuck");
  return data;
}

/** Outbox dead-letter kuyruğu. Yanıt ham `payload` İÇERMEZ (KVKK). */
export async function fetchFailedOutbox(): Promise<FailedOutboxEvent[]> {
  const { data } = await apiClient.get<FailedOutboxEvent[]>("/admin/outbox/failed");
  return data;
}

/** Ölü işi yeniden kuyruğa alır (idempotent; `requeued=false` = zaten alınmış). */
export async function retryOutboxEvent(id: number): Promise<OutboxRetryResult> {
  const { data } = await apiClient.post<OutboxRetryResult>(
    `/admin/outbox/${id}/retry`
  );
  return data;
}
