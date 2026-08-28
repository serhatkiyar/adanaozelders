import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { confirmPasswordReset } from "@/api/auth";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => confirmPasswordReset(token, password),
    onSuccess: () => {
      // Kısa bir başarı mesajından sonra girişe yönlendir.
      setTimeout(() => navigate(ROUTES.login, { replace: true }), 2500);
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (password.length < 8) {
      setLocalError("Şifre en az 8 karakter olmalı.");
      return;
    }
    if (password !== confirm) {
      setLocalError("Şifreler eşleşmiyor.");
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 ">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-100 ">
        <h1 className="text-2xl font-bold text-slate-900 ">
          Yeni şifre belirle
        </h1>
        <p className="mt-1 text-sm text-slate-500 ">
          Hesabın için yeni bir şifre oluştur.
        </p>

        {!token ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ">
              Bağlantı geçersiz. Lütfen şifre sıfırlama işlemini yeniden başlat.
            </div>
            <Link
              to={ROUTES.forgotPassword}
              className="inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-700 "
            >
              ← Sıfırlama bağlantısı iste
            </Link>
          </div>
        ) : mutation.isSuccess ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ">
              {mutation.data?.detail ?? "Şifren güncellendi."} Giriş ekranına
              yönlendiriliyorsun…
            </div>
            <Link
              to={ROUTES.login}
              className="inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-700 "
            >
              Hemen giriş yap →
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="Yeni şifre">
              {(id) => (
                  <input
                    id={id}
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 "
                    placeholder="En az 8 karakter"
                  />
              )}
            </Field>

            <Field label="Yeni şifre (tekrar)">
              {(id) => (
                  <input
                    id={id}
                    type="password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 "
                    placeholder="••••••••"
                  />
              )}
            </Field>

            {(localError || mutation.isError) && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ">
                {localError ??
                  getErrorMessage(
                    mutation.error,
                    "Şifre güncellenemedi. Bağlantının süresi dolmuş olabilir."
                  )}
              </div>
            )}

            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mutation.isPending ? "Güncelleniyor..." : "Şifreyi güncelle"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
