/* ──────────────────────────────────────────────────────────────────────────
 * TAHTA SENKRONİZASYONU — protokol ve saf yardımcılar
 * (React/Centrifugo/Excalidraw'dan bağımsız)
 *
 * İki elemanın ÇAKIŞMASINI çözen kısım burada DEĞİL: onu paketin kendi
 * `reconcileElements`i yapıyor (`TahtaPaneli` doğrudan çağırıyor). Burada
 * kalan, paketin kapsamadığı ve bize özgü olan şeyler:
 *
 *   1. tel üstündeki mesaj biçimi ve onu güvenle çözmek,
 *   2. "karşı tarafın bildiği sürüm" defteri — EKO DÖNGÜSÜNÜ kıran mekanizma,
 *   3. sayfa listesi (Preply sayfa denetimi: ‹ 1/3 › + ekle + sil) ve onun
 *      sürümle birleştirilmesi,
 *   4. büyük mesajın Centrifugo çerçeve sınırına göre PARÇALANMASI.
 *
 * Taşıyıcı Centrifugo `ders:{id}` kanalıdır (plan §4; Zoom komut kanalı
 * 512 karakter / 2 mesaj·sn ile tahtaya yetmez). PDF sayfa görüntüleri
 * telden GİTMEZ: PDF ders kaynağı olarak yüklenir (private/ + imzalı adres),
 * telden yalnız kaynak kimliği ve sayfa numarası gider; her taraf sayfayı
 * kendisi çizer.
 * ────────────────────────────────────────────────────────────────────────── */

/** Tahtanın ilk (ve silinemeyen tek kalan) sayfası. */
export const ILK_SAYFA = "p1";

/** Bir Excalidraw elemanının senkronizasyon için gereken asgari yüzeyi. */
export type TahtaEleman = {
  id: string;
  version: number;
  versionNonce?: number;
  isDeleted?: boolean;
  /** Excalidraw'ın uygulamaya açık alanı; sayfa etiketini burada taşıyoruz. */
  customData?: { tahtaSayfa?: string } | null;
};

/** Sayfa: boş tahta sayfası ya da bir PDF sayfası (ders kaynağı + no). */
export type TahtaSayfasi = { id: string; pdf?: { kaynak: number; no: number } };

/**
 * Sayfa listesi — YALNIZ öğretmen değiştirir (ekle/sil/geç). `surum` her
 * değişiklikte artar; iki kopyadan büyük sürümlü olan geçerlidir.
 */
export type SayfaDurumu = { liste: TahtaSayfasi[]; aktif: string; surum: number };

export const BASLANGIC_SAYFALARI: SayfaDurumu = {
  liste: [{ id: ILK_SAYFA }],
  aktif: ILK_SAYFA,
  surum: 0,
};

/**
 * Tel üstündeki mesajlar.
 *
 * Bilerek TEK bir içerik mesajı var: "yalnız değişenler" ile "tam sahne"
 * arasında fark yoktur, çünkü birleştirme sürüme bakar. Bu sayede geç
 * katılan birine tam sahne göndermek ayrı bir kod yolu değildir.
 * İmleç yalnız lazer aracı için gider (Preply: karşı tarafın imleci
 * gösterilmez, lazer görünür).
 */
export type TahtaMesaji =
  | { t: "durum"; elemanlar: TahtaEleman[]; sayfalar?: SayfaDurumu }
  | { t: "istek" }
  | { t: "lazer"; x: number; y: number; dugme: "up" | "down" }
  | { t: "lazerBitti" };

/** Elemanın bağlı olduğu sayfa; henüz etiketlenmemişse `null`. */
export function elemanSayfasi(eleman: TahtaEleman): string | null {
  const s = eleman.customData?.tahtaSayfa;
  return typeof s === "string" ? s : null;
}

/**
 * Eleman şu an gösterilen sayfada çizilmeli mi?
 *
 * Etiketsiz eleman GİZLENMEZ. Bu bilinçli bir "uçuş payı": uzaktaki katılımcı
 * çizerken eleman, kendi tarafındaki ilk yayın turunda (≈120 ms) etiketlenir;
 * o kısa aralıkta gelen kopya etiketsizdir. Gizlenseydi çizgi karşı ekranda
 * bir an yanıp sönerdi.
 */
export function gorunurMu(eleman: TahtaEleman, aktifSayfa: string): boolean {
  const s = elemanSayfasi(eleman);
  return s === null || s === aktifSayfa;
}

/**
 * Elemanın sayfa etiketi eklenmiş KOPYASINI üretir.
 *
 * Sürüm artar, çünkü bu karşı tarafa yayılması gereken gerçek bir değişikliktir.
 * Bu yüzden çağıran YALNIZ etiketsiz elemanı etiketlemelidir: her turda yeniden
 * etiketlemek sürümü sonsuza dek tırmandırır ve kanal hiç susmaz.
 */
