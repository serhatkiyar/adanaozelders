import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { TUTOR_NAV } from "@/lib/nav";
import { Avatar } from "@/components/Avatar";
import { QaThreadChat } from "@/components/QaThreadChat";
import { useThreads } from "@/hooks/useQa";
import { formatDate } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { QAStatus, type QAThreadOut } from "@/types";

const statusLabel: Record<QAStatus, string> = {
  [QAStatus.OPEN]: "Yanıt bekliyor",
  [QAStatus.ANSWERED]: "Yanıtlandı",
  [QAStatus.CLOSED]: "Kapandı",
};

const statusStyle: Record<QAStatus, string> = {
  [QAStatus.OPEN]: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  [QAStatus.ANSWERED]:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  [QAStatus.CLOSED]: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

function TutorThreadCard({ thread }: { thread: QAThreadOut }) {
  const clientName = thread.client_name ?? `Öğrenci #${thread.client_id}`;
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex items-center justify-between gap-3">
        <Link
          to={`/tutor/students/${thread.client_id}`}
          className="flex min-w-0 items-center gap-2.5 rounded-lg transition hover:opacity-80"
        >
          <Avatar name={clientName} avatar_url={thread.client_avatar_url} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400">
              {clientName}
            </p>
            <p className="truncate text-xs text-slate-400 dark:text-slate-500">
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
          canReply={thread.status !== QAStatus.CLOSED}
        />
      </div>
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
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              {openCount}
            </span>{" "}
            soru yanıtını bekliyor.
          </p>
        )}

        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
            />
          ))
        ) : isError ? (
          <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-800/30">
            {getErrorMessage(error, "Sorular yüklenemedi.")}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">
              💬
            </div>
            <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
              Henüz soru yok
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
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
