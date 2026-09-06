// Denetim kayıtları — arama/filtre + satıra tıklayınca tam kayıt.
//
// ## İP-A7d1 · göç dalgası 1, ekran (c)
//
// Bu ekran tabanda YAPISAL OLARAK TEKTİ: pencere durumu ekranda yaşayıp bir
// bileşene **prop olarak iniyordu** (`selected` → `AuditDetailDialog`ın `log`
// prop'u → `<Dialog open={log !== null}>`). Sayaç bu deseni İP-A6b'ye kadar
// hiç görmüyordu (BULGU-3) ve tüm tabanda tek örneği buydu.
//
// Göçte değişenler:
//
//   1. **Pencere durumu ekranda YOK.** `useDuzenlemeYuzeyi` + `DuzenlemePenceresi`
//      (`ui2/duzenlemeYuzeyi.tsx`): odak tuzağı, ESC, arka plan kilidi,
//      `role="dialog"` + `aria-modal` ortak yüzeyden gelir.
//   2. **Filtreler `useUrlDurumu`da.** Adres parametrelerinin ADLARI korundu
//      (`q`,`target`,`actor`,`rid`,`sort`,`order`,`page`,`limit`) — paylaşılmış
//      eski bağlantılar çalışmaya devam eder. Kazanç: varsayılana eşit değer
//      artık adrese YAZILMIYOR ve filtre değişince sayfa BAŞA dönüyor
//      (eskiden her çağrı yerinde elle `page: 1` yazılıyordu; unutulan bir
//      yerde kullanıcı boş sayfada kalırdı).
//   3. **Boş durum AYRIŞTI**: "filtre eşleşmedi" bir düzeltme talimatıdır ve
//      çıkış yolu (filtreleri temizle) sunar; "hiç kayıt yok" bir durumdur.
//
// ## Değer doğrulama neden hâlâ `parseAdminAuditQuery`
//
// `useUrlDurumu` tip ve varsayılan yönetir, ENUM BEYAZ LİSTESİ tutmaz:
// `?sort=drop_table` gibi bir adres doğrudan isteğe gitmemeli. Doğrulama tek
// kaynakta (`lib/adminOperationsQuery.ts`) kaldı; kanca yalnız adres↔durum
// köprüsünü kurar. İkisini birleştirmek doğrulamayı yirmi bir ekrana
// kopyalamak olurdu.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { ColumnDef, OnChangeFn, SortingState } from "@tanstack/react-table";
import { DataTable } from "@/components/admin/data-table";
import { Badge, Button, ErrorState } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useAdminAuditLogs } from "@/hooks/useAdmin";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { parseAdminAuditQuery, type AdminAuditSort } from "@/lib/adminOperationsQuery";
import type { AuditLogOut } from "@/types";
import { ROL_ETIKETI } from "@/lib/roles";

// (Tarihçe: burada rol 1 "Admin" yazıyordu, diğer iki ekranda "Yönetici" —
//  merkezî kaynak bu tutarsızlığı da kapattı.)
const ACTOR_ROLE_LABEL = ROL_ETIKETI;

/** Adres varsayılanları — anahtar ADLARI eski sürümle birebir aynıdır. */
const VARSAYILAN = {
  q: "",
  target: "",
  actor: "",
  rid: "",
  sort: "created_at",
  order: "desc",
  page: 1,
  limit: 25,
};

