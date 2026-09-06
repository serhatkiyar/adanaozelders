import { useState } from "react";
import {
  useAddAddress,
  useDeleteAddress,
  useMyAddresses,
  useUpdateAddress,
} from "@/hooks/useAddresses";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { AddressForm } from "@/components/address/AddressForm";
import { SavedAddressCard } from "@/components/address/SavedAddressCard";
import type { SavedAddressCreate } from "@/types";

export function AddressSection() {
  const { data: addresses, isLoading } = useMyAddresses();
  const addMutation = useAddAddress();
  const updateMutation = useUpdateAddress();
  const deleteMutation = useDeleteAddress();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const list = addresses ?? [];

  const handleAdd = (payload: SavedAddressCreate) =>
    addMutation.mutate(payload, {
      onSuccess: () => {
        toast.success("Adres eklendi.");
        setAdding(false);
      },
      onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")),
    });

  const handleUpdate = (id: number, payload: SavedAddressCreate) =>
    updateMutation.mutate(
      { id, payload },
      {
        onSuccess: () => {
          toast.success("Adres güncellendi.");
          setEditingId(null);
        },
        onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
      }
    );

  const handleDelete = (id: number) =>
    deleteMutation.mutate(id, {
      onSuccess: () => toast.success("Adres silindi."),
      onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")),
    });

  const handleMakeDefault = (id: number) =>
    updateMutation.mutate(
      { id, payload: { is_default: true } },
      {
        onSuccess: () => toast.success("Varsayılan adres güncellendi."),
        onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
      }
    );

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 ">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 ">
            Kayıtlı Adreslerim
          </h3>
          <p className="mt-1 text-sm text-slate-500 ">
            Yüzyüze rezervasyonda her seferinde adres yazma; buradan yönet.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
            className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-marka-soft-fg transition hover:bg-marka-soft "
          >
            + Ekle
          </button>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {isLoading ? (
          <div className="h-12 animate-pulse rounded-xl bg-slate-100 " />
        ) : (
          <>
            {list.map((addr) =>
              editingId === addr.id ? (
                <AddressForm
                  key={addr.id}
                  initial={addr}
                  pending={updateMutation.isPending}
                  submitLabel="Adresi Güncelle"
                  onSubmit={(payload) => handleUpdate(addr.id, payload)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <SavedAddressCard
                  key={addr.id}
                  addr={addr}
                  deleting={
                    deleteMutation.isPending && deleteMutation.variables === addr.id
                  }
                  onEdit={() => {
                    setAdding(false);
                    setEditingId(addr.id);
                  }}
                  onDelete={() => handleDelete(addr.id)}
                  onMakeDefault={() => handleMakeDefault(addr.id)}
                />
              )
            )}

            {adding && (
              <AddressForm
                pending={addMutation.isPending}
                submitLabel="Adresi Kaydet"
                onSubmit={handleAdd}
                onCancel={() => setAdding(false)}
              />
            )}

            {!adding && list.length === 0 && (
              <p className="text-sm italic text-slate-400 ">
                Henüz kayıtlı adresin yok. Eklediğin adresler yüzyüze rezervasyonda
                tek tıkla seçilebilir.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
