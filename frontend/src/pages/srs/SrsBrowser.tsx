import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { DashboardShell } from "@/components/DashboardShell";
import { DataTable } from "@/components/admin/data-table/DataTable";
import { ErrorState } from "@/components/admin/ui/PageState";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDebounce } from "@/hooks/useDebounce";
import { useBulkSrsCards, useSrsCards, useSrsDecks, useSrsTags } from "@/hooks/useSrs";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROLE_IDS } from "@/types";
import type {
  SrsBulkAction,
  SrsCard,
  SrsCardListParams,
  SrsCardState,
} from "@/types/srs";
import { ROUTES } from "@/lib/routes";

const selectCls =
  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";

const STATE_OPTIONS: { value: SrsCardState; label: string }[] = [
  { value: "NEW", label: "Yeni" },
  { value: "LEARNING", label: "Öğrenme" },
  { value: "REVIEW", label: "Tekrar" },
  { value: "RELEARNING", label: "Yeniden öğrenme" },
];

const STATE_LABELS: Record<SrsCardState, string> = {
  NEW: "Yeni",
  LEARNING: "Öğrenme",
  REVIEW: "Tekrar",
  RELEARNING: "Yeniden",
};

export default function SrsBrowser() {
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : STUDENT_NAV;

  const decksQuery = useSrsDecks();
  const tagsQuery = useSrsTags();
  const bulk = useBulkSrsCards();

  const [deckId, setDeckId] = useState("");
  const [state, setState] = useState("");
  const [tag, setTag] = useState("");
  const [suspended, setSuspended] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [targetDeckId, setTargetDeckId] = useState("");
  const [bulkTag, setBulkTag] = useState("");

  const q = useDebounce(search.trim(), 400);

  const params = useMemo<SrsCardListParams>(
    () => ({
      ...(deckId ? { deck_id: Number(deckId) } : {}),
      ...(state ? { state: state as SrsCardState } : {}),
      ...(tag ? { tag } : {}),
      ...(q ? { q } : {}),
      ...(suspended ? { suspended: suspended === "true" } : {}),
      page,
      page_size: pageSize,
    }),
    [deckId, state, tag, q, suspended, page, pageSize]
  );

  const cardsQuery = useSrsCards(params);
  const items = cardsQuery.data?.items ?? [];
  const total = cardsQuery.data?.total ?? 0;

  const allDecks = useMemo(
    () => [...(decksQuery.data?.own ?? []), ...(decksQuery.data?.assigned ?? [])],
    [decksQuery.data]
  );
  const deckNames = useMemo(
    () => new Map(allDecks.map((d) => [d.id, d.name])),
    [allDecks]
  );

  const resetPage = () => setPage(1);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pageIds = items.map((c) => c.id);
  const allOnPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const runBulk = (
    action: SrsBulkAction,
    extra?: { target_deck_id?: number; tag?: string }
  ) => {
    if (selected.size === 0) return;
    bulk.mutate(
      { ids: [...selected], action, ...extra },
      {
        onSuccess: ({ affected }) => {
          toast.success(`${affected} kart güncellendi.`);
          setSelected(new Set());
        },
        onError: (err) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
      }
    );
  };

  // Not: bilinçli olarak useMemo YOK — kolon hücreleri seçim state'ine bağlı,
  // bu ölçekte her render'da yeniden kurulmaları ucuz ve daha az kırılgan.
  const columns: ColumnDef<SrsCard, unknown>[] = [
      {
        id: "select",
        header: () => (
          <input
            type="checkbox"
            aria-label="Sayfadaki tüm kartları seç"
            checked={allOnPageSelected}
            onChange={toggleAll}
            className="h-4 w-4 accent-indigo-600"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label="Kartı seç"
            checked={selected.has(row.original.id)}
            onChange={() => toggle(row.original.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 accent-indigo-600"
          />
        ),
        enableSorting: false,
      },
      {
        id: "front",
        header: "Ön yüz",
        cell: ({ row }) => (
          <span className="block max-w-72 truncate" title={row.original.front}>
            {row.original.front}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "deck",
        header: "Deste",
        cell: ({ row }) =>
          deckNames.get(row.original.deck_id) ?? `#${row.original.deck_id}`,
        enableSorting: false,
      },
      {
        id: "state",
        header: "Durum",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            {STATE_LABELS[row.original.state]}
            {row.original.suspended && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                askıda
              </span>
            )}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "due",
        header: "Vade",
        cell: ({ row }) =>
          row.original.due_at ? formatDateTime(row.original.due_at) : "—",
        enableSorting: false,
      },
      {
        id: "tags",
        header: "Etiketler",
        cell: ({ row }) =>
          row.original.tags.length > 0 ? (
            <span className="block max-w-40 truncate text-xs text-slate-500 dark:text-slate-400">
              {row.original.tags.join(", ")}
            </span>
          ) : (
            "—"
          ),
        enableSorting: false,
      },
  ];

  return (
    <DashboardShell title="Kart Tarayıcı" navItems={navItems}>
      <div className="mx-auto max-w-6xl">
        <div>
          <Link
            to={ROUTES.srs}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            ← Aralıklı Tekrar
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
            Kart Tarayıcı
          </h1>
        </div>

        {/* Filtreler — sunucu tarafı */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            placeholder="Ara…"
            aria-label="Kartlarda ara"
            className={`${selectCls} w-48`}
          />
          <select
            value={deckId}
            onChange={(e) => {
              setDeckId(e.target.value);
              resetPage();
            }}
            aria-label="Deste filtresi"
            className={selectCls}
          >
            <option value="">Tüm desteler</option>
            {allDecks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              resetPage();
            }}
            aria-label="Durum filtresi"
            className={selectCls}
          >
            <option value="">Tüm durumlar</option>
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              resetPage();
            }}
            aria-label="Etiket filtresi"
            className={selectCls}
          >
            <option value="">Tüm etiketler</option>
            {(tagsQuery.data ?? []).map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={suspended}
            onChange={(e) => {
              setSuspended(e.target.value);
              resetPage();
            }}
            aria-label="Askı filtresi"
            className={selectCls}
          >
            <option value="">Askı: hepsi</option>
            <option value="true">Yalnız askıda</option>
            <option value="false">Askıda olmayan</option>
          </select>
        </div>

        {/* Toplu işlem barı */}
        {selected.size > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
            <span className="font-semibold text-indigo-700 dark:text-indigo-300">
              {selected.size} kart seçili
            </span>
            <span className="mx-1 hidden h-4 w-px bg-indigo-200 dark:bg-indigo-500/30 sm:block" />
            {(
              [
                ["suspend", "Askıya al"],
                ["unsuspend", "Askıdan çıkar"],
                ["bury", "Göm"],
                ["unbury", "Gömmeyi geri al"],
              ] as [SrsBulkAction, string][]
            ).map(([action, label]) => (
              <button
                key={action}
                onClick={() => runBulk(action)}
                disabled={bulk.isPending}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
              >
                {label}
              </button>
            ))}
            <span className="flex items-center gap-1">
              <select
                value={targetDeckId}
                onChange={(e) => setTargetDeckId(e.target.value)}
                aria-label="Hedef deste"
                className={`${selectCls} py-1.5 text-xs`}
              >
                <option value="">Hedef deste…</option>
                {(decksQuery.data?.own ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  targetDeckId
                    ? runBulk("move_deck", {
                        target_deck_id: Number(targetDeckId),
                      })
                    : toast.error("Hedef deste seç.")
                }
                disabled={bulk.isPending}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
              >
                Taşı
              </button>
            </span>
            <span className="flex items-center gap-1">
              <input
                value={bulkTag}
                onChange={(e) => setBulkTag(e.target.value)}
                placeholder="etiket"
                aria-label="Toplu etiket"
                className={`${selectCls} w-28 py-1.5 text-xs`}
              />
              <button
                onClick={() =>
                  bulkTag.trim()
                    ? runBulk("add_tag", { tag: bulkTag.trim() })
                    : toast.error("Etiket yaz.")
                }
                disabled={bulk.isPending}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
              >
                Etiket ekle
              </button>
              <button
                onClick={() =>
                  bulkTag.trim()
                    ? runBulk("remove_tag", { tag: bulkTag.trim() })
                    : toast.error("Etiket yaz.")
                }
                disabled={bulk.isPending}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
              >
                Etiket çıkar
              </button>
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Seçimi temizle
            </button>
          </div>
        )}

        <div className="mt-4">
          {cardsQuery.isError ? (
            <ErrorState
              description={getErrorMessage(cardsQuery.error, "Kartlar yüklenemedi.")}
              onRetry={() => cardsQuery.refetch()}
            />
          ) : (
            <DataTable
              columns={columns}
              data={items}
              getRowId={(row) => String(row.id)}
              isLoading={cardsQuery.isLoading}
              emptyTitle="Kart bulunamadı"
              emptyDescription="Filtreleri gevşetmeyi dene ya da desteye yeni not ekle."
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              renderMobileRow={(row) => (
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label="Kartı seç"
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 h-4 w-4 accent-indigo-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                      {row.front}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {deckNames.get(row.deck_id) ?? `#${row.deck_id}`} ·{" "}
                      {STATE_LABELS[row.state]}
                      {row.suspended ? " · askıda" : ""}
                      {row.due_at ? ` · ${formatDateTime(row.due_at)}` : ""}
                    </p>
                  </div>
                </div>
              )}
            />
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
