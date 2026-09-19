import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { TUTOR_NAV } from "@/lib/nav";
import { Avatar } from "@/components/Avatar";
import { QaThreadChat } from "@/components/QaThreadChat";
import { ACIKLAMA, ETIKET, KART, KUCUK_ACIKLAMA } from "@/components/pano/stil";
import { useCloseThread, useThreads } from "@/hooks/useQa";
import { formatDate } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { QAStatus, type QAThreadOut } from "@/types";
import { ROUTES } from "@/lib/routes";

const statusLabel: Record<QAStatus, string> = {
  [QAStatus.OPEN]: "Yanıt bekliyor",
  [QAStatus.ANSWERED]: "Yanıtlandı",
  [QAStatus.CLOSED]: "Kapandı",
};

const statusStyle: Record<QAStatus, string> = {
  [QAStatus.OPEN]: "bg-amber-50 text-amber-700 ",
  [QAStatus.ANSWERED]:
    "bg-emerald-50 text-emerald-700 ",
  [QAStatus.CLOSED]: "bg-slate-100 text-slate-600 ",
};

function TutorThreadCard({ thread }: { thread: QAThreadOut }) {
  const clientName = thread.client_name ?? `Öğrenci #${thread.client_id}`;
  const close = useCloseThread();
  const isClosed = thread.status === QAStatus.CLOSED;

  const handleClose = () => {
    close.mutate(thread.id, {
      onError: (err) =>
        toast.error(getErrorMessage(err, "Konu kapatılamadı.")),
    });
  };

  return (
    <div className={KART}>
      <div className="flex items-center justify-between gap-3">
        <Link
          to={ROUTES.uyeProfili(thread.client_id)}
          className="flex min-w-0 items-center gap-2.5 rounded-lg transition hover:opacity-80"
        >
          <Avatar name={clientName} avatar_url={thread.client_avatar_url} size="sm" />
          <div className="min-w-0">
            <p className={`truncate hover:text-marka-metin ${ETIKET}`}>
              {clientName}
            </p>
            <p className={`truncate ${KUCUK_ACIKLAMA}`}>
              {thread.subject || "Soru"} · {formatDate(thread.created_at)}
            </p>
          </div>
        </Link>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[thread.status]}`}
        >
          {statusLabel[thread.status]}
        </span>
      </div>

      <div className="mt-4">
        <QaThreadChat
          thread={thread}
          role="TUTOR"
          canReply={!isClosed}
        />
      </div>

      {!isClosed && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={close.isPending}
            className="rounded-lg px-3.5 py-2 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {close.isPending ? "…" : "Konuyu kapat"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function TutorQuestions() {
  const { data, isLoading, isError, error } = useThreads({ limit: 50 });
  const openCount = data?.filter((t) => t.status === QAStatus.OPEN).length ?? 0;

  return (
    <DashboardShell title="Sorular" navItems={TUTOR_NAV}>
      <div className="mx-auto max-w-3xl space-y-3">
        {openCount > 0 && (
          <p className={ACIKLAMA}>
            <span className="font-semibold text-amber-600 ">
              {openCount}
            </span>{" "}
            soru yanıtını bekliyor.
          </p>
        )}

        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg bg-slate-100 "
            />
          ))
        ) : isError ? (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100 ">
            {getErrorMessage(error, "Sorular yüklenemedi.")}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 py-16 text-center ">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-2xl ">
              💬
            </div>
            <p className={`mt-4 ${ETIKET}`}>
              Henüz soru yok
            </p>
            <p className={`mt-1 ${ACIKLAMA}`}>
              Tamamlanan derslerden sonra öğrenciler sana soru sorabilir.
            </p>
          </div>
        ) : (
          data.map((t) => <TutorThreadCard key={t.id} thread={t} />)
        )}
      </div>
    </DashboardShell>
  );
}
