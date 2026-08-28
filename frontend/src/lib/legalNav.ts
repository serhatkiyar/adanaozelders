// Yasal sayfa linkleri — footer/kayıt formu gibi EAGER bundle'lardan tüketilir.
// lib/legalContent.ts'i (tüm metinleri) BİLEREK import etmez: ana chunk şişmesin.
// Başlıkların legalContent ile tutarlılığı Vitest'le doğrulanır (legalContent.test.ts).

import { LEGAL_ROUTES } from "@/lib/routes";
import type { LegalDocId } from "@/lib/legalContent";

export interface LegalNavItem {
  id: LegalDocId;
  title: string;
  path: string;
}

export const LEGAL_NAV: readonly LegalNavItem[] = [
  { id: "about", title: "Hakkımızda", path: LEGAL_ROUTES.about },
  { id: "kvkk", title: "KVKK Aydınlatma Metni", path: LEGAL_ROUTES.kvkk },
  { id: "privacy", title: "Gizlilik Politikası", path: LEGAL_ROUTES.privacy },
  { id: "terms", title: "Kullanım Koşulları", path: LEGAL_ROUTES.terms },
  { id: "preliminary-info", title: "Ön Bilgilendirme Formu", path: LEGAL_ROUTES["preliminary-info"] },
  { id: "distance-sales", title: "Mesafeli Satış Sözleşmesi", path: LEGAL_ROUTES["distance-sales"] },
  { id: "refund", title: "Teslimat, İptal ve İade Politikası", path: LEGAL_ROUTES.refund },
  { id: "cookies", title: "Çerez Politikası", path: LEGAL_ROUTES.cookies },
  { id: "ranking-criteria", title: "Sıralama Ölçütleri", path: LEGAL_ROUTES["ranking-criteria"] },
];
