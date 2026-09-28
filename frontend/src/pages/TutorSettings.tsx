import { FormEvent, ReactNode, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { UseMutationResult } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { ProfileCompleteness } from "@/components/ProfileCompleteness";
import { ProfilFotografi } from "@/components/ProfilFotografi";
import { EducationSection } from "@/components/EducationSection";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { MapPicker } from "@/components/MapPicker";
import { ADANA_DISTRICTS } from "@/lib/districts";
import {
  PROFILIM_BOLUMLERI,
  ROUTES,
  ilanYolu,
  profilimBolumu,
  type ProfilimBolumu,
} from "@/lib/routes";
import { ErrorState } from "@/components/admin/ui/PageState";
import {
  useMyTutorProfile,
  useTutorListingAction,
  useUpdateTutorProfile,
} from "@/hooks/useTutorProfile";
import { getErrorMessage } from "@/lib/errors";
import { videoEmbedUrl } from "@/lib/video";
import { parseMoney } from "@/lib/money";
import { DersSecici } from "@/components/tutor/DersSecici";
import { VideoAlani, type VideoMesgulDurumu } from "@/components/tutor/VideoYukleme";
import { useMyIntroVideo } from "@/hooks/useTutorIntroVideo";
import {
  VideoGereksinimleriKarti,
  VideoGereksinimleriKutusu,
} from "@/components/tutor/VideoGereksinimleri";
import { Modal } from "@/components/ui/Modal";
import { useLevelScales, useSubjects } from "@/hooks/useSubjects";
import type { Ders } from "@/api/subjects";
import { WEEKDAYS_LONG, hhmmToMin, minToHHMM } from "@/lib/availability";
import { toast } from "@/store/toastStore";
import {
  TeachingMode,
  TutorStatus,
  type Availability,
  type TutorOut,
  type TutorProfileUpdate,
} from "@/types";
import { BASLIK_EN_AZ_KELIME, kelimeSay } from "@/lib/metin";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_BIRINCIL,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  DUGME_SATIR_TEHLIKE,
  ETIKET,
  KART,
  KUCUK_ACIKLAMA,
  METIN_BAGLANTI,
  SAYFA_BASLIGI,
} from "@/components/pano/stil";

/*
 * PROFİLİM — Preply "My profile" düzeni (24 Eyl 2026, kullanıcı kararı).
 *
 * Preply'da profil tek uzun form değil: solda bölüm menüsü (Hakkında,
 * Fotoğraf, Açıklama, Video, Dersler, Ücretlendirme, Arka plan), ortada
 * seçili bölümün formu ve kendi "Kaydet"i, sağda profil kartı ("Profili ön
 * izle", "Profili paylaş"). Aynı düzen burada; Preply'da olmayan ama bizde
 * çalışan alanlar (müsaitlik, konum, ilk ders ücretsiz, öne çıkarma) kendi
 * bölümlerinde duruyor.
 *
 * Her bölüm kendi durumunu taşır ve YALNIZ kendi alanlarını gönderir
 * (`PATCH /tutors/me` `exclude_unset` ile kısmi günceller). Bölüm
 * değiştirilince kaydedilmemiş değişiklik düşer — Preply'da da her bölüm ayrı
 * sayfadır.
 */

/* ─── durum bilgisi ──────────────────────────────────── */

type StatusCfg = { label: string; dot: string; text: string; help: string };

const STATUS_CFG: Record<TutorStatus, StatusCfg> = {
  [TutorStatus.DRAFT]: {
    label: "Taslak",
    dot: "bg-slate-400",
    text: "text-slate-700",
    help: "Profilin henüz yayında değil. Bilgilerini doldurup onaya gönderebilirsin.",
  },
  [TutorStatus.PENDING_APPROVAL]: {
    label: "Onay bekliyor",
    dot: "bg-amber-400",
    text: "text-amber-700",
    help: "Profilin inceleniyor. İnceleme bitene kadar değişiklik yapamazsın.",
  },
  [TutorStatus.APPROVED]: {
    label: "Yayında",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    help: "Öğrenciler seni aramada görebiliyor.",
  },
  [TutorStatus.REJECTED]: {
    label: "Onaylanmadı",
    dot: "bg-red-500",
    text: "text-red-700",
    help: "Profilin onaylanmadı. Bilgilerini güncelleyip yeniden gönderebilirsin.",
  },
  [TutorStatus.SUSPENDED]: {
    label: "Pasif",
    dot: "bg-slate-500",
    text: "text-slate-700",
    help: "Profilin öğrencilerden gizli. İstediğinde yeniden yayına alabilirsin.",
  },
};

const BOLUM_ETIKETI: Record<ProfilimBolumu, string> = {
  hakkinda: "Hakkında",
  fotograf: "Fotoğraf",
  aciklama: "Açıklama",
  video: "Video",
  dersler: "Dersler",
  ucret: "Ücretlendirme",
  musaitlik: "Müsaitlik",
  egitim: "Eğitim",
};

const MODES = [
  { value: TeachingMode.ONLINE, label: "Uzaktan" },
  { value: TeachingMode.IN_PERSON, label: "Yüzyüze" },
  { value: TeachingMode.BOTH, label: "Her ikisi" },
] as const;

/* ─── ortak stiller ──────────────────────────────────── */

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-base leading-6 text-slate-900 placeholder-slate-400 outline-none transition duration-150 focus:border-marka-mid focus:ring-2 focus:ring-marka/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

const labelCls = `mb-2 block ${ETIKET}`;

