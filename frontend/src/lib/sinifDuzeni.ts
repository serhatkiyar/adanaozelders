/**
 * Canlı ders sahnesinin DÜZENİ — Preply sınıfının birebir kuralları
 * (spesifikasyon `preply-sinif-tahta-duzen.md` §2, §3, §6). Saf: React,
 * Zoom ve Excalidraw'dan bağımsız; birim testi `sinifDuzeni.test.ts`.
 *
 * - `gorunumSec` = Preply `rT` (düzen kararı) birebir.
 * - `yerlesimHesapla` = Preply panel oranları (`$v`, `cy`/`dy`, `sy`, `ry`)
 *   ve yüzen kutu kuralları; sahne ölçüsünden PİKSEL dikdörtgenleri üretir.
 *
 * Neden `react-resizable-panels` değil (spesifikasyon §8.1'den farklı):
 * Zoom oyuncuları (`video-player-container`) başka bir panelin DOM'una
 * taşınırsa yeniden kurulur ve görüşme kopar (plan §2). Bu yüzden her şey
 * aynı ebeveynde kalır, yalnız hesaplanan dikdörtgenlerle yer değiştirir.
 *
 * Yüzen kamera kutusunun köşe/boyut/küçültme kuralları `kameraKutusu.ts`te.
 */
import {
  BALON,
  HAP,
  koseAlani,
  koseEsle,
  koseKutusu,
  kutuOlcusu,
  serbestKonumSinirla,
  seritYerlesimi,
  videoKalitesi,
  type Boyut,
  type Kose,
  type KoseAlani,
  type KoseBaglami,
  type VideoKalitesi,
} from "./kameraKutusu";

export type Gorunum = "SPOTLIGHT" | "GRID" | "SIDEBAR" | "CORNER";
export type VideoGorunumu = Extract<Gorunum, "SPOTLIGHT" | "GRID">;
export type AracGorunumu = Extract<Gorunum, "SIDEBAR" | "CORNER">;

/** Preply `TC()`: küçük ekran = `innerWidth < 1023`. */
export const KUCUK_EKRAN_PX = 1023;

/**
 * Preply `rT` — görünüm kararı.
 *
 * `mobilKucuk` = küçük ekran VE telefon/tablet (Preply: `smallScreen &&
 * (mobile||tablet)`). Masaüstü tarayıcıda dar pencere yine seçilebilir kalır.
 * Salt görüntü modu (öğrenci mobil uygulamada) bizde yok.
 */
export function gorunumSec(g: {
  paylasim: boolean;
  aracAcik: boolean;
  mobilKucuk: boolean;
  sonVideo: VideoGorunumu | null;
  sonArac: AracGorunumu | null;
}): Gorunum {
  const bolunmus = g.paylasim && g.aracAcik;
  const tekArac = g.paylasim !== g.aracAcik;
  if (bolunmus) return "SPOTLIGHT";
  if (tekArac) {
    if (g.mobilKucuk) return "SPOTLIGHT";
    // Varsayılan Köşe: tahta da paylaşım da sahneyi alır, videolar yüzen
    // kutuda (Meet/LiveKit gibi). Kullanıcının son seçimi önce gelir.
    return g.sonArac ?? "CORNER";
  }
  return g.sonVideo ?? "SPOTLIGHT";
}

/** Seçim menüsünün sunduğu modlar; bölünmüş görünümde menü yok. */
export function secilebilirGorunumler(paylasim: boolean, aracAcik: boolean): Gorunum[] {
  if (paylasim && aracAcik) return [];
  if (paylasim || aracAcik) return ["SIDEBAR", "CORNER"];
  return ["SPOTLIGHT", "GRID"];
}

/* ── Ölçüler (spesifikasyon §1, §3) ─────────────────────────────────────── */

