// Oturumsuz kargo takip sayfası — müşteriye SMS ile gönderilen token'lı link
// (kargotakip.adanaozelders.com.tr/<token>) buraya düşer. Giriş GEREKTİRMEZ.
// Dağıtımdayken kurye konumu + kaç durak önde + tahmini varış canlı (15 sn poll);
// diğer durumlarda sade durum şeridi. Kendi-filo teslimat (ELDEN) — dış kargo linki yok.
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import L from "leaflet";

import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { usePublicOrderTracking } from "@/hooks/useDelivery";
import { formatEta } from "@/lib/polyline";
import type { OrderTrackingStatus } from "@/types";

const homeIcon = L.divIcon({
  className: "",
  html: `<div style="background:#0f172a;color:white;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"/></svg></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const courierIcon = L.divIcon({
  className: "",
  html: `<div style="background:#6366f1;color:white;width:32px;height:32px;border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"/></svg></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const STEPS = ["Hazırlanıyor", "Dağıtımda", "Teslim edildi"] as const;

function stepIndex(status: OrderTrackingStatus): number {
  if (status === "DELIVERED") return 2;
  if (status === "EN_ROUTE" || status === "FAILED") return 1;
  return 0;
}

function Stepper({ status }: { status: OrderTrackingStatus }) {
  const active = stepIndex(status);
  const failed = status === "FAILED";
  return (
    <div className="flex items-center">
      {STEPS.map((label, i) => {
        const done = i < active || status === "DELIVERED";
        const current = i === active && status !== "DELIVERED";
        const dotFailed = failed && i === active;
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={[
                  "flex h-3 w-3 rounded-full",
                  dotFailed
                    ? "bg-amber-500"
                    : done || current
                      ? "bg-indigo-500"
                      : "bg-slate-300 dark:bg-slate-700",
                ].join(" ")}
              >
                {current && !failed && (
                  <span className="absolute h-3 w-3 animate-ping rounded-full bg-indigo-400 opacity-60" />
                )}
              </span>
              <span
                className={[
                  "text-[11px]",
                  done || current
                    ? "font-medium text-slate-700 dark:text-slate-200"
                    : "text-slate-400 dark:text-slate-500",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                className={[
                  "mx-2 mb-5 h-px flex-1",
                  i < active ? "bg-indigo-400" : "bg-slate-200 dark:bg-slate-800",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const COPY: Record<
  OrderTrackingStatus,
  { title: string; sub: string; tone: "neutral" | "live" | "done" | "warn" }
> = {
  NOT_DISPATCHED: {
    title: "Siparişin hazırlanıyor",
    sub: "Paketin dağıtıma çıktığında bu sayfada kuryeyi canlı takip edebilirsin.",
    tone: "neutral",
  },
  EN_ROUTE: {
    title: "Kuryemiz dağıtımda",
    sub: "Paketin yolda — kuryeyi haritada canlı izleyebilirsin.",
    tone: "live",
  },
  DELIVERED: {
    title: "Teslim edildi",
    sub: "Siparişin teslim edildi. İyi çalışmalar dileriz!",
    tone: "done",
  },
  FAILED: {
    title: "Bugün teslim edilemedi",
    sub: "Kuryemiz adresinde sana ulaşamadı; teslimat yeniden planlanacak.",
    tone: "warn",
  },
};

export default function CargoTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const { data: t, isLoading, isError } = usePublicOrderTracking(token ?? null);

  const bounds = useMemo(() => {
    if (!t) return null;
    const pts: [number, number][] = [];
    if (t.ship_lat != null && t.ship_lng != null) pts.push([t.ship_lat, t.ship_lng]);
    if (t.courier_lat != null && t.courier_lng != null)
      pts.push([t.courier_lat, t.courier_lng]);
    return pts.length ? L.latLngBounds(pts).pad(0.3) : null;
  }, [t]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <Seo title="Kargo Takip — Adana Özel Ders" noindex />
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center justify-center gap-2 text-center">
          <Link
            to={ROUTES.home}
            className="text-sm font-semibold tracking-tight text-slate-900 hover:opacity-70 dark:text-white"
          >
            Adana Özel Ders
          </Link>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span className="text-sm text-slate-500 dark:text-slate-400">Kargo Takip</span>
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <div className="h-7 w-7 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500 dark:border-slate-700 dark:border-t-indigo-400" />
            </div>
          ) : isError || !t ? (
            <div className="px-6 py-20 text-center">
              <p className="text-base font-medium text-slate-800 dark:text-slate-100">
                Takip bilgisi bulunamadı
              </p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Bağlantı geçersiz ya da süresi dolmuş olabilir. Lütfen sana gönderilen
                SMS'teki bağlantıyı kontrol et.
              </p>
            </div>
          ) : (
            <>
              <div className="px-6 pt-7">
                <Stepper status={t.status} />
              </div>

              <div className="px-6 py-6 text-center">
                <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {COPY[t.status].title}
                </h1>
                <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                  {COPY[t.status].sub}
                </p>

                {t.status === "EN_ROUTE" && (
                  <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-slate-200 px-4 py-1.5 text-xs dark:border-slate-800">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {t.stops_ahead != null && t.stops_ahead > 0
                        ? `Senden önce ${t.stops_ahead} teslimat var`
                        : "Sıradaki teslimat sensin"}
                    </span>
                    {t.eta && (
                      <span className="text-slate-500 dark:text-slate-400">
                        tahmini varış ~{formatEta(t.eta)}
                      </span>
                    )}
                    {t.courier_age_seconds != null && (
                      <span className="text-slate-400 dark:text-slate-500">
                        son sinyal{" "}
                        {t.courier_age_seconds < 5
                          ? "az önce"
                          : `${t.courier_age_seconds} sn önce`}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {t.status === "EN_ROUTE" && bounds && (
                <MapContainer
                  bounds={bounds}
                  style={{ height: 320, width: "100%", zIndex: 0 }}
                  attributionControl={false}
                  scrollWheelZoom={false}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {t.ship_lat != null && t.ship_lng != null && (
                    <Marker position={[t.ship_lat, t.ship_lng]} icon={homeIcon} />
                  )}
                  {t.courier_lat != null && t.courier_lng != null && (
                    <Marker position={[t.courier_lat, t.courier_lng]} icon={courierIcon} />
                  )}
                </MapContainer>
              )}
            </>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] text-slate-400 dark:text-slate-600">
          Teslimat platformumuzun kendi aracıyla yapılır. Sorun yaşarsan bizimle
          iletişime geçebilirsin.
        </p>
      </div>
    </div>
  );
}
