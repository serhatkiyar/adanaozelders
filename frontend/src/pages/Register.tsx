import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { fetchMe, login, register, type RegisterRole } from "@/api/auth";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { ConsentCheckbox } from "@/components/LegalConsent";
import { currentConsentVersion } from "@/lib/legalContent";
import { useAuthStore } from "@/store/authStore";
import { buildWelcome } from "@/lib/greeting";
import { roleHome } from "@/lib/roles";
import { toast } from "@/store/toastStore";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Kayıt formu DÖRT ALANDIR: ad, soyad, e-posta, parola.
 *
 * Kullanıcı adı artık SORULMUYOR — sunucu ad-soyaddan üretiyor
 * (`auth_service._turet_kullanici_adi`); doğum tarihi ve cinsiyet ise zaten
 * isteğe bağlıydı, `/ayarlar`'dan doldurulabiliyor. Kayıt ekranındaki her
 * fazladan alan, ilanını oluşturmaya başlamadan vazgeçen aday demek.
 *
 * Kayıt başarılıysa OTOMATİK GİRİŞ yapılır: eğitmen doğrudan ilan
 * sihirbazına düşer. Önceki davranış (giriş sayfasına atıp parolayı tekrar
 * sordurmak) akışı tam başlangıçta kesiyordu.
 */

export default function Register() {
  const [role, setRole] = useState<RegisterRole>("client");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setToken = useAuthStore((s) => s.setToken);
  const setUser = useAuthStore((s) => s.setUser);

  const mutation = useMutation({
    mutationFn: async () => {
      await register(role, {
        email,
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        // KVKK ispat kaydı: onaylanan metinlerin sürümü sunucuya yazılır.
        consent_version: currentConsentVersion(),
      });
      const token = await login(email, password);
      setToken(token.access_token);
      const user = await fetchMe();
      setUser(user);
      queryClient.setQueryData(["me"], user);
      return user;
    },
    onSuccess: (user) => {
      toast.success(buildWelcome(user.id, user.full_name));
      navigate(role === "tutor" ? ROUTES.tutorOnboarding : roleHome(user.role_id), {
        replace: true,
      });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const roleTab = (value: RegisterRole, label: string) => (
    <button
      type="button"
      onClick={() => setRole(value)}
      className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
        role === value
          ? "bg-marka text-marka-fg"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200 "
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 ">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-100 ">
        <h1 className="text-2xl font-bold text-slate-900 ">Kayıt Ol</h1>
        <p className="mt-1 text-sm text-slate-500 ">
          Hesap türünü seçerek başla.
        </p>

        <div className="mt-6 flex gap-2">
          {roleTab("client", "Öğrenci")}
          {roleTab("tutor", "Eğitmen")}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ad" required>
              {(id) => (
                  <input
                    id={id}
                    type="text"
                    required
                    minLength={1}
                    maxLength={75}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                    placeholder="Adınız"
                  />
              )}
            </Field>
            <Field label="Soyad" required>
              {(id) => (
                  <input
                    id={id}
                    type="text"
                    required
                    minLength={1}
                    maxLength={75}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                    placeholder="Soyadınız"
                  />
              )}
            </Field>
          </div>

          <Field label="E-posta" required>
            {(id) => (
                <input
                    id={id}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
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
                  minLength={8}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                  placeholder="En az 8 karakter"
                />
            )}
          </Field>

          <ConsentCheckbox />

          {mutation.isError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ">
              {getErrorMessage(mutation.error, "Kayıt başarısız.")}
            </div>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-lg bg-marka py-2.5 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? "Kaydediliyor..." : "Kayıt Ol"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500 ">
          Zaten hesabın var mı?{" "}
          <Link
            to={ROUTES.login}
            className="font-semibold text-marka-metin hover:text-marka-metin-hover "
          >
            Giriş yap
          </Link>
        </p>
      </div>
    </div>
  );
}
