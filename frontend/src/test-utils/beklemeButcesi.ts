/**
 * İP-A7d5 · Görev 3 — **dosya kapsamlı bekleme bütçesi** (sızıntısız).
 *
 * ## Neden bu yardımcı var
 *
 * RTL'in `configure({ asyncUtilTimeout })` çağrısı modül düzeyinde GLOBALDİR ve
 * `@testing-library/dom` bir node_modules bağımlılığı olduğu için vitest
 * işçisinin ESM önbelleğinde **dosyalar arasında paylaşılır** (aynı sızıntı
 * sınıfı `ui2/zodTurkce.test.ts`te zod yereli için belgeli). Ölçüldü:
 *
 *   vitest run --pool=forks --poolOptions.forks.singleFork \
 *     src/pages/operatorBalance.acceptance.test.tsx src/__sonda.test.ts
 *   → sonda `asyncUtilTimeout = 5000` okuyor. Sonda TEK BAŞINA: 1000.
 *
 * Yani modül düzeyinde yazılan bir `configure`, aynı işçide SONRA koşan her
 * dosyanın bütçesini de değiştirir; hangi dosyaların etkilendiği karışık
 * tohumda değişir — maskeleme KARARSIZDIR. İP-A6b'nin BULGU-10'da kaldırdığı
 * global ayar tam olarak böyle geri gelmişti.
 *
 * Bu yardımcı bütçeyi dosyanın ömrüyle sınırlar: `beforeAll`da kurar,
 * `afterAll`da ÖNCEKİ değerine döndürür. Düzeltmeden sonra aynı sonda
 * ölçümü `1000` veriyor (iki dosya için de).
 *
 * ## Kullanım kuralı
 *
 * Bütçe ancak ÖLÇÜMLE yükseltilir ve çağrı yeri `beklemeButcesi.test.ts`teki
 * envanterde değeriyle yazılıdır (`__guards__/beklemeButcesi.test.ts`).
 */
import { configure, getConfig } from "@testing-library/react";
import { afterAll, beforeAll } from "vitest";

/**
 * Kur/geri-al çiftinin SAF hâli — kanca kaydından bağımsız test edilebilsin
 * diye ayrı. Asıl kusur riski burada: geri alma unutulursa yardımcı, yerini
 * aldığı sızıntının ta kendisine dönüşür.
 */
export function butceKapisi(
  ms: number,
  oku: () => number,
  yaz: (deger: number) => void
): { kur: () => void; geriAl: () => void } {
  let onceki: number | null = null;
  return {
    kur: () => {
      onceki = oku();
      yaz(ms);
    },
    geriAl: () => {
      if (onceki !== null) yaz(onceki);
      onceki = null;
    },
  };
}

/** Bütçeyi YALNIZ çağıran dosyanın ömrü boyunca yükseltir. */
export function dosyaBeklemeButcesi(ms: number): void {
  const kapi = butceKapisi(
    ms,
    () => getConfig().asyncUtilTimeout,
    (deger) => configure({ asyncUtilTimeout: deger })
  );
  beforeAll(kapi.kur);
  afterAll(kapi.geriAl);
}
