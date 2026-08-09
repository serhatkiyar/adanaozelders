import { useCallback, useEffect, useRef, useState } from "react";
import { AxiosError } from "axios";
import { Link, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui/PageState";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAnswerSrsCard, useSrsQueue, useUndoSrsAnswer } from "@/hooks/useSrs";
import { getErrorMessage } from "@/lib/errors";
import { renderCloze } from "@/lib/srsCloze";
import { formatIntervalMinutes } from "@/lib/srsFormat";
import { compareTypedAnswer } from "@/lib/srsTypeAnswer";
import { toast } from "@/store/toastStore";
import { ROLE_IDS } from "@/types";
import type { SrsQueueCard, SrsRating } from "@/types/srs";
import { ROUTES } from "@/lib/routes";

const RATING_META: {
  rating: SrsRating;
  label: string;
  cls: string;
}[] = [
  {
    rating: 1,
    label: "Tekrar",
    cls: "bg-rose-600 hover:bg-rose-700 text-white",
  },
  {
    rating: 2,
    label: "Zor",
    cls: "bg-amber-500 hover:bg-amber-600 text-white",
  },
  {
    rating: 3,
    label: "İyi",
    cls: "bg-emerald-600 hover:bg-emerald-700 text-white",
  },
  {
    rating: 4,
    label: "Kolay",
    cls: "bg-sky-600 hover:bg-sky-700 text-white",
  },
];

function ClozeText({
  front,
  activeN,
  revealed,
}: {
  front: string;
  activeN: number;
  revealed: boolean;
}) {
  const segments = renderCloze(front, activeN, revealed);
  return (
    <p className="whitespace-pre-wrap text-xl leading-relaxed text-slate-900 dark:text-white">
      {segments.map((s, i) =>
        s.kind === "plain" ? (
          <span key={i}>{s.text}</span>
        ) : s.kind === "blank" ? (
          <span key={i} className="font-semibold text-indigo-600 dark:text-indigo-400">
            {s.text}
          </span>
        ) : (
          <span key={i} className="rounded bg-indigo-100 px-1 font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
            {s.text}
          </span>
        )
      )}
    </p>
  );
}

/** T-7: yazılan cevabın karakter-düzeyi farkı — good/bad/missed. */
function TypedDiff({ expected, typed }: { expected: string; typed: string }) {
  const result = compareTypedAnswer(expected, typed);
  return (
    <div className="mt-3">
      <p className="whitespace-pre-wrap text-lg leading-relaxed">
        {result.segments.map((s, i) =>
          s.kind === "good" ? (
            <span key={i} className="text-emerald-600 dark:text-emerald-400">
              {s.text}
            </span>
          ) : s.kind === "bad" ? (
            <span key={i} className="text-rose-600 line-through dark:text-rose-400">
              {s.text}
            </span>
          ) : (
            <span key={i} className="text-amber-600 underline decoration-dotted dark:text-amber-400">
              {s.text}
            </span>
          )
        )}
      </p>
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
        {result.correct
          ? "Cevabın eşleşti."
          : "Yeşil doğru, kırmızı fazla/yanlış, sarı eksik."}
      </p>
    </div>
  );
}

function CardFace({
  card,
  flipped,
  typed,
  onTypedChange,
  onFlip,
}: {
  card: SrsQueueCard;
  flipped: boolean;
  typed: string;
  onTypedChange: (v: string) => void;
  onFlip: () => void;
}) {
  const isCloze = card.note_type === "CLOZE";
  const isTypeIn = card.note_type === "TYPE_IN";
  // Yazarak cevaplamada girdi yeni kart gelince odaklanır (autoFocus prop'u
  // yerine imperatif odak — jsx-a11y/no-autofocus).
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (card.note_type === "TYPE_IN") inputRef.current?.focus();
  }, [card]);
  // BASIC_REVERSED ord 1 = arka→ön; kuyruğun döndürdüğü front/back yüz
  // metinleri backend'de karta göre hazırlanır — burada olduğu gibi basılır.

  return (
    <div className="min-h-56 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 sm:p-10">
      {isCloze ? (
        <ClozeText
          front={card.front}
          activeN={card.template_ord + 1}
          revealed={flipped}
        />
      ) : (
        <p className="whitespace-pre-wrap text-xl leading-relaxed text-slate-900 dark:text-white">
          {card.front}
        </p>
      )}

      {isTypeIn && !flipped && (
        <input
          value={typed}
          onChange={(e) => onTypedChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onFlip();
            }
          }}
          ref={inputRef}
          placeholder="Cevabını yaz…"
          aria-label="Cevabın"
          className="mt-6 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
      )}

      {flipped && (
        <>
          <hr className="my-5 border-slate-200 dark:border-slate-800" />
          {isTypeIn ? (
            <>
              <p className="whitespace-pre-wrap text-xl leading-relaxed text-slate-900 dark:text-white">
                {card.back}
              </p>
              <TypedDiff expected={card.back} typed={typed} />
            </>
          ) : isCloze ? (
            card.back && (
              <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-600 dark:text-slate-300">
                {card.back}
              </p>
            )
          ) : (
            <p className="whitespace-pre-wrap text-xl leading-relaxed text-slate-900 dark:text-white">
              {card.back}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function SrsStudy() {
  const { deckId } = useParams<{ deckId: string }>();
  const deckIdNum = Number(deckId);
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : STUDENT_NAV;

  const queue = useSrsQueue(deckIdNum);
  const answer = useAnswerSrsCard();
  const undo = useUndoSrsAnswer();

  const [flipped, setFlipped] = useState(false);
  const [typed, setTyped] = useState("");
  const [token, setToken] = useState(() => crypto.randomUUID());

  const card = queue.data?.card ?? null;
  const counts = queue.data?.counts;

  // Her kart gösteriminde yeni idempotency token'ı + temiz yüz (S-1).
  useEffect(() => {
    setToken(crypto.randomUUID());
    setFlipped(false);
    setTyped("");
  }, [queue.data]);

  const flip = useCallback(() => setFlipped(true), []);

  const rate = useCallback(
    (rating: SrsRating) => {
      if (!card || answer.isPending) return;
      answer.mutate(
        { card_id: card.id, rating, client_token: token },
        {
          onError: (err) =>
            toast.error(getErrorMessage(err, "Cevap kaydedilemedi.")),
        }
      );
    },
    [card, answer, token]
  );

  const undoLast = useCallback(() => {
    if (undo.isPending) return;
    undo.mutate(undefined, {
      onSuccess: () => toast.success("Son cevap geri alındı."),
      onError: (err) => {
        if (err instanceof AxiosError && err.response?.status === 409) {
          toast.info("Geri alınacak cevap yok.");
        } else {
          toast.error(getErrorMessage(err, "Geri alınamadı."));
        }
      },
    });
  }, [undo]);

  // Klavye kısayolları: boşluk=çevir, 1-4=cevapla, u=undo.
  // Bir girdi odaktayken (TYPE_IN yazımı) kısayollar devre dışıdır.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        if (card && !flipped) flip();
        return;
      }
      if (e.key === "u" || e.key === "U") {
        e.preventDefault();
        undoLast();
        return;
      }
      if (flipped && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        rate(Number(e.key) as SrsRating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, flipped, flip, rate, undoLast]);

  return (
    <DashboardShell title="Çalış" navItems={navItems}>
      <div className="mx-auto max-w-2xl pb-36 sm:pb-0">
        <div className="flex items-center justify-between">
          <Link
            to={ROUTES.srs}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            ← Desteler
          </Link>
          <div className="flex items-center gap-4">
            {counts && (
              <span
                className="flex items-center gap-2 text-xs tabular-nums"
                title="Yeni · Öğrenme · Tekrar"
              >
                <span className="font-semibold text-sky-600 dark:text-sky-400">
                  {counts.new}
                </span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {counts.learning}
                </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {counts.review}
                </span>
              </span>
            )}
            <button
              onClick={undoLast}
              disabled={undo.isPending}
              title="Son cevabı geri al (u)"
              className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Geri al
            </button>
          </div>
        </div>

        <div className="mt-5">
          {queue.isLoading ? (
            <PageSkeleton rows={3} />
          ) : queue.isError ? (
            <ErrorState
              description={getErrorMessage(queue.error, "Kuyruk yüklenemedi.")}
              onRetry={() => queue.refetch()}
            />
          ) : !card ? (
            <EmptyState
              title="Bugünlük bitti"
              description="Bu destede şu an vadesi gelen kart yok. Yarın yeni kartlar ve tekrarlar seni bekliyor."
              action={
                <Link
                  to={ROUTES.srs}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  Destelere dön
                </Link>
              }
            />
          ) : (
            <>
              <CardFace
                card={card}
                flipped={flipped}
                typed={typed}
                onTypedChange={setTyped}
                onFlip={flip}
              />

              {/* Cevap barı: mobilde alta sabit, dokunmatik boyutlu */}
              <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:static sm:mt-6 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none dark:sm:bg-transparent">
                <div className="mx-auto max-w-2xl">
                  {!flipped ? (
                    <button
                      onClick={flip}
                      className="w-full rounded-xl bg-indigo-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                    >
                      Cevabı Göster
                      <span className="ml-2 hidden text-indigo-200 sm:inline">
                        boşluk
                      </span>
                    </button>
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {RATING_META.map(({ rating, label, cls }) => (
                        <button
                          key={rating}
                          onClick={() => rate(rating)}
                          disabled={answer.isPending}
                          className={`rounded-xl px-2 py-3 text-sm font-semibold transition disabled:opacity-60 ${cls}`}
                        >
                          <span className="block">{label}</span>
                          <span className="mt-0.5 block text-xs font-medium opacity-80">
                            {formatIntervalMinutes(card.previews[String(rating) as "1" | "2" | "3" | "4"])}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 hidden text-center text-[11px] text-slate-400 dark:text-slate-500 sm:block">
                    boşluk = çevir · 1-4 = cevapla · u = geri al
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
