import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { DashboardShell } from "@/components/DashboardShell";
import { ShareModal } from "@/components/ShareModal";
import { OgrenciPaneli } from "@/components/tutor/OgrenciPaneli";
import { ErrorState } from "@/components/admin/ui/PageState";
import { Icon } from "@/components/AppIcon";
import {
  ACIKLAMA,
  DUGME_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  ETIKET,
  KUCUK_ACIKLAMA,
  METIN_BAGLANTI,
} from "@/components/pano/stil";
import { PlainButton } from "@/components/ui/PlainButton";
import { useMyStudents } from "@/hooks/useDersTeklifi";
import { useMyTutorProfile } from "@/hooks/useTutorProfile";
import { formatDate } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { TUTOR_NAV } from "@/lib/nav";
import { ADSIZ_UYE } from "@/lib/roles";
import { ROUTES, ilanYolu } from "@/lib/routes";
import { SAYFA_BASLIGI } from "@/lib/tipografi";
import { TutorStatus, type TutorStudent } from "@/types";

/**
 * Eğitmenin öğrenci listesi (şerit sekmesi, 22 Eyl 2026).
 *
 * Yerleşim Preply'ın "Öğrencilerim" ekranından ölçüldü (canlı hesapta,
 * 22 Eyl 2026): tablo, 81px satır, 20/12px hücre dolgusu, tür rozeti, altı
 * çizili "Önerilen eylem" bağlantısı ve satır sonunda 40px'lik ikon düğmeleri.
 * Satır tıklanınca sağdan 480px'lik öğrenci paneli açılır (`OgrenciPaneli`).
 *
 * Preply'da olup BİZDE OLMAYANLAR bilerek yok: arşivle, ücret değiştir,
 * yeniden adlandır, sınıfa gir, ders analizi, abonelik/paket türleri — hiçbir
 * ucu yok, boş düğme konmaz.
 *
 * Başlık bir sabitten gelir: `title="Öğrenci…"` biçimi rol etiketi nöbetçisine
 * (`__guards__/rolEtiketi.test.ts`) takılır.
 */
const BASLIK = "Öğrencilerim";
const AZAMI = 100;

/** Tür rozeti — üç değerin de arkasında gerçek veri var (`booking_service`). */
const TUR: Record<string, { etiket: string; sinif: string }> = {
  TRIAL: { etiket: "Deneme", sinif: "bg-emerald-50 text-emerald-700" },
  WEEKLY: { etiket: "Haftalık", sinif: "bg-marka-soft text-marka-soft-fg" },
  SINGLE: { etiket: "Tek ders", sinif: "bg-slate-100 text-slate-700" },
};

/** Önerilen eylem — her biri gerçek bir uca gider. */
const EYLEM: Record<string, { etiket: string; hedef: (o: TutorStudent) => string | null }> = {
  RESPOND_REQUEST: {
    etiket: "Talebi yanıtla",
    hedef: (o) => (o.suggested_action?.booking_id ? ROUTES.lesson(o.suggested_action.booking_id) : null),
  },
  COMPLETE_LESSON: {
    etiket: "Dersi tamamla",
    hedef: (o) => (o.suggested_action?.booking_id ? ROUTES.lesson(o.suggested_action.booking_id) : null),
  },
  OFFER_PENDING: {
    etiket: "Teklif yanıt bekliyor",
    hedef: (o) => (o.suggested_action?.booking_id ? ROUTES.lesson(o.suggested_action.booking_id) : null),
  },
  PLAN_LESSON: { etiket: "Ders planla", hedef: (o) => ROUTES.dersPlanla(o.client_id) },
};

