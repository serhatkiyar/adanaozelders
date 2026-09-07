import { useState } from "react";
import { Link } from "react-router-dom";
import { useQaRights } from "@/hooks/useQa";
import { QuestionModal } from "@/components/QuestionModal";
import { QaThreadChat } from "@/components/QaThreadChat";
import { formatDate } from "@/lib/datetime";
import type { LessonQuestionGroup } from "@/types";
import { ROUTES } from "@/lib/routes";

interface AskState {
  bookingId: number;
  tutorName: string;
  remaining: number;
}

function LessonGroup({
  group,
  onAsk,
}: {
  group: LessonQuestionGroup;
  onAsk: (a: AskState) => void;
}) {
  const [open, setOpen] = useState(false);
  const tutorName = group.tutor_name ?? "Eğitmen";

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 ">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50 "
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 ">
            {formatDate(group.start_at)} · {tutorName}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-400 ">
            {group.tutor_headline || "Ders"} · {group.used} soru başlığı
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {group.expired ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 ">
              Süre doldu
            </span>
          ) : (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                group.remaining > 0
                  ? "bg-marka-soft text-marka-metin-hover "
                  : "bg-slate-100 text-slate-500 "
              }`}
            >
              {group.remaining}/{group.quota} hak
            </span>
          )}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 px-5 py-4 ">
          <Link
            to={ROUTES.tutor(group.tutor_id)}
            className="inline-flex items-center gap-1 text-xs font-medium text-marka-metin transition hover:text-marka-metin-hover "
          >
            {tutorName} profilini gör →
          </Link>

          {!group.expired && (
            <p className="text-xs text-slate-500 ">
              {group.can_ask
                ? `Yeni soru başlığı açabilirsin (${group.remaining} hak) · hakkın bitmesine ${group.days_left} gün`
                : `Yeni başlık hakkın kalmadı · mevcut sorularına ${group.days_left} gün daha yazabilirsin`}
            </p>
          )}

          {group.threads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400 ">
              Bu derste henüz soru sormadın.
            </p>
          ) : (
            group.threads.map((t) => (
              <div
                key={t.id}
                className="rounded-xl bg-slate-50 p-3.5 "
              >
                {t.subject && (
                  <p className="mb-2 text-sm font-semibold text-slate-800 ">
                    {t.subject}
                  </p>
                )}
                <QaThreadChat thread={t} role="CLIENT" canReply={!group.expired} />
              </div>
            ))
          )}

          {group.can_ask && (
            <button
              type="button"
              onClick={() =>
                onAsk({
                  bookingId: group.booking_id,
                  tutorName,
                  remaining: group.remaining,
                })
              }
              className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 active:scale-[0.98] "
            >
              Yeni Soru Başlığı Aç ({group.remaining} hak)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function QuestionRights() {
  const { data, isLoading } = useQaRights();
  const [ask, setAsk] = useState<AskState | null>(null);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 ">
          Soru Hakların
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 ">
          Tamamlanan her ders, bitiminden sonra 7 gün boyunca 3 soru başlığı hakkı
          verir. Her başlıkta eğitmenle karşılıklı yazışabilirsin.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl bg-slate-100 "
            />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-10 text-center ">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl ">
            💬
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700 ">
            Henüz soru hakkın yok
          </p>
          <p className="mt-1 text-xs text-slate-400 ">
            Bir ders tamamlandığında soruların burada toplanır.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((g) => (
            <LessonGroup key={g.booking_id} group={g} onAsk={setAsk} />
          ))}
        </div>
      )}

      {ask && (
        <QuestionModal
          bookingId={ask.bookingId}
          tutorName={ask.tutorName}
          remaining={ask.remaining}
          onClose={() => setAsk(null)}
        />
      )}
    </section>
  );
}
