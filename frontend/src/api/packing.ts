// F30 paketleme istasyonu — `/api/v1/packing/*` istemcisi (ADMIN).
//
// ## Bu katman ne YAPMAZ
//
// Karar vermez. FSM, yetki, idempotency ve miktar aritmetiği sunucudadır; burada
// yalnız istek kurulur ve tipli yanıt döner. "Şu durumdan sonra şu eylem" gibi
// bir çıkarım bu dosyaya girerse istemci ile sunucu iki ayrı doğruluk kaynağı
// olur — kuyruk satırının `next_action` alanı tam olarak bunu engellemek için
// var.
//
// ## Sunucu üretimi alanlar isteğe KONMAZ
//
// `status`, `packed_at`, `scanned_qty`, `items_fingerprint` gibi alanlar yalnız
// yanıtta yaşar. İstek şemaları backend'de `extra="forbid"` taşıdığı için
// böyle bir alanı göndermek zaten 422 olurdu; ama asıl sebep şu: paket durumunu
// istemcinin yazabilmesi bütün FSM'i anlamsız kılardı.
//
// ## QR yükü URL'e KONMAZ
//
// `qr_payload` (`PKG1:{id}:{token}`) kalıcı bir sırdır ve paket yaşadığı sürece
// geçerlidir. Query string'i sunucu erişim loguna, proxy loglarına ve tarayıcı
// geçmişine yazılır; token oraya düşerse basılı etiketi çalmakla aynı sonucu
// verir. Bu yüzden token taşıyan tek uç (`/delivery/scan`) onu GÖVDEDE alır ve
// bu dosyada token'lı bir GET yoktur.
import { apiClient } from "@/api/axios";
import type {
  Package,
  PackagePage,
  PackageReturnInPayload,
  PackageScan,
  PackageScanPayload,
  PackageStatus,
  PackageUndoScanPayload,
  PackingQueuePage,
  ReturnQueueRow,
} from "@/types/packing";

/** Liste uçlarının ortak sayfalama girdisi (`MAX_LIMIT=200`, `MAX_OFFSET=100000`). */
export interface PackingPageParams {
  limit?: number;
  offset?: number;
}

/* ════════════════════════ Okuma (packing.view) ════════════════════════ */

/**
 * Paketleme kuyruğu — söz gününe göre sıralı, **sayfalı**.
 *
 * Kuyruk "bugünün işi" olduğu için küçük kalacağı VARSAYILMAZ: kampanya günü
 * yüzlerce satır demektir ve sunucu tavanı (200) sessizce kırpar.
 */
export async function fetchPackingQueue(
  params: PackingPageParams = {},
): Promise<PackingQueuePage> {
  const { data } = await apiClient.get<PackingQueuePage>("/packing/queue", {
    params: {
      ...(params.limit != null ? { limit: params.limit } : {}),
      ...(params.offset != null ? { offset: params.offset } : {}),
    },
  });
  return data;
}

export interface PackageListParams extends PackingPageParams {
  /** Sunucudaki query adı `status`; tip birleşimi serbest metni engeller. */
  status?: PackageStatus;
  orderId?: number;
}

/** Sayfalı paket listesi (durum ve sipariş süzgeçli). */
export async function fetchPackages(
  params: PackageListParams = {},
): Promise<PackagePage> {
  const { data } = await apiClient.get<PackagePage>("/packing/packages", {
    // Elle string birleştirme YOK: axios `params` ile kodlama (Türkçe karakter,
    // `&`, boşluk) tek yerde ve doğru yapılır.
    params: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.orderId != null ? { order_id: params.orderId } : {}),
      ...(params.limit != null ? { limit: params.limit } : {}),
      ...(params.offset != null ? { offset: params.offset } : {}),
    },
  });
  return data;
}

/** Tek paketin tam hâli — `qr_payload` YALNIZ burada döner (etiket basımı). */
export async function fetchPackage(packageId: number): Promise<Package> {
  const { data } = await apiClient.get<Package>(`/packing/packages/${packageId}`);
  return data;
}

/** Kuryeden geri dönüşü beklenen paketler — en eskisi başta, "kaç gündür" ile. */
export async function fetchReturnQueue(): Promise<ReturnQueueRow[]> {
  const { data } = await apiClient.get<ReturnQueueRow[]>("/packing/return-queue");
  return data;
}

