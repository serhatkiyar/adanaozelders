import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import { ACIKLAMA, ETIKET, KUCUK_ACIKLAMA } from "@/components/pano/stil";
import { useBookings } from "@/hooks/useBookings";
import { useModalA11y } from "@/hooks/useModalA11y";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "@/lib/bookingStatus";
import { formatDate, formatIstanbulTime } from "@/lib/datetime";
import { formatTRY } from "@/lib/money";
import { ADSIZ_UYE } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { BookingStatus, type BookingOut, type TutorStudent } from "@/types";

/**
 * Öğrenci profili — sağdan açılan panel (Preply "Öğrenci profili" ekranı,
 * canlı hesapta ölçüldü 22 Eyl 2026: 480px, `translateX(100%)` → `0`, 300ms
 * `ease-in-out`, sayfa karartılmaz).
 *
 * Kullanıcı kararı (22 Eyl 2026): öğrencinin AYRI bir profil sayfası yok,
 * önizleme burada olur. Preply'daki "Öğrenim hedefleri" sekmesi BİZDE YOK —
 * öğrencinin hedef/seviye/müsaitlik verisi hiçbir yerde tutulmuyor.
 *
 * Portal zorunlu: `backdrop-blur` kullanan bir ata `position: fixed` ögeyi
 * kendi kutusuna hapsediyor (bu depoda yaşanmış hata, bkz. `MiniCartDrawer`).
 */
const PANEL_BASLIGI = "Öğrenci profili";
// Rol etiketi nöbetçisi `aria-label="Öğrenci…"` biçimini yasaklar; sabitten geçer.
const SEKME_GRUBU = "Öğrenci bölümleri";

type Sekme = "dersler" | "genel";

const TUR_ETIKETI: Record<string, string> = {
  TRIAL: "Deneme",
  WEEKLY: "Haftalık",
  SINGLE: "Tek ders",
};

