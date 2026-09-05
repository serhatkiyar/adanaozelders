import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Seo } from "@/components/Seo";
import { PlainButton } from "@/components/ui/PlainButton";
import { FullScreenSpinner } from "@/components/Spinner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyEducations } from "@/hooks/useEducations";
import {
  useMyTutorProfile,
  useTutorListingAction,
  useUpdateTutorProfile,
} from "@/hooks/useTutorProfile";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { TutorStatus, type TutorOut } from "@/types";

import { AdimDersler } from "./adimlar/Dersler";
import { AdimFotograf } from "./adimlar/Fotograf";
import { AdimBaslik, AdimHakkinda, AdimYontem } from "./adimlar/Metinler";
import { AdimOzet } from "./adimlar/Ozet";
import { AdimTelefon } from "./adimlar/Telefon";
import { AdimUcret } from "./adimlar/Ucret";
import { AdimYer } from "./adimlar/Yer";
import type { AdimProps } from "./adimlar/ortak";
import {
  ADIMLAR,
  BOS_DURUM,
  SON_ADIM,
  adimiSinirla,
  type DisDurum,
  type Durum,
  type Hata,
} from "./sozlesme";
import {
  AdimGovde,
  AdimHaritasi,
  AdimHatasi,
  AksiyonCubugu,
  IlerlemeSeridi,
  Ipucu,
} from "./kabuk";
import { Tebrikler } from "./Tebrikler";

/**
 * İlan oluşturma sihirbazı — tek soru, tek ekran.
 *
 * NEDEN VAR: eğitmenin ilanını yayına sokması için dört ayrı ekranı (ilan
 * ayarları, profil, hesap ayarları, ödeme) kendi başına bulması gerekiyordu;
 * üstelik yayın kapısının aradığı diploma, "Onaya Gönder" düğmesinin olduğu
 * ekranda DEĞİLDİ. Bu akış aynı alanları tek bir sırada topluyor ve kapıyı
 * koşulun doldurulduğu adıma taşıyor.
 *
 * `/ilan-ayarlari` yerini ALMAZ: orası mevcut ilanın editörü olarak kalır.
 * Sihirbaz yalnız ilk yayına çıkış yolu.
 */

const ADIM_BILESENI: Record<string, (p: AdimProps) => JSX.Element> = {
  dersler: AdimDersler,
  baslik: AdimBaslik,
  yontem: AdimYontem,
  hakkinda: AdimHakkinda,
  yer: AdimYer,
  ucret: AdimUcret,
  fotograf: AdimFotograf,
  telefon: AdimTelefon,
  ozet: AdimOzet,
};

/** Sunucudan gelen ilanı sihirbazın çalışma durumuna çevirir. */
function sunucudanDurum(t: TutorOut): Durum {
  // Sunucu `{ "12": [3, 4] }` biçiminde döner — JSON anahtarı daima dize.
  const seviyeler: Record<number, number[]> = {};
  for (const [sid, ids] of Object.entries(t.subject_levels ?? {})) {
    seviyeler[Number(sid)] = ids;
  }
  return {
    subjects: t.subjects ?? [],
    subjectLevels: seviyeler,
    headline: t.headline ?? "",
    lessonInfo: t.lesson_info ?? "",
    bio: t.bio ?? "",
    teachingMode: t.teaching_mode ?? "",
    district: t.district ?? "",
    locationText: t.location_text ?? "",
    locationLat: t.location_lat ?? null,
    locationLng: t.location_lng ?? null,
    hourlyRate: t.hourly_rate ?? "",
    firstLessonFree: !!t.first_lesson_free,
    introVideoUrl: t.intro_video_url ?? "",
  };
}

