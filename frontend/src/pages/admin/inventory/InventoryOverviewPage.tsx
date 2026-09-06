// Envanter girişi — operasyon özeti.
//
// Sahte dashboard ÜRETİLMEZ: özet ucu yok, o yüzden bütün veriyi istemciye
// çekip saymıyoruz. Gösterilen her sayı sunucunun kendi `total` alanından
// gelir (durum filtreli liste isteği, `limit=1`). "STALE satır içeren oturum"
// sayacı BİLEREK yok — liste ucu satır taşımıyor ve oturum oturum detay
// çekmek N+1 istek demek olurdu.
import { Link } from "react-router-dom";

import { ErrorState } from "@/components/admin/ui";
import { useCountSessions, useDamageEvents } from "@/hooks/useInventory";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import {
  damageKindPastLabel,
  damageReasonLabel,
  inventoryErrorMessage,
} from "@/lib/inventory";
import { ROUTES } from "@/lib/routes";

const TARIH = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function Sayac({
  baslik,
  sayi,
  aciklama,
  to,
  yukleniyor,
}: {
  baslik: string;
  sayi: number | undefined;
  aciklama: string;
  to: string;
  yukleniyor: boolean;
}) {
  return (
    <Link
      to={to}
      className="block rounded-2xl border border-slate-200 bg-white px-5 py-4 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus "
    >
      <p className="text-xs font-medium text-slate-500 ">{baslik}</p>
      <p
        className="mt-1 text-2xl font-bold tabular-nums text-slate-900 "
        aria-busy={yukleniyor || undefined}
      >
        {yukleniyor ? "…" : (sayi ?? "—")}
      </p>
      <p className="mt-1 text-xs text-slate-500 ">{aciklama}</p>
    </Link>
  );
}

export default function InventoryOverviewPage() {
  const { canView } = useInventoryAccess();
  const suren = useCountSessions({ status: "IN_PROGRESS", limit: 1, offset: 0 }, canView);
  const inceleme = useCountSessions({ status: "REVIEW", limit: 1, offset: 0 }, canView);
  const hasar = useDamageEvents({ limit: 5, offset: 0 }, canView);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Sayac
          baslik="Sayım sürüyor"
          sayi={suren.data?.total}
          aciklama="Miktar girişi devam eden oturumlar."
          to={`${ROUTES.adminInventoryCounts}?durum=IN_PROGRESS`}
          yukleniyor={suren.isLoading}
        />
        <Sayac
          baslik="İnceleme bekliyor"
          sayi={inceleme.data?.total}
          aciklama="Gönderilmiş, farkı uygulanmayı bekleyen oturumlar."
          to={`${ROUTES.adminInventoryCounts}?durum=REVIEW`}
          yukleniyor={inceleme.isLoading}
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white ">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 ">
          <div className="mr-auto">
            <h2 className="text-base font-bold text-slate-900 ">
              Son hasar olayları
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 ">
              Hasara ayırma, kurtarma, imha ve tedarikçi iadesi kayıtları.
            </p>
          </div>
          <Link
            to={ROUTES.adminInventoryDamage}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-panel-accent-text transition hover:bg-panel-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus "
          >
            Tümü
          </Link>
        </div>
        {hasar.isError ? (
          <div className="p-6">
            <ErrorState
              description={inventoryErrorMessage(hasar.error, "Hasar olayları yüklenemedi.")}
              onRetry={() => hasar.refetch()}
            />
          </div>
        ) : hasar.data && hasar.data.items.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500 ">
            Henüz hasar olayı kaydedilmedi.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 ">
            {(hasar.data?.items ?? []).map((olay) => (
              <li key={olay.id} className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
                <span className="font-medium text-slate-900 ">
                  {damageKindPastLabel(olay.kind)}
                </span>
                <span className="text-slate-500 ">
                  Ürün #{olay.product_id} · {olay.qty} adet
                </span>
                <span className="text-xs text-slate-400 ">
                  {damageReasonLabel(olay.reason_code)}
                </span>
                <span className="ml-auto text-xs tabular-nums text-slate-400 ">
                  {TARIH.format(new Date(olay.created_at))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white px-6 py-5 ">
        <h2 className="text-base font-bold text-slate-900 ">İlgili ekranlar</h2>
        <p className="mt-0.5 text-xs text-slate-500 ">
          Sayım ve hasar işlemleri hareket kaydı üretir; kayıtların kendisi salt okunurdur.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to={ROUTES.adminStoreStock}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus "
          >
            Stok hareketleri
          </Link>
          <Link
            to={ROUTES.adminAuditLogs}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus "
          >
            Denetim kayıtları
          </Link>
        </div>
      </section>
    </div>
  );
}
