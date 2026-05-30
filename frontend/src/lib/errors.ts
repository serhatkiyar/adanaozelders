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
      return "Oturum süren dolmuş. Lütfen tekrar giriş yap.";
    }

    // Return raw detail if nothing matched
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first?.msg) return String(first.msg);
    }
  }
  return fallback;
}
