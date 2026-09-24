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
 */

export type Gorunum = "SPOTLIGHT" | "GRID" | "SIDEBAR" | "CORNER";
export type VideoGorunumu = Extract<Gorunum, "SPOTLIGHT" | "GRID">;
export type AracGorunumu = Extract<Gorunum, "SIDEBAR" | "CORNER">;

/** Preply `TC()`: küçük ekran = `innerWidth < 1023`. */
export const KUCUK_EKRAN_PX = 1023;

/**
 * Preply `rT` — görünüm kararı.
 *
 * `mobilKucuk` = küçük ekran VE telefon/tablet (Preply: `smallScreen &&
 * (mobile||tablet)`). Masaüstü tarayıcıda dar pencere yine SIDEBAR kalır.
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
    return g.sonArac ?? "SIDEBAR";
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
/** Araç başlığı 48px; yüzen kutu başlığın 8px altından başlar. */
export const ARAC_BASLIGI = 48;
export const YUZEN_UST = ARAC_BASLIGI + 8;
export const YUZEN_KENAR = 12;
/** Yüzen kutu: tek karo 200×133, iki karo 200×100 (100×100 yan yana). */
export const YUZEN_GENISLIK = 200;
export const YUZEN_TEK_YUKSEKLIK = 133;
export const YUZEN_CIFT_YUKSEKLIK = 100;
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
  /** Kullanıcının sürüklediği yan panel genişliği (px) ya da varsayılan. */
  yanPanelPx: number | null;
  /** Kullanıcının sürüklediği bölünmüş oran (paylaşım %) ya da varsayılan. */
  bolunmusOran: number | null;
  /** Yüzen kutunun / araçsız kendi karonun başlangıçtan kayması. */
  surukleme: Nokta;
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
  /** Sürüklenebilir öğe: yüzen kutu ya da araçsız kendi karon. */
  suruklenebilir: "yuzen" | "benKaro" | null;
  /** Sürükleme sınırı: kaymanın alabileceği en küçük/en büyük değer. */
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
}

const sinirla = (d: number, a: number, b: number) => Math.min(b, Math.max(a, d));

/** Yan panelin kısıtlı genişliği: en az 240px, en çok grubun %50'si. */
export function yanPanelGenisligi(grupGenisligi: number, istenen: number | null): number {
  const enCok = Math.floor(grupGenisligi * YAN_PANEL_EN_COK_ORAN);
  const enAz = Math.min(YAN_PANEL_EN_AZ, enCok);
  return sinirla(istenen ?? YAN_PANEL_EN_AZ, enAz, enCok);
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
  const grup: Kutu = {
    x: B,
    y: B,
    w: Math.max(0, g.genislik - 2 * B),
    h: Math.max(0, g.yukseklik - B),
  };
  const aracVar = g.aracAcik || g.paylasim;
  const bolunmus = g.paylasim && g.aracAcik;
  const bolunmusDikey = bolunmus && g.gorunum !== "SIDEBAR" && g.pencereDikey;
  const av = avatarlar(g.gorunum, aracVar);

  // ── Araçsız: SPOTLIGHT / GRID ──
  if (!aracVar) {
    if (g.gorunum === "GRID") {
      if (!g.karsiTarafVar) {
        return temel({ grup, video: grup, karsiKaro: null, benKaro: grup });
      }
      const yarim = (grup.w - KARO_ARASI) / 2;
      return temel({
        grup,
        video: grup,
        benKaro: { x: grup.x, y: grup.y, w: yarim, h: grup.h },
        karsiKaro: { x: grup.x + yarim + KARO_ARASI, y: grup.y, w: yarim, h: grup.h },
      });
    }
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
    return {
      ...temel({
        grup,
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
    };
  }

  // ── Araçlı: paylaşım / araç / video yan paneli ──
  let paylasim: Kutu | null = null;
  let arac: Kutu | null = null;
  let video: Kutu;
  let bolme: Yerlesim["bolme"] = null;
  const yuzen = g.gorunum !== "SIDEBAR";

  if (bolunmus) {
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
      const yp = yanPanelGenisligi(grup.w, g.yanPanelPx);
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
    const h = g.karsiTarafVar ? YUZEN_CIFT_YUKSEKLIK : YUZEN_TEK_YUKSEKLIK;
    const baslangic: Nokta = { x: grup.x + YUZEN_KENAR, y: grup.y + YUZEN_UST };
    const siniri = {
      min: { x: 0, y: 0 },
      max: {
        x: Math.max(0, grup.x + grup.w - YUZEN_KENAR - YUZEN_GENISLIK - baslangic.x),
        y: Math.max(0, grup.y + grup.h - YUZEN_KENAR - h - baslangic.y),
      },
    };
    const kayma = kaymayiSinirla(g.surukleme, siniri);
    video = { x: baslangic.x + kayma.x, y: baslangic.y + kayma.y, w: YUZEN_GENISLIK, h };
    const yarim = YUZEN_GENISLIK / 2;
    return {
      grup,
      paylasim,
      arac,
      video,
      benKaro: g.karsiTarafVar ? { x: video.x, y: video.y, w: yarim, h } : video,
      karsiKaro: g.karsiTarafVar ? { x: video.x + yarim, y: video.y, w: yarim, h } : null,
      yuzen: true,
      suruklenebilir: "yuzen",
      suruklemeSiniri: siniri,
      bolme,
      bolunmusDikey,
      benAvatar: av.ben,
      karsiAvatar: av.karsi,
    };
  }

  // SIDEBAR: karolar alt alta, tam genişlik 16:9, en çok %50 − 6px.
  const yp = bolme?.tur === "yanPanel" ? bolme.deger : YAN_PANEL_EN_AZ;
  video = { x: grup.x + grup.w - yp, y: grup.y, w: yp, h: grup.h };
  const kw = Math.max(0, yp - YAN_PANEL_DOLGU);
  const kh = Math.min(Math.round((kw * 9) / 16), Math.floor(grup.h / 2 - KARO_ARASI / 2));
  const kx = video.x + YAN_PANEL_DOLGU;
  // Sıra: kendi karon üstte (yüzen kutudaki "kendi solda" sırasıyla aynı).
  const benKaro: Kutu = { x: kx, y: video.y, w: kw, h: kh };
  const karsiKaro: Kutu | null = g.karsiTarafVar
    ? { x: kx, y: video.y + kh + KARO_ARASI, w: kw, h: kh }
    : null;
  return {
    grup,
    paylasim,
    arac,
    video,
    benKaro,
    karsiKaro,
    yuzen: false,
    suruklenebilir: null,
    suruklemeSiniri: null,
    bolme,
    bolunmusDikey,
    benAvatar: av.ben,
    karsiAvatar: av.karsi,
  };

  function temel(p: { grup: Kutu; video: Kutu; karsiKaro: Kutu | null; benKaro: Kutu }): Yerlesim {
    return {
      grup: p.grup,
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
    };
  }
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
