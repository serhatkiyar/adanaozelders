// Oturumsuz kargo takip sayfası — müşteriye SMS ile gönderilen token'lı link
// (kargotakip.adanaozelders.com.tr/<token>) buraya düşer. Giriş GEREKTİRMEZ.
//
// Terminoloji: üst kavram SİPARİŞ'tir, müşteriye ayrı "gönderi no" verilmez.
// Taşıyıcı firmalar "gönderi" der çünkü siparişi bilmezler; bizim emsalimiz
// kendi kuryesiyle çalışan Getir/Trendyol/Amazon — onlar "sipariş" der ve
// siparişin altında teslimatları listeler. Sayfa da bu yapıdadır:
// Sipariş No → Durum → Tahmini teslimat → Teslimat(lar) → Sipariş/Teslimat.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import L from "leaflet";

import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { DeliveryFeedbackSection } from "@/components/store/DeliveryFeedbackSection";
import { DeliveryPrefControls } from "@/components/store/DeliveryPrefControls";
import { usePublicOrderTracking } from "@/hooks/useDelivery";
import { stopsAheadIncreased } from "@/lib/trackingSignals";
import { formatEtaWindow, formatEventTime, proofLabel } from "@/lib/deliveryTimeline";
import { tileSource } from "@/lib/mapTiles";
import type { OrderTracking, OrderTrackingStatus, Shipment } from "@/types";

const homeIcon = L.divIcon({
  className: "",
  html: `<div style="background:#0f172a;color:white;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"/></svg></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const courierIcon = L.divIcon({
  className: "",
  html: `<div style="background:#f97316;color:white;width:32px;height:32px;border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"/></svg></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const STEPS = ["Hazırlanıyor", "Dağıtımda", "Teslim edildi"] as const;

const dayFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});
const weekdayFmt = new Intl.DateTimeFormat("tr-TR", { weekday: "long" });
const shortDayFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" });

/** "2026-09-04" → "04 Eylül 2026 Cuma" (takip sayfasında yıl da yazar). */
function fullDate(isoDate?: string | null): string | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return `${dayFmt.format(d)} ${weekdayFmt.format(d)}`;
}

function shortDate(isoDate?: string | null): string | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return shortDayFmt.format(d);
}

function stepIndex(status: OrderTrackingStatus): number {
  if (status === "DELIVERED") return 2;
  if (status === "EN_ROUTE" || status === "FAILED") return 1;
  return 0; // NOT_DISPATCHED ve POSTPONED: yeniden "hazırlanıyor"
}

