// Kütüphane rezervasyonları — `pages/Tickets.tsx`'in yerini alır.
//
// ## Neden bilet değil
//
// Eski ekran her kaydı perforasyonlu, koyu gradyanlı, QR koçanlı bir bilet
// koçanı olarak çiziyordu. Apple'ın pas taksonomisinde perfore kenar kupona
// ve sadakat kartına aittir; Google Wallet ise "reservations" ve "library
// membership" için açıkça `generic` tipi gösterir. Koltuk rezervasyonu
// devredilemez, ikincil pazarı yok, sahtecilik riski yok — bilet estetiği
// burada sahte bir çağrışım üretiyordu.
//
// Yerine geçen: homojen liste satırları. NN/g'nin ölçümü rezervasyon gibi
// karşılaştırmalı, taranan içerikte tutarlı satırı gösteriyor.
//
// ## Satırda tek aksiyon: ÖDEME
//
// İptal ve diğer aksiyonlar detaydadır (Resy · Zocdoc deseni). Ödeme istisnadır
// çünkü ödenmemiş kaydın tek işi tamamlanmaktır — `StudentBookings` da ders
// tarafında aynısını yapıyor (`Öde · ₺X` satırda).
import { useMemo, useState } from "react";

import { PaymentBranchNotice } from "@/components/PaymentBranchNotice";
import { ReservationRow } from "@/components/reservation/ReservationRow";
import { useMyRegistrations, usePayRegistration, useCancelRegistration } from "@/hooks/useLibraryExams";
import { useMyStudyReservations, usePayStudy, useCancelStudy } from "@/hooks/useStudy";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { isBranchOpen } from "@/lib/paymentAvailability";
import { getErrorMessage } from "@/lib/errors";
import { toReservationItem } from "@/lib/reservationModel";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { ReservationItem } from "@/lib/reservationModel";

/** Yaklaşan mı geçmiş mi — geçmiş varsayılan olarak gizlidir. */
const GECMIS_DURUMLAR = new Set(["IPTAL", "IADE_EDILDI", "SURESI_DOLDU", "TAMAMLANDI"]);

function gecmisMi(item: ReservationItem): boolean {
  return GECMIS_DURUMLAR.has(item.durum);
}

export function LibraryReservationsContent() {
  const { data: kayitlar, isLoading } = useMyRegistrations();
  const { data: calismalar, isLoading: calismaYukleniyor } = useMyStudyReservations();
  const [gecmisAcik, setGecmisAcik] = useState(false);

  const tumu = useMemo(() => {
    const liste: { item: ReservationItem; kaynak: "deneme" | "calisma" }[] = [
      ...(kayitlar ?? []).map((r) => ({ item: toReservationItem(r), kaynak: "deneme" as const })),
      ...(calismalar ?? []).map((r) => ({ item: toReservationItem(r), kaynak: "calisma" as const })),
    ];
    // En yakın randevu en üstte: ekranın sorusu "sırada ne var".
    return liste.sort((a, b) => {
      const at = a.item.baslangic ? new Date(a.item.baslangic).getTime() : 0;
      const bt = b.item.baslangic ? new Date(b.item.baslangic).getTime() : 0;
      return at - bt;
    });
  }, [kayitlar, calismalar]);

  const yaklasan = tumu.filter((x) => !gecmisMi(x.item));
  const gecmis = tumu.filter((x) => gecmisMi(x.item));

  if (isLoading || calismaYukleniyor) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    );
  }

  if (tumu.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-14 text-center">
        <p className="text-sm font-medium text-slate-700">Henüz kütüphane rezervasyonun yok</p>
        <p className="mt-1 text-sm text-slate-500">
          Bir kütüphane seçip çalışma alanı ya da deneme sınavı rezervasyonu yapabilirsin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {yaklasan.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {yaklasan.map(({ item, kaynak }) => (
            <li key={`${kaynak}-${item.id}`}>
              <ReservationRow item={item} to={ROUTES.libraryReservation(kaynak, item.id)} />
              {item.durum === "BEKLIYOR" && (
                <OdemeSeridi item={item} kaynak={kaynak} />
              )}
            </li>
          ))}
        </ul>
      )}

      {gecmis.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setGecmisAcik((v) => !v)}
            className="text-sm font-medium text-slate-500 transition hover:text-slate-800"
          >
            {gecmisAcik ? "Geçmişi gizle" : `Geçmiş (${gecmis.length})`}
          </button>
          {gecmisAcik && (
            <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {gecmis.map(({ item, kaynak }) => (
                <li key={`${kaynak}-${item.id}`}>
                  <ReservationRow item={item} to={ROUTES.libraryReservation(kaynak, item.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Ödeme bekleyen kaydın satır altı şeridi.
 *
 * Ödeme kolu kapalıyken düğme pasifleşir ve gerekçe `PaymentBranchNotice` ile
 * yazılır; **İptal her hâlde açık kalır** — kullanıcı ödeyemediği bir kaydı
 * bırakabilmelidir (para kapısındaki tek nöbetçi bunu ölçüyor).
 */
function OdemeSeridi({
  item,
  kaynak,
}: {
  item: ReservationItem;
  kaynak: "deneme" | "calisma";
}) {
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
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={odemeyiBaslat}
          disabled={!payOpen || ode.isPending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {!payOpen ? "Ödeme kapalı" : ode.isPending ? "…" : "Ödemeyi tamamla"}
        </button>
        <button
          type="button"
          onClick={iptalEt}
          disabled={iptal.isPending}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-white disabled:opacity-50"
        >
          İptal
        </button>
      </div>
      {!payOpen && <PaymentBranchNotice branch="library_marketplace" className="mt-3" />}
    </div>
  );
}
