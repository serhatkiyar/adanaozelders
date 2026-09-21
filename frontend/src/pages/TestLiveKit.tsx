import { useEffect, useMemo, useRef, useState } from "react";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import { useKrispNoiseFilter } from "@livekit/components-react/krisp";
import type { RoomOptions } from "livekit-client";
import "@livekit/components-styles";

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

/* ──────────────────────────────────────────────────────────────────────────
 * MOBİL SOHBET DÜZELTMESİ
 *
 * `@livekit/components-styles` 1.2.0, 600px altında sohbet panelini
 * `position:fixed; top:0; bottom:var(--lk-control-bar-height)` yapar. `fixed`
 * kutu LAYOUT viewport'a çakılıdır; mobil tarayıcıda klavye açılınca layout
 * viewport küçülmez (viewport meta'sında `interactive-widget` yok → varsayılan
 * `resizes-visual`), yalnız GÖRSEL viewport küçülür. Yani panelin alt satırı —
 * mesaj kutusu ve "Send" düğmesi — klavyenin arkasında kalabilir.
 *
 * Aşağıdaki override sadece bu sayfada geçerlidir: klavye yüksekliği
 * `--adod-klavye` değişkenine yazılır, panel o kadar yukarı alınır. Klavye
 * kapalıyken değer 0'dır ve kütüphanenin kendi davranışı aynen korunur.
 * ────────────────────────────────────────────────────────────────────────── */
const MOBIL_SOHBET_CSS = `
@media (max-width: 600px) {
  .adod-livekit .lk-chat {
    bottom: calc(var(--lk-control-bar-height) + var(--adod-klavye, 0px));
  }
}
`;

/* Oda ayarları — MODÜL SEVİYESİNDE sabit tutulur bilerek: `LiveKitRoom` bu
 * nesneyle `new Room(...)` kurar; her render'da yeni bir nesne literali
 * verilseydi oda yeniden yaratılma riski doğardı.
 *
 * `adaptiveStream` ve `dynacast` livekit-client'ta VARSAYILAN KAPALIDIR
 * (bkz. node_modules/livekit-client `roomOptionDefaults`), açılması gereken
 * tek iki ayar bunlardır:
 *   adaptiveStream  Abone olunan video, ekrandaki <video> elemanının boyutuna
 *                   göre otomatik kalite seçer; eleman görünmezken akışı
 *                   duraklatır. Katılımcı listesi/küçük karo görünümünde
 *                   gereksiz bant genişliğini kesen asıl ayar.
 *   dynacast        Hiç kimsenin izlemediği simulcast katmanlarını sunucu
 *                   isteğiyle duraklatır; yayıncının CPU ve upload yükünü
 *                   düşürür. Zayıf ADSL/mobil hatlarda belirleyici.
 *
 * `publishDefaults.simulcast` ZATEN varsayılan `true`'dur; burada yalnız
 * niyeti belgelemek için açıkça yazıldı — davranışı değiştirmez. */
