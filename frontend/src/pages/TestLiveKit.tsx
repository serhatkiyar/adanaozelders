import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveKitRoom, VideoConference, useLocalParticipant } from "@livekit/components-react";
import { LocalVideoTrack } from "livekit-client";
import {
  BackgroundProcessor,
  supportsBackgroundProcessors,
  type BackgroundProcessorWrapper,
  type SwitchBackgroundProcessorOptions,
} from "@livekit/track-processors";
import "@livekit/components-styles";
import {
  BULANIKLIK_YARICAPI,
  SANAL_ARKAPLANLAR,
  type SanalArkaplan,
} from "../lib/sanalArkaplan";

/* ──────────────────────────────────────────────────────────────────────────
 * TEST SAYFASI — LiveKit canlı ders denemesi (/test-livekit)
 *
 * Neden ayrı sayfa: gerçek canlı ders akışı HÂLÂ Jitsi'dir (`GlobalMeeting`
 * + `meetingStore`). Bu sayfa ona PARALEL durur ve hiçbir şeyini kullanmaz —
 * `meetingStore` bilerek import EDİLMEZ. Jitsi'den LiveKit'e geçiş ancak
 * iki cihaz/iki ağdan canlı test edildikten sonra yapılır.
 *
 * Token OTOMATİK alınmaz. Backend'den elle istenir:
 *   GET /api/v1/bookings/{id}/live-token
 * ve dönen `token` aşağıya yapıştırılır. Böylece sayfa giriş/rezervasyon
 * durumundan bağımsız denenebilir; oda adı token'ın içindedir.
 *
 * Yalnız dev sunucusunda açıktır (App.tsx'teki `import.meta.env.DEV` kapısı).
 * ────────────────────────────────────────────────────────────────────────── */

const VARSAYILAN_SUNUCU = "wss://canli.adanaozelders.com.tr";

