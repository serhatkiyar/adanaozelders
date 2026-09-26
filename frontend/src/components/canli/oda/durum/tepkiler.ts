/**
 * Tepkiler ve el kaldırma — sağlayıcıdan bağımsız mantık (hız sınırı,
 * bekleyen el, yeniden gönderme). Taşıyıcı Centrifugo `ders:{id}` kanalıdır
 * (`tahta/dersKanali.ts`); kanal yoksa (`tepkiKanali` false) düğmeler hiç
 * çizilmez (`Tepkiler.tsx`).
 *
 * Kanalda geçmiş yok: geç katılan / yeniden abone olan kalkık eli
 * `elSor` ile sorar, eli kalkık olan yeniden bildirir.
 */
import type { DersRolu } from "../../video/tipler";
import {
  benKimim,
  eliDegisti,
  tepkiEkle,
  tepkiGondereni,
  tepkiMesajiCoz,
  tepkiMesajiYaz,
  tepkiSil,
  type TepkiEmojisi,
  type TepkiMesaji,
} from "./indirgeyiciler";
import { depoyaUygula, useOdaDeposu } from "./odaDeposu";

/** Tepki mesajlarının taşıyıcısı (bugün Centrifugo ders kanalı). */
export interface Tasiyici {
  /** Kanala yayınlar; başarısızsa `false`. */
  gonder: (veri: object) => Promise<boolean>;
  /** Gelen tepki mesajları; gönderenin rolü kanal bilgisinden (`chanInfo.rol`). */
  dinle: (f: (veri: unknown, gonderenRol: DersRolu | null) => void) => () => void;
}

/**
 * Taşıyıcının hız sınırına karşı istemci tarafında bu aralıkla sınırlanır:
 * tepki aralık dolmadan gelirse düşer, el durumu aralık dolunca gönderilir.
 */
const KOMUT_ARALIGI_MS = 600;
/** Tepki ekranda bu kadar kalır (animasyon süresiyle aynı; Meet 3 sn). */
export const TEPKI_SURESI_MS = 3000;

let tasiyici: Tasiyici | null = null;
let benimRolum: DersRolu | null = null;
let elKaldirildi: ((ad: string) => void) | undefined;
let sonKomut = 0;
let bekleyenEl: number | undefined;
let tepkiSayaci = 0;

/**
 * Taşıyıcıyı bağlar; dönen fonksiyon söker. `rol` biletteki kendi rolüm
 * (gönderen eşlemesi için).
 */
export function tepkileriBagla(
  t: Tasiyici,
  rol: DersRolu,
  secenekler: { elKaldirildi?: (ad: string) => void } = {},
): () => void {
  tasiyici = t;
  benimRolum = rol;
  elKaldirildi = secenekler.elKaldirildi;
  const coz = t.dinle(mesajGeldi);
  return () => {
    coz();
    if (tasiyici === t) tasiyici = null;
    window.clearTimeout(bekleyenEl);
    bekleyenEl = undefined;
  };
}

function mesajGeldi(veri: unknown, gonderenRol: DersRolu | null): void {
  const mesaj = tepkiMesajiCoz(veri);
  if (!mesaj) return;
  const d = useOdaDeposu.getState();
  if (mesaj.tur === "elSor") {
    if (d.elimKalkik) elDurumunuGonder();
    return;
  }
  const gonderen = tepkiGondereni(d, gonderenRol, benimRolum);
  if (mesaj.tur === "tepki") {
    tepkiGoster(mesaj.emoji, gonderen?.ad ?? "", false);
    return;
  }
  if (!gonderen) return;
  const onceden = d.kalkikEller.includes(gonderen.id);
  depoyaUygula((x) => eliDegisti(x, gonderen.id, mesaj.kalkik));
  if (mesaj.kalkik && !onceden) elKaldirildi?.(gonderen.ad);
}

function tepkiGoster(emoji: TepkiEmojisi, ad: string, ben: boolean): void {
  const id = ++tepkiSayaci;
  const sol = 0.04 + Math.random() * 0.22;
  depoyaUygula((d) => tepkiEkle(d, { id, emoji, ad, ben, sol }));
  // `animationend`e bağlanmaz: hareket azaltıldığında animasyon yoktur.
  window.setTimeout(() => depoyaUygula((d) => tepkiSil(d, id)), TEPKI_SURESI_MS);
}

/** Kanaldaki herkese gönderir; başarısızsa `false`. */
async function komutGonder(mesaj: TepkiMesaji): Promise<boolean> {
  const t = tasiyici;
  if (!t) return false;
  sonKomut = Date.now();
  try {
    return await t.gonder(tepkiMesajiYaz(mesaj));
  } catch (e) {
    // Tek bir gönderim hatası kanalı kapatmaz; düğmeleri yalnız kanal durumu gizler.
    console.warn("Tepki kanalı", e);
    return false;
  }
}

/** Tepki gönderir ve kendi ekranımda da gösterir (kendi yankım bana dönmez). */
export function tepkiGonder(emoji: TepkiEmojisi): void {
  if (Date.now() - sonKomut < KOMUT_ARALIGI_MS) return;
  tepkiGoster(emoji, benKimim(useOdaDeposu.getState())?.ad ?? "", true);
  void komutGonder({ tur: "tepki", emoji });
}

function elDurumunuGonder(): void {
  window.clearTimeout(bekleyenEl);
  const bekle = Math.max(0, sonKomut + KOMUT_ARALIGI_MS - Date.now());
  bekleyenEl = window.setTimeout(() => {
    bekleyenEl = undefined;
    const kalkik = useOdaDeposu.getState().elimKalkik;
    void komutGonder({ tur: "el", kalkik }).then((tamam) => {
      if (!tamam && kalkik) depoyaUygula((d) => ({ ...d, elimKalkik: false }));
    });
  }, bekle);
}

/** Elimi kaldırır / indirir. */
export function elimiDegistir(kalkik: boolean): void {
  depoyaUygula((d) => (d.elimKalkik === kalkik ? d : { ...d, elimKalkik: kalkik }));
  elDurumunuGonder();
}

/**
 * Karşı tarafı (yeniden) öğrenme anı: kanala (yeniden) abone olundu, yeni
 * bir katılımcı göründü (kimliği değişmiş olabilir). Kalkık elim yeniden
 * bildirilir, karşı tarafınki sorulur.
 */
export function elleriEsitle(): void {
  if (!tasiyici) return;
  void komutGonder({ tur: "elSor" });
  if (useOdaDeposu.getState().elimKalkik) elDurumunuGonder();
}

/** Kendi bağlantım yeniden kuruldu: kimliğim değişmiş olabilir. */
export function elimiYenidenBildir(): void {
  if (tasiyici && useOdaDeposu.getState().elimKalkik) elDurumunuGonder();
}