/** Sahne kenar boşluğu (Preply sahnesi x12, W−24). */
export const SAHNE_BOSLUGU = 12;
/** Görünmez bölme tutamacı genişliği. */
export const BOLME = 4;
/** Video yan paneli en az 240px, en çok %50. */
export const YAN_PANEL_EN_AZ = 240;
export const YAN_PANEL_EN_COK_ORAN = 0.5;
/** Bölünmüş görünüm %50/50, sürükleme %35–65; küçük ekranda 65/35. */
export const BOLUNMUS_EN_AZ = 35;
export const BOLUNMUS_EN_COK = 65;
/** Kenar çubuğunda videoları gizle/göster düğmesi (dikey tutamak). */
export const DARALT_GENISLIK = 24;
export const DARALT_YUKSEKLIK = 48;
/** Araçsız SPOTLIGHT: kendi karon 160×120 (telefon dikeyde 90×120), 16px içeride. */
export const KENDI_KARO = { genislik: 160, yukseklik: 120 } as const;
export const KENDI_KARO_DIKEY = { genislik: 90, yukseklik: 120 } as const;
export const KENDI_KARO_BOSLUK = 16;
/** Kareler ve yan panel karoları arası boşluk. */
export const KARO_ARASI = 12;
/** Yan panel liste kabının sol dolgusu. */
export const YAN_PANEL_DOLGU = 8;

export type Kutu = { x: number; y: number; w: number; h: number };
export type Nokta = { x: number; y: number };
/** Uygulama içi odak: bu araç tüm sahneyi alır (yalnız bakan kişide). */
export type Odak = "tahta" | "paylasim";

export interface YerlesimGirdisi {
  /** Sahnenin (video + araç + paylaşım alanı) ölçüsü. */
  genislik: number;
  yukseklik: number;
  gorunum: Gorunum;
  paylasim: boolean;
  aracAcik: boolean;
  karsiTarafVar: boolean;
  /** Telefon (UA + dokunmatik), dikey mi. */
  telefon: boolean;
  dikey: boolean;
  /** Öğrenci telefondayken bölünmüş görünümde araç gizlenir (`isRightPanelHidden`). */
  ogrenciTelefon: boolean;
  /** Pencere küçük ekran mı (`innerWidth < 1023`). */
  kucukEkran: boolean;
  /** Pencere dikey mi (`innerHeight > innerWidth`, Preply `ry`). */
  pencereDikey: boolean;
  /**
   * Kullanıcının sürüklediği yan panel genişliği, grubun ORANI olarak (Preply
   * yüzde tutar: sohbet açılınca grup daralır, oran korunur) ya da varsayılan.
   */
  yanPanelOrani: number | null;
  /** Kullanıcının sürüklediği bölünmüş oran (paylaşım %) ya da varsayılan. */
  bolunmusOran: number | null;
  /** Araçsız SPOTLIGHT'ta kendi karonun başlangıçtan kayması. */
  surukleme: Nokta;
  /**
   * Kenar çubuğunda videolar gizli mi. Yalnız `SIDEBAR` + tahta + paylaşım
   * yokken uygulanır; diğer düzenlerde yok sayılır.
   */
  videolarGizli?: boolean;
  /** Yüzen kutunun saklanan köşesi (cihaz türüne göre); `null` = bağlam varsayılanı. */
  kose?: Kose | null;
  /** Yüzen kutunun hazır boyutu (varsayılan orta). */
  boyut?: Boyut;
  /** Yüzen kutu küçültüldü mü (masaüstü hap, telefon balon). */
  kucuk?: boolean;
  /**
   * Kendi görüntümü YALNIZ kendi ekranımda gizle; kamera yayını sürer. Karşı
   * taraf yokken yok sayılır (kendi karon gösterilir).
   */
  kendiGizli?: boolean;
  /** Masaüstünde sürüklenen yüzen kutunun MUTLAK sol üst noktası (sahneye göre). */
  suruklenen?: Nokta | null;
  /** `devicePixelRatio`; video kalitesi karo genişliği × dpr ile seçilir. */
  dpr?: number;
  /** Uygulama içi odak; açık olmayan araç için verilirse yok sayılır. */
  odak?: Odak | null;
}

