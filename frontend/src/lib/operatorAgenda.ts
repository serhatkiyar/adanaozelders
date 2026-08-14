// Kütüphane operatörü panelinin "bugün" ve gün gruplaması mantığı (saf, Vitest'li).
//
// ## Neden ayrı bir dosya
//
// Operatörün gördüğü gün sınırı **tarayıcının saat dilimine bağlanamaz**.
// Kütüphane Adana'dadır; panel bir VPS'ten, seyahatteki bir telefondan ya da
// tz'i UTC'ye ayarlı bir laptop'tan açılabilir. `new Date().getDate()` ile
// hesaplanan "bugün", gece yarısı civarında bir gün kayar ve 23:30'daki
// rezervasyon "yarın" görünür — kapıda bekleyen öğrenci listede olmaz.
//
// Bu yüzden gün anahtarı TEK bir yerde, `Europe/Istanbul` üzerinden üretilir
// ve sayfalar bu dosyayı çağırır. Aynı karar backend'de de vardır
// (`APP_UTC_OFFSET_HOURS=3`, kütüphane "şu an açık mı" hesabı Europe/Istanbul);
// `lib/datetime.ts::istanbulNow` da aynı deseni kullanır.
//
// Fonksiyonlar `simdi`yi PARAMETRE alır: test edilebilirlik için değil, aynı
// render içinde iki farklı "şimdi" oluşmasın diye (liste bir saniyeyle
// bölünmüş iki güne düşmesin).

/** Gün kovaları — ekrandaki grup başlıklarının kimliği. */
export type GunKovasi = "GECMIS" | "BUGUN" | "YARIN" | "BU_HAFTA" | "DAHA_SONRA";

export interface AjandaKaydi {
  /** ISO 8601 (backend UTC döner). */
  startsAt: string;
  /** Varsa pencere sonu; yoksa `startsAt` kullanılır. */
  endsAt?: string | null;
  /** Ödeme/katılım durumu (`PAID` / `ATTENDED` …) — sayaçlar için. */
  status?: string;
}

export interface AjandaGrubu<T> {
  kova: GunKovasi;
  label: string;
  items: T[];
}

export interface BugunOzeti<T> {
  /** Bugüne düşen kayıt sayısı. */
  toplam: number;
  /** Bugünkülerden girişi doğrulanmış olanlar. */
  giren: number;
  /** Bugünkülerden hâlâ beklenenler. */
  bekleyen: number;
  /** Şu andan sonraki en erken bugünkü kayıt; hepsi geçmişse `null`. */
  siradaki: T | null;
}

/** "Bu hafta" kovasının genişliği: bugünden itibaren kayan 7 günlük pencere.
 *  Takvim haftası DEĞİL — Pazar akşamı "bu hafta" grubunun boşalması,
 *  operatöre haftanın bittiğini değil listenin bozulduğunu düşündürür. */
const HAFTA_PENCERESI_GUN = 7;

const ETIKET: Record<GunKovasi, string> = {
  GECMIS: "Geçmiş",
  BUGUN: "Bugün",
  YARIN: "Yarın",
  BU_HAFTA: "Bu hafta",
  DAHA_SONRA: "Daha sonra",
};

/** Kovaların ekranda görüneceği sıra. */
const SIRA: GunKovasi[] = ["BUGUN", "YARIN", "BU_HAFTA", "DAHA_SONRA"];

const gunBicimi = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Bir anı Türkiye takvim gününe çevirir: "YYYY-MM-DD".
 *
 * `en-CA` bilinçlidir: ISO benzeri sıralanabilir çıktı verir ve dizgi
 * karşılaştırmasıyla gün sırası korunur.
 */
export function istanbulGunAnahtari(an: string | Date): string {
  const d = an instanceof Date ? an : new Date(an);
  // Bazı motorlar ayırıcı olarak ince boşluk/eğik çizgi kullanabilir; parçadan
  // kurmak biçim değişikliklerine karşı dayanıklıdır.
  const parcalar = gunBicimi.formatToParts(d);
  const al = (tur: string) => parcalar.find((p) => p.type === tur)?.value ?? "";
  return `${al("year")}-${al("month")}-${al("day")}`;
}

/** İki gün anahtarı arasındaki tam gün farkı (b - a). */
function gunFarki(a: string, b: string): number {
  const [ay, aa, ag] = a.split("-").map(Number);
  const [by, ba, bg] = b.split("-").map(Number);
  const msA = Date.UTC(ay, aa - 1, ag);
  const msB = Date.UTC(by, ba - 1, bg);
  return Math.round((msB - msA) / 86_400_000);
}

/**
 * Bir kaydın hangi gün kovasına düştüğü.
 *
 * Kural (sözleşme — `docs/ip14-operator-panel-sozlesme.md`):
 *
 * 1. Penceresi kapanmış kayıt (`endsAt ?? startsAt` < şimdi) → `GECMIS`.
 * 2. Başlangıç günü bugün ya da **daha önce** ama pencere hâlâ açık → `BUGUN`.
 *    (Gece 22:00–10:00 çalışma penceresi sabah operatörün işidir.)
 * 3. Yarın → `YARIN`. 4. Bugünden itibaren 7 gün içinde → `BU_HAFTA`.
 * 5. Ötesi → `DAHA_SONRA` (listeden DÜŞMEZ).
 */
