import { FormEvent, useState, useEffect } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchMe, login, register, type RegisterRole } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";
import { useKayitAcik } from "@/hooks/useKayitAcik";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { buildWelcome } from "@/lib/greeting";
import { toast } from "@/store/toastStore";
import { ConsentCheckbox } from "@/components/LegalConsent";
import { currentConsentVersion } from "@/lib/legalContent";

export function AuthModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const modal = searchParams.get("modal"); // "login" | "register"
  const roleParam = searchParams.get("role") as RegisterRole | null;
  const kayitAcik = useKayitAcik();
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

  // Kayıt bayrağı kapalıyken ?modal=register doğrudan URL'den açılsa bile
  // form yerine bilgilendirme gösterilir (asıl kilit backend'de, 403).
  if (modal === "register" && !kayitAcik) {
    return (
      <Modal
        open
        onClose={close}
        ariaLabel="Kayıt kapalı"
        hideCloseButton
        panelClassName="w-full max-w-md scale-100 overflow-hidden rounded-2xl bg-white p-8 shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-200 "
      >
        <h2 className="text-lg font-bold text-slate-900">Kayıtlar şu anda kapalı</h2>
        <p className="mt-2 text-sm text-slate-600">
          Yeni üye kaydı geçici olarak durduruldu. Mevcut hesabınız varsa giriş
          yapabilirsiniz.
        </p>
        <button
          type="button"
          onClick={() => {
            searchParams.set("modal", "login");
            searchParams.delete("role");
            setSearchParams(searchParams, { replace: true });
          }}
          className="mt-5 w-full rounded-xl bg-marka px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-marka-hover"
        >
          Giriş Yap
        </button>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={close}
      ariaLabel={modal === "login" ? "Giriş yap" : "Kayıt ol"}
      hideCloseButton
      panelClassName="w-full max-w-md scale-100 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-200 "
    >
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 z-10 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus "
        >
          <span className="sr-only">Kapat</span>
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8 max-h-[90vh] overflow-y-auto">
          {modal === "login" ? <LoginForm onSuccess={close} /> : <RegisterForm initialRole={roleParam || "client"} onSuccess={close} />}
        </div>
    </Modal>
  );
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setToken = useAuthStore((s) => s.setToken);
  const setUser = useAuthStore((s) => s.setUser);
  const persistRemember = useAuthStore((s) => s.setRemember);

  const mutation = useMutation({
    mutationFn: async () => {
      const token = await login(email, password, rememberMe);
      persistRemember(rememberMe);
      setToken(token.access_token);
      const user = await fetchMe();
      setUser(user);
      queryClient.setQueryData(["me"], user);
      return user;
    },
    onSuccess: (user) => {
      // Modal kapanır, kullanıcı bulunduğu sayfada KALIR (mağaza/ürün/ödeme).
      // `/` zaten RootDispatcher olduğundan oradakiler otomatik workspace görür.
      // (Özel /giris sayfası kendi yönlendirmesini ayrıca yapar.)
      onSuccess();
      toast.success(buildWelcome(user.id, user.full_name));
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <>
      <h2 className="text-2xl font-bold text-slate-900 ">Giriş Yap</h2>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
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
              className="h-4 w-4 rounded border-slate-300 text-marka focus:ring-2 focus:ring-marka/20 accent-marka"
            />
            Beni hatırla
          </label>
          <button
            type="button"
            onClick={() => {
              // Not implementing forgot password modal for now, just navigate to it.
              navigate(ROUTES.forgotPassword);
            }}
            className="text-sm font-medium text-marka hover:text-marka-hover "
          >
            Şifremi unuttum?
          </button>
        </div>

        {mutation.isError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ">
            {getErrorMessage(mutation.error, "E-posta veya parola hatalı.")}
          </div>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-lg bg-marka py-2.5 text-sm font-semibold text-white transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? "Giriş yapılıyor..." : "Giriş Yap"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500 ">
        Hesabın yok mu?{" "}
        <button
          onClick={() => {
            searchParams.set("modal", "register");
            setSearchParams(searchParams, { replace: true });
          }}
          className="font-semibold text-marka hover:text-marka-hover "
        >
          Kayıt ol
        </button>
      </p>
    </>
  );
}

/**
 * Kayıt formu DÖRT ALANDIR — gerekçesi `pages/Register.tsx` başlığındadır.
 * Kayıt başarılıysa otomatik giriş yapılır; eğitmen ilan sihirbazına gider.
 */
function RegisterForm({ initialRole, onSuccess }: { initialRole: RegisterRole, onSuccess: () => void }) {
  const [role, setRole] = useState<RegisterRole>(initialRole);
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
        // KVKK ispat kaydı (bkz. Register.tsx).
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
      onSuccess();
      toast.success(buildWelcome(user.id, user.full_name));
      if (role === "tutor") navigate(ROUTES.tutorOnboarding);
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
          ? "bg-marka text-white"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200 "
      }`}
    >
      {label}
    </button>
  );

  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <>
      <h2 className="text-2xl font-bold text-slate-900 ">Kayıt Ol</h2>
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
          className="w-full rounded-lg bg-marka py-2.5 text-sm font-semibold text-white transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? "Kaydediliyor..." : "Kayıt Ol"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500 ">
        Zaten hesabın var mı?{" "}
        <button
          onClick={() => {
            searchParams.set("modal", "login");
            setSearchParams(searchParams, { replace: true });
          }}
          className="font-semibold text-marka hover:text-marka-hover "
        >
          Giriş yap
        </button>
      </p>
    </>
  );
}
