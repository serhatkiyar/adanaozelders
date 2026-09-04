import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { ImageCropModal } from "@/components/ImageCropModal";
import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";
import { PlainButton } from "@/components/ui/PlainButton";
import { submitTutorPreApplication } from "@/api/tutorPreApplications";
import { getErrorMessage } from "@/lib/errors";
import { normalizePhoneTR } from "@/lib/phone";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";

import { AnaDugme, OnayKutusu } from "./alanlar";
import { Anlati } from "./anlati";
import { Basvuruldu } from "./Basvuruldu";
import { BolumBelge } from "./BolumBelge";
import { BolumDers } from "./BolumDers";
import { BolumProfil } from "./BolumProfil";
import { BolumSen } from "./BolumSen";
import { dersleriAyristir, dogrulaAdim1, ucretiNormalle } from "./dogrula";
import { taslagiOku, taslagiSil, taslagiYaz } from "./taslak";
import { BOS_FORM, type FormDurumu } from "./tipler";

/**
 * Eğitmen ön başvurusu — hesapsız, tek ekranlı başvuru formu.
 *
 * Ürün kararı (4 Eyl 2026): bilgilerin tamamı TEK sayfada istenir. Önce
 * bölümlere ayrılmış bir sihirbaz denendi; kullanıcı ilk ekranda yalnız üç
 * alan görmenin eksik hissettirdiğini söyledi. Bunun bilinen bedeli daha
 * yüksek terk oranıdır; karşılığında gelen başvuru dolu gelir.
 *
 * Sürtünmeyi düşüren üç şey korundu:
 *   - Zorunlu alanlar (ad, telefon, dersler) EN ÜSTTE; acelesi olan aşağıyı
 *     atlayıp gönderebilir.
 *   - İsteğe bağlı bölümler açıkça "isteğe bağlı" etiketli.
 *   - Yazılanlar taslak olarak saklanır; dönen kişi baştan yazmaz.
 *
 * Ders alanı AÇIK UÇLUDUR: kapalı çip listesi yok, kişi ne veriyorsa yazar,
 * kategori eşleştirmesini panel yapar.
 */

/** Taslağın yazılma sıklığı. Her tuş vuruşunda yazmak ana iş parçacığını meşgul eder. */
const TASLAK_GECIKMESI = 800;

