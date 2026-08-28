import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { Field } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui/PageState";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useBookings } from "@/hooks/useBookings";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useAssignSrsDeck,
  useCreateSrsNote,
  useDeleteSrsDeck,
  useDeleteSrsNote,
  useSrsAssignments,
  useSrsCards,
  useSrsDecks,
  useUnassignSrsDeck,
  useUpdateSrsDeck,
  useUpdateSrsNote,
} from "@/hooks/useSrs";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROLE_IDS } from "@/types";
import type { SrsCard, SrsNoteType } from "@/types/srs";
import { ROUTES } from "@/lib/routes";

// Yerel `inputCls` SİLİNDİ: `focus:ring-indigo-100`'de bitiyordu (dark
// karşılığı yok → koyu temada odaklanan girdi beyaz hale alıyordu) ve
// `dark:bg-slate-700` ile ekrandaki diğer girdilerin `dark:bg-slate-800`
// zeminini bölüyordu. Artık ortak `.input` (index.css) kullanılır.
const labelCls =
  "mb-1.5 block text-xs font-medium text-slate-500 ";

const NOTE_TYPE_LABELS: Record<SrsNoteType, string> = {
  BASIC: "Temel (ön → arka)",
  BASIC_REVERSED: "Temel + ters (iki kart)",
  CLOZE: "Boşluk doldurma (cloze)",
  TYPE_IN: "Yazarak cevaplama",
};

const NOTE_TYPE_HELP: Partial<Record<SrsNoteType, string>> = {
  BASIC_REVERSED:
    "İki kart üretilir: ön→arka ve arka→ön. Her kartın ilerlemesi bağımsızdır.",
  CLOZE:
    "Ön yüzde {{c1::cevap}} ya da {{c1::cevap::ipucu}} yaz. Her farklı numara (c1, c2…) ayrı kart olur; arka yüz opsiyonel ekstra bilgidir.",
  TYPE_IN:
    "Çalışırken cevap yazılır ve arka yüz metniyle karşılaştırılır (Türkçe harf duyarsız).",
};

interface NoteGroup {
  note_id: number;
  note_type: SrsNoteType;
  front: string;
  back: string;
  tags: string[];
  cards: SrsCard[];
}

function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    ),
  ];
}