export interface Yerlesim {
  grup: Kutu;
  paylasim: Kutu | null;
  arac: Kutu | null;
  /** Video karolarının içinde durduğu alan (oyuncu kabı bu dikdörtgendir). */
  video: Kutu;
  /** Karolar, `video` alanına GÖRE değil SAHNEYE göre. */
  karsiKaro: Kutu | null;
  benKaro: Kutu;
  yuzen: boolean;
  /** Sürüklenebilir öğe: yüzen kutu (masaüstü) ya da araçsız kendi karon. */
  suruklenebilir: "yuzen" | "benKaro" | null;
  /**
   * YALNIZ araçsız kendi karon için kayma sınırı (`surukleme` ile). Yüzen
   * kutu köşe + mutlak konumla çalışır: bkz. `serbestAlan`, `koseAlani`.
   */
  suruklemeSiniri: { min: Nokta; max: Nokta } | null;
  /** Sürüklenebilir bölme: yön ve konumu, değer aralığı. */
  bolme:
    | {
        tur: "yanPanel";
        kutu: Kutu;
        enAz: number;
        enCok: number;
        deger: number;
      }
    | {
        tur: "bolunmus";
        kutu: Kutu;
        yon: "yatay" | "dikey";
        enAz: number;
        enCok: number;
        deger: number;
      }
    | null;
  /** Bölünmüş görünüm dikey mi (Preply `ry`). */
  bolunmusDikey: boolean;
  /** Karo avatar çapı (kamera kapalıyken), karo başına. */
  benAvatar: number;
  karsiAvatar: number;
  /**
   * Kenar çubuğunda "Videoları gizle/göster" düğmesi: açıkken bölmenin
   * solunda, gizliyken sahnenin sağ kenarında dikey ortada. Diğer
   * düzenlerde `null`.
   */
  daraltDugmesi: { kutu: Kutu; gizli: boolean } | null;
  /**
   * Karo ekranda görünüyor mu (sahne dışındaki 1×1 değil). YALNIZ yerel
   * çizimi belirler: `benGorunur` false iken de kamera yayını sürer.
   */
  benGorunur: boolean;
  /** Karşı taraf var ve karosu görünüyor; false iken karşı video durdurulabilir. */
  karsiGorunur: boolean;
  /** Karo genişliği × dpr'den istenecek kalite (gecikme/histerezis çağıranda). */
  benKalite: VideoKalitesi;
  karsiKalite: VideoKalitesi;
  /** Küçültülmüş yüzen kutu: masaüstü hap, telefon balon; aynı köşeye yaslı. */
  kucukHal: { tur: "hap" | "balon"; kutu: Kutu } | null;
  /** Yüzen kutunun uygulanan (izinliye eşlenmiş) köşesi; yüzen değilse `null`. */
  kose: Kose | null;
  /** Yüzen kutunun köşe alanı ve izinli köşeler (bırakınca `enYakinKose`). */
  koseAlani: KoseAlani | null;
  /** Masaüstü serbest sürüklemenin sınırı (`serbestKonumSinirla`). */
  serbestAlan: Kutu | null;
  /** Telefonda kutu köşeler arasında kaydırılır (serbest sürükleme yok). */
  kaydirilabilir: boolean;
  /** Uygulanan odak (araç açık değilse `null`). */
  odak: Odak | null;
}

type Turetilen =
  | "benGorunur"
  | "karsiGorunur"
  | "benKalite"
  | "karsiKalite"
  | "kucukHal"
  | "kose"
  | "koseAlani"
  | "serbestAlan"
  | "kaydirilabilir"
  | "odak";
type Taslak = Omit<Yerlesim, Turetilen> &
  Partial<Pick<Yerlesim, "kucukHal" | "kose" | "koseAlani" | "serbestAlan" | "kaydirilabilir">>;

const sinirla = (d: number, a: number, b: number) => Math.min(b, Math.max(a, d));

/**
 * Yan panelin kısıtlı genişliği: en az 240px, en çok grubun %50'si. Hesap
 * İÇERİK (grup) genişliğiyle — Preply'ın `outerWidth` hatası kopyalanmadı.
 */
export function yanPanelGenisligi(grupGenisligi: number, oran: number | null): number {
  const enCok = Math.floor(grupGenisligi * YAN_PANEL_EN_COK_ORAN);
  const enAz = Math.min(YAN_PANEL_EN_AZ, enCok);
  const istenen = oran === null ? YAN_PANEL_EN_AZ : Math.round(oran * grupGenisligi);
  return sinirla(istenen, enAz, enCok);
}

/** Bölünmüş görünümde paylaşımın yüzdesi (varsayılan 50; küçük ekranda 65). */
export function bolunmusOrani(kucukEkran: boolean, istenen: number | null): number {
  const varsayilan = kucukEkran ? BOLUNMUS_EN_COK : 50;
  return sinirla(istenen ?? varsayilan, BOLUNMUS_EN_AZ, BOLUNMUS_EN_COK);
}

