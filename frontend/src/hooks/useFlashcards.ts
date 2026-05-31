import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCard,
  createDeck,
  deleteCard,
  deleteDeck,
  fetchCards,
  fetchDecks,
  fetchStudyCards,
  reviewCard,
  updateCard,
  updateDeck,
} from "@/api/flashcards";
import { useAuthStore } from "@/store/authStore";
import type { CardCreate, DeckCreate, ReviewRating } from "@/types";

const DECKS_KEY = ["flashcards", "decks"] as const;
const cardsKey = (deckId: number) => ["flashcards", "cards", deckId] as const;

export function useDecks() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: DECKS_KEY,
    queryFn: fetchDecks,
    enabled: !!token,
  });
}

export function useCards(deckId: number) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: cardsKey(deckId),
    queryFn: () => fetchCards(deckId),
    enabled: !!token && Number.isFinite(deckId) && deckId > 0,
  });
}

export function useCreateDeck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: DeckCreate) => createDeck(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: DECKS_KEY }),
  });
}

export function useUpdateDeck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<DeckCreate> }) =>
      updateDeck(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: DECKS_KEY }),
  });
}

export function useDeleteDeck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteDeck(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: DECKS_KEY }),
  });
}

export function useCreateCard(deckId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CardCreate) => createCard(deckId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cardsKey(deckId) });
      qc.invalidateQueries({ queryKey: DECKS_KEY });
    },
  });
}

export function useUpdateCard(deckId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CardCreate> }) =>
      updateCard(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: cardsKey(deckId) }),
  });
}

export function useDeleteCard(deckId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCard(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cardsKey(deckId) });
      qc.invalidateQueries({ queryKey: DECKS_KEY });
    },
  });
}

export function useStudyCards(deckId: number, enabled: boolean) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["flashcards", "study", deckId],
    queryFn: () => fetchStudyCards(deckId),
    enabled: !!token && enabled && Number.isFinite(deckId) && deckId > 0,
    // Çalışma başında bir kez al; tekrarlar lokal state'ten ilerler.
    staleTime: Infinity,
  });
}

export function useReviewCard(deckId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: ReviewRating }) =>
      reviewCard(id, rating),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DECKS_KEY });
      qc.invalidateQueries({ queryKey: cardsKey(deckId) });
    },
  });
}
