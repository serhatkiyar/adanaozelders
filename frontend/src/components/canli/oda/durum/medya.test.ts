import { afterEach, describe, expect, it } from "vitest";

import { surucuyuKur } from "../../video/etkin";
import type { VideoSurucusu } from "../../video/tipler";
import { ayril } from "./medya";
import { depoyuSifirla, useOdaDeposu } from "./odaDeposu";

afterEach(() => {
  surucuyuKur(null);
  depoyuSifirla();
});

describe("ayrılma sırası", () => {
  it("'ayrılıyoruz' bayrağı sürücünün ayril'ından ÖNCE yazılır", async () => {
    const gorulen: boolean[] = [];
    surucuyuKur({
      ayril: async () => {
        gorulen.push(useOdaDeposu.getState().ayriliyor);
      },
    } as unknown as VideoSurucusu);
    expect(useOdaDeposu.getState().ayriliyor).toBe(false);

    await ayril();

    // Sürücünün kapanış olayı "bağlantı koptu" sayılmasın.
    expect(gorulen).toEqual([true]);
  });
});
