import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Modal } from "@/components/ui/Modal";

/**
 * 18 tüketici modalının hiçbirinde odak tuzağı yoktu: modal açıkken Tab'a
 * basan kullanıcı arkadaki sayfaya düşüyor, ekran okuyucu kullanıcısı modalın
 * dışına çıktığını fark etmiyordu. Aşağıdaki testler sözleşmeyi sabitler.
 */
describe("Modal", () => {
  it("kapalıyken hiçbir şey çizmez", () => {
    render(
      <Modal open={false} onClose={() => {}} title="Test">
        <button type="button">İçerik</button>
      </Modal>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dialog rolü ve erişilebilir ad verir", () => {
    render(
      <Modal open onClose={() => {}} title="Şikayet et">
        <button type="button">Gönder</button>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Şikayet et" })).toBe(dialog);
  });

  it("başlık çizilmeyen modalda ariaLabel ad olur", () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="Ders talebi" hideCloseButton>
        <button type="button">Devam</button>
      </Modal>
    );
    expect(screen.getByRole("dialog", { name: "Ders talebi" })).toBeTruthy();
  });

  it("Esc tuşu kapatır", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test">
        <button type="button">İçerik</button>
      </Modal>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("açılışta odağı panele taşır", () => {
    render(
      <Modal open onClose={() => {}} title="Test" hideCloseButton>
        <button type="button">İlk düğme</button>
      </Modal>
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "İlk düğme" })
    );
  });

  it("Tab sonuncudan ilkine döner (odak dışarı kaçmaz)", () => {
    render(
      <Modal open onClose={() => {}} title="Test" hideCloseButton>
        <button type="button">Bir</button>
        <button type="button">İki</button>
      </Modal>
    );
    const first = screen.getByRole("button", { name: "Bir" });
    const last = screen.getByRole("button", { name: "İki" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("açıkken arka plan kaydırması kilitlenir, kapanınca serbest kalır", () => {
    const { unmount } = render(
      <Modal open onClose={() => {}} title="Test">
        <button type="button">İçerik</button>
      </Modal>
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("panel her zaman relative konumlanır (arka plan üstte kalmasın)", () => {
    // Regresyon: panelClassName verildiğinde `relative` düşmüştü; arka plan
    // absolute olduğu için panel altta kalıyor ve düğmeler tıklanamıyordu.
    render(
      <Modal open onClose={() => {}} ariaLabel="Test" panelClassName="w-full bg-white">
        <button type="button">İçerik</button>
      </Modal>
    );
    expect(screen.getByRole("dialog").className).toContain("relative");
  });
});
