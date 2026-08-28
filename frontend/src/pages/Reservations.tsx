import { useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import { useCheckoutResultToast } from "@/hooks/useCheckoutResult";
import { StudentBookingsContent } from "./StudentBookings";
import { TicketsContent } from "./Tickets";

const TABS = [
  { key: "bookings", label: "Dersler" },
  { key: "tickets", label: "Biletler" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function Reservations() {
  useCheckoutResultToast(); // iyzico dönüşü: ?odeme=basarili|basarisiz
  const [activeTab, setActiveTab] = useState<Tab>("bookings");

  return (
    <DashboardShell title="Rezervasyonlar" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-5xl px-1 pb-16 pt-2 sm:px-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Rezervasyonlar
        </h1>
        <p className="mt-1 text-sm text-slate-500 ">
          Derslerini, deneme biletlerini ve çalışma alanı girişlerini tek yerden yönet.
        </p>

        {/* Sekmeler — nötr underline (renk yalnız aksiyonlarda) */}
        <div className="mb-8 mt-6 flex gap-7 border-b border-slate-200 ">
          {TABS.map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`-mb-px border-b-2 pb-3 text-sm font-semibold transition ${
                  active
                    ? "border-slate-900 text-slate-900 "
                    : "border-transparent text-slate-500 hover:text-slate-800 "
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {activeTab === "bookings" ? <StudentBookingsContent /> : <TicketsContent />}
      </div>
    </DashboardShell>
  );
}
