import { useId, useRef, useState } from "react";
import { Icon } from "@/components/AppIcon";
import { IlerlemeCubugu } from "@/components/IlerlemeCubugu";
import { KameraKaydi } from "@/components/tutor/KameraKaydi";
import { TanitimVideosu } from "@/components/egitmen/TanitimVideosu";
import {
  useCancelIntroVideo,
  useIntroVideoUpload,
  useMyIntroVideo,
  useRemoveIntroVideo,
} from "@/hooks/useTutorIntroVideo";
import { getErrorMessage } from "@/lib/errors";
import {
  YOLDA_DURUMLAR,
  durumAnlatimi,
  mbBiciminde,
  sureBiciminde,
} from "@/lib/tanitimVideo";
import { toast } from "@/store/toastStore";
import type { TutorIntroVideo, TutorOut } from "@/types";
import {
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  DUGME_SATIR_TEHLIKE,
  ETIKET,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";

/*
 * Profilim → Video: doğrudan yükleme yüzeyi.
 *
 * Atomik değişim: eğitmenin yayındaki videosu (yüklenmiş ya da bağlantı) yeni
 * video işlenip onaylanana kadar yayında kalır; bu bileşen o sırada "şu an
 * yayında" kartını ve yolda kaydın durumunu ayrı ayrı gösterir. Başarısız
 * işleme eski videoya dokunmaz; eğitmen anlaşılır hata + yeniden deneme görür.
 */

const TON_SINIFI = {
  notr: "border-slate-200 bg-slate-50 text-slate-700",
  bilgi: "border-sky-200 bg-sky-50 text-sky-900",
  basari: "border-emerald-200 bg-emerald-50 text-emerald-900",
  uyari: "border-amber-200 bg-amber-50 text-amber-900",
  hata: "border-red-200 bg-red-50 text-red-900",
} as const;

/** "Şu an profilinde" kartı — yüklenmiş aktif video ya da bağlantı. */
export function MevcutVideoKarti({ tutor, acik }: { tutor: TutorOut; acik: boolean }) {
  const { data } = useMyIntroVideo();
  const kaldir = useRemoveIntroVideo(tutor.id);
  const aktif = data?.active ?? null;
  const link = data?.link_url ?? tutor.intro_video_url ?? null;

  if (!aktif && !link) {
    return (
      <p className={KUCUK_ACIKLAMA}>Profilinde henüz tanıtım videosu yok.</p>
    );
  }
  // Yayındaki video burada da OYNATILIR (Preply'daki gibi): eğitmen profilinde
  // ne göründüğünü sayfadan ayrılmadan izler. Public profildeki bileşenin
  // aynısı — yüklenen video sessiz otomatik başlar, bağlantı iframe'le oynar.
  const oynatici = aktif?.mp4_url
    ? {
        kind: "upload" as const,
        mp4_url: aktif.mp4_url,
        poster_url: aktif.poster_url,
        width: aktif.width,
        height: aktif.height,
        duration_seconds: aktif.duration_seconds,
      }
    : null;
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className={ETIKET}>
            Şu an yayında
            <span className="ml-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              {aktif ? "Yüklenen video" : "Bağlantı"}
            </span>
          </p>
          <p className={`mt-1 truncate ${KUCUK_ACIKLAMA}`}>
            {aktif
              ? [sureBiciminde(aktif.duration_seconds), aktif.width && aktif.height ? `${aktif.width}×${aktif.height}` : null]
                  .filter(Boolean)
                  .join(" · ") || "İşlenmiş MP4"
              : link}
          </p>
        </div>
        {aktif && (
          <button
            type="button"
            className={DUGME_SATIR_TEHLIKE}
            disabled={!acik || kaldir.isPending}
            onClick={() =>
              kaldir.mutate(undefined, {
                onSuccess: () => toast.success("Video profilinden kaldırıldı."),
                onError: (e) => toast.error(getErrorMessage(e, "Kaldırılamadı.")),
              })
            }
          >
            {kaldir.isPending ? "Kaldırılıyor…" : "Kaldır"}
          </button>
        )}
      </div>
      <TanitimVideosu video={oynatici} linkUrl={aktif ? null : link} ad={tutor.first_name} />
    </div>
  );
}

