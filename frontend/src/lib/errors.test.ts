/**
 * `getErrorMessage` / `getErrorDetail` — hata gövdesinden kullanıcıya gösterilecek
 * metnin çıkarılması.
 *
 * Eklenme sebebi (regresyon): backend bazı uçlarda `detail`'i OBJE olarak
 * döndürüyor ve içine kullanıcı için yazılmış bir `message` koyuyor — ör. ödeme
 * kolu kapalıyken `{code, branch, message}`
 * (backend/services/payment_gates.py::assert_branch_open, 503). Fonksiyon yalnız
 * string ve dizi detail'i işlediği için obje gövdeler sessizce çağıranın genel
 * fallback'ine düşüyordu ("Ödeme başarısız.") ve sunucunun açıkladığı sebep
 * kullanıcıya hiç ulaşmıyordu.
 */
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { getErrorDetail, getErrorMessage } from "@/lib/errors";

/** Gerçek bir AxiosError üretir — `instanceof` kontrolü bu yüzden şart. */
function axiosHata(status: number, data: unknown): AxiosError {
  const err = new AxiosError("istek başarısız", "ERR_BAD_RESPONSE");
  err.response = {
    status,
    statusText: "",
    data,
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return err;
}

describe("getErrorMessage — obje detail", () => {
  it("obje detail içindeki message alanını kullanır (503, ödeme kolu kapalı)", () => {
    const hata = axiosHata(503, {
      detail: {
        code: "PAYMENT_BRANCH_CLOSED",
        branch: "library_marketplace",
        message: "Kütüphane ödemeleri şu anda kapalıdır.",
      },
    });
    expect(getErrorMessage(hata, "Ödeme başarısız.")).toBe(
      "Kütüphane ödemeleri şu anda kapalıdır."
    );
  });

  it("duruma değil DETAIL BİÇİMİNE bağlıdır — 500'de de message okunur", () => {
    // Kapsam bilinçli olarak 503'e özel değil; aynı desendeki her uç faydalanır.
    const hata = axiosHata(500, { detail: { code: "X", message: "Sunucu mesajı" } });
    expect(getErrorMessage(hata, "yedek")).toBe("Sunucu mesajı");
  });

  it("obje ama message YOKSA fallback'e düşer", () => {
    const hata = axiosHata(503, { detail: { code: "PAYMENT_BRANCH_CLOSED" } });
    expect(getErrorMessage(hata, "Ödeme başarısız.")).toBe("Ödeme başarısız.");
  });

  it("message boş/boşluk ise fallback'e düşer", () => {
    for (const bos of ["", "   "]) {
      const hata = axiosHata(503, { detail: { message: bos } });
      expect(getErrorMessage(hata, "yedek")).toBe("yedek");
    }
  });

  it("message string değilse fallback'e düşer", () => {
    const hata = axiosHata(503, { detail: { message: { tr: "iç içe" } } });
    expect(getErrorMessage(hata, "yedek")).toBe("yedek");
  });
});

describe("getErrorMessage — mevcut davranışlar bozulmadı", () => {
  it("string detail olduğu gibi döner", () => {
    const hata = axiosHata(400, { detail: "Ürün artık satışta değil" });
    expect(getErrorMessage(hata, "yedek")).toBe("Ürün artık satışta değil");
  });

  it("bilinen string detail Türkçe yönergeye çevrilir", () => {
    const hata = axiosHata(409, { detail: "time slot conflicts with another booking" });
    expect(getErrorMessage(hata, "yedek")).toContain("Seçtiğin saat aralığı");
  });

  it("çeviri, durum kodu dalından ÖNCE gelir (409 genel mesajı ezmez)", () => {
    const hata = axiosHata(409, { detail: "weekly question quota exceeded" });
    expect(getErrorMessage(hata, "yedek")).toContain("Haftalık soru kotanı");
  });

  it("FastAPI doğrulama dizisinden ilk msg alınır", () => {
    const hata = axiosHata(422, {
      detail: [{ msg: "field required", loc: ["body", "x"] }],
    });
    expect(getErrorMessage(hata, "yedek")).toBe("field required");
  });

  it.each([
    [429, "Çok fazla istek"],
    [409, "Bir çakışma oluştu"],
    [403, "Bu işlem için yetkin yok"],
    [401, "Oturum süren dolmuş"],
  ])("durum kodu %i genel mesajı korunur", (status, beklenen) => {
    // Detail obje OLSA BİLE bu dallar önce gelir — mevcut davranış budur ve
    // obje desteği eklenirken kaymamalıdır.
    const hata = axiosHata(status, { detail: { message: "obje mesajı" } });
    expect(getErrorMessage(hata, "yedek")).toContain(beklenen);
  });

  it("ağ hatası kendi mesajını verir", () => {
    const err = new AxiosError("ağ", "ERR_NETWORK");
    expect(getErrorMessage(err, "yedek")).toContain("Sunucuya ulaşılamıyor");
  });

  it("AxiosError olmayan değerde fallback döner", () => {
    expect(getErrorMessage(new Error("düz"), "yedek")).toBe("yedek");
    expect(getErrorMessage(null, "yedek")).toBe("yedek");
  });

  it("detail hiç yoksa fallback döner", () => {
    expect(getErrorMessage(axiosHata(500, {}), "yedek")).toBe("yedek");
  });
});

describe("getErrorDetail — yönetim yüzeyi", () => {
  it("string detail'i korur", () => {
    const hata = axiosHata(409, { detail: "Ürün açık siparişte kullanılıyor" });
    expect(getErrorDetail(hata, "yedek")).toBe("Ürün açık siparişte kullanılıyor");
  });

  it("obje detail'de getErrorMessage'a düşer ve message'ı alır", () => {
    const hata = axiosHata(503, { detail: { message: "Kol kapalı" } });
    expect(getErrorDetail(hata, "yedek")).toBe("Kol kapalı");
  });
});
