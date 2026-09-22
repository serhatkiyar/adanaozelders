import { DashboardShell } from "@/components/DashboardShell";
import { navForRole } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { type LeaderboardEntry } from "@/types";

const MEDALS = ["🥇", "🥈", "🥉"];

function Board({
  title,
  icon,
  entries,
  fmt,
}: {
  title: string;
  icon: string;
  entries: LeaderboardEntry[];
  fmt: (v: number) => string;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 ">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 ">
        <span>{icon}</span> {title}
      </h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400 ">
          Henüz veri yok.
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {entries.map((e, i) => (
            <li key={e.id} className="flex items-center gap-3">
              <span className="w-6 shrink-0 text-center text-sm font-bold text-slate-400">
                {i < 3 ? MEDALS[i] : i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700 ">
                {e.name}
              </span>
              <span className="shrink-0 text-sm font-semibold text-marka-metin ">
                {fmt(e.value)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Leaderboard() {
  const { data: user } = useCurrentUser();
  const navItems = navForRole(user?.role_id);
  const { data, isLoading } = useLeaderboard();

  return (
    <DashboardShell title="Liderlik" navItems={navItems}>
      <div className="mx-auto max-w-4xl">
        {isLoading || !data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-64 animate-pulse rounded-2xl bg-slate-100 "
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Board
              title="En çok ders veren öğretmenler"
              icon="🎓"
              entries={data.tutors_by_lessons}
              fmt={(v) => `${v} ders`}
            />
            <Board
              title="En yüksek puanlı öğretmenler"
              icon="★"
              entries={data.tutors_by_rating}
              fmt={(v) => v.toFixed(1)}
            />
            <Board
              title="En çok ders alan öğrenciler"
              icon="📚"
              entries={data.uyeler_ders_sayisi}
              fmt={(v) => `${v} ders`}
            />
            <Board
              title="En yüksek net yapan öğrenciler"
              icon="📈"
              entries={data.uyeler_net}
              fmt={(v) => `${v.toFixed(1)} net`}
            />
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