const ODA_AYARLARI: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    simulcast: true,
  },
};

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

  const kapsayici = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const kok = kapsayici.current;
    if (!kok) return;

    /* 1) Klavye yüksekliği → `--adod-klavye`.
       `window.innerHeight` layout viewport'tur ve klavye açılınca DEĞİŞMEZ;
       `visualViewport.height` ise klavye kadar küçülür. Aradaki fark, görsel
       alanın altında kalan (klavyenin örttüğü) yüksekliktir. `offsetTop`
       eklenir çünkü tarayıcı odaklı input'u göstermek için görsel viewport'u
       kaydırdığında o kadarı zaten telafi edilmiş olur. */
    const gorunur = window.visualViewport;
    const olc = () => {
      if (!gorunur) return;
      const klavye = Math.max(0, window.innerHeight - (gorunur.height + gorunur.offsetTop));
      kok.style.setProperty("--adod-klavye", `${Math.round(klavye)}px`);
    };
    olc();
    gorunur?.addEventListener("resize", olc);
    gorunur?.addEventListener("scroll", olc);

    /* 2) "Send" düğmesine dokunurken input'un odağı kaybolmasın.
       Odak kaybı → klavye kapanır → görsel viewport ve `fixed` panel yerinden
       oynar → parmak kalktığında düğme artık orada olmadığı için `click`
       hiç üretilmez. `pointerdown` iptal edilince odak değişimi (mousedown'ın
       varsayılan davranışı) olmaz; `click` ise iptal edilmez, normal üretilir. */
    const odagiKoru = (e: Event) => {
      const hedef = e.target as HTMLElement | null;
      // Seçici bilerek `[type=submit]` demiyor: formdaki tek düğme budur ve
      // kütüphane sürümü `type` özniteliğini bırakırsa kural sessizce ölmesin.
      if (hedef?.closest?.(".lk-chat-form button")) e.preventDefault();
    };
    kok.addEventListener("pointerdown", odagiKoru, true);
    kok.addEventListener("mousedown", odagiKoru, true);

    return () => {
      gorunur?.removeEventListener("resize", olc);
      gorunur?.removeEventListener("scroll", olc);
      kok.removeEventListener("pointerdown", odagiKoru, true);
      kok.removeEventListener("mousedown", odagiKoru, true);
    };
  }, [bagli]);

  if (bagli) {
    /* Üst şerit BİLEREK `LiveKitRoom`'un İÇİNDEDİR: gürültü filtresi düğmesi
     * `useKrispNoiseFilter`'ı kullanır, o da oda context'ini ister. */
    return (
      <div ref={kapsayici} className="adod-livekit flex h-screen flex-col bg-slate-900">
        <style>{MOBIL_SOHBET_CSS}</style>
        <LiveKitRoom
          serverUrl={sunucu}
          token={temizToken}
          connect
          video
          audio
          options={ODA_AYARLARI}
          data-lk-theme="default"
          className="flex min-h-0 flex-1 flex-col"
          onDisconnected={() => setBagli(false)}
          onError={(e) => {
            setHata(e.message);
            setBagli(false);
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs text-slate-300">
            <span>
              LiveKit denemesi · <code className="font-mono">{sunucu}</code>
              {oda && (
                <>
                  {" · oda "}
                  <code className="font-mono">{oda}</code>
                </>
              )}
            </span>
            <span className="flex items-center gap-2">
              <GurultuFiltresiDugmesi />
              <button
                onClick={() => setBagli(false)}
                className="rounded-lg bg-red-600/20 px-3 py-1.5 font-semibold text-red-300 transition hover:bg-red-600/30"
              >
                Ayrıl
              </button>
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <VideoConference />
          </div>
        </LiveKitRoom>
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

/* Krisp gürültü engelleme — mikrofon track'ine takılan bir `TrackProcessor`.
 *
 * VARSAYILAN AÇIK: bağlanır bağlanmaz bir kez `true` denenir; kullanıcı
 * isterse bu düğmeden kapatabilir.
 *
 * İKİ ÖNEMLİ UYARI:
 * 1) Paket LiveKit'in KENDİ dokümanında "yalnız LiveKit Cloud'da desteklenir"
 *    diye işaretli. SDK, modelleri `https://integrations.livekit.io` adresinden
 *    odanın token'ıyla yetkilendirilerek indirir; bizim SFU'muz kendi
 *    sunucumuzda olduğu için bu yetkilendirme muhtemelen reddedilir. O yüzden
 *    burada "denenir ve başarısızsa sessizce vazgeçilir" akışı kuruldu:
 *    filtre açılmasa bile mikrofon ve ders AKIŞI BOZULMAZ.
 * 2) `isKrispNoiseFilterSupported()` yalnız tarayıcıya bakar (eski Safari'yi
 *    eler), sunucu hakkını KONTROL ETMEZ. Gerçek sonucu hook'un bildirdiği
 *    `isNoiseFilterEnabled` gösterir — düğme onu yansıtır. */
function GurultuFiltresiDugmesi() {
  const { setNoiseFilterEnabled, isNoiseFilterEnabled, isNoiseFilterPending } =
    useKrispNoiseFilter();

  // Filtreyi kurarken çıkan hata dersi KESMEZ; sessizce yutmak yerine konsola
  // yazılır ki neden devreye girmediği anlaşılabilsin.
  const dene = (acik: boolean) => {
    Promise.resolve(setNoiseFilterEnabled(acik)).catch((e: unknown) => {
      console.warn("Krisp gürültü filtresi uygulanamadı:", e);
    });
  };

  useEffect(() => {
    dene(true);
    // `setNoiseFilterEnabled` hook içinde sabit referanstır; bir kez denenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        dene(!isNoiseFilterEnabled);
      }}
      disabled={isNoiseFilterPending}
      aria-pressed={isNoiseFilterEnabled}
      title="Krisp gürültü engelleme"
      className="rounded-lg bg-white/10 px-3 py-1.5 font-semibold text-slate-200 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Gürültü filtresi:{" "}
      {isNoiseFilterPending ? "…" : isNoiseFilterEnabled ? "açık" : "kapalı"}
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
