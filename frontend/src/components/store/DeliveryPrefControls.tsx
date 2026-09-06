// Teslimat tercihi + erteleme — İKİ yüzeyde aynı bileşen:
//   mode="token": SMS'ten gelen oturumsuz takip sayfası. ÜÇ AKSİYON KUTUSU
//     gösterir (komşuma / istediğim zaman / farklı adrese). Güvenlik: komşuya
//     bırakma ve adres değişikliği burada YAPILAMAZ (backend 403 — takip linki
//     iletilebilir), kutular girişe yönlendirir; erteleme serbesttir.
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

/** Token yüzeyindeki tek aksiyon kutusu — çerçeveli, ikonlu, eşit genişlikte.
 *  `to` verilirse bağlantıdır (giriş gerektiren aksiyon), `onClick` verilirse
 *  düğmedir. İkisi de yoksa kutu pasiftir ve nedenini `hint` söyler. */
function ActionBox({
  icon,
  label,
  hint,
  to,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const cls = [
    "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
    disabled
      ? "cursor-not-allowed border-slate-200 opacity-60"
      : "border-slate-300 hover:border-orange-400 hover:bg-orange-50/40",
  ].join(" ");
  const govde = (
    <>
      <span className="shrink-0 text-orange-500">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-800">
          {label}
        </span>
        <span className="block truncate text-xs text-slate-400">{hint}</span>
      </span>
    </>
  );
  if (to && !disabled) {
    return (
      <Link to={to} className={cls}>
        {govde}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {govde}
    </button>
  );
}

const ikonSinifi = "h-5 w-5";

function NeighborIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={ikonSinifi}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V9l6-4 6 4v12M9 21v-5h4v5M15 21h6V12l-3-2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={ikonSinifi}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={ikonSinifi}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function DeliveryPrefControls({
  t,
  mode,
}: {
  t: OrderTracking;
  mode: Mode;
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
        toast.error(getErrorMessage(e, "Güncellenemedi, bağlantını kontrol et.")),
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
        toast.error(getErrorMessage(e, "Ertelenemedi, hakkın dolmuş olabilir.")),
    };
    if (mode.kind === "token") publicPostpone.mutate(mode.token, opts);
    else orderPostpone.mutate(mode.orderId, opts);
  };

  // ── Token yüzeyi: üç eşit aksiyon kutusu ──
  //
  // Oturumsuz sayfada müşterinin sorduğu şey "tercihim ne" değil, "ne
  // yapabilirim". Emoji çipleri + ayrı bir metin bağlantısı bu soruyu dağıtıyordu.
  //
  // Üçün ikisi GİRİŞ İSTER ve bu bir tasarım tercihi değil güvenlik kuralıdır:
  // takip linki SMS'le geliyor ve iletilebiliyor; linki eline geçiren birinin
  // paketi kapıya/komşuya yönlendirmesi ya da adresi değiştirmesi engellenir
  // (backend de 403 verir). Kilit dürüstçe gösterilir, tıklayınca girişe gider.
  if (mode.kind === "token") {
    const ertelenebilir = t.can_postpone && t.status !== "POSTPONED";
    return (
      <div className="text-left">
        <div className="grid gap-3 sm:grid-cols-3">
          <ActionBox
            icon={<NeighborIcon />}
            label="Komşuma gelsin"
            hint="Giriş gerekli"
            to={ROUTES.login}
          />
          <ActionBox
            icon={<ClockIcon />}
            label="İstediğim zaman gelsin"
            hint={
              ertelenebilir
                ? "Bir sonraki güne ertele"
                : "Erteleme hakkın kalmadı"
            }
            onClick={ertelenebilir ? () => setPostponeOpen(true) : undefined}
            disabled={!ertelenebilir || postponePending}
          />
          <ActionBox
            icon={<PinIcon />}
            label="Farklı adrese gelsin"
            hint="Giriş gerekli"
            to={ROUTES.login}
          />
        </div>
        {current !== "ADRESIMDEYIM" && currentOption && (
          <p className="mt-3 text-sm text-slate-500">
            Şu anki talimatın: {currentOption.label}
            {current === "KOMSUYA_BIRAK" && t.delivery_pref_note && (
              <> · Komşu: {t.delivery_pref_note}</>
            )}
          </p>
        )}
        <Modal
          open={postponeOpen}
          onClose={() => setPostponeOpen(false)}
          title="Teslimatı ertele"
          maxWidth="max-w-sm"
        >
          <p className="text-sm text-slate-600">
            Siparişin bir sonraki çalışma gününün dağıtımına alınır.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPostponeOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={doPostpone}
              disabled={postponePending}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
            >
              Ertele
            </button>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div className="border-t border-slate-100 px-6 py-5 text-left ">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
        Teslimat tercihin
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {PREF_OPTIONS.map((opt) => {
          const selected = current === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => choose(opt.value)}
              disabled={setPending}
              title={opt.description}
              className={[
                "rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
                selected
                  ? "bg-slate-900 text-white "
                  : "text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 ",
              ].join(" ")}
            >
              {opt.emoji} {opt.label}
            </button>
          );
        })}
      </div>
      {/* Seçili tercihin ne anlama geldiği — müşteri sonucunu bilerek seçsin
          (ör. "Kapıya bırak" fotoğrafla kanıtlanır). */}
      {currentOption && (
        <p className="mt-2 text-xs text-slate-500 ">
          {currentOption.description}
          {current === "KOMSUYA_BIRAK" && t.delivery_pref_note && (
            <>, Komşu: {t.delivery_pref_note}</>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {t.can_postpone && t.status !== "POSTPONED" && (
          <button
            onClick={() => setPostponeOpen(true)}
            disabled={postponePending}
            className="font-semibold text-marka-metin hover:underline disabled:opacity-50 "
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
          <p className="text-sm text-slate-600 ">
            Paket belirttiğin komşuya teslim edilir ve fotoğrafla kanıtlanır.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500 ">
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
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus "
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={setPending || neighborNote.trim().length < 3}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus disabled:opacity-50 "
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
          <p className="text-sm text-slate-600 ">
            Siparişin bir sonraki çalışma gününün dağıtımına alınacak. Erteleme
            hakkın sınırlıdır (en fazla 2 kez).
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPostponeOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus "
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={doPostpone}
              disabled={postponePending}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus disabled:opacity-50 "
            >
              {postponePending ? "Erteleniyor…" : "Yarına ertele"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
