// @vitest-environment node
/** `apiClient` dizi-param serializasyonu nöbetçisi (bağımsız denetim P2-7).
 *
 * Faz 3a'da ölçülen üretim kusuru: axios varsayılanı dizileri `publisher[]=a`
 * olarak gönderir ve FastAPI `list[str] = Query(...)` köşeli anahtarı GÖRMEZ —
 * publisher/author/cover_type facet filtreleri gerçek tarayıcıda sessizce
 * filtresizdi. Düzeltme `paramsSerializer: { indexes: null }`.
 *
 * Kabul testleri bunu YAKALAYAMAZ: adapter'ı değiştirip `config.params`ı
 * doğrudan okurlar, gerçek serializer hiç çalışmaz. Bu test bu yüzden
 * `getUri` kullanır — istek atılmaz ama URL, instance'ın GERÇEK
 * serializer'ından geçer; satır silinirse burası kırılır.
 */
import { describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";

describe("apiClient dizi query paramları", () => {
  it("tekrarlı anahtar üretir (publisher=a&publisher=b), köşeli DEĞİL", () => {
    const uri = apiClient.getUri({
      url: "/store/products",
      params: { publisher: ["a", "b"], q: "t" },
    });
    expect(uri).toContain("publisher=a&publisher=b");
    // Axios varsayılanı: `publisher[]=` (%5B%5D). FastAPI bunu görmez.
    expect(uri).not.toMatch(/publisher(%5B%5D|\[\])/);
  });

  it("variant filtresi de tekrarlı anahtar + ':' değeri korunmuş gider", () => {
    const uri = apiClient.getUri({
      url: "/store/products",
      params: { variant: ["Renk:Sarı", "Ebat:A4"] },
    });
    const parsed = new URLSearchParams(uri.split("?")[1]);
    expect(parsed.getAll("variant")).toEqual(["Renk:Sarı", "Ebat:A4"]);
  });
});
