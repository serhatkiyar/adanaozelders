// F30 paketleme istasyonu — sunum tarafı saf mantık (DOM'suz, ağsız).
//
// Kurallar birden çok ekranda kullanılıyor: kuyruk, paket detayı/tarama,
// geri dönüş kuyruğu ve etiket basımı. Tek yerde tutmak, dördünün zamanla
// ayrışmasını engeller (`lib/inventory.ts` ile aynı gerekçe).
//
// **Kesin karar HER ZAMAN backend'dedir** (`require_admin_permission`,
// `packing_rules`, FSM). Buradaki kapılar yalnız arayüz iyileştirmesidir:
// servisin reddedeceği butonu hiç göstermemek ve red'i sessizce yutmamak.
//
// **Bilinmeyen değer fail-closed'dır.** Backend yarın yeni bir tarama sonucu
// ya da yeni bir paket durumu eklerse ekran onu "başarılı" ya da "hazır"
// göstermez; tanımadığı şeyi hata sayar ve yazma eylemi açmaz. Sebep somut:
// tanınmayan bir durumu iyimser yorumlayan bir ekran, aynı ürünleri ikinci kez
// raftan toplatır ya da eksik kutuyu yola çıkarır.

import type { PackageStatus, ScanResult } from "@/types/packing";

/* ════════════════════════ İzin kademeleri ════════════════════════ */

export interface PackingAccess {
  canView: boolean;
  canPack: boolean;
  canManage: boolean;
}

/**
 * Paketlemenin ÜÇ kademeli izni: görüntüle → paketle → yönet.
 *
 * `adminAreaAccess` burada kullanılamaz: o `.view`/`.manage` ikilisini varsayar,
 * paketlemede ise arada `packing.pack` vardır — istasyondaki operatör tarama
 * yapar ama iade kabulü/repack/unpack gibi geri sarma işlemlerini yapamaz.
 *
 * `permissions` **undefined** ise fail-open: eski persist edilmiş bir oturumda
 * `admin_permissions` alanı hiç bulunmayabilir ve `/me` henüz tazelenmemiştir.
 * O hâlde her şeyi gösterip backend'in reddetmesine bırakmak, yetkili kişiye
 * boş ekran göstermekten iyidir — `lib/adminAccess.ts` ve `lib/inventory.ts`
 * ile AYNI sözleşme. Boş dizi (`[]`) ise "izin yok" demektir ve kapatır.
 */
export function packingAccess(permissions: string[] | undefined): PackingAccess {
  if (!permissions) return { canView: true, canPack: true, canManage: true };
  const canManage = permissions.includes("packing.manage");
  // manage/pack'i olup view'u olmayan rol tanımına karşı: üst kademe alt
  // kademeyi ima eder (backend `require_admin_permission` de böyle davranmaz —
  // orada izinler ayrı ayrı aranır — ama rol katalogunda üst kademe verilen
  // kişiye listeyi göstermemek yalnızca kullanışsızlık üretir).
  const canPack = canManage || permissions.includes("packing.pack");
  return {
    canView: canPack || permissions.includes("packing.view"),
    canPack,
    canManage,
  };
}

/* ════════════════════════ Durum ve fiziksel anlam ════════════════════════ */

/** Kullanıcıya gösterilen durum adları — ham enum ekranda görünmez. */
export const PACKAGE_STATUS_LABEL: Record<PackageStatus, string> = {
  OPEN: "Paketleniyor",
  PACKED: "Hazır",
  HANDED_OVER: "Kuryede",
  RETURN_PENDING: "Geri dönüş bekleniyor",
  RETURNED: "Depoya döndü",
  DELIVERED: "Teslim edildi",
  VOID: "İptal edildi",
};

/**
 * Paketin FİZİKSEL konumu — `services/packing_rules.PACKAGE_LOCATION`'ın
 * istemci kopyası (sözleşme §3.2).
 *
 * Kopya olması bilinçli değil, zorunlu: istemci Python modülünü import
 * edemez. Bedeli ayrışma riskidir ve `packing.test.ts`'teki dört noktalı
 * karşılaştırmayla ödenir — iki taraf ayrışırsa ekran "depoda" derken envanter
 * "kuryede" der ve kullanıcının gördüğü sayı yalan olur.
 */
const PACKAGE_LOCATION: Record<PackageStatus, string> = {
  OPEN: "ON_PREMISE", // raftan toplanıyor
  PACKED: "ON_PREMISE", // hazır, çıkış bekliyor — kurye ALMADI
  HANDED_OVER: "OFF_PREMISE", // kuryede
  RETURN_PENDING: "OFF_PREMISE", // kuryede, geri bekleniyor
  RETURNED: "ON_PREMISE", // geri geldi, okutularak doğrulandı
  DELIVERED: "CUSTOMER",
  VOID: "DISSOLVED", // paket yok; içerik rafta
};

