/**
 * Gönder düğmesi taraması — kilitli kararın panel geneli nöbetçisi
 * (İP-A8 · Görev 6 · B-10).
 *
 * ## Neden var
 *
 * Göçün kilitli kararlarından biri: **gönder düğmesi geçerlilikle kapanmaz.**
 * Kullanıcı basar, gitmemesinin sebebini ALANDA okur. Karar 21 göç eden
 * ekranda uygulandı ama panelin tamamında bir nöbetçisi YOKTU — yalnız gözden
 * geçirmeyle korunuyordu.
 *
 * Bağımsız denetim #3 bunu elle tarayarak buldu (B-10): `DeliveryOrdersPage`
 * hiçbir göç dalgasının kapsamına girmemişti ve "Kargola" düğmesi
 * `disabled={!tracking.trim()}` yazıyordu, hata slotu yoktu. Elle bulunan bir
 * ihlal, nöbetçisi olmayan bir karar demektir; bu tarama o boşluğu kapatır.
 *
 * ## Ne yapar
 *
 * Ölçüm tabanındaki HER `<Button>`/`<button>` üzerindeki `disabled` ifadesini
 * AST'ten okur ve **dosya + normalize edilmiş ifade** kimliğiyle döndürür.
 * Nöbetçi (`__guards__/gonderDugmesi.test.ts`) bu listeyi kimlikle sabitler:
 * yeni bir `disabled` çağrı yeri, sınıfı ve gerekçesi yazılmadan doğamaz.
 *
 * Kimlik SATIR NUMARASI TAŞIMAZ. Sebep somut: aynı dosyada bir satır eklemek
 * ilgisiz onlarca kaydı kaydırır ve nöbetçi gürültüye dönüşür — gürültülü
 * nöbetçi, susturulan nöbetçidir.
 *
 * ## Kimliğin ikinci parçası: ÇAĞRI SAYISI (doğrulama turu · D-1)
 *
 * İlk yazımda tarama `new Set` ile TEKİLLEŞTİRİYORDU ve bu, satır numarasından
 * vazgeçmenin ölçülmemiş bedeliydi: aynı dosyaya **aynı ifadeyle** eklenen
 * ikinci bir geçerlilik kapısı nöbetçiye hiç görünmüyordu. Bağımsız doğrulama
 * turu bunu ters provayla kanıtladı — `PackingStationPage`e ikinci bir
 * `<Button disabled={!kod.trim()}>` konduğunda nöbetçi **8/8 yeşil** kaldı;
 * raporun "dokuzuncusu doğduğu gün CI kırılır" cümlesi o şekil için yanlıştı.
 *
 * Artık tarama tekilleştirmez, **sayar**: kimlik `dosya + etiket + ifade` ve
 * yanında o kimliğin kaç kez geçtiği. Nöbetçi ikisini birden dondurur, yani
 * hem yeni bir şekil hem aynı şeklin tekrarı kırmızı üretir. Satır numarasına
 * DÖNÜLMEDİ — gürültü gerekçesi hâlâ geçerli; sayı, satır numarasının ayırt
 * etme gücünü onun gürültüsü olmadan geri getiriyor.
 *
 * Bugünkü fark ölçüldü: **77 ham çağrı yeri, 62 benzersiz kimlik.** Aradaki 15
 * tekrarın hepsi `islem` sınıfında (`isPending`/`busy`); hiçbiri geçerlilik
 * borcu değil.
 *
 * ## Sınıflandırma nöbetçide, burada DEĞİL
 *
 * Bu dosya bilerek yalnız ÖLÇER. "Bu `disabled` meşru mu" sorusu bir yargıdır
 * ve yargı, gerekçesiyle birlikte nöbetçinin kaydında yaşar. Sezgisel bir
 * sınıflandırıcı (ör. "ifadede `isPending` geçiyorsa meşrudur") burada
 * yazılsaydı, `disabled={busy || !kod.trim()}` gibi KARIŞIK bir ifade sessizce
 * aklanırdı — tarama aletlerinin bu projede beş kez tökezlediği yer tam olarak
 * "sezgisel aklama"dır.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { OLCUM_TABANI } from "./ui-baseline-sayim.mjs";

const ROOT = process.cwd();

/** Bir dosyadaki `disabled` taşıyan düğmeler — `{dosya, etiket, ifade}`. */
export function disabledDugmeleri(kaynak, dosyaAdi) {
  const sf = ts.createSourceFile(dosyaAdi, kaynak, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  const gez = (n) => {
    const acilis = ts.isJsxElement(n)
      ? n.openingElement
      : ts.isJsxSelfClosingElement(n)
        ? n
        : null;
    if (acilis) {
      const etiket = acilis.tagName.getText();
      if (etiket === "Button" || etiket === "button") {
        for (const o of acilis.attributes.properties) {
          if (ts.isJsxAttribute(o) && o.name.getText() === "disabled" && o.initializer) {
            const ham = ts.isJsxExpression(o.initializer)
              ? (o.initializer.expression?.getText() ?? "")
              : o.initializer.getText();
            out.push({ etiket, ifade: ham.replace(/\s+/g, " ").trim() });
          }
        }
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

/**
 * Ölçüm tabanının tamamı — **kimlik → ÇAĞRI SAYISI**, kimliğe göre sıralı.
 *
 * TEKİLLEŞTİRMEZ (doğrulama turu · D-1): aynı dosyadaki aynı ifadenin ikinci
 * kez yazılması da bir olaydır ve nöbetçinin görmesi gerekir.
 */
export function tabanSayimi(taban = OLCUM_TABANI) {
  const sayac = new Map();
  for (const dosya of taban) {
    if (!dosya.endsWith(".tsx")) continue;
    for (const d of disabledDugmeleri(readFileSync(join(ROOT, dosya), "utf8"), dosya)) {
      const kimlik = `${dosya} <${d.etiket}> ${d.ifade}`;
      sayac.set(kimlik, (sayac.get(kimlik) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...sayac.keys()].sort().map((k) => [k, sayac.get(k)]));
}

/** Ölçüm tabanının tamamı — sıralı, BENZERSİZ kimlik dizeleri hâlinde. */
export function tabanTaramasi(taban = OLCUM_TABANI) {
  return Object.keys(tabanSayimi(taban));
}

if (process.argv[1] && process.argv[1].endsWith("gonder-dugmesi.mjs")) {
  const sayim = tabanSayimi();
  const kimlikler = Object.keys(sayim);
  const ham = Object.values(sayim).reduce((a, b) => a + b, 0);
  console.log(`DISABLED DÜĞME: ${kimlikler.length} kimlik / ${ham} ham çağrı yeri`);
  for (const k of kimlikler) console.log(` ${sayim[k] > 1 ? "x" + sayim[k] : "  "} ${k}`);
}
