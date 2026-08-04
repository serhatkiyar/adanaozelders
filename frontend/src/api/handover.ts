// Kurye zimmeti (F30 sözleşme §3.4) — saha ekranlarının paket-uzayı HTTP yüzeyi.
//
// ## Neden `api/delivery.ts`'ten ayrı bir dosya
//
// Sunucuda iki QR uzayı ayrıktır ve ayrık kalmalıdır: durak yükü
// (`{stop_id}:{token}` → `POST /delivery/scan`, kapıda teslim akışı) ve paket
// yükü (`PKG1:{package_id}:{token}` → `POST /delivery/handover/scan`, depoda
// araca alma). İkisi aynı modülde yan yana durduğunda, çağıranın yanlış
// fonksiyonu seçmesi tek harf meselesine iner; ayrı dosya bunu import satırında
// görünür kılar. Uçların gövde sözleşmesi de farklıdır: zimmet yükü **gövdede**
// gider (`{payload}`), query string'de DEĞİL — QR token'ı sunucu erişim
// kayıtlarına ve tarayıcı geçmişine düşmemelidir.
//
// ## Alanlar birebir `backend/schemas/packing.py`'den kopyalanır
//
// Uydurulmuş alan, derlemesi geçen ama gerçek sunucuya karşı boş çizen bir
// ekran demektir (bu dosyanın ilk taslağı `packages[]`/`code`/`recipient`
// diyordu; gerçek şema `rows[]`/`package_code` ve alıcı adı HİÇ yok).

import { apiClient } from "@/api/axios";
import type { Package, PackageStatus } from "@/types/packing";

/**
 * `schemas.packing.HandoverManifestRowOut` — birebir.
 *
 * Manifest yalnız **PENDING** durakları listeler (`delivery_service.
 * handover_manifest`): sonuçlanmış durağın paketi zimmet konusu değildir.
 *
 * `package_status` **`null` olabilir** ve bu "paket yok" demektir: F30 öncesi
 * açılmış siparişlerin `order_packages` kaydı hiç yoktur. Ekran bu hâli
 * "zimmetlenmemiş" ile KARIŞTIRMAMALIDIR — karıştırırsa eski siparişlerin
 * tamamı teslim edilemez hâle gelir.
 */
export interface HandoverManifestRow {
  stop_id: number;
  order_id: number;
  sequence: number;
  package_id: number | null;
  /** `PKT-000042` — kurye kutunun üstündeki insan okunur kodla eşler. */
  package_code: string | null;
  /** Sunucuda çıplak `str`; küme `PackageStatus` ile kilitli. */
  package_status: PackageStatus | string | null;
  handed_over: boolean;
}

/** `schemas.packing.HandoverManifestOut` — N/M çubuğu + eksik paket listesi. */
export interface HandoverManifest {
  run_id: number;
  run_status: string;
  /** Süzülmüş toplam (PENDING durak sayısı), sayfa uzunluğu değil. */
  total: number;
  handed_over: number;
  rows: HandoverManifestRow[];
}

export async function fetchHandoverManifest(runId: number): Promise<HandoverManifest> {
  const { data } = await apiClient.get<HandoverManifest>(
    `/delivery/handover/manifest/${runId}`
  );
  return data;
}

/**
 * Paketi kuryeye zimmetle: paket `HANDED_OVER`, sipariş `SHIPPED`.
 *
 * İdempotenttir (sunucu sözleşmesi): aynı etiket ikinci kez okutulursa ikinci
 * `SHIPPED` geçişi, ikinci takip numarası ve ikinci bildirim ÜRETİLMEZ —
 * yanıt yine 200 ve paketin güncel hâlidir. Bu yüzden istemci "tekrar" hâlini
 * hata sanmamalı, ama SESSİZ de geçmemelidir (kurye ikinci kutuyu aradığını
 * sanır); ayrımı ekran manifest anlık görüntüsünden yapar.
 */
export async function handoverScan(payload: string): Promise<Package> {
  const { data } = await apiClient.post<Package>("/delivery/handover/scan", {
    payload,
  });
  return data;
}

/* ════════════════════════ Hata yüzeyi ════════════════════════ */

