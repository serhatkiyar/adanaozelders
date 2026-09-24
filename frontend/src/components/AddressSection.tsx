import { useState } from "react";
import {
  useAddAddress,
  useDeleteAddress,
  useMyAddresses,
  useUpdateAddress,
} from "@/hooks/useAddresses";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { Icon } from "@/components/AppIcon";
import { Modal } from "@/components/ui/Modal";
import { AddressForm } from "@/components/address/AddressForm";
import type { SavedAddress, SavedAddressCreate } from "@/types";

/** Açık pencere: yeni adres ya da düzenlenen adres. */
type Pencere = { tur: "yeni" } | { tur: "duzenle"; adres: SavedAddress } | null;

function adresSatiri(a: SavedAddress): string {
  const parcalar = [a.address_line];
  if (a.door_no) parcalar.push(`No: ${a.door_no}`);
  if (a.apt_no) parcalar.push(`Daire: ${a.apt_no}`);
  return parcalar.join(", ");
}

function bolgeSatiri(a: SavedAddress): string | null {
  return [a.district, a.city].filter(Boolean).join(", ") || null;
}

function aliciSatiri(a: SavedAddress): string | null {
  return [a.recipient_name, a.phone].filter(Boolean).join(", ") || null;
}

const eklemeDugmesi =
  "inline-flex items-center gap-1.5 rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus focus-visible:ring-offset-2";

const ikonDugmesi =
  "inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus";

/**
 * Ayarlar > Adreslerim. Ekleme ve düzenleme formu modalda açılır (kullanıcı
 * kararı, 23 Eyl 2026); liste tek çerçevede satırlar hâlinde, varsayılan adres
 * en üstte.
 */
export function AddressSection() {
  const { data: addresses, isLoading } = useMyAddresses();
  const addMutation = useAddAddress();
  const updateMutation = useUpdateAddress();
  const deleteMutation = useDeleteAddress();

  const [pencere, setPencere] = useState<Pencere>(null);
  const [silinecekId, setSilinecekId] = useState<number | null>(null);

  // Varsayılan adres en üstte; diğerleri sunucunun verdiği sırada kalır.
  const list = [...(addresses ?? [])].sort(
    (a, b) => Number(b.is_default) - Number(a.is_default)
  );

  const handleAdd = (payload: SavedAddressCreate) =>
    addMutation.mutate(payload, {
      onSuccess: () => {
        toast.success("Adres eklendi.");
        setPencere(null);
      },
      onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")),
    });

  const handleUpdate = (id: number, payload: SavedAddressCreate) =>
    updateMutation.mutate(
      { id, payload },
      {
        onSuccess: () => {
          toast.success("Adres güncellendi.");
          setPencere(null);
        },
        onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
      }
    );

  const handleDelete = (id: number) =>
    deleteMutation.mutate(id, {
      onSuccess: () => {
        toast.success("Adres silindi.");
        setSilinecekId(null);
      },
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

  const yeniAdres = () => setPencere({ tur: "yeni" });

  return (
    <div>
      {isLoading ? (
        <div className="space-y-2">
          <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center">
          <img src="/icons/kurek-ceken.png" alt="" aria-hidden className="h-28 w-28" />
          <p className="mt-3 max-w-sm text-base text-slate-500">
            Henüz kayıtlı adresin yok
          </p>
          <button type="button" onClick={yeniAdres} className={`${eklemeDugmesi} mt-6`}>
            <Icon name="add" className="h-4 w-4" />
            Adres ekle
          </button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              {list.length} kayıtlı adres
            </p>
            <button type="button" onClick={yeniAdres} className={eklemeDugmesi}>
              <Icon name="add" className="h-4 w-4" />
              Adres ekle
            </button>
          </div>

          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            {list.map((addr) => {
              const bolge = bolgeSatiri(addr);
              const alici = aliciSatiri(addr);
              const siliniyor =
                deleteMutation.isPending && deleteMutation.variables === addr.id;
              return (
                <li key={addr.id} className="flex items-start gap-4 px-4 py-4 sm:px-5">
                  <span
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      addr.is_default
                        ? "bg-marka text-marka-fg"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <Icon name="location" className="h-5 w-5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[15px] font-semibold text-slate-900">
                        {addr.title}
                      </span>
                      {addr.is_default && (
                        <span className="rounded-full bg-marka-soft px-2 py-0.5 text-xs font-medium text-marka-soft-fg">
                          Varsayılan
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                      {adresSatiri(addr)}
                    </p>
                    {bolge && <p className="mt-0.5 text-sm text-slate-400">{bolge}</p>}
                    {alici && <p className="mt-0.5 text-sm text-slate-400">Alıcı: {alici}</p>}

                    {silinecekId === addr.id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2">
                        <span className="mr-auto text-sm text-red-700">
                          Bu adres silinsin mi?
                        </span>
                        <button
                          type="button"
                          onClick={() => setSilinecekId(null)}
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white"
                        >
                          Vazgeç
                        </button>
                        <button
                          type="button"
                          disabled={siliniyor}
                          onClick={() => handleDelete(addr.id)}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                        >
                          {siliniyor ? "Siliniyor…" : "Sil"}
                        </button>
                      </div>
                    ) : (
                      !addr.is_default && (
                        <button
                          type="button"
                          disabled={updateMutation.isPending}
                          onClick={() => handleMakeDefault(addr.id)}
                          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-marka-metin transition hover:text-marka-metin-hover disabled:opacity-50"
                        >
                          <Icon name="star" className="h-4 w-4" />
                          Varsayılan yap
                        </button>
                      )
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSilinecekId(null);
                        setPencere({ tur: "duzenle", adres: addr });
                      }}
                      aria-label={`${addr.title} adresini düzenle`}
                      title="Düzenle"
                      className={`${ikonDugmesi} hover:bg-slate-100 hover:text-slate-800`}
                    >
                      <Icon name="edit" className="h-[18px] w-[18px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSilinecekId(addr.id)}
                      aria-label={`${addr.title} adresini sil`}
                      title="Sil"
                      className={`${ikonDugmesi} hover:bg-red-50 hover:text-red-600`}
                    >
                      <Icon name="delete" className="h-[18px] w-[18px]" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <Modal
        open={pencere !== null}
        onClose={() => setPencere(null)}
        title={pencere?.tur === "duzenle" ? "Adresi düzenle" : "Yeni adres"}
        maxWidth="max-w-xl"
      >
        <div className="mt-5">
          {pencere?.tur === "duzenle" ? (
            <AddressForm
              key={pencere.adres.id}
              duz
              initial={pencere.adres}
              pending={updateMutation.isPending}
              submitLabel="Değişiklikleri kaydet"
              onSubmit={(payload) => handleUpdate(pencere.adres.id, payload)}
              onCancel={() => setPencere(null)}
            />
          ) : (
            pencere && (
              <AddressForm
                duz
                pending={addMutation.isPending}
                submitLabel="Adresi kaydet"
                onSubmit={handleAdd}
                onCancel={() => setPencere(null)}
              />
            )
          )}
        </div>
      </Modal>
    </div>
  );
}