export default function TutorStudents() {
  const ogrenciler = useMyStudents(true);
  const [arama, setArama] = useState("");
  const [parametreler, setParametreler] = useSearchParams();
  const acikId = Number(parametreler.get("ogrenci")) || null;

  const liste = useMemo(() => ogrenciler.data ?? [], [ogrenciler.data]);
  const suzulen = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    if (!q) return liste;
    return liste.filter((o) => (o.full_name || ADSIZ_UYE).toLocaleLowerCase("tr").includes(q));
  }, [liste, arama]);

  const acik = liste.find((o) => o.client_id === acikId) ?? null;

  return (
    <DashboardShell title={BASLIK} navItems={TUTOR_NAV} genislik="orta">
      <div className="pb-12">
        <h1 className={SAYFA_BASLIGI}>Öğrencilerim</h1>

        <div className="mt-6">
          {ogrenciler.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : ogrenciler.isError ? (
            <ErrorState
              description={getErrorMessage(ogrenciler.error, "Liste yüklenemedi.")}
              onRetry={() => void ogrenciler.refetch()}
            />
          ) : liste.length === 0 ? (
            <BosListe />
          ) : (
            <>
              <label className="relative block max-w-sm">
                <span className="sr-only">Ada göre ara</span>
                <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                    <circle cx="11" cy="11" r="7" />
                    <path strokeLinecap="round" d="m20 20-3.5-3.5" />
                  </svg>
                </span>
                <input
                  type="search"
                  value={arama}
                  onChange={(e) => setArama(e.target.value)}
                  placeholder="Ada göre ara"
                  className="h-12 w-full rounded-full border border-slate-300 bg-white pl-12 pr-4 text-base text-slate-900 placeholder-slate-400 outline-none transition focus:border-slate-900"
                />
              </label>

              {suzulen.length === 0 ? (
                <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 py-16 text-center">
                  <p className={ETIKET}>“{arama.trim()}” ile eşleşen kimse yok</p>
                  <button type="button" onClick={() => setArama("")} className={`mt-5 ${DUGME_SATIR_IKINCIL}`}>
                    Aramayı temizle
                  </button>
                </div>
              ) : (
                <>
                  {/* Masaüstü: tablo (Preply kolon düzeni). */}
                  <div className="mt-6 hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block">
                    <table className="w-full border-collapse text-base">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/60 text-left">
                          <th scope="col" className="px-4 py-3 font-semibold text-slate-900">Ad</th>
                          <th scope="col" className="px-4 py-3 font-semibold text-slate-900">Türü</th>
                          <th scope="col" className="px-4 py-3 font-semibold text-slate-900">Ders</th>
                          <th scope="col" className="px-4 py-3 font-semibold text-slate-900">Sıradaki ders</th>
                          <th scope="col" className="px-4 py-3 font-semibold text-slate-900">Önerilen eylem</th>
                          <th scope="col" className="px-4 py-3">
                            <span className="sr-only">Eylemler</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {suzulen.map((o) => (
                          <Satir key={o.client_id} o={o} secili={o.client_id === acikId} />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Telefon: aynı bilgiler kart olarak. */}
                  <ul className="mt-6 space-y-3 sm:hidden">
                    {suzulen.map((o) => (
                      <Kart key={o.client_id} o={o} />
                    ))}
                  </ul>
                </>
              )}

              {liste.length >= AZAMI && (
                <p className={`mt-4 ${KUCUK_ACIKLAMA}`}>En son etkileşimli {AZAMI} kişi gösteriliyor.</p>
              )}
            </>
          )}
        </div>
      </div>

      <OgrenciPaneli ogrenci={acik} onClose={() => setParametreler({}, { replace: true })} />
    </DashboardShell>
  );
}

function ad(o: TutorStudent) {
  return o.full_name || ADSIZ_UYE;
}

function TurRozeti({ o }: { o: TutorStudent }) {
  const t = o.kind ? TUR[o.kind] : null;
  if (!t) return <span className="text-slate-400">—</span>;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-semibold ${t.sinif}`}>
      {t.etiket}
    </span>
  );
}

function OnerilenEylem({ o }: { o: TutorStudent }) {
  const e = o.suggested_action ? EYLEM[o.suggested_action.kind] : null;
  if (!e) return <span className="text-slate-400">—</span>;
  const hedef = e.hedef(o);
  // "Teklif yanıt bekliyor" bir eylem değil, durum bilgisidir.
  if (o.suggested_action?.kind === "OFFER_PENDING") {
    return <span className={KUCUK_ACIKLAMA}>{e.etiket}</span>;
  }
  if (!hedef) return <span className="text-slate-400">—</span>;
  return (
    <Link to={hedef} className={`relative z-10 ${METIN_BAGLANTI}`}>
      {e.etiket}
    </Link>
  );
}

/** Satır sonundaki 40px'lik ikon düğmeleri (Preply ölçüsü). */
function SatirEylemleri({ o }: { o: TutorStudent }) {
  const k = "relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-900";
  return (
    <div className="flex items-center justify-end gap-1">
      <Link to={ROUTES.messageWith(o.client_id, ad(o))} aria-label={`${ad(o)} ile mesajlaş`} className={k}>
        <Icon name="messages" className="h-5 w-5" />
      </Link>
      <Link to={ROUTES.dersPlanla(o.client_id)} aria-label={`${ad(o)} için ders planla`} className={k}>
        <Icon name="calendar" className="h-5 w-5" />
      </Link>
    </div>
  );
}

/**
 * Satırın tamamı paneli açar: ad bağlantısı `after:inset-0` ile satırı kaplar,
 * eylemler `relative z-10` ile üstte kalır. Satırı tek bir `<Link>`e sarmak
 * düğmeleri bağlantı içine koyardı (geçersiz HTML, klavyede bozuk);
 * `<tr onClick>` ise klavyeye kapalı olurdu.
 */
function Satir({ o, secili }: { o: TutorStudent; secili: boolean }) {
  return (
    <tr
      className={`relative border-b border-slate-200 transition last:border-b-0 ${
        secili ? "bg-marka-soft/40" : "hover:bg-slate-50"
      }`}
    >
      <td className="px-4 py-5">
        <div className="flex items-center gap-3">
          <Avatar name={ad(o)} avatar_url={o.avatar_url} size="md" />
          <Link
            to={`?ogrenci=${o.client_id}`}
            className={`truncate ${ETIKET} after:absolute after:inset-0 hover:text-marka-metin-hover`}
          >
            {ad(o)}
          </Link>
        </div>
      </td>
      <td className="px-4 py-5">
        <TurRozeti o={o} />
      </td>
      <td className="px-4 py-5 tabular-nums text-slate-700">
        {o.completed_lesson_count > 0 ? o.completed_lesson_count : <span className="text-slate-400">—</span>}
      </td>
      <td className="px-4 py-5 text-slate-700">
        {o.next_lesson_at ? formatDate(o.next_lesson_at) : <span className="text-slate-400">—</span>}
      </td>
      <td className="px-4 py-5">
        <OnerilenEylem o={o} />
      </td>
      <td className="px-4 py-5">
        <SatirEylemleri o={o} />
      </td>
    </tr>
  );
}

function Kart({ o }: { o: TutorStudent }) {
  return (
    <li className="relative rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <Avatar name={ad(o)} avatar_url={o.avatar_url} size="md" />
        <div className="min-w-0 flex-1">
          <Link
            to={`?ogrenci=${o.client_id}`}
            className={`block truncate ${ETIKET} after:absolute after:inset-0`}
          >
            {ad(o)}
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <TurRozeti o={o} />
            <span className={KUCUK_ACIKLAMA}>
              {o.completed_lesson_count} ders
              {o.next_lesson_at ? ` · Sıradaki: ${formatDate(o.next_lesson_at)}` : ""}
            </span>
          </div>
        </div>
        <SatirEylemleri o={o} />
      </div>
      <div className="mt-3">
        <OnerilenEylem o={o} />
      </div>
    </li>
  );
}

/**
 * Hiç öğrenci yokken: yayındaki ilan paylaşılır; yayında olmayan ilanın adresi
 * 404 verir, o yüzden onun yerine ilanı tamamlamaya çağrılır (`Tebrikler.tsx`
 * ile aynı koruma).
 */
function BosListe() {
  const profil = useMyTutorProfile();
  const [paylasAcik, setPaylasAcik] = useState(false);
  const t = profil.data;
  const yayinda = t?.status === TutorStatus.APPROVED;

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 py-20 text-center">
      {/* Fluent Emoji "Student" (3D) — kullanıcı kararı, 22 Eyl 2026. */}
      <img src="/icons/ogrenci.png" alt="" aria-hidden className="mb-4 h-36 w-36" />
      <p className={ETIKET}>Henüz öğrencin yok</p>
      <p className={`mt-2 max-w-md ${ACIKLAMA}`}>
        İlk dersin rezerve edildiğinde öğrencilerin burada listelenir.
      </p>
      {t &&
        (yayinda ? (
          <PlainButton type="button" onClick={() => setPaylasAcik(true)} className={`mt-6 ${DUGME_BIRINCIL}`}>
            Profilini paylaş
          </PlainButton>
        ) : (
          <Link to={ROUTES.tutorListing} className={`mt-6 ${DUGME_BIRINCIL}`}>
            Profilini tamamla
          </Link>
        ))}
      {paylasAcik && t && (
        <ShareModal
          url={`${window.location.origin}${ilanYolu(t)}`}
          titleText={t.full_name}
          heading="Profilini paylaş"
          onClose={() => setPaylasAcik(false)}
        />
      )}
    </div>
  );
}
