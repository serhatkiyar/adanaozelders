/**
 * İP-A7d3 · Görev 3 — `ReasonDialog` sözleşme matrisi (SK-7 + SK-8).
 *
 * ## Neden ORTAK KATMANDA bir test dosyası
 *
 * A7d2 SK-4'ü tek tek düzeltmişti: `ProductForm` bekçiyi hiç çağırmıyordu ve
 * 25 alanlık formda ×/ESC/dış tıklama yazılanı sormadan siliyordu. O paketin
 * kapanış notu, dedektörün yazılmadığını ve sınıfın "tek tespit yolu ekran
 * başına test" olduğunu kayda geçirmişti.
 *
 * Bu dalganın haritası aynı sınıfın **paylaşılan katmandaki** örneğini buldu:
 * `ReasonDialog`. Kendi `Dialog`ını kuruyor, içinde 2000 karaktere kadar metin
 * alan bir `textarea` taşıyor ve `useYuzeyKirliFormBekcisi`yi **hiç
 * çağırmıyor**. Bugün ÜRETİMDE **13 çağrı yeri** var ve çoğu geri alınamaz
 * kararların gerekçe alanı: sipariş iptali, iade reddi, eğitmen reddi, sayım
 * oturumu iptali, paketten vazgeçme, kütüphane reddi.
 *
 * Yani kusur ekran başına değil, ortak katmanda bir kez düzelir — ve
 * düzeltilmezse dalga 4'te on üç ekrana ayrı ayrı kopyalanırdı.
 *
 * ## İkinci kusur AYNI bileşende: gönder düğmesi geçerlilikle kapanıyor
 *
 * `disabled={trimmed.length < minLength || asildi}` — kilitli kararın açık
 * ihlali. `AdminPayoutsPage`te (A7d2) aynı ihlal tek ekranı ilgilendiriyordu;
 * burada on üç çağrı yerini birden ilgilendiriyor. Gerekçe zorunluyken boş
 * bırakan kullanıcı düğmeden NEDEN basamadığını öğrenemiyor.
 *
 * ## Testin sınırı (dürüstçe)
 *
 * Bu bir bileşen sözleşmesi testidir; gerçek DOM'da koşar (jsdom), ama
 * `ReasonDialog`ın on üç çağrı yerinin HEPSİNİ ölçmez. Çağrı yeri başına
 * davranış, o ekranların kendi kabul dosyalarında ölçülür.
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReasonDialog } from "./ConfirmDialog";

function ac(
  ozellikler: Partial<React.ComponentProps<typeof ReasonDialog>> = {}
) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const sonuc = render(
    <ReasonDialog
      open
      title="Gerekçe iste"
      description="Karar kayda geçer."
      label="Gerekçe"
      onClose={onClose}
      onConfirm={onConfirm}
      {...ozellikler}
    />
  );
  return { onConfirm, onClose, ...sonuc };
}

function alan(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: /Gerekçe/ }) as HTMLTextAreaElement;
}

/* ═════════ SK-7 · kirli formda kapatma ÖNCE SORAR ═════════ */