/* ════════════════════════ Paketleme (packing.pack) ════════════════════════ */

/**
 * Siparişe paket açar. Sunucuda **idempotenttir**: depodaki canlı paket olduğu
 * gibi döner (ikinci kutu üretilmez), araçtaki paket 409 verir.
 */
export async function openPackage(orderId: number): Promise<Package> {
  const { data } = await apiClient.post<Package>(`/packing/orders/${orderId}/open`);
  return data;
}

/**
 * Kalem doğrulama (okutma ya da gerekçeli manuel kapatma).
 *
 * **`idempotency_key` ÇAĞIRANIN sorumluluğudur ve aynı MANTIKSAL tarama boyunca
 * DEĞİŞMEMELİDİR.** Anahtar burada (ya da hook'un iç state'inde) üretilseydi
 * axios retry'ı veya kullanıcının ikinci dokunuşu yeni bir anahtar doğurur ve
 * aynı fiziksel kitap iki kez sayılırdı. Yeni anahtar ancak operatör YENİ bir
 * kalem okuttuğunda üretilir.
 *
 * Reddedilen tarama da **200**'dür: sonuç `result` alanındadır (`WRONG_SKU`,
 * `OVER_QTY` …) ve olay defterine yazılabilmesi için transaction commit edilir.
 * Yani `catch` bloğu iş sonucunu değil, yalnız yapısal hatayı görür.
 */
export async function scanPackageItem(
  packageId: number,
  payload: PackageScanPayload,
): Promise<PackageScan> {
  const { data } = await apiClient.post<PackageScan>(
    `/packing/packages/${packageId}/scan`,
    payload,
  );
  return data;
}

/**
 * Gerekçeli geri alma. `idempotency_key` **önerilir**: geri alma
 * durum-idempotan değildir — ağ tekrarı adedi iki kez düşürür.
 */
export async function undoPackageScan(
  packageId: number,
  payload: PackageUndoScanPayload,
): Promise<PackageScan> {
  const { data } = await apiClient.post<PackageScan>(
    `/packing/packages/${packageId}/undo-scan`,
    payload,
  );
  return data;
}

/** Paketi kapatır (`PACKED`). Eksik kalem 409; kalem listesi değiştiyse 409 (STALE). */
export async function completePackage(packageId: number): Promise<Package> {
  const { data } = await apiClient.post<Package>(
    `/packing/packages/${packageId}/complete`,
  );
  return data;
}

/**
 * Paketten vazgeçme — gerekçe ZORUNLU.
 *
 * Yetki duruma bağlıdır ve sunucuda çözülür: `OPEN` paket `packing.pack` ile,
 * kapanmış paket `packing.manage` ile çözülür. İstemci bu ayrımı YENİDEN
 * uygulamaz; yalnız 403'ü kullanıcıya anlatır.
 */
export async function voidPackage(packageId: number, reason: string): Promise<Package> {
  const { data } = await apiClient.post<Package>(`/packing/packages/${packageId}/void`, {
    reason,
  });
  return data;
}

/* ════════════════════════ Yönetim (packing.manage) ════════════════════════ */

/** Kuryeden dönen paketin depoda okutularak kabulü (`RETURNED`). */
export async function returnInPackage(
  packageId: number,
  payload: PackageReturnInPayload = {},
): Promise<Package> {
  const { data } = await apiClient.post<Package>(
    `/packing/packages/${packageId}/return-in`,
    payload,
  );
  return data;
}

/** Geri gelmiş paketi yeniden dağıtıma verir (`RETURNED` → `PACKED`). Etiket KORUNUR. */
export async function repackPackage(packageId: number): Promise<Package> {
  const { data } = await apiClient.post<Package>(`/packing/packages/${packageId}/repack`);
  return data;
}

/** Fiziksel bozma damgası — "bozulmayı bekleyen paketler" kuyruğunu kapatır. */
export async function unpackPackage(packageId: number): Promise<Package> {
  const { data } = await apiClient.post<Package>(`/packing/packages/${packageId}/unpack`);
  return data;
}
