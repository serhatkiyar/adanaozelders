import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { register, type RegisterRole } from "@/api/auth";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { ConsentCheckbox } from "@/components/LegalConsent";
import { Gender } from "@/types";
import { currentConsentVersion } from "@/lib/legalContent";

const GENDERS = [
  { value: Gender.MALE, label: "Erkek" },
  { value: Gender.FEMALE, label: "Kadın" },
  { value: Gender.UNSPECIFIED, label: "Belirtmek istemiyorum" },
] as const;

export default function Register() {
  const [role, setRole] = useState<RegisterRole>("client");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const navigate = useNavigate();

  const todayStr = new Date().toISOString().slice(0, 10);

  const mutation = useMutation({
    mutationFn: () =>
      register(role, {
        email,
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        username: username.trim(),
        birth_date: birthDate || null,
        gender: gender || null,
        // KVKK ispat kaydı: onaylanan metinlerin sürümü sunucuya yazılır.
        consent_version: currentConsentVersion(),
      }),
    onSuccess: () => {
      navigate(ROUTES.login, {
        replace: true,
        state: { registered: true },
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
          ? "bg-indigo-600 text-white"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-900">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Kayıt Ol</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
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
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
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
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
                    placeholder="Soyadınız"
                  />
              )}
            </Field>
          </div>

          <Field label="Kullanıcı Adı" required>
            {(id) => (
                <input
                    id={id}
                  type="text"
                  required
                  minLength={3}
                  maxLength={50}
                  pattern="[a-zA-Z0-9_]+"
                  title="Yalnızca harf, rakam ve alt çizgi (_)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
                  placeholder="kullanici_adi"
                />
            )}
          </Field>

          <Field label="E-posta" required>
            {(id) => (
                <input
                    id={id}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
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
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
                  placeholder="En az 8 karakter"
                />
            )}
          </Field>

          {/* Opsiyonel demografi */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Doğum Tarihi">
              {(id) => (
                  <input
                    id={id}
                    type="date"
                    max={todayStr}
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
              )}
            </Field>
            <Field label="Cinsiyet">
              {(id) => (
                  <select
                    id={id}
                    value={gender}
                    onChange={(e) => setGender(e.target.value as Gender | "")}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  >
                    <option value="">Seçilmedi</option>
                    {GENDERS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
              )}
            </Field>
          </div>

          <ConsentCheckbox />

          {mutation.isError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {getErrorMessage(mutation.error, "Kayıt başarısız.")}
            </div>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? "Kaydediliyor..." : "Kayıt Ol"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Zaten hesabın var mı?{" "}
          <Link
            to={ROUTES.login}
            className="font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            Giriş yap
          </Link>
        </p>
      </div>
    </div>
  );
}
