// Kurye profilleri yönetimi (ADMIN) — hafif liste + satır içi ekleme/düzenleme.
// Müşteri takip sayfasındaki kimlik kartını (isim + vesikalık + plaka) besler.
import { useRef, useState } from "react";

import {
  useCouriers,
  useCreateCourier,
  useDeleteCourier,
  useUpdateCourier,
  useUploadCourierPhoto,
} from "@/hooks/useDelivery";
import { toast } from "@/store/toastStore";
import type { Courier } from "@/types";

function CourierAvatar({ c, size = "h-10 w-10" }: { c: Courier; size?: string }) {
  if (c.photo_url) {
    return (
      <img
        src={c.photo_url}
        alt={c.name}
        className={`${size} shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700`}
      />
    );
  }
  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300`}
    >
      {c.name.charAt(0).toLocaleUpperCase("tr")}
    </span>
  );
}

function CourierRow({ c }: { c: Courier }) {
  const update = useUpdateCourier();
  const remove = useDeleteCourier();
  const uploadPhoto = useUploadCourierPhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [phone, setPhone] = useState(c.phone ?? "");
  const [plate, setPlate] = useState(c.vehicle_plate ?? "");

  const save = () => {
    if (name.trim().length < 2) {
      toast.error("İsim en az 2 karakter olmalı.");
      return;
    }
    update.mutate(
      {
        courierId: c.id,
        payload: {
          name: name.trim(),
          phone: phone.trim() || null,
          vehicle_plate: plate.trim() || null,
        },
      },
      {
        onSuccess: () => setEditing(false),
        onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Kaydedilemedi."),
      }
    );
  };

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 py-3">
        <CourierAvatar c={c} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input w-36"
          placeholder="İsim"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input w-36"
          placeholder="Telefon"
        />
        <input
          value={plate}
          onChange={(e) => setPlate(e.target.value.toLocaleUpperCase("tr"))}
          className="input w-28 font-mono"
          placeholder="Plaka"
        />
        <button
          onClick={save}
          disabled={update.isPending}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Kaydet
        </button>
        <button
          onClick={() => setEditing(false)}
          className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
        >
          Vazgeç
        </button>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-3 py-3">
      <button
        type="button"
        title="Fotoğraf yükle"
        onClick={() => fileRef.current?.click()}
        className="relative"
      >
        <CourierAvatar c={c} />
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-white opacity-0 transition group-hover:opacity-100 dark:bg-white dark:text-slate-900">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-2.5 w-2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            uploadPhoto.mutate(
              { courierId: c.id, file: f },
              {
                onSuccess: () => toast.success("Fotoğraf güncellendi."),
                onError: () => toast.error("Fotoğraf yüklenemedi."),
              }
            );
          e.target.value = "";
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
          {c.name}
          {!c.is_active && (
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
              pasif
            </span>
          )}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {[c.vehicle_plate, c.phone].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={() => setEditing(true)}
          className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Düzenle
        </button>
        <button
          onClick={() =>
            update.mutate({ courierId: c.id, payload: { is_active: !c.is_active } })
          }
          className="text-xs font-semibold text-slate-500 hover:underline dark:text-slate-400"
        >
          {c.is_active ? "Pasifleştir" : "Aktifleştir"}
        </button>
        <button
          onClick={() => {
            if (window.confirm(`${c.name} silinsin mi?`))
              remove.mutate(c.id, {
                onError: () => toast.error("Silinemedi."),
              });
          }}
          className="text-xs font-semibold text-rose-500 hover:underline"
        >
          Sil
        </button>
      </div>
    </li>
  );
}

export function CourierManager() {
  const { data: couriers = [], isLoading } = useCouriers();
  const create = useCreateCourier();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");

  const add = () => {
    if (name.trim().length < 2) {
      toast.error("İsim en az 2 karakter olmalı.");
      return;
    }
    create.mutate(
      { name: name.trim(), vehicle_plate: plate.trim() || null },
      {
        onSuccess: () => {
          setName("");
          setPlate("");
          setAdding(false);
          toast.success("Kurye eklendi.");
        },
        onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Eklenemedi."),
      }
    );
  };

  return (
    <section className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Kuryeler</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Müşteri takip sayfasında görünen kimlik: isim, fotoğraf, plaka.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Kurye ekle
          </button>
        )}
      </div>
      <div className="px-6">
        {adding && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-3 dark:border-slate-700/60">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input w-44"
              placeholder="İsim Soyisim"
              autoFocus
            />
            <input
              value={plate}
              onChange={(e) => setPlate(e.target.value.toLocaleUpperCase("tr"))}
              className="input w-32 font-mono"
              placeholder="01 ABC 123"
            />
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
        )}
        {isLoading ? (
          <div className="space-y-2 py-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/50" />
            ))}
          </div>
        ) : couriers.length === 0 && !adding ? (
          <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
            Henüz kurye yok — takip sayfasında kimlik göstermek için ekleyin.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {couriers.map((c) => (
              <CourierRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
