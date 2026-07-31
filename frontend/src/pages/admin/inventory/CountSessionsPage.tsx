// Sayım oturumları listesi — durum filtresi + zorunlu sayfalama.
//
// Renk tek başına durum anlatmaz: her satırda rozetin METNİ de vardır.
//
// ⚠ Bilinen boşluk: liste ucu (`GET /inventory/count-sessions`) satır
// taşımadığı için "ürün/satır sayısı" ve "STALE göstergesi" bu ekranda
// GÖSTERİLEMİYOR. Oturum oturum detay çekmek N+1 istek olurdu; sahte sayı
// üretmek daha kötü olurdu. Kapsam gereği backend sözleşmesi bu commit'te
// açılmadı — commit 8 raporu §15'te bulgu olarak kayıtlı.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Badge, Button, Dialog, EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { useCountSessions, useCreateCountSession } from "@/hooks/useInventory";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import { inventoryErrorMessage, sessionStatusBadge, type CountScope, type CountSessionStatus } from "@/lib/inventory";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";

import type { CountSessionOut } from "@/api/inventory";

const PAGE_SIZE = 25;

const TARIH = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DURUMLAR: { value: "" | CountSessionStatus; label: string }[] = [
  { value: "", label: "Tüm durumlar" },
  { value: "DRAFT", label: "Taslak" },
  { value: "IN_PROGRESS", label: "Sayım sürüyor" },
  { value: "REVIEW", label: "İncelemede" },
  { value: "APPLIED", label: "Uygulandı" },
  { value: "CANCELLED", label: "İptal edildi" },
];

const KAPSAM: Record<CountScope, string> = {
  ALL: "Tüm ürünler",
  CATEGORY: "Kategori",
  MANUAL: "Seçili ürünler",
};

function Satir({ oturum }: { oturum: CountSessionOut }) {
  const rozet = sessionStatusBadge(oturum.status);
  return (
    <li data-testid={`session-row-${oturum.id}`}>
      <Link
        to={ROUTES.adminInventoryCount(oturum.id)}
        className="flex flex-wrap items-center gap-3 px-6 py-3.5 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-800/60"
      >
        <div className="min-w-0 flex-1 basis-44">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{oturum.code}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            <span data-testid="scope">{KAPSAM[oturum.scope] ?? oturum.scope}</span>
            {" · "}
            <span data-testid="created-by">Açan: #{oturum.created_by_admin_id}</span>
          </p>
        </div>
        <span
          data-testid="created-at"
          className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400"
        >
          {TARIH.format(new Date(oturum.created_at))}
        </span>
        <Badge tone={rozet.tone} className="shrink-0">
          {rozet.label}
        </Badge>
      </Link>
    </li>
  );
}

function YeniSayimDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<CountScope>("MANUAL");
  const [urunler, setUrunler] = useState("");
  const [kategori, setKategori] = useState("");
  const [not, setNot] = useState("");
  const olustur = useCreateCountSession();

  const idler = urunler
    .split(/[\s,]+/)
    .map((p) => Number(p))
    .filter((n) => Number.isInteger(n) && n > 0);

  const gecerli =
    scope === "ALL" ||
    (scope === "MANUAL" && idler.length > 0) ||
    (scope === "CATEGORY" && Number(kategori) > 0);

  const gonder = () => {
    olustur.mutate(
      {
        scope,
        product_ids: scope === "MANUAL" ? idler : undefined,
        category_id: scope === "CATEGORY" ? Number(kategori) : undefined,
        note: not.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("Sayım oturumu açıldı.");
          onClose();
        },
        onError: (e) => toast.error(inventoryErrorMessage(e, "Sayım oturumu açılamadı.")),
      }
    );
  };

  return (
    <Dialog
      open={open}
      title="Yeni sayım oturumu"
      description="Kapsamı seçin. Oturum taslak olarak açılır; sayıma başlamadan ürün ekleyebilirsiniz."
      onClose={() => !olustur.isPending && onClose()}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            Kapsam
          </span>
          <select
            className="input"
            value={scope}
            onChange={(e) => setScope(e.target.value as CountScope)}
          >
            <option value="MANUAL">Seçili ürünler</option>
            <option value="CATEGORY">Kategori</option>
            <option value="ALL">Tüm ürünler</option>
          </select>
        </label>

        {scope === "MANUAL" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
              Ürün numaraları
            </span>
            <input
              className="input"
              value={urunler}
              onChange={(e) => setUrunler(e.target.value)}
              placeholder="12, 34, 56"
              inputMode="numeric"
            />
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Virgül veya boşlukla ayırın. {idler.length > 0 && `${idler.length} ürün seçildi.`}
            </span>
          </label>
        )}

        {scope === "CATEGORY" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
              Kategori numarası
            </span>
            <input
              className="input"
              value={kategori}
              onChange={(e) => setKategori(e.target.value)}
              inputMode="numeric"
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            Not (isteğe bağlı)
          </span>
          <input className="input" value={not} onChange={(e) => setNot(e.target.value)} />
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={olustur.isPending} onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={!gecerli} isPending={olustur.isPending} onClick={gonder}>
            Oturumu aç
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function CountSessionsPage() {
  const [params, setParams] = useSearchParams();
  const durum = (params.get("durum") ?? "") as "" | CountSessionStatus;
  const sayfa = Math.max(0, Number(params.get("sayfa") ?? 0));
  const [yeniAcik, setYeniAcik] = useState(false);
  const { canCount } = useInventoryAccess();

  const sorgu = useCountSessions({
    status: durum,
    limit: PAGE_SIZE,
    offset: sayfa * PAGE_SIZE,
  });

  const oturumlar = sorgu.data?.items ?? [];
  const toplam = sorgu.data?.total ?? 0;
  const sonSayfa = (sayfa + 1) * PAGE_SIZE >= toplam;

  const guncelle = (yeni: Record<string, string>) => {
    const sonraki = new URLSearchParams(params);
    Object.entries(yeni).forEach(([k, v]) => (v ? sonraki.set(k, v) : sonraki.delete(k)));
    setParams(sonraki, { replace: true });
  };

  const yeniButon = (
    <Button size="sm" onClick={() => setYeniAcik(true)}>
      Yeni sayım
    </Button>
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Sayım oturumları</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Detay için satıra tıklayın. Fark yalnız inceleme sonrası uygulanır.
          </p>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Duruma göre
          </span>
          <select
            className="input w-auto"
            value={durum}
            onChange={(e) => guncelle({ durum: e.target.value, sayfa: "" })}
          >
            {DURUMLAR.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        {canCount && yeniButon}
      </div>

      {sorgu.isError ? (
        <div className="p-6">
          <ErrorState
            description={inventoryErrorMessage(sorgu.error, "Sayım oturumları yüklenemedi.")}
            onRetry={() => sorgu.refetch()}
          />
        </div>
      ) : sorgu.isLoading ? (
        <div className="p-6">
          <PageSkeleton rows={4} />
        </div>
      ) : oturumlar.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title={durum ? "Bu durumda oturum yok" : "Henüz sayım oturumu açılmadı"}
            description={
              durum
                ? "Farklı bir durum seçin ya da filtreyi kaldırın."
                : "Sayım, rafta gerçekten ne olduğunu kayda geçirir. Kapsamı seçip bir oturum açın."
            }
            action={canCount ? yeniButon : undefined}
          />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {oturumlar.map((o) => (
              <Satir key={o.id} oturum={o} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-6 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span className="mr-auto tabular-nums">
              {sayfa * PAGE_SIZE + 1}–{sayfa * PAGE_SIZE + oturumlar.length} / {toplam} oturum
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={sayfa === 0}
              onClick={() => guncelle({ sayfa: String(sayfa - 1) })}
            >
              Önceki
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={sonSayfa}
              onClick={() => guncelle({ sayfa: String(sayfa + 1) })}
            >
              Sonraki
            </Button>
          </div>
        </>
      )}

      <YeniSayimDialog open={yeniAcik} onClose={() => setYeniAcik(false)} />
    </section>
  );
}