export function OgrenciPaneli({
  ogrenci,
  onClose,
}: {
  /** Açık öğrenci; `null` ise panel çizilmez. */
  ogrenci: TutorStudent | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [sekme, setSekme] = useState<Sekme>("dersler");
  useModalA11y({ open: !!ogrenci, onClose, panelRef, lockScroll: false });

  const dersler = useBookings(
    { client_id: ogrenci?.client_id, limit: 100 },
    { enabled: !!ogrenci }
  );

  if (!ogrenci) return null;
  const ad = ogrenci.full_name || ADSIZ_UYE;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
      {/* Sayfa KARARTILMAZ (Preply): panel açıkken liste okunur kalır. */}
      <PlainButton aria-label="Paneli kapat" className="absolute inset-0" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={PANEL_BASLIGI}
        className="ogrenci-paneli relative flex h-full w-full max-w-[480px] flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-[0_8px_40px_rgba(18,17,23,0.18)]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className={ETIKET}>{PANEL_BASLIGI}</h2>
          <PlainButton
            onClick={onClose}
            aria-label="Kapat"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden>
              <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </PlainButton>
        </div>

        <div className="flex items-center gap-4 px-5 py-5">
          <Avatar name={ad} avatar_url={ogrenci.avatar_url} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-semibold leading-7 text-slate-900">{ad}</p>
            {ogrenci.kind && (
              <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>{TUR_ETIKETI[ogrenci.kind]}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Link
              to={ROUTES.messageWith(ogrenci.client_id, ad)}
              aria-label={`${ad} ile mesajlaş`}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <Icon name="messages" className="h-5 w-5" />
            </Link>
            <Link
              to={ROUTES.dersPlanla(ogrenci.client_id)}
              aria-label={`${ad} için ders planla`}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <Icon name="calendar" className="h-5 w-5" />
            </Link>
          </div>
        </div>

        <div className="flex gap-6 border-b border-slate-200 px-5" role="tablist" aria-label={SEKME_GRUBU}>
          {(
            [
              ["dersler", "Dersler"],
              ["genel", "Genel bakış"],
            ] as [Sekme, string][]
          ).map(([k, etiket]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={sekme === k}
              onClick={() => setSekme(k)}
              className={`-mb-px border-b-2 px-1 py-3 text-base font-semibold transition ${
                sekme === k
                  ? "border-marka text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              {etiket}
            </button>
          ))}
        </div>

        <div className="flex-1 px-5 py-5">
          {sekme === "dersler" ? (
            <DerslerSekmesi dersler={dersler.data} yukleniyor={dersler.isLoading} />
          ) : (
            <GenelSekmesi ogrenci={ogrenci} dersler={dersler.data} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function DerslerSekmesi({
  dersler,
  yukleniyor,
}: {
  dersler: BookingOut[] | undefined;
  yukleniyor: boolean;
}) {
  const simdi = Date.now();
  const { yaklasan, gecmis } = useMemo(() => {
    const hepsi = dersler ?? [];
    const y = hepsi
      .filter(
        (d) =>
          new Date(d.start_at).getTime() > simdi &&
          (d.status === BookingStatus.PENDING || d.status === BookingStatus.ACCEPTED)
      )
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
    const g = hepsi
      .filter((d) => !y.includes(d))
      .sort((a, b) => b.start_at.localeCompare(a.start_at));
    return { yaklasan: y, gecmis: g };
  }, [dersler, simdi]);

  if (yukleniyor) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (!dersler?.length) {
    return (
      <div className="py-16 text-center">
        <p className={ETIKET}>Henüz ders yok</p>
        <p className={`mt-2 ${ACIKLAMA}`}>
          Bu kişiyle planladığın dersler burada görünür.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {yaklasan.length > 0 && <Grup baslik="Yaklaşıyor" dersler={yaklasan} />}
      {gecmis.length > 0 && <Grup baslik="Geçmiş" dersler={gecmis} />}
    </div>
  );
}

function Grup({ baslik, dersler }: { baslik: string; dersler: BookingOut[] }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{baslik}</h3>
      <ul className="mt-3 space-y-2">
        {dersler.map((d) => (
          <li key={d.id}>
            <Link
              to={ROUTES.lesson(d.id)}
              className="flex items-center gap-4 rounded-xl border border-slate-200 p-3 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-50 text-slate-900">
                <span className="text-[10px] font-semibold uppercase leading-none text-slate-500">
                  {new Date(d.start_at).toLocaleDateString("tr-TR", { month: "short" })}
                </span>
                <span className="text-lg font-semibold leading-tight">
                  {new Date(d.start_at).getDate()}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-slate-900">
                  {new Date(d.start_at).toLocaleDateString("tr-TR", { weekday: "long" })}
                </span>
                <span className={`block ${KUCUK_ACIKLAMA}`}>
                  {formatIstanbulTime(d.start_at)}–{formatIstanbulTime(d.end_at)}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-md px-2 py-1 text-sm font-semibold ${BOOKING_STATUS_STYLE[d.status]}`}
              >
                {BOOKING_STATUS_LABEL[d.status]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GenelSekmesi({
  ogrenci,
  dersler,
}: {
  ogrenci: TutorStudent;
  dersler: BookingOut[] | undefined;
}) {
  // Ders ücreti: bu öğrencinin SON ödediği ücret (kullanıcı kararı, 22 Eyl
  // 2026) — ilan fiyatı değil; öğrenciye özel fiyat farkı görünür kalsın.
  const sonUcret = useMemo(() => {
    const odenen = (dersler ?? [])
      .filter(
        (d) =>
          !d.is_free_lesson &&
          d.price &&
          (d.status === BookingStatus.ACCEPTED || d.status === BookingStatus.COMPLETED)
      )
      .sort((a, b) => b.start_at.localeCompare(a.start_at))[0];
    return odenen?.price ? formatTRY(Number(odenen.price)) : null;
  }, [dersler]);

  const ay = ogrenci.first_lesson_at
    ? Math.max(
        0,
        Math.round(
          (Date.now() - new Date(ogrenci.first_lesson_at).getTime()) / (30 * 24 * 3600 * 1000)
        )
      )
    : 0;

  const satirlar: [string, string][] = [
    ["Türü", ogrenci.kind ? TUR_ETIKETI[ogrenci.kind] : "—"],
    ["Ders ücreti", sonUcret ?? "—"],
    ["Deneme dersi", ogrenci.trial_at ? formatDate(ogrenci.trial_at) : "—"],
    ["İlk ders", ogrenci.first_lesson_at ? formatDate(ogrenci.first_lesson_at) : "—"],
    ["Son ders", ogrenci.last_lesson_at ? formatDate(ogrenci.last_lesson_at) : "—"],
  ];

  return (
    <div className="space-y-6">
      <div className="flex gap-10">
        <div>
          <p className="text-3xl font-semibold leading-9 text-slate-900">
            {ogrenci.completed_lesson_count}
          </p>
          <p className={KUCUK_ACIKLAMA}>Ders</p>
        </div>
        <div>
          <p className="text-3xl font-semibold leading-9 text-slate-900">{ay}</p>
          <p className={KUCUK_ACIKLAMA}>Ay</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200">
        <h3 className={`border-b border-slate-200 px-4 py-3 ${ETIKET}`}>Bilgi</h3>
        <dl className="divide-y divide-slate-200">
          {satirlar.map(([etiket, deger]) => (
            <div key={etiket} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className={KUCUK_ACIKLAMA}>{etiket}</dt>
              <dd className="text-base font-medium text-slate-900">{deger}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
