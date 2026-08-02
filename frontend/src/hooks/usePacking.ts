// F30 paketleme istasyonu — React Query hook'ları (ADMIN).
//
// ## İki kural bu dosyanın omurgası
//
// 1. **Sunucu yanıtı tek doğruluk kaynağıdır.** Hiçbir mutasyon uydurma bir FSM
//    durumu (`OPEN` → `PACKED` gibi) önceden yazmaz. Optimistic FSM burada
//    özellikle tehlikeli: `complete` eksik kalemde 409, kalem listesi
//    değiştiyse yine 409 döner — ekranın "paketlendi" deyip sonra geri sarması,
//    operatörün kutuyu bantlamasından SONRA olurdu. Önbelleğe yazılan tek şey
//    sunucunun DÖNDÜRDÜĞÜ paket nesnesidir.
// 2. **Yetkisiz kullanıcıda istek atılmaz.** Sorgular `enabled` alır ve kararı
//    çağıran verir (`packing.view` izni olan mı?). Hook'un kendi başına 403
//    üretip yutması, panelde sessiz hata gürültüsü demekti.
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import * as packingApi from "@/api/packing";
import type {
  Package,
  PackageReturnInPayload,
  PackageScan,
  PackageScanPayload,
  PackageUndoScanPayload,
} from "@/types/packing";

const KEY = ["packing"] as const;

const QUEUE_KEY = [...KEY, "queue"] as const;
const LIST_KEY = [...KEY, "packages"] as const;
const RETURN_QUEUE_KEY = [...KEY, "return-queue"] as const;

/** Paket detayının önbellek anahtarı — tarama yanıtı buraya yazılır. */
const packageKey = (packageId: number) => [...KEY, "package", packageId] as const;

/**
 * Etiket verisinin önbellek anahtarı.
 *
 * Paket detayından AYRI tutulur: etiket yanıtı sevkiyat kimliği (alıcı, açık
 * adres) taşır ve `PackageOut` taşımaz — ikisini aynı anahtara yazmak, tarama
 * yanıtının etiketi ezmesine ve adresin sessizce kaybolmasına yol açardı.
 */
const labelKey = (packageId: number) => [...KEY, "label", packageId] as const;

/* ════════════════════════ Sorgular ════════════════════════ */

/**
 * Paketleme kuyruğu. Sayfalama parametreleri anahtarın PARÇASIDIR: aynı
 * anahtarla farklı sayfa çekmek, ikinci sayfayı birincinin üstüne yazar.
 */
export function usePackingQueue(
  params: packingApi.PackingPageParams = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [...QUEUE_KEY, params.limit ?? null, params.offset ?? null],
    queryFn: () => packingApi.fetchPackingQueue(params),
    enabled,
  });
}

/** Sayfalı paket listesi (durum / sipariş süzgeçli). */
export function usePackages(params: packingApi.PackageListParams = {}, enabled = true) {
  return useQuery({
    queryKey: [
      ...LIST_KEY,
      params.status ?? null,
      params.orderId ?? null,
      params.limit ?? null,
      params.offset ?? null,
    ],
    queryFn: () => packingApi.fetchPackages(params),
    enabled,
  });
}

/** Tek paket (etiket basımı için `qr_payload` yalnız burada gelir). */
export function usePackage(packageId: number | null, enabled = true) {
  return useQuery({
    queryKey: packageKey(packageId ?? 0),
    queryFn: () => packingApi.fetchPackage(packageId!),
    enabled: enabled && packageId != null,
  });
}

/**
 * Tek paketin etiket verisi — **yalnız istendiğinde** çekilir.
 *
 * `enabled` çağıranın elindedir ve varsayılan olarak kapalı DEĞİLDİR; çağrı
 * noktaları `packageId`'yi ancak kullanıcı "Etiketi yazdır" dediğinde verir.
 * Sebep veri minimizasyonu: yanıt alıcı adı + açık adres taşır ve bu bilgi
 * paket listesinin her satırında dolaşmamalıdır.
 */
