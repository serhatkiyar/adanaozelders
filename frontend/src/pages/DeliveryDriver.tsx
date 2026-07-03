// Dağıtıcı saha ekranı (mobil, ADMIN) — "vur-kaç" akışı.
// Araçta şoför sürer, dağıtıcı bu ekranı kullanır: sıradaki durağı görür,
// "Yol Tarifi Al" Google Maps'i açar (adım-adım navigasyon YAZILMAZ),
// kapıda paket QR'ı doğrulanır + müşteriye SMS'lenen kod girilir → teslim.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { QrScanner } from "@/components/QrScanner";
import {
  useDeliveryRun,
  useFailStop,
  useOverrideDeliver,
  useRunAction,
  useScanDeliveryLabel,
  useSendDeliveryOtp,
  useVerifyDelivery,
} from "@/hooks/useDelivery";
import {
  RUN_STATUS_LABEL,
  STOP_STATUS_LABEL,
  googleNavUrl,
  nextPendingStop,
  runProgress,
} from "@/lib/deliveryRun";
import { formatEta } from "@/lib/polyline";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { DeliveryStop } from "@/types";

/** Teslim anı konumu (kanıt) — alınamazsa konumsuz devam edilir, akış bekletilmez. */
function getCoords(): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 4000 }
    );
  });
}

function apiDetail(e: any, fallback: string): string {
  return e?.response?.data?.detail ?? fallback;
}

/* ─── Aktif durak kartı ──────────────────────────────── */

