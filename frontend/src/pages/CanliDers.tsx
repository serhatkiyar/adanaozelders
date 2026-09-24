import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { Icon } from "@/components/AppIcon";
import type {
  DersBilgisi,
  DersSohbetBilgisi,
  ZoomOdasiTutamak,
} from "@/components/canli/ZoomOdasi";
import { Modal } from "@/components/ui/Modal";
import { useBooking, useZoomToken } from "@/hooks/useBookings";
import {
  biletHataMetni,
  bostaKalmaSuresiDk,
  dersSaatAraligi,
  dersSayaci,
  firefoxMu,
  karsiTarafNotu,
  sayacMetni,
  tarayiciOrtami,
  telefonMu,
  type KarsiTarafDurumu,
} from "@/lib/canliDers";
import { ADSIZ_UYE } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { tamSayfaGit } from "@/lib/tamSayfaGezinme";
import type { BookingOut, ZoomDersTokenOut } from "@/types";

// Zoom Video SDK ve odanın i18next örneği YALNIZ bu parçada — ana paket büyümez.
const ZoomOdasi = lazy(() => import("@/components/canli/ZoomOdasi"));

const DUGME =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Canlı ders (Zoom Video SDK) — site kabuğunun DIŞINDA tam ekran sayfa.
 *
 * Giriş ve çıkış TAM SAYFA yüklemesiyle (`lib/tamSayfaGezinme.ts`): canlı
 * ders yolunun ayrı içerik politikası (CSP kolu) ve SDK'nın küresel durumu
 * sitenin geri kalanına sızmasın.
 *
 * Yerleşim: koyu oda yüzeyi (La Suite Meet görünümü; `ders-*` token'ları,
 * `dark:` yok) — sade üst şerit (karşı taraf adı, sayaç) + sahne + Meet
 * kontrol çubuğu (`ZoomOdasi` içinde). Katılımcılar ve ders içi sohbet
 * `ZoomOdasi`'nın yan panelindedir (masaüstünde sağda, telefonda tam ekran).
 * İleride tahta eklenirse video kutusu (`ZoomOdasi`'nın kabı) AYNI DOM
 * düğümünde kalmalı; yalnız yerleşimi değişir, yoksa görüşme yeniden bağlanır.
 */
export default function CanliDers() {
  const { id } = useParams();
  const dersId = Number(id);
  const gecerliId = Number.isInteger(dersId) && dersId > 0;

  const ders = useBooking(dersId);
  const bilet = useZoomToken(dersId);

  // Oda BİR KEZ kurulur ve bir daha sökülmez: sonraki bir sorgu hatası ya da
  // yeniden çekim (ör. WS'nin tetiklediği ders tazelemesi) görüşmeyi koparmaz.
  const [oda, setOda] = useState<{ bilet: ZoomDersTokenOut; bostaKalmaDk: number } | null>(
    null,
  );
  const dersHazir = ders.data !== undefined || ders.isError;
  useEffect(() => {
    if (oda || !bilet.data || !dersHazir) return;
    setOda({
      bilet: bilet.data,
      bostaKalmaDk: ders.data ? bostaKalmaSuresiDk(ders.data.end_at) : 40,
    });
  }, [oda, bilet.data, dersHazir, ders.data]);

  if (!gecerliId) {
    return (
      <GirisHatasi
        mesaj="Ders bulunamadı."
        donusAdresi={ROUTES.bookings}
        donusMetni="Genel bakışa dön"
      />
    );
  }

  if (oda) {
    return (
      <DersOdasi
        dersId={dersId}
        oda={oda}
        ders={ders.data}
        biletTazele={async () => {
          const sonuc = await bilet.refetch();
          if (sonuc.isError) throw sonuc.error;
          return sonuc.data;
        }}
      />
    );
  }

  if (bilet.isError) {
    const yanit = (bilet.error as { response?: { status?: number; data?: { detail?: unknown } } })
      ?.response;
    return (
      <GirisHatasi
        mesaj={biletHataMetni(yanit?.status, yanit?.data?.detail)}
        donusAdresi={ROUTES.lesson(dersId)}
        donusMetni="Ders sayfasına dön"
        yenidenDene
      />
    );
  }

  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-slate-50 px-4 font-sans"
      role="status"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-marka" />
      <p className="text-base text-slate-600">Canlı derse bağlanılıyor…</p>
    </div>
  );
}

