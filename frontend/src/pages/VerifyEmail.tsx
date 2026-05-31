import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { confirmEmailVerification, fetchMe } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";
import { roleHome } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";

type Status = "verifying" | "success" | "error";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const queryClient = useQueryClient();
  const authToken = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState<string>("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode çift-çağrısını engelle
    ran.current = true;

    if (!token) {
      setStatus("error");
      setMessage("Doğrulama bağlantısı geçersiz.");
      return;
    }

    (async () => {
      try {
        const res = await confirmEmailVerification(token);
        setMessage(res.detail ?? "E-posta adresin doğrulandı.");
        setStatus("success");
        // Oturum açıksa kullanıcı bilgisini tazele ki doğrulama banner'ı kalksın.
        if (authToken) {
          try {
            const me = await fetchMe();
            setUser(me);
            queryClient.setQueryData(["me"], me);
          } catch {
            /* tazeleme başarısız olsa da doğrulama başarılı; yok say */
          }
        }
      } catch (err) {
        setStatus("error");
        setMessage(
          getErrorMessage(
            err,
            "Doğrulama bağlantısı geçersiz veya süresi dolmuş."
          )
        );
      }
    })();
  }, [token, authToken, setUser, queryClient]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-900">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
        {status === "verifying" && (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
              E-postan doğrulanıyor…
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Lütfen bekle.
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-6 w-6 text-emerald-600 dark:text-emerald-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m4.5 12.75 6 6 9-13.5"
                />
              </svg>
            </div>
            <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
              E-postan doğrulandı 🎉
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {message}
            </p>
            <Link
              to={authToken ? roleHome(user?.role_id) : ROUTES.login}
              className="mt-6 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              {authToken ? "Panele git" : "Giriş yap"}
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/15">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-6 w-6 text-red-600 dark:text-red-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
              Doğrulanamadı
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {message}
            </p>
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              Panelindeki banner'dan yeni bir doğrulama bağlantısı
              isteyebilirsin.
            </p>
            <Link
              to={authToken ? roleHome(user?.role_id) : ROUTES.login}
              className="mt-6 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              {authToken ? "Panele dön" : "Giriş yap"}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