/** Müsaitlik satırındaki küçük denetimler — satır düğmeleriyle aynı 40px. */
const satirGirdiCls =
  "h-10 rounded-lg border border-slate-200 bg-white px-3 text-base text-slate-900 outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 disabled:cursor-not-allowed disabled:opacity-50";

/* ─── sayfa ──────────────────────────────────────────── */

export default function TutorSettings() {
  const { data, isLoading, isError, error, refetch } = useMyTutorProfile();
  const [aramaParam, setAramaParam] = useSearchParams();
  const istenen = aramaParam.get("bolum") ?? "";
  const aktif: ProfilimBolumu = (PROFILIM_BOLUMLERI as readonly string[]).includes(istenen)
    ? (istenen as ProfilimBolumu)
    : "hakkinda";
  const bolumeGec = (bolum: ProfilimBolumu) => {
    const yeni = new URLSearchParams(aramaParam);
    yeni.set("bolum", bolum);
    setAramaParam(yeni);
  };
  // Video bölümünde kamera kaydı açıkken ya da yükleme sürerken bölüm
  // değiştirmek işi yarıda bırakır: önce sorulur. Ref: bildirim çizim tetiklemez.
  const videoMesgulRef = useRef<VideoMesgulDurumu | null>(null);
  const [bekleyenBolum, setBekleyenBolum] = useState<{
    bolum: ProfilimBolumu;
    yuklemeSuruyor: boolean;
  } | null>(null);
  const bolumAc = (bolum: ProfilimBolumu) => {
    const mesgul = videoMesgulRef.current;
    if (bolum !== aktif && mesgul) {
      setBekleyenBolum({ bolum, yuklemeSuruyor: mesgul.yuklemeSuruyor });
      return;
    }
    bolumeGec(bolum);
  };
  const bolumdenAyril = () => {
    if (!bekleyenBolum) return;
    if (bekleyenBolum.yuklemeSuruyor) videoMesgulRef.current?.iptal();
    videoMesgulRef.current = null;
    bolumeGec(bekleyenBolum.bolum);
    setBekleyenBolum(null);
  };

  return (
    <DashboardShell title="Profilim" genislik="orta">
      <div className="px-1 pb-16 pt-2 sm:px-2">
        <h1 className={`mb-6 ${SAYFA_BASLIGI}`}>Profilim</h1>

        {isLoading || !data ? (
          isError ? (
            <ErrorState
              description={getErrorMessage(error, "Profilin yüklenemedi.")}
              onRetry={() => void refetch()}
            />
          ) : (
            <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)_18rem]">
              <div className="h-72 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-96 animate-pulse rounded-lg bg-slate-100" />
              <div className="hidden h-48 animate-pulse rounded-lg bg-slate-100 lg:block" />
            </div>
          )
        ) : (
          <>
            <DurumSeridi tutor={data} />

            <div className="mt-8 grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)_18rem]">
              {/* ── Sol: bölüm menüsü (Ayarlar'daki rayla aynı) ── */}
              <nav
                aria-label="Profil bölümleri"
                className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:sticky lg:top-24 lg:h-fit lg:flex-col lg:gap-3 lg:overflow-visible lg:pb-0"
              >
                {PROFILIM_BOLUMLERI.map((b) => {
                  const secili = b === aktif;
                  return (
                    <button
                      key={b}
                      type="button"
                      aria-current={secili ? "page" : undefined}
                      onClick={() => bolumAc(b)}
                      className={`relative flex shrink-0 items-center whitespace-nowrap px-4 py-2 text-left text-base font-semibold leading-6 transition lg:w-full lg:py-0 ${
                        secili
                          ? "text-slate-900 after:absolute after:inset-x-4 after:bottom-0 after:h-1 after:bg-marka after:content-[''] lg:after:inset-x-auto lg:after:inset-y-0 lg:after:left-0 lg:after:h-auto lg:after:w-1"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {BOLUM_ETIKETI[b]}
                    </button>
                  );
                })}
              </nav>

              {/* ── Orta: seçili bölüm. `key` bölüm değişince formu sıfırlar. ── */}
              <section key={aktif} className="min-w-0">
                {aktif === "hakkinda" && <HakkindaBolumu tutor={data} />}
                {aktif === "fotograf" && <FotografBolumu tutor={data} />}
                {aktif === "aciklama" && <AciklamaBolumu tutor={data} />}
                {aktif === "video" && (
                  <VideoBolumu
                    tutor={data}
                    onMesgulDegis={(m) => {
                      videoMesgulRef.current = m;
                    }}
                  />
                )}
                {aktif === "dersler" && <DerslerBolumu tutor={data} />}
                {aktif === "ucret" && <UcretBolumu tutor={data} />}
                {aktif === "musaitlik" && <MusaitlikBolumu tutor={data} />}
                {aktif === "egitim" && (
                  <BolumKabugu
                    baslik="Eğitim ve belgeler"
                    aciklama={
                      <>
                        Okulun profilinde görünür. Yüklediğin diploma veya belge{" "}
                        <strong className="font-semibold text-slate-900">
                          profilinde gösterilmez
                        </strong>
                        ; yalnız doğrulama için kullanılır. Onaylanınca profilinde
                        "Diploması Doğrulandı" rozeti çıkar.
                      </>
                    }
                  >
                    <EducationSection editable bare withDocument />
                  </BolumKabugu>
                )}
              </section>

              {/* ── Sağ: profil kartı ve profile bağlı sayfalar ── */}
              <aside className="space-y-4 lg:sticky lg:top-24 lg:h-fit">
                {aktif === "video" && <VideoGereksinimleriKutusu className="hidden lg:block" />}
                <ProfilKarti tutor={data} />
                <ProfileCompleteness tutor={data} showLink={false} />

                {/* ÖNE ÇIKAR — `/ilanimi-one-cikar` sayfasının TEK girişi.
                    Silinirse rota ayakta kalır ama öğretmen oraya gidemez.
                    Nöbetçi: `panoSeridi.test.tsx`. */}
                {data.status === TutorStatus.APPROVED ? (
                  <Link
                    to={ROUTES.tutorPromotion}
                    className={`block transition hover:bg-slate-50 ${KART}`}
                  >
                    <span className={`block ${ETIKET}`}>Profilini öne çıkar</span>
                    <span className={`mt-1 block ${KUCUK_ACIKLAMA}`}>
                      Arama sonuçlarının üstünde "Reklam" etiketiyle görün.
                    </span>
                  </Link>
                ) : (
                  // Yayında olmayan profile paket satılamaz (backend 409).
                  <div className={KART}>
                    <span className={`block ${ETIKET}`}>Profilini öne çıkar</span>
                    <span className={`mt-1 block ${KUCUK_ACIKLAMA}`}>
                      Profilin yayına girince paket alabilirsin.
                    </span>
                  </div>
                )}

                {/* DEĞERLENDİRMELER — sayfanın TEK girişi (18 Eyl 2026). */}
                <Link
                  to={ROUTES.tutorReviews}
                  className={`block transition hover:bg-slate-50 ${KART}`}
                >
                  <span className={`block ${ETIKET}`}>Değerlendirmeler</span>
                  <span className={`mt-1 block ${KUCUK_ACIKLAMA}`}>
                    Öğrencilerinin yorumlarını gör.
                  </span>
                </Link>
              </aside>
            </div>
          </>
        )}
      </div>

      <Modal
        open={bekleyenBolum != null}
        onClose={() => setBekleyenBolum(null)}
        title="Bölümden ayrılınsın mı?"
        description={
          bekleyenBolum?.yuklemeSuruyor
            ? "Video yüklemesi sürüyor; ayrılırsan yükleme iptal edilir."
            : "Kamera kaydı açık; ayrılırsan kaydedilmemiş görüntü silinir."
        }
      >
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className={DUGME_SATIR_IKINCIL} onClick={() => setBekleyenBolum(null)}>
            Vazgeç
          </button>
          <button type="button" className={DUGME_SATIR_TEHLIKE} onClick={bolumdenAyril}>
            Ayrıl
          </button>
        </div>
      </Modal>
    </DashboardShell>
  );
}

/* ─── üst durum şeridi + yayın eylemleri ─────────────── */

function DurumSeridi({ tutor }: { tutor: TutorOut }) {
  const submitAction = useTutorListingAction("submit");
  const suspendAction = useTutorListingAction("suspend");
  const activateAction = useTutorListingAction("activate");
  const busy = submitAction.isPending || suspendAction.isPending || activateAction.isPending;
  const cfg = STATUS_CFG[tutor.status];

  const run = (mutation: UseMutationResult<TutorOut, Error, void>, okMsg: string) =>
    mutation.mutate(undefined, {
      onSuccess: () => toast.success(okMsg),
      onError: (err) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
    });

  const gonderilebilir =
    tutor.status === TutorStatus.DRAFT || tutor.status === TutorStatus.REJECTED;
  // Yayın kapısı sunucuda: başlık en az BASLIK_EN_AZ_KELIME sözcük olmalı
  // (`tutor_service.submit_for_approval`). Diploma 5 Eyl 2026'dan beri şart değil.
  const baslikKisa = kelimeSay(tutor.headline ?? "") < BASLIK_EN_AZ_KELIME;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot}`} />
          <span className={`text-base font-semibold leading-6 ${cfg.text}`}>{cfg.label}</span>
        </p>
        <p className={`mt-1 ${ACIKLAMA}`}>{cfg.help}</p>
        {gonderilebilir && baslikKisa && (
          <p className="mt-1 text-sm leading-5 text-amber-700">
            Onaya göndermeden önce{" "}
            <Link to={profilimBolumu("aciklama")} className="font-semibold underline underline-offset-2">
              Açıklama
            </Link>{" "}
            bölümünde en az {BASLIK_EN_AZ_KELIME} sözcüklük bir başlık yaz.
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {gonderilebilir && (
          <button
            onClick={() => run(submitAction, "Profilin onaya gönderildi.")}
            disabled={busy}
            className={DUGME_SATIR_BIRINCIL}
          >
            {tutor.status === TutorStatus.REJECTED ? "Yeniden gönder" : "Onaya gönder"}
          </button>
        )}
        {tutor.status === TutorStatus.APPROVED && (
          <button
            onClick={() => run(suspendAction, "Profilin pasife alındı.")}
            disabled={busy}
            className={DUGME_SATIR_IKINCIL}
          >
            Pasife al
          </button>
        )}
        {tutor.status === TutorStatus.SUSPENDED && (
          <button
            onClick={() => run(activateAction, "Profilin yeniden yayında.")}
            disabled={busy}
            className={DUGME_SATIR_BIRINCIL}
          >
            Yeniden yayına al
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── sağ profil kartı ───────────────────────────────── */

function ProfilKarti({ tutor }: { tutor: TutorOut }) {
  const { data: user } = useCurrentUser();
  const yayinda = tutor.status === TutorStatus.APPROVED;
  const yol = ilanYolu(tutor);
  const ad = user?.full_name ?? "";

  const baglantiyiKopyala = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${yol}`);
      toast.success("Profil bağlantın kopyalandı.");
    } catch {
      toast.error("Bağlantı kopyalanamadı.");
    }
  };

  return (
    <div className={KART}>
      <div className="flex items-center gap-4">
        {user?.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-500 ring-1 ring-slate-200">
            {ad.charAt(0).toLocaleUpperCase("tr")}
          </div>
        )}
        <p className={`min-w-0 truncate ${ETIKET}`}>{ad}</p>
      </div>
      {/* Herkese açık sayfa yalnız yayındaki profili gösterir
          (`search_service.get_tutor_public`); diğer durumlarda 404 olurdu. */}
      {yayinda ? (
        <div className="mt-4 flex flex-col gap-2">
          <a href={yol} target="_blank" rel="noreferrer" className={`w-full ${DUGME_SATIR_IKINCIL}`}>
            Profilini gör
          </a>
          <button type="button" onClick={baglantiyiKopyala} className={`h-10 w-full ${METIN_BAGLANTI}`}>
            Bağlantıyı kopyala
          </button>
        </div>
      ) : (
        <p className={`mt-4 ${KUCUK_ACIKLAMA}`}>
          Profilin yayına girince öğrencilerin gördüğü hâlini buradan açabilirsin.
        </p>
      )}
    </div>
  );
}

/* ─── bölüm kabuğu ve kaydetme ───────────────────────── */

function BolumKabugu({
  baslik,
  aciklama,
  children,
}: {
  baslik: string;
  aciklama?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className={BOLUM_BASLIGI}>{baslik}</h2>
      {aciklama && <p className={`mt-2 ${ACIKLAMA}`}>{aciklama}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** Onay sürecindeki profil düzenlenemez (sunucu 409 döner). */
const duzenlenebilir = (t: TutorOut) => t.status !== TutorStatus.PENDING_APPROVAL;

function useBolumKaydet() {
  const update = useUpdateTutorProfile();
  const kaydet = (payload: TutorProfileUpdate, basariMesaji = "Kaydedildi.") =>
    update.mutate(payload, {
      onSuccess: () => toast.success(basariMesaji),
      onError: (err) => toast.error(getErrorMessage(err, "Kaydedilemedi.")),
    });
  return { kaydet, kaydediliyor: update.isPending };
}

function KaydetDugmesi({ tutor, kaydediliyor }: { tutor: TutorOut; kaydediliyor: boolean }) {
  return (
    <div className="pt-2">
      {!duzenlenebilir(tutor) && (
        <p className="mb-3 text-sm leading-5 text-amber-700">
          Profilin onay sürecinde; bu sırada değişiklik kaydedilemez.
        </p>
      )}
      <button
        type="submit"
        disabled={!duzenlenebilir(tutor) || kaydediliyor}
        className={DUGME_BIRINCIL}
      >
        {kaydediliyor ? "Kaydediliyor…" : "Kaydet"}
      </button>
    </div>
  );
}

/* ─── Hakkında ───────────────────────────────────────── */

function HakkindaBolumu({ tutor }: { tutor: TutorOut }) {
  const uid = useId();
  const { data: user } = useCurrentUser();
  const { kaydet, kaydediliyor } = useBolumKaydet();
  const acik = duzenlenebilir(tutor);
  const [teachingMode, setTeachingMode] = useState<TeachingMode | "">(tutor.teaching_mode ?? "");
  const [district, setDistrict] = useState(tutor.district ?? "");
  const [locationText, setLocationText] = useState(tutor.location_text ?? "");
  const [lat, setLat] = useState<number | null>(tutor.location_lat ?? null);
  const [lng, setLng] = useState<number | null>(tutor.location_lng ?? null);

  const gonder = (e: FormEvent) => {
    e.preventDefault();
    kaydet({
      teaching_mode: teachingMode || null,
      district: district || null,
      location_text: locationText.trim() || null,
      location_lat: lat,
      location_lng: lng,
    });
  };

  return (
    <BolumKabugu
      baslik="Hakkında"
      aciklama="Öğrencilerin seni nerede ve nasıl ders alabileceklerini buradan görür."
    >
      <form onSubmit={gonder} className="space-y-6">
        <div>
          <span className={labelCls}>Adın soyadın</span>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-base leading-6 text-slate-700">
            {user?.full_name ?? ""}
          </p>
          <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>
            Adını, yaşını ve cinsiyetini{" "}
            <Link to={`${ROUTES.settings}?bolum=kisisel`} className={METIN_BAGLANTI}>
              Ayarlar
            </Link>{" "}
            sayfasından değiştirebilirsin.
          </p>
        </div>

        <div>
          <span className={labelCls}>Ders şekli</span>
          <div role="group" aria-label="Ders şekli" className="flex flex-wrap gap-2">
            {MODES.map((mode) => {
              const secili = teachingMode === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  disabled={!acik}
                  aria-pressed={secili}
                  onClick={() => setTeachingMode(secili ? "" : mode.value)}
                  className={secili ? DUGME_SATIR_BIRINCIL : DUGME_SATIR_IKINCIL}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}-ilce`} className={labelCls}>İlçe</label>
          <select
            id={`${uid}-ilce`}
            value={district}
            disabled={!acik}
            onChange={(e) => setDistrict(e.target.value)}
            className={`${inputCls} cursor-pointer`}
          >
            <option value="">İlçe seç (isteğe bağlı)</option>
            {/* Listede olmayan eski bir ilçe kayıtlıysa seçenek olarak kalır;
                yoksa select boş görünür ve Kaydet ilçeyi sessizce silerdi. */}
            {tutor.district && !(ADANA_DISTRICTS as readonly string[]).includes(tutor.district) && (
              <option value={tutor.district}>{tutor.district}</option>
            )}
            {ADANA_DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>Öğrenciler aramada ilçeye göre öğretmen filtreler.</p>
        </div>

        <div>
          <label htmlFor={`${uid}-konum`} className={labelCls}>Yüz yüze ders konumu</label>
          <input
            id={`${uid}-konum`}
            type="text"
            value={locationText}
            disabled={!acik}
            onChange={(e) => setLocationText(e.target.value)}
            placeholder="ör. Çukurova, Turgut Özal Bulvarı"
            className={`${inputCls} mb-3`}
          />
          <MapPicker
            initialLat={lat}
            initialLng={lng}
            readonly={!acik}
            onLocationSelect={(la, ln) => {
              setLat(la);
              setLng(ln);
            }}
          />
          <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>
            {lat != null
              ? "Konumun seçili; öğrenciler \"yakınımdaki\" aramasında seni bulabilir."
              : "Haritaya dokunup ders verdiğin bölgeyi işaretle (isteğe bağlı)."}
          </p>
        </div>

        <KaydetDugmesi tutor={tutor} kaydediliyor={kaydediliyor} />
      </form>
    </BolumKabugu>
  );
}

/* ─── Fotoğraf ───────────────────────────────────────── */

const FOTOGRAF_IPUCLARI = [
  "Yüzün kameraya baksın",
  "Başın ve omuzların kadrajda olsun",
  "Kadrajın ortasında, dik dur",
  "Yüzün ve gözlerin net görünsün",
  "Fotoğrafta yalnız sen ol",
  "Net, renkli ve filtresiz bir fotoğraf seç",
  "Logo, telefon ya da e-posta ekleme",
];

function FotografBolumu({ tutor }: { tutor: TutorOut }) {
  const { data: user } = useCurrentUser();
  return (
    <BolumKabugu
      baslik="Profil fotoğrafı"
      aciklama="Arama sonuçlarında ve profilinde öğrencilerin ilk gördüğü şey bu fotoğraf. Değiştirmek için üstüne gel."
    >
      <div className="flex items-center gap-5 rounded-lg border border-slate-200 p-5">
        <ProfilFotografi boyutClass="h-28 w-28" />
        <div className="min-w-0">
          <p className={`truncate ${ETIKET}`}>{user?.full_name ?? ""}</p>
          {(tutor.subjects?.length ?? 0) > 0 && (
            <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>{tutor.subjects!.join(", ")}</p>
          )}
        </div>
      </div>

      <h3 className={`mt-8 ${ETIKET}`}>İyi bir profil fotoğrafı için</h3>
      <ul className="mt-3 space-y-2">
        {FOTOGRAF_IPUCLARI.map((m) => (
          <li key={m} className={`flex gap-3 ${ACIKLAMA}`}>
            <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            {m}
          </li>
        ))}
      </ul>
    </BolumKabugu>
  );
}

/* ─── Açıklama ───────────────────────────────────────── */

function AciklamaBolumu({ tutor }: { tutor: TutorOut }) {
  const uid = useId();
  const { kaydet, kaydediliyor } = useBolumKaydet();
  const acik = duzenlenebilir(tutor);
  const [bio, setBio] = useState(tutor.bio ?? "");
  const [lessonInfo, setLessonInfo] = useState(tutor.lesson_info ?? "");
  const [headline, setHeadline] = useState(tutor.headline ?? "");
  const kelime = kelimeSay(headline);
  const kisa = kelime < BASLIK_EN_AZ_KELIME;

  const gonder = (e: FormEvent) => {
    e.preventDefault();
    if (kisa) {
      toast.error(`Başlığın en az ${BASLIK_EN_AZ_KELIME} sözcük olmalı (şu an ${kelime}).`);
      return;
    }
    kaydet({
      bio: bio.trim() || null,
      lesson_info: lessonInfo.trim() || null,
      headline: headline.trim() || null,
    });
  };

  return (
    <BolumKabugu
      baslik="Profil açıklaması"
      aciklama="Bu yazılar profilinde görünür. Telefon, e-posta gibi iletişim bilgileri otomatik gizlenir."
    >
      <form onSubmit={gonder} className="space-y-8">
        <div>
          <label htmlFor={`${uid}-bio`} className={ETIKET}>1. Kendini tanıt</label>
          <p className={`mb-3 mt-1 ${KUCUK_ACIKLAMA}`}>
            Kim olduğunu, ne kadar süredir ders verdiğini ve bu işi neden sevdiğini anlat.
          </p>
          <textarea
            id={`${uid}-bio`}
            rows={6}
            disabled={!acik}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className={inputCls}
            placeholder="Merhaba, ben … Adana'da 6 yıldır lise öğrencilerine matematik dersi veriyorum…"
          />
        </div>

        <div>
          <label htmlFor={`${uid}-ders`} className={ETIKET}>2. Derslerin nasıl geçiyor</label>
          <p className={`mb-3 mt-1 ${KUCUK_ACIKLAMA}`}>
            Hangi seviyelere ve sınavlara hazırladığını, ilk derste neler yaptığını ve
            hangi kaynakları kullandığını yaz.
          </p>
          <textarea
            id={`${uid}-ders`}
            rows={6}
            maxLength={2000}
            disabled={!acik}
            value={lessonInfo}
            onChange={(e) => setLessonInfo(e.target.value)}
            className={inputCls}
            placeholder="İlk derste seviyeni ölçüp sana özel bir çalışma planı çıkarıyoruz…"
          />
        </div>

        <div>
          <label htmlFor={`${uid}-baslik`} className={ETIKET}>3. Dikkat çeken bir başlık</label>
          <p className={`mb-3 mt-1 ${KUCUK_ACIKLAMA}`}>
            Arama sonuçlarında adının altında çıkan cümle. Branşını, sınav türünü ve
            deneyimini içersin.
          </p>
          <input
            id={`${uid}-baslik`}
            type="text"
            maxLength={255}
            disabled={!acik}
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            className={inputCls}
            placeholder="ör. 8 yıllık deneyimle TYT-AYT matematik, konu anlatımı ve soru çözümü"
          />
          <p className={`mt-2 ${kisa ? "text-sm leading-5 text-amber-700" : KUCUK_ACIKLAMA}`}>
            {kisa
              ? `En az ${BASLIK_EN_AZ_KELIME} sözcük gerekli, şu an ${kelime}.`
              : `${kelime} sözcük`}
          </p>
        </div>

        <KaydetDugmesi tutor={tutor} kaydediliyor={kaydediliyor} />
      </form>
    </BolumKabugu>
  );
}

/* ─── Video ──────────────────────────────────────────── */

function VideoBolumu({
  tutor,
  onMesgulDegis,
}: {
  tutor: TutorOut;
  onMesgulDegis: (m: VideoMesgulDurumu | null) => void;
}) {
  const uid = useId();
  const update = useUpdateTutorProfile();
  // `VideoAlani` ile aynı sorgu (önbellek paylaşılır; ek istek yok).
  const videoDurumu = useMyIntroVideo();
  const kaydediliyor = update.isPending;
  const acik = duzenlenebilir(tutor);
  const [url, setUrl] = useState(tutor.intro_video_url ?? "");
  // Hata alanın altında gösterilir (toast değil): kullanıcı neyi düzelteceğini
  // girdinin yanında görür, ekran okuyucu `role="alert"` ile duyurur.
  const [hata, setHata] = useState<string | null>(null);
  const girdiRef = useRef<HTMLInputElement>(null);
  // Preply düzeni: YouTube/Vimeo ayrı sekme değil, "Bağlantı yerleştir"
  // satırı. Yalnız bağlantı videosu olan öğretmende form açık gelir.
  const [baglantiAcik, setBaglantiAcik] = useState(Boolean(tutor.intro_video_url && !tutor.intro_video));
  // "Şu anki videon yayında kalır" yalnız yayında bir şey varken doğrudur.
  const yayindaVideoVar = Boolean(tutor.intro_video || tutor.intro_video_url);

  const hataGoster = (mesaj: string) => {
    setHata(mesaj);
    girdiRef.current?.focus();
  };

  // Yeni bağlantı yüklenen video gibi ekip onayından geçer; yayındaki video
  // (yüklenmiş ya da bağlantı) onaylanana kadar yerinde kalır. Onay diyaloğu
  // gereksiz: kaydetmek artık hiçbir şeyi hemen kaldırmaz (boşaltmak hariç).
  const gonder = (e: FormEvent) => {
    e.preventDefault();
    const yeni = url.trim();
    // Kabul edilen biçimler sunucudakiyle aynı (`lib/video.ts` başlığı):
    // bariz yanlış bağlantı sunucuya gitmeden alanın altında söylenir.
    if (yeni && videoEmbedUrl(yeni) === null) {
      hataGoster("Yalnızca YouTube veya Vimeo bağlantısı desteklenir.");
      return;
    }
    setHata(null);
    // Boş kayıt yalnız YAYINDAKİ bağlantıyı kaldırır (sunucu `submit_link`);
    // onay bekleyen bağlantıya dokunmaz. Kaldırılacak bir şey yokken
    // "kaldırıldı" demek, bekleyenin geri çekildiği yanılgısını doğurur.
    if (!yeni && !tutor.intro_video_url) {
      toast.info(
        videoDurumu.data?.pending?.kind === "LINK" && videoDurumu.data.pending.status === "PENDING_REVIEW"
          ? "Onay bekleyen bağlantın yerinde duruyor. Geri çekmek için “Onaydan geri çek”i kullan."
          : "Yayında kaldırılacak bir bağlantın yok."
      );
      return;
    }
    const basariMesaji = !yeni
      ? "Bağlantı kaldırıldı."
      : yeni === tutor.intro_video_url
        ? "Kaydedildi."
        : "Bağlantı onaya gönderildi. Onaylanınca profilinde yayına girer.";
    update.mutate(
      { intro_video_url: yeni || null },
      {
        onSuccess: () => toast.success(basariMesaji),
        onError: (err) => hataGoster(getErrorMessage(err, "Kaydedilemedi.")),
      }
    );
  };

  const baglantiSlot = (
    <div>
      <p className={ACIKLAMA}>
        YouTube ya da Vimeo&apos;da hazır bir videon mu var?{" "}
        <button
          type="button"
          className={`${METIN_BAGLANTI} inline-block py-2.5 -my-2.5 focus-visible:outline-none [&:focus-visible>span]:rounded-sm [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-marka-focus [&:focus-visible>span]:ring-offset-2`}
          aria-expanded={baglantiAcik}
          aria-controls={`${uid}-baglanti`}
          onClick={() => setBaglantiAcik((v) => !v)}
        >
          <span>Bağlantı yerleştir</span>
        </button>
      </p>
      {baglantiAcik && (
        <form id={`${uid}-baglanti`} onSubmit={gonder} noValidate className="mt-4 space-y-4">
          <div>
            <label htmlFor={`${uid}-video`} className={labelCls}>Video bağlantısı</label>
            <input
              ref={girdiRef}
              id={`${uid}-video`}
              type="url"
              disabled={!acik}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (hata) setHata(null);
              }}
              aria-invalid={hata ? true : undefined}
              aria-describedby={hata ? `${uid}-video-hata ${uid}-video-ipucu` : `${uid}-video-ipucu`}
              className={`${inputCls} ${hata ? "border-rose-500 focus:border-rose-500" : ""}`}
              placeholder="https://www.youtube.com/watch?v=…"
            />
            {hata && (
              <p id={`${uid}-video-hata`} role="alert" className="mt-2 text-sm leading-5 text-rose-600">
                {hata}
              </p>
            )}
            <p id={`${uid}-video-ipucu`} className={`mt-2 ${KUCUK_ACIKLAMA}`}>
              {yayindaVideoVar ? (
                <>
                  Yeni bağlantı kısa bir kontrolden sonra yayına girer; o zamana kadar şu anki videon yayında kalır.
                  {tutor.intro_video_url && " Boş bırakıp kaydedersen yayındaki bağlantı kaldırılır."}
                </>
              ) : (
                "Bağlantın kısa bir kontrolden sonra profilinde yayına girer."
              )}
            </p>
          </div>
          <KaydetDugmesi tutor={tutor} kaydediliyor={kaydediliyor} />
        </form>
      )}
    </div>
  );

  return (
    <BolumKabugu baslik="Tanıtım videosu">
      <div className="space-y-6">
        <div>
          <p className="text-lg font-semibold leading-7 text-slate-900">
            En fazla 2 dakikalık, yatay çekilmiş bir video ekle
          </p>
          <p className={`mt-2 ${ACIKLAMA}`}>
            Kendini ve dersini kısaca tanıt; video profilinin en üstünde oynatılır.
          </p>
        </div>

        <VideoAlani
          tutor={tutor}
          acik={acik}
          // Telefonda gereksinimler oynatıcının altında dokunulabilir kart;
          // masaüstünde sağ sütundaki kutu (bkz. sayfa `aside`).
          ortaSlot={<VideoGereksinimleriKarti className="lg:hidden" />}
          baglantiSlot={baglantiSlot}
          // Bağlantı formu açıkken tek birincil eylem formun "Kaydet"idir.
          anaEylemIkincil={baglantiAcik}
          onMesgulDegis={onMesgulDegis}
        />
      </div>

    </BolumKabugu>
  );
}

/* ─── Dersler ────────────────────────────────────────── */

function DerslerBolumu({ tutor }: { tutor: TutorOut }) {
  const { kaydet, kaydediliyor } = useBolumKaydet();
  // Öğretmen TAM kataloğu görür: branşını bildiremeyen öğretmen arzdan düşer.
  const { data: katalog } = useSubjects("secim");
  const { data: merdivenler } = useLevelScales();
  const [subjects, setSubjects] = useState<string[]>(tutor.subjects ?? []);
  // {subject_id: [level_id]} — ders başına verilen seviyeler.
  const [levels, setLevels] = useState<Record<number, number[]>>(() =>
    Object.fromEntries(
      Object.entries(tutor.subject_levels ?? {}).map(([k, v]) => [Number(k), v])
    )
  );

  const toggleSubject = (ders: Ders) => {
    setSubjects((prev) =>
      prev.includes(ders.name) ? prev.filter((s) => s !== ders.name) : [...prev, ders.name]
    );
    // Ders kaldırılınca seviyeleri de gider (sunucu da temizliyor).
    setLevels((prev) => {
      if (!prev[ders.id]) return prev;
      const { [ders.id]: _cikan, ...kalan } = prev;
      return kalan;
    });
  };

  const toggleLevel = (dersId: number, levelId: number) =>
    setLevels((prev) => {
      const mevcut = prev[dersId] ?? [];
      return {
        ...prev,
        [dersId]: mevcut.includes(levelId)
          ? mevcut.filter((l) => l !== levelId)
          : [...mevcut, levelId],
      };
    });

  const gonder = (e: FormEvent) => {
    e.preventDefault();
    // Seviyeler branşlara bağlı: ikisi hep birlikte gönderilir.
    kaydet({
      subjects,
      subject_levels: Object.entries(levels)
        .filter(([, lv]) => lv.length > 0)
        .map(([sid, lv]) => ({ subject_id: Number(sid), level_ids: lv })),
    });
  };

  return (
    <BolumKabugu
      baslik="Verdiğin dersler"
      aciklama="Seçtiğin dersler ve seviyeler, öğrencilerin aramada seni bulmasını sağlar."
    >
      <form onSubmit={gonder} className="space-y-6">
        <DersSecici
          katalog={katalog}
          merdivenler={merdivenler}
          secili={subjects}
          seviyeler={levels}
          duzenlenebilir={duzenlenebilir(tutor)}
          onToggle={toggleSubject}
          onSeviye={toggleLevel}
        />
        <KaydetDugmesi tutor={tutor} kaydediliyor={kaydediliyor} />
      </form>
    </BolumKabugu>
  );
}

/* ─── Ücretlendirme ──────────────────────────────────── */

const UCRET_EN_AZ = 250;
const UCRET_EN_COK = 5000;

function UcretBolumu({ tutor }: { tutor: TutorOut }) {
  const uid = useId();
  const { kaydet, kaydediliyor } = useBolumKaydet();
  const acik = duzenlenebilir(tutor);
  const mevcut = parseMoney(tutor.hourly_rate);
  const [rate, setRate] = useState(mevcut !== null ? String(mevcut) : "");
  const [ilkDersUcretsiz, setIlkDersUcretsiz] = useState(tutor.first_lesson_free ?? true);

  const gonder = (e: FormEvent) => {
    e.preventDefault();
    let ucret: number | null = null;
    if (rate.trim() !== "") {
      const n = Number(rate);
      // Aralık yayın kapısıyla aynı (`tutor_service.submit_for_approval`).
      if (!Number.isFinite(n) || n < UCRET_EN_AZ || n > UCRET_EN_COK) {
        toast.error(`Saatlik ücret ${UCRET_EN_AZ}–${UCRET_EN_COK} TL arasında olmalı.`);
        return;
      }
      ucret = n;
    }
    kaydet({ hourly_rate: ucret, first_lesson_free: ilkDersUcretsiz });
  };

  return (
    <BolumKabugu
      baslik="Ders ücretin"
      aciklama="Öğrenciler bir saatlik ders için bu ücreti öder. Ücretini istediğin zaman değiştirebilirsin."
    >
      <form onSubmit={gonder} className="space-y-6">
        <div>
          <label htmlFor={`${uid}-ucret`} className={labelCls}>Saatlik ücret</label>
          <div className="relative max-w-xs">
            <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-base font-semibold text-slate-500">
              TL
            </span>
            <input
              id={`${uid}-ucret`}
              type="number"
              min={UCRET_EN_AZ}
              max={UCRET_EN_COK}
              step={1}
              disabled={!acik}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className={`${inputCls} pl-12`}
              placeholder="0"
            />
          </div>
          <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>
            {UCRET_EN_AZ}–{UCRET_EN_COK} TL arasında bir ücret yaz.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4">
          <input
            type="checkbox"
            disabled={!acik}
            checked={ilkDersUcretsiz}
            onChange={(e) => setIlkDersUcretsiz(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-marka"
          />
          <span>
            <span className={`block ${ETIKET}`}>İlk ders ücretsiz</span>
            <span className={`mt-1 block ${KUCUK_ACIKLAMA}`}>
              Açıkken yeni öğrenciler seninle ilk derslerini ücretsiz alabilir ve
              profilinde "İlk ders ücretsiz" etiketi görünür.
            </span>
          </span>
        </label>

        <KaydetDugmesi tutor={tutor} kaydediliyor={kaydediliyor} />
      </form>
    </BolumKabugu>
  );
}

/* ─── Müsaitlik ──────────────────────────────────────── */

function MusaitlikBolumu({ tutor }: { tutor: TutorOut }) {
  const { kaydet, kaydediliyor } = useBolumKaydet();
  const acik = duzenlenebilir(tutor);
  const [pencereler, setPencereler] = useState<Availability[]>(tutor.availability ?? []);

  const ekle = () =>
    setPencereler((p) => [...p, { weekday: 0, start_minute: 1080, end_minute: 1200 }]);
  const guncelle = (i: number, patch: Partial<Availability>) =>
    setPencereler((p) => p.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
  const sil = (i: number) => setPencereler((p) => p.filter((_, idx) => idx !== i));

  const gonder = (e: FormEvent) => {
    e.preventDefault();
    if (pencereler.some((w) => w.end_minute <= w.start_minute)) {
      toast.error("Bitiş saati başlangıçtan sonra olmalı.");
      return;
    }
    kaydet({ availability: pencereler });
  };

  return (
    <BolumKabugu
      baslik="Haftalık müsaitlik"
      aciklama="Öğrenciler yalnız bu saatlerde ders isteyebilir; takviminde de bu saatler açık görünür."
    >
      <form onSubmit={gonder} className="space-y-6">
        <div className="space-y-3">
          {pencereler.length === 0 && (
            <p className={KUCUK_ACIKLAMA}>
              Saat eklemezsen öğrenciler herhangi bir saat için ders isteyebilir.
            </p>
          )}
          {pencereler.map((w, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Gün"
                disabled={!acik}
                value={w.weekday}
                onChange={(e) => guncelle(i, { weekday: Number(e.target.value) })}
                className={satirGirdiCls}
              >
                {WEEKDAYS_LONG.map((d, idx) => (
                  <option key={idx} value={idx}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                type="time"
                aria-label="Başlangıç"
                step={1800}
                disabled={!acik}
                value={minToHHMM(w.start_minute)}
                onChange={(e) => guncelle(i, { start_minute: hhmmToMin(e.target.value) })}
                className={satirGirdiCls}
              />
              <span className="text-slate-400">–</span>
              <input
                type="time"
                aria-label="Bitiş"
                step={1800}
                disabled={!acik}
                value={minToHHMM(w.end_minute)}
                onChange={(e) => guncelle(i, { end_minute: hhmmToMin(e.target.value) })}
                className={satirGirdiCls}
              />
              <button
                type="button"
                disabled={!acik}
                onClick={() => sil(i)}
                aria-label="Saati sil"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          {acik && (
            <button type="button" onClick={ekle} className={DUGME_SATIR_IKINCIL}>
              Saat ekle
            </button>
          )}
        </div>
        <KaydetDugmesi tutor={tutor} kaydediliyor={kaydediliyor} />
      </form>
    </BolumKabugu>
  );
}
