// Kütüphane rezervasyon detayı — bilet koçanının yerine geçen ekran.
//
// ## Neden ayrı bir sayfa
//
// Kapıda söylenecek giriş kodu **URL'lenebilir** olmalı: bildirimden ya da
// telefondan tek tıkla açılsın. Genişleyen bir panelin adresi olmaz. Ayrıca
// ders tarafında `/ders-talepleri/:id` zaten var — simetri.
//
// ## Bilgi sırası
//
// Durum → başlık → nerede → ZAMAN (en belirgin) → giriş kodu → olgular →
// aksiyonlar → iptal politikası. NN/g'nin onay mesajı araştırmasında en çok
// istenen şey "tam olarak ne rezerve edildi"; Baymard da önce özet, sonra
// tamamlayıcılar diyor.
//
// ## Veri: yeni backend ucu YOK
//
// Tekil GET yok (`library_exams.py` yalnız `/mine` sunuyor). Liste küçük ve
// zaten çekiliyor; kayıt cache'ten bulunur. Derin linkte liste henüz gelmemiş
// olabilir, o yüzden yükleniyor/bulunamadı dalları açıkça yazılıdır.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { DashboardShell } from "@/components/DashboardShell";
import { Seo } from "@/components/Seo";
import { CheckInCodeCard } from "@/components/reservation/CheckInCodeCard";
import { ExamResultModal } from "@/components/reservation/ExamResultModal";
import { ReservationCancelDialog } from "@/components/reservation/ReservationCancelDialog";
import { ReservationFactList } from "@/components/reservation/ReservationFactList";
import { ReservationStatusBadge } from "@/components/reservation/ReservationStatusBadge";
import { ReservationTimeBlock } from "@/components/reservation/ReservationTimeBlock";
import { useCancelRegistration, useMyRegistrations } from "@/hooks/useLibraryExams";
import { useCancelStudy, useMyStudyReservations } from "@/hooks/useStudy";
import { UYE_NAV } from "@/lib/nav";
import { getErrorMessage } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { rezervasyonIcs, icsIndir } from "@/lib/reservationIcs";
import { toReservationItem } from "@/lib/reservationModel";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";

