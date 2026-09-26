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
  /**
   * Excalidraw'ın uygulamaya açık alanı: sayfa etiketi, sahip (`tahtaIzin`)
   * ve yüklenen resmin ders kaynağı kimliği (`tahtaResim`) burada taşınır.
   */
  customData?: { tahtaSayfa?: string; sahip?: string; kaynak?: number } | null;
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
 *
 * İmleç her hareketle (en çok 10/sn) gider; karşı tarafta adıyla görünür
 * (lazer izi de bu mesajla, `arac: "laser"`).
 *
 * İzin mesajları (`lib/tahtaIzin.ts`): öğrenci öğretmenin çizimini
 * değiştirmek ya da PDF açmak istediğinde istek gider, öğretmen yanıtlar.
 * `yetki`, `izinYaniti` YALNIZ öğretmenden; istekler YALNIZ öğrenciden kabul
 * edilir (gönderen rolü sunucunun koyduğu `chanInfo`dan, `dersKanali`).
 *
 * Takip mesajları (`lib/tahtaTakip.ts`): `gorunum` görünür alanı taşır (sayfa
 * kimliği YOK: kaydırma sayfalarda ortaktır); öğretmenden gelen yalnız
 * öğrencide, öğrenciden gelen yalnız onu izleyen öğretmende uygulanır.
 * `takip` ("öğretmeni takip ediyorum / etmiyorum") YALNIZ öğrenciden;
 * `getir` ("bana dön") ve `izle` ("seni izliyorum") YALNIZ öğretmenden.
 */
export type TahtaMesaji =
  | { t: "durum"; elemanlar: TahtaEleman[]; sayfalar?: SayfaDurumu }
  | { t: "istek" }
  | { t: "imlec"; x: number; y: number; dugme: "up" | "down"; arac: "pointer" | "laser" }
  | { t: "imlecGitti" }
  | { t: "izinIstegi"; k: string; elemanlar: TahtaEleman[] }
  | { t: "pdfIstegi"; k: string; dosya: string }
  | { t: "izinYaniti"; k: string; karar: IzinKarari }
  | { t: "yetki"; tam: boolean }
  | { t: "pdfEkle"; k: string; kaynak: number }
  | { t: "gorunum"; x1: number; y1: number; x2: number; y2: number }
  | { t: "takip"; acik: boolean }
  | { t: "getir" }
  | { t: "izle"; acik: boolean };

/** Görünür alan sınırları: koordinat en çok 1e8, kenar (0, 1e7]. */
const KOORDINAT_SINIRI = 1e8;
const KENAR_SINIRI = 1e7;

/** Öğretmenin yanıtı: değişikliğe onay/ret; PDF'te "yeni sayfalarda"/"bu sayfada". */
export type IzinKarari = "onay" | "ret" | "yeni" | "bu";
const KARARLAR: ReadonlySet<unknown> = new Set(["onay", "ret", "yeni", "bu"]);

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

/** PDF açma yeri: yeni sayfalarda (listenin sonuna) ya da açık sayfada. */
export type PdfYeri = "yeni" | "bu";

/** PDF sayfasının tahta sayfa kimliği (iki tarafta aynı). */
export function pdfSayfaKimligi(kaynak: number, no: number): string {
  return `k${kaynak}-${no}`;
}

/**
 * PDF'in sayfalarını sayfa listesine yerleştirir.
 *
 * - `yeni`: bütün sayfalar listenin SONUNA eklenir, ilkine geçilir.
 * - `bu`: PDF'in 1. sayfası açık sayfanın zemini olur (sayfa kimliği ve
 *   üstündeki çizimler korunur), kalanlar hemen ardına eklenir; açık sayfa
 *   değişmez. Açık sayfanın ESKİ PDF zeminini silmek çağıranın işidir.
 */
