// Sipariş detayı "Teslimat Tercihi" bölümü — radyo satırları (saç-teli ayraç),
// komşu notu, "Yarına ertele" ve "Adresi değiştir" aksiyonları. Kurallar
// lib/deliveryPref.ts aynasıyla disable edilir; gerçek doğrulama sunucuda.
import { useState } from "react";

import { useMyAddresses } from "@/hooks/useAddresses";
import {
  useChangeShipAddress,
  usePostponeOrder,
  useSetDeliveryPref,
} from "@/hooks/useDelivery";
import {
  POSTPONE_LIMIT,
  PREF_OPTIONS,
  canChangeAddress,
  canChangePref,
  canPostpone,
} from "@/lib/deliveryPref";
import { promisedDateLabel } from "@/lib/deliveryPromise";
import { toast } from "@/store/toastStore";
import type { DeliveryPref, OrderOut } from "@/types";

function apiDetail(e: any, fallback: string): string {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (d?.message) return d.message;
  return fallback;
}

export function DeliveryPrefSection({ order }: { order: OrderOut }) {
  const setPref = useSetDeliveryPref();
  const postpone = usePostponeOrder();
  const changeAddress = useChangeShipAddress();
  const { data: addresses = [] } = useMyAddresses();

  const [note, setNote] = useState(order.delivery_pref_note ?? "");
  const [addressOpen, setAddressOpen] = useState(false);

  if (!canChangePref(order)) return null;

  const current = order.delivery_pref ?? "ADRESIMDEYIM";
  const shipped = order.status === "SHIPPED";
  const postponesLeft = POSTPONE_LIMIT - (order.postpone_count ?? 0);

  const choose = (pref: DeliveryPref) => {
    if (pref === "KOMSUYA_BIRAK" && note.trim().length < 3) {
      toast.error("Komşu adı/daire bilgisini yaz, sonra seç.");
      return;
    }
    setPref.mutate(
      { orderId: order.id, pref, note: pref === "KOMSUYA_BIRAK" ? note.trim() : null },
      {
        onSuccess: () => toast.success("Teslimat tercihin güncellendi."),
        onError: (e: any) => toast.error(apiDetail(e, "Güncellenemedi.")),
      }
    );
  };

  const doPostpone = () => {
    if (
      !window.confirm(
        "Teslimat yarına (sonraki çalışma gününe) ertelensin mi? " +
          `Kalan erteleme hakkın: ${postponesLeft}.`
      )
    )
      return;
    postpone.mutate(order.id, {
      onSuccess: () => toast.success("Teslimat ertelendi."),
      onError: (e: any) => toast.error(apiDetail(e, "Ertelenemedi.")),
    });
  };

  const doChangeAddress = (addressId: number, force = false) => {
    changeAddress.mutate(
      { orderId: order.id, addressId, force },
      {
        onSuccess: () => {
          setAddressOpen(false);
          toast.success("Teslimat adresi güncellendi.");
        },
        onError: (e: any) => {
          const d = e?.response?.data?.detail;
          if (d?.code === "OUT_OF_ZONE" && !force) {
            if (window.confirm(`${d.message}\n\nDevam edilsin mi?`)) {
              doChangeAddress(addressId, true);
            }
            return;
          }
          toast.error(apiDetail(e, "Adres değiştirilemedi."));
        },
      }
    );
  };

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Teslimat Tercihi
        </h2>
        {order.promised_delivery_date && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Planlanan gün:{" "}
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {promisedDateLabel(order.promised_delivery_date)}
            </span>
          </span>
        )}
      </div>

      <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {PREF_OPTIONS.map((opt) => {
          const selected = current === opt.value;
          return (
            <label
              key={opt.value}
              className="flex cursor-pointer items-start gap-3 py-3"
            >
              <input
                type="radio"
                name={`delivery-pref-${order.id}`}
                checked={selected}
                onChange={() => choose(opt.value)}
                disabled={setPref.isPending}
                className="mt-0.5 h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-400 dark:border-slate-600 dark:bg-slate-800"
              />
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {opt.emoji} {opt.label}
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {opt.description}
                </span>
                {opt.value === "KOMSUYA_BIRAK" && (selected || current !== "KOMSUYA_BIRAK") && (
                  <span className="mt-1.5 block">
                    <input
                      type="text"
                      maxLength={200}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      onClick={(e) => e.preventDefault()}
                      placeholder="Komşu adı / daire (ör. Ayşe Hn. D:4)"
                      className="input w-full max-w-xs text-xs"
                    />
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
        {canPostpone(order) ? (
          <button
            onClick={doPostpone}
            disabled={postpone.isPending}
            className="font-semibold text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400"
          >
            Yarına ertele
          </button>
        ) : (
          (order.postpone_count ?? 0) >= POSTPONE_LIMIT && (
            <span className="text-slate-400 dark:text-slate-500">
              Erteleme hakkın doldu
            </span>
          )
        )}
        {canChangeAddress(order) ? (
          <button
            onClick={() => setAddressOpen((v) => !v)}
            className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Adresi değiştir
          </button>
        ) : (
          shipped && (
            <span className="text-slate-400 dark:text-slate-500">
              Kurye yola çıktı — adres değişikliği kapandı
            </span>
          )
        )}
      </div>

      {addressOpen && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {addresses.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Kayıtlı başka adresin yok — önce Hesabım → Adreslerim'den ekle.
            </p>
          ) : (
            addresses.map((a) => (
              <button
                key={a.id}
                onClick={() => doChangeAddress(a.id)}
                disabled={changeAddress.isPending}
                className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800/60"
              >
                <span className="shrink-0 font-semibold text-slate-800 dark:text-slate-200">
                  {a.title}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">
                  {a.address_line}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}
