import { AxiosError } from "axios";

// Backend İngilizce detail metinlerini kullanıcı dostu Türkçe yönergelere çevirir.
const DETAIL_GUIDANCE: { match: RegExp; message: string }[] = [
  {
    match: /time slot conflicts/i,
    message:
      "Seçtiğin saat aralığı bu eğitmende dolu. Lütfen farklı bir gün ya da saat seç.",
  },
  {
    match: /weekly question quota/i,
    message:
      "Haftalık soru kotanı doldurdun. Kotan her hafta yenilenir; daha sonra tekrar dene.",
  },
  {
    match: /email already registered/i,
    message: "Bu e-posta zaten kayıtlı. Giriş yapmayı deneyebilirsin.",
  },
  {
    // Giriş ekranındaki 401. Hangi alanın yanlış olduğu BİLEREK söylenmez:
    // "bu e-posta kayıtlı ama parola yanlış" demek, sisteme kayıtlı adresleri
    // dışarıdan tek tek doğrulatmak (hesap sayımı) demektir.
    match: /incorrect email or password/i,
    message: "E-posta veya parola hatalı.",
  },
  {
    match: /already been reviewed/i,
    message: "Bu ders için zaten bir değerlendirme bıraktın.",
  },
  {
    match: /completed bookings can be reviewed/i,
    message: "Yalnızca tamamlanmış dersleri değerlendirebilirsin.",
  },
];

function translateDetail(detail: string): string {
  for (const { match, message } of DETAIL_GUIDANCE) {
    if (match.test(detail)) return message;
  }
  return detail;
}

/**
 * Sunucunun `detail` metnini KORUYAN hata çevirisi — yönetim ekranları için.
 *
 * `getErrorMessage` 409'u genel bir "Bir çakışma oluştu" metnine çeviriyor;
 * müşteri yüzeyinde bu doğru (ham backend metni kullanıcıya bir şey anlatmaz),
 * ama yönetim ekranında BİLGİ KAYBIDIR: "Ürün açık siparişte kullanılıyor" ya
 * da "Gönderilmiş bir bildirim ikinci kez gönderilmez" eyleme dönüşebilir,
 * genel metin dönüşemez.
 *
 * `AxiosError` örneği olup olmamasına bakmaz — yalnız gövdedeki `detail`
 * alanını okur; bu yüzden interceptor/sarmalayıcı zincirinden bağımsızdır.
 */
export function getErrorDetail(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response
    ?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  return getErrorMessage(error, fallback);
}

// FastAPI hata gövdesinden okunabilir, kullanıcı dostu bir mesaj çıkarır.
export function getErrorMessage(
  error: unknown,
  fallback = "Bir hata oluştu."
): string {
  if (error instanceof AxiosError) {
    if (error.code === "ERR_NETWORK") {
      return "Sunucuya ulaşılamıyor. Backend çalışıyor mu?";
    }

    const status = error.response?.status;
    const detail = error.response?.data?.detail;

    // Try detail-text translation first (covers most 409/429 cases with context)
    if (typeof detail === "string") {
      const translated = translateDetail(detail);
      if (translated !== detail) return translated; // matched a pattern
    }

    // HTTP status-level fallbacks for unrecognised responses
    if (status === 429) {
      return "Çok fazla istek gönderdin. Lütfen biraz bekle ve tekrar dene.";
    }
    if (status === 409) {
      return "Bir çakışma oluştu. Sayfayı yenileyip tekrar deneyin.";
    }
    if (status === 403) {
      return "Bu işlem için yetkin yok.";
    }
    if (status === 401) {
      /* 401 HER ZAMAN "oturumun düştü" DEMEK DEĞİLDİR (19 Eyl 2026, kullanıcı
         canlıda buldu). Giriş ekranında yanlış parola da 401'dir; DETAIL_GUIDANCE'a
         eklenen "incorrect email or password" deseni bunu yukarıdaki genel
         `translateDetail` denemesinde (satır ~76) zaten yakalayıp döndürür.
         Buraya yalnız EŞLEŞMEYEN 401'ler düşer: gerçek jeton süresi dolumu
         (`backend/api/deps.py::_credentials_exception`, "Could not validate
         credentials") bunlardan biri. O metni İngilizce ham haliyle
         göstermek eski hataydı — burada AYNEN öyle davranmak yeni bir hata
         olurdu, o yüzden eşleşmeyen her 401 genel Türkçe cümleye düşer. */
      return "Oturum süren dolmuş. Lütfen tekrar giriş yap.";
    }

    // Return raw detail if nothing matched
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first?.msg) return String(first.msg);
    }

    // Yapılandırılmış (obje) detail. Bazı uçlar makinece okunabilir bir gövde
    // döndürür ve içine KULLANICI İÇİN yazılmış bir `message` koyar — ör. ödeme
    // kolu kapalıyken `{code, branch, message}`
    // (backend/services/payment_gates.py::assert_branch_open). Bu dal olmadan
    // obje detail hiçbir kontrole uymuyor ve fonksiyon çağıranın genel
    // fallback'ine düşüyordu: sunucunun açıkladığı "neden" sessizce kayboluyordu.
    //
    // Bilinçli olarak duruma (503) değil DETAIL BİÇİMİNE bağlı: aynı desendeki
    // her uç kendiliğinden faydalansın. Durum-kodu dallarından SONRA duruyor ki
    // 429/409/403/401'in mevcut davranışı aynen korunsun.
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return fallback;
}
