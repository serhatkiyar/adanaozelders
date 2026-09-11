import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { PanelProvider } from "@/panel/PanelProvider";

describe("HataDurumu", () => {
  it("hata mesajını ve aksiyonu gösterir, tıklanınca aksiyon tetiklenir", async () => {
    const tekrarDene = vi.fn();
    render(
      <PanelProvider>
        <HataDurumu hata="Kayıtlar yüklenemedi." hataAksiyon={<button onClick={tekrarDene}>Tekrar dene</button>} />
      </PanelProvider>,
    );
    expect(screen.getByText("Kayıtlar yüklenemedi.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(tekrarDene).toHaveBeenCalled();
  });

  it("tek bir role=alert taşır (AntD Alert'in kendi rolü) — ikinci bir sarmalayıcı EKLEMEZ", () => {
    render(
      <PanelProvider>
        <HataDurumu hata="Kayıtlar yüklenemedi." />
      </PanelProvider>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Kayıtlar yüklenemedi.");
  });

  it("hataAksiyon verilmezse aksiyon alanı boş kalır", () => {
    render(
      <PanelProvider>
        <HataDurumu hata="Kayıtlar yüklenemedi." />
      </PanelProvider>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("YukleniyorDurumu", () => {
  it("etiket verilmezse varsayılan 'Yükleniyor…' metnini gösterir", () => {
    render(
      <PanelProvider>
        <YukleniyorDurumu />
      </PanelProvider>,
    );
    expect(screen.getByText("Yükleniyor…")).toBeInTheDocument();
  });

  it("özel etiket verilirse onu gösterir", () => {
    render(
      <PanelProvider>
        <YukleniyorDurumu etiket="Varyant bilgileri yükleniyor…" />
      </PanelProvider>,
    );
    expect(screen.getByText("Varyant bilgileri yükleniyor…")).toBeInTheDocument();
  });
});

describe("BosDurumu", () => {
  it("başlık, açıklama ve aksiyonu gösterir; status/aria-live duyurusu taşır", () => {
    render(
      <PanelProvider>
        <BosDurumu
          baslik="İlk Ürününüzü Yükleyin!"
          aciklama="Ürünlerinizi yükleyin ve satışa başlayın."
          aksiyon={<button>Ürün Ekle</button>}
        />
      </PanelProvider>,
    );
    expect(screen.getByText("İlk Ürününüzü Yükleyin!")).toBeInTheDocument();
    expect(screen.getByText("Ürünlerinizi yükleyin ve satışa başlayın.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ürün Ekle" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("İlk Ürününüzü Yükleyin!");
  });
});
