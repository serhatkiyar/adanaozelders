/**
 * Ders tahtası taşıyıcısı — Centrifugo `ders:{id}` kanalı (plan §4).
 *
 * Zoom komut kanalı (512 karakter, 2 mesaj/sn) tahtaya yetmez; eşitleme
 * bizim Centrifugo'muzdan gider. Bu modül `centrifugoStore`'un ("yazıyor…")
 * YANINDA kendi küçük bağlantısını açar: o bağlantının ömrü sohbet
 * paneline bağlı (açılıp kapanır), tahta kanalı ise oda boyunca yaşar.
 *
 * Kurallar:
 * - Kanal adı ve abonelik token'ı SUNUCUDAN (`/bookings/{id}/tahta-token`,
 *   canlı ders ucuyla aynı kapılar). Token tazelenirken dönen `tahta_acik`
 *   geç katılanın / yeniden bağlananın son durumudur.
 * - Aç/kapa YALNIZ sunucu yayınından (`info` taşımayan) kabul edilir: öğrenci
 *   kanala istemciden "kapat" yazsa da etkisizdir.
 * - İstemci yayınlarında Centrifugo gönderenin `chanInfo`sunu (token'daki
 *   `{rol}`) ekler; sayfa işlemleri yalnız öğretmenden kabul edilir
 *   (`TahtaPaneli`). Kendi yayınımızın yankısı istemci kimliğiyle elenir.
 * - Büyük mesajlar parçalanır (`lib/tahtaSenkron.ts` `parcala`).
 */
import { Centrifuge, UnauthorizedError, type Subscription } from "centrifuge";
import type { AxiosError } from "axios";

import { getTahtaToken } from "@/api/bookings";
import { getCentrifugoToken } from "@/api/realtime";
import {
  ParcaToplayici,
  mesajCoz,
  parcala,
  parcaMi,
  type TahtaMesaji,
} from "@/lib/tahtaSenkron";
import { centrifugoUrl } from "@/store/centrifugoStore";

export interface Gonderen {
  istemci: string;
  ogretmen: boolean;
}

export type TahtaDinleyici = (m: TahtaMesaji, g: Gonderen) => void;

export interface DersKanali {
  /** Mesajı kanala yayınlar (gerekirse parçalar). Bağlı değilse düşer. */
  yayinla: (m: TahtaMesaji) => void;
  /** Tahta mesajlarını dinler; çözme fonksiyonu döner. */
  dinle: (f: TahtaDinleyici) => () => void;
  /** Her (yeniden) abonelikte çağrılır — geç katılan sahneyi yeniden ister. */
  aboneOlununca: (f: () => void) => () => void;
  kapat: () => void;
}

/** Yetki yok, pencere kapandı ya da özellik kapalı: tazelemeyi bırak. */
function kalici(err: unknown): boolean {
  const durum = (err as AxiosError)?.response?.status;
  return durum === 401 || durum === 403 || durum === 404 || durum === 409 || durum === 503;
}

let parcaSayaci = 0;

export function dersKanaliAc(
  dersId: number,
  olaylar: {
    /** Tahta açık/kapalı (sunucu yayını ya da token yanıtı). */
    onTahta: (acik: boolean) => void;
    /** Kanal kullanılabilir mi (ilk token alınabildi mi). */
    onHazir: (hazir: boolean) => void;
  },
): DersKanali {
  let kapandi = false;
  let client: Centrifuge | null = null;
  let sub: Subscription | null = null;
  let benimIstemci = "";
  const dinleyiciler = new Set<TahtaDinleyici>();
  const aboneDinleyicileri = new Set<() => void>();
  const toplayici = new ParcaToplayici();

  const dagit = (ham: unknown, g: Gonderen) => {
    const m = mesajCoz(ham);
    if (!m) return;
    for (const f of dinleyiciler) f(m, g);
  };

  void (async () => {
    let ilkBag;
    let ilkKanal;
    try {
      [ilkBag, ilkKanal] = await Promise.all([getCentrifugoToken(), getTahtaToken(dersId)]);
    } catch {
      if (!kapandi) olaylar.onHazir(false);
      return;
    }
    if (kapandi) return;
    olaylar.onTahta(ilkKanal.tahta_acik);

    const c = new Centrifuge(centrifugoUrl(), {
      token: ilkBag.token,
      getToken: async () => {
        try {
          return (await getCentrifugoToken()).token;
        } catch (err) {
          if (kalici(err)) throw new UnauthorizedError("gerçek-zamanlı yetki yok");
          throw err;
        }
      },
    });
    c.on("connected", (ctx) => {
      benimIstemci = ctx.client;
    });
    c.on("error", () => {});

    let ilkTokenKullanildi = false;
    const s = c.newSubscription(ilkKanal.kanal, {
      getToken: async () => {
        // İlk abonelik elimizdeki token'la; sonrakiler (tazeleme, yeniden
        // bağlanma) kapılardan yeniden geçer ve son tahta durumunu getirir.
        if (!ilkTokenKullanildi) {
          ilkTokenKullanildi = true;
          return ilkKanal.token;
        }
        try {
          const yeni = await getTahtaToken(dersId);
          if (!kapandi) olaylar.onTahta(yeni.tahta_acik);
          return yeni.token;
        } catch (err) {
          if (kalici(err)) throw new UnauthorizedError("tahta kanalına yetki yok");
          throw err;
        }
      },
    });
    s.on("error", () => {});
    s.on("subscribed", () => {
      olaylar.onHazir(true);
      for (const f of aboneDinleyicileri) f();
    });
    s.on("publication", (ctx) => {
      const veri = ctx.data as unknown;
      // Sunucu yayını: istemci bilgisi yok.
      if (!ctx.info) {
        const v = veri as { t?: unknown; acik?: unknown };
        if (v?.t === "tahta" && typeof v.acik === "boolean") olaylar.onTahta(v.acik);
        return;
      }
      if (ctx.info.client === benimIstemci) return;
      const g: Gonderen = {
        istemci: ctx.info.client,
        ogretmen: (ctx.info.chanInfo as { rol?: unknown } | undefined)?.rol === "ogretmen",
      };
      if (parcaMi(veri)) {
        const metin = toplayici.ekle(g.istemci, veri);
        if (metin !== null) dagit(metin, g);
        return;
      }
      dagit(veri, g);
    });
    s.subscribe();
    c.connect();
    client = c;
    sub = s;
  })();

  return {
    yayinla: (m) => {
      if (!sub || sub.state !== "subscribed") return;
      const s = sub;
      const metin = JSON.stringify(m);
      const parcalar = parcala(metin, `${Date.now().toString(36)}-${++parcaSayaci}`);
      for (const veri of parcalar ?? [m]) void s.publish(veri).catch(() => {});
    },
    dinle: (f) => {
      dinleyiciler.add(f);
      return () => dinleyiciler.delete(f);
    },
    aboneOlununca: (f) => {
      aboneDinleyicileri.add(f);
      return () => aboneDinleyicileri.delete(f);
    },
    kapat: () => {
      kapandi = true;
      dinleyiciler.clear();
      aboneDinleyicileri.clear();
      try {
        sub?.unsubscribe();
      } catch {
        /* yoksay */
      }
      try {
        client?.disconnect();
      } catch {
        /* yoksay */
      }
      sub = null;
      client = null;
    },
  };
}
