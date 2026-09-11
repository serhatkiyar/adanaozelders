import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormPage } from "@/panel/components/FormPage";
import { PanelProvider } from "@/panel/PanelProvider";

describe("FormPage", () => {
  it("bölümleri sekme olarak gösterir ve kaydet'i tetikler", async () => {
    const kaydet = vi.fn();
    render(
      <PanelProvider>
        <FormPage
          baslik="Basit Ürün Ekle"
          geriTiklandi={() => {}}
          kaydet={kaydet}
          bolumler={[
            { anahtar: "temel", baslik: "Temel Bilgi", icerik: <div>temel alanlar</div> },
            { anahtar: "envanter", baslik: "Envanter", icerik: <div>envanter alanları</div> },
          ]}
        />
      </PanelProvider>,
    );
    expect(screen.getByText("Basit Ürün Ekle")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Temel Bilgi" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Envanter" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(kaydet).toHaveBeenCalled();
  });

  it("geri düğmesine tıklanınca geriTiklandi çağrılır", async () => {
    const geriTiklandi = vi.fn();
    render(
      <PanelProvider>
        <FormPage
          baslik="Basit Ürün Ekle"
          geriTiklandi={geriTiklandi}
          kaydet={() => {}}
          bolumler={[{ anahtar: "temel", baslik: "Temel Bilgi", icerik: <div>içerik</div> }]}
        />
      </PanelProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(geriTiklandi).toHaveBeenCalled();
  });

  it("hata doluyken form gövdesi yerine hata alanı gösterir", () => {
    render(
      <PanelProvider>
        <FormPage
          baslik="Basit Ürün Ekle"
          geriTiklandi={() => {}}
          kaydet={() => {}}
          hata="Kayıt yüklenemedi"
          hataAksiyon={<button type="button">Tekrar dene</button>}
          bolumler={[{ anahtar: "temel", baslik: "Temel Bilgi", icerik: <div>temel alanlar</div> }]}
        />
      </PanelProvider>,
    );
    expect(screen.getByText("Kayıt yüklenemedi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tekrar dene" })).toBeInTheDocument();
    expect(screen.queryByText("temel alanlar")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Temel Bilgi" })).not.toBeInTheDocument();
  });

  it("hata varken duyuru rolü taşır", () => {
    render(
      <PanelProvider>
        <FormPage
          baslik="Basit Ürün Ekle"
          geriTiklandi={() => {}}
          kaydet={() => {}}
          hata="Kayıt yüklenemedi"
          bolumler={[{ anahtar: "temel", baslik: "Temel Bilgi", icerik: <div>temel alanlar</div> }]}
        />
      </PanelProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Kayıt yüklenemedi");
  });

  it("geri düğmesi büyük dokunma hedefi boyutundadır", () => {
    render(
      <PanelProvider>
        <FormPage
          baslik="Basit Ürün Ekle"
          geriTiklandi={() => {}}
          kaydet={() => {}}
          bolumler={[{ anahtar: "temel", baslik: "Temel Bilgi", icerik: <div>içerik</div> }]}
        />
      </PanelProvider>,
    );
    expect(screen.getByRole("button", { name: "Geri" })).toHaveClass("ant-btn-lg");
  });

  it("kaydediyorken kaydet düğmesi loading olur ve tekrar tıklanamaz", async () => {
    const kaydet = vi.fn();
    render(
      <PanelProvider>
        <FormPage
          baslik="Basit Ürün Ekle"
          geriTiklandi={() => {}}
          kaydet={kaydet}
          kaydediyor
          bolumler={[{ anahtar: "temel", baslik: "Temel Bilgi", icerik: <div>içerik</div> }]}
        />
      </PanelProvider>,
    );
    const kaydetButonu = screen.getByRole("button", { name: /Kaydet/ });
    expect(kaydetButonu).toHaveClass("ant-btn-loading");
    await userEvent.click(kaydetButonu);
    expect(kaydet).not.toHaveBeenCalled();
  });
});
