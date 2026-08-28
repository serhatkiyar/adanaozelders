import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { requestPasswordReset } from "@/api/auth";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");

  const mutation = useMutation({
    mutationFn: () => requestPasswordReset(email),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 ">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-100 ">
        <h1 className="text-2xl font-bold text-slate-900 ">
          Şifreni mi unuttun?
        </h1>
        <p className="mt-1 text-sm text-slate-500 ">
          E-posta adresini gir; sana bir sıfırlama bağlantısı gönderelim.
        </p>

        {mutation.isSuccess ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ">
              {mutation.data?.detail ??
                "E-posta adresin kayıtlıysa şifre sıfırlama bağlantısı gönderildi."}
              <span className="mt-1 block text-emerald-600/80 ">
                Gelen kutunu (ve geliştirme ortamında MailHog'u) kontrol et.
              </span>
            </div>
            <Link
              to={ROUTES.login}
              className="inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-700 "
            >
              ← Giriş ekranına dön
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="E-posta">
              {(id) => (
                  <input
                    id={id}
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 "
                    placeholder="ornek@eposta.com"
                  />
              )}
            </Field>

            {mutation.isError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ">
                {getErrorMessage(mutation.error, "Bağlantı gönderilemedi.")}
              </div>
            )}

            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mutation.isPending ? "Gönderiliyor..." : "Sıfırlama bağlantısı gönder"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-500 ">
          Şifreni hatırladın mı?{" "}
          <Link
            to={ROUTES.login}
            className="font-semibold text-indigo-600 hover:text-indigo-700 "
          >
            Giriş yap
          </Link>
        </p>
      </div>
    </div>
  );
}
