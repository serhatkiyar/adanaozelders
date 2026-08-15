// İP-19 bağımsız denetim · B-3 — adres formu ilçesiz kayda izin VERMEZ.
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
//
// K-10 ile kendi-filo bölgesinin otoritesi İLÇE LİSTESİ oldu: `in_delivery_zone`
// ilçe yoksa `False` döner (harita pin'i artık otorite değildir). Form ise
// ilçeyi opsiyonel bırakıyor ve `district: null` gönderiyor — yani müşteri
// pin'ini işaretlese bile siparişi sessizce "bölge dışı" oluyor ve düşeceği dış
// kargo kuyruğu henüz yazılmadı (İP-20).
//
// Bu paketin tipik yalancı yeşili: "formda ilçe alanı var" iddiası. Alan zaten
// var — eksik olan, boş bırakıldığında kaydın DURMASIDIR. Bu yüzden düğüm
// alanın varlığını değil, `onSubmit`'in ÇAĞRILMAMASINI ölçer.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddressForm } from "@/components/address/AddressForm";

function formuDoldur(getir: typeof screen, { ilce }: { ilce: string }) {
  fireEvent.change(getir.getByLabelText("Adres Başlığı *"), {
    target: { value: "Ev" },
  });
  fireEvent.change(getir.getByLabelText(/^Adres \(Mahalle/), {
    target: { value: "Test Mah. 1. Sok. No 1" },
  });
  if (ilce) {
    fireEvent.change(getir.getByLabelText(/^İlçe/), { target: { value: ilce } });
  }
}

describe("B-3 · adres bölge sınıfı sessizce kaybolmaz", () => {
  it("ilçe boşken kayıt İLERLEMEZ", () => {
    const onSubmit = vi.fn();
    render(<AddressForm pending={false} onSubmit={onSubmit} onCancel={() => {}} />);

    formuDoldur(screen, { ilce: "" });
    fireEvent.submit(screen.getByRole("button", { name: "Kaydet" }).closest("form")!);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ilçe verilince kayıt ilerler ve ilçe gövdeye GİRER", () => {
    const onSubmit = vi.fn();
    render(<AddressForm pending={false} onSubmit={onSubmit} onCancel={() => {}} />);

    formuDoldur(screen, { ilce: "Seyhan" });
    fireEvent.submit(screen.getByRole("button", { name: "Kaydet" }).closest("form")!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      city: "Adana",
      district: "Seyhan",
    });
  });

  it("ilçe alanı zorunlu olduğunu ETİKETİNDE gösterir", () => {
    render(<AddressForm pending={false} onSubmit={() => {}} onCancel={() => {}} />);
    // Kullanıcı, formu göndermeden önce alanın zorunlu olduğunu görebilmeli;
    // "kaydet"e basınca sürpriz bir hata mesajı almamalı.
    expect(screen.getByLabelText("İlçe *")).toBeInTheDocument();
    expect(screen.getByLabelText("İl *")).toBeInTheDocument();
  });
});