export default function LibraryReservationDetail() {
  const { tur, id } = useParams<{ tur: string; id: string }>();
  const kayitId = Number(id);
  const denemeMi = tur === "deneme";
  const navigate = useNavigate();

  const { data: kayitlar, isLoading: kayitYukleniyor } = useMyRegistrations();
  const { data: calismalar, isLoading: calismaYukleniyor } = useMyStudyReservations();
  const denemeIptal = useCancelRegistration();
  const calismaIptal = useCancelStudy();
  const [iptalAcik, setIptalAcik] = useState(false);
  const [sonucAcik, setSonucAcik] = useState(false);

  const yukleniyor = denemeMi ? kayitYukleniyor : calismaYukleniyor;
  const kayit = denemeMi
    ? (kayitlar ?? []).find((r) => r.id === kayitId)
    : (calismalar ?? []).find((r) => r.id === kayitId);

  if (yukleniyor) {
    return (
      <DashboardShell title="Rezervasyon" navItems={UYE_NAV}>
        <div className="mx-auto max-w-2xl">
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </DashboardShell>
    );
  }

  if (!kayit) {
    return (
      <DashboardShell title="Rezervasyon" navItems={UYE_NAV}>
        <div className="mx-auto max-w-2xl py-16 text-center">
          <p className="text-sm text-slate-600">Rezervasyon bulunamadı.</p>
          <Link to={ROUTES.reservations} className="mt-3 inline-block text-sm font-medium underline">
            Derslerime dön
          </Link>
        </div>
      </DashboardShell>
    );
  }

  const item = toReservationItem(kayit);
  const iptal = denemeMi ? denemeIptal : calismaIptal;
  // İptal yalnız yaşayan kayıtta anlamlı; sonuçlanmış kayıt geri alınamaz.
  const iptalEdilebilir = item.durum === "BEKLIYOR" || item.durum === "ONAYLANDI";
  const oturum = denemeMi ? (kayit as { session?: { library_slug?: string | null; library_id?: number; duration_minutes?: number } }).session : null;
  const kutuphaneYolu = denemeMi
    ? oturum?.library_slug ?? oturum?.library_id
    : (kayit as { library_slug?: string | null; library_id?: number }).library_slug ??
      (kayit as { library_id?: number }).library_id;

  const iptalEt = () => {
    iptal.mutate(item.id, {
      onSuccess: () => {
        setIptalAcik(false);
        toast.success(
          item.tamIade
            ? "Rezervasyon iptal edildi, ödemen iade edildi."
            : "Rezervasyon iptal edildi.",
        );
        navigate(ROUTES.reservations);
      },
      onError: (e) => {
        setIptalAcik(false);
        toast.error(getErrorMessage(e, "İptal başarısız."));
      },
    });
  };

  return (
    <DashboardShell title="Rezervasyon" navItems={UYE_NAV}>
      <Seo title="Rezervasyon, Adana Özel Ders" noindex />
      <div className="mx-auto max-w-2xl space-y-6">
        <nav className="flex items-center gap-1.5 text-sm text-slate-500">
          <Link to={ROUTES.reservations} className="hover:text-slate-800">
            Rezervasyonlar
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-slate-700">Detay</span>
        </nav>

        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div>
            <ReservationStatusBadge durum={item.durum} />
            <h1 className="mt-2 text-xl font-semibold text-slate-900">{item.baslik}</h1>
            {item.altBaslik && (
              <p className="mt-0.5 text-sm text-slate-500">
                {kutuphaneYolu ? (
                  <Link to={ROUTES.library(kutuphaneYolu)} className="hover:underline">
                    {item.altBaslik}
                  </Link>
                ) : (
                  item.altBaslik
                )}
              </p>
            )}
          </div>

          <ReservationTimeBlock baslangic={item.baslangic} bitis={item.bitis} />

          <CheckInCodeCard
            kod={item.girisKodu}
            girisYapildi={item.durum === "GIRIS_YAPILDI"}
            girisZamani={item.girisZamani}
          />

          <ReservationFactList
            facts={[
              // Çalışma alanında başlığın kendisi "Çalışma alanı" — olgu
              // listesinde tekrarlamak boş satır üretiyordu. Denemede başlık
              // sınavın adı olduğu için tür bilgi taşır.
              { etiket: "Tür", deger: denemeMi ? "Deneme sınavı" : null },
              {
                etiket: "Süre",
                deger:
                  denemeMi && oturum?.duration_minutes
                    ? `${oturum.duration_minutes} dakika`
                    : null,
              },
              { etiket: "Ücret", deger: item.tutar ? formatTRY(item.tutar) : null },
            ]}
          />

          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => icsIndir(rezervasyonIcs(item))}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Takvime ekle
            </button>
            {denemeMi && (kayit as { result_published?: boolean }).result_published && (
              <button
                type="button"
                onClick={() => setSonucAcik(true)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Sınav sonucunu görüntüle
              </button>
            )}
            {iptalEdilebilir && (
              <button
                type="button"
                onClick={() => setIptalAcik(true)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
              >
                İptal et
              </button>
            )}
          </div>

          {iptalEdilebilir && (
            // Politika aksiyonun TAM YANINDA yazar (Resy deseni); ince yazıya
            // gömmek bilinen bir booking UX hatasıdır.
            <p className="text-xs text-slate-400">
              {item.tamIade
                ? "Başlangıca 24 saatten fazla var: iptalde ücret tamamen iade edilir."
                : "Başlangıca 24 saatten az kaldı: iptal edebilirsin ama ücret iade edilmez."}
            </p>
          )}
        </div>
      </div>

      <ReservationCancelDialog
        open={iptalAcik}
        onClose={() => setIptalAcik(false)}
        onConfirm={iptalEt}
        isPending={iptal.isPending}
        tamIade={item.tamIade === true}
      />
      {sonucAcik && denemeMi && (
        <ExamResultModal
          reg={kayit as Parameters<typeof ExamResultModal>[0]["reg"]}
          onClose={() => setSonucAcik(false)}
        />
      )}
    </DashboardShell>
  );
}
