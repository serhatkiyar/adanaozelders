import { FormEvent, useEffect, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useCards,
  useCreateCard,
  useDecks,
  useDeleteCard,
  useReviewCard,
  useStudyCards,
  useUpdateCard,
} from "@/hooks/useFlashcards";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { formatDue, previewLabel } from "@/lib/srs";
import { ROLE_IDS, type Flashcard, type ReviewRating } from "@/types";
import { ROUTES } from "@/lib/routes";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500";

/* ─── Kart ekleme/düzenleme formu ─────────────────────── */
function CardForm({
  initial,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Flashcard;
  pending: boolean;
  submitLabel: string;
  onSubmit: (front: string, back: string) => void;
  onCancel?: () => void;
}) {
  const [front, setFront] = useState(initial?.front ?? "");
  const [back, setBack] = useState(initial?.back ?? "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!front.trim() || !back.trim()) {
      toast.error("Ön ve arka yüz boş olamaz.");
      return;
    }
    onSubmit(front.trim(), back.trim());
    if (!initial) {
      setFront("");
      setBack("");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ön yüz (soru)" labelClassName="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">
          {(id) => (
              <textarea
                    id={id} rows={2} maxLength={2000} value={front} onChange={(e) => setFront(e.target.value)} placeholder="apple" className={inputCls} autoFocus={!initial} />
          )}
        </Field>
        <Field label="Arka yüz (cevap)" labelClassName="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">
          {(id) => (
              <textarea
                    id={id} rows={2} maxLength={2000} value={back} onChange={(e) => setBack(e.target.value)} placeholder="elma" className={inputCls} />
          )}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
            İptal
          </button>
        )}
        <button type="submit" disabled={pending} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
          {pending ? "Kaydediliyor…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

/* ─── Kart satırı (listede) ───────────────────────────── */
function CardRow({ deckId, card }: { deckId: number; card: Flashcard }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateCard(deckId);
  const del = useDeleteCard(deckId);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <CardForm
        initial={card}
        pending={update.isPending}
        submitLabel="Güncelle"
        onCancel={() => setEditing(false)}
        onSubmit={(front, back) =>
          update.mutate(
            { id: card.id, payload: { front, back } },
            {
              onSuccess: () => {
                toast.success("Kart güncellendi.");
                setEditing(false);
              },
              onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
            }
          )
        }
      />
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2">
        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{card.front}</p>
        <p className="truncate text-sm text-slate-500 dark:text-slate-400">{card.back}</p>
      </div>
      {(() => {
        const d = formatDue(card.due_at);
        return (
          <span
            className={`mt-0.5 hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-block ${
              d.due
                ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
                : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
            }`}
            title="Bir sonraki tekrar"
          >
            {d.label}
          </span>
        );
      })()}
      <div className="flex shrink-0 items-center gap-1">
        {confirming ? (
          <>
            <button
              onClick={() =>
                del.mutate(card.id, {
                  onSuccess: () => toast.success("Kart silindi."),
                  onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")),
                })
              }
              className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Sil
            </button>
            <button onClick={() => setConfirming(false)} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
              Vazgeç
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30">
              Düzenle
            </button>
            <button onClick={() => setConfirming(true)} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-700">
              Sil
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Çalışma (Anki/SRS review) ───────────────────────── */
const RATING_BTNS: { rating: ReviewRating; label: string; cls: string }[] = [
  { rating: "again", label: "Tekrar", cls: "bg-rose-600 hover:bg-rose-700" },
  { rating: "hard", label: "Zor", cls: "bg-amber-500 hover:bg-amber-600" },
  { rating: "good", label: "İyi", cls: "bg-indigo-600 hover:bg-indigo-700" },
  { rating: "easy", label: "Kolay", cls: "bg-emerald-600 hover:bg-emerald-700" },
];

function StudySession({ deckId, onExit }: { deckId: number; onExit: () => void }) {
  const { data: studyCards, isLoading } = useStudyCards(deckId, true);
  const review = useReviewCard(deckId);
  const [queue, setQueue] = useState<Flashcard[] | null>(null);
  const [showBack, setShowBack] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (studyCards && queue === null) setQueue(studyCards);
  }, [studyCards, queue]);

  if (isLoading || queue === null) {
    return <div className="py-20 text-center text-sm text-slate-400">Yükleniyor…</div>;
  }

  const current = queue[0];

  // Bitiş ekranı
  if (!current) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-100 bg-white py-16 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="text-4xl">🎉</div>
        <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">
          {done > 0 ? "Bugünlük bitti!" : "Tekrar bekleyen kart yok"}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {done > 0 ? `${done} kart tekrar ettin.` : "Yeni kart ekleyebilir veya yarın geri dönebilirsin."}
        </p>
        <button onClick={onExit} className="mt-6 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700">
          Desteye dön
        </button>
      </div>
    );
  }

  const rate = (rating: ReviewRating) => {
    review.mutate({ id: current.id, rating });
    setQueue((prev) => {
      if (!prev) return prev;
      const rest = prev.slice(1);
      // "Tekrar" dersek kart bu seans içinde tekrar görünür (sona eklenir).
      return rating === "again" ? [...rest, current] : rest;
    });
    if (rating !== "again") setDone((d) => d + 1);
    setShowBack(false);
  };

  const remaining = queue.length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onExit} className="text-sm font-medium text-slate-500 transition hover:text-slate-700 dark:text-slate-400">
          ← Çık
        </button>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          Kalan: {remaining}
        </span>
      </div>

      {/* Kart */}
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <p className="text-2xl font-bold text-slate-900 dark:text-white whitespace-pre-line">
          {current.front}
        </p>
        {showBack && (
          <>
            <div className="my-5 h-px w-24 bg-slate-200 dark:bg-slate-600" />
            <p className="text-xl text-slate-600 dark:text-slate-300 whitespace-pre-line animate-in fade-in duration-200">
              {current.back}
            </p>
          </>
        )}
      </div>

      {/* Aksiyonlar */}
      <div className="mt-5">
        {!showBack ? (
          <button
            onClick={() => setShowBack(true)}
            className="w-full rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            Cevabı Göster
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {RATING_BTNS.map((b) => (
              <button
                key={b.rating}
                onClick={() => rate(b.rating)}
                disabled={review.isPending}
                className={`rounded-xl px-2 py-2.5 text-white transition active:scale-95 disabled:opacity-60 ${b.cls}`}
              >
                <span className="block text-sm font-bold">{b.label}</span>
                <span className="mt-0.5 block text-[11px] font-medium text-white/80">
                  {previewLabel(current, b.rating)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sayfa ────────────────────────────────────────────── */
export default function FlashcardDeck() {
  const { id } = useParams();
  const deckId = Number(id);
  const [searchParams] = useSearchParams();
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : STUDENT_NAV;

  const { data: decks } = useDecks();
  const deck = decks?.find((d) => d.id === deckId);
  const deckName = deck?.name ?? "Deste";

  const { data: cards, isLoading } = useCards(deckId);
  const createCard = useCreateCard(deckId);
  const [studying, setStudying] = useState(searchParams.get("study") === "1");

  return (
    <DashboardShell title={deckName} navItems={navItems}>
      <div className="mx-auto max-w-3xl">
        {studying ? (
          <StudySession deckId={deckId} onExit={() => setStudying(false)} />
        ) : (
          <>
            <div className="mb-5 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <Link to={ROUTES.flashcards} className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400">
                  ← Kelime Kartları
                </Link>
                <h1 className="mt-1 truncate text-2xl font-bold text-slate-900 dark:text-white">{deckName}</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {deck?.card_count ?? cards?.length ?? 0} kart
                  {deck && deck.due_count > 0 ? ` · ${deck.due_count} tekrar bekliyor` : ""}
                </p>
              </div>
              <button
                onClick={() => setStudying(true)}
                className="shrink-0 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
              >
                Çalış
              </button>
            </div>

            <div className="mb-5">
              <CardForm
                pending={createCard.isPending}
                submitLabel="Kart Ekle"
                onSubmit={(front, back) =>
                  createCard.mutate(
                    { front, back },
                    {
                      onSuccess: () => toast.success("Kart eklendi."),
                      onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")),
                    }
                  )
                }
              />
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : !cards || cards.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
                Henüz kart yok. Yukarıdan ilk kartını ekle.
              </p>
            ) : (
              <div className="space-y-2">
                {cards.map((c) => (
                  <CardRow key={c.id} deckId={deckId} card={c} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </DashboardShell>
  );
}
