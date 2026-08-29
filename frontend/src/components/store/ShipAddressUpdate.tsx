// "Teslimat Adresi" kartının altındaki adres güncelleme bağlantısı — tıklanınca
// kayıtlı adres listesi açılır. Kural aynası lib/deliveryPref.ts::canChangeAddress
// (gerçek doğrulama sunucuda: order_service.change_ship_address).
import { useState } from "react";

import { useMyAddresses } from "@/hooks/useAddresses";
import { useChangeShipAddress } from "@/hooks/useDelivery";
import { canChangeAddress } from "@/lib/deliveryPref";
import { toast } from "@/store/toastStore";
import type { OrderOut } from "@/types";

function apiDetail(e: any, fallback: string): string {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (d?.message) return d.message;
  return fallback;
}

export function ShipAddressUpdate({ order }: { order: OrderOut }) {
  const [open, setOpen] = useState(false);
  const changeAddress = useChangeShipAddress();
  const { data: addresses = [] } = useMyAddresses();

  if (!order.has_physical) return null;
  if (!canChangeAddress(order)) {
    if (order.status === "SHIPPED") {
      return (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400 ">
          Kurye yola çıktı, adres değişikliği kapandı
        </p>
      );
    }
    return null;
  }

  const doChangeAddress = (addressId: number, force = false) => {
    changeAddress.mutate(
      { orderId: order.id, addressId, force },
      {
        onSuccess: () => {
          setOpen(false);
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
    <div className="mt-3 border-t border-slate-100 pt-3 ">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline "
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
          />
        </svg>
        Sipariş adresimi güncelle
      </button>

      {open && (
        <div className="mt-2 space-y-1">
          {addresses.length === 0 ? (
            <p className="text-xs text-slate-400 ">
              Kayıtlı başka adresin yok, önce Hesabım → Adreslerim'den ekle.
            </p>
          ) : (
            addresses.map((a) => (
              <button
                key={a.id}
                onClick={() => doChangeAddress(a.id)}
                disabled={changeAddress.isPending}
                className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50 disabled:opacity-50 "
              >
                <span className="shrink-0 font-semibold text-slate-800 ">
                  {a.title}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-500 ">
                  {a.address_line}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
