// "Araçlar" — filo yönetimi (İP-19: araçlar enum'dan tabloya taşındı).
// CourierManager deseni: hafif liste + satır içi ekleme/düzenleme, kart
// enflasyonu yok — satır ritmi + saç-teli çizgi. Ayrıca turların başlangıç
// (BASE) noktası da burada yönetilir (K-9: depo .env sabiti yerine veri).
import { useState } from "react";
import { isAxiosError } from "axios";

import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { ConfirmDialog } from "@/components/admin/ui";
import {
  useCreatePickupPoint,
  useCreateVehicle,
  useDeleteVehicle,
  usePickupPoints,
  useUpdateVehicle,
  useVehicles,
} from "@/hooks/useDelivery";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { PickupPoint, Vehicle } from "@/types";

/** "HH:MM:SS" (backend time) → time input değeri "HH:MM". */
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** Vardiya özeti — ikisi de doluysa aralık, yoksa boş. */
function shiftText(v: Vehicle): string | null {
  if (!v.shift_start && !v.shift_end) return null;
  return `${hhmm(v.shift_start) || "…"}–${hhmm(v.shift_end) || "…"}`;
}

/* Ortak alan grubu — küçük etiket + input; hem ekleme hem düzenleme kullanır. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
      {label}
      {children}
    </label>
  );
}

interface VehicleFormState {
  label: string;
  code: string;
  plate: string;
  maxStops: string;
  shiftStart: string;
  shiftEnd: string;
  fixedCost: string;
  sortOrder: string;
}

function formFrom(v?: Vehicle): VehicleFormState {
  return {
    label: v?.label ?? "",
    code: v?.code ?? "",
    plate: v?.plate ?? "",
    maxStops: v?.max_stops != null ? String(v.max_stops) : "",
    shiftStart: hhmm(v?.shift_start),
    shiftEnd: hhmm(v?.shift_end),
    fixedCost: v != null ? String(v.fixed_cost) : "0",
    sortOrder: v != null ? String(v.sort_order) : "0",
  };
}

/** Formdan PATCH/POST gövdesine (code hariç — o yalnız oluşturmada).
 *  Dönen şekil hem `VehicleUpdate` hem (code eklenince) `VehicleCreate` olur. */
function payloadFrom(f: VehicleFormState) {
  return {
    label: f.label.trim(),
    plate: f.plate.trim() || null,
    max_stops: f.maxStops.trim() === "" ? null : Number(f.maxStops),
    shift_start: f.shiftStart || null,
    shift_end: f.shiftEnd || null,
    fixed_cost: f.fixedCost.trim() === "" ? 0 : Number(f.fixedCost),
    sort_order: f.sortOrder.trim() === "" ? 0 : Number(f.sortOrder),
  };
}

function formValid(f: VehicleFormState, withCode: boolean): string | null {
  if (!f.label.trim()) return "Araç adı (etiket) gerekli.";
  if (withCode && !/^[A-Z0-9_-]+$/.test(f.code.trim()))
    return "Kod yalnız BÜYÜK harf, rakam, _ ve - içerebilir (örn. DOBLO).";
  return null;
}

/* Alan satırı — ekleme ve düzenleme aynı yerleşimi paylaşır. */
function VehicleFields({
  form,
  setForm,
  withCode,
}: {
  form: VehicleFormState;
  setForm: (f: VehicleFormState) => void;
  withCode: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2.5">
      <Field label="Araç adı">
        <input
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          className="input w-36"
          placeholder="Doblo"
        />
      </Field>
      {withCode && (
        <Field label="Kod (değişmez)">
          <input
            value={form.code}
            onChange={(e) =>
              setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s/g, "") })
            }
            className="input w-28 font-mono uppercase"
            placeholder="DOBLO"
          />
        </Field>
      )}
      <Field label="Plaka">
        <input
          value={form.plate}
          onChange={(e) => setForm({ ...form, plate: e.target.value.toLocaleUpperCase("tr") })}
          className="input w-28 font-mono"
          placeholder="01 ABC 123"
        />
      </Field>
      <Field label="Durak tavanı">
        <input
          type="number"
          min={1}
          value={form.maxStops}
          onChange={(e) => setForm({ ...form, maxStops: e.target.value })}
          className="input w-24"
          placeholder="sınırsız"
        />
      </Field>
      <Field label="Vardiya başlangıç">
        <input
          type="time"
          value={form.shiftStart}
          onChange={(e) => setForm({ ...form, shiftStart: e.target.value })}
          className="input w-28"
        />
      </Field>
      <Field label="Vardiya bitiş">
        <input
          type="time"
          value={form.shiftEnd}
          onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })}
          className="input w-28"
        />
      </Field>
      <Field label="Sabit maliyet (₺/gün)">
        <input
          type="number"
          min={0}
          value={form.fixedCost}
          onChange={(e) => setForm({ ...form, fixedCost: e.target.value })}
          className="input w-24"
        />
      </Field>
      <Field label="Sıra">
        <input
          type="number"
          value={form.sortOrder}
          onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
          className="input w-16"
        />
      </Field>
    </div>
  );
}

