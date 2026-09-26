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
 * - Tepki ve el kaldırma (`t`: `tepki` | `el` | `elSor`) aynı kanaldan
 *   gider; tahta çözücüsüne (`mesajCoz`) DÜŞMEZ, ayrı dinleyiciye yönlenir
 *   (`oda/durum/tepkiler.ts`). Gönderen rolü `chanInfo.rol`dan.
 * - Varlık (presence, `join`/`leave`): karşı tarafın ders sayfasında olup
 *   olmadığı (`oda/durum/bekleme.ts`). Kanal önizlemede de açıktır; ilk
 *   gelen karşı tarafı burada bekler. Varlık okunamazsa durum `yok` olur ve
 *   beklenmez.
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

import {
  karsiVarMi,
  rolOku,
  type KanalRolu,
  type KanalVarligi,
} from "../oda/durum/bekleme";

export type { KanalRolu, KanalVarligi };

export interface Gonderen {
  istemci: string;
  ogretmen: boolean;
}

export type TahtaDinleyici = (m: TahtaMesaji, g: Gonderen) => void;

/** Tepki/el mesajı dinleyicisi: ham gövde + gönderenin rolü. */
export type OdaDinleyici = (veri: unknown, rol: KanalRolu | null) => void;

/** Tahtaya değil odaya (tepki, el) ait yayın türleri. */
const ODA_MESAJLARI: ReadonlySet<unknown> = new Set(["tepki", "el", "elSor"]);

export interface DersKanali {
  /** Mesajı kanala yayınlar (gerekirse parçalar). Bağlı değilse düşer. */
  yayinla: (m: TahtaMesaji) => void;
  /** Tahta mesajlarını dinler; çözme fonksiyonu döner. */
  dinle: (f: TahtaDinleyici) => () => void;
  /** Her (yeniden) abonelikte çağrılır — geç katılan sahneyi yeniden ister. */
  aboneOlununca: (f: () => void) => () => void;
  /** Tepki/el mesajı yayınlar; bağlı değilse ya da yayın reddedilirse `false`. */
  odaYayinla: (veri: object) => Promise<boolean>;
  /** Tepki/el mesajlarını dinler (tahta dinleyicilerine gitmez). */
  odaDinle: (f: OdaDinleyici) => () => void;
  /** Kanalın ve karşı tarafın güncel varlık bilgisi. */
  varlik: () => KanalVarligi;
  /** Varlık her değiştiğinde çağrılır; çözme fonksiyonu döner. */
  varlikDinle: (f: (v: KanalVarligi) => void) => () => void;
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
  const odaDinleyicileri = new Set<OdaDinleyici>();
  const varlikDinleyicileri = new Set<(v: KanalVarligi) => void>();
  const toplayici = new ParcaToplayici();

  // Varlık: kanaldaki bağlantılar (istemci → rol). Kendi rolüm token yanıtından.
  let varlik: KanalVarligi = { durum: "aciliyor", karsiVar: false };
  let benimRolum: KanalRolu | null = null;
  const bagli = new Map<string, KanalRolu | null>();
  let varlikSirasi = 0;
  const varlikYaz = (durum: KanalVarligi["durum"]) => {
    const karsiVar = benimRolum !== null && karsiVarMi(bagli.values(), benimRolum);
    if (kapandi || (varlik.durum === durum && varlik.karsiVar === karsiVar)) return;
    varlik = { durum, karsiVar };
    for (const f of varlikDinleyicileri) f(varlik);
  };

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
      varlikYaz("yok");
      return;
    }
    if (kapandi) return;
    olaylar.onTahta(ilkKanal.tahta_acik);
    benimRolum = ilkKanal.rol;

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
    // Kalıcı kopuş (yetki yok vb.); geçici kopuşta istemci `connecting`e döner.
    c.on("disconnected", () => varlikYaz("yok"));

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
    s.on("subscribing", () => {
      bagli.clear();
      if (varlik.durum === "hazir") varlikYaz("kopuk");
    });
    // Yalnız kalıcı hatada (ya da kendi `kapat`ımızda) abonelik biter.
    s.on("unsubscribed", () => varlikYaz("yok"));
    s.on("join", (ctx) => {
      bagli.set(ctx.info.client, rolOku(ctx.info.chanInfo));
      if (varlik.durum === "hazir") varlikYaz("hazir");
    });
    s.on("leave", (ctx) => {
      bagli.delete(ctx.info.client);
      if (varlik.durum === "hazir") varlikYaz("hazir");
    });
    let aboneSayisi = 0;
    s.on("subscribed", () => {
      olaylar.onHazir(true);
      // Varlık her (yeniden) abonelikte baştan okunur; kopukken kaçan
      // katılma/ayrılma olayları geri gelmez.
      const sira = ++varlikSirasi;
      s.presence()
        .then((p) => {
          if (sira !== varlikSirasi) return;
          bagli.clear();
          for (const [istemci, bilgi] of Object.entries(p.clients)) {
            bagli.set(istemci, rolOku(bilgi.chanInfo));
          }
          varlikYaz("hazir");
        })
        .catch((e) => {
          if (sira !== varlikSirasi) return;
          console.warn("Ders kanalı varlığı okunamadı", e);
          varlikYaz("yok");
        });
      // Yeniden abonelikte (bağlantı koptu/geldi) SDK önbellekteki token'ı
      // kullanabilir; kopukken kaçan aç/kapa yayını geçmiş kapalı olduğu için
      // gelmez — son durum sunucudan yeniden okunur.
      if (++aboneSayisi > 1) {
        void getTahtaToken(dersId)
          .then((d) => {
            if (!kapandi) olaylar.onTahta(d.tahta_acik);
          })
          .catch(() => {});
      }
      for (const f of aboneDinleyicileri) f();
    });
    s.on("publication", (ctx) => {
      const veri = ctx.data as unknown;
      const v = veri as { t?: unknown; acik?: unknown };
      // Aç/kapa YALNIZ sunucu yayınından (istemci bilgisi taşımayan).
      if (v?.t === "tahta") {
        if (!ctx.info && typeof v.acik === "boolean") olaylar.onTahta(v.acik);
        return;
      }
      if (ctx.info?.client && ctx.info.client === benimIstemci) return;
      // Tepki/el: tahta çözücüsüne gitmez.
      if (ODA_MESAJLARI.has(v?.t)) {
        const kanalRolu = rolOku(ctx.info?.chanInfo);
        for (const f of odaDinleyicileri) f(veri, kanalRolu);
        return;
      }
      const g: Gonderen = {
        istemci: ctx.info?.client ?? "",
        ogretmen: (ctx.info?.chanInfo as { rol?: unknown } | undefined)?.rol === "ogretmen",
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
    odaYayinla: async (veri) => {
      if (!sub || sub.state !== "subscribed") return false;
      try {
        await sub.publish(veri);
        return true;
      } catch {
        return false;
      }
    },
    odaDinle: (f) => {
      odaDinleyicileri.add(f);
      return () => odaDinleyicileri.delete(f);
    },
    varlik: () => varlik,
    varlikDinle: (f) => {
      varlikDinleyicileri.add(f);
      return () => varlikDinleyicileri.delete(f);
    },
    kapat: () => {
      kapandi = true;
      varlikDinleyicileri.clear();
      dinleyiciler.clear();
      aboneDinleyicileri.clear();
      odaDinleyicileri.clear();
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
