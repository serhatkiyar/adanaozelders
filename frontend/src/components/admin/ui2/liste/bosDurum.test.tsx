/**
 * İP-B2 — İKİ AYRI boş durum (tasarım dili §5.3).
 *
 * "Hiç kayıt yok" ile "filtre eşleşmedi" aynı bileşen olamaz. Ayrım biçimsel
 * değil, kullanıcı niyetine dair: ilki bir DAVET ("ilk ürünü ekleyin"),
 * ikincisi bir DÜZELTME TALİMATI ("filtreyi gevşetin"). Tek bileşen ikisinden
 * birine yanlış aksiyon sunar; daha kötüsü, aynı metni gösterirse yönetici
 * **katalogun boşaldığını sanır**.
 *
 * Bu dosya ayrımın yapısal olduğunu kanıtlar: iki bileşenin aksiyonları
 * BİRBİRİNİN YERİNE GEÇEMEZ.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/admin/ui";

import { KayitYokDurumu, SonucYokDurumu } from "./bosDurum";

describe("İP-B2 · KayitYokDurumu — yaratma daveti", () => {
  it("başlık `h2`dir (belge ana hattı korunur)", () => {
    // Sayfa başına tek `<h1>` kabuktan gelir (tasarım dili §2 · kural 1);
    // içerik başlığı ikinci seviyeden başlar.
    render(<KayitYokDurumu baslik="Henüz ürün eklenmemiş" />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Henüz ürün eklenmemiş"
    );
  });

  it("aksiyon yuvası ÇAĞIRANIN — 'yarat' aksiyonu her ekranda farklıdır", () => {
    render(
      <KayitYokDurumu
        baslik="Henüz ürün eklenmemiş"
        aciklama="İlk ürünü ekleyerek başlayın."
        aksiyon={<Button size="sm">Yeni ürün</Button>}
      />
    );
    expect(screen.getByRole("button", { name: "Yeni ürün" })).toBeTruthy();
  });

  it("'Filtreleri temizle' BASMAZ — orada temizlenecek filtre yok", () => {
    // Ayrımın çekirdeği. Bu bileşen filtre temizleme sunarsa, boş katalogdaki
    // yönetici olmayan bir filtreyi aramaya başlar.
    render(<KayitYokDurumu baslik="Henüz ürün eklenmemiş" aciklama="İlk ürünü ekleyin." />);
    expect(screen.queryByRole("button", { name: /filtreleri temizle/i })).toBeNull();
  });

  it("yetki yoksa aksiyon HİÇ basılmaz", () => {
    const { container } = render(<KayitYokDurumu baslik="Henüz ürün eklenmemiş" />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("İP-B2 · SonucYokDurumu — filtre gevşetme talimatı", () => {
  it("'Filtreleri temizle' düğmesini KENDİ basar (yuva değil)", () => {
    // Aksiyon yuva olsaydı unutulabilir ya da yanlışı konabilirdi; burada
    // doğru aksiyon tektir ve bileşene aittir.
    render(<SonucYokDurumu baslik="Eşleşen ürün yok" onTemizle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Filtreleri temizle" })).toBeTruthy();
  });

  it("düğme gerçekten `onTemizle`yi çağırır", () => {
    const temizle = vi.fn();
    render(<SonucYokDurumu baslik="Eşleşen ürün yok" onTemizle={temizle} />);
    screen.getByRole("button", { name: "Filtreleri temizle" }).click();
    expect(temizle).toHaveBeenCalledTimes(1);
  });

  it("açıklama verilmezse de bir yön gösterir (boş bırakılamaz)", () => {
    render(<SonucYokDurumu baslik="Eşleşen ürün yok" onTemizle={vi.fn()} />);
    expect(screen.getByText(/gevşetmeyi deneyin/i)).toBeTruthy();
  });
});

describe("İP-B2 · ikisi AYNI bileşen değil", () => {
  it("iki durum farklı işaret taşır (DOM'da ayırt edilebilirler)", () => {
    // `data-bos-durum` bir test kancası değil, ekran turlarının ve gerçek
    // tarayıcı sondasının hangi durumun basıldığını okuyabilmesi için var.
    const { container: a } = render(<KayitYokDurumu baslik="A" />);
    const { container: b } = render(<SonucYokDurumu baslik="B" onTemizle={vi.fn()} />);
    expect(a.querySelector("[data-bos-durum]")?.getAttribute("data-bos-durum")).toBe(
      "kayit-yok"
    );
    expect(b.querySelector("[data-bos-durum]")?.getAttribute("data-bos-durum")).toBe(
      "sonuc-yok"
    );
  });

  it("kutu (kesik çizgili çerçeve) YOK — kutu yerine boşluk", () => {
    // Kalıcı karar. Boş durum zaten tablonun çerçevesinin İÇİNDE duruyor;
    // ikinci bir çerçeve "kart enflasyonu" üretiyordu.
    const { container } = render(<KayitYokDurumu baslik="A" />);
    expect(container.querySelector("[data-bos-durum]")?.className).not.toMatch(/border-dashed/);
  });
});
