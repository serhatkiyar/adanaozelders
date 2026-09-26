/* ──────────────────────────────────────────────────────────────────────────
 * TAHTA SAHİPLİĞİ VE İZİN — saf kurallar (React/Excalidraw'dan bağımsız)
 *
 * Her eleman, onu OLUŞTURAN tarafın malıdır: `customData.sahip` =
 * "ogretmen" | "ogrenci". Kurallar:
 *
 *   - Herkes kendi elemanını serbestçe ekler/değiştirir/siler.
 *   - Öğretmen her şeyi değiştirebilir.
 *   - Öğrenci (tam yetkisi yoksa) öğretmenin elemanını değiştiremez: yerel
 *     değişiklik GERİ ALINIR ve öğretmene istek gider (`TahtaPaneli`).
 *   - Öğretmen istemcisi de denetler: yetkisiz öğrenci güncellemesini
 *     uygulamaz, kendi sürümünü sürümü yükseltip yeniden yayınlar.
 *   - Sahipsiz (bu özellikten önceki) eleman ve PDF zemini öğretmenindir.
 *
 * "Yerelde doğan" eleman: bu istemcide oluşan (karşıdan gelmeyen) eleman.
 * Kopyala/yapıştır, çoğalt ve "Aç" `customData`yı da kopyaladığı için
 * yerelde doğan elemanın sahibi, üstünde ne yazarsa yazsın, OLUŞTURANDIR.
 * Çizim sürerken (henüz damgalanmadan) giden kopyalara sahip, sürüm
 * artırılmadan eklenir (`gidenKopya`): karşı taraf ilk paketten bilir.
 * ────────────────────────────────────────────────────────────────────────── */
import { pdfDosyaCoz, type TahtaEleman } from "./tahtaSenkron";

export type TahtaRolu = "ogretmen" | "ogrenci";

/** İzin kararları için gereken eleman yüzeyi (Excalidraw elemanı bunu sağlar). */
export type IzinElemani = TahtaEleman & {
  type?: string;
  fileId?: string | null;
  [alan: string]: unknown;
};

export function pdfZeminiMi(e: IzinElemani): boolean {
  return e.type === "image" && typeof e.fileId === "string" && pdfDosyaCoz(e.fileId) !== null;
}

/** Elemanın sahibi. */
export function sahibi(
  e: IzinElemani,
  yerelDogan: ReadonlySet<string>,
  benimRolum: TahtaRolu,
): TahtaRolu {
  if (pdfZeminiMi(e)) return "ogretmen";
  if (yerelDogan.has(e.id)) return benimRolum;
  return e.customData?.sahip === "ogrenci" ? "ogrenci" : "ogretmen";
}

/** Kanala giden kopya: yerelde doğan elemana sahip yazılır (sürüm artmaz). */
export function gidenKopya<E extends IzinElemani>(
  e: E,
  yerelDogan: ReadonlySet<string>,
  benimRolum: TahtaRolu,
): E {
  if (!yerelDogan.has(e.id)) return e;
  const sahip = sahibi(e, yerelDogan, benimRolum);
  if (e.customData?.sahip === sahip) return e;
  return { ...e, customData: { ...(e.customData ?? {}), sahip } };
}

/**
 * Yerelde doğan elemanın kalıcı damgası gerekiyorsa (sayfa etiketi eksik ya
 * da sahip yanlış) ikisini TEK sürüm artışıyla yazar; gerekmiyorsa `null`.
 */
export function damgala<E extends IzinElemani>(
  e: E,
  aktifSayfa: string,
  yerelDogan: ReadonlySet<string>,
  benimRolum: TahtaRolu,
): E | null {
  const sayfaEksik = typeof e.customData?.tahtaSayfa !== "string";
  const sahip = yerelDogan.has(e.id) ? sahibi(e, yerelDogan, benimRolum) : null;
  const sahipYanlis = sahip !== null && e.customData?.sahip !== sahip;
  if (!sayfaEksik && !sahipYanlis) return null;
  const customData = { ...(e.customData ?? {}) };
  if (sayfaEksik) customData.tahtaSayfa = aktifSayfa;
  if (sahipYanlis && sahip) customData.sahip = sahip;
  return { ...e, customData, ...yeniSurum(e.version + 1) };
}

function yeniSurum(version: number) {
  return { version, versionNonce: Math.floor(Math.random() * 2 ** 31) };
}

/**
 * İki kopya arasında KULLANICININ gördüğü bir fark var mı?
 *
 * Sayılmayanlar: sürüm/nonce/`updated` (her dokunuşta değişir),
 * `boundElements` — öğrencinin kendi okunu öğretmenin şekline bağlaması
 * şeklin bu alanını değiştirir ama şekli değiştirmek değildir — ve `index`
 * (z-sırası anahtarı): paketin `reconcileElements`i geçersiz kesirli
 * sıraları iki tarafta da kendiliğinden yeniden yazar; sayılsaydı iki
 * istemci birbirini sonsuza dek geri çevirebilirdi. Bedeli: öğrenci
 * öğretmen elemanını yalnız öne/arkaya almayı izinsiz yapabilir. Geri al
 * sonrası içerik aynı kalıp yalnız sürüm arttığında da fark yoktur.
 */