describe("SK-7 · gerekçe penceresi yazılanı sormadan silmez", () => {
  it("TEMİZ formda ESC doğrudan kapatır (ters prova)", async () => {
    // Bu test tek başına anlamsız; aşağıdaki ikisiyle birlikte "bekçi HER
    // KAPATMAYI engelliyor" yalancı yeşilini kapatır.
    const { onClose } = ac();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).toBeNull();
  });

  it("KİRLİ formda ESC önce sorar; pencere ayakta kalır ve onClose ÇAĞRILMAZ", async () => {
    const { onClose } = ac();
    fireEvent.change(alan(), { target: { value: "Kitap hasarlıydı" } });
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    // Yazılan metin DURUYOR: onay penceresi açılırken içerik sökülmemeli.
    // `getByRole` KULLANILMAZ: Medusa'nın onay penceresi modaldir ve arkadaki
    // ağacı erişilebilirlik ağacından gizler; alan DOM'da durduğu hâlde rol
    // sorgusuyla bulunamaz. Sorulan şey "metin duruyor mu", "okunabiliyor mu"
    // değil.
    expect(
      (document.querySelector("textarea") as HTMLTextAreaElement).value
    ).toBe("Kitap hasarlıydı");
  });

  it("KİRLİ formda × düğmesi de sorar (ESC'e özel bir çözüm değil)", async () => {
    const { onClose } = ac();
    fireEvent.change(alan(), { target: { value: "abc" } });
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Kapat" }));

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("KİRLİ formda dış tıklama da sorar", async () => {
    const { onClose } = ac();
    fireEvent.change(alan(), { target: { value: "abc" } });
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Pencereyi kapat" }));

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("onayı onaylayınca kapanır (bekçi kilit değil, soru)", async () => {
    const { onClose } = ac();
    fireEvent.change(alan(), { target: { value: "abc" } });
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });

    // Onay penceresinin "Çık" düğmesi (`medusa-tr.tsx::promptTr.confirmText`).
    fireEvent.click(await screen.findByRole("button", { name: "Çık" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

/* ═════════ SK-8 · gönder düğmesi geçerlilikle KAPANMAZ ═════════ */

describe("SK-8 · onay düğmesi açık kalır, geçersizde gönderim yapılmaz", () => {
  it("gerekçe ZORUNLUYKEN boş formda düğme AÇIK kalır", () => {
    ac({ required: true, confirmLabel: "Reddet" });
    const onay = screen.getByRole("button", { name: "Reddet" }) as HTMLButtonElement;
    expect(onay.disabled).toBe(false);
  });

  it("boş zorunlu gerekçede gönderim YAPILMAZ, hata ALANDA çıkar, odak alana gider", async () => {
    const { onConfirm } = ac({ required: true, confirmLabel: "Reddet" });
    fireEvent.click(screen.getByRole("button", { name: "Reddet" }));

    await waitFor(() => expect(alan().getAttribute("aria-invalid")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(alan()));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("sınır üstü gerekçede düğme AÇIK ama gönderim YAPILMAZ (422'ye bırakılmaz)", async () => {
    const { onConfirm } = ac({ maxLength: 200, confirmLabel: "Kaydet" });
    fireEvent.change(alan(), { target: { value: "x".repeat(201) } });
    await act(async () => {});

    const onay = screen.getByRole("button", { name: "Kaydet" }) as HTMLButtonElement;
    expect(onay.disabled).toBe(false);
    fireEvent.click(onay);

    await waitFor(() => expect(alan().getAttribute("aria-invalid")).toBe("true"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("geçerli gerekçe KIRPILMIŞ olarak gönderilir (ters prova)", async () => {
    // Yukarıdaki üç test, `onConfirm` HİÇ çağrılmasa da geçerdi.
    const { onConfirm } = ac({ required: true, confirmLabel: "Kaydet" });
    fireEvent.change(alan(), { target: { value: "  yeterli gerekçe  " } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("yeterli gerekçe"));
  });

  it("minLength altındaki gerekçe gönderilmez ama düğme kapanmaz", async () => {
    const { onConfirm } = ac({ required: true, minLength: 3, confirmLabel: "Kaydet" });
    fireEvent.change(alan(), { target: { value: "ab" } });
    await act(async () => {});
    const onay = screen.getByRole("button", { name: "Kaydet" }) as HTMLButtonElement;
    expect(onay.disabled).toBe(false);
    fireEvent.click(onay);

    await waitFor(() => expect(alan().getAttribute("aria-invalid")).toBe("true"));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

/* ═════════ Korunan davranış: sayaç, sınır metni, ad ayrımı ═════════ */

describe("gerekçe penceresinin korunan davranışı", () => {
  it("sayaç GERÇEK sunucu sınırını gösterir ve yazdıkça güncellenir", () => {
    ac({ maxLength: 200 });
    expect(screen.getByText("0/200")).toBeTruthy();
    fireEvent.change(alan(), { target: { value: "abc" } });
    expect(screen.getByText("3/200")).toBeTruthy();
  });

  it("onay ve iptal düğmelerinin adları ÇAKIŞMAZ", () => {
    ac({ confirmLabel: "Vazgeç", cancelLabel: "İptal" });
    expect(screen.getAllByRole("button", { name: "Vazgeç" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "İptal" })).toBeTruthy();
  });

  it("pencere role=dialog + aria-modal taşır", () => {
    ac();
    const p = screen.getByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");
  });

  it("alanın erişilebilir adı etiketten gelir", () => {
    ac({ label: "İptal gerekçesi" });
    expect(screen.getByRole("textbox", { name: "İptal gerekçesi" })).toBeTruthy();
  });

  it("kapalıyken hiçbir şey basılmaz (içerik mount edilmez)", () => {
    ac({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("yeniden açılan pencere ÖNCEKİ gerekçeyi taşımaz", async () => {
    const { rerender, onClose } = ac({ maxLength: 200 });
    fireEvent.change(alan(), { target: { value: "eski" } });
    await act(async () => {});
    rerender(
      <ReasonDialog
        open={false}
        title="Gerekçe iste"
        label="Gerekçe"
        description="Karar kayda geçer."
        maxLength={200}
        onClose={onClose}
        onConfirm={() => {}}
      />
    );
    rerender(
      <ReasonDialog
        open
        title="Gerekçe iste"
        label="Gerekçe"
        description="Karar kayda geçer."
        maxLength={200}
        onClose={onClose}
        onConfirm={() => {}}
      />
    );
    expect(alan().value).toBe("");
  });

  it("işlem sürerken kapatma yolları kapalıdır", async () => {
    const { onClose } = ac({ isPending: true });
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => {});
    expect(onClose).not.toHaveBeenCalled();
  });
});