export function usePackageLabel(packageId: number | null, enabled = true) {
  return useQuery({
    queryKey: labelKey(packageId ?? 0),
    queryFn: () => packingApi.fetchPackageLabel(packageId!),
    enabled: enabled && packageId != null,
  });
}

/**
 * Çoklu etiket sayfası için N paketin etiketi.
 *
 * `useQueries` bilinçli: her paket kendi önbellek girdisini kullanır, yani tek
 * tek basımla çoklu basım aynı veriyi paylaşır ve biri hata verirse ötekiler
 * yine basılabilir. Toplu bir uç yok — olsaydı sevkiyat kimliğini tek istekte
 * yüzlerce satır için döndürürdü.
 *
 * **Hata YUTULMAZ**: çağıran her sorgunun durumuna tek tek bakar ve
 * getirilemeyen paketi kâğıttan sessizce düşürmek yerine ekranda söyler
 * (F26 dersi: eksik etiket kimsenin fark etmediği hatadır).
 */
export function usePackageLabels(packageIds: readonly number[]) {
  return useQueries({
    queries: packageIds.map((id) => ({
      queryKey: labelKey(id),
      queryFn: () => packingApi.fetchPackageLabel(id),
    })),
  });
}

/** Geri dönüşü beklenen paketler kuyruğu — **sayfalı**. */
export function useReturnQueue(
  params: packingApi.PackingPageParams = {},
  enabled = true,
) {
  return useQuery({
    // Sayfalama parametreleri anahtarın PARÇASIDIR: aynı anahtarla farklı sayfa
    // çekmek, ikinci sayfayı birincinin üstüne yazar.
    queryKey: [...RETURN_QUEUE_KEY, params.limit ?? null, params.offset ?? null],
    queryFn: () => packingApi.fetchReturnQueue(params),
    enabled,
  });
}

/* ════════════════════════ Önbellek tazeleme ════════════════════════ */

/**
 * Paket durumu değişti: paketleme yüzeylerinin TAMAMI + teslimat tazelenir.
 *
 * Teslimat da tazelenir çünkü kapanan paket siparişi "hazır" yapar ve
 * `/delivery/eligible-orders` kuyruğuna düşürür; paketleme ekranında kalan
 * operatör, dağıtım sekmesinde bayat bir kuyruk bırakırdı.
 */
function useInvalidatePacking() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["delivery"] });
  };
}

/**
 * Tarama sonrası tazeleme — sunucunun döndürdüğü paketi detay önbelleğine yazar.
 *
 * Liste yüzeyleri yalnız **bayat işaretlenir** (`refetchType: "none"`), yeniden
 * çekilmez: okutma saniyede bir olabilen bir eylemdir ve her barkodda kuyruğu
 * yeniden indirmek istasyonu ağ gecikmesine bağlardı. Tarama zaten paketin
 * DURUMUNU değiştirmez (`OPEN` kalır); değişen tek şey satır adetleridir ve
 * onlar bu yanıtla geliyor.
 */
function tazeleTarama(qc: QueryClient, sonuc: PackageScan) {
  // `result`/`qty_delta`/… tarama olayına aittir, paketin kendisine değil;
  // detay önbelleğine sızarsa `usePackage` tüketicileri paket şemasında var
  // olmayan alanlara göre dallanmaya başlar.
  const { result: _r, qty_delta: _q, order_item_id: _i, replayed: _p, ...paket } = sonuc;
  qc.setQueryData<Package>(packageKey(paket.id), paket);
  qc.invalidateQueries({ queryKey: QUEUE_KEY, refetchType: "none" });
  qc.invalidateQueries({ queryKey: LIST_KEY, refetchType: "none" });
}

/* ════════════════════════ Mutasyonlar ════════════════════════ */

/** Siparişe paket açar (sunucuda idempotent: canlı paket varsa o döner). */
export function useOpenPackage() {
  const qc = useQueryClient();
  const invalidate = useInvalidatePacking();
  return useMutation({
    mutationFn: (orderId: number) => packingApi.openPackage(orderId),
    onSuccess: (paket) => {
      qc.setQueryData<Package>(packageKey(paket.id), paket);
      invalidate();
    },
  });
}

