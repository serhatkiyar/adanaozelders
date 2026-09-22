import { ROLE_IDS } from "@/types";
import { ROUTES } from "@/lib/routes";

// Mağazada ALICI olabilen roller. Eğitmen kendi oturumuyla alışveriş yapar;
// backend onu bir `Client` yansımasına ("gölge") çevirir — bkz.
// docs/egitmen-alici-sozlesme.md. Bu liste TEK KAYNAKTIR: alıcı yüzeylerinde
// çıplak `role_id === ROLE_IDS.CLIENT` karşılaştırması yapılmaz.
//
// Kapsam yalnız MAĞAZADIR: ders rezervasyonu, kütüphane ve talepler hâlâ
// üyeye özeldir ve bu yardımcıyı kullanmaz.
export const ALISVERIS_ROLLERI: readonly number[] = [
  ROLE_IDS.CLIENT,
  ROLE_IDS.TUTOR,
];

export function alisverisYapabilir(roleId: number | null | undefined): boolean {
  return roleId != null && ALISVERIS_ROLLERI.includes(roleId);
}

/* ══ ROL ETİKETLERİ — TEK KAYNAK ═════════════════════════════════════════
 *
 * ## "Öğrenci" neden rol adı DEĞİL
 *
 * Talep tarafındaki hesap sahibi öğrenci olmak zorunda değil ve çoğu zaman
 * değil de:
 *
 *  - `backend/core/flags.py:145` — 18 yaş altı rezervasyon KAPALI, gerekçesi
 *    kodda yazılı: "Veli (Guardian) modeli yazılana kadar." Yani hesap sahibi
 *    tanım gereği ödeyen YETİŞKİN; dersi alan kişi olmak zorunda değil.
 *  - `lib/legalContent.ts` (Mesafeli Satış · Taraflar) tek ad seçememiş:
 *    "ALICI: … öğrenci/müşteri". Eğik çizgi, kelimenin ürünü kapsamadığının
 *    yazılı itirafı.
 *  - Aynı kişi ders alıyor, KİTAP SATIN ALIYOR, KÜTÜPHANE REZERVE EDİYOR.
 *    Mağazada o kişi müşteri; "öğrenci" ürünün yalnız bir köşesini anlatıyor.
 *
 * Yapısal katman zaten nötr (`RoleType.CLIENT`, tablo `clients`, `client_id`);
 * "öğrenci" yalnız SUNUM katmanındaydı ve 7 ayrı dosyada elle yazılıydı.
 *
 * ## Kural
 *
 *  1. Rol/kimlik etiketi olarak "Öğrenci" KULLANILMAZ → "Üye".
 *  2. Belirli bir kişi anılırken ADI kullanılır; ad yoksa `ADSIZ_UYE`.
 *  3. "Öğrenci" HEDEF KİTLEYİ anlatan pazarlama metninde KALIR
 *     ("öğrenciler seni aramada bulur") — orada gerçekten öğrenci kastediliyor.
 *
 * Nöbetçi: `__guards__/rolEtiketi.test.ts` — etiket bu dosyanın dışında elle
 * yazılamaz. Sekizinci kopyanın sessizce doğmasını o düğüm engelliyor.
 */
export const ROL_ETIKETI: Record<number, string> = {
  [ROLE_IDS.ADMIN]: "Yönetici",
  [ROLE_IDS.TUTOR]: "Öğretmen",
  [ROLE_IDS.CLIENT]: "Üye",
  [ROLE_IDS.LIBRARY_OPERATOR]: "Operatör",
  [ROLE_IDS.COURIER]: "Kurye",
};

/** Rol kimliğinden görünen ad. Bilinmeyen rolde boş döner, uydurmaz. */
export function rolEtiketi(roleId: number | null | undefined): string {
  return roleId != null ? (ROL_ETIKETI[roleId] ?? "") : "";
}

/**
 * Adı olmayan kişinin yerine yazılan söz.
 *
 * `client_name ?? "Öğrenci"` deseni dokuz ekranda tekrarlıyordu; hepsi buraya
 * bağlandı. Yedek bir ROL adı değil, adsızlığın karşılığıdır — kişinin ne
 * olduğunu iddia etmez.
 */
export const ADSIZ_UYE = "Üye";

// Eğitmen doğrudan panosuna (`/genel-bakis`) gider (kullanıcı kararı, 22 Eyl 2026).
// Diğer roller kök (`/`) workspace'inden başlar; `RootDispatcher` orada role
// göre uygun ekranı (operatör/kurye paneli ya da keşif Landing'i) render eder.
export function roleHome(roleId: number | null | undefined): string {
  switch (roleId) {
    case ROLE_IDS.TUTOR:
      return ROUTES.bookings;
    case ROLE_IDS.ADMIN:
    case ROLE_IDS.CLIENT:
    case ROLE_IDS.LIBRARY_OPERATOR:
    case ROLE_IDS.COURIER:
      return ROUTES.home;
    default:
      return ROUTES.login;
  }
}
