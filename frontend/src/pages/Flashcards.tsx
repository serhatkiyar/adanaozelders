import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCreateDeck, useDecks, useDeleteDeck } from "@/hooks/useFlashcards";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROLE_IDS, type FlashcardDeck } from "@/types";
import { ROUTES } from "@/lib/routes";

function CreateDeckModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createDeck = useCreateDeck();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Deste adı boş olamaz.");
      return;
    }
    createDeck.mutate(
      { name: name.trim(), description: description.trim() || null },
      {
        onSuccess: () => {
          toast.success("Deste oluşturuldu.");
          onClose();
        },
        onError: (err) => toast.error(getErrorMessage(err, "Oluşturulamadı.")),
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 dark:bg-slate-900 dark:ring-slate-800 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Yeni Deste</h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <Field label="Deste adı *" required labelClassName="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">
            {(id) => (
                <input
                    id={id}
                  autoFocus
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn. YDS Kelimeler"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                />
            )}
          </Field>
          <Field label="Açıklama (opsiyonel)" labelClassName="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">
            {(id) => (
                <textarea
                    id={id}
                  rows={2}
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
              İptal
            </button>
            <button
              type="submit"
              disabled={createDeck.isPending}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {createDeck.isPending ? "Oluşturuluyor…" : "Oluştur"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeckCard({ deck }: { deck: FlashcardDeck }) {
  const deleteDeck = useDeleteDeck();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="group relative flex flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:border-indigo-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-500/40">
      <Link to={ROUTES.flashcardDeck(deck.id)} className="flex-1">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{deck.name}</h3>
        {deck.description && (
          <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
            {deck.description}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {deck.card_count} kart
          </span>
          {deck.due_count > 0 && (
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
              {deck.due_count} tekrar
            </span>
          )}
        </div>
      </Link>

      <div className="mt-4 flex items-center gap-2">
        <Link
          to={`${ROUTES.flashcardDeck(deck.id)}?study=1`}
          className={`flex-1 rounded-xl px-3 py-2 text-center text-sm font-semibold transition ${
            deck.due_count > 0
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          }`}
        >
          {deck.due_count > 0 ? `Çalış (${deck.due_count})` : "Çalış"}
        </Link>
        {confirming ? (
          <>
            <button
              onClick={() =>
                deleteDeck.mutate(deck.id, {
                  onSuccess: () => toast.success("Deste silindi."),
                  onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")),
                })
              }
              disabled={deleteDeck.isPending}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Sil
            </button>
            <button onClick={() => setConfirming(false)} className="rounded-xl px-2 py-2 text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
              Vazgeç
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            aria-label="Desteyi sil"
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-700"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export default function Flashcards() {
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : STUDENT_NAV;
  const { data: decks, isLoading } = useDecks();
  const [creating, setCreating] = useState(false);

  return (
    <DashboardShell title="Kelime Kartları" navItems={navItems}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <Link to={ROUTES.learn} className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400">
              ← Öğren
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
              Kelime Kartları
            </h1>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Yeni Deste
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : !decks || decks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center dark:border-slate-700">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-2xl dark:bg-indigo-500/15">🃏</div>
            <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
              Henüz desten yok
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              İlk desteni oluştur, kartları ekle ve aralıklı tekrarla kalıcı öğren.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Deste Oluştur
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {decks.map((d) => (
              <DeckCard key={d.id} deck={d} />
            ))}
          </div>
        )}
      </div>

      {creating && <CreateDeckModal onClose={() => setCreating(false)} />}
    </DashboardShell>
  );
}