/** Avatar çapı (Preply `$c`, `el`). */
function avatarlar(gorunum: Gorunum, aracVar: boolean): { ben: number; karsi: number } {
  if (aracVar || gorunum === "CORNER") return { ben: 32, karsi: 32 };
  if (gorunum === "SPOTLIGHT") return { ben: 48, karsi: 96 };
  return { ben: 96, karsi: 96 };
}

export function yerlesimHesapla(g: YerlesimGirdisi): Yerlesim {
  const B = SAHNE_BOSLUGU;
  const dpr = g.dpr ?? 1;
  const odak: Odak | null =
    g.odak === "tahta" && g.aracAcik
      ? "tahta"
      : g.odak === "paylasim" && g.paylasim
        ? "paylasim"
        : null;
  // Odakta araç tüm sahneyi alır: 12px kenar boşlukları kalkar.
  const grup: Kutu = odak
    ? { x: 0, y: 0, w: Math.max(0, g.genislik), h: Math.max(0, g.yukseklik) }
    : { x: B, y: B, w: Math.max(0, g.genislik - 2 * B), h: Math.max(0, g.yukseklik - B) };
  const aracVar = g.aracAcik || g.paylasim;
  const bolunmus = g.paylasim && g.aracAcik && !odak;
  const bolunmusDikey = bolunmus && g.gorunum !== "SIDEBAR" && g.pencereDikey;
  const av = avatarlar(g.gorunum, aracVar);
  // Kendi görüntümü gizle yalnız karşı taraf varken uygulanır.
  const kendiGizle = Boolean(g.kendiGizli) && g.karsiTarafVar;
  // Gizlenen kaplar 0×0 YAPILMAZ (Zoom çizimi durdurabilir): 1×1 olarak
  // sahnenin sağ kenarının dışında (kırpılır) tutulur.
  const disari: Kutu = { x: g.genislik + 1, y: grup.y, w: 1, h: 1 };
  const gorunurMu = (k: Kutu | null) => k !== null && k.w > 1 && k.h > 1 && k.x < g.genislik;

  /** Tüm dallar buradan döner: görünürlük ve kalite son karolardan türetilir. */
  const bitir = (t: Taslak): Yerlesim => ({
    kucukHal: null,
    kose: null,
    koseAlani: null,
    serbestAlan: null,
    kaydirilabilir: false,
    ...t,
    benGorunur: gorunurMu(t.benKaro),
    karsiGorunur: g.karsiTarafVar && gorunurMu(t.karsiKaro),
    benKalite: videoKalitesi(t.benKaro.w, dpr),
    karsiKalite: videoKalitesi(t.karsiKaro?.w ?? 0, dpr),
    odak,
  });
  const temel = (p: { video: Kutu; karsiKaro: Kutu | null; benKaro: Kutu }): Taslak => ({
    grup,
    paylasim: null,
    arac: null,
    video: p.video,
    karsiKaro: p.karsiKaro,
    benKaro: p.benKaro,
    yuzen: false,
    suruklenebilir: null,
    suruklemeSiniri: null,
    bolme: null,
    bolunmusDikey: false,
    benAvatar: av.ben,
    karsiAvatar: av.karsi,
    daraltDugmesi: null,
  });

  // ── Araçsız: SPOTLIGHT / GRID ──
  if (!aracVar) {
    if (g.gorunum === "GRID") {
      if (!g.karsiTarafVar) {
        return bitir(temel({ video: grup, karsiKaro: null, benKaro: grup }));
      }
      if (kendiGizle) return bitir(temel({ video: grup, karsiKaro: grup, benKaro: disari }));
      const yarim = (grup.w - KARO_ARASI) / 2;
      return bitir(
        temel({
          video: grup,
          benKaro: { x: grup.x, y: grup.y, w: yarim, h: grup.h },
          karsiKaro: { x: grup.x + yarim + KARO_ARASI, y: grup.y, w: yarim, h: grup.h },
        }),
      );
    }
    if (kendiGizle) return bitir(temel({ video: grup, karsiKaro: grup, benKaro: disari }));
    const olcu = g.telefon && g.dikey ? KENDI_KARO_DIKEY : KENDI_KARO;
    const baslangic: Nokta = {
      x: grup.x + grup.w - KENDI_KARO_BOSLUK - olcu.genislik,
      y: grup.y + KENDI_KARO_BOSLUK,
    };
    const siniri = {
      min: { x: grup.x - baslangic.x, y: grup.y - baslangic.y },
      max: {
        x: grup.x + grup.w - olcu.genislik - baslangic.x,
        y: grup.y + grup.h - olcu.yukseklik - baslangic.y,
      },
    };
    const kayma = kaymayiSinirla(g.surukleme, siniri);
    return bitir({
      ...temel({
        video: grup,
        karsiKaro: grup,
        benKaro: {
          x: baslangic.x + kayma.x,
          y: baslangic.y + kayma.y,
          w: olcu.genislik,
          h: olcu.yukseklik,
        },
      }),
      suruklenebilir: g.telefon ? null : "benKaro",
      suruklemeSiniri: g.telefon ? null : siniri,
    });
  }

  // ── Telefon yatay + yalnız tahta: videolar sağda dar şeritte ──
  if (g.telefon && !g.dikey && g.aracAcik && !g.paylasim && !odak) {
    const tekKaro = kendiGizle || !g.karsiTarafVar;
    const s = seritYerlesimi(grup, tekKaro ? 1 : 2);
    return bitir({
      ...temel({
        video: s.serit,
        benKaro: kendiGizle ? disari : s.karolar[0],
        karsiKaro: !g.karsiTarafVar ? null : kendiGizle ? s.karolar[0] : s.karolar[1],
      }),
      arac: s.arac,
    });
  }

  // ── Araçlı: paylaşım / araç / video yan paneli ──
  let paylasim: Kutu | null = null;
  let arac: Kutu | null = null;
  let video: Kutu;
  let bolme: Yerlesim["bolme"] = null;
  // Odakta kamera her zaman yüzen kutuda.
  const yuzen = odak !== null || g.gorunum !== "SIDEBAR";

  if (odak === "tahta") {
    arac = grup;
    // Paylaşım kabı 0×0 yapılmaz (Zoom çizimi durdurabilir): sahne dışında 1×1.
    paylasim = g.paylasim ? disari : null;
  } else if (odak === "paylasim") {
    paylasim = grup;
    arac = g.aracAcik ? { ...grup, w: 0, h: 0 } : null;
  } else if (bolunmus) {
    if (g.ogrenciTelefon) {
      paylasim = grup;
      arac = { ...grup, w: 0, h: 0 };
    } else if (bolunmusDikey) {
      const oran = bolunmusOrani(g.kucukEkran, g.bolunmusOran);
      const ph = Math.round(((grup.h - BOLME) * oran) / 100);
      paylasim = { x: grup.x, y: grup.y, w: grup.w, h: ph };
      arac = { x: grup.x, y: grup.y + ph + BOLME, w: grup.w, h: grup.h - ph - BOLME };
      bolme = {
        tur: "bolunmus",
        yon: "dikey",
        kutu: { x: grup.x, y: grup.y + ph, w: grup.w, h: BOLME },
        enAz: BOLUNMUS_EN_AZ,
        enCok: BOLUNMUS_EN_COK,
        deger: oran,
      };
    } else {
      const oran = bolunmusOrani(g.kucukEkran, g.bolunmusOran);
      const pw = Math.round(((grup.w - BOLME) * oran) / 100);
      paylasim = { x: grup.x, y: grup.y, w: pw, h: grup.h };
      arac = { x: grup.x + pw + BOLME, y: grup.y, w: grup.w - pw - BOLME, h: grup.h };
      bolme = {
        tur: "bolunmus",
        yon: "yatay",
        kutu: { x: grup.x + pw, y: grup.y, w: BOLME, h: grup.h },
        enAz: BOLUNMUS_EN_AZ,
        enCok: BOLUNMUS_EN_COK,
        deger: oran,
      };
    }
  } else {
    let icerik: Kutu = grup;
    if (!yuzen) {
      const yp = yanPanelGenisligi(grup.w, g.yanPanelOrani);
      icerik = { x: grup.x, y: grup.y, w: grup.w - yp - BOLME, h: grup.h };
      bolme = {
        tur: "yanPanel",
        kutu: { x: grup.x + icerik.w, y: grup.y, w: BOLME, h: grup.h },
        enAz: Math.min(YAN_PANEL_EN_AZ, Math.floor(grup.w * YAN_PANEL_EN_COK_ORAN)),
        enCok: Math.floor(grup.w * YAN_PANEL_EN_COK_ORAN),
        deger: yp,
      };
    }
    if (g.paylasim) paylasim = icerik;
    else arac = icerik;
  }

  if (yuzen) {
    // Bağlam: yalnız tahta görünüyorsa Excalidraw denetimleri köşeleri kısıtlar.
    // Tahta odağında da aynı denetimler durur: "odak" bağlamı yalnız paylaşımda.
    const yalnizTahta = odak === "tahta" || (!odak && g.aracAcik && !g.paylasim);
    const baglam: KoseBaglami = yalnizTahta
      ? g.telefon && g.dikey
        ? "telefonTahtaDikey"
        : "tahta"
      : g.telefon
        ? "telefonDiger"
        : odak === "paylasim"
          ? "odak"
          : bolunmus
            ? "bolunmus"
            : "paylasim";
    // Bölünmüşte kutu paylaşım panelinde durur: tahta yarısının denetimlerini
    // (kullanıcı listesi, alt çubuk, stil paneli) örtmez. Serbest sürükleme
    // yine tüm sahnede; bırakınca paylaşım panelinin köşesine döner.
    const ka = koseAlani(baglam, bolunmus && paylasim ? paylasim : grup);
    const kose = koseEsle(g.kose ?? ka.varsayilan, ka.izinli);
    const ortak = {
      grup,
      paylasim,
      arac,
      yuzen: true,
      suruklemeSiniri: null,
      bolme,
      bolunmusDikey,
      benAvatar: av.ben,
      karsiAvatar: av.karsi,
      daraltDugmesi: null,
      kose,
      koseAlani: ka,
      kaydirilabilir: g.telefon,
    } satisfies Partial<Taslak>;

    if (g.kucuk) {
      // Küçültülmüş: videolar sahne dışında (durdurulabilir), yerinde hap/balon.
      const halOlcu = g.telefon
        ? { w: BALON, h: BALON }
        : { w: HAP.genislik, h: HAP.yukseklik };
      return bitir({
        ...ortak,
        video: disari,
        benKaro: disari,
        karsiKaro: g.karsiTarafVar ? disari : null,
        suruklenebilir: null,
        kucukHal: { tur: g.telefon ? "balon" : "hap", kutu: koseKutusu(kose, ka.alan, halOlcu) },
      });
    }

    const iki = g.karsiTarafVar && !kendiGizle;
    const olcu = kutuOlcusu(g.boyut ?? "orta", iki);
    // Masaüstünde sürüklenirken sahnenin her yerine gider; bırakınca köşeye.
    const konum =
      !g.telefon && g.suruklenen
        ? serbestKonumSinirla(g.suruklenen, grup, olcu)
        : koseKutusu(kose, ka.alan, olcu);
    video = { x: konum.x, y: konum.y, w: olcu.w, h: olcu.h };
    const yarim = olcu.w / 2;
    return bitir({
      ...ortak,
      video,
      benKaro: kendiGizle ? disari : iki ? { x: video.x, y: video.y, w: yarim, h: olcu.h } : video,
      karsiKaro: !g.karsiTarafVar
        ? null
        : kendiGizle
          ? video
          : { x: video.x + yarim, y: video.y, w: yarim, h: olcu.h },
      suruklenebilir: g.telefon ? null : "yuzen",
      serbestAlan: g.telefon ? null : grup,
    });
  }

  // Kenar çubuğu + tahta: videolar gizlenebilir; araç tam genişlik alır.
  const gizlenebilir = g.gorunum === "SIDEBAR" && g.aracAcik && !g.paylasim;
  const daraltKutusu = (sagKenar: number): Kutu => ({
    x: sagKenar - DARALT_GENISLIK,
    y: grup.y + Math.round((grup.h - DARALT_YUKSEKLIK) / 2),
    w: DARALT_GENISLIK,
    h: DARALT_YUKSEKLIK,
  });
  if (gizlenebilir && g.videolarGizli) {
    return bitir({
      ...temel({ video: disari, benKaro: disari, karsiKaro: g.karsiTarafVar ? disari : null }),
      arac: grup,
      bolunmusDikey,
      daraltDugmesi: { kutu: daraltKutusu(grup.x + grup.w), gizli: true },
    });
  }

  // SIDEBAR: karolar alt alta, tam genişlik 16:9, en çok %50 − 6px.
  const yp = bolme?.tur === "yanPanel" ? bolme.deger : YAN_PANEL_EN_AZ;
  video = { x: grup.x + grup.w - yp, y: grup.y, w: yp, h: grup.h };
  const kw = Math.max(0, yp - YAN_PANEL_DOLGU);
  const kh = Math.min(Math.round((kw * 9) / 16), Math.floor(grup.h / 2 - KARO_ARASI / 2));
  const kx = video.x + YAN_PANEL_DOLGU;
  // Sıra: kendi karon üstte (yüzen kutudaki "kendi solda" sırasıyla aynı).
  // Kendi görüntün gizliyse karşı karo en üste çıkar.
  const ust: Kutu = { x: kx, y: video.y, w: kw, h: kh };
  const alt: Kutu = { x: kx, y: video.y + kh + KARO_ARASI, w: kw, h: kh };
  return bitir({
    grup,
    paylasim,
    arac,
    video,
    benKaro: kendiGizle ? disari : ust,
    karsiKaro: !g.karsiTarafVar ? null : kendiGizle ? ust : alt,
    yuzen: false,
    suruklenebilir: null,
    suruklemeSiniri: null,
    bolme,
    bolunmusDikey,
    benAvatar: av.ben,
    karsiAvatar: av.karsi,
    daraltDugmesi:
      gizlenebilir && bolme ? { kutu: daraltKutusu(bolme.kutu.x), gizli: false } : null,
  });
}

