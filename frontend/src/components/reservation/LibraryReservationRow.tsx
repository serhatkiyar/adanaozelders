// Kütüphane kaynaklı rezervasyon satırı (deneme sınavı · çalışma alanı).
//
// Ortak `ReservationRow` iskeletini kullanır; tek farkı ödenmemiş kayıtta satır
// altına düşen ödeme şerididir. İptal ve diğer aksiyonlar detaydadır
// (Resy · Zocdoc deseni) — ödeme istisnadır çünkü ödenmemiş kaydın tek işi
// tamamlanmaktır. Ders tarafı da (`BookingRow`) aynısını yapıyor.
import { PaymentBranchNotice } from "@/components/PaymentBranchNotice";
import { ReservationRow } from "./ReservationRow";
import { usePayRegistration, useCancelRegistration } from "@/hooks/useLibraryExams";
import { usePayStudy, useCancelStudy } from "@/hooks/useStudy";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { isBranchOpen } from "@/lib/paymentAvailability";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { ReservationItem } from "@/lib/reservationModel";
import { DUGME_SATIR_BIRINCIL, DUGME_SATIR_IKINCIL } from "@/components/pano/stil";

export type KutuphaneKaynagi = "deneme" | "calisma";

export function LibraryReservationRow({
  item,
  kaynak,
}: {
  item: ReservationItem;
  kaynak: KutuphaneKaynagi;
}) {
  return (
    <>
      <ReservationRow item={item} to={ROUTES.libraryReservation(kaynak, item.id)} />
      {item.durum === "BEKLIYOR" && <OdemeSeridi item={item} kaynak={kaynak} />}
    </>
  );
}

/**
 * Ödeme bekleyen kaydın satır altı şeridi.
 *
 * Ödeme kolu kapalıyken düğme pasifleşir ve gerekçe `PaymentBranchNotice` ile
 * yazılır; **İptal her hâlde açık kalır** — kullanıcı ödeyemediği bir kaydı
 * bırakabilmelidir (para kapısındaki tek nöbetçi bunu ölçüyor).
 */
function OdemeSeridi({ item, kaynak }: { item: ReservationItem; kaynak: KutuphaneKaynagi }) {
  const { data: availability } = usePaymentAvailability();
  const payOpen = isBranchOpen(availability, "library_marketplace");
  const denemeOde = usePayRegistration();
  const calismaOde = usePayStudy();
  const denemeIptal = useCancelRegistration();
  const calismaIptal = useCancelStudy();

  const ode = kaynak === "deneme" ? denemeOde : calismaOde;
  const iptal = kaynak === "deneme" ? denemeIptal : calismaIptal;

  const odemeyiBaslat = async () => {
    try {
      const sonuc = await ode.mutateAsync(item.id);
      if (sonuc.redirect_url) {
        window.location.href = sonuc.redirect_url;
        return;
      }
      toast.success("Ödeme alındı! Rezervasyonun hazır.");
    } catch (e) {
      toast.error(getErrorMessage(e, "Ödeme başarısız."));
    }
  };

  const iptalEt = () => {
    iptal.mutate(item.id, {
      onSuccess: () => toast.success("Rezervasyon iptal edildi."),
      onError: (e) => toast.error(getErrorMessage(e, "İptal başarısız.")),
    });
  };

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={odemeyiBaslat}
          disabled={!payOpen || ode.isPending}
          className={DUGME_SATIR_BIRINCIL}
        >
          {!payOpen ? "Ödeme kapalı" : ode.isPending ? "…" : "Ödemeyi tamamla"}
        </button>
        <button
          type="button"
          onClick={iptalEt}
          disabled={iptal.isPending}
          className={DUGME_SATIR_IKINCIL}
        >
          İptal
        </button>
      </div>
      {!payOpen && <PaymentBranchNotice branch="library_marketplace" className="mt-3" />}
    </div>
  );
}