export default function TutorPreApply() {
  const [degerler, setDegerler] = useState<FormDurumu>(BOS_FORM);
  const [denendi, setDenendi] = useState(false);
  const [taslakVar, setTaslakVar] = useState(false);
  const [kirpilacak, setKirpilacak] = useState<string | null>(null);
  const [gonderildi, setGonderildi] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const guncelle = useCallback((yama: Partial<FormDurumu>) => {
    setDegerler((onceki) => ({ ...onceki, ...yama }));
  }, []);

  const hatalar = dogrulaAdim1(degerler);

  // ── Taslak ────────────────────────────────────────────────────────────
  // Dönüşte alanlar KENDİLİĞİNDEN dolmaz; kullanıcıya sorulur. Kimse yarım
  // bıraktığı bir formu haber verilmeden dolmuş bulmak istemez.
  useEffect(() => {
    const taslak = taslagiOku();
    if (taslak && Object.values(taslak.alanlar).some(Boolean)) setTaslakVar(true);
  }, []);

  useEffect(() => {
    if (gonderildi) return;
    const zamanlayici = window.setTimeout(() => taslagiYaz(degerler), TASLAK_GECIKMESI);
    return () => window.clearTimeout(zamanlayici);
  }, [gonderildi, degerler]);

  // Object URL'ler serbest bırakılmazsa uzun oturumda bellek sızdırır.
  useEffect(() => {
    return () => {
      if (degerler.fotoOnizleme) URL.revokeObjectURL(degerler.fotoOnizleme);
    };
  }, [degerler.fotoOnizleme]);

  const ilkHataylaOdaklan = () => {
    const sira: (keyof typeof hatalar)[] = ["ad", "telefon", "dersler", "kvkk"];
    const ilk = sira.find((alan) => hatalar[alan]);
    if (!ilk) return;
    const eleman = formRef.current?.querySelector<HTMLElement>(`[data-alan="${ilk}"]`);
    eleman?.focus();
    eleman?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  const gonder = useMutation({
    mutationFn: () =>
      submitTutorPreApplication({
        full_name: degerler.ad.trim(),
        phone: normalizePhoneTR(degerler.telefon) ?? degerler.telefon,
        subjects: dersleriAyristir(degerler.dersler),
        kvkk_accepted: degerler.kvkk,
        email: degerler.eposta.trim() || null,
        headline: degerler.baslik.trim() || null,
        bio: degerler.tanitim.trim() || null,
        experience: degerler.deneyim || null,
        teaching_mode: degerler.bicim || null,
        district: degerler.ilce || null,
        hourly_rate: degerler.ucret.trim() ? ucretiNormalle(degerler.ucret) : null,
        availability_note: degerler.musaitlik.trim() || null,
        intro_video_url: degerler.video.trim() || null,
        education_note: degerler.egitim.trim() || null,
        note: degerler.not.trim() || null,
        photo: degerler.foto,
        documents: degerler.belgeler,
      }),
    onSuccess: () => {
      taslagiSil();
      setTaslakVar(false);
      setGonderildi(true);
      // `?.()`: jsdom scrollIntoView tanımlamaz; kaydırma kozmetiktir.
      formRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, "Başvuru gönderilemedi. Tekrar dener misin?"));
    },
  });

  return (
    <PublicShell>
      <Seo
        title="Eğitmen Ön Başvurusu"
        description="Adana'da özel ders vermek isteyen eğitmenler için ön başvuru formu. Hesap açmadan, birkaç dakikada."
        canonicalPath={ROUTES.tutorPreApply}
      />

      <div className="mx-auto max-w-xl px-1 py-10 sm:py-14">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Eğitmen ön başvurusu
          </h1>
          <p className="mt-3 text-base leading-relaxed text-slate-600">
            Adana'da özel ders vermek isteyenler için. Yıldızlı alanlar zorunlu;
            gerisini doldurursan ilanını birlikte daha hızlı açarız. Hesap
            açılmaz.
          </p>
        </header>

        <div
          ref={formRef}
          className="mt-8 scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
        >
          {gonderildi ? (
            <Basvuruldu
              telefon={normalizePhoneTR(degerler.telefon) ?? degerler.telefon}
              belgeSayisi={degerler.belgeler.length}
            />
          ) : (
            <form
              className="space-y-0"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setDenendi(true);
                if (Object.keys(hatalar).length > 0) {
                  // Odaklama bir sonraki boyamada yapılır: hata metinleri
                  // henüz DOM'a basılmamış olabilir.
                  window.requestAnimationFrame(ilkHataylaOdaklan);
                  return;
                }
                gonder.mutate();
              }}
            >
              {taslakVar && (
                <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-slate-50 px-4 py-3">
                  <p className="flex-1 text-sm text-slate-600">
                    Yarım kalmış bir başvurun var.
                  </p>
                  <PlainButton
                    onClick={() => {
                      const taslak = taslagiOku();
                      if (taslak) guncelle(taslak.alanlar);
                      setTaslakVar(false);
                    }}
                    className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
                  >
                    Devam et
                  </PlainButton>
                  <PlainButton
                    onClick={() => {
                      taslagiSil();
                      setTaslakVar(false);
                    }}
                    className="text-sm text-slate-500 hover:text-slate-800"
                  >
                    Baştan başla
                  </PlainButton>
                </div>
              )}

              <Bolum baslik="Seni tanıyalım">
                <BolumSen
                  degerler={degerler}
                  guncelle={guncelle}
                  hatalar={denendi ? hatalar : {}}
                />
              </Bolum>

              <Bolum baslik="Profilin" istegeBagli>
                <BolumProfil
                  degerler={degerler}
                  guncelle={guncelle}
                  onFotoSec={(dosya) => setKirpilacak(URL.createObjectURL(dosya))}
                />
              </Bolum>

              <Bolum baslik="Dersin nasıl işliyor" istegeBagli>
                <BolumDers degerler={degerler} guncelle={guncelle} />
              </Bolum>

              <Bolum baslik="Eğitimin ve belgelerin" istegeBagli>
                <BolumBelge degerler={degerler} guncelle={guncelle} />
              </Bolum>

              <div className="mt-8 border-t border-slate-100 pt-6">
                <OnayKutusu
                  ad="kvkk"
                  isaretli={degerler.kvkk}
                  onChange={(v) => guncelle({ kvkk: v })}
                  hata={denendi ? hatalar.kvkk : undefined}
                >
                  <Link
                    to={ROUTES.kvkk}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-indigo-700 underline underline-offset-2"
                  >
                    KVKK aydınlatma metnini
                  </Link>{" "}
                  okudum; ad, telefon, yüklediğim fotoğraf ve belgelerin
                  başvurumun değerlendirilmesi için işlenmesini kabul ediyorum.
                </OnayKutusu>

                <div className="mt-5 space-y-2">
                  <AnaDugme tip="submit" bekliyor={gonder.isPending}>
                    {gonder.isPending ? "Gönderiliyor…" : "Başvuruyu gönder"}
                  </AnaDugme>
                  <p className="text-center text-xs text-slate-400">
                    Hesap açılmaz, şifre istenmez.
                  </p>
                </div>
              </div>
            </form>
          )}
        </div>

        {!gonderildi && <Anlati />}
      </div>

      {kirpilacak && (
        <ImageCropModal
          imageSrc={kirpilacak}
          title="Profil fotoğrafın"
          onCropComplete={(blob) => {
            if (degerler.fotoOnizleme) URL.revokeObjectURL(degerler.fotoOnizleme);
            guncelle({ foto: blob, fotoOnizleme: URL.createObjectURL(blob) });
            URL.revokeObjectURL(kirpilacak);
            setKirpilacak(null);
          }}
          onClose={() => {
            URL.revokeObjectURL(kirpilacak);
            setKirpilacak(null);
          }}
        />
      )}
    </PublicShell>
  );
}

/**
 * Bölüm başlığı + saç-teli ayraç.
 *
 * Uzun formu okunur kılan tek şey ritim: her bölüm kendi kutusuna alınsaydı
 * (kart enflasyonu) sayfa dört ayrı forma benzerdi. Bunun yerine tek yüzey,
 * içinde ince çizgilerle ayrılmış bölümler.
 */
function Bolum({
  baslik,
  istegeBagli,
  children,
}: {
  baslik: string;
  istegeBagli?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="border-slate-100 pt-8 first:pt-0 [&:not(:first-child)]:border-t">
      <div className="mb-5 flex items-baseline gap-2">
        <h2 className="text-base font-semibold text-slate-900">{baslik}</h2>
        {istegeBagli && (
          <span className="text-xs text-slate-400">isteğe bağlı</span>
        )}
      </div>
      {children}
    </section>
  );
}
