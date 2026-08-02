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
 * Paketlemenin ÜÇ kademeli izni: görüntüle · paketle · yönet.
 *
 * `adminAreaAccess` burada kullanılamaz: o `.view`/`.manage` ikilisini varsayar,
 * paketlemede ise arada `packing.pack` vardır — istasyondaki operatör tarama
 * yapar ama iade kabulü/repack/unpack gibi geri sarma işlemlerini yapamaz.
 *
 * **Kademeler BAĞIMSIZDIR; üst kademe alt kademeyi İMA ETMEZ.** Bu bilinçli bir
 * sözleşme değişikliğidir (eski hâl `canManage → canPack → canView` zincirini
 * kuruyordu) ve sebebi backend'le ayrışmasıdır: `api/deps.py::
 * require_admin_permission` kapalı bir küme içinde **tam kodu** arar, kademe
 * sıralaması tanımaz. `api/routers/packing.py`'de okuma uçlarının tamamı
 * (`queue`, `packages`, `packages/{id}`, `return-queue`) `packing.view`,
 * yazma uçları `packing.pack`, geri sarma uçları `packing.manage` ister.
 * Dolayısıyla yalnız `packing.manage` verilmiş bir kullanıcıya paketleme
 * butonu göstermek, tıklandığında kesin 403 alacak bir iş vaat etmekti —
 * "servisin reddedeceği butonu hiç gösterme" kuralının ihlali.
 *
 * Ters yöndeki operasyonel risk (yalnız `packing.pack` verilmiş kişinin
 * kabuğa hiç girememesi) gerçek rol katalogundan **okunarak** elendi:
 * `migrations/versions/f30_paketleme_semasi.py::ROLE_GRANTS`
 * — SUPER_ADMIN ve COMMERCE_MANAGER üç izni de, OPERATIONS_MANAGER
 * `view`+`pack` alır; hiçbir rol `view` olmadan `pack`/`manage` almaz.
 * Elle kurulmuş böyle bir rol olsaydı bile kabuk zaten çalışmazdı: kuyruk,
 * paket listesi ve paket detayı `packing.view` ister, yani ekran açılır ama
 * her sorgu 403 döndürürdü. Gerçeği söyleyen "yetkiniz yok" ekranı, her
 * satırı hata veren bir kabuktan iyidir.
 *
 * `lib/inventory.ts::inventoryAccess` hâlâ ima zincirini kullanıyor (aynı
 * sınıftan bir sapma, kapsam dışı — raporlandı); bu yüzden desen "üç kademeli
 * izin" olarak izlendi, "ima" kısmı bilinçli olarak izlenmedi.
 *
 * `permissions` **undefined** ise fail-open: eski persist edilmiş bir oturumda
 * `admin_permissions` alanı hiç bulunmayabilir ve `/me` henüz tazelenmemiştir.
 * O hâlde her şeyi gösterip backend'in reddetmesine bırakmak, yetkili kişiye
 * boş ekran göstermekten iyidir — `lib/adminAccess.ts` ve `lib/inventory.ts`
 * ile AYNI sözleşme. Boş dizi (`[]`) ise "izin yok" demektir ve kapatır.
 */
export function packingAccess(permissions: string[] | undefined): PackingAccess {
  if (!permissions) return { canView: true, canPack: true, canManage: true };
  return {
    canView: permissions.includes("packing.view"),
    canPack: permissions.includes("packing.pack"),
    canManage: permissions.includes("packing.manage"),
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

//: Kimlik alanı: YALNIZ ASCII ondalık basamak. `Number()`/`parseInt`
//: KULLANILMAZ — ikisi de bu alanda "sayıya benzeyen" şeyleri kabul eder ve
//: kabul ettikleri şey `build_package_qr`'ın ürettiği yük DEĞİLDİR:
//: `Number("1e3")=1000` · `Number("0x10")=16` · `Number("0b11")=3` ·
//: `Number("5.0")=5` · `Number("+5")=5` · `Number(" 5 ")=5` (bağımsız denetim
//: bulgusu) · `parseInt("42abc")=42`. Regex, kimliği okumadan yalnız BİÇİMİNİ
//: doğrular; sayıya çevirme hiç yapılmaz, böylece 20 basamaklı bir kimlikte
//: kayan nokta hassasiyeti de devreye girmez.
const ONDALIK_KIMLIK = /^[0-9]+$/;

//: "Sıfırdan büyük" testi sayı çevirmeden: en az bir sıfır olmayan basamak.
//: (`PKG1:0:abc` ve `PKG1:000:abc` iki tarafta da reddedilir.)
const SIFIRDAN_BUYUK = /[1-9]/;

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
 * ## Backend'le katılık ilişkisi (ayrışma riski — bilinçli)
 *
 * Referans `services/packing_rules.py::parse_package_qr`: yükü `strip`'ler, tam
 * üç parçaya böler, öneki **büyük/küçük harfe duyarlı** karşılaştırır, boş
 * token'ı reddeder, kimliği `int()` ile çözer ve `<= 0` olanı reddeder.
 *
 * Fark yalnız `int()`'tedir: Python `int()` beklenenden cömerttir ve
 * `"+5"` · `" 5 "` · `"5_0"` (=50) · `"５"`/`"۵"` (Unicode rakam) gibi
 * dizgileri de çözer. Burada **hepsi reddedilir**, yani bu katman backend'den
 * DAHA KATIDIR. Yön bilinçli seçildi çünkü iki yönün riski simetrik değil:
 *
 * - **Gevşek taraf tehlikeli**: burada "paket" denip pakete özel bir uca
 *   gönderilen bozuk yükü backend çözemez; kullanıcı yanlış yeri işaret eden
 *   bir hata görür. Ayrıca `"５"` gibi bir görsel ikizin sessizce 5 numaralı
 *   pakete gitmesi, elle kod girişinde (iOS'ta BarcodeDetector yok) yanlış
 *   paketi açtırabilirdi.
 * - **Katı taraf zararsız**: `false` dediğimizde yük mevcut durak yoluna
 *   (`/delivery/scan`) düşer ve backend payload'u **kendisi yeniden ayrıştırır**
 *   (`delivery_service.scan_qr` → `parse_package_qr`), yani gerçekten paket
 *   yüküyse yine paket olarak çözülür. Karar burada kaybolmaz.
 *
 * Baştaki sıfır (`PKG1:007:abc`) ise backend'le **aynı** davranır (kabul):
 * `int("007") = 7` ve etikette insan okunur kod zaten sıfır dolgulu basılıyor
 * (`package_code` → `PKT-000007`), yani elle yazan operatörün dolgu koyması
 * beklenebilir bir hata değil, beklenen bir alışkanlıktır.
 *
 * ⚠️ Bu fonksiyon bir kopyadır ve iki taraf birlikte değişmelidir: `QR_PREFIX`
 * ya da kimlik biçimi backend'de değişirse (ör. `PKG2`) burası sessizce eski
 * kalır. `packing.test.ts`'teki tablo, iki tarafta da elle koşulmuş sonuçlarla
 * doludur; sözleşme değişirse önce o tablo güncellenmelidir.
 */
export function isPackagePayload(payload: string | null | undefined): boolean {
  if (!payload) return false;
  const parcalar = payload.trim().split(":");
  if (parcalar.length !== 3) return false;
  const [onek, hamId, token] = parcalar;
  if (onek !== QR_ONEK || !token) return false;
  return ONDALIK_KIMLIK.test(hamId) && SIFIRDAN_BUYUK.test(hamId);
}
