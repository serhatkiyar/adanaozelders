// Kurye açılış ekranı (rol 5) — menüsüz, tek amaçlı: güncel tura götür.
// ACTIVE tur varsa doğrudan saha ekranına yönlendirir; bugünün PLANNED'ı varsa
// "yönetici başlatınca açılacak" bekleme hâli; atanmamışsa sakin boş durum.
// Kurye tur listesi/panel görmez — minimum yetkili yüzey.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useCourierWorkspace } from "@/hooks/useDelivery";
import { useAuthStore } from "@/store/authStore";
import { ROUTES } from "@/lib/routes";
import { FullScreenSpinner } from "@/components/Spinner";

export default function CourierHome() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const { data: ws, isLoading, isError, refetch, isRefetching } = useCourierWorkspace();

  const activeRunId = ws?.run?.status === "ACTIVE" ? ws.run.id : null;
  useEffect(() => {
    if (activeRunId != null) {
      navigate(ROUTES.deliveryRun(activeRunId), { replace: true });
    }
  }, [activeRunId, navigate]);

  if (isLoading) return <FullScreenSpinner />;

  const courier = ws?.courier ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 ">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 ">
        <div className="flex items-center gap-3">
          {/* Kurye kimlik kartı — müşterinin takip sayfasında gördüğü kimlik */}
          {courier?.photo_url ? (
            <img
              src={courier.photo_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-slate-200 "
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 ">
              {(ws?.account.first_name?.[0] ?? "K").toLocaleUpperCase("tr-TR")}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-slate-900 ">
              {ws ? `${ws.account.first_name} ${ws.account.last_name}` : "Kurye"}
            </p>
            <p className="text-xs text-slate-500 ">
              Kurye
            </p>
          </div>
        </div>
        <button
          onClick={() => logout()}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 "
        >
          Çıkış
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center px-6">
        {isError ? (
          <div className="text-center">
            <p className="text-sm text-slate-500 ">
              Bilgiler alınamadı — bağlantını kontrol edip yeniden dene.
            </p>
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="mt-3 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 "
            >
              {isRefetching ? "Deneniyor…" : "Yeniden Dene"}
            </button>
          </div>
        ) : ws?.run?.status === "PLANNED" ? (
          <div className="text-center">
            <p className="text-base font-semibold text-slate-900 ">
              Bugünün turu hazırlanıyor
            </p>
            <p className="mt-2 max-w-xs text-sm text-slate-500 ">
              {ws.run.stops.length} duraklık tur planlandı — yönetici başlatınca
              bu ekran kendiliğinden açılacak.
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-base font-semibold text-slate-900 ">
              Bugün için atanmış bir turun yok
            </p>
            <p className="mt-2 max-w-xs text-sm text-slate-500 ">
              Tur atandığında burada görünecek — sayfa kendini yeniler.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
