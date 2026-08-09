import { apiClient } from "@/api/axios";
import type {
  SrsAnswerPayload,
  SrsAnswerResult,
  SrsAssignment,
  SrsBulkPayload,
  SrsBulkResult,
  SrsCardList,
  SrsCardListParams,
  SrsDeck,
  SrsDeckCreate,
  SrsDeckList,
  SrsDeckUpdate,
  SrsNote,
  SrsNoteCreate,
  SrsNoteUpdate,
  SrsQueue,
  SrsStats,
  SrsTag,
  SrsUndoResult,
} from "@/types/srs";

// ── Desteler ──

export async function fetchSrsDecks(): Promise<SrsDeckList> {
  const { data } = await apiClient.get<SrsDeckList>("/srs/decks");
  return data;
}

export async function createSrsDeck(payload: SrsDeckCreate): Promise<SrsDeck> {
  const { data } = await apiClient.post<SrsDeck>("/srs/decks", payload);
  return data;
}

export async function updateSrsDeck(
  id: number,
  payload: SrsDeckUpdate
): Promise<SrsDeck> {
  const { data } = await apiClient.patch<SrsDeck>(`/srs/decks/${id}`, payload);
  return data;
}

export async function deleteSrsDeck(id: number): Promise<void> {
  await apiClient.delete(`/srs/decks/${id}`);
}

export async function fetchSrsPlatformDecks(): Promise<SrsDeck[]> {
  const { data } = await apiClient.get<{ items: SrsDeck[] }>(
    "/srs/decks/platform"
  );
  return data.items;
}

export async function copySrsDeck(id: number): Promise<SrsDeck> {
  const { data } = await apiClient.post<SrsDeck>(`/srs/decks/${id}/copy`);
  return data;
}

// ── Atama (TUTOR) ──

export async function assignSrsDeck(
  deckId: number,
  clientId: number
): Promise<void> {
  await apiClient.post(`/srs/decks/${deckId}/assign`, { client_id: clientId });
}

export async function unassignSrsDeck(
  deckId: number,
  clientId: number
): Promise<void> {
  await apiClient.delete(`/srs/decks/${deckId}/assign/${clientId}`);
}

export async function fetchSrsAssignments(
  deckId: number
): Promise<SrsAssignment[]> {
  const { data } = await apiClient.get<{ items: SrsAssignment[] }>(
    `/srs/decks/${deckId}/assignments`
  );
  return data.items;
}

// ── Notlar ──

export async function createSrsNote(
  deckId: number,
  payload: SrsNoteCreate
): Promise<SrsNote> {
  const { data } = await apiClient.post<SrsNote>(
    `/srs/decks/${deckId}/notes`,
    payload
  );
  return data;
}

export async function updateSrsNote(
  id: number,
  payload: SrsNoteUpdate
): Promise<SrsNote> {
  const { data } = await apiClient.patch<SrsNote>(`/srs/notes/${id}`, payload);
  return data;
}

export async function deleteSrsNote(id: number): Promise<void> {
  await apiClient.delete(`/srs/notes/${id}`);
}

// ── Kart tarayıcısı ──

export async function fetchSrsCards(
  params: SrsCardListParams
): Promise<SrsCardList> {
  const { data } = await apiClient.get<SrsCardList>("/srs/cards", { params });
  return data;
}

export async function bulkSrsCards(
  payload: SrsBulkPayload
): Promise<SrsBulkResult> {
  const { data } = await apiClient.post<SrsBulkResult>(
    "/srs/cards/bulk",
    payload
  );
  return data;
}

// ── Çalışma ──

export async function fetchSrsQueue(deckId: number): Promise<SrsQueue> {
  const { data } = await apiClient.get<SrsQueue>("/srs/study/queue", {
    params: { deck_id: deckId },
  });
  return data;
}

export async function answerSrsCard(
  payload: SrsAnswerPayload
): Promise<SrsAnswerResult> {
  const { data } = await apiClient.post<SrsAnswerResult>(
    "/srs/study/answer",
    payload
  );
  return data;
}

export async function undoSrsAnswer(): Promise<SrsUndoResult> {
  const { data } = await apiClient.post<SrsUndoResult>("/srs/study/undo", {});
  return data;
}

// ── Etiketler & istatistik ──

export async function fetchSrsTags(): Promise<SrsTag[]> {
  const { data } = await apiClient.get<{ items: SrsTag[] }>("/srs/tags");
  return data.items;
}

export async function fetchSrsStats(deckId?: number): Promise<SrsStats> {
  const { data } = await apiClient.get<SrsStats>("/srs/stats", {
    params: deckId != null ? { deck_id: deckId } : undefined,
  });
  return data;
}
