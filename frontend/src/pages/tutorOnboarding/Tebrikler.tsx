import { useState } from "react";
import { Link } from "react-router-dom";

import { ShareModal } from "@/components/ShareModal";
import { PlainButton } from "@/components/ui/PlainButton";
import { ROUTES } from "@/lib/routes";

/**
 * Sihirbazın kapanış ekranı.
 *
 * Paylaşım burada duruyor çünkü eğitmenin ilanını arkadaşına göndermeye en
 * yakın olduğu an, onu az önce bitirdiği andır. Adana'da ağızdan ağıza yayılma
 * en güçlü kanal; eğitmen ilanını kendi çevresine ulaştırdığında ilk öğrenciyi
 * çok daha hızlı buluyor.
 *
 * AMA YALNIZ ONAYDAN SONRA. Onay bekleyen ilanın public adresi 404 döner
 * (`search_service.get_tutor_public` yalnız APPROVED + aktif ilanı verir).
 * "Paylaş" ve "İlanını gör" o aşamada ölü bağlantıdır; üstelik eğitmen bu
 * linki çevresine gönderip "sayfa bulunamadı" gösterebilir. Onay beklerken
 * ekran bunu açıkça söyler ve paylaşımı SUNMAZ.
 */
export function Tebrikler({
  slug,
  ad,
  onayBekliyor,
}: {
  slug: string;
  ad: string;
  onayBekliyor: boolean;
}) {
  const [paylasAcik, setPaylasAcik] = useState(false);
  const yol = ROUTES.tutor(slug);
  const tamAdres = `${window.location.origin}${yol}`;

  return (
    <div className="mx-auto max-w-xl px-5 py-16 text-center sm:py-24">
      <div
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
        aria-hidden="true"
      >
        <svg
          className="h-7 w-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h1 className="mt-7 text-[28px] font-semibold leading-snug tracking-tight text-slate-900 sm:text-[32px]">
        {onayBekliyor ? "İlanın incelemeye alındı" : "İlanın yayında"}
      </h1>
      <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-slate-500">
        {onayBekliyor
          ? "Ekibimiz ilanını en kısa sürede inceleyecek. Onaylandığında sana haber vereceğiz; o ana kadar ilanı düzenleyemezsin."
          : "Öğrenciler artık seni arama sonuçlarında bulabilir."}
      </p>

      <div className="mt-10 flex flex-col items-center gap-3">
        {onayBekliyor ? (
          <>
            <p className="max-w-xs text-[14px] leading-relaxed text-slate-500">
              İlanın onaylandığında bağlantısını paylaşabileceksin. Şu an
              yayında olmadığı için bağlantı henüz çalışmıyor.
            </p>
            <Link
              to={ROUTES.tutorListing}
              className="w-full max-w-xs rounded-xl bg-marka px-6 py-3.5 text-[15px] font-semibold text-marka-fg transition hover:bg-marka-hover"
            >
              İlan ayarlarına git
            </Link>
          </>
        ) : (
          <>
            <PlainButton
              onClick={() => setPaylasAcik(true)}
              className="w-full max-w-xs rounded-xl bg-marka px-6 py-3.5 text-[15px] font-semibold text-marka-fg transition hover:bg-marka-hover"
            >
              İlanını paylaş
            </PlainButton>
            <Link
              to={yol}
              className="w-full max-w-xs rounded-xl border border-slate-200 px-6 py-3.5 text-[15px] font-medium text-slate-700 transition hover:border-slate-300"
            >
              İlanını gör
            </Link>
            <Link
              to={ROUTES.tutorListing}
              className="mt-1 text-[14px] font-medium text-slate-500 underline underline-offset-4 transition hover:text-slate-800"
            >
              İlan ayarlarına git
            </Link>
          </>
        )}
      </div>

      {paylasAcik && (
        <ShareModal
          url={tamAdres}
          titleText={ad}
          heading="İlanını paylaş"
          onClose={() => setPaylasAcik(false)}
        />
      )}
    </div>
  );
}