export function sayfaEtiketle<E extends TahtaEleman>(eleman: E, sayfa: string): E {
  return {
    ...eleman,
    customData: { ...(eleman.customData ?? {}), tahtaSayfa: sayfa },
    version: eleman.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
  };
}

/** Elemanın silinmiş (mezar taşı) KOPYASI — silme karşı tarafa böyle gider. */
export function mezarTasi<E extends TahtaEleman>(eleman: E): E {
  return {
    ...eleman,
    isDeleted: true,
    version: eleman.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
  };
}

/* ── Sayfalar ─────────────────────────────────────────────────────────── */

function sayfaCoz(ham: unknown): TahtaSayfasi | null {
  if (!ham || typeof ham !== "object") return null;
  const { id, pdf } = ham as { id?: unknown; pdf?: unknown };
  if (typeof id !== "string" || !id) return null;
  if (pdf && typeof pdf === "object") {
    const { kaynak, no } = pdf as { kaynak?: unknown; no?: unknown };
    if (Number.isInteger(kaynak) && Number.isInteger(no)) {
      return { id, pdf: { kaynak: kaynak as number, no: no as number } };
    }
    return null;
  }
  return { id };
}

export function sayfaDurumuCoz(ham: unknown): SayfaDurumu | null {
  if (!ham || typeof ham !== "object") return null;
  const { liste, aktif, surum } = ham as { liste?: unknown; aktif?: unknown; surum?: unknown };
  if (!Array.isArray(liste) || typeof aktif !== "string" || typeof surum !== "number") {
    return null;
  }
  const temiz = liste.map(sayfaCoz).filter((s): s is TahtaSayfasi => s !== null);
  if (temiz.length === 0 || !temiz.some((s) => s.id === aktif)) return null;
  return { liste: temiz, aktif, surum };
}

/** İki kopyadan büyük sürümlü olan geçer; eşitse yerel kalır. */
export function sayfalariBirlestir(yerel: SayfaDurumu, gelen: SayfaDurumu): SayfaDurumu {
  return gelen.surum > yerel.surum ? gelen : yerel;
}

/** Aktif sayfanın ARDINA yeni sayfalar ekler ve ilk eklenene geçer. */
export function sayfaEkle(d: SayfaDurumu, yeni: TahtaSayfasi[]): SayfaDurumu {
  if (yeni.length === 0) return d;
  const i = d.liste.findIndex((s) => s.id === d.aktif);
  const liste = [...d.liste.slice(0, i + 1), ...yeni, ...d.liste.slice(i + 1)];
  return { liste, aktif: yeni[0].id, surum: d.surum + 1 };
}

/** Aktif sayfayı siler; tek sayfa kaldıysa silinmez. Önceki sayfaya geçer. */
export function sayfaSil(d: SayfaDurumu): SayfaDurumu {
  if (d.liste.length <= 1) return d;
  const i = d.liste.findIndex((s) => s.id === d.aktif);
  const liste = d.liste.filter((s) => s.id !== d.aktif);
  return { liste, aktif: liste[Math.max(0, i - 1)].id, surum: d.surum + 1 };
}

/** Aktif sayfayı `yon` kadar kaydırır; uçta durur. */
export function sayfaGec(d: SayfaDurumu, yon: -1 | 1): SayfaDurumu {
  const i = d.liste.findIndex((s) => s.id === d.aktif);
  const hedef = Math.min(d.liste.length - 1, Math.max(0, i + yon));
  if (hedef === i) return d;
  return { ...d, aktif: d.liste[hedef].id, surum: d.surum + 1 };
}

/** PDF sayfası zemin görüntüsünün kararlı dosya kimliği (iki tarafta aynı). */
export function pdfDosyaKimligi(kaynak: number, no: number): string {
  return `pdf-${kaynak}-${no}`;
}

export function pdfDosyaCoz(id: string): { kaynak: number; no: number } | null {
  const m = /^pdf-(\d+)-(\d+)$/.exec(id);
  return m ? { kaynak: Number(m[1]), no: Number(m[2]) } : null;
}

/* ── Mesaj çözme ──────────────────────────────────────────────────────── */