export function pdfSayfalariniYerlestir(
  d: SayfaDurumu,
  kaynak: number,
  sayfaSayisi: number,
  yer: PdfYeri,
): SayfaDurumu {
  if (!Number.isInteger(sayfaSayisi) || sayfaSayisi < 1) return d;
  const sayfa = (no: number): TahtaSayfasi => ({
    id: pdfSayfaKimligi(kaynak, no),
    pdf: { kaynak, no },
  });
  if (yer === "yeni") {
    const yeni = Array.from({ length: sayfaSayisi }, (_, i) => sayfa(i + 1));
    return { liste: [...d.liste, ...yeni], aktif: yeni[0].id, surum: d.surum + 1 };
  }
  const i = d.liste.findIndex((s) => s.id === d.aktif);
  const kalan = Array.from({ length: sayfaSayisi - 1 }, (_, j) => sayfa(j + 2));
  const liste = [
    ...d.liste.slice(0, i),
    { id: d.aktif, pdf: { kaynak, no: 1 } },
    ...kalan,
    ...d.liste.slice(i + 1),
  ];
  return { liste, aktif: d.aktif, surum: d.surum + 1 };
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
  if (t === "istek" || t === "imlecGitti" || t === "getir") return { t };
  const v = ham as Record<string, unknown>;
  if (t === "takip" || t === "izle") {
    return typeof v.acik === "boolean" ? { t, acik: v.acik } : null;
  }
  if (t === "gorunum") return gorunumCoz(v);
  if (t === "imlec") {
    const { x, y, dugme, arac } = v;
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      t,
      x,
      y,
      dugme: dugme === "down" ? "down" : "up",
      arac: arac === "laser" ? "laser" : "pointer",
    };
  }
  if (t === "yetki") {
    return typeof v.tam === "boolean" ? { t, tam: v.tam } : null;
  }
  const k = v.k;
  const kimlikGecerli = typeof k === "string" && k.length > 0 && k.length <= 64;
  if (t === "izinYaniti") {
    if (!kimlikGecerli || !KARARLAR.has(v.karar)) return null;
    return { t, k: k as string, karar: v.karar as IzinKarari };
  }
  if (t === "pdfIstegi") {
    if (!kimlikGecerli || typeof v.dosya !== "string") return null;
    return { t, k: k as string, dosya: v.dosya.slice(0, 200) };
  }
  if (t === "pdfEkle") {
    if (!kimlikGecerli || !Number.isInteger(v.kaynak) || (v.kaynak as number) <= 0) return null;
    return { t, k: k as string, kaynak: v.kaynak as number };
  }
  if (t === "izinIstegi") {
    if (!kimlikGecerli || !Array.isArray(v.elemanlar)) return null;
    const temiz = elemanlariAyikla(v.elemanlar);
    return temiz.length > 0 ? { t, k: k as string, elemanlar: temiz } : null;
  }
  if (t !== "durum") return null;
  const elemanlar = v.elemanlar;
  if (!Array.isArray(elemanlar)) return null;
  const mesaj: TahtaMesaji = { t: "durum", elemanlar: elemanlariAyikla(elemanlar) };
  const sayfalar = sayfaDurumuCoz(v.sayfalar);
  if (sayfalar) mesaj.sayfalar = sayfalar;
  return mesaj;
}

function gorunumCoz(v: Record<string, unknown>): TahtaMesaji | null {
  const d = [v.x1, v.y1, v.x2, v.y2];
  if (!d.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= KOORDINAT_SINIRI)) {
    return null;
  }
  const [x1, y1, x2, y2] = (d as number[]).map((n) => Math.round(n * 100) / 100);
  const gecerli = (k: number) => k > 0 && k <= KENAR_SINIRI;
  if (!gecerli(x2 - x1) || !gecerli(y2 - y1)) return null;
  return { t: "gorunum", x1, y1, x2, y2 };
}

function elemanlariAyikla(elemanlar: unknown[]): TahtaEleman[] {
  return elemanlar.filter(
    (e): e is TahtaEleman =>
      !!e &&
      typeof e === "object" &&
      typeof (e as TahtaEleman).id === "string" &&
      typeof (e as TahtaEleman).version === "number",
  );
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
