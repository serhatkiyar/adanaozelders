/**
 * `useModalA11y` — odak sıfırlaması regresyonu (TB-A3c-1, İP-A4 · Görev 1).
 *
 * ## Neyi kanıtlıyor
 *
 * Etki eskiden `onClose` bağımlılığıyla kuruluyordu. Panelde yaygın desen
 * `onClose={() => setAcik(false)}` — satır içi ok fonksiyonu, kimliği her
 * render'da değişir. Sonuç: ebeveyn her render ettiğinde etki sökülüp yeniden
 * kuruluyor, odak panelin İLK odaklanabilir öğesine dönüyordu.
 *
 * Bu, İP-A3c'nin yeni davranışını ("gönderimde odak ilk hatalı alana taşınır")
 * sessizce iptal ediyordu: form her tuş vuruşunda render eder.
 *
 * ## Testin gücü
 *
 * GERÇEK DOM davranışı ölçülür — `document.activeElement`. Kaynak taraması
 * değil: bağımlılık dizisinden `onClose`u çıkarmak ama işleyiciyi bayat
 * closure'dan okumak da testi geçirmezdi (aşağıdaki "güncel işleyici" testi).
 *
 * Ters prova (`docs/ip-a4-rapor.md` → Görev 1): `onCloseRef` sökülüp `onClose`
 * bağımlılığa geri konduğunda 1. test kırılır.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useModalA11y } from "./useModalA11y";

/**
 * GERÇEKÇİ çağıran: `onClose` satır içi ok fonksiyonu (kimlik her render'da
 * değişir) ve ebeveynin kendi durumu var, yani yeniden render edebiliyor.
 */
function Pencere({ onClose }: { onClose?: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [sayac, setSayac] = useState(0);

  useModalA11y({
    open: true,
    // Satır içi ok fonksiyonu — bilinçli. Düzeltmenin çözdüğü şey tam olarak
    // budur; sabit kimlikli bir işleyici testi anlamsız kılardı.
    onClose: () => onClose?.(),
    panelRef,
  });

  return (
    <div ref={panelRef} role="dialog" aria-modal="true">
      <button type="button">İlk düğme</button>
      <input aria-label="İkinci alan" />
      <button type="button" onClick={() => setSayac((s) => s + 1)}>
        Yeniden render ({sayac})
      </button>
    </div>
  );
}

describe("useModalA11y · odak sıfırlaması (TB-A3c-1)", () => {
  it("ebeveyn yeniden render edilince odağı TAŞIMAZ", () => {
    render(<Pencere />);

    // Açılışta odak paneldeki ilk odaklanabilir öğede (mevcut sözleşme).
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "İlk düğme" }));

    // Kullanıcı (ya da kod — İP-A3c'de "ilk hatalı alana odaklan") odağı
    // başka bir alana taşır.
    const alan = screen.getByLabelText("İkinci alan");
    alan.focus();
    expect(document.activeElement).toBe(alan);

    // Ebeveyn yeniden render eder. Eskiden burada etki yeniden kurulur ve
    // odak "İlk düğme"ye geri sıçrardı.
    fireEvent.click(screen.getByRole("button", { name: /Yeniden render/ }));

    expect(
      document.activeElement,
      "yeniden render odağı sıfırladı — ilk hatalı alana odaklanma davranışı iptal olur"
    ).toBe(alan);
  });

  it("yeniden render arka plan kilidini bozmaz", () => {
    // İkinci zarar: her render'da `body.style.overflow` yeniden okunup
    // yazılıyordu; okunan "önceki" değer kendi yazdığımız `hidden` oluyordu.
    // Kapanışta arka plan kilitli kalabilirdi.
    document.body.style.overflow = "";
    const { unmount } = render(<Pencere />);
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByRole("button", { name: /Yeniden render/ }));
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow, "kapanışta arka plan kilitli kaldı").toBe("");
  });

  it("Esc HÂLÂ kapatır ve GÜNCEL işleyiciyi çağırır", () => {
    // Ref'e taşımanın klasik hatası: işleyici bayat closure'dan okunur.
    // Burada ebeveyn işleyiciyi değiştirir ve yenisinin çağrıldığı görülür.
    const eski = vi.fn();
    const yeni = vi.fn();
    const { rerender } = render(<Pencere onClose={eski} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(eski).toHaveBeenCalledTimes(1);

    rerender(<Pencere onClose={yeni} />);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(yeni, "bayat closure çağrıldı — ref güncellenmiyor").toHaveBeenCalledTimes(1);
    expect(eski).toHaveBeenCalledTimes(1);
  });

  it("odak tuzağı korunur: son öğeden Tab ilk öğeye döner", () => {
    render(<Pencere />);
    const son = screen.getByRole("button", { name: /Yeniden render/ });
    son.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "İlk düğme" }));
  });
});