/**
 * Paket işletmenin fiziksel kontrolünde mi?
 *
 * `string` alır (birleşim değil): sunucudan tanınmayan bir durum gelirse
 * derleme değil, çalışma anı kararı gerekir ve doğru cevap "hayır"dır —
 * "işletmede" demek, olmayan bir kutuyu sayıma dahil ederdi.
 */
export function isOnPremise(status: string): boolean {
  const tablo = PACKAGE_LOCATION as Record<string, string | undefined>;
  return tablo[status] === "ON_PREMISE";
}

/* ════════════════════════ İlerleme ════════════════════════ */

export interface PackageLineProgress {
  expected_qty: number;
  scanned_qty: number;
}

export interface PackageProgress {
  scanned: number;
  expected: number;
  remaining: number;
  complete: boolean;
}

/**
 * Paketin "kaç/kaç" ilerlemesi.
 *
 * Boş paket **complete SAYILMAZ** (`packing_rules.is_complete` ile aynı kural):
 * kalemsiz bir paket "hazır" görünürse boş kutu yola çıkar. Fazla okutulmuş
 * satır (`scanned > expected`) toplamı şişirmesin diye satır başına tavan
 * uygulanmaz — sayılar sunucudakiyle birebir aynı kalmalı ki operatör ekranda
 * gördüğü rakamla `complete` 409 gövdesindeki rakamı karşılaştırabilsin.
 */
export function packageProgress(lines: PackageLineProgress[]): PackageProgress {
  let scanned = 0;
  let expected = 0;
  for (const satir of lines) {
    scanned += satir.scanned_qty;
    expected += satir.expected_qty;
  }
  return {
    scanned,
    expected,
    remaining: Math.max(expected - scanned, 0),
    complete: lines.length > 0 && lines.every((s) => s.scanned_qty >= s.expected_qty),
  };
}

/* ════════════════════════ Tarama sonucu ════════════════════════ */

export type ScanTone = "success" | "warning" | "error";

/**
 * Sonuç kodu → ton.
 *
 * `OK_MANUAL` **uyarı**dır, başarı değil: kaçış kapısıyla kapatılmış satır
 * gerçekten okutulmuş sayılmaz ve gerekçesiyle izde durur.
 *
 * `ALREADY_COMPLETE` de hata tonundadır: adet değişmemiştir, yani operatörün
 * elindeki kalem pakete GİRMEMİŞTİR. Nötr göstermek "oldu" izlenimi verir.
 */
const TARAMA_TONU: Record<ScanResult, ScanTone> = {
  OK: "success",
  OK_MANUAL: "warning",
  WRONG_SKU: "error",
  OVER_QTY: "error",
  ALREADY_COMPLETE: "error",
  UNSCANNABLE: "error",
};

/**
 * Tarama sonucunun tonu; **bilinmeyen kod hata sayılır**.
 *
 * Uç red'i de 200 ile döndürür (sözleşme §6: red bir olaydır ve ize yazılması
 * için transaction commit edilir), yani HTTP durumu uyarı taşımaz — tonlama
 * operatörün gördüğü TEK sinyaldir. Varsayılanı "success" ya da "neutral"
 * yapmak, yeni eklenmiş bir red kodunu sessizce başarı gibi gösterirdi.
 */
export function scanResultTone(result: string): ScanTone {
  const tablo = TARAMA_TONU as Record<string, ScanTone | undefined>;
  return tablo[result] ?? "error";
}

/** Kullanıcı cümleleri — teknik enum ekranda GÖRÜNMEZ. */
const TARAMA_MESAJI: Record<ScanResult, string> = {
  OK: "Okutuldu, kaleme eklendi.",
  OK_MANUAL: "Elle doğrulandı. Gerekçe kayda geçti.",
  WRONG_SKU: "Bu ürün bu pakete ait değil. Kutuya koymayın, rafına geri bırakın.",
  OVER_QTY: "Bu üründen gereken adet zaten tamamlandı. Fazlasını koymayın.",
  ALREADY_COMPLETE: "Paketin bütün kalemleri tamamlandı. Yeni okutma alınmadı.",
  UNSCANNABLE: "Bu satır koddan okutulamıyor. Gerekçe yazarak elle doğrulayın.",
};

/**
 * Sonuç kodunun Türkçe açıklaması.
 *
 * Bilinmeyen kodda ham kod YAZILMAZ (operatöre `WRONG_SKU` demek bilgi değil,
 * gürültüdür) ama sonuç da onaylanmaz: kullanıcı işlemin geçmediğini ve ne
 * yapması gerektiğini görür.
 */
export function scanResultMessage(result: string): string {
  const tablo = TARAMA_MESAJI as Record<string, string | undefined>;
  return (
    tablo[result] ??
    "Okutma kabul edilmedi. Ekrandaki adetleri kontrol edin, gerekirse sayfayı yenileyin."
  );
}

/* ════════════════════════ Tamamlama engelleri ════════════════════════ */

export interface PackageLineBlocker extends PackageLineProgress {
  title: string;
}

export interface CompletablePackage {
  status: string;
  items: PackageLineBlocker[];
}

