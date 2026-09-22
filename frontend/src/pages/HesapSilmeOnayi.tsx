import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";

import { deleteMyAccount } from "@/api/users";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";

/**
 * Parolasız (Google ile açılmış) hesabın silme onayı.
 *
 * Parolalı hesapta silme parola ile onaylanır; parolası olmayan hesabın o yolu
 * yoktur ve KVKK silme hakkı kapalı bırakılamaz. Onay yine de İKİNCİ bir kanıt
 * ister: e-posta kutusuna erişim.
 *
 * Bağlantıya tıklamak TEK BAŞINA silmez. Geri alınamaz bir işlem için tek
 * tıklık bir tetik yanlış olurdu: e-posta önizlemesi yapan bir istemci ya da
 * yanlışlıkla açılan bir sekme hesabı yok ederdi. Kullanıcı burada da onay
 * kelimesini yazar — Ayarlar'daki formun aynı kapısı.
 */

const ONAY_KELIMESI = "HESABIMI SİL";

export default function HesapSilmeOnayi() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [onayMetni, setOnayMetni] = useState("");

  const sil = useMutation({
    mutationFn: () => deleteMyAccount({ token }),
    onSuccess: () => {
      toast.success("Hesabın kapatıldı.");
      logout();
      navigate(ROUTES.home, { replace: true });
    },
    onError: (err) =>
      toast.error(
        getErrorMessage(err, "Hesap silinemedi. Bağlantının süresi dolmuş olabilir.")
      ),
  });

  const gonder = (e: FormEvent) => {
    e.preventDefault();
    sil.mutate();
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg ring-1 ring-slate-100">
          <h1 className="text-xl font-bold text-slate-900">Bağlantı geçersiz</h1>
          <p className="mt-2 text-sm text-slate-600">
            Silme bağlantısı eksik ya da bozuk görünüyor.
          </p>
          <Link
            to={ROUTES.accountSettings}
            className="mt-5 inline-block text-sm font-semibold text-marka-metin hover:text-marka-metin-hover"
          >
            Ayarlara dön
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-100">
        <h1 className="text-xl font-bold text-slate-900">Hesabını silmeyi onayla</h1>
        <p className="mt-3 text-sm text-slate-600">
          Bu işlem <strong>geri alınamaz</strong>. Adın, e-postan, telefonun ve
          adreslerin silinir; hesabın kapanır.{" "}
          <span className="text-slate-500">
            Faturalı sipariş ve ödeme kayıtların, vergi mevzuatı gereği saklanmak
            zorunda olduğundan kimliğinden arındırılmış olarak kalır.
          </span>
        </p>

        <form onSubmit={gonder} className="mt-5">
          <label htmlFor="silme-onayi" className="text-sm font-medium text-slate-700">
            Onaylamak için <code>{ONAY_KELIMESI}</code> yaz
          </label>
          <input
            id="silme-onayi"
            type="text"
            required
            value={onayMetni}
            onChange={(e) => setOnayMetni(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20"
          />

          <div className="mt-5 flex justify-end gap-2">
            <Link
              to={ROUTES.accountSettings}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Vazgeç
            </Link>
            <button
              type="submit"
              disabled={onayMetni.trim() !== ONAY_KELIMESI || sil.isPending}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sil.isPending ? "Siliniyor..." : "Hesabımı kalıcı olarak sil"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
