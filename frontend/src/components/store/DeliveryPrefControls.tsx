// Teslimat tercihi + erteleme — İKİ yüzeyde aynı bileşen:
//   mode="token": SMS'ten gelen oturumsuz takip sayfası. Güvenlik: KAPIYA/
//     KOMSUYA burada SEÇİLEMEZ (backend 403 — takip linki sızarsa paket kapıya
//     yönlendirilemesin); çipler kilitli gösterilir, giriş önerilir.
//   mode="order": oturumlu sipariş detayı — tüm tercihler serbest.
// window.prompt/confirm yerine Modal (tasarım dili + iOS uyumu).
import { useState } from "react";
import { Link } from "react-router-dom";

import { Modal } from "@/components/ui/Modal";
import {
  usePostponeOrder,
  usePublicPostpone,
  usePublicSetDeliveryPref,
  useSetOrderDeliveryPref,
} from "@/hooks/useDelivery";
import { PREF_OPTIONS } from "@/lib/deliveryPref";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { DeliveryPref, OrderTracking } from "@/types";

type Mode = { kind: "token"; token: string } | { kind: "order"; orderId: number };

// Token'lı yüzeyde kilitli tercihler (backend 403 — burada dürüstçe kilit).
const TOKEN_LOCKED: DeliveryPref[] = ["KAPIYA_BIRAK", "KOMSUYA_BIRAK"];

export function DeliveryPrefControls({
  t,
  mode,
  loggedIn = false,
}: {
  t: OrderTracking;
  mode: Mode;
  /** Token yüzeyinde giriş durumu — kilitli çip metnini belirler. */
  loggedIn?: boolean;
}) {
  const publicSet = usePublicSetDeliveryPref();
  const publicPostpone = usePublicPostpone();
  const orderSet = useSetOrderDeliveryPref();
  const orderPostpone = usePostponeOrder();

  const [neighborFor, setNeighborFor] = useState<DeliveryPref | null>(null);
  const [neighborNote, setNeighborNote] = useState("");
  const [postponeOpen, setPostponeOpen] = useState(false);

  const setPending = publicSet.isPending || orderSet.isPending;
  const postponePending = publicPostpone.isPending || orderPostpone.isPending;

  if (t.status === "DELIVERED" || (!t.can_postpone && t.status === "FAILED")) return null;
  if (t.status !== "NOT_DISPATCHED" && t.status !== "EN_ROUTE" && t.status !== "POSTPONED")
    return null;

  const current = t.delivery_pref ?? "ADRESIMDEYIM";
  const currentOption = PREF_OPTIONS.find((o) => o.value === current);

  const submitPref = (pref: DeliveryPref, note: string | null) => {
    const opts = {
      onSuccess: () => {
        toast.success("Teslimat tercihin güncellendi.");
        setNeighborFor(null);
        setNeighborNote("");
      },
      onError: (e: unknown) =>
        toast.error(getErrorMessage(e, "Güncellenemedi — bağlantını kontrol et.")),
    };
    if (mode.kind === "token") publicSet.mutate({ token: mode.token, pref, note }, opts);
    else orderSet.mutate({ orderId: mode.orderId, pref, note }, opts);
  };

  const choose = (pref: DeliveryPref) => {
    if (pref === "KOMSUYA_BIRAK") {
      setNeighborNote(t.delivery_pref_note ?? "");
      setNeighborFor(pref);
      return;
    }
    submitPref(pref, pref === "KAPIYA_BIRAK" ? (t.delivery_pref_note ?? null) : null);
  };

  const doPostpone = () => {
    const opts = {
      onSuccess: () => {
        toast.success("Teslimat ertelendi.");
        setPostponeOpen(false);
      },
      onError: (e: unknown) =>
        toast.error(getErrorMessage(e, "Ertelenemedi — hakkın dolmuş olabilir.")),
    };
    if (mode.kind === "token") publicPostpone.mutate(mode.token, opts);
    else orderPostpone.mutate(mode.orderId, opts);
  };

  return (
    <div className="border-t border-slate-100 px-6 py-5 text-left dark:border-slate-800">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Teslimat tercihin
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {PREF_OPTIONS.map((opt) => {
          const selected = current === opt.value;
          const locked = mode.kind === "token" && TOKEN_LOCKED.includes(opt.value) && !selected;
          return (
            <button
              key={opt.value}
              onClick={() => (locked ? undefined : choose(opt.value))}
              disabled={setPending || locked}
              title={
                locked
                  ? "Güvenlik gereği bu tercih yalnız giriş yapılınca seçilebilir"
                  : opt.description
              }
              className={[
                "rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
                selected
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : locked
                    ? "text-slate-400 ring-1 ring-slate-200 dark:text-slate-500 dark:ring-slate-700"
                    : "text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800/60",
              ].join(" ")}
            >
              {opt.emoji} {opt.label}
              {locked && " 🔒"}
            </button>
          );
        })}
      </div>
      {/* Seçili tercihin ne anlama geldiği — müşteri sonucunu bilerek seçsin
          (ör. "Kapıya bırak" fotoğrafla kanıtlanır). */}
      {currentOption && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {currentOption.description}
          {current === "KOMSUYA_BIRAK" && t.delivery_pref_note && (
            <> — Komşu: {t.delivery_pref_note}</>
          )}
        </p>
      )}
      {mode.kind === "token" && !loggedIn && (
        <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          🔒 Kapıya/komşuya bırakma güvenlik gereği{" "}
          <Link to={ROUTES.login} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            giriş yaparak
          </Link>{" "}
          seçilir.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {t.can_postpone && t.status !== "POSTPONED" && (
          <button
            onClick={() => setPostponeOpen(true)}
            disabled={postponePending}
            className="font-semibold text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400"
          >
            Yarına ertele
          </button>
        )}
      </div>

      {/* Komşu adı — window.prompt yerine erişilebilir modal */}
      <Modal
        open={neighborFor !== null}
        onClose={() => setNeighborFor(null)}
        title="Komşuya bırak"
        maxWidth="max-w-sm"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const note = neighborNote.trim();
            if (note.length < 3) {
              toast.error("Komşu adı / daire bilgisi gir (en az 3 karakter).");
              return;
            }
            submitPref("KOMSUYA_BIRAK", note);
          }}
          className="space-y-3"
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Paket belirttiğin komşuya teslim edilir ve fotoğrafla kanıtlanır.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Komşu adı / daire
            </span>
            <input
              value={neighborNote}
              onChange={(e) => setNeighborNote(e.target.value)}
              placeholder="ör. Ayşe Hn. D:4"
              maxLength={120}
              autoFocus
              className="input w-full"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNeighborFor(null)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={setPending || neighborNote.trim().length < 3}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Kaydet
            </button>
          </div>
        </form>
      </Modal>

      {/* Erteleme onayı — window.confirm yerine modal */}
      <Modal
        open={postponeOpen}
        onClose={() => setPostponeOpen(false)}
        title="Teslimatı ertele"
        maxWidth="max-w-sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Siparişin bir sonraki çalışma gününün dağıtımına alınacak. Erteleme
            hakkın sınırlıdır (en fazla 2 kez).
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPostponeOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={doPostpone}
              disabled={postponePending}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {postponePending ? "Erteleniyor…" : "Yarına ertele"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