function VehicleRow({ v }: { v: Vehicle }) {
  const update = useUpdateVehicle();
  const remove = useDeleteVehicle();
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState<VehicleFormState>(() => formFrom(v));

  const save = () => {
    const err = formValid(form, false);
    if (err) return toast.error(err);
    update.mutate(
      { vehicleId: v.id, payload: payloadFrom(form) },
      {
        onSuccess: () => setEditing(false),
        onError: (e) => toast.error(getErrorMessage(e, "Kaydedilemedi.")),
      }
    );
  };

  if (editing) {
    return (
      <li className="py-3">
        <VehicleFields form={form} setForm={setForm} withCode={false} />
        <div className="mt-2.5 flex items-center gap-3">
          <button
            onClick={save}
            disabled={update.isPending}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Kaydet
          </button>
          <button
            onClick={() => {
              setForm(formFrom(v));
              setEditing(false);
            }}
            className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
          >
            Vazgeç
          </button>
        </div>
      </li>
    );
  }

  const meta = [
    v.plate,
    v.max_stops != null ? `${v.max_stops} durak` : null,
    shiftText(v),
    v.fixed_cost > 0 ? `₺${v.fixed_cost} sabit` : null,
  ].filter(Boolean);

  return (
    <>
      <li className="group flex flex-wrap items-center gap-3 py-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
            {v.label}
            <span className="ml-2 font-mono text-xs font-normal text-slate-400 dark:text-slate-500">
              {v.code}
            </span>
            {!v.is_active && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                pasif
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {meta.length > 0 ? meta.join(" · ") : "—"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
          <button
            onClick={() => {
              setForm(formFrom(v));
              setEditing(true);
            }}
            className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Düzenle
          </button>
          <button
            onClick={() =>
              update.mutate(
                { vehicleId: v.id, payload: { is_active: !v.is_active } },
                { onError: (e) => toast.error(getErrorMessage(e, "Güncellenemedi.")) }
              )
            }
            className="text-xs font-semibold text-slate-500 hover:underline dark:text-slate-400"
          >
            {v.is_active ? "Pasifleştir" : "Aktifleştir"}
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            className="text-xs font-semibold text-rose-500 hover:underline"
          >
            Sil
          </button>
        </div>
      </li>
      <ConfirmDialog
        open={deleteOpen}
        title="Aracı sil"
        description={`${v.label} filodan kaldırılacak. Geçmiş turların kaydı bozulmaz.`}
        confirmLabel="Aracı sil"
        danger
        isPending={remove.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() =>
          remove.mutate(v.id, {
            onSuccess: () => setDeleteOpen(false),
            onError: (e) => {
              // 409: açık (PLANNED/ACTIVE) turu olan araç silinemez.
              if (isAxiosError(e) && e.response?.status === 409) {
                toast.error(
                  getErrorMessage(
                    e,
                    "Aracın açık turu var — önce turları kapatın veya iptal edin."
                  )
                );
              } else {
                toast.error(getErrorMessage(e, "Araç silinemedi."));
              }
              setDeleteOpen(false);
            },
          })
        }
      />
    </>
  );
}

function VehicleSection() {
  const { canManage } = useAdminAreaAccess("delivery");
  const { data: vehicles = [], isLoading } = useVehicles();
  const create = useCreateVehicle();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<VehicleFormState>(() => formFrom());

  const add = () => {
    const err = formValid(form, true);
    if (err) return toast.error(err);
    create.mutate(
      { code: form.code.trim(), ...payloadFrom(form) },
      {
        onSuccess: () => {
          setForm(formFrom());
          setAdding(false);
          toast.success("Araç eklendi.");
        },
        onError: (e) => toast.error(getErrorMessage(e, "Araç eklenemedi.")),
      }
    );
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Araçlar</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Tur kurma ve Günü Optimize Et bu filoyu kullanır — durak tavanı ve
            vardiya rota planına girer.
          </p>
        </div>
        {canManage && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Araç ekle
          </button>
        )}
      </div>
      <div className="px-6">
        {adding && (
          <div className="border-b border-slate-100 py-3.5 dark:border-slate-800">
            <VehicleFields form={form} setForm={setForm} withCode />
            <div className="mt-2.5 flex items-center gap-3">
              <button
                onClick={add}
                disabled={create.isPending}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Ekle
              </button>
              <button
                onClick={() => setAdding(false)}
                className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}
        {isLoading ? (
          <div className="space-y-2 py-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/60" />
            ))}
          </div>
        ) : vehicles.length === 0 && !adding ? (
          <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
            Filoda araç yok — tur kurabilmek için en az bir araç ekleyin.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {vehicles.map((v) =>
              canManage ? (
                <VehicleRow key={v.id} v={v} />
              ) : (
                <li key={v.id} className="py-3">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {v.label}
                    <span className="ml-2 font-mono text-xs font-normal text-slate-400 dark:text-slate-500">
                      {v.code}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {[v.plate, v.max_stops != null ? `${v.max_stops} durak` : null, shiftText(v)]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ── Başlangıç noktası (BASE) ── */

function BasePointRow({ p, isDefault }: { p: PickupPoint; isDefault: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
          {p.name}
          {isDefault && (
            <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
              varsayılan
            </span>
          )}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}
        </p>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-slate-500">
        sıra {p.sort_order}
      </span>
    </li>
  );
}

function BasePointSection() {
  const { canManage } = useAdminAreaAccess("delivery");
  const { data: points = [], isLoading } = usePickupPoints();
  const create = useCreatePickupPoint();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [sortOrder, setSortOrder] = useState("0");

  // Varsayılan başlangıç = aktif BASE kayıtlarından sırası en küçük (backend kuralı).
  const basePoints = points.filter((p) => p.kind === "BASE" && p.is_active);
  const defaultId = basePoints[0]?.id;

  const add = () => {
    if (!name.trim()) return toast.error("Nokta adı gerekli.");
    const la = Number(lat);
    const ln = Number(lng);
    if (!lat.trim() || !lng.trim() || Number.isNaN(la) || Number.isNaN(ln))
      return toast.error("Geçerli enlem/boylam girin (örn. 36.98550 / 35.32530).");
    if (la < -90 || la > 90 || ln < -180 || ln > 180)
      return toast.error("Koordinat aralık dışı — enlem ±90, boylam ±180 olmalı.");
    create.mutate(
      {
        name: name.trim(),
        kind: "BASE",
        address: address.trim() || null,
        lat: la,
        lng: ln,
        sort_order: sortOrder.trim() === "" ? 0 : Number(sortOrder),
      },
      {
        onSuccess: () => {
          setName("");
          setAddress("");
          setLat("");
          setLng("");
          setSortOrder("0");
          setAdding(false);
          toast.success("Başlangıç noktası eklendi.");
        },
        onError: (e) => toast.error(getErrorMessage(e, "Nokta eklenemedi.")),
      }
    );
  };

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Başlangıç Noktası</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Turlar buradan yola çıkar; rota ve ETA'lar bu noktaya göre hesaplanır.
            Sırası en küçük aktif nokta varsayılandır.
          </p>
        </div>
        {canManage && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Nokta ekle
          </button>
        )}
      </div>
      <div className="px-6">
        {adding && (
          <div className="border-b border-slate-100 py-3.5 dark:border-slate-800">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2.5">
              <Field label="Nokta adı">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input w-44"
                  placeholder="Depo — Seyhan"
                  />
              </Field>
              <Field label="Adres (opsiyonel)">
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="input w-56"
                  placeholder="Cadde, mahalle…"
                />
              </Field>
              <Field label="Enlem">
                <input
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  className="input w-28 tabular-nums"
                  placeholder="36.98550"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Boylam">
                <input
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  className="input w-28 tabular-nums"
                  placeholder="35.32530"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Sıra">
                <input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="input w-16"
                />
              </Field>
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <button
                onClick={add}
                disabled={create.isPending}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Ekle
              </button>
              <button
                onClick={() => setAdding(false)}
                className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}
        {isLoading ? (
          <div className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/60 my-3" />
        ) : basePoints.length === 0 && !adding ? (
          <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
            Tanımlı başlangıç noktası yok — rota optimizasyonu için bir nokta ekleyin.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {basePoints.map((p) => (
              <BasePointRow key={p.id} p={p} isDefault={p.id === defaultId} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function DeliveryVehiclesPage() {
  return (
    <div>
      <VehicleSection />
      <BasePointSection />
    </div>
  );
}
