import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListePage } from "@/panel/components/ListePage";
import { PanelProvider } from "@/panel/PanelProvider";

type Satir = { id: number; ad: string };

function kur(veri: Satir[], yukleniyor = false, aramaDegisti = () => {}) {
  return render(
    <PanelProvider>
      <ListePage<Satir>
        baslik="Ürünler"
        aramaDegeri=""
        aramaDegisti={aramaDegisti}
        kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
        veri={veri}
        yukleniyor={yukleniyor}
        toplam={veri.length}
        sayfa={1}
        sayfaBoyutu={20}
        sayfaDegisti={() => {}}
        bosBaslik="İlk Ürününüzü Yükleyin!"
        bosAciklama="Ürünlerinizi yükleyin ve satışa başlayın."
        rowKey={(k) => k.id}
      />
    </PanelProvider>,
  );
}

describe("ListePage", () => {
  it("başlığı ve satırları gösterir", () => {
    kur([{ id: 1, ad: "9. Sınıf Matematik" }]);
    expect(screen.getByRole("heading", { name: "Ürünler" })).toBeInTheDocument();
    expect(screen.getByText("9. Sınıf Matematik")).toBeInTheDocument();
  });

  it("veri yokken boş durumu gösterir", () => {
    kur([]);
    expect(screen.getByText("İlk Ürününüzü Yükleyin!")).toBeInTheDocument();
  });

  it("yüklenirken boş durumu göstermez", () => {
    kur([], true);
    expect(screen.queryByText("İlk Ürününüzü Yükleyin!")).not.toBeInTheDocument();
  });

  it("aramaya yazınca geri çağrıyı doğru değerle tetikler", async () => {
    const araması = vi.fn();
    kur([], false, araması);
    await userEvent.type(screen.getByPlaceholderText("Tabloda arama yapın"), "k");
    expect(araması).toHaveBeenCalledWith("k");
  });

  it("hata varken hata mesajını gösterir, tabloyu ve boş durumu gizler", () => {
    render(
      <PanelProvider>
        <ListePage<Satir>
          baslik="Ürünler"
          aramaDegeri=""
          aramaDegisti={() => {}}
          kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
          veri={[{ id: 1, ad: "9. Sınıf Matematik" }]}
          yukleniyor={false}
          hata="Ürünler yüklenemedi."
          toplam={1}
          sayfa={1}
          sayfaBoyutu={20}
          sayfaDegisti={() => {}}
          bosBaslik="İlk Ürününüzü Yükleyin!"
          bosAciklama="Ürünlerinizi yükleyin ve satışa başlayın."
          rowKey={(k) => k.id}
        />
      </PanelProvider>,
    );
    expect(screen.getByText("Ürünler yüklenemedi.")).toBeInTheDocument();
    expect(screen.queryByText("9. Sınıf Matematik")).not.toBeInTheDocument();
    expect(screen.queryByText("İlk Ürününüzü Yükleyin!")).not.toBeInTheDocument();
  });

  it("hata varken duyuru rolü taşır", () => {
    render(
      <PanelProvider>
        <ListePage<Satir>
          baslik="Ürünler"
          aramaDegeri=""
          aramaDegisti={() => {}}
          kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
          veri={[]}
          yukleniyor={false}
          hata="Ürünler yüklenemedi."
          toplam={0}
          sayfa={1}
          sayfaBoyutu={20}
          sayfaDegisti={() => {}}
          bosBaslik="İlk Ürününüzü Yükleyin!"
          bosAciklama="Ürünlerinizi yükleyin ve satışa başlayın."
          rowKey={(k) => k.id}
        />
      </PanelProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Ürünler yüklenemedi.");
  });

  it("boş durumda status/aria-live duyurusu taşır", () => {
    kur([]);
    expect(screen.getByRole("status")).toHaveTextContent("İlk Ürününüzü Yükleyin!");
  });

  it("sayfa değişince geri çağrıyı tetikler", async () => {
    const sayfaDegisti = vi.fn();
    render(
      <PanelProvider>
        <ListePage<Satir>
          baslik="Ürünler"
          aramaDegeri=""
          aramaDegisti={() => {}}
          kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
          veri={[{ id: 1, ad: "9. Sınıf Matematik" }]}
          yukleniyor={false}
          toplam={25}
          sayfa={1}
          sayfaBoyutu={20}
          sayfaDegisti={sayfaDegisti}
          bosBaslik="İlk Ürününüzü Yükleyin!"
          bosAciklama="Ürünlerinizi yükleyin ve satışa başlayın."
          rowKey={(k) => k.id}
        />
      </PanelProvider>,
    );
    await userEvent.click(screen.getByText("2"));
    expect(sayfaDegisti).toHaveBeenCalledWith(2, 20);
  });

  describe("sıralama/filtre kanalı (tabloDegisti)", () => {
    function kurSiralanabilir(tabloDegisti?: (...args: unknown[]) => void) {
      return render(
        <PanelProvider>
          <ListePage<Satir>
            baslik="Ürünler"
            aramaDegeri=""
            aramaDegisti={() => {}}
            kolonlar={[{ title: "Ad", dataIndex: "ad", key: "ad", sorter: true }]}
            veri={[{ id: 1, ad: "9. Sınıf Matematik" }]}
            yukleniyor={false}
            toplam={1}
            sayfa={1}
            sayfaBoyutu={20}
            sayfaDegisti={() => {}}
            bosBaslik="İlk Ürününüzü Yükleyin!"
            bosAciklama="Ürünlerinizi yükleyin ve satışa başlayın."
            rowKey={(k) => k.id}
            tabloDegisti={tabloDegisti}
          />
        </PanelProvider>,
      );
    }

    it("prop verilmediğinde sıralanabilir başlığa tıklamak hata vermez, mevcut davranış sürer", async () => {
      kurSiralanabilir(undefined);
      await userEvent.click(screen.getByRole("columnheader", { name: "Ad" }));
      // Çökmedi ve satır hâlâ görünür — geriye dönük uyum.
      expect(screen.getByText("9. Sınıf Matematik")).toBeInTheDocument();
    });

    it("sıralanabilir kolonun başlığına tıklanınca tüketiciye doğru sıralama bilgisi ulaşır", async () => {
      const tabloDegisti = vi.fn();
      kurSiralanabilir(tabloDegisti);

      await userEvent.click(screen.getByRole("columnheader", { name: "Ad" }));

      expect(tabloDegisti).toHaveBeenCalledTimes(1);
      const [, , sorter] = tabloDegisti.mock.calls[0];
      expect(sorter).toMatchObject({ order: "ascend", columnKey: "ad" });
    });
  });
});