/** Ağdan gelen nesneyi güvenle mesaja çevirir; tanımadığını yutar. */
export function mesajCoz(ham: unknown): TahtaMesaji | null {
  if (typeof ham === "string") {
    try {
      ham = JSON.parse(ham);
    } catch {
      return null;
    }
  }
  if (!ham || typeof ham !== "object") return null;
  const t = (ham as { t?: unknown }).t;
  if (t === "istek" || t === "lazerBitti") return { t };
  if (t === "lazer") {
    const { x, y, dugme } = ham as { x?: unknown; y?: unknown; dugme?: unknown };
    if (typeof x !== "number" || typeof y !== "number") return null;
    return { t, x, y, dugme: dugme === "down" ? "down" : "up" };
  }
  if (t !== "durum") return null;
  const elemanlar = (ham as { elemanlar?: unknown }).elemanlar;
  if (!Array.isArray(elemanlar)) return null;
  const temiz = elemanlar.filter(
    (e): e is TahtaEleman =>
      !!e &&
      typeof e === "object" &&
      typeof (e as TahtaEleman).id === "string" &&
      typeof (e as TahtaEleman).version === "number",
  );
  const mesaj: TahtaMesaji = { t: "durum", elemanlar: temiz };
  const sayfalar = sayfaDurumuCoz((ham as { sayfalar?: unknown }).sayfalar);
  if (sayfalar) mesaj.sayfalar = sayfalar;
  return mesaj;
}

/**
 * Karşı tarafın HENÜZ bilmediği elemanlar.
 *
 * `bilinen` "karşı tarafta olduğuna inandığım sürüm" haritasıdır. Eko
 * döngüsünü kıran şey budur: uzaktan gelen bir eleman uygulandığında sürümü
 * bu haritaya yazılır, dolayısıyla Excalidraw'ın bunu takip eden `onChange`
 * çağrısı hiçbir fark üretmez ve geri yayın yapılmaz.
 */
export function degisenler<E extends TahtaEleman>(
  elemanlar: readonly E[],
  bilinen: ReadonlyMap<string, number>,
): E[] {
  return elemanlar.filter((e) => bilinen.get(e.id) !== e.version);
}

/** `bilinen` haritasını verilen elemanların sürümleriyle günceller. */
export function surumleriYaz(elemanlar: readonly TahtaEleman[], bilinen: Map<string, number>): void {
  for (const e of elemanlar) bilinen.set(e.id, e.version);
}

/* ── Parçalama ────────────────────────────────────────────────────────── */

/**
 * Tek parçanın en büyük metin uzunluğu.
 *
 * Centrifugo v6 WebSocket çerçeve sınırı varsayılan 65 536 bayttır
 * (`websocket.message_size_limit`). Parça JSON içinde DİZE olarak gider ve
 * kaçışla (`"` → `\"`) en kötü durumda ikiye katlanır; 24 000 karakter +
 * zarf bu sınırın güvenle altındadır. (Türkçe karakter UTF-8'de 2 bayt: en
 * kötü durum yine ~48 KB.)
 */
export const PARCA_BOYU = 24_000;

export type ParcaMesaji = { t: "parca"; k: string; i: number; n: number; v: string };

/** Metni parçalara böler; sığıyorsa tek parça bile üretmez (`null`). */
export function parcala(metin: string, kimlik: string, boy = PARCA_BOYU): ParcaMesaji[] | null {
  if (metin.length <= boy) return null;
  const n = Math.ceil(metin.length / boy);
  return Array.from({ length: n }, (_, i) => ({
    t: "parca" as const,
    k: kimlik,
    i,
    n,
    v: metin.slice(i * boy, (i + 1) * boy),
  }));
}

export function parcaMi(ham: unknown): ham is ParcaMesaji {
  if (!ham || typeof ham !== "object") return false;
  const p = ham as Partial<ParcaMesaji>;
  return (
    p.t === "parca" &&
    typeof p.k === "string" &&
    Number.isInteger(p.i) &&
    Number.isInteger(p.n) &&
    typeof p.v === "string" &&
    (p.n as number) > 0 &&
    (p.n as number) <= 1000 &&
    (p.i as number) >= 0 &&
    (p.i as number) < (p.n as number)
  );
}

/**
 * Parçaları gönderen + kimlik başına toplar; tamamlanınca metni döndürür.
 * Yarım kalan (bir parçası düşmüş) mesaj `SURE_MS` sonra atılır — periyodik
 * tam sahne yayını zaten toparlar.
 */
export class ParcaToplayici {
  private bekleyen = new Map<string, { parcalar: (string | undefined)[]; gelen: number; zaman: number }>();

  constructor(private readonly sureMs = 30_000) {}

  ekle(gonderen: string, p: ParcaMesaji, simdi = Date.now()): string | null {
    for (const [k, b] of this.bekleyen) {
      if (simdi - b.zaman > this.sureMs) this.bekleyen.delete(k);
    }
    const anahtar = `${gonderen}|${p.k}`;
    let b = this.bekleyen.get(anahtar);
    if (!b || b.parcalar.length !== p.n) {
      b = { parcalar: new Array(p.n), gelen: 0, zaman: simdi };
      this.bekleyen.set(anahtar, b);
    }
    if (b.parcalar[p.i] === undefined) {
      b.parcalar[p.i] = p.v;
      b.gelen += 1;
    }
    if (b.gelen < p.n) return null;
    this.bekleyen.delete(anahtar);
    return b.parcalar.join("");
  }
}