/** Kaymayı sınıra iter (pencere küçülünce kutu içeri itilir, Preply `aC`). */
export function kaymayiSinirla(k: Nokta, s: { min: Nokta; max: Nokta }): Nokta {
  return {
    x: sinirla(k.x, s.min.x, Math.max(s.min.x, s.max.x)),
    y: sinirla(k.y, s.min.y, Math.max(s.min.y, s.max.y)),
  };
}

/* ── Son seçimin hatırlanması (Preply `rw`/`to`, sessionStorage) ─────────── */

export const SON_VIDEO_ANAHTARI = "classroom_layout_view_video";
export const SON_ARAC_ANAHTARI = "classroom_layout_view_video_and_tools";
export const VIDEOLAR_GIZLI_ANAHTARI = "classroom_layout_sidebar_videos_hidden";

function oku(anahtar: string): string | null {
  try {
    return window.sessionStorage.getItem(anahtar);
  } catch {
    return null;
  }
}

export function sonVideoOku(): VideoGorunumu | null {
  const d = oku(SON_VIDEO_ANAHTARI);
  return d === "SPOTLIGHT" || d === "GRID" ? d : null;
}

export function sonAracOku(): AracGorunumu | null {
  const d = oku(SON_ARAC_ANAHTARI);
  return d === "SIDEBAR" || d === "CORNER" ? d : null;
}

export function gorunumuHatirla(g: Gorunum): void {
  try {
    if (g === "SPOTLIGHT" || g === "GRID") window.sessionStorage.setItem(SON_VIDEO_ANAHTARI, g);
    else window.sessionStorage.setItem(SON_ARAC_ANAHTARI, g);
  } catch {
    /* gizli pencere: hatırlanmaz */
  }
}

/** Kenar çubuğunda videolar gizli mi (sekmede hatırlanır; bozuk değer = hayır). */
export function videolarGizliOku(): boolean {
  return oku(VIDEOLAR_GIZLI_ANAHTARI) === "1";
}

export function videolarGizliHatirla(gizli: boolean): void {
  try {
    if (gizli) window.sessionStorage.setItem(VIDEOLAR_GIZLI_ANAHTARI, "1");
    else window.sessionStorage.removeItem(VIDEOLAR_GIZLI_ANAHTARI);
  } catch {
    /* gizli pencere: hatırlanmaz */
  }
}
