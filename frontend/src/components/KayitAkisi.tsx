import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { fetchMe, login, register, type RegisterRole } from "@/api/auth";
import { Field } from "@/components/ui/Field";
import {
  GirisAyirici,
  GoogleGirisDugmesi,
} from "@/components/GoogleGirisDugmesi";
import { getErrorMessage } from "@/lib/errors";
import { buildWelcome } from "@/lib/greeting";
import { currentConsentVersion } from "@/lib/legalContent";
import { roleHome } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";

/**
 * Kayıt akışı — TEK KAYNAK.
 *
 * `/kayit` sayfası ile giriş penceresi (`AuthModal`) aynı formu ayrı ayrı
 * taşıyordu; akış üç adıma bölününce o kopya üç katına çıkardı ve iki yüzey
 * kaçınılmaz olarak ayrışırdı. Form artık burada, ikisi de bunu çağırıyor.
 *
 * ## Neden adımlara bölündü
 *
 * Tek ekranda altı etkileşim vardı: ad, soyad, e-posta, parola, rol sekmesi,
 * onay kutusu. Kullanıcının kendi ifadesiyle "ben bile girmek istemiyorum".
 * Superprof aynı yerde tek bir e-posta kutusu gösterip ad/soyadı sonraki
 * adıma, parolayı üçüncü adıma bırakıyor. İlk ekranın maliyeti düştükçe
 * başlama oranı artar; asıl kazanç, kullanıcının formu görüp vazgeçmemesi.
 *
 * Google ile gelenler bu adımların HİÇBİRİNİ görmez: ad, soyad ve e-posta
 * zaten sağlayıcıdan geliyor, parola hiç yok.
 *
 * ## Onay kutusu neden metne döndü
 *
 * KVKK aydınlatma yükümlülüğü getirir, "kutu işaretlet" demez. Kutu bir
 * etkileşim daha demekti ve rakiplerde karşılığı yok (Superprof: "Kaydolarak
 * kullanım koşullarımızı kabul etmiş olursunuz" — kutu yok). Onay KAYDI aynen
 * sürüyor: `consent_version` sunucuya gidiyor ve `user_consents`a yazılıyor,
 * yani ispat zinciri kopmuyor.
 */

type Adim = "eposta" | "isim" | "parola";

const ADIM_SIRASI: Adim[] = ["eposta", "isim", "parola"];

interface Props {
  /** Başlangıç rolü — modal `?role=` ile ön seçim yapabiliyor. */
  baslangicRolu?: RegisterRole;
  /** Modal için: kayıt bitince pencereyi kapat. */
  onSuccess?: () => void;
  /** Modal içinde başlık ve "giriş yap" bağlantısı farklı render ediliyor. */
  girisBaglantisi: React.ReactNode;
}

export function KayitAkisi({
  baslangicRolu = "client",
  onSuccess,
  girisBaglantisi,
}: Props) {
  const [adim, setAdim] = useState<Adim>("eposta");
  // Rol EKRANDA sorulmaz; kullanıcının geldiği yoldan belli olur
  // ("Ders Ver" düğmesi `?role=tutor` gönderir, diğer her yol üye).
  const role = baslangicRolu;
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
      onSuccess?.();
      toast.success(buildWelcome(user.id, user.full_name));
      navigate(
        role === "tutor" ? ROUTES.tutorOnboarding : roleHome(user.role_id),
        { replace: true }
      );
    },
    onError: (err) => {
      // E-posta çakışması ilk adımda YAKALANMIYOR, bilerek: "bu e-posta kayıtlı
      // mı" sorusunu public bir uçtan cevaplamak, hangi adreslerin sisteme
      // kayıtlı olduğunu herkese açardı (hesap sayımı). Bedeli, hatanın son
      // adımda görülmesi; kullanıcıyı boş yere üç adım geri göndermemek için
      // e-posta adımına dönüp mesajı orada gösteriyoruz.
      const durum = (err as { response?: { status?: number } })?.response?.status;
      if (durum === 409) setAdim("eposta");
    },
  });

  const ilerle = (e: FormEvent) => {
    e.preventDefault();
    const sonraki = ADIM_SIRASI[ADIM_SIRASI.indexOf(adim) + 1];
    if (sonraki) setAdim(sonraki);
    else mutation.mutate();
  };

  const geri = () => {
    const onceki = ADIM_SIRASI[ADIM_SIRASI.indexOf(adim) - 1];
    if (onceki) setAdim(onceki);
  };

  // Kutular bilerek YÜKSEK (py-3.5). İnce alanlar yan yana gelince ekran
  // "sandviç" gibi sıkışık görünüyordu; dokunma hedefi de küçüktü. Yükseklik
  // düğmelerle (Google dahil) aynı tutuluyor, yoksa hizasız bir kolon çıkar.
  const inputCls =
    "mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 ";

  return (
    <>
      <div className="flex items-center gap-2">
        {adim !== "eposta" && (
          <button
            type="button"
            onClick={geri}
            aria-label="Önceki adıma dön"
            className="-ml-1 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus"
          >
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <h1 className="text-2xl font-bold text-slate-900">
          {adim !== "eposta"
            ? "Üyelik"
            : role === "tutor"
              ? "Eğitmen olarak kayıt ol"
              : "Kayıt Ol"}
        </h1>
      </div>

      <form onSubmit={ilerle} className="mt-6 space-y-4">
        {adim === "eposta" && (
          <>
            <Field label="E-posta" required>
              {(id) => (
                <input
                  id={id}
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  placeholder="ornek@eposta.com"
                />
              )}
            </Field>
          </>
        )}

        {adim === "isim" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Adınız" required>
              {(id) => (
                <input
                  id={id}
                  type="text"
                  required
                  autoFocus
                  minLength={1}
                  maxLength={75}
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={inputCls}
                />
              )}
            </Field>
            <Field label="Soyadınız" required>
              {(id) => (
                <input
                  id={id}
                  type="text"
                  required
                  minLength={1}
                  maxLength={75}
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={inputCls}
                />
              )}
            </Field>
          </div>
        )}

        {adim === "parola" && (
          <Field label="Parola" required>
            {(id) => (
              <input
                id={id}
                type="password"
                required
                autoFocus
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder="En az 8 karakter"
              />
            )}
          </Field>
        )}

        {mutation.isError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {getErrorMessage(mutation.error, "Kayıt başarısız.")}
          </div>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-xl bg-marka py-3.5 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {adim === "eposta"
            ? "E-posta ile kayıt ol"
            : adim === "parola"
              ? mutation.isPending
                ? "Kaydediliyor..."
                : "Kayıt Ol"
              : "Devam et"}
        </button>
      </form>

      {adim === "eposta" && (
        <>
          <GirisAyirici />
          <GoogleGirisDugmesi
            mod="kayit"
            rol={role}
            onaySurumu={currentConsentVersion()}
          />
          <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
            Kaydolarak{" "}
            <Link
              to={ROUTES.terms}
              target="_blank"
              className="underline underline-offset-2 hover:text-slate-600"
            >
              kullanım koşullarımızı
            </Link>{" "}
            kabul etmiş olursun.
          </p>
        </>
      )}

      {girisBaglantisi}
    </>
  );
}
