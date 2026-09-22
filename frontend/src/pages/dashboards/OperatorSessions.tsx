import { useState } from "react";
import { Button } from "@/components/admin/ui";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { OPERATOR_NAV } from "@/lib/nav";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import { useOperatorMe, useVerifyAttendance } from "@/hooks/useLibraryExams";
import { useLibraryAdminDetail } from "@/hooks/useLibraries";
import {
  useAttendStudyReservation,
  useManageStudyReservations,
} from "@/hooks/useStudy";
import { ErrorState } from "@/components/admin/ui/PageState";
import { gunlereGrupla, yoklamaSayaci } from "@/lib/operatorAgenda";
import { formatDateTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { AttendanceResult } from "@/types";
import { ADSIZ_UYE } from "@/lib/roles";

const cardCls =
  "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ";

export default function OperatorSessions() {
  const { data: op, isLoading } = useOperatorMe();
  const { data: lib } = useLibraryAdminDetail(op?.library_id);
  const isActive = lib?.status === "ACTIVE";

  return (
    <DashboardShell title="Oturumlar" navItems={OPERATOR_NAV}>
      <div className="mx-auto max-w-3xl space-y-5">
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100 " />
        ) : !isActive ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 ">
            Deneme oturumları, katılım doğrulama ve çalışma rezervasyonları kütüphanen{" "}
            <strong>onaylandıktan</strong> sonra açılır. Bu sırada{" "}
            <Link to={ROUTES.operatorLibrary} className="font-semibold underline">
              profilini tamamla
            </Link>
            .
          </div>
        ) : (
          op && (
            <>
              <OperatorSessionsQrKart />
              <div className={cardCls}>
                <ExamSessionsManager libraryId={op.library_id} />
              </div>
              <StudyReservationsCard libraryId={op.library_id} />
            </>
          )
        )}
      </div>
    </DashboardShell>
  );
}

/* ── Katılım doğrulama (rezervasyon kodu) ── */
/** Testten doğrudan render edilebilsin diye dışa açık (bkz.
 *  `operatorKodDogrulama.test.tsx`) — sayfanın geri kalanı operatör
 *  oturumu ve kütüphane çekimi ister. */