/**
 * IDOR deseninin istemci tarafı: 404 **tek ve aynı** cümledir.
 *
 * Sunucu yabancı paketi, olmayan paketi, dünkü turun paketini ve bozuk token'ı
 * bilinçli olarak AYNI 404 gövdesiyle döndürür (`_ETIKET_YOK`); istemcinin
 * bunları farklı cümlelerle ayırması, sunucunun kapattığı sızıntıyı ekranda
 * geri açardı ("bu paket var ama sizin değil" ile "böyle paket yok" arasındaki
 * fark bir bilgidir).
 */
export const ETIKET_TANINMADI =
  "Bu etiket tanınmadı — paket bu turda değil ya da kod yanlış okundu. " +
  "Kutunun üstündeki kodu kontrol et.";

interface AxiosBenzeriHata {
  response?: { status?: number; data?: { detail?: unknown } };
  code?: string;
  message?: string;
}

/** Sunucunun `detail` alanı: dizgi (bizim uçlar) ya da 422'de doğrulama dizisi. */
function detayMetni(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) return detail;
  return null;
}

/**
 * HTTP hatasını kuryenin okuyabileceği tek cümleye çevirir.
 *
 * Ayrımlar keyfi değil, **sahada farklı davranış** gerektirdikleri için var:
 * 401 → oturum tazelenmeli (tekrar denemek işe yaramaz) · 403 → yetki
 * (yöneticiyi ara) · 404 → etiket/kapsam (kodu kontrol et) · 409 → iş kuralı,
 * sunucunun kendi cümlesi gösterilir (eksik paket / geri beklenen / durak yok
 * gibi ayrımı yalnız sunucu bilir) · 422 → istemci hatası, tekrar denemek
 * anlamsız · 5xx ve ağ → tekrar denenebilir.
 */
export function scanErrorMessage(e: unknown, fallback: string): string {
  const hata = e as AxiosBenzeriHata | null;
  const durum = hata?.response?.status;

  if (durum === undefined) {
    // Yanıt hiç gelmedi: çevrimdışı, zaman aşımı ya da kopan bağlantı.
    // Kurye için üçünün de eylemi aynı değildir (biri beklemeyi, diğeri
    // tekrar denemeyi gerektirir), bu yüzden ayrı cümlelerle söylenir.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "İnternet yok — bağlantı gelince tekrar okut. Okutma kaydedilmedi.";
    }
    if (hata?.code === "ECONNABORTED" || /timeout/i.test(hata?.message ?? "")) {
      return "Sunucu yanıt vermedi (zaman aşımı). Tekrar okut — çift kayıt oluşmaz.";
    }
    return "Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar okut.";
  }

  if (durum === 401) return "Oturumun düşmüş — çıkış yapıp yeniden giriş yap.";
  if (durum === 403) return "Bu işlem için yetkin yok — yöneticini ara.";
  if (durum === 404) return ETIKET_TANINMADI;
  if (durum === 409) return detayMetni(hata?.response?.data?.detail) ?? fallback;
  if (durum === 422) {
    return "Okunan kod geçersiz biçimde — etiketi yeniden okut ya da kodu elle gir.";
  }
  if (durum >= 500) {
    return "Sunucu hatası — birkaç saniye sonra tekrar okut. Sorun sürerse yöneticini ara.";
  }
  return detayMetni(hata?.response?.data?.detail) ?? fallback;
}

/**
 * Manifest YÜKLEME hatası — `scanErrorMessage`'ten ayrı olmak zorunda.
 *
 * İkisi de 404 görebilir ama 404'ün ANLAMI farklıdır: tarama ucunda "etiket
 * tanınmadı", manifest ucunda "bu tur sana ait değil / silinmiş"
 * (`courier_account_service.ensure_run_access`). Tek fonksiyon kullanıldığında
 * ekran, yabancı bir tur adresini açan kuryeye "kutunun üstündeki kodu kontrol
 * et" diyordu — hiç kod okutulmamışken. Yanlış yeri işaret eden mesaj, hiç
 * mesaj vermemekten daha pahalıdır: kurye olmayan bir sorunu arar.
 *
 * 404 hâlâ TEK cümledir (yok / başkasının / silinmiş ayrımı yapılmaz):
 * sunucunun bilinçli olarak birleştirdiği sızıntıyı istemci ayırmaz.
 */
export function manifestErrorMessage(e: unknown): string {
  const durum = (e as AxiosBenzeriHata | null)?.response?.status;
  if (durum === 404) {
    return "Bu tur açılamadı — sana atanmış değil ya da kaldırılmış. Yöneticini ara.";
  }
  return scanErrorMessage(e, "Zimmet listesi alınamadı.");
}