function NoteForm({
  initial,
  onSubmit,
  onCancel,
  pending,
}: {
  initial?: NoteGroup;
  onSubmit: (payload: {
    note_type: SrsNoteType;
    front: string;
    back: string;
    tags: string[];
  }) => void;
  onCancel?: () => void;
  pending: boolean;
}) {
  const [noteType, setNoteType] = useState<SrsNoteType>(
    initial?.note_type ?? "BASIC"
  );
  const [front, setFront] = useState(initial?.front ?? "");
  const [back, setBack] = useState(initial?.back ?? "");
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!front.trim()) {
      toast.error("Ön yüz boş olamaz.");
      return;
    }
    if (noteType !== "CLOZE" && !back.trim()) {
      toast.error("Arka yüz boş olamaz.");
      return;
    }
    onSubmit({
      note_type: noteType,
      front: front.trim(),
      back: back.trim(),
      tags: parseTags(tags),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {!initial && (
        <Field label="Kart tipi" labelClassName={labelCls}>
          {(id) => (
            <select
              id={id}
              value={noteType}
              onChange={(e) => setNoteType(e.target.value as SrsNoteType)}
              className="input"
            >
              {(Object.keys(NOTE_TYPE_LABELS) as SrsNoteType[]).map((t) => (
                <option key={t} value={t}>
                  {NOTE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {NOTE_TYPE_HELP[noteType] && (
        <p className="text-xs text-slate-500 ">
          {NOTE_TYPE_HELP[noteType]}
        </p>
      )}
      <Field label="Ön yüz *" required labelClassName={labelCls}>
        {(id) => (
          <textarea
            id={id}
            rows={2}
            value={front}
            onChange={(e) => setFront(e.target.value)}
            placeholder={
              noteType === "CLOZE"
                ? "Örn. {{c1::Mitokondri}} hücrenin enerji santralidir."
                : "Soru / kavram"
            }
            className="input"
          />
        )}
      </Field>
      <Field
        label={
          noteType === "CLOZE"
            ? "Ekstra bilgi (arka yüzde görünür, opsiyonel)"
            : noteType === "TYPE_IN"
              ? "Cevap (yazılanla karşılaştırılır) *"
              : "Arka yüz *"
        }
        required={noteType !== "CLOZE"}
        labelClassName={labelCls}
      >
        {(id) => (
          <textarea
            id={id}
            rows={2}
            value={back}
            onChange={(e) => setBack(e.target.value)}
            className="input"
          />
        )}
      </Field>
      <Field
        label="Etiketler (virgülle ayır)"
        labelClassName={labelCls}
      >
        {(id) => (
          <input
            id={id}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="biyoloji, hücre"
            className="input"
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 "
          >
            İptal
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Kaydediliyor…" : initial ? "Kaydet" : "Not Ekle"}
        </button>
      </div>
    </form>
  );
}

/**
 * Öğrenci seçici.
 *
 * NEDEN TYPEAHEAD: burada eskiden ham bir "Öğrenci no" alanı vardı — kullanıcı
 * dahili sayısal ID'yi hiçbir ekranda görmediği için alan pratikte
 * doldurulamıyordu.
 *
 * NEDEN ADAY KÜMESİ REZERVASYONLARDAN: `/clients/search` bilinçli olarak
 * yalnız `users.view` izinli ADMIN'e açıktır (bkz. `api/routers/clients.py`:
 * onaylı bir eğitmen bile bütün öğrenci tabanını sayfalayamaz), dolayısıyla
 * eğitmen yüzeyinde kullanılamaz. Zaten atamanın sunucu kuralı da "aranızda
 * rezervasyon bulunan öğrenci"dir; aday kümesi tam olarak eğitmenin kendi
 * rezervasyonlarındaki öğrenciler olur. Sorgu TutorDashboard'ın kullandığı
 * anahtarla (`{ limit: 100 }`) aynıdır, yani panelde çoğu zaman zaten
 * önbellektedir.
 *
 * BİLİNEN SINIR: uç en fazla 100 rezervasyon döndürür; 100'den fazla
 * rezervasyonu olan eğitmende çok eski bir öğrenci listede çıkmayabilir.
 */
function AssignmentSection({ deckId }: { deckId: number }) {
  const assignments = useSrsAssignments(deckId, true);
  const assign = useAssignSrsDeck();
  const unassign = useUnassignSrsDeck();
  const bookings = useBookings({ limit: 100 });

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();

  const assignedIds = useMemo(
    () => new Set((assignments.data ?? []).map((a) => a.client_id)),
    [assignments.data]
  );

  /** Rezervasyonlardaki benzersiz öğrenciler; zaten atanmışlar elenir. */
  const students = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of bookings.data ?? []) {
      if (assignedIds.has(b.client_id) || map.has(b.client_id)) continue;
      map.set(b.client_id, b.client_name?.trim() || `Öğrenci #${b.client_id}`);
    }
    return [...map]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [bookings.data, assignedIds]);

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr");
    const pool = needle
      ? students.filter((s) => s.name.toLocaleLowerCase("tr").includes(needle))
      : students;
    return pool.slice(0, 8);
  }, [students, query]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!picked) {
      toast.error("Listeden bir öğrenci seç.");
      return;
    }
    assign.mutate(
      { deckId, clientId: picked.id },
      {
        onSuccess: () => {
          toast.success("Deste öğrenciye atandı.");
          setPicked(null);
          setQuery("");
        },
        onError: (err) =>
          toast.error(
            getErrorMessage(
              err,
              "Atanamadı. Yalnız aranızda rezervasyon bulunan öğrencilere atayabilirsin."
            )
          ),
      }
    );
  };

  return (
    <section className="mt-10">
      <div className="border-b border-slate-200 pb-2 ">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 ">
          Öğrenci Atamaları
        </h2>
      </div>
      <p className="mt-2 text-xs text-slate-500 ">
        Desteyi, aranızda rezervasyon bulunan öğrencilere atayabilirsin.
        Öğrencilerin çalışma ilerlemesi sana gösterilmez.
      </p>
      <form onSubmit={add} className="mt-3 flex flex-wrap items-start gap-2">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // Ad değişince eski seçim geçersizdir; aksi halde ekranda başka
              // isim yazarken önceki öğrenciye atama yapılabilirdi.
              setPicked(null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            // Seçim `onMouseDown` engellendiği için blur'dan önce çalışır;
            // gecikme yalnız klavye/dokunmatik kapanışını yumuşatır.
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder="Öğrenci adı yaz…"
            aria-label="Öğrenci ara"
            className="input w-64"
          />
          {open && matches.length > 0 && (
            <div
              id={listId}
              role="listbox"
              aria-label="Öğrenci sonuçları"
              className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg "
            >
              {matches.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={picked?.id === s.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setPicked(s);
                    setQuery(s.name);
                    setOpen(false);
                  }}
                  className="block w-full truncate px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 "
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={assign.isPending || !picked}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          Ata
        </button>
      </form>
      {bookings.isError ? (
        <p className="mt-2 text-xs text-rose-600 ">
          Öğrenci listesi yüklenemedi:{" "}
          {getErrorMessage(bookings.error, "Bilinmeyen hata.")}
        </p>
      ) : !bookings.isLoading && students.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500 ">
          {(bookings.data ?? []).length === 0
            ? "Atama yapabilmen için önce bu öğrenciyle bir ders rezervasyonun olmalı."
            : "Ders ilişkin olan tüm öğrencilere bu desteyi zaten atadın."}
        </p>
      ) : null}
      {assignments.isLoading ? (
        <div className="mt-4">
          <PageSkeleton rows={1} />
        </div>
      ) : assignments.isError ? (
        <div className="mt-4">
          <ErrorState
            description={getErrorMessage(
              assignments.error,
              "Atamalar yüklenemedi."
            )}
            onRetry={() => assignments.refetch()}
          />
        </div>
      ) : (assignments.data ?? []).length === 0 ? (
        <p className="mt-4 text-sm text-slate-400 ">
          Henüz atama yok.
        </p>
      ) : (
        <div className="mt-2 divide-y divide-slate-100 ">
          {(assignments.data ?? []).map((a) => (
            <div key={a.client_id} className="flex items-center gap-3 py-2.5">
              <span className="flex-1 text-sm text-slate-700 ">
                {a.client_name || `Öğrenci #${a.client_id}`}
              </span>
              <button
                onClick={() =>
                  unassign.mutate(
                    { deckId, clientId: a.client_id },
                    {
                      onSuccess: () => toast.success("Atama kaldırıldı."),
                      onError: (err) =>
                        toast.error(getErrorMessage(err, "Kaldırılamadı.")),
                    }
                  )
                }
                disabled={unassign.isPending}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 "
              >
                Kaldır
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const STATE_LABELS: Record<string, string> = {
  NEW: "Yeni",
  LEARNING: "Öğrenme",
  REVIEW: "Tekrar",
  RELEARNING: "Yeniden",
};

export default function SrsDeckDetail() {
  const { id } = useParams<{ id: string }>();
  const deckId = Number(id);
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const isTutor = user?.role_id === ROLE_IDS.TUTOR;
  const navItems = isTutor ? TUTOR_NAV : STUDENT_NAV;

  const decksQuery = useSrsDecks();
  const deck =
    decksQuery.data?.own.find((d) => d.id === deckId) ??
    decksQuery.data?.assigned.find((d) => d.id === deckId);
  const isOwn = !!decksQuery.data?.own.some((d) => d.id === deckId);

  const cardsQuery = useSrsCards({ deck_id: deckId, page: 1, page_size: 200 });
  const createNote = useCreateSrsNote();
  const updateNote = useUpdateSrsNote();
  const deleteNote = useDeleteSrsNote();
  const updateDeck = useUpdateSrsDeck();
  const deleteDeck = useDeleteSrsDeck();

  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Not silme de geri alınamaz: notu, ondan türeyen kartları ve o kartların
  // FSRS geçmişini birlikte götürür. Deste silmeyle aynı sınıf, aynı kapı.
  const [confirmNote, setConfirmNote] = useState<{ id: number; front: string } | null>(
    null
  );
  const [newLimit, setNewLimit] = useState("");
  const [reviewLimit, setReviewLimit] = useState("");

  useEffect(() => {
    if (deck) {
      setNewLimit(deck.new_per_day == null ? "" : String(deck.new_per_day));
      setReviewLimit(
        deck.reviews_per_day == null ? "" : String(deck.reviews_per_day)
      );
    }
  }, [deck]);

  const notes = useMemo<NoteGroup[]>(() => {
    const map = new Map<number, NoteGroup>();
    for (const card of cardsQuery.data?.items ?? []) {
      const existing = map.get(card.note_id);
      if (existing) {
        existing.cards.push(card);
      } else {
        map.set(card.note_id, {
          note_id: card.note_id,
          note_type: card.note_type,
          front: card.front,
          back: card.back,
          tags: card.tags,
          cards: [card],
        });
      }
    }
    return [...map.values()];
  }, [cardsQuery.data]);

  /** Sunucudaki kart sayısı çekilen sayfadan fazlaysa liste sessizce kesiliyor. */
  const truncated =
    !!cardsQuery.data && cardsQuery.data.total > cardsQuery.data.items.length;

  const saveLimits = () => {
    updateDeck.mutate(
      {
        id: deckId,
        payload: {
          new_per_day: newLimit === "" ? null : Number(newLimit),
          reviews_per_day: reviewLimit === "" ? null : Number(reviewLimit),
        },
      },
      {
        onSuccess: () => toast.success("Limitler güncellendi."),
        onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
      }
    );
  };

  if (decksQuery.isLoading) {
    return (
      <DashboardShell title="Deste" navItems={navItems}>
        <div className="mx-auto max-w-4xl">
          <PageSkeleton rows={4} />
        </div>
      </DashboardShell>
    );
  }

  if (decksQuery.isError) {
    return (
      <DashboardShell title="Deste" navItems={navItems}>
        <div className="mx-auto max-w-4xl">
          <ErrorState
            description={getErrorMessage(decksQuery.error, "Deste yüklenemedi.")}
            onRetry={() => decksQuery.refetch()}
          />
        </div>
      </DashboardShell>
    );
  }

  if (!deck) {
    return (
      <DashboardShell title="Deste" navItems={navItems}>
        <div className="mx-auto max-w-4xl">
          <EmptyState
            title="Deste bulunamadı"
            description="Deste silinmiş ya da erişimin olmayabilir."
            action={
              <Link
                to={ROUTES.srs}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                Destelere dön
              </Link>
            }
          />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title={deck.name} navItems={navItems}>
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={ROUTES.srs}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 "
            >
              ← Aralıklı Tekrar
            </Link>
            <h1 className="mt-1 truncate text-2xl font-bold text-slate-900 ">
              {deck.name}
            </h1>
            {deck.description && (
              <p className="mt-1 text-sm text-slate-500 ">
                {deck.description}
              </p>
            )}
          </div>
          <Link
            to={ROUTES.srsStudy(deck.id)}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
          >
            Çalış
          </Link>
        </div>

        {/* Limitler (yalnız sahibi) */}
        {isOwn && (
          <section className="mt-8">
            <div className="border-b border-slate-200 pb-2 ">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 ">
                Günlük Limitler
              </h2>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="Yeni kart / gün" hint="Boş = üst desteden kalıt (varsayılan 20)" labelClassName={labelCls}>
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={0}
                    value={newLimit}
                    onChange={(e) => setNewLimit(e.target.value)}
                    className="input w-36"
                  />
                )}
              </Field>
              <Field label="Tekrar / gün" hint="Boş = üst desteden kalıt (varsayılan 200)" labelClassName={labelCls}>
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={0}
                    value={reviewLimit}
                    onChange={(e) => setReviewLimit(e.target.value)}
                    className="input w-36"
                  />
                )}
              </Field>
              <button
                onClick={saveLimits}
                disabled={updateDeck.isPending}
                className="mb-5 rounded-xl px-4 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50 "
              >
                Kaydet
              </button>
            </div>
          </section>
        )}

        {/* Atamalar (yalnız eğitmen + kendi destesi) */}
        {isTutor && isOwn && <AssignmentSection deckId={deck.id} />}

        {/* Notlar */}
        <section className="mt-10">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2 ">
            {/* Sayı SUNUCUDAN gelen `total`dır. Kart listesi sabit
                `page_size: 200` ile çekiliyor; başlıkta yüklenen kart sayısı
                yazıldığı için 300 notluk destede "(200)" görünüyor ve
                gerisinin var olduğu hiç belli olmuyordu. */}
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 ">
              Notlar
              {cardsQuery.data ? ` (${cardsQuery.data.total})` : ""}
            </h2>
            {isOwn && !adding && (
              <button
                onClick={() => setAdding(true)}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 "
              >
                + Not Ekle
              </button>
            )}
          </div>

          {truncated && (
            <p className="mt-3 text-xs text-slate-500 ">
              Bu destenin {cardsQuery.data?.total} kartından ilk{" "}
              {cardsQuery.data?.items.length} tanesi listeleniyor.{" "}
              <Link
                to={`${ROUTES.srsBrowser}?deste=${deckId}`}
                className="font-semibold text-indigo-600 hover:text-indigo-700 "
              >
                Tümünü tarayıcıda aç
              </Link>
            </p>
          )}

          {isOwn && adding && (
            <div className="mt-4 rounded-2xl border border-slate-200 p-4 ">
              <NoteForm
                pending={createNote.isPending}
                onCancel={() => setAdding(false)}
                onSubmit={(payload) =>
                  createNote.mutate(
                    { deckId: deck.id, payload },
                    {
                      onSuccess: () => {
                        toast.success("Not eklendi.");
                        setAdding(false);
                      },
                      onError: (err) =>
                        toast.error(getErrorMessage(err, "Eklenemedi.")),
                    }
                  )
                }
              />
            </div>
          )}

          {cardsQuery.isLoading ? (
            <div className="mt-4">
              <PageSkeleton rows={3} />
            </div>
          ) : cardsQuery.isError ? (
            <div className="mt-4">
              <ErrorState
                description={getErrorMessage(
                  cardsQuery.error,
                  "Notlar yüklenemedi."
                )}
                onRetry={() => cardsQuery.refetch()}
              />
            </div>
          ) : notes.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="Bu destede henüz not yok"
                description={
                  isOwn
                    ? "İlk notunu ekle; kartlar otomatik türetilir."
                    : "Deste sahibi not ekleyince burada görünecek."
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-slate-100 ">
              {notes.map((note) =>
                editingNoteId === note.note_id ? (
                  <div key={note.note_id} className="py-4">
                    <NoteForm
                      initial={note}
                      pending={updateNote.isPending}
                      onCancel={() => setEditingNoteId(null)}
                      onSubmit={({ front, back, tags }) =>
                        updateNote.mutate(
                          { id: note.note_id, payload: { front, back, tags } },
                          {
                            onSuccess: () => {
                              toast.success("Not güncellendi.");
                              setEditingNoteId(null);
                            },
                            onError: (err) =>
                              toast.error(
                                getErrorMessage(err, "Güncellenemedi.")
                              ),
                          }
                        )
                      }
                    />
                  </div>
                ) : (
                  <div key={note.note_id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 ">
                        {note.front}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 ">
                        <span>{NOTE_TYPE_LABELS[note.note_type]}</span>
                        <span aria-hidden>·</span>
                        <span>
                          {note.cards.length} kart
                          {" — "}
                          {note.cards
                            .map((c) => STATE_LABELS[c.state] ?? c.state)
                            .join(", ")}
                        </span>
                        {note.tags.length > 0 && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="truncate">
                              {note.tags.join(", ")}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    {isOwn && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => setEditingNoteId(note.note_id)}
                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 "
                        >
                          Düzenle
                        </button>
                        <button
                          onClick={() =>
                            setConfirmNote({
                              id: note.note_id,
                              front: note.front,
                            })
                          }
                          disabled={deleteNote.isPending}
                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 "
                        >
                          Sil
                        </button>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </section>

        {/* Deste silme (yalnız sahibi) — onay satır içi bir şeritti ve dar
            ekranda soru metni + iki düğme aynı satıra sıkışıyordu. Ortak
            ConfirmDialog portallı, odak tuzaklı ve mobilde tam genişlikte. */}
        {isOwn && (
          <section className="mt-12 border-t border-slate-200 pt-4 ">
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm font-medium text-rose-600 hover:text-rose-700 "
            >
              Desteyi sil
            </button>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Deste silinsin mi?"
        description={`"${deck.name}" alt desteleri ve tüm notlarıyla birlikte silinecek. Kartların çalışma geçmişi de gider ve bu işlem geri alınamaz.`}
        confirmLabel="Desteyi sil"
        danger
        isPending={deleteDeck.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          deleteDeck.mutate(deck.id, {
            onSuccess: () => {
              toast.success("Deste silindi.");
              setConfirmDelete(false);
              navigate(ROUTES.srs);
            },
            onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")),
          })
        }
      />

      <ConfirmDialog
        open={confirmNote !== null}
        title="Not silinsin mi?"
        description={
          confirmNote
            ? `"${confirmNote.front.slice(0, 80)}" notu, ondan türeyen kartlar ve` +
              " o kartların çalışma geçmişi silinecek. Bu işlem geri alınamaz."
            : ""
        }
        confirmLabel="Notu sil"
        danger
        isPending={deleteNote.isPending}
        onClose={() => setConfirmNote(null)}
        onConfirm={() => {
          if (!confirmNote) return;
          deleteNote.mutate(confirmNote.id, {
            onSuccess: () => {
              toast.success("Not silindi.");
              setConfirmNote(null);
            },
            onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")),
          });
        }}
      />
    </DashboardShell>
  );
}
