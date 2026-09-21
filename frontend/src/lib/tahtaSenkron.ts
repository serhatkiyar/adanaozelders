/* ──────────────────────────────────────────────────────────────────────────
 * TAHTA SENKRONİZASYONU — protokol ve saf yardımcılar
 * (React/LiveKit/Excalidraw'dan bağımsız)
 *
 * İki elemanın ÇAKIŞMASINI çözen kısım burada DEĞİL: onu paketin kendi
 * `reconcileElements`i yapıyor (`TahtaPaneli` doğrudan çağırıyor). Burada
 * kalan, paketin kapsamadığı ve bize özgü olan üç şey var:
 *
 *   1. tel üstündeki mesaj biçimi ve onu güvenle çözmek,
 *   2. "karşı tarafın bildiği sürüm" defteri — EKO DÖNGÜSÜNÜ kıran mekanizma,
 *   3. bir elemanı yayılabilir bir MEZAR TAŞINA çevirmek (silgi bu yolla gider).
 *
 * Saf tutulmalarının sebebi: bu üçü ancak iki gerçek tarayıcıyla elle
 * görülebilir, yani sessizce bozulur. Saf oldukları için birim testi var.
 * ────────────────────────────────────────────────────────────────────────── */

/** LiveKit veri akışı konusu. Odadaki diğer trafikle karışmasın diye tekil. */
export const TAHTA_KONU = "tahta";

/**
 * PDF sayfasına BAĞLI OLMAYAN katman.
 *
 * Bir PDF açılmadan önce çizilenler ve tahtanın "boş" hâli buraya etiketlenir;
 * bunlar her sayfada görünür kalır. Aksi hâlde ilk PDF açıldığı anda o ana
 * kadar çizilen her şey sessizce kaybolurdu.
 */
export const SERBEST_SAYFA = "serbest";

/** Sayfa numarasını eleman etiketine çevirir. */
export function sayfaAnahtari(sayfaNo: number): string {
  return `s${sayfaNo}`;
}

/** Bir Excalidraw elemanının senkronizasyon için gereken asgari yüzeyi. */
export type TahtaEleman = {
  id: string;
  version: number;
  versionNonce?: number;
  isDeleted?: boolean;
  /** Excalidraw'ın uygulamaya açık alanı; sayfa etiketini burada taşıyoruz. */
  customData?: { tahtaSayfa?: string } | null;
};

/** Excalidraw `BinaryFileData` ile aynı şekil (PDF sayfası görüntüsü). */
export type TahtaDosya = {
  id: string;
  dataURL: string;
  mimeType: string;
  created: number;
};

/**
 * Tel üstündeki mesajlar.
 *
 * Bilerek TEK bir içerik mesajı var: "yalnız değişenler" ile "tam sahne"
 * arasında fark yoktur, çünkü birleştirme sürüme bakar. Bu sayede geç
 * katılan birine tam sahne göndermek ayrı bir kod yolu değildir.
 */
export type TahtaMesaji =
  | { t: "durum"; elemanlar: TahtaEleman[]; dosyalar?: TahtaDosya[]; sayfa?: string }
  | { t: "istek" }
  | { t: "temizle" };

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
  return s === null || s === SERBEST_SAYFA || s === aktifSayfa;
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

/** Ağdan gelen metni güvenle mesaja çevirir; tanımadığını yutar. */
export function mesajCoz(metin: string): TahtaMesaji | null {
  let ham: unknown;
  try {
    ham = JSON.parse(metin);
  } catch {
    return null;
  }
  if (!ham || typeof ham !== "object") return null;
  const t = (ham as { t?: unknown }).t;
  if (t === "istek" || t === "temizle") return { t };
  if (t !== "durum") return null;
  const elemanlar = (ham as { elemanlar?: unknown }).elemanlar;
  if (!Array.isArray(elemanlar)) return null;
  const temiz = elemanlar.filter(
    (e): e is TahtaEleman =>
      !!e &&
      typeof e === "object" &&
      typeof (e as TahtaEleman).id === "string" &&
      typeof (e as TahtaEleman).version === "number"
  );
  const dosyalarHam = (ham as { dosyalar?: unknown }).dosyalar;
  const dosyalar = Array.isArray(dosyalarHam)
    ? dosyalarHam.filter(
        (d): d is TahtaDosya =>
          !!d &&
          typeof d === "object" &&
          typeof (d as TahtaDosya).id === "string" &&
          typeof (d as TahtaDosya).dataURL === "string"
      )
    : undefined;
  const sayfaHam = (ham as { sayfa?: unknown }).sayfa;
  const sayfa = typeof sayfaHam === "string" ? sayfaHam : undefined;
  const mesaj: TahtaMesaji = { t: "durum", elemanlar: temiz };
  if (dosyalar && dosyalar.length > 0) mesaj.dosyalar = dosyalar;
  if (sayfa) mesaj.sayfa = sayfa;
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
  bilinen: ReadonlyMap<string, number>
): E[] {
  return elemanlar.filter((e) => bilinen.get(e.id) !== e.version);
}

/** `bilinen` haritasını verilen elemanların sürümleriyle günceller. */
export function surumleriYaz(
  elemanlar: readonly TahtaEleman[],
  bilinen: Map<string, number>
): void {
  for (const e of elemanlar) bilinen.set(e.id, e.version);
}

