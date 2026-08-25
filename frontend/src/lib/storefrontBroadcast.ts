/**
 * Vitrin yayını olduğunda AYNI TARAYICIDAKİ diğer sekmelere haber verir.
 *
 * ## Neden WebSocket değil
 *
 * Sorun "canlı işbirliği" değil; yönetici yayınladıktan sonra kendi açık
 * mağaza sekmesinin eski içeriği göstermeye devam etmesi. Bunun için her
 * ziyaretçiye bir soket açmak, çözülen sorunla orantısız bir altyapı yükü
 * olurdu. `BroadcastChannel` aynı tarayıcıdaki sekmeler arasında bedava
 * çalışır; gerçek müşteri (başka cihaz) için tazeleme yolu ayrıdır —
 * sekmeye geri dönüldüğünde bayat sorgunun yenilenmesi.
 *
 * ## Neden global ayar değiştirilmedi
 *
 * `lib/queryClient.ts` uygulama genelinde `refetchOnWindowFocus: false`
 * diyor. Tek bir vitrin ihtiyacı için o ayarı çevirmek, bütün uygulamanın
 * ağ davranışını ölçülmemiş biçimde değiştirirdi. Çözüm sorgu bazında
 * hedeflenmiştir.
 *
 * Kanal yoksa (eski Safari, bazı gömülü görünümler) her şey sessizce
 * çalışmaya devam eder: duyuru bir OPTİMİZASYONDUR, doğruluk ona bağlı
 * değildir.
 */

/** Kanal adı — yayıncı ve dinleyici aynı sabiti kullanmalı. */
export const VITRIN_KANALI = "vitrin-yayin";

type VitrinOlayi = { tip: "yayinlandi" };

function kanalAc(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(VITRIN_KANALI);
  } catch {
    return null;
  }
}

/** Yayın yapıldığını duyurur. Kanal yoksa sessizce hiçbir şey yapmaz. */
export function yayinDuyur(): void {
  const kanal = kanalAc();
  if (!kanal) return;
  try {
    kanal.postMessage({ tip: "yayinlandi" } satisfies VitrinOlayi);
  } finally {
    kanal.close();
  }
}

/**
 * Yayın duyurularını dinler. Dönen fonksiyon aboneliği kapatır.
 *
 * Not: `BroadcastChannel` mesajı GÖNDEREN sekmeye geri vermez. Yöneticinin
 * kendi panelindeki tazeleme bu yüzden duyuruya değil, mutasyonun kendi
 * `invalidate`ine bağlıdır.
 */
export function yayinDinle(dinleyici: () => void): () => void {
  const kanal = kanalAc();
  if (!kanal) return () => {};
  const isle = (olay: MessageEvent) => {
    if ((olay.data as VitrinOlayi | undefined)?.tip === "yayinlandi") dinleyici();
  };
  kanal.addEventListener("message", isle);
  return () => {
    kanal.removeEventListener("message", isle);
    kanal.close();
  };
}
