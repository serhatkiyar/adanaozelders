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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    // GÜNCELLENDİ (İP-A3c · Görev 4): eskiden "ekrandaki tek alert" deniyordu.
    // O sayı kapının ARTIĞIYDI: düğme kapalı olduğu için tıklama gönderimi hiç
    // başlatmıyor, yalnız dokunulan alan (miktar) hata gösteriyordu. Kapı
    // kalkınca tıklama TÜM eksikleri açığa çıkarır (miktar + neden) — bu, yeni
    // desenin istenen davranışıdır. Testin ASIL iddiası korundu ve
    // güçlendirildi: alert'lerin HİÇBİRİ genel kanalda değil, hepsi bir alan
    // mesaj slotunun içinde.
    const uyarilar = screen.getAllByRole("alert");
    expect(uyarilar.length).toBeGreaterThanOrEqual(1);
    uyarilar.forEach((u) => expect(u.closest("[data-form-slot]")).toBeTruthy());
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

  it("tedarikçi iadesinde kaynak kova zorunlu kalır: gönderilmez, hata ALANDA çıkar", async () => {
    // GÜNCELLENDİ (İP-A3c · Görev 4). Eski hâli iki şey iddia ediyordu:
    // (a) "kova seçilmeden gönderilemez" — KORUNDU, aşağıda aynen sınanıyor,
    // (b) "düğme görünürde KAPALI + gri ipucu satırı yazıyor" — bu artık
    //     bilinçli olarak YANLIŞ: kapalı düğme geri bildirim vermez ve
    //     `eksikIpucu` onun için yazılmış paralel bir mekanizmaydı. Kapı
    //     kalkınca ikisi de gitti; işlevini alan altındaki hata üstlendi.
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

    // Düğme AÇIK: kullanıcı basabilmeli, "basıyorum ama bir şey olmuyor"
    // durumu kalmamalı.
    expect(dugme().disabled).toBe(false);

    fireEvent.click(dugme());

    // Ama geçersiz veri sunucuya GİTMEZ — asıl garanti budur.
    await waitFor(() =>
      expect(
        screen.getByLabelText(/kaynak kova/i).getAttribute("aria-invalid")
      ).toBe("true")
    );
    expect(onSubmit).not.toHaveBeenCalled();
    // Ve odak ilk hatalı alana taşındı: hata ekranın görünmeyen kısmındaysa
    // kullanıcı yine geri bildirim almamış olurdu.
    expect(document.activeElement).toBe(screen.getByLabelText(/kaynak kova/i));

    fireEvent.change(screen.getByLabelText(/kaynak kova/i), {
      target: { value: "DAMAGED" },
    });
    fireEvent.click(dugme());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ bucket: "DAMAGED" });
  });

  it("gönder'e basınca eksiklerin HEPSİ kendi alanının altında görünür", async () => {
    // `eksikIpucu`nun yerini alan davranış (İP-A3c · Görev 4). Eski gri satır
    // TEK bir eksiği söylüyordu ve hangi alana ait olduğunu kullanıcının
    // tahmin etmesi gerekiyordu; şimdi her eksik kendi alanının altında.
    const { onSubmit } = ac();

    fireEvent.click(screen.getByRole("button", { name: "Hasara ayır" }));

    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(3)
    );
    expect(onSubmit).not.toHaveBeenCalled();
    // Ürün, miktar ve neden — üçü de hatalı ve üçü de kendi slotunda.
    const metinler = screen
      .getAllByRole("alert")
      .map((u) => u.closest("[data-form-slot]"));
    expect(metinler.every(Boolean)).toBe(true);
    // Odak ilk hatalı alana (ürün seçici) taşındı.
    expect((document.activeElement as HTMLInputElement)?.type).toBe("search");
  });

  it("imha onayı işaretlenmeden gönderilmez: düğme açık, hata kutucukta", async () => {
    // GÜNCELLENDİ (İP-A3c · Görev 4): onay kutusu da "geçerlilik nedeniyle
    // kapalı düğme" deseninin parçasıydı. Kapı kalktı, garanti kalmadı değil —
    // yer değiştirdi.
    const { onSubmit } = ac({ kind: "DISPOSAL" });
    await urunSec();
    fireEvent.change(screen.getByLabelText(/miktar/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/^neden/i), { target: { value: "KIRIK" } });

    const dugme = () =>
      screen.getByRole("button", { name: "İmha et" }) as HTMLButtonElement;
    expect(dugme().disabled).toBe(false);

    fireEvent.click(dugme());

    await waitFor(() =>
      expect(screen.getByTestId("damage-onay-hatasi")).toBeTruthy()
    );
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByTestId("damage-onay-hatasi")).toBeNull();
    fireEvent.click(dugme());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

/**
 * İP-A3a · pilotta canlı olması gereken iki sözleşme.
 *
 * Bunlar KATMAN testi değildir: `sunucuHatasiniUygula` ve `useKirliFormBekcisi`
 * kendi dosyalarında zaten kanıtlı. Buradaki soru "katman çalışıyor mu" değil,
 * **"pilot ekran ona gerçekten bağlı mı"**dır — İP-A2'nin açık bıraktığı uç
 * tam olarak buydu.
 */
describe("İP-A3a · DamageDialog: 422 ve kirli form bekçisi", () => {
  beforeEach(() => vi.clearAllMocks());
  // Onay penceresi Radix portalıyla body'ye açılır; RTL temizliği onu sökmez
  // ve açık kalan pencere sonraki teste sızar.
  afterEach(async () => {
    const iptal = screen
      .queryAllByText("Vazgeç")
      .find((n) => n.closest('[role="alertdialog"]'));
    if (!iptal) return;
    fireEvent.click(iptal);
    await waitFor(() =>
      expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    );
  });

  /** FastAPI 422 gövdesi — `loc` sunucu alan adlarını taşır. */
  const hata422 = (alan: string, mesaj: string) => ({
    response: {
      status: 422,
      data: { detail: [{ loc: ["body", alan], msg: mesaj, type: "value_error" }] },
    },
  });

  it("M8 — sunucu alan hatası İLGİLİ ALANIN altında çıkar, toasta/şeride gitmez", async () => {
    ac({ error: hata422("qty", "Bu üründe bu kadar stok yok.") });
    await urunSec();

    const miktar = screen.getByLabelText(/miktar/i);
    await waitFor(() => {
      const id = miktar.getAttribute("aria-describedby");
      expect(id).toBeTruthy();
      expect(document.getElementById(id!)?.textContent).toBe(
        "Bu üründe bu kadar stok yok."
      );
    });
    expect(miktar.getAttribute("aria-invalid")).toBe("true");
    // Alan hatası GENEL şeride düşmemeli — İP-A2 hata yönlendirme sözleşmesi.
    expect(screen.queryByTestId("damage-genel-hata")).toBeNull();
  });

  it("M8b — alana düşmeyen sunucu hatası ÜST şeritte kalır", async () => {
    // Ters prova: M8 tek başına, şerit HİÇ render edilmese de geçerdi.
    ac({
      error: {
        response: { status: 500, data: { detail: "Sunucu hatası." } },
      },
    });
    expect((await screen.findByTestId("damage-genel-hata")).textContent).toMatch(
      /sunucu/i
    );
  });

  it("M8c — formda karşılığı olmayan alanın mesajı SESSİZCE KAYBOLMAZ", async () => {
    ac({ error: hata422("supplier_id", "Tedarikçi kaydı bulunamadı.") });
    expect((await screen.findByTestId("damage-genel-hata")).textContent).toBe(
      "Tedarikçi kaydı bulunamadı."
    );
  });

  it("bekçi — kirli formda KAPATMA DÜĞMESİ onay sorar", async () => {
    const { onClose } = ac();
    fireEvent.change(screen.getByLabelText(/miktar/i), { target: { value: "3" } });

    fireEvent.click(screen.getByText("Kapat"));

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("bekçi — kirli formda ESC onay sorar", async () => {
    const { onClose } = ac();
    fireEvent.change(screen.getByLabelText(/miktar/i), { target: { value: "3" } });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("bekçi — kirli formda DIŞ TIKLAMA onay sorar", async () => {
    const { onClose } = ac();
    fireEvent.change(screen.getByLabelText(/miktar/i), { target: { value: "3" } });

    fireEvent.click(screen.getByLabelText("Pencereyi kapat"));

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("bekçi — TEMİZ formda üç yolun üçü de doğrudan kapatır", async () => {
    // Ters prova: yukarıdaki üç test, bekçi HER kapatmayı engellese de geçerdi.
    for (const kapat of [
      () => fireEvent.click(screen.getByText("Kapat")),
      () => fireEvent.keyDown(document, { key: "Escape" }),
      () => fireEvent.click(screen.getByLabelText("Pencereyi kapat")),
    ]) {
      const { onClose } = ac();
      kapat();
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).toBeNull();
      cleanup();
    }
  });
});