function CurrentStopCard({ stop }: { stop: DeliveryStop }) {
  const sendOtp = useSendDeliveryOtp();
  const verify = useVerifyDelivery();
  const fail = useFailStop();
  const override = useOverrideDeliver();

  const [code, setCode] = useState("");
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [mode, setMode] = useState<"deliver" | "fail" | "override">("deliver");
  const [note, setNote] = useState("");

  const navUrl = googleNavUrl(stop.lat, stop.lng, stop.address);
  const busy = verify.isPending || fail.isPending || override.isPending;

  const doVerify = async () => {
    if (code.trim().length < 4) return toast.error("Müşterinin söylediği kodu gir.");
    const coords = await getCoords();
    verify.mutate(
      { stopId: stop.id, code: code.trim(), coords },
      {
        onSuccess: () => {
          toast.success("Teslimat doğrulandı ✓");
          setCode("");
          setMaskedPhone(null);
        },
        onError: (e: any) => toast.error(apiDetail(e, "Kod doğrulanamadı.")),
      }
    );
  };

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
        Sıradaki durak · #{stop.sequence}
      </p>
      <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
        {stop.recipient ?? "Alıcı bilinmiyor"}
      </h2>
      <p className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
        {stop.address ?? "Adres yok"}
      </p>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Sipariş #{stop.order_id} ·{" "}
        {stop.items.map((it) => `${it.title} ×${it.quantity}`).join(", ") || "—"}
        {stop.eta && (
          <span className="ml-2 font-semibold text-indigo-600 dark:text-indigo-400">
            tahmini ~{formatEta(stop.eta)}
          </span>
        )}
      </p>

      {/* Birincil aksiyonlar */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {navUrl && (
          <a
            href={navUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="col-span-2 rounded-xl bg-indigo-600 py-3 text-center text-base font-bold text-white hover:bg-indigo-700"
          >
            Yol Tarifi Al
          </a>
        )}
        {stop.phone && (
          <a
            href={`tel:${stop.phone}`}
            className="rounded-xl py-2.5 text-center text-sm font-semibold text-slate-700 ring-1 ring-slate-200 dark:text-slate-200 dark:ring-slate-600"
          >
            Müşteriyi Ara
          </a>
        )}
        <button
          onClick={() =>
            sendOtp.mutate(stop.id, {
              onSuccess: (r) => {
                setMaskedPhone(r.masked_phone);
                toast.success(`Kod gönderildi (${r.masked_phone}).`);
              },
              onError: (e: any) => toast.error(apiDetail(e, "Kod gönderilemedi.")),
            })
          }
          disabled={sendOtp.isPending}
          className="rounded-xl py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-50 dark:text-slate-200 dark:ring-slate-600"
        >
          {sendOtp.isPending ? "Gönderiliyor…" : "Müşteriye Kod Gönder"}
        </button>
      </div>

      {/* Teslim / sorun akışları */}
      {mode === "deliver" && (
        <div className="mt-4 space-y-2">
          {maskedPhone && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Kod {maskedPhone} numarasına gitti — müşteri kodu söylesin.
            </p>
          )}
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="6 haneli kod"
              className="input flex-1 text-center text-lg tracking-[0.3em]"
            />
            <button
              onClick={doVerify}
              disabled={busy}
              className="rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Teslim Et
            </button>
          </div>
          <div className="flex justify-between pt-1 text-xs">
            <button
              onClick={() => setMode("override")}
              className="font-medium text-slate-500 hover:underline dark:text-slate-400"
            >
              Kod ulaşmıyor mu?
            </button>
            <button
              onClick={() => setMode("fail")}
              className="font-medium text-rose-600 hover:underline dark:text-rose-400"
            >
              Teslim edilemedi
            </button>
          </div>
        </div>
      )}

      {mode === "fail" && (
        <div className="mt-4 space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Neden teslim edilemedi? (adres bulunamadı, kimse yok…)"
            rows={2}
            className="input w-full"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                fail.mutate(
                  { stopId: stop.id, reason: note.trim() },
                  {
                    onSuccess: () => {
                      toast.success("Durak 'teslim edilemedi' olarak işaretlendi.");
                      setNote("");
                      setMode("deliver");
                    },
                    onError: (e: any) => toast.error(apiDetail(e, "İşaretlenemedi.")),
                  }
                )
              }
              disabled={busy || note.trim().length < 3}
              className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Onayla
            </button>
            <button
              onClick={() => setMode("deliver")}
              className="rounded-xl px-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 dark:text-slate-300 dark:ring-slate-600"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {mode === "override" && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            SMS ulaşmadıysa: teslimi notla kayda geçir (kanıt "yönetici onayı" olur).
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Not (ör. müşteri kimliğiyle doğrulandı, kod SMS'i gelmedi)"
            rows={2}
            className="input w-full"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                override.mutate(
                  { stopId: stop.id, note: note.trim() },
                  {
                    onSuccess: () => {
                      toast.success("Notlu teslim kaydedildi.");
                      setNote("");
                      setMode("deliver");
                    },
                    onError: (e: any) => toast.error(apiDetail(e, "Kaydedilemedi.")),
                  }
                )
              }
              disabled={busy || note.trim().length < 3}
              className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
            >
              Notlu Teslim
            </button>
            <button
              onClick={() => setMode("deliver")}
              className="rounded-xl px-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 dark:text-slate-300 dark:ring-slate-600"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sayfa ──────────────────────────────────────────── */

export default function DeliveryDriver() {
  const { id } = useParams();
  const runId = Number(id);
  const { data: run, isLoading } = useDeliveryRun(
    Number.isFinite(runId) ? runId : null,
    { poll: true }
  );
  const runAction = useRunAction();
  const scanLabel = useScanDeliveryLabel();
  const [showScanner, setShowScanner] = useState(false);

  if (isLoading || !run) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
        {isLoading ? "Tur yükleniyor…" : "Tur bulunamadı."}
      </div>
    );
  }

  const current = nextPendingStop(run);
  const [done, total] = runProgress(run);

  const onScan = (value: string) => {
    setShowScanner(false);
    scanLabel.mutate(value, {
      onSuccess: ({ stop }) => {
        if (stop.run_id !== run.id) {
          toast.error(`Bu paket başka bir turun (#${stop.run_id}).`);
        } else if (current && stop.id === current.id) {
          toast.success(`Doğru paket ✓ — ${stop.recipient ?? `#${stop.order_id}`}`);
        } else {
          toast.info(
            `Bu paket ${stop.sequence}. durağın (${stop.recipient ?? "?"}) — sıradaki ${current ? `#${current.sequence}` : "yok"}.`
          );
        }
      },
      onError: (e: any) => toast.error(apiDetail(e, "Etiket tanınamadı.")),
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-10 dark:bg-slate-900">
      {/* Üst çubuk */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <Link
            to={ROUTES.home}
            className="text-sm font-semibold text-slate-500 dark:text-slate-400"
          >
            ← Panel
          </Link>
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            Tur #{run.id} · {done}/{total}
          </p>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {RUN_STATUS_LABEL[run.status]}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {run.status !== "ACTIVE" ? (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700">
            {run.status === "PLANNED"
              ? "Tur henüz başlatılmadı — admin panelinden başlatın."
              : "Bu tur sonuçlandı."}
          </p>
        ) : current ? (
          <>
            <CurrentStopCard key={current.id} stop={current} />
            <button
              onClick={() => setShowScanner(true)}
              className="w-full rounded-xl py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 dark:text-slate-200 dark:ring-slate-600"
            >
              Paket QR'ını Okut
            </button>
            {showScanner && (
              <QrScanner onScan={onScan} onClose={() => setShowScanner(false)} />
            )}
          </>
        ) : (
          <div className="space-y-3 rounded-2xl bg-white p-6 text-center ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Tüm duraklar sonuçlandı 🎉
            </p>
            <button
              onClick={() =>
                runAction.mutate(
                  { runId: run.id, action: "complete" },
                  {
                    onSuccess: () => toast.success("Tur tamamlandı."),
                    onError: (e: any) =>
                      toast.error(apiDetail(e, "Tamamlanamadı.")),
                  }
                )
              }
              disabled={runAction.isPending}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Turu Tamamla
            </button>
          </div>
        )}

        {/* Durak listesi */}
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white px-4 ring-1 ring-slate-100 dark:divide-slate-700 dark:bg-slate-800 dark:ring-slate-700">
          {[...run.stops]
            .sort((a, b) => a.sequence - b.sequence)
            .map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <span
                  className={`w-6 text-right text-sm font-semibold tabular-nums ${
                    current?.id === s.id
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-slate-400"
                  }`}
                >
                  {s.sequence}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                  {s.recipient ?? `Sipariş #${s.order_id}`}
                </p>
                {s.eta && s.status === "PENDING" && (
                  <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-slate-500">
                    ~{formatEta(s.eta)}
                  </span>
                )}
                <span
                  className={`text-xs font-medium ${
                    s.status === "DELIVERED"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : s.status === "FAILED"
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-slate-400"
                  }`}
                >
                  {STOP_STATUS_LABEL[s.status]}
                </span>
              </li>
            ))}
        </ul>
      </main>
    </div>
  );
}
