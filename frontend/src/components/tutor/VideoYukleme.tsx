import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  ACIKLAMA,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  KUCUK_ACIKLAMA,
  METIN_BAGLANTI,
} from "@/components/pano/stil";

/*
 * Profilim → Video: medya alanı (Preply düzeni, 28 Eyl 2026 karşılaştırması).
 *
 * Tek bir sütun genişliğinde medya yuvası: yayındaki video (yüklenen ya da
 * bağlantı) doğrudan oynatılır; kamerayla kayıt aynı yuvada oynatıcının yerini
 * alır. Altında durum kartları (yükleme, işleme, onay, hata), ardından ana
 * eylem ("Kamerayla kaydet" / "Tekrar kaydet") ve dosya/bağlantı satırları.
 *
 * Atomik değişim: yayındaki video, yeni video işlenip onaylanana kadar yayında
 * kalır; başarısız işleme eski videoya dokunmaz.
 */

const TON_SINIFI = {
  notr: "border-slate-200 bg-slate-50 text-slate-700",
  bilgi: "border-sky-200 bg-sky-50 text-sky-900",
  basari: "border-emerald-200 bg-emerald-50 text-emerald-900",
  uyari: "border-amber-200 bg-amber-50 text-amber-900",
  hata: "border-red-200 bg-red-50 text-red-900",
} as const;

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

