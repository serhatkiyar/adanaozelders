import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchMe, login } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";
import { roleHome } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { buildWelcome } from "@/lib/greeting";
import { toast } from "@/store/toastStore";
import {
  GirisAyirici,
  GoogleGirisDugmesi,
} from "@/components/GoogleGirisDugmesi";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const justRegistered = (location.state as { registered?: boolean } | null)
    ?.registered;
  const [rememberMe, setRememberMe] = useState(true);
  const queryClient = useQueryClient();
  const setToken = useAuthStore((s) => s.setToken);
  const setUser = useAuthStore((s) => s.setUser);
  const persistRemember = useAuthStore((s) => s.setRemember);

  const mutation = useMutation({
    mutationFn: async () => {
      // Tercih iki yere birden gider: sunucuya (refresh çerezinin ömrü) ve
      // yerele (access token'ın local mi session storage'da mı duracağı).
      const token = await login(email, password, rememberMe);
      persistRemember(rememberMe);
      setToken(token.access_token);
      const user = await fetchMe();
      setUser(user);
      queryClient.setQueryData(["me"], user);
      return user;
    },
    onSuccess: (user) => {
      toast.success(buildWelcome(user.id, user.full_name));
      navigate(roleHome(user.role_id), { replace: true });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 ">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-100 ">
        <h1 className="text-2xl font-bold text-slate-900 ">Giriş Yap</h1>

        {justRegistered && (
          <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ">
            Kayıt başarılı. Şimdi giriş yapabilirsin.
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field label="E-posta" required>
            {(id) => (
              <input
                id={id}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                placeholder="ornek@eposta.com"
              />
            )}
          </Field>

          <Field label="Parola" required>
            {(id) => (
              <input
                id={id}
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                placeholder="••••••••"
              />
            )}
          </Field>

          <div className="flex items-center justify-between">
            <label className="flex select-none items-center gap-2 text-sm text-slate-600 ">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-marka-metin focus:ring-2 focus:ring-marka/20 accent-marka"
              />
              Beni hatırla
            </label>
            <Link
              to={ROUTES.forgotPassword}
              className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover "
            >
              Şifremi unuttum?
            </Link>
          </div>

          {mutation.isError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ">
              {getErrorMessage(
                mutation.error,
                "E-posta veya parola hatalı."
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-xl bg-marka py-3.5 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </form>

        <GirisAyirici />
        {/* "Beni hatırla" tercihi Google akışına da taşınır: refresh çerezinin
            ömrünü sunucu, access token'ın nerede duracağını yerel bayrak
            belirliyor ve ikisi de düğmeye basıldığı anda sabitleniyor. */}
        <GoogleGirisDugmesi mod="giris" hatirla={rememberMe} />

        <p className="mt-6 text-center text-sm text-slate-500 ">
          Hesabın yok mu?{" "}
          <Link
            to={ROUTES.register}
            className="font-semibold text-marka-metin hover:text-marka-metin-hover "
          >
            Kayıt ol
          </Link>
        </p>
      </div>
    </div>
  );
}
