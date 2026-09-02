// Oturumsuz kargo takip sayfası — müşteriye SMS ile gönderilen token'lı link
// (kargotakip.adanaozelders.com.tr/<token>) buraya düşer. Giriş GEREKTİRMEZ.
// YENİDEN TASARIM: üstte tam genişlik marka şeridi, altında Takip No →
// Gönderi Durumu → Tahmini Teslimat Zamanı → Gönderi/Alıcı sekmeleri.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { usePublicOrderTracking } from "@/hooks/useDelivery";
import { formatEtaWindow, formatEventTime, proofLabel } from "@/lib/deliveryTimeline";
import type { OrderTracking, OrderTrackingStatus } from "@/types";

const STEPS = ["Hazırlanıyor", "Dağıtımda", "Teslim edildi"] as const;

const dayFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});
const weekdayFmt = new Intl.DateTimeFormat("tr-TR", { weekday: "long" });

/** "2026-09-04" → "04 Eylül 2026 Cuma" (takip sayfasında yıl da yazar). */
function promisedFullDate(isoDate?: string | null): string | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return `${dayFmt.format(d)} ${weekdayFmt.format(d)}`;
}

function stepIndex(status: OrderTrackingStatus): number {
  if (status === "DELIVERED") return 2;
  if (status === "EN_ROUTE" || status === "FAILED") return 1;
  return 0; // NOT_DISPATCHED ve POSTPONED: yeniden "hazırlanıyor"
}

/** Durum şeridi — dolu daireler + aradaki bağlantı çubuğu (referans tasarım). */
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
                  dotFailed
                    ? "bg-amber-500"
                    : reached
                      ? "bg-orange-500"
                      : "bg-slate-200",
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

/** Bölüm başlığı — turuncu yazı + altında saç-teli çizgi (referans tasarım). */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-orange-200 pb-1.5 text-base font-semibold text-orange-600">
      {children}
    </h2>
  );
}

const COPY: Record<OrderTrackingStatus, string> = {
  NOT_DISPATCHED: "Siparişin hazırlanıyor",
  EN_ROUTE: "Gönderin kuryede, yolda",
  DELIVERED: "Gönderin teslim edildi",
  FAILED: "Bugün teslim edilemedi",
  POSTPONED: "Teslimat isteğinle ertelendi",
};

/** Gönderi / Alıcı sekmeleri — "Gönderen" yok, kendi-filo teslimatta anlamsız. */
function ShipmentTabs({ t }: { t: OrderTracking }) {
  const [tab, setTab] = useState<"gonderi" | "alici">("gonderi");
  const tabBtn = (key: "gonderi" | "alici", label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={[
        "px-8 py-2.5 text-sm font-medium transition",
        tab === key
          ? "bg-orange-500 text-white"
          : "text-slate-500 hover:text-slate-800",
      ].join(" ")}
    >
      {label}
    </button>
  );

  const rows: [string, string][] =
    tab === "gonderi"
      ? [["Gönderi No", t.tracking_no ?? "—"]]
      : [
          ["Alıcı", t.recipient_masked ?? "—"],
          ["Adres", t.address_masked ?? "—"],
        ];

  return (
    <div>
      <div className="flex border-b-2 border-orange-500">
        {tabBtn("gonderi", "Gönderi")}
        {tabBtn("alici", "Alıcı")}
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <dt className="w-32 shrink-0 text-orange-600">{label}</dt>
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

  const etaWindow = formatEtaWindow(t?.eta_window_start, t?.eta_window_end);
  const promisedDay = promisedFullDate(t?.promised_delivery_date);
  const etaText =
    [promisedDay, etaWindow].filter(Boolean).join(", ") || "Teslimat planlanıyor";

  return (
    <div className="min-h-screen bg-slate-50">
      <Seo title="Kargo Takip, Adana Özel Ders" noindex />

      <div className="border-b border-slate-200 bg-white px-6 pb-5 pt-6">
        <Link to={ROUTES.home} className="inline-flex items-center">
          <img src="/logo.svg" alt="Adana Özel Ders" className="h-9 w-auto object-contain" />
        </Link>
      </div>
      <div className="bg-orange-500 px-6 py-3 shadow-sm">
        <h1 className="text-base font-semibold tracking-tight text-white">Kargo Takip</h1>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8">
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
                Takip No :{" "}
                <span className="font-semibold text-slate-900">
                  {t.tracking_no ?? "—"}
                </span>
              </p>
            </div>

            <section className="pt-7">
              <SectionTitle>Gönderi Durumu</SectionTitle>
              <p className="mt-3 text-sm text-slate-600">{COPY[t.status]}</p>
              <div className="mt-4 max-w-sm">
                <Stepper status={t.status} />
              </div>
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

            <section className="pt-8">
              <ShipmentTabs t={t} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