function DurumKarti({
  kayit,
  requireReview,
  eskiVideoVar,
  onIptal,
  iptalEdiliyor,
  onYeniden,
  acik,
}: {
  kayit: TutorIntroVideo;
  requireReview: boolean;
  eskiVideoVar: boolean;
  onIptal: () => void;
  iptalEdiliyor: boolean;
  onYeniden: () => void;
  acik: boolean;
}) {
  const a = durumAnlatimi(kayit.status, { requireReview, eskiVideoVar });
  const yolda = YOLDA_DURUMLAR.has(kayit.status);
  const basarisiz = kayit.status === "FAILED" || kayit.status === "REJECTED";
  const iptalEtiketi = basarisiz
    ? "Kapat"
    : kayit.status === "PENDING_REVIEW"
      ? "Onaydan geri çek"
      : "Yüklemeyi iptal et";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-lg border p-4 ${TON_SINIFI[a.ton]}`}
    >
      <div className="flex flex-wrap items-start gap-3">

        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-6">{a.etiket}</p>
          <p className="mt-1 text-sm leading-5">
            {kayit.status === "FAILED" && kayit.error_message
              ? kayit.error_message
              : kayit.status === "REJECTED" && kayit.review_note
                ? `Gerekçe: ${kayit.review_note}`
                : a.aciklama}
          </p>
          {(kayit.status === "FAILED" && kayit.error_message) ||
          (kayit.status === "REJECTED" && kayit.review_note) ? (
            <p className="mt-1 text-sm leading-5 opacity-80">{a.aciklama}</p>
          ) : null}
        </div>
      </div>
      {kayit.status === "PENDING_REVIEW" && kayit.mp4_url ? (
        // Onay bekleyen yeni video: eğitmen işlenmiş halini izleyebilir (otomatik başlamaz).
        <div className="mt-3 aspect-video w-full overflow-hidden rounded-lg bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- eğitmenin kendi kaydı. */}
          <video
            className="h-full w-full"
            src={kayit.mp4_url}
            poster={kayit.poster_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            aria-label="Onay bekleyen yeni videon"
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {basarisiz && (
          <button type="button" className={DUGME_SATIR_BIRINCIL} onClick={onYeniden} disabled={!acik}>
            Başka video seç
          </button>
        )}
        {(yolda || basarisiz) && (
          <button
            type="button"
            className={DUGME_SATIR_IKINCIL}
            onClick={onIptal}
            disabled={iptalEdiliyor}
          >
            {iptalEdiliyor ? "İptal ediliyor…" : iptalEtiketi}
          </button>
        )}
      </div>
    </div>
  );
}

export function VideoYukleme({ tutor, acik }: { tutor: TutorOut; acik: boolean }) {
  const uid = useId();
  const dosyaRef = useRef<HTMLInputElement>(null);
  const durum = useMyIntroVideo();
  const maxBytes = durum.data?.max_bytes ?? 300 * 1024 * 1024;
  const maxSeconds = durum.data?.max_seconds ?? 130;
  const minSeconds = durum.data?.min_seconds ?? 30;
  const requireReview = durum.data?.require_review ?? true;
  const { asama, yukle, iptal, sifirla } = useIntroVideoUpload({
    maxBytes,
    maxSeconds,
    minSeconds,
    tutorId: tutor.id,
  });
  // Kamerayla kayıt modu; kayıt `File` olarak aynı yükleme hattına girer.
  const [kayitModu, setKayitModu] = useState(false);
  const iptalKaydi = useCancelIntroVideo(tutor.id);

  const pending = durum.data?.pending ?? null;
  const eskiVideoVar = Boolean(durum.data?.active || durum.data?.link_url);
  const yuklemeSuruyor = asama.tur === "hazirlaniyor" || asama.tur === "yukleniyor" || asama.tur === "tamamlaniyor";
  const yoldaKayit = pending && YOLDA_DURUMLAR.has(pending.status) ? pending : null;
  const secilebilir = acik && !yuklemeSuruyor && !yoldaKayit && durum.data?.uploads_enabled !== false;

  const dosyaSec = () => {
    sifirla();
    setKayitModu(false);
    dosyaRef.current?.click();
  };
  const kayitAc = () => {
    sifirla();
    setKayitModu(true);
  };
  const kaydiIptalEt = (id: number) =>
    iptalKaydi.mutate(id, {
      onError: (e) => toast.error(getErrorMessage(e, "İptal edilemedi.")),
    });

  return (
    <div className="space-y-4">
      <input
        ref={dosyaRef}
        id={`${uid}-dosya`}
        type="file"
        accept="video/*"
        className="sr-only"
        aria-label="Tanıtım videosu dosyası"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void yukle(f);
        }}
      />

      {durum.data?.uploads_enabled === false && (
        <p className={`rounded-lg border p-4 ${TON_SINIFI.uyari}`}>
          Video yükleme geçici olarak kapalı. Şimdilik YouTube bağlantısı ekleyebilirsin.
        </p>
      )}

      {/* Tarayıcıdan depoya yükleme aşamaları */}
      {asama.tur === "hazirlaniyor" && (
        <div role="status" aria-live="polite" className={`rounded-lg border p-4 ${TON_SINIFI.bilgi}`}>
          <p className="text-base font-semibold leading-6">Hazırlanıyor</p>
          <IlerlemeCubugu etiket="Video yükleme ilerlemesi" className="mt-3" />
        </div>
      )}
      {asama.tur === "yukleniyor" && (
        <div role="status" aria-live="polite" className={`rounded-lg border p-4 ${TON_SINIFI.bilgi}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-semibold leading-6">Yükleniyor</p>
            <span className="text-sm tabular-nums">%{Math.round(asama.oran * 100)}</span>
          </div>
          <IlerlemeCubugu oran={asama.oran} etiket="Video yükleme ilerlemesi" className="mt-3" />
          <p className="mt-2 text-sm leading-5">Sayfayı kapatma; yükleme bitince video otomatik işlenir.</p>
          <button type="button" className={`mt-3 ${DUGME_SATIR_IKINCIL}`} onClick={() => void iptal()}>
            İptal et
          </button>
        </div>
      )}
      {asama.tur === "tamamlaniyor" && (
        <div role="status" aria-live="polite" className={`rounded-lg border p-4 ${TON_SINIFI.bilgi}`}>
          <p className="text-base font-semibold leading-6">Doğrulanıyor</p>
          <IlerlemeCubugu oran={1} etiket="Video yükleme ilerlemesi" className="mt-3" />
        </div>
      )}
      {asama.tur === "hata" && (
        <div role="alert" className={`rounded-lg border p-4 ${TON_SINIFI.hata}`}>
          <p className="text-base font-semibold leading-6">Yüklenemedi</p>
          <p className="mt-1 text-sm leading-5">{asama.mesaj}</p>
          <button type="button" className={`mt-3 ${DUGME_SATIR_BIRINCIL}`} onClick={dosyaSec} disabled={!acik}>
            Başka video seç
          </button>
        </div>
      )}

      {/* Sunucudaki yolda / başarısız kayıt (yükleme bittikten sonra) */}
      {!yuklemeSuruyor && asama.tur !== "hata" && pending && (
        <DurumKarti
          kayit={pending}
          requireReview={requireReview}
          eskiVideoVar={eskiVideoVar}
          onIptal={() => kaydiIptalEt(pending.id)}
          iptalEdiliyor={iptalKaydi.isPending}
          onYeniden={dosyaSec}
          acik={acik}
        />
      )}

      {kayitModu && secilebilir && (
        <KameraKaydi
          minSeconds={minSeconds}
          maxSeconds={Math.min(maxSeconds, 120)}
          onKullan={(file) => {
            setKayitModu(false);
            void yukle(file);
          }}
          onVazgec={() => setKayitModu(false)}
        />
      )}

      {!kayitModu && !yuklemeSuruyor && !pending && asama.tur !== "hata" && (
        <div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={DUGME_SATIR_BIRINCIL}
              onClick={kayitAc}
              disabled={!secilebilir}
              aria-describedby={`${uid}-kural`}
            >
              <Icon name="video" className="h-5 w-5" aria-hidden />
              Kamerayla kaydet
            </button>
            <button
              type="button"
              className={DUGME_SATIR_IKINCIL}
              onClick={dosyaSec}
              disabled={!secilebilir}
              aria-describedby={`${uid}-kural`}
            >
              <Icon name="arrowUpload" className="h-5 w-5" aria-hidden />
              {eskiVideoVar ? "Yeni video dosyası seç" : "Video dosyası seç"}
            </button>
          </div>
          <p id={`${uid}-kural`} className={`mt-2 ${KUCUK_ACIKLAMA}`}>
            Yatay çekilmiş, {minSeconds} saniye ile {Math.floor(maxSeconds / 60)} dakika arası, en az 360p · MP4, MOV veya WebM · en fazla {mbBiciminde(maxBytes)}.
            {requireReview ? " Yüklenen video kısa bir kontrolden sonra yayına girer." : ""}
            {eskiVideoVar ? " Yeni video hazır olana kadar şu anki videon yayında kalır." : ""}
          </p>
          {!acik && (
            <p className="mt-2 text-sm leading-5 text-amber-700">
              Profilin onay sürecinde; bu sırada video yüklenemez.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