export function OperatorSessionsQrKart() {
  const verify = useVerifyAttendance();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<AttendanceResult | null>(null);

  const runVerify = (payload: string) => {
    if (!payload.trim()) return;
    verify.mutate(payload.trim(), {
      onSuccess: (res) => {
        setResult(res);
        setCode("");
        if (res.already) toast.success("Zaten doğrulanmıştı.");
        else toast.success(`${res.client_name} doğrulandı ✓`);
      },
      onError: (e) => {
        setResult(null);
        toast.error(getErrorMessage(e, "Doğrulama başarısız."));
      },
    });
  };

  return (
    <div className={cardCls}>
      <h2 className="mb-3 text-base font-bold text-slate-900 ">Katılım Doğrula</h2>

      <div>
        <p className="mb-1 text-xs font-semibold text-slate-500 ">
          Öğrencinin rezervasyon kodunu gir (USB okuyucu da kullanılabilir)
        </p>
        {/* İP-A7d3: kutu `placeholder`ı etiket yerine kullanıyordu. Elle kod
            girişi bu ekranın YEDEK yoludur (kamera yoksa / iOS Safari'de
            `BarcodeDetector` yokken) ve etiketsiz kalması, tam da yedek yola
            düşen kullanıcıyı yalnız bırakıyordu. */}
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">Rezervasyon kodu</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runVerify(code);
              }}
              placeholder="Rezervasyon kodu…"
              className="input w-full"
            />
          </label>
          <Button
            variant="secondary"
            className="rounded-xl"
            isPending={verify.isPending}
            onClick={() => runVerify(code)}
          >
            Doğrula
          </Button>
        </div>
      </div>

      {result && (
        <div
          className={`mt-4 flex items-center gap-3 rounded-xl px-4 py-3 ${
            result.already
              ? "bg-amber-50 text-amber-700 "
              : "bg-emerald-50 text-emerald-700 "
          }`}
        >
          <svg className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            {result.already ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            )}
          </svg>
          <div>
            <p className="text-sm font-bold">{result.client_name}</p>
            <p className="text-xs">
              {result.exam_title} · {result.message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Çalışma alanı rezervasyonları (yaklaşan, güne göre gruplu) ──
   Eskiden tüm gelecek tek düz listeydi: tarih başlığı, sayaç ve gün ayrımı
   yoktu (ölçüm §6.1/2). Operatör "bugün kim geliyor" sorusunu listeyi gözle
   tarayarak cevaplıyordu. Gruplama saf katmandadır (`lib/operatorAgenda`) ve
   gün sınırı Türkiye saatiyle hesaplanır. */
function StudyReservationsCard({ libraryId }: { libraryId: number }) {
  const { data, isLoading, isError, refetch } = useManageStudyReservations(libraryId);
  const attend = useAttendStudyReservation();

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-2xl bg-slate-100 " />;
  }
  if (isError) {
    return (
      <div className={cardCls}>
        <h2 className="mb-3 text-base font-bold text-slate-900 ">
          Çalışma Alanı Rezervasyonları
        </h2>
        <div data-testid="rez-hata">
          <ErrorState
            description="Rezervasyon listesi yüklenemedi. Bu bir bağlantı/yetki hatasıdır: listenin boş olduğu anlamına GELMEZ."
            onRetry={() => void refetch()}
          />
        </div>
      </div>
    );
  }

  const doAttend = (id: number, name: string) => {
    attend.mutate(id, {
      onSuccess: (res) =>
        toast.success(res.already ? `${name} zaten giriş yapmıştı.` : `${name} giriş yaptı ✓`),
      onError: (e) => toast.error(getErrorMessage(e, "Doğrulama başarısız.")),
    });
  };

  const gruplar = gunlereGrupla(
    (data ?? []).map((r) => ({ ...r, startsAt: r.starts_at, endsAt: r.ends_at })),
    new Date()
  );

  return (
    <div className={cardCls}>
      <h2 className="mb-3 text-base font-bold text-slate-900 ">
        Çalışma Alanı Rezervasyonları (yaklaşan)
      </h2>

      {gruplar.length === 0 ? (
        <p data-testid="rez-bos" className="py-6 text-center text-sm text-slate-400 ">
          Yaklaşan çalışma rezervasyonu yok.
        </p>
      ) : (
        <div className="space-y-4">
          {gruplar.map((grup) => {
            const sayac = yoklamaSayaci(grup.items);
            return (
              <section key={grup.kova} data-testid={`rez-grup-${grup.kova}`}>
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 pb-1.5 ">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 ">
                    {grup.label}
                  </h3>
                  <span className="text-xs text-slate-400 ">
                    <b data-testid="grup-sayaci" className="font-semibold text-slate-600 ">
                      {grup.items.length}
                    </b>{" "}
                    kayıt · {sayac.giren} giriş
                  </span>
                </div>
                <ul className="divide-y divide-slate-200 ">
                  {grup.items.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-800 ">
                          {r.client_name ?? ADSIZ_UYE}
                        </p>
                        <p className="truncate text-xs text-slate-500 ">
                          {formatDateTime(r.starts_at)} – {formatDateTime(r.ends_at)}
                        </p>
                      </div>
                      {r.status === "ATTENDED" ? (
                        <span className="shrink-0 text-xs font-semibold text-emerald-600">
                          Giriş yaptı ✓
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="success"
                          className="shrink-0"
                          isPending={attend.isPending}
                          onClick={() => doAttend(r.id, r.client_name ?? ADSIZ_UYE)}
                        >
                          Giriş ver
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
