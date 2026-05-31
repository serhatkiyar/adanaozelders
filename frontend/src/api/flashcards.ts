import { apiClient } from "@/api/axios";
import type {
  CardCreate,
  DeckCreate,
  Flashcard,
  FlashcardDeck,
  ReviewRating,
} from "@/types";

export async function fetchDecks(): Promise<FlashcardDeck[]> {
  const { data } = await apiClient.get<FlashcardDeck[]>("/flashcards/decks");
  return data;
}

export async function createDeck(payload: DeckCreate): Promise<FlashcardDeck> {
  const { data } = await apiClient.post<FlashcardDeck>("/flashcards/decks", payload);
  return data;
}

export async function updateDeck(
  id: number,
  payload: Partial<DeckCreate>
): Promise<FlashcardDeck> {
  const { data } = await apiClient.patch<FlashcardDeck>(
    `/flashcards/decks/${id}`,
    payload
  );
  return data;
}

export async function deleteDeck(id: number): Promise<void> {
  await apiClient.delete(`/flashcards/decks/${id}`);
}

export async function fetchCards(deckId: number): Promise<Flashcard[]> {
  const { data } = await apiClient.get<Flashcard[]>(
    `/flashcards/decks/${deckId}/cards`
  );
  return data;
}

export async function createCard(
  deckId: number,
  payload: CardCreate
): Promise<Flashcard> {
  const { data } = await apiClient.post<Flashcard>(
    `/flashcards/decks/${deckId}/cards`,
    payload
  );
  return data;
}

export async function updateCard(
  id: number,
  payload: Partial<CardCreate>
): Promise<Flashcard> {
  const { data } = await apiClient.patch<Flashcard>(`/flashcards/cards/${id}`, payload);
  return data;
}

export async function deleteCard(id: number): Promise<void> {
  await apiClient.delete(`/flashcards/cards/${id}`);
}

export async function fetchStudyCards(deckId: number): Promise<Flashcard[]> {
  const { data } = await apiClient.get<Flashcard[]>(
    `/flashcards/decks/${deckId}/study`
  );
  return data;
}

export async function reviewCard(
  id: number,
  rating: ReviewRating
): Promise<Flashcard> {
  const { data } = await apiClient.post<Flashcard>(`/flashcards/cards/${id}/review`, {
    rating,
  });
  return data;
}
