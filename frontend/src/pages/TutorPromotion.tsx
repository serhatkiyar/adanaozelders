import { useState } from "react";
import { Link } from "react-router-dom";

import { DashboardShell } from "@/components/DashboardShell";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_BIRINCIL,
  ETIKET,
  KUCUK_ACIKLAMA,
  SAYFA_BASLIGI,
} from "@/components/pano/stil";
import type { PromotionPackage, TutorPromotion as Promotion } from "@/api/tutors";
import {
  useBuyPromotion,
  useMyPromotions,
  usePromotionPackages,
} from "@/hooks/useTutorPromotion";
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
  const { data: profile } = useMyTutorProfile();
  const [seciliGun, setSeciliGun] = useState<number | null>(null);
  const [onay, setOnay] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const { data: paketler, isLoading: paketYukleniyor } = usePromotionPackages();
  const { data: kayitlar } = useMyPromotions();
  const satinAl = useBuyPromotion();

  const aktif = (kayitlar ?? []).find(yururlukte);
  const bekleyen = (kayitlar ?? []).find(kuyrukta);
  const onayli = profile?.status === "APPROVED";

  return (
    <DashboardShell title="İlanımı öne çıkar" genislik="dar">
      <div className="px-1 pb-16 pt-2 sm:px-2">
        <h1 className={SAYFA_BASLIGI}>İlanını öne çıkar</h1>
        <p className={`mt-3 ${ACIKLAMA}`}>
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
            <p className={ETIKET}>İlanın şu anda öne çıkıyor</p>
            <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>
              {tarih(aktif.ends_at)} tarihine kadar · {kalanGun(aktif.ends_at!)}{" "}
              gün kaldı
            </p>
            {bekleyen && (
              <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>
                Sırada {bekleyen.package_days} günlük bir paketin daha var;{" "}
                {tarih(bekleyen.starts_at)} tarihinde başlayacak.
              </p>
            )}
          </div>
        )}

        {!onayli && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <p className={ACIKLAMA}>
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
            <h2 className={BOLUM_BASLIGI}>
              {aktif ? "Süreni uzat" : "Paket seç"}
            </h2>
            {aktif && (
              <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>
                Yeni paket mevcut sürenin bitiminde başlar; süreler üst üste
                binmez.
              </p>
            )}

            {paketYukleniyor ? (
              <div className="mt-5 space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
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

            <label className={`mt-6 flex cursor-pointer items-start gap-3 ${ACIKLAMA}`}>
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
                  satinAl.mutate(
                    { days: seciliGun, terms_accepted: onay },
                    {
                      onSuccess: (sonuc) => {
                        if (sonuc.redirect_url) {
                          // Hosted checkout: tahsilat sağlayıcı sayfasında tamamlanır.
                          window.location.href = sonuc.redirect_url;
                          return;
                        }
                        setOnay(false);
                        setSeciliGun(null);
                      },
                      onError: (e) =>
                        setHata(getErrorMessage(e, "Satın alma tamamlanamadı.")),
                    }
                  );
                }
              }}
              className={`mt-6 ${DUGME_BIRINCIL}`}
            >
              {satinAl.isPending ? "Yönlendiriliyor…" : "Öne çıkar"}
            </button>
          </div>
        )}

        {/* ── Geçmiş ── */}
        {kayitlar && (
          <div className="mt-12 border-t border-slate-200 pt-6">
            <h2 className={BOLUM_BASLIGI}>Satın alma geçmişi</h2>
            {kayitlar.length === 0 ? (
              <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>Henüz öne çıkarma geçmişin yok.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {kayitlar.map((kayit) => (
                  <li
                    key={kayit.id}
                    className="flex items-baseline justify-between gap-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-slate-900">{kayit.package_days} gün</p>
                      <p className={`mt-0.5 ${KUCUK_ACIKLAMA}`}>
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
            )}
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
