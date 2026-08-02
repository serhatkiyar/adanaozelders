// F30 paketleme uçlarının (`/api/v1/packing/*`) tip karşılıkları.
//
// Kaynak: `backend/schemas/packing.py`. Alanlar oradan **birebir** kopyalanır;
// eksik alan eklemek kolay, uydurulmuş alan ise sessizce yanlış ekran demektir.
//
// Ayrı bir dosyada durmalarının sebebi `types/index.ts`'in şişmesi değil:
// paketleme, sipariş/teslimat tiplerinden bağımsız bir yüzeydir ve durum
// birleşimleri (union) backend sözleşmesinin drift testleriyle korunan
// kümesidir — tek dosyada olunca hangi union'ın hangi uçtan geldiği kaybolur.

/**
 * Paket FSM'inin bütün durumları — `schemas.packing.PackageStatus` ile aynı.
 *
 * Kapalı küme olması bilinçlidir: backend yeni bir durum eklerse TypeScript
 * derlemesi kırılır ve etiket/konum tablolarına o durumu eklemek zorunlu olur.
 * Çalışma anında bilinmeyen bir değer gelirse `lib/packing.ts` fail-closed
 * davranır (etiketsiz durum yazma eylemi AÇMAZ) — bu yüzden oradaki yardımcılar
 * `string` alır, bu birleşimi değil.
 */
export type PackageStatus =
  | "OPEN"
  | "PACKED"
  | "HANDED_OVER"
  | "RETURN_PENDING"
  | "RETURNED"
  | "DELIVERED"
  | "VOID";

/**
 * Kuyruk satırının operatöre önerdiği TEK eylem
 * (`schemas.packing.PackingNextAction`).
 *
 * `null` = eyleme dönüşmeyen satır. Ekran o satırda hiçbir YAZMA eylemi
 * göstermez; sunucu "bilmiyorum" dediğinde istemcinin eylem uydurması,
 * aynı ürünleri ikinci kez raftan toplatabilir.
 */
export type PackingNextAction =
  | "OPEN_NEW_PACKAGE"
  | "CONTINUE_PACKING"
  | "REPACK_RETURNED";

/**
 * Tarama sonucu — `models.packing.SCAN_RESULTS` ile aynı küme.
 *
 * `ALREADY_COMPLETE` ve `UNSCANNABLE` saf kural katmanının ÜRETMEDİĞİ ama HTTP
 * katmanının döndürebildiği sonuçlardır (bkz. `services/packing_rules.py`
 * `ScanOutcome` notu); bu yüzden ikisi de burada vardır.
 */
export type ScanResult =
  | "OK"
  | "OK_MANUAL"
  | "WRONG_SKU"
  | "OVER_QTY"
  | "ALREADY_COMPLETE"
  | "UNSCANNABLE";

/* ════════════════════════ Yanıt şemaları ════════════════════════ */

/** `schemas.packing.PackageItemOut` */
export interface PackageItem {
  id: number;
  order_item_id: number;
  /** Ürünü kataloğdan silinmiş satırda `null`. */
  product_id: number | null;
  /** `null` ise satır TARANAMAZ; yalnız gerekçeli manuel doğrulama kapatır. */
  sku: string | null;
  barcode: string | null;
  title: string;
  expected_qty: number;
  scanned_qty: number;
  remaining: number;
}

/**
 * `schemas.packing.PackageOut`
 *
 * `status` uçta çıplak `str`'dir (şema katmanı `services`'i import edemediği
 * için) ama üretilen değer kümesi `order_packages` CHECK kısıtıyla
 * `PackageStatus`'a kilitlidir — bu yüzden burada birleşim olarak yazılır.
 */
export interface Package {
  id: number;
  order_id: number;
  package_no: number;
  /** `PKT-000042` — türetilmiş insan okunur kod, kolon değil. */
  code: string;
  status: PackageStatus;
  /** Etikete basılan `PKG1:{id}:{token}` yükü. */
  qr_payload: string;
  items_fingerprint: string;
  packed_at: string | null;
  packed_by_admin_id: number | null;
  handed_over_at: string | null;
  handed_to_courier_id: number | null;
  handed_over_by_actor: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  return_note: string | null;
  void_at: string | null;
  void_reason: string | null;
  unpacked_at: string | null;
  created_at: string | null;
  items: PackageItem[];
}

/**
 * `schemas.packing.PackageScanOut` — iş sonucu + paketin GÜNCEL hâli.
 *
 * Paketin tamamı bilinçli olarak döner: ekran her taramadan sonra satır
 * adetlerini yeniden çizer ve ayrı bir `GET` iki istek arasında değişen satırı
 * gösteremezdi.
 */
export interface PackageScan extends Package {
  result: ScanResult;
  qty_delta: number;
  /** Hangi satır etkilendi; eşleşme yoksa `null`. */
  order_item_id: number | null;
  /** `true` ise bu yanıt kayıtlı bir sonucun TEKRARIDIR (yan etki yok). */
  replayed: boolean;
}

/** `schemas.packing.PackagePage` */
export interface PackagePage {
  items: Package[];
  total: number;
  limit: number;
  offset: number;
}

/** `schemas.packing.PackageSummaryOut` — `qr_payload` BİLİNÇLİ OLARAK YOK. */
export interface PackageSummary {
  id: number;
  code: string;
  status: PackageStatus;
}

/** `schemas.packing.PackingQueueItemOut` */
export interface PackingQueueItem {
  title: string;
  quantity: number;
}

