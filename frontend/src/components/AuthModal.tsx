import { FormEvent, useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchMe, login, register, type RegisterRole } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";
import { roleHome } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { Gender } from "@/types";

const GENDERS = [
  { value: Gender.MALE, label: "Erkek" },
  { value: Gender.FEMALE, label: "Kadın" },
  { value: Gender.UNSPECIFIED, label: "Belirtmek istemiyorum" },
] as const;

export function AuthModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const modal = searchParams.get("modal"); // "login" | "register"
  const roleParam = searchParams.get("role") as RegisterRole | null;
  const isOpen = modal === "login" || modal === "register";

  const close = () => {
    searchParams.delete("modal");
    searchParams.delete("role");
    setSearchParams(searchParams, { replace: true });
  };

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, searchParams]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={close} />
      
      <div className="relative w-full max-w-md scale-100 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-200 dark:bg-slate-800 dark:ring-slate-700">
        <button
          onClick={close}
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8 max-h-[90vh] overflow-y-auto">
          {modal === "login" ? <LoginForm onSuccess={close} /> : <RegisterForm initialRole={roleParam || "client"} onSuccess={() => {
            searchParams.set("modal", "login");
            setSearchParams(searchParams, { replace: true });
          }} />}
        </div>
      </div>
    </div>
  );
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const persistRemember = useAuthStore((s) => s.setRemember);

  const mutation = useMutation({
    mutationFn: async () => {
      const token = await login(email, password);
      persistRemember(rememberMe);
      setTokens(token.access_token, token.refresh_token ?? null);
      const user = await fetchMe();
      setUser(user);
      queryClient.setQueryData(["me"], user);
      return user;
    },
    onSuccess: (user) => {
      onSuccess();
      navigate(roleHome(user.role_id));
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <>
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Giriş Yap</h2>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            E-posta <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
            placeholder="ornek@eposta.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Parola <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
            placeholder="••••••••"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex select-none items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700"
            />
            Beni hatırla
          </label>
          <button
            type="button"
            onClick={() => {
              // Not implementing forgot password modal for now, just navigate to it.
              navigate(ROUTES.forgotPassword);
            }}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            Şifremi unuttum?
          </button>
        </div>

        {mutation.isError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {getErrorMessage(mutation.error, "E-posta veya parola hatalı.")}
          </div>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? "Giriş yapılıyor..." : "Giriş Yap"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Hesabın yok mu?{" "}
        <button
          onClick={() => {
            searchParams.set("modal", "register");
            setSearchParams(searchParams, { replace: true });
          }}
          className="font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          Kayıt ol
        </button>
      </p>
    </>
  );
}

function RegisterForm({ initialRole, onSuccess }: { initialRole: RegisterRole, onSuccess: () => void }) {
  const [role, setRole] = useState<RegisterRole>(initialRole);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<Gender | "">("");

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
      }),
    onSuccess,
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

  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <>
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Kayıt Ol</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Hesap türünü seçerek başla.
      </p>

      <div className="mt-6 flex gap-2">
        {roleTab("client", "Öğrenci")}
        {roleTab("tutor", "Eğitmen")}
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Ad <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              minLength={1}
              maxLength={75}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
              placeholder="Adınız"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Soyad <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              minLength={1}
              maxLength={75}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
              placeholder="Soyadınız"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Kullanıcı Adı <span className="text-red-500">*</span>
          </label>
          <input
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
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            E-posta <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
            placeholder="ornek@eposta.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Parola <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            required
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
            placeholder="En az 8 karakter"
          />
        </div>

        {/* Opsiyonel demografi */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Doğum Tarihi
            </label>
            <input
              type="date"
              max={todayStr}
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Cinsiyet
            </label>
            <select
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
          </div>
        </div>

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
        <button
          onClick={() => {
            searchParams.set("modal", "login");
            setSearchParams(searchParams, { replace: true });
          }}
          className="font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          Giriş yap
        </button>
      </p>
    </>
  );
}
