import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui/PageState";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSrsDecks, useSrsStats } from "@/hooks/useSrs";
import { getErrorMessage } from "@/lib/errors";
import { ROLE_IDS } from "@/types";
import { ROUTES } from "@/lib/routes";

const dayFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
});

export default function SrsStats() {
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : UYE_NAV;

  const decksQuery = useSrsDecks();
  const [deckId, setDeckId] = useState("");
  const stats = useSrsStats(deckId ? Number(deckId) : undefined);

  const allDecks = useMemo(
    () => [...(decksQuery.data?.own ?? []), ...(decksQuery.data?.assigned ?? [])],
    [decksQuery.data]
  );

  const futureLoad = stats.data?.future_load ?? [];
  const maxDue = Math.max(1, ...futureLoad.map((d) => d.due));
  const hasAnyData =
    (stats.data?.review_count ?? 0) > 0 || futureLoad.some((d) => d.due > 0);

  return (
    <DashboardShell title="İstatistik" navItems={navItems}>
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link
              to={ROUTES.srs}
              className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover "
            >
              ← Aralıklı Tekrar
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 ">
              İstatistik
            </h1>
          </div>
          <select
            value={deckId}
            onChange={(e) => setDeckId(e.target.value)}
            aria-label="Deste filtresi"
            // Ortak `.input` (index.css); `w-auto` yalnız tam genişliği kaldırır.
            className="input w-auto"
          >
            <option value="">Tüm desteler</option>
            {allDecks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-8">
          {stats.isLoading ? (
            <PageSkeleton rows={3} />
          ) : stats.isError ? (
            <ErrorState
              description={getErrorMessage(
                stats.error,
                "İstatistikler yüklenemedi."
              )}
              onRetry={() => stats.refetch()}
            />
          ) : !hasAnyData ? (
            <EmptyState
              title="Henüz veri yok"
              description="Kart çalışmaya başladığında tutma oranın ve gelecekteki tekrar yükün burada görünecek."
              action={
                <Link
                  to={ROUTES.srs}
                  className="rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover"
                >
                  Çalışmaya başla
                </Link>
              }
            />
          ) : (
            <>
              {/* Özet satırı — kart enflasyonu yerine tek çizgi altında sayılar */}
              <div className="flex flex-wrap gap-x-12 gap-y-4 border-b border-slate-200 pb-6 ">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 ">
                    Toplam tekrar
                  </p>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900 ">
                    {stats.data?.review_count ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 ">
                    Tutma oranı
                  </p>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900 ">
                    {stats.data?.retention_rate != null
                      ? `%${Math.round(stats.data.retention_rate * 100)}`
                      : "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400 ">
                    Tekrar kartlarında "Tekrar" dışı cevap payı
                  </p>
                </div>
                {stats.data?.counts && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500 ">
                      Bugün kalan
                    </p>
                    <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900 ">
                      {stats.data.counts.new +
                        stats.data.counts.learning +
                        stats.data.counts.review}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400 ">
                      {stats.data.counts.new} yeni · {stats.data.counts.learning}{" "}
                      öğrenme · {stats.data.counts.review} tekrar
                    </p>
                  </div>
                )}
              </div>

              {/* 30 günlük gelecek yük — basit div çubuklar */}
              <section className="mt-8">
                <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 ">
                  Önümüzdeki 30 Günün Yükü
                </h2>
                {futureLoad.length === 0 || !futureLoad.some((d) => d.due > 0) ? (
                  <p className="mt-3 text-sm text-slate-400 ">
                    Önümüzdeki 30 günde vadesi gelen kart yok.
                  </p>
                ) : (
                  <div className="mt-4 space-y-1.5">
                    {futureLoad.map((d) => (
                      <div key={d.day} className="flex items-center gap-3">
                        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-500 ">
                          {dayFmt.format(new Date(`${d.day}T00:00:00`))}
                        </span>
                        <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100 ">
                          <div
                            className="h-full rounded bg-marka-mid/80 "
                            style={{ width: `${(d.due / maxDue) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-xs font-semibold tabular-nums text-slate-600 ">
                          {d.due}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
