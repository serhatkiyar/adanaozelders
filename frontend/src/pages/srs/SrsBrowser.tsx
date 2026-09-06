import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { DashboardShell } from "@/components/DashboardShell";
import { DataTable } from "@/components/admin/data-table/DataTable";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { ErrorState } from "@/components/admin/ui/PageState";
import {
  SrsCardFlags,
  SrsSuspendedSummary,
} from "@/components/srs/SrsCardFlags";
import { SrsDueLabel } from "@/components/srs/SrsDueLabel";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDebounce } from "@/hooks/useDebounce";
import { useBulkSrsCards, useSrsCards, useSrsDecks, useSrsTags } from "@/hooks/useSrs";
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

/**
 * Satır içi filtre denetimi: ortak `.input` (index.css) + tam genişliğin
 * kaldırılması. Yerel kopya bilinçli olarak SİLİNDİ — `focus:ring-indigo-100`
 * ile bitiyor, dark karşılığı yoktu ve odaklanan girdi koyu temada beyaz hale
 * alıyordu; ayrıca aynı ekranda iki farklı koyu zemin (slate-700 ↔ slate-800)
 * karışıyordu.
 */
const CONTROL_CLS = "input w-auto";

/** Toplu işlem barındaki daraltılmış denetimler. */
const BULK_CONTROL_CLS = `${CONTROL_CLS} py-1.5 text-xs`;

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

  // Deste detayındaki "Tümünü tarayıcıda aç" bağlantısı buraya ?deste= ile
  // gelir; ilk deste filtresi oradan okunur.
  const [searchParams] = useSearchParams();
  const [deckId, setDeckId] = useState(() => searchParams.get("deste") ?? "");
  const [state, setState] = useState("");
  const [tag, setTag] = useState("");
  const [suspended, setSuspended] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [targetDeckId, setTargetDeckId] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [confirming, setConfirming] = useState<
    | { action: SrsBulkAction; extra?: { target_deck_id?: number }; title: string; description: string }
    | null
  >(null);

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
  const suspendedTotal = cardsQuery.data?.suspended_total ?? 0;
  const leechTotal = cardsQuery.data?.leech_total ?? 0;

  const allDecks = useMemo(
    () => [...(decksQuery.data?.own ?? []), ...(decksQuery.data?.assigned ?? [])],
    [decksQuery.data]
  );
  const deckNames = useMemo(
    () => new Map(allDecks.map((d) => [d.id, d.name])),
    [allDecks]
  );

  const resetPage = () => setPage(1);

  /**
   * VERİ RİSKİ düzeltmesi: filtre değişince seçim TEMİZLENİR.
   *
   * Önceden seçim yalnız işlem sonrası sıfırlanıyordu. 20 kart seçip desteyi
   * (ya da durumu/etiketi/aramayı) değiştiren kullanıcıda bar hâlâ "20 kart
   * seçili" diyordu ve toplu işlem EKRANDA GÖRÜNMEYEN kartlara uygulanıyordu —
   * askıya alma/taşıma geri alınması zor bir yanlış hedefe gidiyordu.
   * Sayfa değişimi bilinçli olarak DIŞARIDA: sayfalar arası seçim birikmesi
   * kullanıcının gördüğü kümede kalır ve `toggleAll` yalnız sayfayı ekler.
   */
  useEffect(() => {
    setSelected(new Set());
  }, [deckId, state, tag, q, suspended]);

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
          setConfirming(null);
        },
        onError: (err) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
      }
    );
  };

  /**
   * Askıya alma ve deste taşıma ONAY İSTER: ikisi de tek tıkla çok sayıda kartı
   * kullanıcının göremediği bir duruma sokar ve geri alma düğmesi yoktur.
   * (Göm/etiket işlemleri tek tıkla geri alınabildiği için onaysız kalır.)
   */
  const askSuspend = () =>
    setConfirming({
      action: "suspend",
      title: "Kartlar askıya alınsın mı?",
      description: `${selected.size} kart askıya alınacak; askıdaki kartlar çalışma kuyruğuna hiç girmez. "Askıdan çıkar" ile geri alabilirsin.`,
    });

  const askMove = () => {
    if (!targetDeckId) {
      toast.error("Hedef deste seç.");
      return;
    }
    const name = deckNames.get(Number(targetDeckId)) ?? `#${targetDeckId}`;
    setConfirming({
      action: "move_deck",
      extra: { target_deck_id: Number(targetDeckId) },
      title: "Kartlar taşınsın mı?",
      description: `${selected.size} kart "${name}" destesine taşınacak. Kartların çalışma ilerlemesi korunur ama hedef destenin günlük limitlerine tabi olurlar.`,
    });
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
            className="h-4 w-4 accent-marka"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label="Kartı seç"
            checked={selected.has(row.original.id)}
            onChange={() => toggle(row.original.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 accent-marka"
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
            <SrsCardFlags
              suspended={row.original.suspended}
              isLeech={row.original.is_leech}
            />
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "due",
        header: "Vade",
        cell: ({ row }) => (
          <SrsDueLabel
            state={row.original.state}
            dueAt={row.original.due_at}
          />
        ),
        enableSorting: false,
      },
      {
        id: "tags",
        header: "Etiketler",
        cell: ({ row }) =>
          row.original.tags.length > 0 ? (
            <span className="block max-w-40 truncate text-xs text-slate-500 ">
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
            className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover "
          >
            ← Aralıklı Tekrar
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 ">
            Kart Tarayıcı
          </h1>
          <SrsSuspendedSummary
            suspendedTotal={suspendedTotal}
            leechTotal={leechTotal}
            onShowSuspended={() => {
              setSuspended("true");
              resetPage();
            }}
          />
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
            className={`${CONTROL_CLS} w-48`}
          />
          <select
            value={deckId}
            onChange={(e) => {
              setDeckId(e.target.value);
              resetPage();
            }}
            aria-label="Deste filtresi"
            className={CONTROL_CLS}
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
            className={CONTROL_CLS}
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
            className={CONTROL_CLS}
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
            className={CONTROL_CLS}
          >
            <option value="">Askı: hepsi</option>
            <option value="true">Yalnız askıda</option>
            <option value="false">Askıda olmayan</option>
          </select>
        </div>

        {/* Toplu işlem barı — uzun listede kaybolmasın diye başlığın (sticky
            top-0 z-40) hemen altına yapışır. Kaydırılan içerik altından
            geçmesin diye sayfa zeminini taşıyan bir kılıfın içinde durur. */}
        {selected.size > 0 && (
          <div className="sticky top-16 z-30 -mx-1 mt-4 bg-slate-50 px-1 py-1 ">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-marka-line bg-marka-soft px-4 py-3 text-sm ">
            <span className="font-semibold text-marka-metin-hover ">
              {selected.size} kart seçili
            </span>
            <span className="mx-1 hidden h-4 w-px bg-marka-line sm:block" />
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
                onClick={() => (action === "suspend" ? askSuspend() : runBulk(action))}
                disabled={bulk.isPending}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-marka-metin-hover transition hover:bg-marka-line disabled:opacity-50 "
              >
                {label}
              </button>
            ))}
            <span className="flex items-center gap-1">
              <select
                value={targetDeckId}
                onChange={(e) => setTargetDeckId(e.target.value)}
                aria-label="Hedef deste"
                className={BULK_CONTROL_CLS}
              >
                <option value="">Hedef deste…</option>
                {(decksQuery.data?.own ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                onClick={askMove}
                disabled={bulk.isPending}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-marka-metin-hover transition hover:bg-marka-line disabled:opacity-50 "
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
                className={`${BULK_CONTROL_CLS} w-28`}
              />
              <button
                onClick={() =>
                  bulkTag.trim()
                    ? runBulk("add_tag", { tag: bulkTag.trim() })
                    : toast.error("Etiket yaz.")
                }
                disabled={bulk.isPending}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-marka-metin-hover transition hover:bg-marka-line disabled:opacity-50 "
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
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-marka-metin-hover transition hover:bg-marka-line disabled:opacity-50 "
              >
                Etiket çıkar
              </button>
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 "
            >
              Seçimi temizle
            </button>
          </div>
          </div>
        )}

        {/* Mobilde tablo başlığı (dolayısıyla "hepsini seç" kutusu) hiç
            çizilmiyor; sayfa seçimi burada sunulur. */}
        {items.length > 0 && (
          <div className="mt-4 md:hidden">
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-marka-soft-fg transition hover:bg-marka-soft "
            >
              {allOnPageSelected
                ? `Sayfa seçimini kaldır (${items.length})`
                : `Sayfadakileri seç (${items.length})`}
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
                    className="mt-1 h-4 w-4 accent-marka"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800 ">
                      {row.front}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 ">
                      {deckNames.get(row.deck_id) ?? `#${row.deck_id}`} ·{" "}
                      {STATE_LABELS[row.state]}
                      {row.suspended ? " · askıda" : ""}
                      {row.is_leech ? " · takıldın" : ""}
                      {row.due_at ? (
                        <>
                          {" · "}
                          <SrsDueLabel state={row.state} dueAt={row.due_at} />
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
              )}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.title ?? ""}
        description={confirming?.description ?? ""}
        confirmLabel={confirming?.action === "move_deck" ? "Taşı" : "Askıya al"}
        danger
        isPending={bulk.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() =>
          confirming && runBulk(confirming.action, confirming.extra)
        }
      />
    </DashboardShell>
  );
}
