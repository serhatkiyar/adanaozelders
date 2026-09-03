/**
 * Giriş kodu kartı — QR'ın geri sızmasını durduran nöbetçi.
 *
 * Ürün kararı: bilet görselleştirmesi kalktı, doğrulama YALNIZ kısa kodla
 * yapılıyor. Bir gün biri "QR'ı da koyalım, zararı ne" derse bu test kırılır ve
 * kararın gerekçesini hatırlatır: Apple'ın pas taksonomisinde perfore kenar
 * kupona, kesik kenar biniş kartına aittir; Google Wallet "reservations" için
 * `generic` tipi gösterir. Koltuk rezervasyonu devredilemez, ikincil pazarı
 * yok — bilet estetiği sahte çağrışım üretiyordu.
 *
 * Ayrıca burada bir GİZLİ BUG kilitleniyor: sunucu `status != PAID` iken
 * `short_code`u null'lar, yani GİRİŞ YAPMIŞ kayıtta da kod boş gelir. Eski
 * ekran bunu "Ödeme sonrası QR oluşur" diye gösteriyor, ödemesini yapmış ve
 * içeri girmiş kullanıcıya ödeme yapmamış gibi davranıyordu.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CheckInCodeCard } from "@/components/reservation/CheckInCodeCard";

describe("giriş kodu kartı", () => {
  it("ödenmiş kayıtta kod büyük punto görünür", () => {
    render(<CheckInCodeCard kod="4F6E8Y3F" girisYapildi={false} />);
    expect(screen.getByText("4F6E8Y3F")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kopyala" })).toBeTruthy();
  });

  it("ödeme bekleyen kayıtta kod YOK, sebebi yazar", () => {
    render(<CheckInCodeCard kod={null} girisYapildi={false} />);
    expect(screen.getByText(/Ödemen tamamlanınca/)).toBeTruthy();
  });

  it("GİRİŞ YAPILMIŞ kayıt 'ödeme bekliyor' DEMEZ", () => {
    // Gizli bug'ın nöbetçisi: kod null ama sebebi ödeme değil.
    const { container } = render(
      <CheckInCodeCard kod={null} girisYapildi girisZamani="2026-09-05T10:05:00+03:00" />,
    );
    expect(screen.getByText("Giriş yapıldı")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Ödemen tamamlanınca/);
  });

  it("HİÇBİR durumda QR üretilmez", () => {
    for (const props of [
      { kod: "4F6E8Y3F", girisYapildi: false },
      { kod: null, girisYapildi: false },
      { kod: null, girisYapildi: true },
    ]) {
      const { container, unmount } = render(<CheckInCodeCard {...props} />);
      // `qrcode.react` bir <svg> ya da <canvas> basar; ikisi de olmamalı.
      expect(container.querySelector("svg")).toBeNull();
      expect(container.querySelector("canvas")).toBeNull();
      expect(container.textContent).not.toMatch(/QR/);
      unmount();
    }
  });
});