function GirisHatasi({
  mesaj,
  donusAdresi,
  donusMetni,
  yenidenDene = false,
}: {
  mesaj: string;
  donusAdresi: string;
  donusMetni: string;
  yenidenDene?: boolean;
}) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 font-sans">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Canlı derse girilemedi</h1>
        <p className="mt-2 text-base text-slate-600">{mesaj}</p>
        <div className="mt-6 flex flex-col gap-2">
          {yenidenDene && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={`${DUGME} h-12 bg-marka px-6 text-lg text-marka-fg hover:bg-marka-hover`}
            >
              Yeniden dene
            </button>
          )}
          <button
            type="button"
            onClick={() => tamSayfaGit(donusAdresi)}
            className={`${DUGME} h-12 border-2 border-slate-200 bg-white px-6 text-lg text-slate-900 hover:border-slate-900`}
          >
            {donusMetni}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Son 5 dk sayacı için dakika başı yeterli değil (4:59 → "5 dk"); 15 sn. */
function useSimdi(aralikMs = 15_000) {
  const [simdi, setSimdi] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setSimdi(Date.now()), aralikMs);
    return () => window.clearInterval(t);
  }, [aralikMs]);
  return simdi;
}

function DersOdasi({
  dersId,
  oda,
  ders,
  biletTazele,
}: {
  dersId: number;
  oda: { bilet: ZoomDersTokenOut; bostaKalmaDk: number };
  ders: BookingOut | undefined;
  biletTazele: () => Promise<ZoomDersTokenOut | undefined>;
}) {
  const odaRef = useRef<ZoomOdasiTutamak>(null);
  // Cihaz bir kez okunur: düzen genişliğe değil cihaza bağlı (plan §8).
  const ortam = useMemo(() => tarayiciOrtami(), []);
  const telefon = telefonMu(ortam);
  const [firefoxSeridi, setFirefoxSeridi] = useState(() => firefoxMu(ortam.ua));
  const [karsiTaraf, setKarsiTaraf] = useState<KarsiTarafDurumu | null>(null);
  const [kapandi, setKapandi] = useState(false);
  const [cikisAcik, setCikisAcik] = useState(false);
  const [ayriliyor, setAyriliyor] = useState(false);
  const simdi = useSimdi();

  const rol = oda.bilet.rol;
  const karsiAd =
    rol === "host" ? ders?.client_name || ADSIZ_UYE : ders?.tutor_name || "Öğretmen";
  const mesajAdresi = ders
    ? rol === "host"
      ? ROUTES.messageWith(ders.client_id, karsiAd, "CLIENT")
      : ROUTES.messageWith(ders.tutor_id, karsiAd, "TUTOR")
    : null;
  const sayac = ders ? sayacMetni(dersSayaci(ders.end_at, simdi)) : null;
  const not = karsiTaraf && !kapandi ? karsiTarafNotu(karsiTaraf, rol) : null;
  const dersBilgisi = useMemo<DersBilgisi | undefined>(
    () =>
      ders
        ? { baslik: `Canlı ders · ${karsiAd}`, saat: dersSaatAraligi(ders.start_at, ders.end_at) }
        : undefined,
    [ders, karsiAd],
  );
  // Ders içi sohbetin karşı tarafı: `mesajAdresi` ile AYNI kişi ve tür.
  const sohbet = useMemo<DersSohbetBilgisi | undefined>(
    () =>
      ders
        ? rol === "host"
          ? {
              karsiTarafId: ders.client_id,
              karsiTarafRol: "CLIENT",
              karsiTarafAd: karsiAd,
              benimRolum: "TUTOR",
            }
          : {
              karsiTarafId: ders.tutor_id,
              karsiTarafRol: "TUTOR",
              karsiTarafAd: karsiAd,
              benimRolum: "CLIENT",
            }
        : undefined,
    [ders, rol, karsiAd],
  );
  const dersSayfasi = ROUTES.lesson(dersId);

  const ayril = async () => {
    setAyriliyor(true);
    try {
      await odaRef.current?.ayril();
    } finally {
      tamSayfaGit(dersSayfasi);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-ders-zemin font-sans text-white">
      {/* Tarayıcı uyarısı — Meet bildirim görünümü: koyu yüzeyde yuvarlak
          kutu, oda token'larıyla (açık sarı şerit koyu odada sırıtıyordu). */}
      {firefoxSeridi && (
        <div className="flex shrink-0 justify-center px-4 pt-2">
          <div
            role="status"
            className="flex w-full max-w-xl items-center gap-3 rounded-ders bg-ders-yuzey py-2 pl-4 pr-2 text-sm text-white shadow-lg"
          >
            <Icon name="help" className="h-5 w-5 shrink-0 text-white/70" />
            <p className="min-w-0 flex-1">En iyi deneyim için Chrome önerilir.</p>
            <button
              type="button"
              onClick={() => setFirefoxSeridi(false)}
              aria-label="Uyarıyı kapat"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-ders-dugme"
            >
              <Icon name="dismiss" className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <header
        className={`flex shrink-0 items-center gap-3 bg-ders-zemin px-4 ${
          telefon ? "h-12" : "h-14"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className={`truncate font-semibold ${telefon ? "text-sm" : "text-base"}`}>
            {telefon ? karsiAd : `Canlı ders · ${karsiAd}`}
          </p>
        </div>
        {sayac && (
          <span
            role="status"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ders-dugme px-3 py-1 text-sm font-semibold text-white"
          >
            <Icon name="clock" className="h-4 w-4" />
            {sayac}
          </span>
        )}
        {/* Tam Mesajlar sayfası yeni sekmede (görüşme bu sekmede sürer);
            ders içi sohbet odanın yan panelinde. */}
        {mesajAdresi && (
          <a
            href={mesajAdresi}
            target="_blank"
            rel="noopener"
            aria-label={telefon ? "Mesajlar (yeni sekmede)" : undefined}
            className={`${DUGME} h-10 shrink-0 bg-ders-dugme text-white hover:bg-ders-hover ${
              telefon ? "w-10" : "px-4 text-base"
            }`}
          >
            <Icon name="messages" className="h-5 w-5" />
            {!telefon && "Mesajlar"}
          </a>
        )}
        {/* Telefonda çıkış alt çubuktaki "Çık"tadır. */}
        {!telefon && (
          <button
            type="button"
            onClick={() => setCikisAcik(true)}
            className={`${DUGME} h-10 shrink-0 bg-ders-tehlike px-4 text-base text-white hover:bg-ders-tehlike-hover`}
          >
            <Icon name="logout" className="h-5 w-5" />
            Dersten ayrıl
          </button>
        )}
      </header>

      <main className="relative flex min-h-0 flex-1">
        {/* `isolate`: odanın iç z-index'leri bu kutuda kalsın; sayfanın
            pencereleri (portal, z-100) her zaman üstte. */}
        <section className="relative isolate min-w-0 flex-1 bg-ders-zemin" aria-label="Görüntülü ders">
          <Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center" role="status">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-ders-cizgi border-t-marka" />
                <span className="sr-only">Görüntülü ders yükleniyor…</span>
              </div>
            }
          >
            <ZoomOdasi
              ref={odaRef}
              bilet={oda.bilet}
              telefon={telefon}
              bostaKalmaDk={oda.bostaKalmaDk}
              onKarsiTaraf={setKarsiTaraf}
              onKapandi={() => setKapandi(true)}
              onAyrilIstegi={() => setCikisAcik(true)}
              biletTazele={biletTazele}
              dersBilgisi={dersBilgisi}
              sohbet={sohbet}
            />
          </Suspense>
        </section>
        {not && (
          <p
            role="status"
            className="pointer-events-none absolute left-1/2 top-3 z-10 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-ders-yuzey/95 px-4 py-2 text-center text-sm font-medium text-white shadow-lg"
          >
            {not}
          </p>
        )}

        {kapandi && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-ders-zemin/95 px-4">
            <div className="w-full max-w-md rounded-lg bg-ders-yuzey p-6 text-center">
              <h2 className="text-xl font-semibold">Canlı dersle bağlantın kesildi</h2>
              <p className="mt-2 text-base text-white/70">
                Ders saati içindeysen yeniden katılabilirsin.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className={`${DUGME} h-12 bg-marka px-6 text-lg text-marka-fg hover:bg-marka-hover`}
                >
                  Yeniden katıl
                </button>
                <button
                  type="button"
                  onClick={() => tamSayfaGit(dersSayfasi)}
                  className={`${DUGME} h-12 bg-ders-dugme px-6 text-lg text-white hover:bg-ders-hover`}
                >
                  Ders sayfasına dön
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <Modal
        open={cikisAcik}
        onClose={() => {
          if (!ayriliyor) setCikisAcik(false);
        }}
        title="Dersten ayrılmak istiyor musun?"
        description="Ders karşı taraf için açık kalır. Ders saati içinde yeniden katılabilirsin."
      >
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setCikisAcik(false)}
            disabled={ayriliyor}
            className={`${DUGME} h-12 border-2 border-slate-200 bg-white px-6 text-lg text-slate-900 hover:border-slate-900`}
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => void ayril()}
            disabled={ayriliyor}
            className={`${DUGME} h-12 bg-red-600 px-6 text-lg text-white hover:bg-red-700`}
          >
            {ayriliyor ? "Ayrılıyor…" : "Ayrıl"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