export default function IlanSihirbazi() {
  const [arama, setArama] = useSearchParams();
  const navigate = useNavigate();
  const profil = useMyTutorProfile();
  const kullanici = useCurrentUser();
  const egitimler = useMyEducations();
  const kaydet = useUpdateTutorProfile();
  const yayinla = useTutorListingAction("submit");

  const [durum, setDurum] = useState<Durum>(BOS_DURUM);
  const [hata, setHata] = useState<Hata | null>(null);
  const [bitti, setBitti] = useState(false);
  // Adım haritasında yalnız ULAŞILMIŞ adımlar açılabilir: ileri atlamak,
  // aradaki adımların doğrulamasını sessizce atlatırdı.
  const [enUzak, setEnUzak] = useState(0);
  const govdeRef = useRef<HTMLDivElement>(null);
  const yuklendi = useRef(false);

  // Sunucudaki taslak BİR KEZ okunur. Her yenilemede yeniden yazılsaydı,
  // kullanıcının o adımda yazdığı ama henüz kaydedilmemiş metin silinirdi.
  useEffect(() => {
    if (yuklendi.current || !profil.data) return;
    yuklendi.current = true;
    setDurum(sunucudanDurum(profil.data));
  }, [profil.data]);

  const adimNo = adimiSinirla(Number(arama.get("adim") ?? 0));
  const adim = ADIMLAR[adimNo];

  // Sayfa yenilendiğinde ya da doğrudan `?adim=` ile gelindiğinde de o adım
  // ulaşılmış sayılır; aksi hâlde harita kullanıcının bulunduğu adımı bile
  // kilitli gösterirdi.
  useEffect(() => {
    setEnUzak((p) => Math.max(p, adimNo));
  }, [adimNo]);

  const gitAdim = useCallback(
    (n: number) => {
      setHata(null);
      setEnUzak((p) => Math.max(p, adimiSinirla(n)));
      setArama(
        (p) => {
          const y = new URLSearchParams(p);
          y.set("adim", String(adimiSinirla(n)));
          return y;
        },
        { replace: true },
      );
    },
    [setArama],
  );

  // Adım değişince başa dön: mobilde uzun bir adımdan sonra yeni soru ekranın
  // dışında kalıyordu.
  useEffect(() => {
    govdeRef.current?.scrollIntoView?.({ block: "start" });
  }, [adimNo]);

  const dis: DisDurum = useMemo(
    () => ({
      avatarUrl: kullanici.data?.avatar_url ?? null,
      belgeVar: (egitimler.data ?? []).some(
        (e) => !!e.document_url || !!e.verification_code,
      ),
      telefonDogrulandi: !!kullanici.data?.phone_verified,
    }),
    [kullanici.data, egitimler.data],
  );

  const guncelle = useCallback((yama: Partial<Durum>) => {
    setDurum((p) => ({ ...p, ...yama }));
    setHata(null);
  }, []);

  const alanaOdaklan = (alan?: string) => {
    if (!alan) return;
    const el = govdeRef.current?.querySelector<HTMLElement>(
      `[data-alan="${alan}"]`,
    );
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView?.({ block: "center" });
      el.focus?.();
    });
  };

  /** Adımın gövdesini sunucuya yazar; hata olursa adımda kalınır. */
  const adimiKaydet = async (): Promise<boolean> => {
    if (!adim.yama) return true;
    try {
      await kaydet.mutateAsync(adim.yama(durum));
      return true;
    } catch (e) {
      setHata({ mesaj: getErrorMessage(e, "Kaydedilemedi, tekrar dene.") });
      return false;
    }
  };

  const ileri = async () => {
    // Düğme DOĞRULAMAYLA KİLİTLENMEZ (bkz. __guards__/gonderDugmesi.test.ts):
    // kullanıcı basar, eksiği burada okur ve odak eksik alana gider.
    const bulunan = adim.dogrula?.(durum, dis) ?? null;
    if (bulunan) {
      setHata(bulunan);
      alanaOdaklan(bulunan.alan);
      return;
    }
    if (!(await adimiKaydet())) return;
    if (adimNo < SON_ADIM) gitAdim(adimNo + 1);
  };

  const atla = async () => {
    if (!(await adimiKaydet())) return;
    gitAdim(adimNo + 1);
  };

  /**
   * "Kaydet ve çık" gerçekten KAYDEDER.
   *
   * Etiketin sözü tutulmazsa kullanıcı o adımda yazdığı metni kaybeder ve
   * bunu ancak geri döndüğünde fark eder. Kayıt başarısız olursa (ör. başlık
   * sunucunun kelime eşiğinin altındaysa) çıkılmaz: hata gösterilir, metin
   * ekranda kalır.
   */
  const kaydetVeCik = async () => {
    if (!(await adimiKaydet())) return;
    navigate(ROUTES.tutorListing);
  };

  const gonder = async () => {
    if (!(await adimiKaydet())) return;
    try {
      await yayinla.mutateAsync();
      setBitti(true);
    } catch (e) {
      setHata({ mesaj: getErrorMessage(e, "İlan yayına gönderilemedi.") });
    }
  };

  if (profil.isLoading || kullanici.isLoading) {
    return <FullScreenSpinner />;
  }

  if (profil.isError || !profil.data) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-[15px] text-slate-600">
          İlan bilgilerin yüklenemedi. Sayfayı yenilemeyi dene.
        </p>
      </div>
    );
  }

  const zatenGonderildi =
    profil.data.status === TutorStatus.PENDING_APPROVAL ||
    profil.data.status === TutorStatus.APPROVED;

  if (bitti || zatenGonderildi) {
    return (
      <>
        <Seo title="İlanın hazır" noindex />
        <Tebrikler
          slug={profil.data.slug}
          ad={profil.data.headline || profil.data.full_name}
          onayBekliyor={profil.data.status !== TutorStatus.APPROVED}
        />
      </>
    );
  }

  const Bilesen = ADIM_BILESENI[adim.anahtar];
  const sonAdim = adimNo === SON_ADIM;
  const bekliyor = kaydet.isPending || yayinla.isPending;
  // Otomatik odak yalnız işaretçili ekranda: dokunmatikte klavye açılıp
  // sorunun kendisini örtüyor.
  const odakla =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: fine)").matches === true;

  return (
    <div className="min-h-screen bg-white">
      <Seo title="İlanını oluştur" noindex />
      <IlerlemeSeridi adimNo={adimNo} />

      <header className="mx-auto flex max-w-xl items-center justify-between gap-3 px-5 py-2">
        <AdimHaritasi adimNo={adimNo} enUzak={enUzak} git={gitAdim} />
        <PlainButton
          onClick={kaydetVeCik}
          disabled={bekliyor}
          className="flex min-h-[44px] shrink-0 items-center rounded-lg px-1 text-[13px] font-medium text-slate-500 underline underline-offset-4 transition hover:text-slate-800 disabled:opacity-60"
        >
          Kaydet ve çık
        </PlainButton>
      </header>

      <main
        ref={govdeRef}
        className="mx-auto max-w-xl px-5 pb-40 pt-6 sm:pb-16 sm:pt-10"
      >
        <AdimGovde baslik={adim.baslik} altBaslik={adim.altBaslik}>
          <Bilesen
            d={durum}
            guncelle={guncelle}
            dis={dis}
            odakla={odakla}
            gitAdim={gitAdim}
          />
        </AdimGovde>

        {hata && <AdimHatasi mesaj={hata.mesaj} />}

        {adim.ipucu && (
          <div className="mt-10">
            <Ipucu>{adim.ipucu}</Ipucu>
          </div>
        )}

        {/*
          TEK kopya. Çubuk mobilde ekranın altına sabitlenir, sm'den itibaren
          akışa döner (`fixed … sm:static`). İki ayrı kopya render etmek
          DOM'da iki "İleri" düğmesi bırakır ve ekran okuyucu ikisini de okur.
        */}
        <div className="mt-10">
          <AksiyonCubugu
            geri={adimNo > 0 ? () => gitAdim(adimNo - 1) : undefined}
            ileri={sonAdim ? gonder : ileri}
            ileriEtiket={
              sonAdim ? "Yayına gönder" : `Sırada: ${ADIMLAR[adimNo + 1].kisaAd}`
            }
            bekliyor={bekliyor}
            atla={adim.atlanabilir && !sonAdim ? atla : undefined}
          />
        </div>
      </main>
    </div>
  );
}
