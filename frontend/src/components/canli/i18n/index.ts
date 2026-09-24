/**
 * Canlı ders odasına özel i18next örneği — YALNIZ bu tembel parçada.
 *
 * Sitenin geri kalanı i18n kullanmaz; küresel `i18next` örneğine dokunmamak
 * için `createInstance()`. Kaynak satır içi ve init EŞZAMANLI (`initAsync:
 * false`): ilk çizimde ham anahtar görünmez.
 */
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import { tr } from "./tr";

export const dersI18n = createInstance();

void dersI18n.use(initReactI18next).init({
  lng: "tr",
  fallbackLng: "tr",
  ns: ["rooms"],
  defaultNS: "rooms",
  resources: { tr },
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});