export interface ScanVariables {
  packageId: number;
  /**
   * `idempotency_key` **buradan** gelir ve aynı mantıksal tarama boyunca
   * DEĞİŞMEMELİDİR (bkz. `api/packing.ts`). Hook kendi içinde üretseydi bir
   * yeniden deneme yeni anahtar doğurur ve aynı kitap iki kez sayılırdı.
   */
  payload: PackageScanPayload;
}

/**
 * Kalem doğrulama. Reddedilen tarama **hata değildir**: `onSuccess` `WRONG_SKU`
 * ile de çalışır, `result` alanına bakmak çağıranın işidir.
 */
export function useScanPackageItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ packageId, payload }: ScanVariables) =>
      packingApi.scanPackageItem(packageId, payload),
    onSuccess: (sonuc) => tazeleTarama(qc, sonuc),
  });
}

export interface UndoScanVariables {
  packageId: number;
  payload: PackageUndoScanPayload;
}

/** Gerekçeli geri alma. `idempotency_key` önerilir — geri alma idempotan değil. */
export function useUndoPackageScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ packageId, payload }: UndoScanVariables) =>
      packingApi.undoPackageScan(packageId, payload),
    onSuccess: (sonuc) => tazeleTarama(qc, sonuc),
  });
}

/** Paketi kapatır. Eksik kalem / bayat kalem listesi 409'dur — yakalayan çağıran. */
export function useCompletePackage() {
  const qc = useQueryClient();
  const invalidate = useInvalidatePacking();
  return useMutation({
    mutationFn: (packageId: number) => packingApi.completePackage(packageId),
    onSuccess: (paket) => {
      qc.setQueryData<Package>(packageKey(paket.id), paket);
      invalidate();
    },
  });
}

export interface VoidVariables {
  packageId: number;
  reason: string;
}

/** Paketten vazgeçme (gerekçe zorunlu). Kapanmış pakette 403 `packing.manage` ister. */
export function useVoidPackage() {
  const qc = useQueryClient();
  const invalidate = useInvalidatePacking();
  return useMutation({
    mutationFn: ({ packageId, reason }: VoidVariables) =>
      packingApi.voidPackage(packageId, reason),
    onSuccess: (paket) => {
      qc.setQueryData<Package>(packageKey(paket.id), paket);
      invalidate();
    },
  });
}

export interface ReturnInVariables {
  packageId: number;
  payload?: PackageReturnInPayload;
}

/** Kuryeden dönen paketin depoda kabulü — geri dönüş kuyruğunu da tazeler. */
export function useReturnInPackage() {
  const qc = useQueryClient();
  const invalidate = useInvalidatePacking();
  return useMutation({
    mutationFn: ({ packageId, payload }: ReturnInVariables) =>
      packingApi.returnInPackage(packageId, payload ?? {}),
    onSuccess: (paket) => {
      qc.setQueryData<Package>(packageKey(paket.id), paket);
      invalidate();
    },
  });
}

/** `RETURNED` → `PACKED`: paket yeniden dağıtıma girer, basılı etiket korunur. */
export function useRepackPackage() {
  const qc = useQueryClient();
  const invalidate = useInvalidatePacking();
  return useMutation({
    mutationFn: (packageId: number) => packingApi.repackPackage(packageId),
    onSuccess: (paket) => {
      qc.setQueryData<Package>(packageKey(paket.id), paket);
      invalidate();
    },
  });
}

/** Fiziksel bozma damgası (`VOID` + `unpacked_at`). Stok hareketi YAZMAZ. */
export function useUnpackPackage() {
  const qc = useQueryClient();
  const invalidate = useInvalidatePacking();
  return useMutation({
    mutationFn: (packageId: number) => packingApi.unpackPackage(packageId),
    onSuccess: (paket) => {
      qc.setQueryData<Package>(packageKey(paket.id), paket);
      invalidate();
    },
  });
}
