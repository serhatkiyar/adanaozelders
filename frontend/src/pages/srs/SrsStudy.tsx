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

/**
 * Cevap düğmelerinin yüzeyi nötrdür; derece ayrımı yalnız ince bir sol kenar
 * aksanıyla verilir.
 *
 * NEDEN: dört doygun renk bloğu ("trafik ışığı") sakin/nötr palet kuralını
 * çiğniyordu ve daha kötüsü, bu paketin ZORUNLU özelliği olan aralık
 * önizlemesini okunamaz hale getiriyordu (beyaz metin `bg-amber-500` üzerinde
 * ≈2.2:1; `opacity-80` eklenince ≈1.8:1 — WCAG AA eşiği 4.5:1). Renk artık
 * anlamı TAŞIMAZ (etiket metni taşır), yalnız ayırt etmeye yardım eder.
 */
const RATING_META: {
  rating: SrsRating;
  label: string;
  accent: string;
}[] = [
  { rating: 1, label: "Tekrar", accent: "border-l-rose-600 " },
  { rating: 2, label: "Zor", accent: "border-l-amber-600 " },
  { rating: 3, label: "İyi", accent: "border-l-sky-600 " },
  { rating: 4, label: "Kolay", accent: "border-l-emerald-600 " },
];

const RATING_BTN_CLS =
  "rounded-xl border border-l-4 border-slate-200 bg-white px-1 py-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 sm:px-2 sm:text-sm";

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
    <p className="whitespace-pre-wrap text-xl leading-relaxed text-slate-900 ">
      {segments.map((s, i) =>
        s.kind === "plain" ? (
          <span key={i}>{s.text}</span>
        ) : s.kind === "blank" ? (
          <span key={i} className="font-semibold text-indigo-600 ">
            {s.text}
          </span>
        ) : (
          <span key={i} className="rounded bg-indigo-100 px-1 font-semibold text-indigo-700 ">
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
            <span key={i} className="text-emerald-600 ">
              {s.text}
            </span>
          ) : s.kind === "bad" ? (
            <span key={i} className="text-rose-600 line-through ">
              {s.text}
            </span>
          ) : (
            <span key={i} className="text-amber-600 underline decoration-dotted ">
              {s.text}
            </span>
          )
        )}
      </p>
      <p className="mt-1 text-xs text-slate-400 ">
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
    <div className="min-h-56 rounded-2xl border border-slate-200 bg-white p-6 sm:p-10">
      {isCloze ? (
        <ClozeText
          front={card.front}
          activeN={card.template_ord + 1}
          revealed={flipped}
        />
      ) : (
        <p className="whitespace-pre-wrap text-xl leading-relaxed text-slate-900 ">
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
          // Ortak `.input` (index.css) — dark odak paritesi oradan gelir.
          // Yalnız dokunmatik hedefi büyüten ölçüler geçersiz kılınır.
          className="input mt-6 px-4 py-3 text-base"
        />
      )}

      {flipped && (
        <>
          <hr className="my-5 border-slate-200 " />
          {isTypeIn ? (
            <>
              <p className="whitespace-pre-wrap text-xl leading-relaxed text-slate-900 ">
                {card.back}
              </p>
              <TypedDiff expected={card.back} typed={typed} />
            </>
          ) : isCloze ? (
            card.back && (
              <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-600 ">
                {card.back}
              </p>
            )
          ) : (
            <p className="whitespace-pre-wrap text-xl leading-relaxed text-slate-900 ">
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
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 "
          >
            ← Desteler
          </Link>
          <div className="flex items-center gap-4">
            {counts && (
              // `title` klavye/ekran okuyucu/dokunmatik kullanıcısına ulaşmaz;
              // grup adlandırılmış tek öğe olarak sunulur (bkz. SrsDecks).
              <span
                role="img"
                aria-label={`${counts.new} yeni, ${counts.learning} öğrenme, ${counts.review} tekrar`}
                title={`${counts.new} yeni · ${counts.learning} öğrenme · ${counts.review} tekrar`}
                className="flex items-center gap-2 text-xs tabular-nums"
              >
                <span aria-hidden className="font-semibold text-sky-600 ">
                  {counts.new}
                </span>
                <span aria-hidden className="font-semibold text-amber-600 ">
                  {counts.learning}
                </span>
                <span aria-hidden className="font-semibold text-emerald-600 ">
                  {counts.review}
                </span>
              </span>
            )}
            <button
              onClick={undoLast}
              disabled={undo.isPending}
              title="Son cevabı geri al (u)"
              className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 "
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
              {/* iOS'ta ana ekran çubuğu (home indicator) barın altını yiyordu:
                  taban dolgusu güvenli alan kadar büyütülür. */}
              <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mt-6 sm:border-0 sm:bg-transparent sm:p-0 sm:pb-0 sm:backdrop-blur-none ">
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
                      {RATING_META.map(({ rating, label, accent }) => (
                        <button
                          key={rating}
                          onClick={() => rate(rating)}
                          disabled={answer.isPending}
                          className={`${RATING_BTN_CLS} ${accent}`}
                        >
                          <span className="block">{label}</span>
                          <span className="mt-0.5 block text-xs font-medium text-slate-500 ">
                            {formatIntervalMinutes(card.previews[String(rating) as "1" | "2" | "3" | "4"])}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 hidden text-center text-[11px] text-slate-400 sm:block">
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
