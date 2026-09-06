import { useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import { ModalShell } from "@/components/store/ModalShell";
import { AddressForm } from "@/components/address/AddressForm";
import { FullScreenSpinner } from "@/components/Spinner";
import {
  useMyAddresses,
  useAddAddress,
  useUpdateAddress,
  useDeleteAddress,
} from "@/hooks/useAddresses";
import type { SavedAddress } from "@/types";
import { toast } from "@/store/toastStore";

export default function AddressesPage() {
  const { data: addresses, isLoading } = useMyAddresses();
  const update = useUpdateAddress();
  const remove = useDeleteAddress();
  const [editing, setEditing] = useState<SavedAddress | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <DashboardShell title="Adreslerim" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-4xl">
        <nav className="mb-3 flex items-center gap-1.5 text-sm text-slate-500 ">
          <Link to={ROUTES.profile} className="hover:text-marka-metin ">
            Hesabım
          </Link>
          <span className="text-slate-300 ">/</span>
          <span className="text-slate-700 ">Adreslerim</span>
        </nav>

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 ">Adreslerim</h1>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition-colors hover:bg-marka-hover"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Yeni adres ekle
          </button>
        </div>

        {isLoading ? (
          <div className="py-16">
            <FullScreenSpinner />
          </div>
        ) : !addresses || addresses.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white py-20 text-center ">
            <p className="text-slate-500 ">Henüz kayıtlı adresin yok.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {addresses.map((a) => (
              <div key={a.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 ">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold text-slate-900 ">{a.title}</h2>
                  {a.is_default && (
                    <span className="rounded-full bg-marka-soft px-2 py-0.5 text-xs font-medium text-marka-soft-fg ">
                      Varsayılan
                    </span>
                  )}
                </div>
                {(a.recipient_name || a.phone) && (
                  <p className="mt-1.5 text-sm text-slate-700 ">
                    {[a.recipient_name, a.phone].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="mt-2 whitespace-pre-line text-sm text-slate-600 ">
                  {a.address_line}
                  {(a.door_no || a.apt_no) && (
                    <> · {[a.door_no && `Kapı ${a.door_no}`, a.apt_no && `Daire ${a.apt_no}`].filter(Boolean).join(" ")}</>
                  )}
                </p>
                {a.directions && (
                  <p className="mt-1 text-xs text-slate-400 ">{a.directions}</p>
                )}

                <div className="mt-auto flex flex-wrap gap-2 pt-4 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setEditing(a)}
                    className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition-colors hover:border-marka-mid hover:text-marka-metin "
                  >
                    Düzenle
                  </button>
                  {!a.is_default && (
                    <button
                      type="button"
                      onClick={() =>
                        update.mutate(
                          { id: a.id, payload: { is_default: true } },
                          { onSuccess: () => toast.success("Varsayılan adres güncellendi") }
                        )
                      }
                      className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition-colors hover:border-marka-mid hover:text-marka-metin "
                    >
                      Varsayılan yap
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`"${a.title}" adresini sil?`)) {
                        remove.mutate(a.id, { onSuccess: () => toast.success("Adres silindi") });
                      }
                    }}
                    className="rounded-full border border-slate-200 px-3 py-1 text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50 "
                  >
                    Sil
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {adding && <AddressFormModal onClose={() => setAdding(false)} />}
      {editing && <AddressFormModal address={editing} onClose={() => setEditing(null)} />}
    </DashboardShell>
  );
}

/** Ortak AddressForm ile ekle/düzenle — rezervasyon ve checkout ile aynı tasarım
 *  (haritadan konum, il/ilçe, alıcı adı + telefon dahil). */
function AddressFormModal({ address, onClose }: { address?: SavedAddress; onClose: () => void }) {
  const add = useAddAddress();
  const update = useUpdateAddress();
  const pending = add.isPending || update.isPending;

  return (
    <ModalShell title={address ? "Adresi düzenle" : "Yeni adres"} onClose={onClose}>
      <AddressForm
        initial={address}
        pending={pending}
        onCancel={onClose}
        onSubmit={(payload) => {
          const opts = {
            onSuccess: () => {
              toast.success(address ? "Adres güncellendi" : "Adres eklendi");
              onClose();
            },
            onError: () => toast.error("Adres kaydedilemedi"),
          };
          if (address) update.mutate({ id: address.id, payload }, opts);
          else add.mutate(payload, opts);
        }}
      />
    </ModalShell>
  );
}
