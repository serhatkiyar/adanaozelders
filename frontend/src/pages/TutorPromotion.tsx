import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { DashboardShell } from "@/components/DashboardShell";
import {
  buyPromotion,
  fetchMyPromotions,
  fetchPromotionPackages,
  type PromotionPackage,
  type TutorPromotion as Promotion,
} from "@/api/tutors";
import { useMyTutorProfile } from "@/hooks/useTutorProfile";
import { formatTRY, parseMoney } from "@/lib/money";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";

const TR_TARIH = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function tarih(iso: string | null): string {
  return iso ? TR_TARIH.format(new Date(iso)) : "-";
}

function kalanGun(bitis: string): number {
  const ms = new Date(bitis).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Yürürlükte mi: ödendi, iptal edilmedi, pencere içinde. */
function yururlukte(p: Promotion): boolean {
  if (p.payment_status !== "PAID" || p.cancelled_at) return false;
  if (!p.starts_at || !p.ends_at) return false;
  const now = Date.now();
  return (
    new Date(p.starts_at).getTime() <= now && new Date(p.ends_at).getTime() > now
  );
}

/** Ödendi ama henüz başlamadı (sırada bekliyor). */
function kuyrukta(p: Promotion): boolean {
  if (p.payment_status !== "PAID" || p.cancelled_at) return false;
  if (!p.starts_at || !p.ends_at) return false;
  return new Date(p.starts_at).getTime() > Date.now();
}

export default function TutorPromotion() {
  const qc = useQueryClient();
  const { data: profile } = useMyTutorProfile();
  const [seciliGun, setSeciliGun] = useState<number | null>(null);
  const [onay, setOnay] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const { data: paketler, isLoading: paketYukleniyor } = useQuery({
    queryKey: ["tutors", "promotion-packages"],
    queryFn: fetchPromotionPackages,
    staleTime: 10 * 60 * 1000,
  });

  const { data: kayitlar } = useQuery({
    queryKey: ["tutors", "me", "promotions"],
    queryFn: fetchMyPromotions,
  });

  const satinAl = useMutation({
    mutationFn: buyPromotion,
    onSuccess: (sonuc) => {
      if (sonuc.redirect_url) {
        // Hosted checkout: tahsilat sağlayıcı sayfasında tamamlanır.
        window.location.href = sonuc.redirect_url;
        return;
      }
      setOnay(false);
      setSeciliGun(null);
      qc.invalidateQueries({ queryKey: ["tutors", "me", "promotions"] });
    },
    onError: (e) => setHata(getErrorMessage(e, "Satın alma tamamlanamadı.")),
  });

  const aktif = (kayitlar ?? []).find(yururlukte);
  const bekleyen = (kayitlar ?? []).find(kuyrukta);
  const onayli = profile?.status === "APPROVED";

  return (
    <DashboardShell title="İlanımı öne çıkar" genislik="dar">
      <div className="px-1 pb-16 pt-2 sm:px-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          İlanını öne çıkar
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          İlanın, öğrencilerin arama sonuçlarının üstündeki blokta{" "}
          <span className="font-medium text-slate-900">Reklam</span> ibaresiyle
          gösterilir. Blokta aynı anda en fazla üç ilan bulunur ve aramanın
          filtreleri (ders, ilçe, eğitim şekli) burada da geçerlidir.{" "}
          <Link
            to={ROUTES.rankingCriteria}
            className="underline underline-offset-2 hover:text-slate-900"
          >
            Sıralama ölçütleri
          </Link>
        </p>

        {/* ── Durum ── */}
        {aktif && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <p className="text-sm font-semibold text-slate-900">
              İlanın şu anda öne çıkıyor
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {tarih(aktif.ends_at)} tarihine kadar · {kalanGun(aktif.ends_at!)}{" "}
              gün kaldı
            </p>
            {bekleyen && (
              <p className="mt-1 text-sm text-slate-500">
                Sırada {bekleyen.package_days} günlük bir paketin daha var;{" "}
                {tarih(bekleyen.starts_at)} tarihinde başlayacak.
              </p>
            )}
          </div>
        )}

        {!onayli && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <p className="text-sm text-slate-600">
              Öne çıkarma yalnız onaylanmış ilanlar için satın alınabilir.
              İlanın onaylandığında bu sayfadan paket alabilirsin.
            </p>
            <Link
              to={ROUTES.tutorListing}
              className="mt-3 inline-block text-sm font-semibold text-marka-metin underline-offset-2 hover:underline"
            >
              İlan ayarlarına git
            </Link>
          </div>
        )}

        {/* ── Paketler ── */}
        {onayli && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <h2 className="text-base font-semibold text-slate-900">
              {aktif ? "Süreni uzat" : "Paket seç"}
            </h2>
            {aktif && (
              <p className="mt-1 text-sm text-slate-500">
                Yeni paket mevcut sürenin bitiminde başlar; süreler üst üste
                binmez.
              </p>
            )}

            {paketYukleniyor ? (
              <div className="mt-5 space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : (
              <ul className="mt-5 divide-y divide-slate-200">
                {(paketler ?? []).map((paket) => (
                  <PaketSatiri
                    key={paket.days}
                    paket={paket}
                    secili={seciliGun === paket.days}
                    onSelect={() => {
                      setSeciliGun(paket.days);
                      setHata(null);
                    }}
                  />
                ))}
              </ul>
            )}

            <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={onay}
                onChange={(e) => setOnay(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-marka-metin focus:ring-marka-focus accent-marka"
              />
              <span>
                Hizmetin ödeme onaylandığı anda başladığını, bu nedenle cayma
                hakkı istisnası kapsamında olduğunu ve belirli sayıda
                görüntülenme ya da öğrenci garantisi verilmediğini kabul
                ediyorum.
              </span>
            </label>

            {hata && (
              <p className="mt-4 text-sm text-red-600" role="alert">
                {hata}
              </p>
            )}

            <button
              type="button"
              disabled={!seciliGun || !onay || satinAl.isPending}
              onClick={() => {
                setHata(null);
                if (seciliGun) {
                  satinAl.mutate({ days: seciliGun, terms_accepted: onay });
                }
              }}
              className="mt-6 rounded-xl bg-marka px-5 py-3 text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              {satinAl.isPending ? "Yönlendiriliyor…" : "Öne çıkar"}
            </button>
          </div>
        )}

        {/* ── Geçmiş ── */}
        {(kayitlar ?? []).length > 0 && (
          <div className="mt-12 border-t border-slate-200 pt-6">
            <h2 className="text-base font-semibold text-slate-900">
              Satın alma geçmişi
            </h2>
            <ul className="mt-4 divide-y divide-slate-200">
              {(kayitlar ?? []).map((kayit) => (
                <li
                  key={kayit.id}
                  className="flex items-baseline justify-between gap-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="text-slate-900">{kayit.package_days} gün</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {kayit.starts_at
                        ? `${tarih(kayit.starts_at)} – ${tarih(kayit.ends_at)}`
                        : tarih(kayit.created_at)}
                      {kayit.cancelled_at ? " · iptal edildi" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-slate-600">
                    {formatTRY(parseMoney(kayit.price) ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function PaketSatiri({
  paket,
  secili,
  onSelect,
}: {
  paket: PromotionPackage;
  secili: boolean;
  onSelect: () => void;
}) {
  const fiyat = parseMoney(paket.price) ?? 0;
  const gunluk = fiyat / paket.days;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={secili}
        className={`flex w-full items-center justify-between gap-4 py-4 text-left transition ${
          secili ? "text-slate-900" : "text-slate-600 hover:text-slate-900"
        }`}
      >
        <span className="flex items-center gap-3">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
              secili ? "border-marka bg-marka" : "border-slate-300"
            }`}
          >
            {secili && (
              <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
            )}
          </span>
          <span className="font-medium">{paket.label}</span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-xs text-slate-400">
            günlük {formatTRY(gunluk)}
          </span>
          <span className="font-semibold text-slate-900">
            {formatTRY(fiyat)}
          </span>
        </span>
      </button>
    </li>
  );
}