/** Durum şeridi — dolu daireler + aradaki bağlantı çubuğu. */
function Stepper({ status }: { status: OrderTrackingStatus }) {
  const active = stepIndex(status);
  const failed = status === "FAILED";
  return (
    <div className="flex items-start">
      {STEPS.map((label, i) => {
        const reached = i <= active;
        const dotFailed = failed && i === active;
        return (
          <div key={label} className="flex flex-1 items-start last:flex-none">
            <div className="flex w-14 flex-col items-center gap-2">
              <span
                className={[
                  "h-9 w-9 rounded-full",
                  dotFailed ? "bg-amber-500" : reached ? "bg-orange-500" : "bg-slate-200",
                ].join(" ")}
              />
              <span
                className={[
                  "text-center text-[11px] leading-tight",
                  reached ? "font-medium text-slate-700" : "text-slate-400",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                className={[
                  "mt-4 h-1.5 flex-1 rounded-full",
                  i < active ? "bg-orange-500" : "bg-slate-200",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Bölüm başlığı — turuncu yazı + altında saç-teli çizgi. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-orange-200 pb-2 text-lg font-semibold text-orange-600 sm:text-base">
      {children}
    </h2>
  );
}

const COPY: Record<OrderTrackingStatus, string> = {
  NOT_DISPATCHED: "Siparişin hazırlanıyor",
  EN_ROUTE: "Siparişin kuryede, yolda",
  DELIVERED: "Siparişin teslim edildi",
  FAILED: "Bugün teslim edilemedi",
  POSTPONED: "Teslimat isteğinle ertelendi",
};

const SHIPMENT_LABEL: Record<OrderTrackingStatus, string> = {
  NOT_DISPATCHED: "Hazırlanıyor",
  EN_ROUTE: "Yolda",
  DELIVERED: "Teslim edildi",
  FAILED: "Teslim edilemedi",
  POSTPONED: "Ertelendi",
};

/** Teslimat kartı — "1. Teslimat · 2 ürün · Teslim edildi, 4 Eylül".
 *  Bugün her siparişte tek kart; kısmi teslimat geldiğinde liste çoğullaşır. */
function ShipmentRow({ s, tek }: { s: Shipment; tek: boolean }) {
  const adet = s.items.reduce((toplam, i) => toplam + i.quantity, 0);
  const teslim = s.delivered_at ? formatEventTime(s.delivered_at) : null;
  const soz = shortDate(s.promised_date);
  const alt =
    s.status === "DELIVERED"
      ? teslim
      : soz
        ? `Tahmini ${soz}`
        : "Temin ediliyor, hazır olunca haber vereceğiz";

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-slate-900">
          {tek ? "Teslimat" : `${s.no}. Teslimat`}
          <span className="font-normal text-slate-400"> · {adet} ürün</span>
        </p>
        <p
          className={[
            "text-sm",
            s.status === "DELIVERED"
              ? "font-medium text-emerald-700"
              : s.status === "FAILED"
                ? "font-medium text-amber-600"
                : "text-slate-600",
          ].join(" ")}
        >
          {SHIPMENT_LABEL[s.status]}
          {alt && <span className="text-slate-400"> · {alt}</span>}
        </p>
      </div>
      <ul className="mt-2 space-y-1">
        {s.items.map((i) => (
          <li key={`${i.title}-${i.quantity}`} className="text-sm text-slate-500">
            {i.title}
            {i.quantity > 1 && <span className="text-slate-400"> × {i.quantity}</span>}
          </li>
        ))}
      </ul>
    </li>
  );
}

/** Kurye kimlik kartı — sakin satır: foto + isim + plaka. */
function CourierCard({ t }: { t: OrderTracking }) {
  if (!t.courier_name) return null;
  return (
    <div className="flex items-center gap-3 text-left">
      {t.courier_photo_url ? (
        <img
          src={t.courier_photo_url}
          alt={t.courier_name}
          className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
        />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500">
          {t.courier_name.charAt(0).toLocaleUpperCase("tr")}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{t.courier_name}</p>
        <p className="text-xs text-slate-500">Kuryen</p>
      </div>
      {t.courier_plate && (
        <span className="shrink-0 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs font-semibold tracking-wider text-slate-700">
          {t.courier_plate}
        </span>
      )}
    </div>
  );
}

/** Sipariş / Teslimat sekmeleri — "Gönderen" yok, kendi filomuzla teslimatta
 *  gönderen her zaman biziz. */
function OrderTabs({ t }: { t: OrderTracking }) {
  const [tab, setTab] = useState<"siparis" | "teslimat">("siparis");
  const tabBtn = (key: "siparis" | "teslimat", label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={[
        "flex-1 px-4 py-2.5 text-sm font-medium transition sm:flex-none sm:px-8",
        tab === key ? "bg-orange-500 text-white" : "text-slate-500 hover:text-slate-800",
      ].join(" ")}
    >
      {label}
    </button>
  );

  const rows: [string, string][] =
    tab === "siparis"
      ? [["Sipariş No", t.order_no ?? "-"]]
      : [
          ["Alıcı", t.recipient_masked ?? "-"],
          ["Adres", t.address_masked ?? "-"],
        ];

  return (
    <div>
      <div className="flex border-b-2 border-orange-500">
        {tabBtn("siparis", "Sipariş")}
        {tabBtn("teslimat", "Teslimat")}
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <dt className="w-24 shrink-0 text-orange-600 sm:w-32">{label}</dt>
            <dd className="min-w-0 flex-1 text-slate-700">
              <span className="mr-3 text-slate-400">:</span>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function CargoTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const { data: t, isLoading, isError } = usePublicOrderTracking(token ?? null);

  // PDS E8: kurye bir durağı sona atınca "önünde N durak" ARTABİLİR. Sayacı
  // sessizce büyütmek yerine "sıra güncellendi" mikro-metnini gösteririz.
  const prevAhead = useRef<number | null>(null);
  const [reordered, setReordered] = useState(false);
  useEffect(() => {
    const next = t?.stops_ahead ?? null;
    if (stopsAheadIncreased(prevAhead.current, next)) {
      setReordered(true);
      const timer = setTimeout(() => setReordered(false), 12_000);
      prevAhead.current = next;
      return () => clearTimeout(timer);
    }
    prevAhead.current = next;
  }, [t?.stops_ahead]);

  const bounds = useMemo(() => {
    if (!t) return null;
    const pts: [number, number][] = [];
    if (t.ship_lat != null && t.ship_lng != null) pts.push([t.ship_lat, t.ship_lng]);
    if (t.courier_lat != null && t.courier_lng != null)
      pts.push([t.courier_lat, t.courier_lng]);
    return pts.length ? L.latLngBounds(pts).pad(0.3) : null;
  }, [t]);

  const etaWindow = formatEtaWindow(t?.eta_window_start, t?.eta_window_end);
  const promisedDay = fullDate(t?.promised_delivery_date);
  const etaText =
    [promisedDay, etaWindow].filter(Boolean).join(", ") || "Teslimat planlanıyor";
  const shipments = t?.shipments ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <Seo title="Kargo Takip, Adana Özel Ders" noindex />

      <div className="border-b border-slate-200 bg-white px-4 pb-5 pt-6 sm:px-6">
        <Link to={ROUTES.home} className="inline-flex items-center">
          <img src="/logo.svg" alt="Adana Özel Ders" className="h-9 w-auto object-contain" />
        </Link>
      </div>
      <div className="bg-orange-500 px-4 py-3 shadow-sm sm:px-6">
        <h1 className="text-base font-semibold tracking-tight text-white">Kargo Takip</h1>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-slate-200 border-t-orange-500" />
          </div>
        ) : isError || !t ? (
          <div className="py-20 text-center">
            <p className="text-base font-medium text-slate-800">Takip bilgisi bulunamadı</p>
            <p className="mt-2 text-sm text-slate-500">
              Bağlantı geçersiz ya da süresi dolmuş olabilir. Lütfen sana gönderilen
              SMS'teki bağlantıyı kontrol et.
            </p>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 pb-4">
              <p className="text-lg text-slate-500">
                Sipariş No :{" "}
                <span className="font-semibold text-slate-900">{t.order_no ?? "-"}</span>
              </p>
            </div>

            <section className="pt-7">
              <SectionTitle>Sipariş Durumu</SectionTitle>
              <p className="mt-3 text-sm text-slate-600">{COPY[t.status]}</p>
              <div className="mt-4 sm:max-w-sm">
                <Stepper status={t.status} />
              </div>

              {t.status === "EN_ROUTE" && (
                <>
                  <div className="mt-5 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-slate-200 px-4 py-1.5 text-xs">
                    <span className="font-medium text-slate-700">
                      {t.stops_ahead != null && t.stops_ahead > 0
                        ? `Kuryenin gelmesine ${t.stops_ahead} durak var`
                        : "Sıradaki teslimat sensin"}
                      {t.total_stops != null && t.stops_ahead != null && t.stops_ahead > 0 && (
                        <span className="font-normal text-slate-400">
                          {" "}
                          · toplam {t.total_stops}
                        </span>
                      )}
                    </span>
                    {t.courier_age_seconds != null && (
                      <span className="text-slate-400">
                        son sinyal{" "}
                        {t.courier_age_seconds < 5
                          ? "az önce"
                          : `${t.courier_age_seconds} sn önce`}
                      </span>
                    )}
                  </div>
                  {reordered && (
                    <p className="mt-2 text-xs text-amber-600">
                      Teslimat sırası güncellendi, kuryen az sonra sende.
                    </p>
                  )}
                </>
              )}

              {t.status === "DELIVERED" && t.proof_photo_url && (
                <a
                  href={t.proof_photo_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-block"
                  title="Büyütmek için tıkla"
                >
                  <img
                    src={t.proof_photo_url}
                    alt="Teslim kanıtı fotoğrafı"
                    className="max-h-48 rounded-xl object-cover ring-1 ring-slate-200"
                  />
                </a>
              )}
            </section>

            <section className="pt-8">
              <SectionTitle>Tahmini Teslimat Zamanı</SectionTitle>
              <p className="mt-3 text-sm text-slate-700">
                {t.status === "DELIVERED" && t.delivered_at
                  ? [formatEventTime(t.delivered_at), proofLabel(t.proof)]
                      .filter(Boolean)
                      .join(" · ")
                  : etaText}
              </p>
            </section>

            {shipments.length > 0 && (
              <section className="pt-8">
                <SectionTitle>
                  {shipments.length > 1 ? `Teslimatlar (${shipments.length})` : "Teslimat"}
                </SectionTitle>
                <ul className="mt-3 divide-y divide-slate-100">
                  {shipments.map((s) => (
                    <ShipmentRow key={s.no} s={s} tek={shipments.length === 1} />
                  ))}
                </ul>
              </section>
            )}

            {t.status === "EN_ROUTE" && t.courier_name && (
              <section className="pt-8">
                <SectionTitle>Kuryen</SectionTitle>
                <div className="mt-4">
                  <CourierCard t={t} />
                </div>
                {bounds && (
                  <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-slate-200">
                    <MapContainer
                      bounds={bounds}
                      style={{ height: 320, width: "100%", zIndex: 0 }}
                      attributionControl={false}
                      scrollWheelZoom={false}
                    >
                      <TileLayer
                        url={tileSource().url}
                        attribution={tileSource().attribution}
                      />
                      {t.ship_lat != null && t.ship_lng != null && (
                        <Marker position={[t.ship_lat, t.ship_lng]} icon={homeIcon} />
                      )}
                      {t.courier_lat != null && t.courier_lng != null && (
                        <Marker
                          position={[t.courier_lat, t.courier_lng]}
                          icon={courierIcon}
                        />
                      )}
                    </MapContainer>
                  </div>
                )}
              </section>
            )}

            <section className="pt-8">
              <OrderTabs t={t} />
            </section>

            {token && (
              <section className="pt-8">
                <DeliveryPrefControls t={t} mode={{ kind: "token", token }} />
              </section>
            )}

            {t.status === "DELIVERED" && token && (
              <section className="pt-8">
                <DeliveryFeedbackSection
                  mode="token"
                  token={token}
                  canFeedback={t.can_feedback}
                  feedbackGiven={t.feedback_given}
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
