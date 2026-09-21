import { create } from "zustand";
import { Centrifuge, UnauthorizedError, type Subscription } from "centrifuge";
import type { AxiosError } from "axios";
import { getCentrifugoToken, sendTyping } from "@/api/realtime";

/**
 * Centrifugo bağlantısı — `wsStore.ts`'in YANINDA, yerine değil.
 *
 * `wsStore` mevcut `/ws` ucunu (bildirim/mesaj push'u + WebRTC sinyalleşmesi)
 * sürdürür ve bu dosyadan etkilenmez. Buradaki bağlantı yalnız replika-güvenli
 * yeni yetenek içindir; şimdilik tek kullanıcısı "yazıyor…" göstergesidir.
 *
 * Bağlantı UYGULAMA KÖKÜNDE değil, mesaj ekranında kurulur: ikinci bir soketi
 * tüm oturum boyunca açık tutmanın karşılığı yok.
 */

/** "yazıyor…" ipucunun ekranda kalma süresi. Karşı taraf yazmayı bırakırsa
 *  yeni ipucu gelmez ve gösterge bu süre sonunda kendiliğinden söner. */
const YAZIYOR_MS = 3000;
/** Kendi yazışımızda sunucuya en fazla bu sıklıkta haber verilir. */
const BILDIRIM_ARALIGI_MS = 2000;

/**
 * Centrifugo WebSocket adresi.
 *
 * `wsStore.ts::wsBaseUrl()` ile aynı mantık — ama API öneki (`/api/v1`) DÜŞER:
 * Centrifugo backend'in arkasında değil, ters proxy'de ayrı bir yoldadır.
 * On satırlık bu kopya, iki farklı adres kuralını tek bir paylaşılan modüle
 * sıkıştırmaktan ucuz.
 */
const YOL = "/gercekzaman/connection/websocket";

function centrifugoUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL;
  // Base yok ya da göreli (Vite proxy) → sayfanın kendi origin'i.
  if (!base || base.startsWith("/")) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}${YOL}`;
  }
  const u = new URL(base);
  return `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}${YOL}`;
}

// Modül-seviyesi bağlantı durumu (store dışında; render tetiklemez).
let client: Centrifuge | null = null;
let sub: Subscription | null = null;
/** connect() async'tir; arada gelen disconnect()'i yakalamak için nesil sayacı.
 *  (React StrictMode geliştirmede effect'i kur→yık→kur diye çalıştırır.) */
let nesil = 0;
const sonucZamanlayicilari = new Map<number, ReturnType<typeof setTimeout>>();
const sonBildirim = new Map<number, number>();

function yaziyorSuresiniUzat(
  conversationId: number,
  set: (partial: Partial<CentrifugoState>) => void,
  get: () => CentrifugoState
) {
  const mevcut = sonucZamanlayicilari.get(conversationId);
  if (mevcut) clearTimeout(mevcut);
  if (!get().typing[conversationId]) {
    set({ typing: { ...get().typing, [conversationId]: true } });
  }
  sonucZamanlayicilari.set(
    conversationId,
    setTimeout(() => {
      sonucZamanlayicilari.delete(conversationId);
      const { [conversationId]: _silinen, ...kalan } = get().typing;
      set({ typing: kalan });
    }, YAZIYOR_MS)
  );
}

interface CentrifugoState {
  isConnected: boolean;
  /** conversation_id → karşı taraf şu an yazıyor. */
  typing: Record<number, boolean>;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Kendi yazışımızı karşı tarafa duyurur (throttle'lı, hata yutulur). */
  notifyTyping: (conversationId: number) => void;
}

export const useCentrifugoStore = create<CentrifugoState>((set, get) => ({
  isConnected: false,
  typing: {},

  connect: async () => {
    if (client) return; // zaten bağlı/bağlanıyor
    const benimNesil = ++nesil;

    // İlk token'ı BİZ alırız: kanal adı da bu yanıttan gelir (istemcide
    // türetilmez). Uç 503 dönerse (özellik kapalı) sessizce vazgeçilir —
    // kullanıcı hiçbir hata görmez, ekranın geri kalanı normal çalışır.
    let ilk;
    try {
      ilk = await getCentrifugoToken();
    } catch {
      return;
    }
    if (benimNesil !== nesil) return; // arada disconnect geldi

    const c = new Centrifuge(centrifugoUrl(), {
      token: ilk.token,
      // Yeniden bağlanma/backoff/token tazeleme SDK'nın işidir; elle
      // reconnect yazmak (wsStore'daki gibi) burada gereksiz tekrar olurdu.
      getToken: async () => {
        try {
          return (await getCentrifugoToken()).token;
        } catch (err) {
          const durum = (err as AxiosError)?.response?.status;
          if (durum === 401 || durum === 403 || durum === 503) {
            // Yetki yok ya da özellik kapandı: tazelemeyi tekrar DENEME.
            throw new UnauthorizedError("gerçek-zamanlı yetki yok");
          }
          throw err; // geçici hata → SDK geri çekilmeyle yeniden dener
        }
      },
    });

    c.on("connected", () => set({ isConnected: true }));
    c.on("disconnected", () => set({ isConnected: false }));
    // Dinleyicisiz "error" olayı EventEmitter'da istisnaya döner; bu katman
    // best-effort olduğu için sessizce yutulur.
    c.on("error", () => {});

    const s = c.newSubscription(ilk.channel);
    s.on("error", () => {});
    s.on("publication", (ctx) => {
      const veri = ctx.data as { type?: string; conversation_id?: number };
      if (veri?.type !== "TYPING" || typeof veri.conversation_id !== "number") {
        return;
      }
      yaziyorSuresiniUzat(veri.conversation_id, set, get);
    });
    s.subscribe();
    c.connect();

    client = c;
    sub = s;
  },

  disconnect: () => {
    nesil += 1; // uçuştaki connect()'i geçersiz kıl
    for (const t of sonucZamanlayicilari.values()) clearTimeout(t);
    sonucZamanlayicilari.clear();
    sonBildirim.clear();
    if (sub) {
      try {
        sub.unsubscribe();
      } catch {
        /* yoksay */
      }
      sub = null;
    }
    if (client) {
      try {
        client.disconnect();
      } catch {
        /* yoksay */
      }
      client = null;
    }
    set({ isConnected: false, typing: {} });
  },

  notifyTyping: (conversationId: number) => {
    const simdi = Date.now();
    const son = sonBildirim.get(conversationId) ?? 0;
    if (simdi - son < BILDIRIM_ARALIGI_MS) return;
    sonBildirim.set(conversationId, simdi);
    // Best-effort: hata kullanıcıya gösterilmez, mesaj yazmayı etkilemez.
    void sendTyping(conversationId).catch(() => {});
  },
}));
