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

/** Ölçüm tabanının tamamı — sıralı, kimlik dizeleri hâlinde. */
export function tabanTaramasi(taban = OLCUM_TABANI) {
  const satirlar = [];
  for (const dosya of taban) {
    if (!dosya.endsWith(".tsx")) continue;
    for (const d of disabledDugmeleri(readFileSync(join(ROOT, dosya), "utf8"), dosya)) {
      satirlar.push(`${dosya} <${d.etiket}> ${d.ifade}`);
    }
  }
  return [...new Set(satirlar)].sort();
}

if (process.argv[1] && process.argv[1].endsWith("gonder-dugmesi.mjs")) {
  const satirlar = tabanTaramasi();
  console.log(`DISABLED DÜĞME: ${satirlar.length}`);
  for (const s of satirlar) console.log(` ${s}`);
}