export function VideoAlani({
  tutor,
  acik,
  ortaSlot,
  baglantiSlot,
}: {
  tutor: TutorOut;
  acik: boolean;
  /** Oynatıcı ile eylemler arasına (telefonda gereksinim kartı). */
  ortaSlot?: ReactNode;
  /** Boştayken dosya satırının altına (YouTube/Vimeo bağlantısı satırı + formu). */
  baglantiSlot?: ReactNode;
}) {
  const uid = useId();
  const dosyaRef = useRef<HTMLInputElement>(null);
  const durum = useMyIntroVideo();
  const kaldir = useRemoveIntroVideo(tutor.id);
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
  // Kamerayla kayıt modu: kayıt yuvası oynatıcının yerini alır.
  const [kayitModu, setKayitModu] = useState(false);
  const iptalKaydi = useCancelIntroVideo(tutor.id);
  // Kayıt görünümünden dönünce odak ana eyleme geri verilir (klavye/ekran okuyucu).
  const anaEylemRef = useRef<HTMLButtonElement>(null);
  const oncekiKayitModu = useRef(false);
  useEffect(() => {
    if (oncekiKayitModu.current && !kayitModu) anaEylemRef.current?.focus();
    oncekiKayitModu.current = kayitModu;
  }, [kayitModu]);

  const aktif = durum.data?.active ?? null;
  const link = durum.data?.link_url ?? tutor.intro_video_url ?? null;
  const pending = durum.data?.pending ?? null;
  const eskiVideoVar = Boolean(aktif || link);
  const yuklemeSuruyor = asama.tur === "hazirlaniyor" || asama.tur === "yukleniyor" || asama.tur === "tamamlaniyor";
  const yoldaKayit = pending && YOLDA_DURUMLAR.has(pending.status) ? pending : null;
  const secilebilir = acik && !yuklemeSuruyor && !yoldaKayit && durum.data?.uploads_enabled !== false;
  const bosta = !kayitModu && !yuklemeSuruyor && !pending && asama.tur !== "hata";

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
    <div className="space-y-6">
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

      {/* ── Medya yuvası ── */}
      {kayitModu && secilebilir ? (
        <KameraKaydi
          minSeconds={minSeconds}
          maxSeconds={Math.min(maxSeconds, 120)}
          onKullan={(file) => {
            setKayitModu(false);
            void yukle(file);
          }}
          onVazgec={() => setKayitModu(false)}
        />
      ) : eskiVideoVar ? (
        <div>
          <TanitimVideosu video={oynatici} linkUrl={aktif ? null : link} ad={tutor.first_name} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className={KUCUK_ACIKLAMA}>
              <span className="font-semibold text-emerald-700">Profilinde yayında</span>
              {" · "}
              {aktif
                ? [sureBiciminde(aktif.duration_seconds), aktif.width && aktif.height ? `${aktif.width}×${aktif.height}` : null]
                    .filter(Boolean)
                    .join(" · ") || "Yüklenen video"
                : "YouTube/Vimeo bağlantısı"}
            </p>
            {aktif && (
              <button
                type="button"
                className="text-sm font-semibold text-red-700 underline decoration-red-200 underline-offset-4 hover:decoration-red-700 disabled:opacity-60 inline-block py-3 -my-3 focus-visible:outline-none [&:focus-visible>span]:rounded-sm [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-marka-focus [&:focus-visible>span]:ring-offset-2"
                disabled={!acik || kaldir.isPending}
                onClick={() =>
                  kaldir.mutate(undefined, {
                    onSuccess: () => toast.success("Video profilinden kaldırıldı."),
                    onError: (e) => toast.error(getErrorMessage(e, "Kaldırılamadı.")),
                  })
                }
              >
                <span>{kaldir.isPending ? "Kaldırılıyor…" : "Videoyu kaldır"}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl bg-slate-100 p-6 text-center max-sm:aspect-auto max-sm:h-32">
          <span aria-hidden className="text-slate-400">
            <Icon name="video" className="h-10 w-10" />
          </span>
          <p className={KUCUK_ACIKLAMA}>Profilinde henüz tanıtım videon yok.</p>
        </div>
      )}

      {durum.data?.uploads_enabled === false && (
        <p className={`rounded-lg border p-4 ${TON_SINIFI.uyari}`}>
          Video yükleme geçici olarak kapalı. Şimdilik YouTube bağlantısı ekleyebilirsin.
        </p>
      )}

      {/* ── Tarayıcıdan depoya yükleme aşamaları ── */}
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
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={DUGME_SATIR_BIRINCIL} onClick={kayitAc} disabled={!acik}>
              Kamerayla kaydet
            </button>
            <button type="button" className={DUGME_SATIR_IKINCIL} onClick={dosyaSec} disabled={!acik}>
              Başka dosya seç
            </button>
          </div>
        </div>
      )}

      {/* ── Sunucudaki yolda / başarısız kayıt ── */}
      {!yuklemeSuruyor && asama.tur !== "hata" && pending && (
        <DurumKarti
          kayit={pending}
          requireReview={requireReview}
          eskiVideoVar={eskiVideoVar}
          onIptal={() => kaydiIptalEt(pending.id)}
          iptalEdiliyor={iptalKaydi.isPending}
          onYeniden={kayitAc}
          acik={acik}
        />
      )}

      {ortaSlot}

      {/* ── Eylemler (boştayken) ── */}
      {bosta && (
        <div className="space-y-4">
          <button
            ref={anaEylemRef}
            type="button"
            className={`w-full max-sm:h-11 sm:w-auto ${eskiVideoVar ? DUGME_SATIR_IKINCIL : DUGME_SATIR_BIRINCIL}`}
            onClick={kayitAc}
            disabled={!secilebilir}
          >
            <Icon name={eskiVideoVar ? "arrowRedo" : "video"} className="h-5 w-5" />
            {eskiVideoVar ? "Tekrar kaydet" : "Kamerayla kaydet"}
          </button>
          <div>
            <p className={ACIKLAMA}>
              Hazır bir video dosyan mı var?{" "}
              <button type="button" className={`${METIN_BAGLANTI} inline-block py-2.5 -my-2.5 focus-visible:outline-none [&:focus-visible>span]:rounded-sm [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-marka-focus [&:focus-visible>span]:ring-offset-2`} onClick={dosyaSec} disabled={!secilebilir}>
                <span>Dosya yükle</span>
              </button>
            </p>
            <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>
              MP4, MOV veya WebM · en fazla {mbBiciminde(maxBytes)}
              {requireReview ? " · Yayına girmeden önce kısa bir kontrolden geçer." : ""}
            </p>
          </div>
          {baglantiSlot}
          {!acik && (
            <p className="text-sm leading-5 text-amber-700">
              Profilin onay sürecinde; bu sırada video değiştirilemez.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
