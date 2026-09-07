import { Link, useSearchParams } from "react-router-dom";

import type { RegisterRole } from "@/api/auth";

import { KayitAkisi } from "@/components/KayitAkisi";
import { ROUTES } from "@/lib/routes";

/**
 * Kayıt sayfası — kabuk.
 *
 * Formun kendisi `components/KayitAkisi.tsx` içindedir ve giriş penceresiyle
 * ORTAKTIR: akış üç adıma bölününce (e-posta → ad/soyad → parola) aynı formu
 * iki yerde tutmak kaçınılmaz olarak ayrışma üretirdi. Adımların gerekçesi ve
 * onay metninin kutu yerine cümle olma sebebi o dosyanın başlığındadır.
 */
export default function Register() {
  // Rol ekranda SORULMAZ, geldiğin yoldan belli olur: "Ders Ver" düğmesi
  // `?role=tutor` gönderir, diğer her yol üye kaydıdır. Pencere sürümü de
  // aynı parametreyi okuyor; iki yüzey ayrışmasın diye kural tek.
  const [params] = useSearchParams();
  const rol = params.get("role") === "tutor" ? "tutor" : "client";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 ">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-100 ">
        <KayitAkisi
          baslangicRolu={rol as RegisterRole}
          girisBaglantisi={
            <p className="mt-6 text-center text-sm text-slate-500 ">
              Zaten hesabın var mı?{" "}
              <Link
                to={ROUTES.login}
                className="font-semibold text-marka-metin hover:text-marka-metin-hover "
              >
                Giriş yap
              </Link>
            </p>
          }
        />
      </div>
    </div>
  );
}
