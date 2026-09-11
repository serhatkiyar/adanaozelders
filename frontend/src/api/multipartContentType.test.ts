// Nöbetçi: FormData yükleme fonksiyonları isteğe ELLE bir Content-Type
// yazmamalı.
//
// Arka plan (2026-09-11): `store.ts`, `libraries.ts`, `examCatalogs.ts`,
// `libraryExams.ts` ve `tutorPreApplications.ts`'te paylaşılan `MULTIPART`
// sabiti `Content-Type: "multipart/form-data"` yazıyordu — boundary
// parametresi OLMADAN. Kurulu axios'un (bkz. `node_modules/axios/lib/
// adapters/xhr.js`, "Remove Content-Type if data is undefined") XHR
// adaptörü bu durumu KENDİLİĞİNDEN düzeltmiyor: header zaten dolu olduğu
// için tarayıcı boundary'yi asla EKLEMİYOR ve sunucu multipart gövdeyi
// ayrıştıramıyor. Panelde ürün görseli yükleme bu yüzden canlıda kırıktı.
//
// Bu testin `false` beklemesi kasıtlıdır, `undefined` DEĞİL — ikisi eşit
// görünse de axios'ta değildir: kurulu `dispatchRequest.js` post/put/patch
// isteklerinde `setContentType('application/x-www-form-urlencoded', false)`
// çağırır ve bu, header değeri tam `undefined` iken `rewrite:false`'a
// RAĞMEN üzerine yazar (`AxiosHeaders.set`'teki `self[key] === undefined`
// koşulu) — yani `Content-Type: undefined` denenirse FormData'ya sessizce
// `application/x-www-form-urlencoded` gider, boundary yine yok. `false`
// axios'un "bu header'ı hiç gönderme" sentinel'idir; gerçek adaptöre giden
// header listesinde Content-Type hiç YER ALMAZ ve tarayıcı boundary'yi
// kendisi ekler. Bu üç senaryo yerel axios kaynağı okunup sahte bir
// adapter'la ölçüldü (bkz. rapor).
import type { AxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { uploadProductCover } from "@/api/store";
import { uploadLibraryLogo } from "@/api/libraries";
import { uploadCatalogAnswerKey } from "@/api/examCatalogs";
import { uploadResultDocument } from "@/api/libraryExams";
import { submitTutorPreApplication } from "@/api/tutorPreApplications";

let sonIstek: AxiosRequestConfig | null = null;
let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  sonIstek = null;
  apiClient.defaults.adapter = async (config) => {
    sonIstek = config;
    return {
      data: {},
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

function contentType(): unknown {
  const headers = sonIstek?.headers as
    | { get?: (name: string) => unknown }
    | undefined;
  return headers?.get?.("Content-Type");
}

describe("multipart yüklemede elle Content-Type yazılmıyor", () => {
  it("store.ts: uploadProductCover", async () => {
    const file = new File(["x"], "kapak.png", { type: "image/png" });
    await uploadProductCover(1, file);

    expect(sonIstek?.data).toBeInstanceOf(FormData);
    expect(contentType()).toBe(false);
  });

  it("libraries.ts: uploadLibraryLogo", async () => {
    const file = new File(["x"], "logo.png", { type: "image/png" });
    await uploadLibraryLogo(1, file);

    expect(sonIstek?.data).toBeInstanceOf(FormData);
    expect(contentType()).toBe(false);
  });

  it("examCatalogs.ts: uploadCatalogAnswerKey", async () => {
    const file = new File(["x"], "cevap.pdf", { type: "application/pdf" });
    await uploadCatalogAnswerKey(1, file);

    expect(sonIstek?.data).toBeInstanceOf(FormData);
    expect(contentType()).toBe(false);
  });

  it("libraryExams.ts: uploadResultDocument", async () => {
    const file = new File(["x"], "karne.pdf", { type: "application/pdf" });
    await uploadResultDocument(1, 2, file);

    expect(sonIstek?.data).toBeInstanceOf(FormData);
    expect(contentType()).toBe(false);
  });

  it("tutorPreApplications.ts: submitTutorPreApplication", async () => {
    await submitTutorPreApplication({
      full_name: "Ayşe Yılmaz",
      phone: "05551234567",
      subjects: ["Matematik"],
      kvkk_accepted: true,
    });

    expect(sonIstek?.data).toBeInstanceOf(FormData);
    expect(contentType()).toBe(false);
  });
});
