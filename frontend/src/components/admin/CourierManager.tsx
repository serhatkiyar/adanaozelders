// Kurye profilleri yönetimi (ADMIN) — hafif liste + satır içi ekleme/düzenleme.
// Müşteri takip sayfasındaki kimlik kartını (isim + vesikalık) besler.
// İP-19: plaka kuryeden kalktı — araç kimliği Araçlar sekmesinde yaşar.
import { useRef, useState } from "react";
import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { ConfirmDialog } from "@/components/admin/ui";

import {
  useCloseCourierAccount,
  useCourierAccount,
  useCouriers,
  useCreateCourier,
  useCreateCourierAccount,
  useDeleteCourier,
  useResetCourierPassword,
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

/** Kuryenin giriş hesabı (rol 5) — satır altında açılan yaşam döngüsü bölümü.
 *  Hesap sorgusu yalnız bölüm açıkken atılır (satır başına otomatik istek yok). */
function CourierAccountPanel({ c }: { c: Courier }) {
  const [closeOpen, setCloseOpen] = useState(false);
  const { data: account, isLoading } = useCourierAccount(c.id);
  const createAccount = useCreateCourierAccount();
  const closeAccount = useCloseCourierAccount();
  const resetPassword = useResetCourierPassword();

  const nameParts = c.name.trim().split(/\s+/);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState(nameParts.slice(0, -1).join(" ") || c.name);
  const [lastName, setLastName] = useState(nameParts.length > 1 ? nameParts[nameParts.length - 1] : "");
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  if (isLoading) {
    return <div className="mb-3 h-9 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/50" />;
  }

  if (account?.is_active) {
    return (
      <>
      <div className="mb-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-700/60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Giriş hesabı:</span>{" "}
            {account.email}
          </p>
          <button
            onClick={() => setResetting((v) => !v)}
            className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Şifre sıfırla
          </button>
          <button
            onClick={() => setCloseOpen(true)}
            disabled={closeAccount.isPending}
            className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50 dark:text-rose-400"
          >
            Hesabı kapat
          </button>
        </div>
        {resetting && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input w-48"
              placeholder="Yeni şifre (en az 8)"
              autoFocus
            />
            <button
              onClick={() => {
                if (newPassword.length < 8) {
                  toast.error("Şifre en az 8 karakter olmalı.");
                  return;
                }
                resetPassword.mutate(
                  { accountId: account.id, newPassword },
                  {
                    onSuccess: () => {
                      setResetting(false);
                      setNewPassword("");
                      toast.success("Şifre güncellendi.");
                    },
                    onError: (e: any) =>
                      toast.error(e?.response?.data?.detail ?? "Şifre güncellenemedi."),
                  }
                );
              }}
              disabled={resetPassword.isPending}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Kaydet
            </button>
            <button
              onClick={() => {
                setResetting(false);
                setNewPassword("");
              }}
              className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
            >
              Vazgeç
            </button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={closeOpen}
        title="Kurye giriş hesabını kapat"
        description={`${c.name} için açık oturumlar anında sonlandırılacak.`}
        confirmLabel="Hesabı kapat"
        danger
        isPending={closeAccount.isPending}
        onClose={() => setCloseOpen(false)}
        onConfirm={() => closeAccount.mutate(account.id, {
          onSuccess: () => { toast.success("Hesap kapatıldı — oturumları sonlandırıldı."); setCloseOpen(false); },
          onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Hesap kapatılamadı."),
        })}
      />
      </>
    );
  }

  return (
    <div className="mb-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-700/60">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Giriş hesabı yok — kurye saha ekranına kendi hesabıyla girsin diye oluşturun.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="input w-28"
          placeholder="Ad"
        />
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="input w-28"
          placeholder="Soyad"
        />
        <input
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input w-52"
          placeholder="E-posta"
        />
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input w-44"
          placeholder="Şifre (en az 8)"
        />
        <button
          onClick={() => {
            if (!email.includes("@")) return toast.error("Geçerli bir e-posta gir.");
            if (password.length < 8) return toast.error("Şifre en az 8 karakter olmalı.");
            if (!firstName.trim() || !lastName.trim())
              return toast.error("Ad ve soyad gerekli.");
            createAccount.mutate(
              {
                courierId: c.id,
                email: email.trim().toLowerCase(),
                password,
                first_name: firstName.trim(),
                last_name: lastName.trim(),
              },
              {
                onSuccess: () => {
                  setPassword("");
                  toast.success("Giriş hesabı oluşturuldu.");
                },
                onError: (e: any) =>
                  toast.error(e?.response?.data?.detail ?? "Hesap oluşturulamadı."),
              }
            );
          }}
          disabled={createAccount.isPending}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Hesap oluştur
        </button>
      </div>
    </div>
  );
}

function CourierRow({ c }: { c: Courier }) {
  const update = useUpdateCourier();
  const remove = useDeleteCourier();
  const uploadPhoto = useUploadCourierPhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(c.name);
  const [phone, setPhone] = useState(c.phone ?? "");

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
    <>
    <li>
      <div className="group flex items-center gap-3 py-3">
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
          {c.phone || "—"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
        <button
          onClick={() => setShowAccount((v) => !v)}
          className={`text-xs font-semibold hover:underline ${
            showAccount
              ? "text-slate-900 dark:text-white"
              : "text-indigo-600 dark:text-indigo-400"
          }`}
        >
          Hesap
        </button>
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
          onClick={() => setDeleteOpen(true)}
          className="text-xs font-semibold text-rose-500 hover:underline"
        >
          Sil
        </button>
      </div>
      </div>
      {showAccount && <CourierAccountPanel c={c} />}
    </li>
    <ConfirmDialog
      open={deleteOpen}
      title="Kurye profilini sil"
      description={`${c.name} kurye profili silinecek.`}
      confirmLabel="Kuryeyi sil"
      danger
      isPending={remove.isPending}
      onClose={() => setDeleteOpen(false)}
      onConfirm={() => remove.mutate(c.id, {
        onSuccess: () => setDeleteOpen(false),
        onError: () => toast.error("Silinemedi."),
      })}
    />
    </>
  );
}

export function CourierManager() {
  const { canManage } = useAdminAreaAccess("delivery");
  const { data: couriers = [], isLoading } = useCouriers();
  const create = useCreateCourier();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const add = () => {
    if (name.trim().length < 2) {
      toast.error("İsim en az 2 karakter olmalı.");
      return;
    }
    create.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          setName("");
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
            Müşteri takip kimliği (isim, fotoğraf) + saha ekranı giriş hesabı.
          </p>
        </div>
        {canManage && !adding && (
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
        ) : !canManage ? (
          // Salt-okunur rol: kimlik listesi görünür, düzenleme/hesap yüzeyi açılmaz.
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {couriers.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <CourierAvatar c={c} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{c.name}</p>
                  {c.phone && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{c.phone}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
