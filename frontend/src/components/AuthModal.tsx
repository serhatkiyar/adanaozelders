import { FormEvent, useState, useEffect } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchMe, login, type RegisterRole } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";
import { useKayitAcik } from "@/hooks/useKayitAcik";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { buildWelcome } from "@/lib/greeting";
import { toast } from "@/store/toastStore";
import { KayitAkisi } from "@/components/KayitAkisi";
import {
  GirisAyirici,
  GoogleGirisDugmesi,
} from "@/components/GoogleGirisDugmesi";
import { googleHataMetni } from "@/lib/googleHata";

export function AuthModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const modal = searchParams.get("modal"); // "login" | "register"
  const roleParam = searchParams.get("role") as RegisterRole | null;
  // Google akışı hata ile döndüğünde kullanıcıyı çıktığı pencereye geri
  // gönderiyor; toast kaybolabildiği için mesaj pencerenin içinde de
  // durmalı (tam sayfa gezinme yaşandı, bağlam kayboldu).
  const googleHatasi = googleHataMetni(searchParams.get("hata"));
  const kayitAcik = useKayitAcik();
  const isOpen = modal === "login" || modal === "register";

  const close = () => {
    searchParams.delete("modal");
    searchParams.delete("role");
    // Google akışından hata ile dönüldüğünde `hata` parametresi eklenir;
    // temizlenmezse pencere kapatılıp yeniden açıldığında eski hata mesajı
    // hâlâ orada durur.
    searchParams.delete("hata");
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
          className="mt-5 w-full rounded-xl bg-marka px-4 py-2.5 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover"
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
          {modal === "login" ? <LoginForm onSuccess={close} googleHatasi={googleHatasi} /> : <RegisterForm initialRole={roleParam || "client"} onSuccess={close} googleHatasi={googleHatasi} />}
        </div>
    </Modal>
  );
}

function LoginForm({ onSuccess, googleHatasi }: { onSuccess: () => void; googleHatasi?: string | null }) {
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
          <button
            type="button"
            onClick={() => {
              // Not implementing forgot password modal for now, just navigate to it.
              navigate(ROUTES.forgotPassword);
            }}
            className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover "
          >
            Şifremi unuttum?
          </button>
        </div>

        {(mutation.isError || googleHatasi) && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ">
            {mutation.isError
              ? getErrorMessage(mutation.error, "E-posta veya parola hatalı.")
              : googleHatasi}
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
      <GoogleGirisDugmesi mod="giris" hatirla={rememberMe} />

      <p className="mt-6 text-center text-sm text-slate-500 ">
        Hesabın yok mu?{" "}
        <button
          onClick={() => {
            searchParams.set("modal", "register");
            setSearchParams(searchParams, { replace: true });
          }}
          className="font-semibold text-marka-metin hover:text-marka-metin-hover "
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
/**
 * Penceredeki kayıt formu — akış `components/KayitAkisi.tsx` ile ORTAK.
 *
 * Form önce burada bir kopya olarak duruyordu. Akış üç adıma bölününce
 * (e-posta → ad/soyad → parola) kopya üç katına çıkacaktı ve iki yüzey
 * kaçınılmaz olarak ayrışırdı; sayfa bir adımı düzeltir, pencere eski hâlinde
 * kalırdı.
 */
function RegisterForm({
  initialRole,
  onSuccess,
  googleHatasi,
}: {
  initialRole: RegisterRole;
  onSuccess: () => void;
  googleHatasi?: string | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <>
      {googleHatasi && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ">
          {googleHatasi}
        </div>
      )}
      <KayitAkisi
        baslangicRolu={initialRole}
        onSuccess={onSuccess}
        girisBaglantisi={
          <p className="mt-6 text-center text-sm text-slate-500 ">
            Zaten hesabın var mı?{" "}
            <button
              onClick={() => {
                searchParams.set("modal", "login");
                searchParams.delete("hata");
                setSearchParams(searchParams, { replace: true });
              }}
              className="font-semibold text-marka-metin hover:text-marka-metin-hover "
            >
              Giriş yap
            </button>
          </p>
        }
      />
    </>
  );
}
