// Kamerayla QR okuma neden çalışmıyor? — saf teşhis (test edilebilir).
//
// ## Neden ayrı bir modül
//
// Eski kod tek bir kontrol yapıyordu (`"BarcodeDetector" in window`) ve
// başarısız olduğunda **"bu tarayıcı desteklemiyor"** diyordu. Bu teşhis sahada
// yanlış yönlendirdi: telefon yerel ağdan `http://192.168.x.x` ile bağlanınca
// Android Chrome da aynı mesajı veriyordu — oysa Chrome QR okumayı destekler.
//
// Gerçek sebep **güvenli bağlam (secure context)**: `BarcodeDetector` ve
// `navigator.mediaDevices` spesifikasyonda `[SecureContext]` ile işaretlidir,
// yani düz `http://` üzerinden (localhost hariç) tarayıcı bu API'leri HİÇ
// göstermez. `window.BarcodeDetector` tanımsız olur ve kod "tarayıcı
// desteklemiyor" sonucuna varır.
//
// Aynı sayfada **teslim kanıtı fotoğrafı çalışıyordu**, çünkü o
// `<input type="file" accept="image/*" capture="environment">` kullanıyor —
// dosya girişi güvenli bağlam gerektirmez. Kullanıcının gördüğü bu asimetri
// tam olarak buradan geliyor.
//
// İki durumu ayırmak önemli: biri **dağıtım/erişim** sorunudur (HTTPS gerekir),
// diğeri gerçek bir **tarayıcı** kısıtıdır (iOS Safari). Çözümleri farklıdır.

export type QrScanMode =
  /** Kamera kullanılabilir. */
  | "camera"
  /** Sayfa güvenli bağlamda değil (düz http). API'ler gizli — HTTPS gerekiyor. */
  | "insecure-context"
  /** Güvenli bağlam var ama tarayıcı BarcodeDetector sunmuyor (iOS Safari). */
  | "unsupported-browser";

export interface QrEnvironment {
  isSecureContext?: boolean;
  hasBarcodeDetector: boolean;
  hasMediaDevices: boolean;
  protocol?: string;
  hostname?: string;
}

/** Tarayıcı ortamını okur (test edilebilirlik için ayrı). */
export function readQrEnvironment(win: typeof globalThis & Partial<Window>): QrEnvironment {
  return {
    isSecureContext: win.isSecureContext,
    hasBarcodeDetector: "BarcodeDetector" in win,
    hasMediaDevices: !!win.navigator?.mediaDevices?.getUserMedia,
    protocol: win.location?.protocol,
    hostname: win.location?.hostname,
  };
}

export function qrScanMode(env: QrEnvironment): QrScanMode {
  if (env.hasBarcodeDetector && env.hasMediaDevices) return "camera";

  // `isSecureContext` false ise sebep kesin: API'ler gizlendiği için yoklar.
  // Tarayıcı yeteneği hakkında bir şey söyleyemeyiz — HTTPS'te tekrar bakmak
  // gerekir. Bu yüzden "desteklemiyor" DEMİYORUZ.
  if (env.isSecureContext === false) return "insecure-context";

  return "unsupported-browser";
}

/** Kullanıcıya gösterilecek başlık + ne yapması gerektiği. */
export function qrScanDiagnosis(env: QrEnvironment): { title: string; hint: string } {
  const mode = qrScanMode(env);
  if (mode === "insecure-context") {
    const host = env.hostname ? ` (${env.protocol}//${env.hostname})` : "";
    return {
      title: `Kamera bu bağlantıda kullanılamıyor${host}.`,
      hint:
        "Tarayıcılar kamerayı yalnızca HTTPS bağlantılarda açar; düz http:// " +
        "üzerinden QR okuma devre dışı kalır. Telefonun tarayıcısı sorunsuz " +
        "adrese HTTPS ile bağlanıldığında kamera çalışır. Şimdilik kodu elle " +
        "girebilirsiniz.",
    };
  }
  return {
    title: "Bu tarayıcı kamerayla QR taramayı desteklemiyor.",
    hint:
      "iOS Safari bu özelliği sunmuyor. Kodu elle girebilir veya USB barkod " +
      "okuyucu kullanabilirsiniz.",
  };
}