/** `schemas.packing.PackingQueueRowOut` */
export interface PackingQueueRow {
  order_id: number;
  recipient: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  item_count: number;
  items: PackingQueueItem[];
  /** `YYYY-MM-DD` (saat bileşeni yok — sunucudaki tip `date`). */
  promised_delivery_date: string | null;
  created_at: string | null;
  prepared_at: string | null;
  /** Siparişin canlı paketi; hiç paket açılmamışsa `null`. */
  package: PackageSummary | null;
  next_action: PackingNextAction | null;
}

/**
 * `schemas.packing.PackingQueuePage`
 *
 * `total` **süzülmüş toplam** kayıt sayısıdır, sayfanın uzunluğu değil.
 */
export interface PackingQueuePage {
  items: PackingQueueRow[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * `schemas.packing.PackageLabelItemOut`
 *
 * **Beklenen** adet taşınır, taranan DEĞİL — `scanned_qty` alanı uçta YOKTUR.
 * Kâğıt kutunun ne içermesi gerektiğini söyler; yarım kalmış bir paketin
 * etiketi alınsa taranan adet eksik içeriği "doğru"muş gibi gösterirdi.
 */
export interface PackageLabelItem {
  order_item_id: number;
  /** Paket satırının SNAPSHOT'ı; ürünü okunamayan satırda `null` ("SKU yok"). */
  sku: string | null;
  title: string;
  expected_qty: number;
}

/**
 * `schemas.packing.PackageLabelOut` — `GET /packing/packages/{id}/label`.
 *
 * Ayrı bir uç olmasının sebebi `PackageOut`'a bakılarak anlaşılmaz: alıcı,
 * adres ve teslimat tercihi **siparişte** yaşar, pakette değil. Kuyruk satırı
 * onları taşıyor ama paket `PACKED` olduğu anda kuyruktan düşüyor — yani tam da
 * basma anında elde değil. Bu uç kâğıdın tamamını TEK istekte verir; iki yanıtı
 * tahminle birleştirmek F26'daki "etiket bomboş basıldı" yoluydu.
 *
 * **Telefon BİLİNÇLİ OLARAK YOKTUR** (backend sözleşmesi): kurye numarayı saha
 * ekranından taze ve yetki denetimli alır; kâğıt teslimattan sonra da yaşadığı
 * için (kutunun üstünde çöpe/kapıya gider) geri alınamayan tek kopyaya kişisel
 * veri basılmaz.
 *
 * **NULL sözleşmesi**: sunucu yer tutucu ÜRETMEZ — `"—"` ya da `""` dönmez;
 * boş/yalnız-boşluk değerler `null`'a indirgenir. Böylece istemci "veri yok"
 * ile gerçek değeri ayırt eder ve eksik veriyi AÇIKÇA yazabilir.
 */
export interface PackageLabel {
  /** `id` DEĞİL: gövdede `order_id` de var, çıplak `id` hangi kimlik sorusunu doğururdu. */
  package_id: number;
  code: string;
  /** Uçta çıplak `str` (yalnız gösterilir); basılabilirlik kararı ayrı verilir. */
  status: string;
  /** `PKG1:{id}:{token}` — QR'a basılan GERÇEK yük. */
  qr_payload: string;
  order_id: number;
  recipient: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  /** NOT NULL kolon (varsayılan `ADRESIMDEYIM`) — her zaman dolu. */
  delivery_pref: string;
  delivery_pref_note: string | null;
  items: PackageLabelItem[];
}

/** `schemas.packing.ReturnQueueRowOut` — "geri dönüş bekleniyor" satırı. */
export interface ReturnQueueRow {
  package_id: number;
  package_code: string;
  order_id: number;
  courier_id: number | null;
  courier_name: string | null;
  handed_over_at: string | null;
  /** Görünürlüğün kendisi: hiçbir yerde görünmeyen paket aranmaz. */
  waiting_days: number;
}

/**
 * `schemas.packing.ReturnQueuePage`
 *
 * Uç eskiden tavansız düz bir liste (`ReturnQueueRow[]`) dönüyordu; kardeş
 * uçlarla aynı sayfalama sözleşmesine çekildi. `total` **süzülmüş toplam**
 * kayıt sayısıdır, `len(items)` değil — ekran "N kutu geri bekleniyor" derken
 * N'in sayfa uzunluğu olması sayacı sessizce yalancı yapardı.
 */
export interface ReturnQueuePage {
  items: ReturnQueueRow[];
  total: number;
  limit: number;
  offset: number;
}

/* ════════════════════════ İstek gövdeleri ════════════════════════ */
//
// İstek şemaları backend'de `extra="forbid"` taşır: fazladan alan 422 döner.
// Bu yüzden gövde tipleri **kapalı** yazılır — `[key: string]: unknown` gibi
// bir kaçış deliği, sunucunun reddedeceği bir isteği derleme anında serbest
// bırakırdı.

/** `schemas.packing.PackageScanIn` (`code` en fazla 64, gerekçe 200 karakter). */
export interface PackageScanPayload {
  code?: string;
  /** Kaçış kapısı: kodu okunmayan satır. `manual_reason` ZORUNLU olur. */
  manual?: boolean;
  manual_reason?: string;
  order_item_id?: number;
  idempotency_key?: string;
}

/** `schemas.packing.PackageUndoScanIn` — gerekçe zorunlu. */
export interface PackageUndoScanPayload {
  order_item_id: number;
  reason: string;
  idempotency_key?: string;
}

/** `schemas.packing.PackageVoidIn` */
export interface PackageVoidPayload {
  reason: string;
}

/** `schemas.packing.PackageReturnInIn` */
export interface PackageReturnInPayload {
  note?: string;
}