/** Token'ın içindeki oda adını bilgi amaçlı gösterir (doğrulama YAPMAZ). */
function tokenOdasi(token: string): string | null {
  try {
    const govde = token.split(".")[1];
    if (!govde) return null;
    const json = atob(govde.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { video?: { room?: string } };
    return claims.video?.room ?? null;
  } catch {
    return null;
  }
}

export default function TestLiveKit() {
  const [sunucu, setSunucu] = useState(VARSAYILAN_SUNUCU);
  const [token, setToken] = useState("");
  const [bagli, setBagli] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const temizToken = token.trim();
  const oda = useMemo(() => tokenOdasi(temizToken), [temizToken]);

  const baglan = () => {
    setHata(null);
    setBagli(true);
  };

  if (bagli) {
    return (
      <div className="flex h-screen flex-col bg-slate-900">
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-slate-300">
          <span>
            LiveKit denemesi · <code className="font-mono">{sunucu}</code>
            {oda && (
              <>
                {" · oda "}
                <code className="font-mono">{oda}</code>
              </>
            )}
          </span>
          <button
            onClick={() => setBagli(false)}
            className="rounded-lg bg-red-600/20 px-3 py-1.5 font-semibold text-red-300 transition hover:bg-red-600/30"
          >
            Ayrıl
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          <LiveKitRoom
            serverUrl={sunucu}
            token={temizToken}
            connect
            video
            audio
            data-lk-theme="default"
            style={{ height: "100%" }}
            onDisconnected={() => setBagli(false)}
            onError={(e) => {
              setHata(e.message);
              setBagli(false);
            }}
          >
            <VideoConference />
            <SanalArkaplanSecici />
          </LiveKitRoom>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-marka-metin">
            Test · Prototip
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">LiveKit canlı ders denemesi</h1>
          <p className="mt-2 text-sm text-slate-500">
            Kendi sunucumuzdaki SFU'ya bağlanır. Gerçek ders akışı hâlâ Jitsi'dir; bu sayfa ona
            dokunmaz. Kamera/mikrofon izni istenir.
          </p>
        </header>

        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <Alan label="Sunucu adresi" ipucu="LiveKit signaling adresi (wss://).">
            <input
              className="input"
              value={sunucu}
              onChange={(e) => setSunucu(e.target.value)}
            />
          </Alan>

          <Alan
            label="Erişim token'ı"
            ipucu="Backend'den elle al: GET /api/v1/bookings/{id}/live-token → yanıttaki `token` alanı. Oda adı token'ın içindedir."
          >
            <textarea
              className="input min-h-28 font-mono text-xs"
              placeholder="eyJhbGciOiJIUzI1NiIs..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </Alan>

          {temizToken && (
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
              {oda ? (
                <>
                  Token oda: <code className="font-mono">{oda}</code>
                </>
              ) : (
                "Token çözülemedi — yine de denenebilir, oda adını sunucu belirler."
              )}
            </p>
          )}

          {hata && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
              Bağlantı hatası: {hata}
            </p>
          )}

          <button
            onClick={baglan}
            disabled={!temizToken || !sunucu.trim()}
            className="rounded-xl bg-marka px-5 py-2.5 text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            🎥 Odaya bağlan
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sanal arka plan / bulanıklaştırma
 *
 * `@livekit/track-processors` MediaPipe selfie-segmentation ile kamera
 * görüntüsünün arka planını ayırır. Processor yerel kamera track'ine bağlanır;
 * karşı tarafa giden görüntü zaten işlenmiş olur, sunucu tarafında iş yoktur.
 *
 * Processor TEMBEL bağlanır: kullanıcı ilk kez "Yok" dışında bir şey seçene
 * kadar WASM + model (~toplam birkaç MB, CDN'den) indirilmez. İlk bağlamadan
 * sonra geçişler `switchTo` ile yapılır — dokümanın önerdiği yol; pipeline
 * yeniden kurulmadığı için görüntüde sıçrama olmaz.
 * ────────────────────────────────────────────────────────────────────────── */

type ArkaplanSecimi =
  | { tur: "yok" }
  | { tur: "bulanik" }
  | { tur: "gorsel"; arkaplan: SanalArkaplan };

function secimAyari(secim: ArkaplanSecimi): SwitchBackgroundProcessorOptions {
  if (secim.tur === "bulanik") {
    return { mode: "background-blur", blurRadius: BULANIKLIK_YARICAPI };
  }
  if (secim.tur === "gorsel") {
    return { mode: "virtual-background", imagePath: secim.arkaplan.gorsel };
  }
  return { mode: "disabled" };
}

function SanalArkaplanSecici() {
  const { cameraTrack, isCameraEnabled } = useLocalParticipant();
  const islemciRef = useRef<BackgroundProcessorWrapper | null>(null);
  const [secim, setSecim] = useState<ArkaplanSecimi>({ tur: "yok" });
  const [calisiyor, setCalisiyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [acik, setAcik] = useState(false);

  const kamera = cameraTrack?.track;
  const videoTrack = kamera instanceof LocalVideoTrack ? kamera : null;
  const destekli = useMemo(() => supportsBackgroundProcessors(), []);

  // Kamera track'i değişirse (kapanıp açılırsa) eski processor geçersizdir.
  useEffect(() => {
    islemciRef.current = null;
    setSecim({ tur: "yok" });
    setHata(null);
    if (!videoTrack) return;
    return () => {
      if (!islemciRef.current) return;
      islemciRef.current = null;
      void videoTrack.stopProcessor().catch(() => undefined);
    };
  }, [videoTrack]);

  const uygula = useCallback(
    async (yeni: ArkaplanSecimi) => {
      if (!videoTrack) return;
      setHata(null);
      // "Yok" seçiliyken henüz processor bağlanmadıysa yapacak bir şey yok.
      if (!islemciRef.current && yeni.tur === "yok") {
        setSecim(yeni);
        return;
      }
      setCalisiyor(true);
      try {
        const ayar = secimAyari(yeni);
        if (islemciRef.current) {
          await islemciRef.current.switchTo(ayar);
        } else {
          const islemci = BackgroundProcessor(ayar);
          await videoTrack.setProcessor(islemci);
          islemciRef.current = islemci;
        }
        setSecim(yeni);
      } catch (e) {
        setHata(e instanceof Error ? e.message : "Arka plan uygulanamadı.");
      } finally {
        setCalisiyor(false);
      }
    },
    [videoTrack],
  );

  if (!isCameraEnabled || !videoTrack) return null;

  if (!destekli) {
    return (
      <p className="absolute left-3 top-3 z-10 rounded-xl bg-slate-900/85 px-3 py-2 text-xs text-slate-300 shadow-lg">
        Bu tarayıcı sanal arka planı desteklemiyor.
      </p>
    );
  }

  const seciliAtif = secim.tur === "gorsel" ? secim.arkaplan.atif : null;

  return (
    <div className="absolute left-3 top-3 z-10 w-[min(19rem,calc(100%-1.5rem))]">
      <button
        type="button"
        onClick={() => setAcik((v) => !v)}
        aria-expanded={acik}
        className="rounded-xl bg-slate-900/85 px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg ring-1 ring-white/15 transition hover:bg-slate-900"
      >
        Arka plan
      </button>

      {acik && (
        <div className="mt-2 rounded-2xl bg-slate-900/90 p-3 shadow-xl ring-1 ring-white/15">
          <div className="flex flex-wrap gap-2">
            <ArkaplanDugmesi
              secili={secim.tur === "yok"}
              devreDisi={calisiyor}
              onClick={() => void uygula({ tur: "yok" })}
            >
              <span className="flex h-12 w-20 items-center justify-center text-xs text-slate-300">
                Yok
              </span>
            </ArkaplanDugmesi>

            <ArkaplanDugmesi
              secili={secim.tur === "bulanik"}
              devreDisi={calisiyor}
              onClick={() => void uygula({ tur: "bulanik" })}
            >
              <span className="flex h-12 w-20 items-center justify-center text-xs text-slate-300">
                Bulanık
              </span>
            </ArkaplanDugmesi>

            {SANAL_ARKAPLANLAR.map((arkaplan) => (
              <ArkaplanDugmesi
                key={arkaplan.id}
                secili={secim.tur === "gorsel" && secim.arkaplan.id === arkaplan.id}
                devreDisi={calisiyor}
                etiket={arkaplan.ad}
                onClick={() => void uygula({ tur: "gorsel", arkaplan })}
              >
                <img
                  src={arkaplan.gorsel}
                  alt={arkaplan.ad}
                  loading="lazy"
                  className="h-12 w-20 object-cover"
                />
              </ArkaplanDugmesi>
            ))}
          </div>

          {calisiyor && (
            <p className="mt-2 text-xs text-slate-400">Uygulanıyor…</p>
          )}
          {seciliAtif && !calisiyor && (
            <p className="mt-2 text-[11px] leading-snug text-slate-400">{seciliAtif}</p>
          )}
          {hata && (
            <p className="mt-2 text-xs font-medium text-red-300">
              Arka plan uygulanamadı: {hata}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ArkaplanDugmesi({
  secili,
  devreDisi,
  etiket,
  onClick,
  children,
}: {
  secili: boolean;
  devreDisi: boolean;
  etiket?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={devreDisi}
      aria-pressed={secili}
      title={etiket}
      className={`overflow-hidden rounded-lg ring-2 transition disabled:cursor-not-allowed disabled:opacity-60 ${
        secili ? "ring-marka" : "ring-white/20 hover:ring-white/50"
      }`}
    >
      {children}
    </button>
  );
}

function Alan({
  label,
  ipucu,
  children,
}: {
  label: string;
  ipucu?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {ipucu && <span className="mt-1 block text-xs text-slate-400">{ipucu}</span>}
    </label>
  );
}
