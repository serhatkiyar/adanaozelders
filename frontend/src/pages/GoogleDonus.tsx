import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { fetchMe, refreshSession } from "@/api/auth";
import { GOOGLE_GENEL_HATA, googleHataMetni } from "@/lib/googleHata";
import { guvenliDonusYolu } from "@/lib/guvenliDonus";
import { roleHome } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";

/**
 * Google akışının dönüş sayfası.
 *
 * Sunucu buraya `?durum=<kod>&git=<yol>&mod=<giris|kayit>` ile yönlendirir ve
 * yanıtta yalnız refresh çerezini yazar. Access token URL'de TAŞINMAZ (tarayıcı
 * geçmişine, `Referer`a ve ara sunucu loglarına yazılırdı); oturum burada
 * `POST /auth/refresh` ile tamamlanır.
 *
 * Hata durumunda toast yetmez: kullanıcı bir modaldan çıkmış ve bağlamını
 * kaybetmiş olabilir. O yüzden çıktığı yere, giriş penceresi yeniden açık
 * biçimde dönülür.
 */



export default function GoogleDonus() {
  const [params] = useSearchParams();
  const durum = params.get("durum");
  const git = guvenliDonusYolu(params.get("git"));
  const mod = params.get("mod");

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setToken = useAuthStore((s) => s.setToken);
  const setUser = useAuthStore((s) => s.setUser);

  const [mesaj, setMesaj] = useState<string | null>(null);
  // StrictMode geliştirmede effect'i iki kez çalıştırır; refresh token
  // ROTASYONLU olduğu için ikinci çağrı ilkinin token'ını geçersiz kılar.
  const calisti = useRef(false);

  useEffect(() => {
    if (calisti.current) return;
    calisti.current = true;

    if (durum !== "ok") {
      const metin = googleHataMetni(durum) ?? GOOGLE_GENEL_HATA;
      setMesaj(metin);
      toast.error(metin);
      // Kullanıcıyı çıktığı yere, giriş penceresi açık biçimde geri götür.
      const pencere = mod === "kayit" ? "register" : "login";
      if (git) {
        // Hata kodu da taşınır: toast kaybolabilir, ama pencerenin içindeki
        // kırmızı kutu kullanıcı orada durduğu sürece görünür kalır.
        const ayirac = git.includes("?") ? "&" : "?";
        const hataParam = durum ? `&hata=${encodeURIComponent(durum)}` : "";
        navigate(`${git}${ayirac}modal=${pencere}${hataParam}`, { replace: true });
      } else {
        navigate(mod === "kayit" ? ROUTES.register : ROUTES.login, { replace: true });
      }
      return;
    }

    (async () => {
      try {
        const token = await refreshSession();
        setToken(token.access_token);
        const kullanici = await fetchMe();
        setUser(kullanici);
        queryClient.setQueryData(["me"], kullanici);
        navigate(git ?? roleHome(kullanici.role_id), { replace: true });
      } catch {
        setMesaj(GOOGLE_GENEL_HATA);
        toast.error(GOOGLE_GENEL_HATA);
        navigate(ROUTES.login, { replace: true });
      }
    })();
  }, [durum, git, mod, navigate, queryClient, setToken, setUser]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg ring-1 ring-slate-100">
        <p className="text-sm text-slate-600">
          {mesaj ?? "Girişin tamamlanıyor..."}
        </p>
      </div>
    </div>
  );
}
