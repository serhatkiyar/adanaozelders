import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Button, EmptyState, PageSkeleton } from "@/components/admin/ui";

export interface DataTableProps<TData extends object> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  getRowId: (row: TData) => string;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  isLoading?: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  /**
   * Boş durumdaki eylem — tipik kullanımı "Filtreleri temizle".
   *
   * "Kayıt yok" ile "sonuç yok" FARKLI ekranlardır: ilki bir davet ("ilk
   * ürünü ekleyin"), ikincisi bir düzeltme talimatı ("filtreyi değiştirin").
   * İkisini aynı metinle göstermek kullanıcıyı "veri kayboldu" sanısına
   * sürükler. Çağıran taraf hangisinde olduğunu bilir (filtre var mı?), bu
   * yüzden karar burada değil orada verilir; bileşen yalnız eylemi taşır.
   */
  emptyAction?: ReactNode;
  /**
   * Tavana dayanmış liste uyarısı ("ilk N kayıt gösteriliyor").
   *
   * Sayfalaması olan listede VERİLMEZ — orada zaten toplam sayı görünüyor ve
   * uyarı yanıltıcı olur.
   */
  truncationNotice?: ReactNode;
  onRowClick?: (row: TData) => void;
  renderMobileRow?: (row: TData) => ReactNode;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

function SortIndicator({ direction }: { direction: false | "asc" | "desc" }) {
  return (
    <span aria-hidden="true" className="ml-1 inline-flex w-3 justify-center text-[10px] text-slate-400">
      {direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕"}
    </span>
  );
}

export function DataTable<TData extends object>({
  columns,
  data,
  getRowId,
  sorting = [],
  onSortingChange,
  isLoading = false,
  emptyTitle,
  emptyDescription,
  emptyAction,
  truncationNotice,
  onRowClick,
  renderMobileRow,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: DataTableProps<TData>) {
  const table = useReactTable({
    columns,
    data,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    state: { sorting },
    onSortingChange,
    manualSorting: true,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  if (isLoading && data.length === 0) return <PageSkeleton rows={6} />;
  if (data.length === 0) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
    );
  }

  const activateRow = (row: Row<TData>) => onRowClick?.(row.original);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {truncationNotice}
      {renderMobileRow && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
          {table.getRowModel().rows.map((row) => (
            onRowClick ? (
              <button
                key={row.id}
                type="button"
                onClick={() => activateRow(row)}
                className="block w-full px-4 py-4 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-800/60"
              >
                {renderMobileRow(row.original)}
              </button>
            ) : (
              <div key={row.id} className="px-4 py-4">
                {renderMobileRow(row.original)}
              </div>
            )
          ))}
        </div>
      )}

      <div className={renderMobileRow ? "hidden overflow-x-auto md:block" : "overflow-x-auto"}>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/50">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const direction = header.column.getIsSorted();
                  return (
                    <th key={header.id} scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIndicator direction={direction} />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={() => activateRow(row)}
                onKeyDown={(event) => {
                  if (onRowClick && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    activateRow(row);
                  }
                }}
                className={onRowClick ? "cursor-pointer transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-800/60" : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {firstItem}–{lastItem} / {total} kayıt
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            Sayfa başına
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          {/* İP-A4: ham `<button>` yerine ortak `Button`. Sayfalama düğmeleri
              panelin EN ÇOK tekrar eden düğmeleriydi ve odak halkası,
              `disabled` opaklığı, dokunma yüksekliği burada elle yazılmıştı —
              yani ortak sistemden ayrı yaşıyorlardı. */}
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Önceki
          </Button>
          <span className="min-w-16 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">{page} / {totalPages}</span>
          <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            Sonraki
          </Button>
        </div>
      </footer>
    </div>
  );
}
