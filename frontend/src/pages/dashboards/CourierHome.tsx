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
  const { data: ws, isLoading, isError } = useCourierWorkspace();

  const activeRunId = ws?.run?.status === "ACTIVE" ? ws.run.id : null;
  useEffect(() => {
    if (activeRunId != null) {
      navigate(ROUTES.deliveryRun(activeRunId), { replace: true });
    }
  }, [activeRunId, navigate]);

  if (isLoading) return <FullScreenSpinner />;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {ws ? `${ws.account.first_name} ${ws.account.last_name}` : "Kurye"}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cıncık Teslimat · Kurye
          </p>
        </div>
        <button
          onClick={() => logout()}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
        >
          Çıkış
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center px-6">
        {isError ? (
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Bilgiler alınamadı — bağlantını kontrol edip yeniden dene.
          </p>
        ) : ws?.run?.status === "PLANNED" ? (
          <div className="text-center">
            <p className="text-base font-semibold text-slate-900 dark:text-white">
              Bugünün turu hazırlanıyor
            </p>
            <p className="mt-2 max-w-xs text-sm text-slate-500 dark:text-slate-400">
              {ws.run.stops.length} duraklık tur planlandı — yönetici başlatınca
              bu ekran kendiliğinden açılacak.
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-base font-semibold text-slate-900 dark:text-white">
              Bugün için atanmış bir turun yok
            </p>
            <p className="mt-2 max-w-xs text-sm text-slate-500 dark:text-slate-400">
              Tur atandığında burada görünecek — sayfa kendini yeniler.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
