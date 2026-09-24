/**
 * `username` (kullanıcı adı) KALDIRILDI — yokluk sözleşmesi (R5 · R5b · R6).
 *
 * Alan sistemde iş yapmıyordu: giriş e-posta ile, eğitmen profili
 * `isim-soyisim-{id}` slug'ı ile, öğrenci profili düz id ile açılıyor; kayıt
 * formu sormuyordu ve mesajlaşma/yorum yüzeylerinin hiçbirinde görünmüyordu.
 *
 * ## Neden bu dosya kırmızı doğdu
 *
 * Bir şeyin yokluğunu iddia eden test, o şey hiç var olmamış olsa da geçer.
 * Yeşil olması tek başına hiçbir şey kanıtlamaz — kanıt, kaldırmadan ÖNCE
 * kırmızı düştüğünün görülmesidir. Bu dosya üretim kodundan önce yazıldı;
 * kırmızı çıktısı commit mesajındadır.
 *
 * ## R7 YOK — ve bu bilinçli
 *
 * `flashcardsKaldirildi.test.tsx`te R7 (gerçek router) vardı, çünkü orada bir
 * ROTA kaldırılıyordu ve biri `PATHS`e dokunmadan `<Route>` yazabilirdi.
 * Burada kaldırılan şey bir rota değil bir ALAN; geri sızma vektörü
 * `types/index.ts` ve `models/mixins.py`. Şema tarafının nöbetçisi backend'de
 * (`tests/test_kullanici_adi_kaldirildi.py` + migration nöbetçisi).
 *
 * ## Sınır
 *
 * R5 bir KAYNAK sözleşmesidir. Tip düzeyindeki asıl zorlama `tsc -b`'dedir:
 * bir bileşen `user.username` okursa ve tip o alanı taşımıyorsa derleme
 * kırılır. Buradaki düğüm o zorlamanın yerine geçmez, onu ÇAPALAR — tipten
 * alan çıkarılmadan bileşen temizliği yapılırsa `tsc` sessiz kalırdı.
 */
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ClientCard } from "@/components/ClientCard";
import { getLegalDoc } from "@/lib/legalContent";
import { Gender, type ClientSearchOut } from "@/types";

const SRC = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
);

/** Yorum satırlarını atar: bir yorumun alanı anması tarihtir, borç değil. */
function yorumsuz(metin: string): string {
  return metin
    .split(/\r?\n/)
    .filter((satir) => {
      const k = satir.trim();
      return !k.startsWith("//") && !k.startsWith("*") && !k.startsWith("/*");
    })
    .join("\n");
}

describe("R5 — tip sözleşmesi", () => {
  const kaynak = yorumsuz(readFileSync(join(SRC, "types", "index.ts"), "utf8"));

  it("kullanıcı tipleri `username` alanı BİLDİRMİYOR", () => {
    for (const alan of ["username", "username_change_count", "new_username"]) {
      expect(
        new RegExp(String.raw`\b${alan}\s*[?]?\s*:`).test(kaynak),
        `types/index.ts hâlâ ${alan} bildiriyor`,
      ).toBe(false);
    }
  });

  it("DOLULUK: tipler boşalmadı", () => {
    // Dosya boşalsa ya da okuma kırılsa yukarıdaki iddia bedava geçerdi.
    expect(kaynak.length).toBeGreaterThan(5000);
    expect(/\bemail\s*[?]?\s*:/.test(kaynak)).toBe(true);
    expect(/\bfull_name\s*[?]?\s*:/.test(kaynak)).toBe(true);
  });
});

describe("R5b — KVKK metni", () => {
  const kvkk = JSON.stringify(getLegalDoc("kvkk"));

  it("aydınlatma metni artık 'kullanıcı adı' toplamıyor", () => {
    // Toplamadığımız bir veriyi topluyoruz diye yazmak yanlış beyandır.
    expect(kvkk.toLowerCase()).not.toContain("kullanıcı adı");
  });

  it("DOLULUK: metin duruyor ve kimlik bilgilerini hâlâ sayıyor", () => {
    expect(kvkk.length).toBeGreaterThan(2000);
    expect(kvkk).toContain("ad, soyad");
  });
});

describe("R6 — gerçek DOM: öğrenci kartında el (@handle) yok", () => {
  const ogrenci = {
    id: 42,
    full_name: "Ayşe Yılmaz",
    avatar_url: null,
    about: "Merhaba",
    birth_date: null,
    gender: Gender.UNSPECIFIED,
    last_seen_at: null,
  } as unknown as ClientSearchOut;

  const bas = () =>
    render(
      <MemoryRouter>
        <ClientCard client={ogrenci} />
      </MemoryRouter>,
    );

  it("kart '@' ile başlayan bir el basmıyor", () => {
    const { container } = bas();
    const eller = Array.from(container.querySelectorAll("p")).filter((p) =>
      (p.textContent ?? "").trim().startsWith("@"),
    );
    expect(eller.map((p) => p.textContent)).toEqual([]);
  });

  it("DOLULUK: kart gerçekten render oldu ve adı gösteriyor", () => {
    // Patlayan ya da boş bir render, yukarıdaki "yok" iddiasını bedava geçerdi.
    bas();
    expect(screen.getByText("Ayşe Yılmaz")).toBeTruthy();
    // Kart artık bağlantı değil: üye profili sayfası 23 Eyl 2026'da kalktı.
    expect(screen.getByRole("heading", { name: "Ayşe Yılmaz" })).toBeTruthy();
  });
});
