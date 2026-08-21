/**
 * İP-A4 · Görev 2 — düzenleme yüzeyi sözleşmesinin testleri.
 *
 * Bu dosya A7'de 70 ekranın dayanacağı davranışları sabitler:
 *
 *   1. Hedef sözleşmesi (`kayit` / `yeni` / kapalı).
 *   2. Kapatma yollarının HEPSİ bekçiden geçer (× · ESC · dış tıklama ·
 *      Vazgeç) — ekran bunu yeniden yazmaz, dolayısıyla UNUTAMAZ.
 *   3. `kapat()` KOŞULSUZDUR: kaydedildikten sonra soru sorulmaz.
 *   4. İşlem sürerken pencere kapanmaz (yarıda kesilen gönderim).
 *
 * Gerçek DOM: bekçinin gerçekten bağlı olduğunun tek kanıtı, kirli formda
 * onay penceresinin AÇILMASIDIR.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/admin/ui";

import { DuzenlemeYuzeyi, useDuzenlemeYuzeyi } from "./duzenlemeYuzeyi";

interface Kayit {
  id: number;
  ad: string;
}

/** Hem hook'u hem bileşeni birlikte kullanan gerçekçi bir ekran. */
function Ekran({
  islemSuruyor = false,
  sunucuHatasi = null,
  onKapandi,
}: {
  islemSuruyor?: boolean;
  sunucuHatasi?: unknown;
  onKapandi?: () => void;
}) {
  const yuzey = useDuzenlemeYuzeyi<Kayit, "yeni-kayit">();
  const form = useForm<{ ad: string }>({ defaultValues: { ad: "" } });

  return (
    <div>
      <span data-testid="durum">
        {yuzey.acik ? (yuzey.yeni ? `yeni:${yuzey.baglam}` : `kayit:${yuzey.kayit?.id}`) : "kapalı"}
      </span>
      <Button onClick={() => yuzey.yeniAc("yeni-kayit")}>Yeni</Button>
      <Button onClick={() => yuzey.ac({ id: 7, ad: "Kayıt" })}>Düzenle</Button>
      <Button
        onClick={() => {
          // KOŞULSUZ kapatma — "kaydedildi" yolu.
          yuzey.kapat();
          onKapandi?.();
        }}
      >
        Kaydedildi gibi kapat
      </Button>

      <DuzenlemeYuzeyi
        yuzey={yuzey}
        baslik="Kayıt düzenle"
        aciklama="Açıklama satırı"
        form={form}
        sunucuHatasi={sunucuHatasi}
        islemSuruyor={islemSuruyor}
        aksiyonlar={<Button>Kaydet</Button>}
      >
        <label>
          Ad
          <input {...form.register("ad")} />
        </label>
      </DuzenlemeYuzeyi>
    </div>
  );
}

const durum = () => screen.getByTestId("durum").textContent;

