/**
 * Agora medya katmanı — üç KALICI, boş oynatıcı yuvası:
 *
 *   - `karsi`    karşı tarafın kamerası (video kabında, `karsiKaro`)
 *   - `ben`      kendi kameram (video kabında, `benKaro`; ayna SDK'da)
 *   - `paylasim` paylaşım paneli: kendi ekranım ya da karşı tarafınki
 *
 * Hangi izin hangi yuvada oynayacağına `istemci.ts` karar verir (`ciz`);
 * burası yalnız yuvaları kaydeder ve sahnenin nötr durumunu iletir. Yuvaların
 * React çocuğu YOKTUR: SDK kendi oynatıcı düğümünü içlerine koyar.
 *
 * Paylaşım başlığı, ayna uyarısı ve karo katmanları GENEL sahnededir
 * (`oda/VideoSahnesi.tsx`); burası yalnız medyayı çizer. Kaplar koşullu
 * çizilmez, yeniden kurulmaz: yalnız hesaplanan dikdörtgenlerle yer değiştirir.
 */
import { useCallback, useEffect } from "react";

import type { MedyaKatmaniProps } from "../tipler";
import { yer } from "../yer";
import { katmaniGuncelle, yuvaKaydet } from "./istemci";

export function MedyaKatmani({
  yerlesim: y,
  paylasimBaslikPx,
  ayna,
  karsiId,
  aktifPaylasim,
  benPaylasiyorum,
  benGorunur,
  karsiGorunur,
  karsiKalite,
  paylasimDonusumKabi,
}: MedyaKatmaniProps) {
  const benYuvasi = useCallback((el: HTMLDivElement | null) => yuvaKaydet("ben", el), []);
  const karsiYuvasi = useCallback((el: HTMLDivElement | null) => yuvaKaydet("karsi", el), []);
  const paylasimYuvasi = useCallback((el: HTMLDivElement | null) => yuvaKaydet("paylasim", el), []);

  // Görünürlük ve kalite sürücüye nötr iner: gizli karşı kamerada abonelik
  // bırakılır, düşük kalitede düşük akış istenir (`surucu.ts`).
  useEffect(() => {
    katmaniGuncelle({
      karsiId,
      aktifPaylasim,
      benPaylasiyorum,
      ayna,
      benGorunur,
      karsiGorunur,
      karsiKalite,
    });
  }, [karsiId, aktifPaylasim, benPaylasiyorum, ayna, benGorunur, karsiGorunur, karsiKalite]);

  const paylasimGorunur = (benPaylasiyorum || aktifPaylasim !== null) && y.paylasim !== null;
  const uzakK = karsiId !== null ? y.karsiKaro : null;
  const yuzenSinif = y.yuzen ? "rounded-ders shadow-[0_8px_32px_rgba(18,17,23,0.15)]" : "";
  // İki karolu yüzen kutu: kendi karo sol köşeler, karşı taraf sağ köşeler.
  // Kendi görüntüm gizliyken karşı karo tek başına: dört köşe yuvarlak.
  const benKose = y.yuzen && uzakK ? "rounded-l-ders" : "rounded-ders";
  const karsiKose = y.yuzen && y.benGorunur ? "rounded-r-ders" : "rounded-ders";

  return (
    <>
      {/* 1) video kabı — karoların alanı. Kap AYNI düğümdür; yalnız
          boyutu/konumu değişir, oynatıcılar yeniden kurulmaz. */}
      <div className={`absolute z-10 ${yuzenSinif}`} style={yer(y.video)}>
        <div
          ref={karsiYuvasi}
          className={`absolute overflow-hidden ${karsiKose}`}
          style={yer(uzakK, y.video)}
        />
        <div
          ref={benYuvasi}
          className={`absolute overflow-hidden ${benKose}`}
          style={yer(y.benKaro, y.video)}
        />
      </div>

      {/* 2) paylaşım paneli — kalıcı; paylaşım yokken gizli. Başlık (üstteki
          `paylasimBaslikPx`) genel sahnede, bu panelin üstüne çizilir. */}
      <div
        className="absolute overflow-hidden rounded-t-ders bg-black"
        style={yer(paylasimGorunur ? y.paylasim : null)}
        aria-hidden={!paylasimGorunur}
      >
        {/* Yakınlaştırma dönüşümü yuvanın sarmalayıcısında (yuva taşınmaz);
            karşı paylaşım SDK'da `contain` oynar. */}
        <div className="absolute inset-x-0 bottom-0 overflow-hidden" style={{ top: paylasimBaslikPx }}>
          <div ref={paylasimDonusumKabi} className="absolute inset-0">
            <div ref={paylasimYuvasi} className="absolute inset-0" />
          </div>
        </div>
      </div>
    </>
  );
}
