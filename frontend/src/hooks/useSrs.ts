import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  answerSrsCard,
  assignSrsDeck,
  bulkSrsCards,
  copySrsDeck,
  createSrsDeck,
  createSrsNote,
  deleteSrsDeck,
  deleteSrsNote,
  fetchSrsAssignments,
  fetchSrsCards,
  fetchSrsDecks,
  fetchSrsPlatformDecks,
  fetchSrsQueue,
  fetchSrsStats,
  fetchSrsTags,
  undoSrsAnswer,
  unassignSrsDeck,
  updateSrsDeck,
  updateSrsNote,
} from "@/api/srs";
import { useAuthStore } from "@/store/authStore";
import type {
  SrsAnswerPayload,
  SrsBulkPayload,
  SrsCardListParams,
  SrsDeckCreate,
  SrsDeckUpdate,
  SrsNoteCreate,
  SrsNoteUpdate,
} from "@/types/srs";

// ── Sorgular ──

export function useSrsDecks() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["srs", "decks"],
    queryFn: fetchSrsDecks,
    enabled: !!token,
  });
}

export function useSrsPlatformDecks() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["srs", "platform-decks"],
    queryFn: fetchSrsPlatformDecks,
    enabled: !!token,
  });
}

export function useSrsAssignments(deckId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["srs", "assignments", deckId],
    queryFn: () => fetchSrsAssignments(deckId),
    enabled,
  });
}

export function useSrsCards(params: SrsCardListParams) {
  return useQuery({
    queryKey: ["srs", "cards", params],
    queryFn: () => fetchSrsCards(params),
    placeholderData: (prev) => prev,
  });
}

export function useSrsQueue(deckId: number) {
  return useQuery({
    queryKey: ["srs", "queue", deckId],
    queryFn: () => fetchSrsQueue(deckId),
    // Çalışma ekranı: bayat kuyruk kartı ikinci kez cevaplatmasın.
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useSrsTags() {
  return useQuery({ queryKey: ["srs", "tags"], queryFn: fetchSrsTags });
}

export function useSrsStats(deckId?: number) {
  return useQuery({
    queryKey: ["srs", "stats", deckId ?? "all"],
    queryFn: () => fetchSrsStats(deckId),
  });
}

// ── Mutasyonlar ──

function useInvalidateSrs() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["srs"] });
}

export function useCreateSrsDeck() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: (payload: SrsDeckCreate) => createSrsDeck(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateSrsDeck() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SrsDeckUpdate }) =>
      updateSrsDeck(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteSrsDeck() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: (id: number) => deleteSrsDeck(id),
    onSuccess: invalidate,
  });
}

export function useCopySrsDeck() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: (id: number) => copySrsDeck(id),
    onSuccess: invalidate,
  });
}

export function useAssignSrsDeck() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: ({ deckId, clientId }: { deckId: number; clientId: number }) =>
      assignSrsDeck(deckId, clientId),
    onSuccess: invalidate,
  });
}

export function useUnassignSrsDeck() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: ({ deckId, clientId }: { deckId: number; clientId: number }) =>
      unassignSrsDeck(deckId, clientId),
    onSuccess: invalidate,
  });
}

export function useCreateSrsNote() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: ({
      deckId,
      payload,
    }: {
      deckId: number;
      payload: SrsNoteCreate;
    }) => createSrsNote(deckId, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateSrsNote() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SrsNoteUpdate }) =>
      updateSrsNote(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteSrsNote() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: (id: number) => deleteSrsNote(id),
    onSuccess: invalidate,
  });
}

export function useBulkSrsCards() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: (payload: SrsBulkPayload) => bulkSrsCards(payload),
    onSuccess: invalidate,
  });
}

export function useAnswerSrsCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SrsAnswerPayload) => answerSrsCard(payload),
    onSuccess: () => {
      // Kuyruk yeni kartı getirir; deste sayaçları da tazelensin.
      qc.invalidateQueries({ queryKey: ["srs", "queue"] });
      qc.invalidateQueries({ queryKey: ["srs", "decks"] });
      qc.invalidateQueries({ queryKey: ["srs", "stats"] });
    },
  });
}

export function useUndoSrsAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => undoSrsAnswer(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["srs", "queue"] });
      qc.invalidateQueries({ queryKey: ["srs", "decks"] });
      qc.invalidateQueries({ queryKey: ["srs", "stats"] });
    },
  });
}