describe("İP-A4 · düzenleme yüzeyi sözleşmesi", () => {
  it("kapalı başlar ve kapalıyken HİÇBİR pencere çizmez", () => {
    render(<Ekran />);
    expect(durum()).toBe("kapalı");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'yeni' ile 'kayıt' hedefleri ayrıdır", () => {
    render(<Ekran />);

    fireEvent.click(screen.getByRole("button", { name: "Yeni" }));
    expect(durum()).toBe("yeni:yeni-kayit");
    expect(screen.getByRole("dialog", { name: /kayıt düzenle/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Kaydedildi gibi kapat" }));
    expect(durum()).toBe("kapalı");

    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    expect(durum()).toBe("kayit:7");
  });

  it("başlık ve açıklama pencerenin erişilebilir adına girer", () => {
    render(<Ekran />);
    fireEvent.click(screen.getByRole("button", { name: "Yeni" }));
    const pencere = screen.getByRole("dialog");
    expect(pencere.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("dialog", { name: /kayıt düzenle/i })).toBe(pencere);
    expect(screen.getByText("Açıklama satırı")).toBeTruthy();
  });

  it("'Vazgeç' düğmesi YÜZEYİN kendisindedir (ekran yazmaz)", () => {
    render(<Ekran />);
    fireEvent.click(screen.getByRole("button", { name: "Yeni" }));
    expect(screen.getByRole("button", { name: /vazgeç/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /kaydet/i })).toBeTruthy();
  });

  describe("kirli form bekçisi yüzeyin İÇİNDEN bağlı", () => {
    const kirlet = () =>
      fireEvent.change(screen.getByLabelText(/ad/i), { target: { value: "x" } });

    // Dört kapatma yolunun DÖRDÜ de bekçiden geçmeli. Bir tanesinin
    // atlanması, kullanıcının yazdığını uyarısız kaybetmesi demektir.
    const yollar: [string, () => void][] = [
      ["Vazgeç", () => fireEvent.click(screen.getByRole("button", { name: /vazgeç/i }))],
      ["kapatma düğmesi", () => fireEvent.click(screen.getByText("Kapat"))],
      ["ESC", () => fireEvent.keyDown(document, { key: "Escape" })],
      [
        "dış tıklama",
        () => fireEvent.click(screen.getByLabelText("Pencereyi kapat")),
      ],
    ];

    for (const [ad, kapat] of yollar) {
      it(`${ad} — kirli formda ONAY sorar, pencere kapanmaz`, async () => {
        render(<Ekran />);
        fireEvent.click(screen.getByRole("button", { name: "Yeni" }));
        kirlet();

        kapat();

        expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
        expect(durum(), "form onaysız kapandı").toBe("yeni:yeni-kayit");
      });

      it(`${ad} — TEMİZ formda doğrudan kapatır`, async () => {
        // Ters prova: yukarıdaki testler bekçi HER kapatmayı engellese de
        // geçerdi.
        render(<Ekran />);
        fireEvent.click(screen.getByRole("button", { name: "Yeni" }));

        kapat();

        await waitFor(() => expect(durum()).toBe("kapalı"));
        expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).toBeNull();
      });
    }

    it("sunucu hatası varsa gönderim sonrası da KİRLİ sayılır", async () => {
      // `isSubmitSuccessful` tek başına "mutate çağrıldı" demektir; bekçi
      // sunucu hatasını da okur (İP-A3a sözleşmesi, burada yüzeyden geçiyor).
      render(<Ekran sunucuHatasi={new Error("500")} />);
      fireEvent.click(screen.getByRole("button", { name: "Yeni" }));
      fireEvent.change(screen.getByLabelText(/ad/i), { target: { value: "x" } });

      fireEvent.click(screen.getByRole("button", { name: /vazgeç/i }));
      expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    });
  });

  it("kapat() KOŞULSUZDUR: kirli formda bile soru sormaz", async () => {
    // Kaydedilmiş veriyi kapatırken kullanıcıya "kaydedilmemiş değişiklik"
    // sormak, doğru olanı yapan kullanıcıyı cezalandırmaktır.
    const kapandi = vi.fn();
    render(<Ekran onKapandi={kapandi} />);
    fireEvent.click(screen.getByRole("button", { name: "Yeni" }));
    fireEvent.change(screen.getByLabelText(/ad/i), { target: { value: "x" } });

    fireEvent.click(screen.getByRole("button", { name: "Kaydedildi gibi kapat" }));

    expect(durum()).toBe("kapalı");
    expect(kapandi).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).toBeNull();
  });

  it("işlem sürerken pencere kapanmaz", () => {
    render(<Ekran islemSuruyor />);
    fireEvent.click(screen.getByRole("button", { name: "Yeni" }));

    // "Vazgeç" kapalı; ESC ve dış tıklama da sonuçsuz.
    expect(
      (screen.getByRole("button", { name: /vazgeç/i }) as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Pencereyi kapat"));
    expect(durum(), "gönderim sürerken pencere kapandı").toBe("yeni:yeni-kayit");
  });
});
