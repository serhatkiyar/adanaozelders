// @vitest-environment node
import { describe, expect, it } from "vitest";

import { donusAdresiUret, guvenliDonusYolu } from "./guvenliDonus";

/**
 * Kural sunucudaki `guvenli_donus_yolu` ile AYNI olmalı; ayrışırsa kullanıcı
 * bir tarafın kabul edip diğerinin reddettiği adreste takılır. Buradaki
 * senaryolar `backend/tests/test_google_oauth_state.py` ile bilerek örtüşüyor.
 */
describe("guvenliDonusYolu", () => {
  it.each([
    "/",
    "/magaza",
    "/magaza/urun/kitap-42",
    "/egitmenler?ders=matematik&ilce=seyhan",
    "/rezervasyonlar/deneme/17",
    // İKİ NOKTA içeren MEŞRU adresler. Sunucu tarafında "iki nokta içeremez"
    // kuralı vardı ve bunları sessizce ana sayfaya düşürüyordu; ölçüm kuralın
    // tek başına yalnız zararsız göreli yolları yakaladığını gösterdi ve kural
    // kaldırıldı. Aynı hata burada tekrarlanmasın diye çıpalı.
    "/takvim?aralik=09:00-17:00",
    "/mesajlar?ts=2026-09-07T10:30:00",
  ])("site içi yolu kabul eder: %s", (yol) => {
    expect(guvenliDonusYolu(yol)).toBe(yol);
  });

  it.each([
    ["//evil.example", "protokol-göreli MUTLAK adres"],
    ["///evil.example", "üç bölü de aynı sonucu verir"],
    ["/\\evil.example", "ters bölü bazı tarayıcılarda bölü gibi çözümlenir"],
    ["https://evil.example", "dış adres"],
    ["http://evil.example", "dış adres"],
    ["javascript:alert(1)", "şema enjeksiyonu"],
    ["data:text/html,<script>", "veri şeması"],
    ["//evil.example/magaza", "konak kaçırma, yol masum görünüyor"],
    ["magaza", "bölü ile başlamıyor"],
    ["", "boş"],
    ["/api/v1/auth/me", "site içi ama kullanıcı yüzeyi değil"],
    ["/api", "aynı sınıf"],
    ["/magaza\r\nX-Injected: 1", "satır sonu enjeksiyonu"],
    ["/magaza deger", "boşluk"],
    [`/${"a".repeat(600)}`, "sınırın üstünde"],
  ])("tehlikeli yolu reddeder: %s (%s)", (yol) => {
    expect(guvenliDonusYolu(yol)).toBeNull();
  });

  it("null ve undefined güvenli biçimde reddedilir", () => {
    expect(guvenliDonusYolu(null)).toBeNull();
    expect(guvenliDonusYolu(undefined)).toBeNull();
  });
});

describe("donusAdresiUret", () => {
  it("modal parametrelerini temizler", () => {
    // Bunlar temizlenmezse kullanıcı giriş yaptıktan SONRA giriş penceresi
    // yeniden açılır — akışın kendisini geri sarar.
    expect(donusAdresiUret("/magaza", "?modal=login&role=tutor")).toBe("/magaza");
  });

  it("akışa ait olmayan parametreleri KORUR", () => {
    expect(donusAdresiUret("/egitmenler", "?ders=matematik&ilce=seyhan")).toBe(
      "/egitmenler?ders=matematik&ilce=seyhan"
    );
  });

  it("karışık parametrelerde yalnız akışa ait olanları atar", () => {
    expect(donusAdresiUret("/magaza", "?modal=register&kategori=kitap")).toBe(
      "/magaza?kategori=kitap"
    );
  });

  it("callback'in kendi parametreleri de temizlenir", () => {
    // Dönüş sayfasından tekrar Google'a gidilirse `durum`/`git` birikmemeli.
    expect(donusAdresiUret("/magaza", "?durum=ok&git=%2Fbaska&hata=x")).toBe("/magaza");
  });

  it("güvensiz bir pathname ana sayfaya düşer", () => {
    expect(donusAdresiUret("//evil.example", "")).toBe("/");
  });
});