function actorLabel(log: AuditLogOut): string {
  return `${ACTOR_ROLE_LABEL[log.actor_role] ?? "Kullanıcı"} #${log.actor_id}`;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400 ">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-700 ">{children}</dd>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 ">{label}</p>
      <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 ">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Tek kaydın tüm yapılandırılmış alanları — satıra tıklayınca açılır.
 *
 * Pencerenin açık/kapalı durumu ARTIK BURAYA PROP OLARAK İNMİYOR: yüzeyin
 * kendisi geliyor. Fark ölçülebilir — `open={log !== null}` bir pencere
 * durumuydu ve ekranın `useState`inde yaşıyordu.
 */
function AuditDetailPenceresi({ yuzey }: { yuzey: DuzenlemeYuzeyiDurumu<AuditLogOut, void> }) {
  const log = yuzey.kayit;
  return (
    <DuzenlemePenceresi yuzey={yuzey} baslik="Denetim kaydı">
      {log && (
        <div>
          <dl className="divide-y divide-slate-100 ">
            <DetailRow label="Aksiyon"><Badge tone="info">{log.action}</Badge></DetailRow>
            <DetailRow label="Hedef">{log.target_type}{log.target_id ? ` #${log.target_id}` : ""}</DetailRow>
            <DetailRow label="Aktör">{actorLabel(log)}</DetailRow>
            <DetailRow label="Zaman">{formatDateTime(log.created_at)}</DetailRow>
            {log.reason && <DetailRow label="Gerekçe">{log.reason}</DetailRow>}
            {log.details && <DetailRow label="Açıklama">{log.details}</DetailRow>}
            {log.ip_address && <DetailRow label="IP">{log.ip_address}</DetailRow>}
            {log.request_id && (
              <DetailRow label="Request ID">
                <code className="break-all text-xs">{log.request_id}</code>
              </DetailRow>
            )}
          </dl>
          {log.before_values && Object.keys(log.before_values).length > 0 && (
            <JsonBlock label="Önce" value={log.before_values} />
          )}
          {log.after_values && Object.keys(log.after_values).length > 0 && (
            <JsonBlock label="Sonra" value={log.after_values} />
          )}
          {log.meta && Object.keys(log.meta).length > 0 && (
            <JsonBlock label="Ek bilgi" value={log.meta} />
          )}
        </div>
      )}
    </DuzenlemePenceresi>
  );
}

export default function AdminAuditLogsPage() {
  // `sort`/`order` FİLTRE DEĞİLDİR: farklı sıralamada olmak boş durumun
  // metnini "filtreyi temizleyin"e çevirmemeli.
  const { degerler, ayarla, temizle, filtreliMi } = useUrlDurumu(VARSAYILAN, {
    sayfaAnahtari: "page",
    filtreDisi: ["page", "limit", "sort", "order"],
  });

  // Adresteki ham değerler doğrulanır (enum beyaz listesi + sayı sınırları).
  const state = useMemo(
    () =>
      parseAdminAuditQuery(
        new URLSearchParams(
          Object.entries(degerler)
            .filter(([, v]) => v !== "" && v !== undefined)
            .map(([k, v]) => [k, String(v)] as [string, string])
        )
      ),
    [degerler]
  );

  // Serbest metin kutuları GÖNDERİMDE adrese yazılır (her tuşta değil):
  // denetim listesi pahalı bir sorgudur ve her harf bir istek üretirdi.
  const [search, setSearch] = useState(state.q);
  const [requestId, setRequestId] = useState(state.requestId);

  const yuzey = useDuzenlemeYuzeyi<AuditLogOut, void>();

  const query = useAdminAuditLogs({
    limit: state.pageSize,
    offset: (state.page - 1) * state.pageSize,
    q: state.q || undefined,
    action: state.action || undefined,
    target_type: state.targetType || undefined,
    actor_id: state.actorId,
    request_id: state.requestId || undefined,
    sort: state.sort,
    order: state.order,
  });

  useEffect(() => setSearch(state.q), [state.q]);
  useEffect(() => setRequestId(state.requestId), [state.requestId]);

  const sorting = useMemo<SortingState>(
    () => [{ id: state.sort, desc: state.order === "desc" }],
    [state.order, state.sort]
  );
  const changeSorting: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const selectedSort = next[0];
    // Tek çağrı = tek geçmiş girdisi; sayfa sıfırlaması kancanın işidir.
    ayarla({
      sort: (selectedSort?.id as AdminAuditSort | undefined) ?? "created_at",
      order: selectedSort?.desc === false ? "asc" : "desc",
    });
  };

  const columns = useMemo<ColumnDef<AuditLogOut, unknown>[]>(() => [
    {
      accessorKey: "action",
      header: "Aksiyon",
      cell: ({ row }) => <Badge tone="info">{row.original.action}</Badge>,
    },
    {
      accessorKey: "target_type",
      header: "Hedef",
      cell: ({ row }) => <span className="font-medium">{row.original.target_type}{row.original.target_id ? ` #${row.original.target_id}` : ""}</span>,
    },
    {
      accessorKey: "actor_id",
      header: "Aktör",
      cell: ({ row }) => <span>{actorLabel(row.original)}</span>,
    },
    {
      id: "details",
      header: "Gerekçe / Açıklama",
      enableSorting: false,
      cell: ({ row }) => {
        const text = row.original.reason || row.original.details;
        return <span className="block max-w-md truncate text-xs text-slate-500" title={text ?? undefined}>{text || "—"}</span>;
      },
    },
    {
      accessorKey: "created_at",
      header: "Zaman",
      cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{formatDateTime(String(getValue()))}</span>,
    },
  ], []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    ayarla({ q: search.trim(), rid: requestId.trim() });
  };

  const filtreleriTemizle = () => {
    setSearch("");
    setRequestId("");
    temizle();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ">
        <div className="grid gap-3 md:grid-cols-[minmax(13rem,1fr)_10rem_8rem_11rem_auto]">
          <input aria-label="Denetim kaydı ara" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Aksiyon, hedef, gerekçe ara" className="input" />
          <input aria-label="Hedef türü" value={degerler.target} maxLength={30} onChange={(event) => ayarla({ target: event.target.value }, { replace: true })} placeholder="Hedef türü" className="input" />
          <input aria-label="Admin kimliği" type="number" min={1} value={degerler.actor} onChange={(event) => ayarla({ actor: event.target.value }, { replace: true })} placeholder="Aktör ID" className="input" />
          <input aria-label="Request ID" value={requestId} maxLength={64} onChange={(event) => setRequestId(event.target.value)} placeholder="Request ID" className="input" />
          <div className="flex gap-2">
            <Button type="submit">Ara</Button>
            <Button variant="ghost" onClick={filtreleriTemizle}>Temizle</Button>
          </div>
        </div>
      </form>

      {query.isError ? (
        <ErrorState description={getErrorMessage(query.error, "Denetim kayıtları yüklenemedi.")} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          getRowId={(row) => String(row.id)}
          sorting={sorting}
          onSortingChange={changeSorting}
          isLoading={query.isLoading}
          /* "Filtre eşleşmedi" ile "hiç kayıt yok" AYRI ekranlardır: ilki bir
             düzeltme talimatı, ikincisi bir durum bildirimi. Aynı metni
             ikisinde de göstermek kullanıcıyı "kayıtlar kayboldu" sanısına
             sürükler. */
          emptyTitle={filtreliMi ? "Bu filtreyle kayıt bulunamadı" : "Denetim kaydı yok"}
          emptyDescription={
            filtreliMi
              ? "Aradığınız ölçütlere uyan bir denetim kaydı yok. Filtreleri temizleyip tüm geçmişe bakabilirsiniz."
              : "Yönetici işlemleri yapıldıkça buraya yazılır; kayıtlar değiştirilemez."
          }
          emptyAction={
            filtreliMi ? (
              <Button size="sm" variant="secondary" onClick={filtreleriTemizle}>
                Filtreleri temizle
              </Button>
            ) : undefined
          }
          onRowClick={(row) => yuzey.ac(row)}
          satirAdi={(row) => `${row.action} — denetim kaydı ayrıntısı`}
          renderMobileRow={(log) => (
            <div>
              <div className="flex items-center justify-between gap-2"><Badge tone="info">{log.action}</Badge><span className="text-xs text-slate-400">{formatDateTime(log.created_at)}</span></div>
              <p className="mt-2 text-sm font-semibold">{log.target_type}{log.target_id ? ` #${log.target_id}` : ""}</p>
              <p className="mt-1 truncate text-xs text-slate-500">{actorLabel(log)} · {log.reason || log.details || "Açıklama yok"}</p>
            </div>
          )}
          page={state.page}
          pageSize={state.pageSize}
          total={query.data?.total ?? 0}
          onPageChange={(page) => ayarla({ page })}
          onPageSizeChange={(size) => ayarla({ limit: size })}
        />
      )}

      <AuditDetailPenceresi yuzey={yuzey} />
    </div>
  );
}
