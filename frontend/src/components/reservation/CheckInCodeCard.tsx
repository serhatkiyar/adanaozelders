// Girişte görevliye söylenecek kod.
//
// ## Neden QR yok
//
// Bilet koçanı ve QR kaldırıldı. Apple'ın pas taksonomisinde perfore kenar
// kupona/sadakat kartına, kesik kenar biniş kartına aittir; Google Wallet ise
// "reservations" ve "library membership" için açıkça `generic` tipi gösterir.
// Koltuk rezervasyonu devredilemez, ikincil pazarı yok, sahtecilik riski yok —
// bilet estetiği burada sahte bir çağrışım üretiyordu. Doğrulama artık tek
// yoldan: operatör kodu panele yazar (o alan zaten vardı).
//
// ## ÜÇ durum, ikisi değil
//
// Sunucu `status != PAID` iken `short_code`u null'lar
// (`library_exam_service.py:541-544`). Yani GİRİŞ YAPMIŞ kayıtta da kod boş
// gelir. Eski ekran iki dal tanıyordu (kod var / kod yok) ve boş kodu
// "Ödeme sonrası oluşur" diye gösteriyordu — parasını ödemiş, içeri girmiş
// kullanıcıya ödeme yapmamış gibi davranıyordu. Burada "giriş yapıldı" ayrı
// bir daldır.
import { useState } from "react";

import { formatDateTime } from "@/lib/datetime";
import { toast } from "@/store/toastStore";

export function CheckInCodeCard({
  kod,
  girisYapildi,
  girisZamani,
}: {
  kod: string | null;
  girisYapildi: boolean;
  girisZamani?: string | null;
}) {
  const [kopyalandi, setKopyalandi] = useState(false);

  if (girisYapildi) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-medium text-emerald-800">Giriş yapıldı</p>
        <p className="mt-0.5 text-sm text-emerald-700">
          {girisZamani
            ? `${formatDateTime(girisZamani)} tarihinde doğrulandı.`
            : "Katılımın doğrulandı."}
        </p>
      </div>
    );
  }

  if (!kod) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm font-medium text-slate-700">Giriş kodu henüz yok</p>
        <p className="mt-0.5 text-sm text-slate-500">
          Ödemen tamamlanınca giriş kodun burada görünecek.
        </p>
      </div>
    );
  }

  const kopyala = async () => {
    try {
      await navigator.clipboard.writeText(kod);
      setKopyalandi(true);
      setTimeout(() => setKopyalandi(false), 2000);
    } catch {
      // Pano izni yoksa kod zaten ekranda okunabiliyor; sessiz kalmak yerine söyle.
      toast.error("Kopyalanamadı, kodu ekrandan okuyabilirsin.");
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-sm text-slate-500">Girişte bu kodu görevliye söyle</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <span className="font-mono text-2xl font-semibold tracking-[0.2em] text-slate-900">
          {kod}
        </span>
        <button
          type="button"
          onClick={kopyala}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          {kopyalandi ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
    </div>
  );
}
