/**
 * Medusa UI — Türkçe taban katmanı (İP-A1)
 *
 * SÖZLEŞME (kalıcı): Ekran dosyaları hiçbir zaman doğrudan `@medusajs/ui`'den
 * import etmez. Her şey bu `ui2/` katmanından geçer. Böylece Türkçe metinler
 * ekranlara dağılmaz, tek yerde toplanır.
 *
 * Bu dosya İP-A1'de KASITLI OLARAK boştur: aşağıdaki `translations` nesneleri
 * tanımlı ama içerikleri, ilgili bileşen ilk kullanıldığı pakette doldurulacak.
 * Amaç, sözleşmeyi ve tipleri baştan sabitlemek.
 */
import type * as React from "react";
import { I18nProvider, Table } from "@medusajs/ui";

/** Uygulama genelinde kullanılan locale. `DatePicker`/`Calendar` ay-gün adları buradan gelir. */
export const MEDUSA_LOCALE = "tr-TR";

type TablePaginationTranslations = NonNullable<
  React.ComponentProps<typeof Table.Pagination>["translations"]
>;

/** `Table.Pagination` Türkçe metinleri — kullanıldığı pakette doldurulacak. */
export const tablePaginationTr: TablePaginationTranslations = {};

// NOT (kalıcı karar, İP-A2): Medusa'nın `DataTable`'ı ALINMIYOR — bu yüzden
// `dataTableToolbarTr` iskelesi silindi. Gerekçe: bizim `DataTable`'ımızda
// `renderMobileRow` mobil kart deseni ve sunucu taraflı sıralama göstergesi
// var, Medusa'nınkinde ikisi de yok; ayrıca `DataTable.Filter`'ın prop'la
// çevrilemeyen 12 İngilizce dizesi var. Kullanılmayacak bir iskele bırakmak,
// "bu geçiş yapılacak" izlenimi verirdi.

/**
 * `usePrompt` Türkçe varsayılanları (İP-A3a'da dolduruldu).
 *
 * Bunlar TÜM onay pencerelerinin ortak metinleridir; pencereye özgü
 * başlık/açıklama aşağıdaki gibi ayrı sabitlerde durur. Ortak metinleri her
 * çağrı yerine yazmak, zamanla "İptal"/"Vazgeç"/"Kapat" üçlemesi üretirdi.
 */
export const promptTr: {
  cancelText?: string;
  confirmText?: string;
  verificationInstruction?: string;
} = {
  cancelText: "Vazgeç",
  confirmText: "Çık",
  verificationInstruction: "Onaylamak için aşağıdaki metni yazın:",
};

/**
 * Kirli form bekçisinin onay penceresi (İP-A3a).
 *
 * `variant: "danger"` bilinçli: onaylanan eylem **veri kaybıdır**. Metin
 * neyin kaybolacağını söyler — "Emin misiniz?" tek başına kullanıcıya neyi
 * kaybedeceğini anlatmaz.
 */
export const kirliFormPromptTr = {
  ...promptTr,
  variant: "danger" as const,
  title: "Kaydedilmemiş değişiklikler var",
  description:
    "Bu pencereyi kapatırsanız girdiğiniz bilgiler kaydedilmeden silinir.",
};

/**
 * Rota gezinmesi bekçisinin onay metinleri (İP-A6 · Görev 3).
 *
 * Pencere kapatmadan AYRI metin: kullanıcı orada "bu pencereyi kapatıyorum"
 * niyetiyle, burada "başka bir sayfaya gidiyorum" niyetiyle hareket eder.
 * Aynı metni ikisine birden vermek, ikinci durumda neyin olacağını yanlış
 * anlatırdı ("pencere" diye bir şey yok, sayfa değişiyor).
 *
 * Bu sabit Medusa'nın `usePrompt` biçiminde DEĞİL, panelin kendi
 * `ConfirmDialog`ının prop'ları biçiminde: gezinme onayı Medusa'nın
 * `AlertDialog`unu her yönetim sayfasının ilk yüküne sokuyordu
 * (`gezinmeBekcisi.tsx` → `useGezinmeOnayi` gerekçesi).
 */
export const GEZINME_ONAYI = {
  baslik: "Kaydedilmemiş değişiklikler var",
  aciklama:
    "Başka bir sayfaya geçerseniz girdiğiniz bilgiler kaydedilmeden silinir.",
  onay: "Sayfadan ayrıl",
};

/** Uygulama kökünü saran Medusa locale sağlayıcısı. */
export function MedusaI18nProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <I18nProvider locale={MEDUSA_LOCALE}>{children}</I18nProvider>;
}