/**
 * "Paketi kapat"ı engelleyen sebepler — insan cümlesi olarak.
 *
 * Disabled bir buton sessiz kalmamalı: operatör NEDEN kapatamadığını ve NE
 * eksik olduğunu ekranda görmeli. Liste nihai otorite DEĞİLDİR; `complete`
 * ucu kendi doğrulamasını yapar (STALE parmak izi dahil, ki o burada
 * bilinemez).
 */
export function completeBlockers(paket: CompletablePackage): string[] {
  // Yalnız `OPEN` paket kapatılabilir (`packing_rules.PACKAGE_ACTIONS`).
  // Karşılaştırma bilinmeyen durumu da kapsar: tanınmayan bir durumda
  // "kapatılabilir" demek fail-open olurdu.
  if (paket.status !== "OPEN") {
    return [
      `Bu paket "${PACKAGE_STATUS_LABEL[paket.status as PackageStatus] ?? "bilinmeyen durum"}" durumunda; ` +
        "yalnızca paketlenmekte olan bir paket kapatılabilir.",
    ];
  }
  if (paket.items.length === 0) {
    // Sunucu da reddeder (`is_complete` boş listede false): kalemi olmayan
    // paketi kapatmak, hiçbir şey doğrulamadan "hazır" demektir.
    return ["Pakette hiç kalem yok; boş paket kapatılamaz."];
  }
  const engeller: string[] = [];
  for (const satir of paket.items) {
    const eksik = satir.expected_qty - satir.scanned_qty;
    if (eksik > 0) {
      engeller.push(
        `“${satir.title}” — ${satir.expected_qty} adetin ${satir.scanned_qty} tanesi okutuldu, ${eksik} tanesi eksik.`,
      );
    }
  }
  return engeller;
}

/* ════════════════════════ Idempotency anahtarı ════════════════════════ */

//: Aynı süreçte üretilen anahtarların çakışmaması için sayaç. `Math.random`
//: fallback'i tek başına yeterli entropi verse de, ardışık iki çağrının aynı
//: milisaniyede aynı değeri üretmediği GARANTİ edilmelidir: geri alma
//: (`undo_scan`) durum-idempotan değildir ve tekrarlanan bir anahtar, ağ
//: tekrarında adedi iki kez düşürebilirdi (sözleşme §7 S7).
let anahtarSayaci = 0;

/**
 * Tek gönderim niyeti boyunca SABİT kalan işlem anahtarı.
 *
 * Backend sınırı 80 karakterdir (`schemas.packing.IDEM_MAX`); üretilen değer
 * en kötü hâlde bunun çok altında kalır. Anahtar her render'da değil, işlem
 * niyeti başlarken üretilir — her karede yenilenen bir anahtar, ağ tekrarında
 * sunucuya iki ayrı iş gibi görünür ve adet iki kez sayılır.
 */
export function newIdempotencyKey(): string {
  anahtarSayaci += 1;
  const rastgele =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  // Önek, sunucu izinde anahtarın nereden geldiğini söyler (`pkg` = paketleme
  // ekranı); sayaç aynı milisaniyedeki çakışmayı imkânsız kılar.
  return `pkg-${anahtarSayaci.toString(36)}-${rastgele}`.slice(0, 80);
}

/* ════════════════════════ QR yükü ════════════════════════ */

//: `services/packing_rules.QR_PREFIX`. Sürüm öneki iki işi birden yapar:
//: formatı ileride değiştirebilmek (PKG2…) ve durak uzayından YAPISAL olarak
//: ayrılmak.
const QR_ONEK = "PKG1";

/**
 * Okutulan yük bir PAKET yükü mü? (`PKG1:{id}:{token}`)
 *
 * İki QR uzayı ayrık kalmalı (denetçi notu 3):
 *
 *     paket : PKG1:{package_id}:{token}
 *     durak : {stop_id}:{token}
 *
 * Çıplak `42:abc` bir DURAK yüküdür ve burada **false** dönmelidir; aksi hâlde
 * kamera ekranı durak QR'ını paket sanıp yanlış uca gönderir, sunucu "paket
 * bulunamadı" der ve hata mesajı tamamen yanlış yeri işaret eder. Çıplak paket
 * ID'si de (`42`) yük değildir — token olmadan hiçbir şey doğrulanamaz.
 *
 * `parse_package_qr` ile aynı katılıkta: tam üç parça, doğru önek, boş olmayan
 * token, pozitif tam sayı kimlik.
 */
export function isPackagePayload(payload: string | null | undefined): boolean {
  if (!payload) return false;
  const parcalar = payload.trim().split(":");
  if (parcalar.length !== 3) return false;
  const [onek, hamId, token] = parcalar;
  if (onek !== QR_ONEK || !token) return false;
  // `Number()` "12abc"i NaN yapar ama " 12"yi 12 yapar; boşluk zaten trim'li.
  // `parseInt` KULLANILMAZ: "42abc"i 42 sayar ve bozuk yükü geçerli gösterirdi.
  const id = Number(hamId);
  return Number.isInteger(id) && id > 0;
}
