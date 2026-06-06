import { FormEvent, useState } from "react";
import { AxiosError } from "axios";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useChangePassword } from "@/hooks/useProfile";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROLE_IDS } from "@/types";
import { AddressSection } from "@/components/AddressSection";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

const cardClass =
  "rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700";

const labelClass =
  "block text-sm font-medium text-slate-700 dark:text-slate-300";

export default function Settings() {
  const { data: user, isLoading } = useCurrentUser();
  const changePassword = useChangePassword();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const roleNav =
    user?.role_id === ROLE_IDS.CLIENT
      ? STUDENT_NAV
      : user?.role_id === ROLE_IDS.TUTOR
        ? TUTOR_NAV
        : undefined;

  const pwMismatch =
    next.length > 0 && confirm.length > 0 && next !== confirm;

  const handlePassword = (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) {
      toast.error("Yeni şifre en az 8 karakter olmalı.");
      return;
    }
    if (next !== confirm) {
      toast.error("Yeni şifreler eşleşmiyor.");
      return;
    }
    changePassword.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: () => {
          toast.success("Şifren değiştirildi.");
          setCurrent("");
          setNext("");
          setConfirm("");
        },
        onError: (err) => {
          if (err instanceof AxiosError && err.response?.status === 400) {
            toast.error("Mevcut şifre hatalı.");
            return;
          }
          toast.error(getErrorMessage(err, "Şifre değiştirilemedi."));
        },
      }
    );
  };

  return (
    <DashboardShell title="Hesap Ayarları" navItems={roleNav}>
      <div className="mx-auto max-w-2xl space-y-6 pb-12">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          Hesap Ayarları
        </h2>

        {isLoading || !user ? (
          <>
            <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            <div className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          </>
        ) : (
          <>
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Hesap
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                İletişim bilgilerini yönet. Profil fotoğrafını{" "}
                <span className="font-medium text-slate-600 dark:text-slate-300">Profil</span>{" "}
                sayfasından (avatarına tıklayarak) değiştirebilirsin.
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <label className={labelClass}>E-posta</label>
                  <input
                    type="email"
                    value={user.email}
                    disabled
                    className={`${inputClass} cursor-not-allowed bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-500`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Kullanıcı Adı</label>
                  <input
                    type="text"
                    value={`@${user.username}`}
                    disabled
                    className={`${inputClass} cursor-not-allowed bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-500`}
                  />
                </div>
              </div>
            </section>

            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Şifre Değiştir
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Güvenliğin için mevcut şifreni doğrulaman gerekir.
              </p>

              <form onSubmit={handlePassword} className="mt-5 space-y-4">
                <div>
                  <label className={labelClass}>Mevcut Şifre</label>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Yeni Şifre</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    className={inputClass}
                    placeholder="En az 8 karakter"
                  />
                </div>
                <div>
                  <label className={labelClass}>Yeni Şifre (Tekrar)</label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={`${inputClass} ${
                      pwMismatch
                        ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                        : ""
                    }`}
                  />
                  {pwMismatch && (
                    <p className="mt-1 text-xs text-red-500">
                      Şifreler eşleşmiyor.
                    </p>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={
                      changePassword.isPending ||
                      !current ||
                      !next ||
                      !confirm ||
                      pwMismatch
                    }
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {changePassword.isPending
                      ? "Değiştiriliyor..."
                      : "Şifreyi Değiştir"}
                  </button>
                </div>
              </form>
            </section>

            {/* Kayıtlı adresler — yalnız öğrenci (yüzyüze rezervasyon konumları) */}
            {user.role_id === ROLE_IDS.CLIENT && <AddressSection />}
          </>
        )}
      </div>
    </DashboardShell>
  );
}