export function gunKovasi(kayit: AjandaKaydi, simdi: Date): GunKovasi {
  const bitis = new Date(kayit.endsAt ?? kayit.startsAt).getTime();
  if (bitis < simdi.getTime()) return "GECMIS";

  const bugunKey = istanbulGunAnahtari(simdi);
  const fark = gunFarki(bugunKey, istanbulGunAnahtari(kayit.startsAt));
  if (fark <= 0) return "BUGUN";
  if (fark === 1) return "YARIN";
  if (fark <= HAFTA_PENCERESI_GUN) return "BU_HAFTA";
  return "DAHA_SONRA";
}

/**
 * Kayıtları gün kovalarına ayırır.
 *
 * - `GECMIS` kovası DÖNMEZ: uçlar geçmişi zaten eliyor, istemci de elemeli —
 *   aksi halde "yaklaşan" başlıklı listede geçmiş satır belirir.
 * - Boş kova dönmez (başlıksız grup basılmasın).
 * - Her kova kendi içinde erken→geç sıralanır.
 */
export function gunlereGrupla<T extends AjandaKaydi>(
  kayitlar: T[],
  simdi: Date
): AjandaGrubu<T>[] {
  const kovalar = new Map<GunKovasi, T[]>();
  for (const kayit of kayitlar) {
    const kova = gunKovasi(kayit, simdi);
    if (kova === "GECMIS") continue;
    const liste = kovalar.get(kova);
    if (liste) liste.push(kayit);
    else kovalar.set(kova, [kayit]);
  }

  const gruplar: AjandaGrubu<T>[] = [];
  for (const kova of SIRA) {
    const items = kovalar.get(kova);
    if (!items || items.length === 0) continue;
    items.sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
    gruplar.push({ kova, label: ETIKET[kova], items });
  }
  return gruplar;
}

/** Girişi doğrulanmış sayılan durum. Tek yerde durur: roster sayacı ile panel
 *  özeti aynı tanımı kullanmalı. */
const GIRDI = "ATTENDED";

/** "N/M giriş yapıldı" sayacı — yalnız `ATTENDED` girmiş sayılır. */
export function yoklamaSayaci(satirlar: { status?: string }[]): {
  giren: number;
  toplam: number;
} {
  let giren = 0;
  for (const s of satirlar) if (s.status === GIRDI) giren += 1;
  return { giren, toplam: satirlar.length };
}

/**
 * Bugünün özeti: kaç kayıt, kaçı girdi, sıradaki kim.
 *
 * **Sayaç ile liste bilinçli olarak farklı kapsamdadır.** Yaklaşan listesi
 * saati geçmiş kaydı göstermez (`gunlereGrupla` `GECMIS`'i eler); gün özeti
 * ise bugünün TAMAMINI sayar — akşam 20:00'de "bugün 0 rezervasyon" demek,
 * günü kapatan operatöre gerçeği söylememektir ("kaç kişi geldi, kaçı
 * gelmedi" cevabı tam olarak buradan okunur).
 *
 * "Sıradaki" ise geleceğe bakar: şu andan SONRA başlayan en erken bugünkü
 * kayıttır. Saati geçmiş bir randevuyu "sıradaki" diye göstermek, kapıdaki
 * operatöre yanlış isim söyletir; bugünün tamamı geçmişse `null` döner.
 */
export function bugunOzeti<T extends AjandaKaydi>(
  kayitlar: T[],
  simdi: Date
): BugunOzeti<T> {
  const bugunKey = istanbulGunAnahtari(simdi);
  const bugunkuler = kayitlar.filter((k) => {
    const kova = gunKovasi(k, simdi);
    if (kova === "BUGUN") return true;
    // Bugün başlamış ama penceresi kapanmış kayıt: listede değil, sayaçta var.
    return kova === "GECMIS" && istanbulGunAnahtari(k.startsAt) === bugunKey;
  });
  const { giren, toplam } = yoklamaSayaci(bugunkuler);

  let siradaki: T | null = null;
  for (const k of bugunkuler) {
    if (new Date(k.startsAt).getTime() <= simdi.getTime()) continue;
    if (
      siradaki === null ||
      new Date(k.startsAt).getTime() < new Date(siradaki.startsAt).getTime()
    ) {
      siradaki = k;
    }
  }

  return { toplam, giren, bekleyen: toplam - giren, siradaki };
}

/**
 * Bakiyem işlem dökümünün sunucu tarafı tavanı.
 *
 * `library_service.earnings_transactions(limit=200)` ve
 * `payment_service.earnings_transactions(limit=200)` — router'lar limit
 * geçirmediği için ikisi de bu değerde keser. Sayfalama bu paketin kapsamında
 * DEĞİL; ekranın yapabileceği tek dürüst şey kesildiğini söylemektir.
 */
export const ISLEM_TAVANI = 200;

/** Liste tavana dayandıysa (yani sunucu kesmiş olabilir) `true`. */
export function kesildiMi(liste: readonly unknown[]): boolean {
  return liste.length >= ISLEM_TAVANI;
}
