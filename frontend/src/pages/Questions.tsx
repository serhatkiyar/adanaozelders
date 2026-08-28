import { useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { QuestionRights } from "@/components/QuestionRights";
import { QaThreadChat } from "@/components/QaThreadChat";
import { STUDENT_NAV } from "@/lib/nav";
import { useThreads } from "@/hooks/useQa";
import { formatDateTime } from "@/lib/datetime";
import { Avatar } from "@/components/Avatar";

export default function Questions() {
  const { data: threads, isLoading } = useThreads();
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);

  const selectedThread = threads?.find(t => t.id === selectedThreadId);

  return (
    <DashboardShell title="Sorularım" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-5xl pb-12 flex flex-col md:flex-row gap-6">
        <div className="md:w-1/3 flex flex-col gap-6">
          <QuestionRights />
          <div className="bg-white rounded-2xl shadow-sm border p-4 ">
            <h3 className="font-semibold mb-3">Soru Geçmişi</h3>
            {isLoading ? (
              <div className="animate-pulse flex flex-col gap-3">
                <div className="h-16 bg-slate-100 rounded-xl "></div>
                <div className="h-16 bg-slate-100 rounded-xl "></div>
              </div>
            ) : !threads || threads.length === 0 ? (
              <p className="text-sm text-slate-500">Henüz soru sormadınız.</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-2">
                {threads.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedThreadId(t.id)}
                    className={`text-left p-3 rounded-xl border transition ${selectedThreadId === t.id ? 'border-indigo-500 bg-indigo-50/50 ' : 'border-slate-200 hover:bg-slate-50 '}`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-medium text-slate-500 truncate max-w-[120px]">{t.tutor_name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${t.status === 'CLOSED' ? 'bg-slate-100 ' : 'bg-emerald-100 text-emerald-700 '}`}>
                        {t.status}
                      </span>
                    </div>
                    <p className="text-sm font-semibold truncate">{t.subject || "Konusuz"}</p>
                    <p className="text-xs text-slate-400 mt-1">{formatDateTime(t.created_at)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <div className="md:w-2/3">
          {selectedThread ? (
            <div className="bg-white rounded-2xl shadow-sm border p-5 flex flex-col h-[700px] ">
              <div className="flex items-center gap-3 border-b pb-4 mb-4 ">
                <Avatar name={selectedThread.tutor_name || "T"} avatar_url={selectedThread.tutor_avatar_url} />
                <div>
                  <h3 className="font-semibold">{selectedThread.subject || "Konusuz"}</h3>
                  <p className="text-xs text-slate-500">Eğitmen: {selectedThread.tutor_name}</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 mb-2">
                <QaThreadChat thread={selectedThread} role="CLIENT" canReply={selectedThread.status !== "CLOSED"} />
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-dashed rounded-2xl flex items-center justify-center h-full min-h-[400px] text-slate-400 ">
              Görüntülemek için bir soru seçin
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
