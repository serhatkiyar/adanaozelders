/**
 * İP-A2 · Pilot form: `DamageDialog` — gerçek DOM davranış testleri.
 *
 * Bu dosya `Form.*` katmanının göçünden ÖNCE yazıldı ve M9/M10 kırmızıydı
 * (`docs/ip-a2-rapor.md` → Görev 3). Geri kalan testler göçün MEVCUT davranışı
 * bozmadığının nöbetçisidir: anlık doğrulama, etki metni, gövde içeriği.
 *
 * Tek mock `useAdminProducts`: ürün ARAMASI bu paketin konusu değil, ama
 * seçici gerçek bileşenin kendisidir — ürün gerçekten listeden tıklanarak
 * seçilir, state elle enjekte edilmez.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductSearchOut } from "@/types";

const URUNLER = [
  {
    id: 7,
    title: "Matematik Soru Bankası",
    sku: "MAT-7",
    author: null,
    publisher: null,
    isbn: null,
  },
] as unknown as ProductSearchOut[];

vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: () => ({ data: { items: URUNLER }, isLoading: false }),
}));

import { DamageDialog } from "./DamageDialog";

/** Aramayı yazıp gelen adayı tıklar — gerçek seçici akışı. */
async function urunSec() {
  fireEvent.change(screen.getByLabelText(/ürün ara/i), {
    target: { value: "mat" },
  });
  const aday = await screen.findByText("Matematik Soru Bankası", undefined, {
    timeout: 2000,
  });
  fireEvent.click(aday.closest("button")!);
  await screen.findByLabelText("Seçilen ürünler");
}

function ac(props: Partial<React.ComponentProps<typeof DamageDialog>> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <DamageDialog
      kind="TRANSFER"
      isPending={false}
      error={null}
      onClose={onClose}
      onSubmit={onSubmit}
      {...props}
    />
  );
  return { onSubmit, onClose };
}

describe("İP-A2 · DamageDialog pilotu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("M9 — geçersiz alanla gönderilince hata ALANIN ALTINDA görünür", async () => {
    ac();
    await urunSec();

    const miktar = screen.getByLabelText(/miktar/i);
    fireEvent.change(miktar, { target: { value: "0" } });

    await waitFor(() => {
      const id = screen.getByLabelText(/miktar/i).getAttribute("aria-describedby");
      expect(id).toBeTruthy();
      const kutu = document.getElementById(id!);
      expect(kutu?.getAttribute("role")).toBe("alert");
      expect(kutu?.textContent ?? "").toMatch(/miktar/i);
    });
    expect(screen.getByLabelText(/miktar/i).getAttribute("aria-invalid")).toBe(
      "true"
    );
  });

  it("M10 — alan hataları genel/toast kanalına GİTMEZ", async () => {
    const { onSubmit } = ac();
    await urunSec();

    fireEvent.change(screen.getByLabelText(/miktar/i), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hasara ayır" }));

    await waitFor(() =>
      expect(screen.getByLabelText(/miktar/i).getAttribute("aria-invalid")).toBe(
        "true"
      )
    );

    // Sunucuya gitmedi: alan hatası ağ turu başlatmaz, dolayısıyla sayfanın
    // toast'ını da tetikleyemez.
    expect(onSubmit).not.toHaveBeenCalled();
    // Formun ÜSTÜNDE genel bir uyarı şeridi yok — hata yalnız alanında.
    expect(screen.queryByTestId("damage-genel-hata")).toBeNull();
    // Ekrandaki tek `alert` alanın kendi mesajı.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("genel sunucu hatası (error prop'u) ÜST şeritte durur", () => {
    ac({ error: "Sunucuya ulaşılamadı." });
    const serit = screen.getByTestId("damage-genel-hata");
    expect(serit.textContent).toContain("Sunucuya ulaşılamadı.");
    expect(serit.getAttribute("role")).toBe("alert");
  });

  it("anlık doğrulama korunur: gönder'e basmadan hata çıkar", async () => {
    ac();
    await urunSec();
    fireEvent.change(screen.getByLabelText(/miktar/i), {
      target: { value: "-3" },
    });
    // Hiçbir gönderim yapılmadı; yine de hata görünür.
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  it("etki metni korunur ve rakamla yazılır", async () => {
    ac();
    await urunSec();
    fireEvent.change(screen.getByLabelText(/miktar/i), {
      target: { value: "4" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("damage-effect").textContent).toMatch(/4/)
    );
  });

  it("geçerli formda sunucuya doğru gövde gider (idempotency anahtarı dahil)", async () => {
    const { onSubmit } = ac();
    await urunSec();
    fireEvent.change(screen.getByLabelText(/miktar/i), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText(/^neden/i), {
      target: { value: "KIRIK" },
    });

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Hasara ayır" }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole("button", { name: "Hasara ayır" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const govde = onSubmit.mock.calls[0][0];
    expect(govde).toMatchObject({
      product_id: 7,
      kind: "TRANSFER",
      qty: 2,
      reason_code: "KIRIK",
      note: null,
    });
    expect(govde.idempotency_key).toMatch(/^ui-/);
  });

  it("tedarikçi iadesinde kaynak kova zorunlu kalır ve eksik OLDUĞU SÖYLENİR", async () => {
    // Eski formda tüm doğrulama tek gri satıra iniyordu; kullanıcı hiç
    // dokunmadığı bir alanın eksik olduğunu oradan öğreniyordu. `Form.*`
    // göçünde bu YÖNLENDİRME korundu (kırmızı alan hatası değil, gri ipucu):
    // aksi hâlde gönder düğmesi sessizce kapalı kalırdı.
    const { onSubmit } = ac({ kind: "SUPPLIER_RETURN" });
    await urunSec();
    fireEvent.change(screen.getByLabelText(/miktar/i), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/^neden/i), {
      target: { value: "KIRIK" },
    });

    const dugme = () =>
      screen.getByRole("button", {
        name: "Tedarikçiye iade et",
      }) as HTMLButtonElement;

    await waitFor(() =>
      expect(screen.getByTestId("damage-eksik-ipucu").textContent).toMatch(
        /kova/i
      )
    );
    expect(dugme().disabled).toBe(true);

    fireEvent.click(dugme());
    expect(onSubmit).not.toHaveBeenCalled();

    // Kova seçilince ipucu kalkar ve düğme açılır.
    fireEvent.change(screen.getByLabelText(/kaynak kova/i), {
      target: { value: "DAMAGED" },
    });
    await waitFor(() => expect(dugme().disabled).toBe(false));
    expect(screen.queryByTestId("damage-eksik-ipucu")).toBeNull();

    fireEvent.click(dugme());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ bucket: "DAMAGED" });
  });

  it("eksik ipucu, alanında zaten kırmızı görünen hatayı TEKRAR ETMEZ", async () => {
    // Aynı mesajı iki kanalda göstermek, İP-A2'nin kapattığı gürültünün ta
    // kendisi. İpucu yalnız HENÜZ görünmeyen ilk eksiği söyler.
    ac();
    await urunSec();
    fireEvent.change(screen.getByLabelText(/miktar/i), {
      target: { value: "0" },
    });

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const alanMesaji = screen.getByRole("alert").textContent ?? "";
    const ipucu = screen.queryByTestId("damage-eksik-ipucu");
    expect(ipucu?.textContent ?? "").not.toBe(alanMesaji);
    // Sıradaki gerçek eksik "neden" olmalı.
    expect(ipucu?.textContent ?? "").toMatch(/neden/i);
  });
});
