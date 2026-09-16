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
      mobilAltSeridiKoru
      // TELEFONDA TAM EKRAN, masaüstünde ortada pencere (kullanıcı kararı,
      // 9 Eyl 2026). Alttan açılan sheet biçimi telefonda kötü duruyordu:
      // klavye açılınca panel yarıya iniyor, arkadaki karartılmış sayfa
      // kullanıcının "hangi ekrandayım" hissini bozuyordu. Giriş bir ARA
      // İŞLEM değil, kendi başına bir ekrandır.
      //
      // `dvh` şart: `vh` mobil tarayıcılarda adres çubuğu gizliyken de aynı
      // değeri döndürür ve panel taşar.
      panelClassName="flex h-full w-full flex-col overflow-hidden bg-white sm:block sm:h-auto sm:max-w-md sm:scale-100 sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-slate-100 sm:animate-in sm:zoom-in-95 sm:duration-200 "
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

        <div className="flex-1 overflow-y-auto p-6 pt-16 sm:max-h-[90vh] sm:p-8">
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
            searchParams.delete("role");
            setSearchParams(searchParams, { replace: true });
          }}
          className="font-semibold text-marka-metin hover:text-marka-metin-hover "
        >
          Kayıt ol
        </button>
      </p>

      {/* ── ARZ TARAFININ KAPISI — buradan silinemez ──
          "Ders Ver" bağlantısı telefonda üst bardan kaldırıldı (mobil yeniden
          tasarımı, 9 Eyl 2026) ve eğitmen kaydına giden başka bir yol yok.
          Kaldırılırsa eğitmen hiç kaydolamaz; nöbetçi
          `__guards__/mobilAltSekmeler.test.tsx` bu kapıyı arar.

          ## Neden düz bir bağlantı DEĞİL (kullanıcı itirazı, 11 Eyl 2026)

          Önce "Kayıt ol" ile birebir aynı biçimdeydi: aynı marka rengi, aynı
          punto, aynı kalınlık, alt alta iki satır. İki AYRI KİTLEYE giden iki
          yol eşit ağırlıkta çizilince kullanıcı hangisinin kendisi olduğunu
          ancak cümleyi okuyarak anlıyordu; üstelik "Hesabın yok mu?" gibi bir
          bağlam cümlesi de yoktu, satır havada duruyordu.

          Uygulanan ayrım üç katmanlı:

            1. RENK — birincil yol (üye kaydı) markanın rengini TEK BAŞINA
               taşır; eğitmen yolu nötr (slate). Renk bu ekranda "asıl iş"i
               işaretler, iki yerde birden kullanılınca hiçbir şeyi işaretlemez.
            2. GEOMETRİ — saç teli çizgi + simge·başlık·alt başlık·ok satırı.
               Farklı bir biçim, "burası başka bir yere gidiyor" der. Kutu
               DEĞİL: bu ekranda ikinci bir kart, formla yarışırdı.
            3. DİL — "Ders vermek istiyorum" (kullanıcının ağzından bir istek)
               yerine "Eğitmen misin?" (kendi kitlesini adıyla çağıran bir
               soru). Soru formu kendi kendini eler: değilsen okumazsın.

          MASAÜSTÜNDE DE VAR (kullanıcı kararı, 16 Eyl 2026): önce yalnız
          telefonda çiziliyordu çünkü masaüstünde üst barda "Ders Ver" duruyor.
          Ama giriş penceresi açıkken üst bar arkada; pencerenin içinden
          eğitmen yoluna aynı resimli satırla gidilmesi iki yüzeyi eşitler. */}
      <div className="mt-5 border-t border-slate-100 pt-3">
        <button
          onClick={() => {
            searchParams.set("modal", "register");
            searchParams.set("role", "tutor");
            setSearchParams(searchParams, { replace: true });
          }}
          className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left transition hover:bg-slate-50 active:scale-[0.99]"
        >
          {/* Eğitmen görseli (kullanıcı kararı, 16 Eyl 2026): kategori
              şeridindeki "Eğitmenler" ile AYNI kaynak — giriş ekranındaki
              satır, ana sayfadaki kategoriyle aynı yüzü taşır. 72px WebP,
              36px kutuda 2x. Önceki mezuniyet kepi çizgi ikonu, resimli
              kategori diliyle uyuşmuyordu. */}
          <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100">
            <img
              src="/icons/egitmen-misin.webp"
              alt=""
              aria-hidden
              width={36}
              height={36}
              decoding="async"
              className="h-full w-full object-contain"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900">
              Eğitmen misin?
            </span>
            <span className="block text-xs text-slate-500">
              İlanını oluştur, öğrencilerle buluş
            </span>
          </span>
          <svg
            className="h-5 w-5 shrink-0 text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
          </svg>
        </button>
      </div>
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
