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
import { promisedDateLabel } from "@/lib/deliveryPromise";
import {
  TIMELINE_LABELS,
  formatEtaWindow,
  formatEventTime,
  proofLabel,
} from "@/lib/deliveryTimeline";
import type { OrderTracking, OrderTrackingStatus } from "@/types";

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

/** Kurye kimlik kartı — sakin satır: foto + isim + plaka (kart yığını değil). */
function CourierCard({ t }: { t: OrderTracking }) {
  if (!t.courier_name) return null;
  return (
    <div className="mx-6 mb-5 flex items-center gap-3 border-t border-slate-100 pt-4 text-left dark:border-slate-800">
      {t.courier_photo_url ? (
        <img
          src={t.courier_photo_url}
          alt={t.courier_name}
          className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
        />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          {t.courier_name.charAt(0).toLocaleUpperCase("tr")}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
          {t.courier_name}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">Cıncık Teslimat kuryen</p>
      </div>
      {t.courier_plate && (
        <span className="shrink-0 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs font-semibold tracking-wider text-slate-700 dark:border-slate-600 dark:text-slate-200">
          {t.courier_plate}
        </span>
      )}
    </div>
  );
}

/** Olay akışı — dikey, saç-teli çizgili; bilinmeyen kodlar sessizce atlanır. */
function Timeline({ t }: { t: OrderTracking }) {
  const events = (t.timeline ?? []).filter((e) => TIMELINE_LABELS[e.code]);
  if (events.length === 0) return null;
  return (
    <div className="border-t border-slate-100 px-6 py-5 text-left dark:border-slate-800">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Sipariş geçmişi
      </h2>
      <ol className="mt-3">
        {events.map((e, i) => {
          const last = i === events.length - 1;
          return (
            <li key={`${e.code}-${e.at}`} className="relative flex gap-3 pb-4 last:pb-0">
              {!last && (
                <span className="absolute left-[5px] top-4 h-full w-px bg-slate-200 dark:bg-slate-800" />
              )}
              <span
                className={[
                  "relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full ring-2 ring-white dark:ring-slate-900",
                  last
                    ? "bg-indigo-500"
                    : "bg-slate-300 dark:bg-slate-700",
                ].join(" ")}
              />
              <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                <span
                  className={[
                    "text-sm",
                    last
                      ? "font-medium text-slate-900 dark:text-white"
                      : "text-slate-600 dark:text-slate-300",
                  ].join(" ")}
                >
                  {TIMELINE_LABELS[e.code]}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-slate-500">
                  {formatEventTime(e.at)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
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
              {(t.tracking_no || t.recipient_masked) && (
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-100 px-6 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <span>
                    {t.tracking_no ? (
                      <>
                        Gönderi no{" "}
                        <span className="font-mono font-medium text-slate-700 dark:text-slate-200">
                          {t.tracking_no}
                        </span>
                      </>
                    ) : (
                      "Cıncık Teslimat"
                    )}
                  </span>
                  {t.recipient_masked && <span>Alıcı: {t.recipient_masked}</span>}
                </div>
              )}

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

                {t.status === "NOT_DISPATCHED" && t.promised_delivery_date && (
                  <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
                    Söz verilen teslimat:{" "}
                    <span className="font-medium">
                      {promisedDateLabel(t.promised_delivery_date)}
                    </span>
                  </p>
                )}

                {t.status === "EN_ROUTE" && (
                  <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-slate-200 px-4 py-1.5 text-xs dark:border-slate-800">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {t.stops_ahead != null && t.stops_ahead > 0
                        ? `Kuryenin gelmesine ${t.stops_ahead} durak var`
                        : "Sıradaki teslimat sensin"}
                      {t.total_stops != null && t.stops_ahead != null && t.stops_ahead > 0 && (
                        <span className="font-normal text-slate-400 dark:text-slate-500">
                          {" "}
                          · toplam {t.total_stops}
                        </span>
                      )}
                    </span>
                    {formatEtaWindow(t.eta_window_start, t.eta_window_end) && (
                      <span className="text-slate-500 dark:text-slate-400">
                        {formatEtaWindow(t.eta_window_start, t.eta_window_end)}
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

                {t.status === "DELIVERED" && t.delivered_at && (
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    {formatEventTime(t.delivered_at)}
                    {proofLabel(t.proof) && (
                      <>
                        {" — "}
                        {proofLabel(t.proof)}
                      </>
                    )}
                  </p>
                )}
                {t.status === "DELIVERED" && t.proof_photo_url && (
                  <a
                    href={t.proof_photo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block"
                    title="Büyütmek için tıkla"
                  >
                    <img
                      src={t.proof_photo_url}
                      alt="Teslim kanıtı fotoğrafı"
                      className="mx-auto max-h-48 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                    />
                  </a>
                )}
              </div>

              {t.status === "EN_ROUTE" && <CourierCard t={t} />}

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

              <Timeline t={t} />
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