const SAYILMAYAN = new Set(["version", "versionNonce", "updated", "boundElements", "index"]);

export function anlamliFark(a: IzinElemani, b: IzinElemani): boolean {
  const anahtarlar = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of anahtarlar) {
    if (SAYILMAYAN.has(k)) continue;
    if (!derinEsit(a[k], b[k])) return true;
  }
  return false;
}

function derinEsit(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (x === undefined || y === undefined) {
    // `customData: undefined` ile alanın hiç olmaması aynıdır.
    return (x ?? null) === (y ?? null);
  }
  if (typeof x !== "object" || typeof y !== "object" || x === null || y === null) return false;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  if (Array.isArray(x)) {
    const ya = y as unknown[];
    return x.length === ya.length && x.every((v, i) => derinEsit(v, ya[i]));
  }
  const xo = x as Record<string, unknown>;
  const yo = y as Record<string, unknown>;
  const anahtarlar = new Set([...Object.keys(xo), ...Object.keys(yo)]);
  for (const k of anahtarlar) if (!derinEsit(xo[k], yo[k])) return false;
  return true;
}

/**
 * Uzak kopya yereli EZER mi? (`reconcileElements` kuralının denetim için
 * temkinli hâli: eşit sürümde farklı nonce da "ezer" sayılır.)
 */
export function uzakEzerMi(yerel: TahtaEleman, uzak: TahtaEleman): boolean {
  if (uzak.version !== yerel.version) return uzak.version > yerel.version;
  return (uzak.versionNonce ?? 0) !== (yerel.versionNonce ?? 0);
}

/**
 * ÖĞRENCİ tarafı: sahneden deftere yazılacak elemanları ayırır.
 *
 * `onceki`: defterdeki (son bilinen) kopya. Öğretmenin elemanında yerel,
 * daha yeni ve anlamlı bir değişiklik `ret`e düşer (deftere yazılmaz; çağıran
 * isteği biriktirir ve sahneyi geri alır). Geri kalan her şey `kabul`.
 */
export function ogrenciDegisikliginiAyir<E extends IzinElemani>(
  sahne: readonly E[],
  onceki: (id: string) => E | undefined,
  yerelDogan: ReadonlySet<string>,
): { kabul: E[]; ret: E[] } {
  const kabul: E[] = [];
  const ret: E[] = [];
  for (const e of sahne) {
    const o = onceki(e.id);
    const yetkisiz =
      o !== undefined &&
      e.version > o.version &&
      sahibi(o, yerelDogan, "ogrenci") === "ogretmen" &&
      anlamliFark(o, e);
    (yetkisiz ? ret : kabul).push(e);
  }
  return { kabul, ret };
}

/**
 * ÖĞRETMEN tarafı: öğrenciden gelen (yetkisi yokken) güncellemeleri denetler.
 *
 * Öğretmenin elemanını ezecek anlamlı bir değişiklik UYGULANMAZ; o elemanın
 * öğretmendeki kopyası, gelen sürümü de aşacak şekilde sürümü artırılıp
 * `geriYayin`a konur (yayınlanınca öğrenci geri döner).
 */
export function ogretmenDenetimi<E extends IzinElemani>(
  gelen: readonly E[],
  yerel: (id: string) => E | undefined,
  yerelDogan: ReadonlySet<string>,
): { kabul: E[]; geriYayin: E[] } {
  const kabul: E[] = [];
  const geriYayin: E[] = [];
  for (const u of gelen) {
    const l = yerel(u.id);
    if (
      l !== undefined &&
      sahibi(l, yerelDogan, "ogretmen") === "ogretmen" &&
      uzakEzerMi(l, u) &&
      anlamliFark(l, u)
    ) {
      geriYayin.push({ ...l, ...yeniSurum(Math.max(l.version, u.version) + 1) });
    } else {
      kabul.push(u);
    }
  }
  return { kabul, geriYayin };
}

/**
 * ÖĞRETMEN onay verdi: önerilen kopyaları, her iki tarafta da kazanacak
 * sürümle hazırlar. Sahip önerilenden DEĞİL, öğretmendeki kopyadan alınır.
 * Öğretmende hiç olmayan eleman için öneri atlanır.
 */
export function onerileriHazirla<E extends IzinElemani>(
  oneriler: readonly E[],
  yerel: (id: string) => E | undefined,
  yerelDogan: ReadonlySet<string>,
): E[] {
  const sonuc: E[] = [];
  for (const p of oneriler) {
    const l = yerel(p.id);
    if (!l) continue;
    const sahip = sahibi(l, yerelDogan, "ogretmen");
    sonuc.push({
      ...p,
      customData: { ...(p.customData ?? {}), sahip },
      ...yeniSurum(Math.max(l.version, p.version) + 1),
    });
  }
  return sonuc;
}
