import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App, Button } from "antd";
import { PanelProvider } from "@/panel/PanelProvider";
import { onayAc } from "@/panel/components/onayPenceresi";

/**
 * Onay penceresinin sözleşmesi — ASIL İDDİA: AntD'ye hiçbir koşulda reddedilmiş söz
 * verilmez, dolayısıyla süreç düzeyinde yakalanmamış rejection doğmaz.
 *
 * Bu dosya `unhandledrejection`ı SUSTURMAZ; tam tersine kendi dinleyicisiyle SAYAR ve
 * sıfır olmasını iddia eder. Vitest ayarına, global susturmaya ya da körlemesine
 * `.catch(() => {})` yutmasına dayanan bir kaçış yolu yoktur.
 */
function Ekran({
  mesgulMu,
  calistir,
  kapanista,
}: {
  mesgulMu: () => boolean;
  calistir: () => Promise<unknown> | null;
  kapanista?: () => void;
}) {
  const { modal } = App.useApp();
  return (
    <Button
      onClick={() =>
        onayAc(modal, {
          title: "Kaydı sil",
          content: "Bu kayıt kalıcı olarak silinecek.",
          okText: "Sil",
          cancelText: "Vazgeç",
          okButtonProps: { danger: true },
          mesgulMu,
          calistir,
          kapanista,
        })
      }
    >
      Aç
    </Button>
  );
}

const kur = (p: React.ComponentProps<typeof Ekran>) =>
  render(
    <PanelProvider>
      <Ekran {...p} />
    </PanelProvider>,
  );
const onay = () => document.querySelector(".ant-modal-confirm");
const acikMi = () => Boolean(onay() && !onay()!.classList.contains("ant-zoom-leave"));
const dugme = (ad: RegExp) => {
  const modal = document.querySelector(".ant-modal-confirm") as HTMLElement;
  return [...modal.querySelectorAll("button")].find((b) => ad.test(b.textContent ?? "")) as HTMLButtonElement;
};

/** Ertelenmiş söz: çözümü/reddi testin elinde. */
function ertelenmis() {
  let coz!: (v?: unknown) => void;
  let red!: (e: unknown) => void;
  const soz = new Promise((r, j) => {
    coz = r;
    red = j;
  });
  return { soz, coz, red };
}

describe("onayAc", () => {
  let yakalanmamis: unknown[] = [];
  const dinleyici = (e: PromiseRejectionEvent) => {
    yakalanmamis.push(e.reason);
  };
  beforeEach(() => {
    yakalanmamis = [];
    window.addEventListener("unhandledrejection", dinleyici);
  });
  afterEach(async () => {
    // Rejection olayları mikro görevden sonra gelir: kontrolden ÖNCE bir tur bekle.
    await act(async () => { await Promise.resolve(); });
    window.removeEventListener("unhandledrejection", dinleyici);
    expect(yakalanmamis).toEqual([]);
  });

  it("pending sırasında Vazgeç/ESC/maske kapatmaz; hata sonrası pencere açık ve yeniden denenebilir", async () => {
    const { soz, red } = ertelenmis();
    let mesgul = false;
    const calistir = vi.fn(() => {
      mesgul = true;
      return soz.catch((e) => {
        // Ekranın kendi hata gösterimi burada olur; kilit bırakılır.
        mesgul = false;
        throw e;
      });
    });
    kur({ mesgulMu: () => mesgul, calistir });
    await userEvent.click(screen.getByRole("button", { name: "Aç" }));
    await waitFor(() => expect(acikMi()).toBe(true));
    await userEvent.click(dugme(/Sil$/));
    expect(calistir).toHaveBeenCalledTimes(1);

    // Pending: üç kapatma yolu da pencereyi kapatmaz.
    await userEvent.click(dugme(/Vazgeç$/));
    expect(acikMi()).toBe(true);
    fireEvent.keyDown(document.querySelector(".ant-modal-wrap") as HTMLElement, { key: "Escape", keyCode: 27 });
    expect(acikMi()).toBe(true);
    fireEvent.click(document.querySelector(".ant-modal-wrap") as HTMLElement);
    expect(acikMi()).toBe(true);

    // 409/500: hata çağıranda gösterilir, pencere AÇIK kalır ve tekrar denenebilir.
    await act(async () => {
      red({ response: { status: 409 } });
      await Promise.resolve();
    });
    expect(acikMi()).toBe(true);
    await userEvent.click(dugme(/Sil$/));
    expect(calistir).toHaveBeenCalledTimes(2);
  });

  it("aynı tick çift onay TEK mutation açar", async () => {
    const { soz } = ertelenmis();
    let mesgul = false;
    const calistir = vi.fn(() => {
      // Gerçek kilit deseni: ikinci çağrı `mesgulMu` sayesinde hiç gelmez.
      mesgul = true;
      return soz;
    });
    kur({ mesgulMu: () => mesgul, calistir });
    await userEvent.click(screen.getByRole("button", { name: "Aç" }));
    await waitFor(() => expect(acikMi()).toBe(true));
    const sil = dugme(/Sil$/);
    fireEvent.click(sil);
    fireEvent.click(sil);
    expect(calistir).toHaveBeenCalledTimes(1);
  });

  it("meşgul başlangıçta istek hiç çıkmaz ve pencere sessizce açık kalır", async () => {
    const calistir = vi.fn(() => Promise.resolve());
    kur({ mesgulMu: () => true, calistir });
    await userEvent.click(screen.getByRole("button", { name: "Aç" }));
    await waitFor(() => expect(acikMi()).toBe(true));
    await userEvent.click(dugme(/Sil$/));
    expect(calistir).not.toHaveBeenCalled();
    expect(acikMi()).toBe(true);
    // Kilit isteği reddederse (`null`) da aynı: söz üretilmez, pencere açık kalır.
  });

  it("başarıda pencere YALNIZ BİR kez kapanır ve kapanış geri çağrısı çalışır", async () => {
    const { soz, coz } = ertelenmis();
    const kapanista = vi.fn();
    kur({ mesgulMu: () => false, calistir: () => soz, kapanista });
    await userEvent.click(screen.getByRole("button", { name: "Aç" }));
    await waitFor(() => expect(acikMi()).toBe(true));
    await userEvent.click(dugme(/Sil$/));
    await act(async () => {
      coz();
      await Promise.resolve();
    });
    await waitFor(() => expect(acikMi()).toBe(false));
    expect(kapanista).toHaveBeenCalledTimes(1);
  });

  it("meşgul değilken Vazgeç kapatır", async () => {
    const kapanista = vi.fn();
    kur({ mesgulMu: () => false, calistir: () => Promise.resolve(), kapanista });
    await userEvent.click(screen.getByRole("button", { name: "Aç" }));
    await waitFor(() => expect(acikMi()).toBe(true));
    await userEvent.click(dugme(/Vazgeç$/));
    await waitFor(() => expect(acikMi()).toBe(false));
    expect(kapanista).toHaveBeenCalledTimes(1);
  });
});
