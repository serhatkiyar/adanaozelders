import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListePage } from "@/panel/components/ListePage";
import { PanelProvider } from "@/panel/PanelProvider";
import { panelTheme } from "@/panel/theme";

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

  describe("uyari (hata değil — liste ile BİRLİKTE görünen şerit)", () => {
    it("verilmediğinde hiçbir şey değişmiyor (geriye dönük uyum)", () => {
      kur([{ id: 1, ad: "9. Sınıf Matematik" }]);
      expect(screen.getByText("9. Sınıf Matematik")).toBeInTheDocument();
      expect(screen.queryAllByRole("alert")).toHaveLength(0);
    });

    it("verildiğinde liste ile birlikte görünüyor (hatanın aksine gövdenin yerine geçmiyor)", () => {
      render(
        <PanelProvider>
          <ListePage<Satir>
            baslik="Ürünler"
            aramaDegeri=""
            aramaDegisti={() => {}}
            kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
            veri={[{ id: 1, ad: "9. Sınıf Matematik" }]}
            yukleniyor={false}
            uyari="Test uyarı metni"
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
      expect(screen.getByText("9. Sınıf Matematik")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Test uyarı metni");
    });

    it("hata (role=alert, assertive) DEĞİL, polite duyuru semantiği taşır — role=status'tur, ikinci bir role=alert eklenmez", () => {
      render(
        <PanelProvider>
          <ListePage<Satir>
            baslik="Ürünler"
            aramaDegeri=""
            aramaDegisti={() => {}}
            kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
            veri={[{ id: 1, ad: "9. Sınıf Matematik" }]}
            yukleniyor={false}
            uyari="Test uyarı metni"
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
      // `role="status"` WAI-ARIA'da örtük `aria-live="polite"` taşır — bkz.
      // `ListePage.tsx`teki kaynak yorumu. Assertive `role="alert"` hiç yok.
      expect(screen.getByRole("status")).toHaveTextContent("Test uyarı metni");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("araç çubuğu (ikas yerleşimi) — Filtre/görünüm düğmeleri (referans §3)", () => {
    it("hiçbir geri çağrı verilmediğinde hiçbiri render edilmiyor (ölü düğme yok)", () => {
      kur([{ id: 1, ad: "9. Sınıf Matematik" }]);
      expect(screen.queryByRole("button", { name: "Filtre" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Kolon Ayarı" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Liste Görünümü" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Izgara Görünümü" })).not.toBeInTheDocument();
    });

    it("her biri kendi geri çağrısı verildiğinde render edilir ve tıklanınca tetiklenir", async () => {
      const filtreTiklandi = vi.fn();
      const kolonAyariTiklandi = vi.fn();
      const listeGorunumuTiklandi = vi.fn();
      const izgaraGorunumuTiklandi = vi.fn();
      render(
        <PanelProvider>
          <ListePage<Satir>
            baslik="Ürünler"
            aramaDegeri=""
            aramaDegisti={() => {}}
            kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
            veri={[{ id: 1, ad: "9. Sınıf Matematik" }]}
            yukleniyor={false}
            toplam={1}
            sayfa={1}
            sayfaBoyutu={20}
            sayfaDegisti={() => {}}
            bosBaslik="İlk Ürününüzü Yükleyin!"
            bosAciklama="Ürünlerinizi yükleyin ve satışa başlayın."
            rowKey={(k) => k.id}
            filtreTiklandi={filtreTiklandi}
            kolonAyariTiklandi={kolonAyariTiklandi}
            listeGorunumuTiklandi={listeGorunumuTiklandi}
            izgaraGorunumuTiklandi={izgaraGorunumuTiklandi}
          />
        </PanelProvider>,
      );

      await userEvent.click(screen.getByRole("button", { name: "Filtre" }));
      await userEvent.click(screen.getByRole("button", { name: "Kolon Ayarı" }));
      await userEvent.click(screen.getByRole("button", { name: "Liste Görünümü" }));
      await userEvent.click(screen.getByRole("button", { name: "Izgara Görünümü" }));

      expect(filtreTiklandi).toHaveBeenCalledTimes(1);
      expect(kolonAyariTiklandi).toHaveBeenCalledTimes(1);
      expect(listeGorunumuTiklandi).toHaveBeenCalledTimes(1);
      expect(izgaraGorunumuTiklandi).toHaveBeenCalledTimes(1);
    });
  });

  describe("satır seçimi (referans §3 — ilk kolon checkbox, başlıkta tümünü seç)", () => {
    it("satirSecimi verilmediğinde checkbox çıkmıyor (geriye dönük uyum)", () => {
      kur([{ id: 1, ad: "9. Sınıf Matematik" }]);
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });

    it("satirSecimi verildiğinde satır + tümünü seç checkbox'ları çıkıyor", () => {
      render(
        <PanelProvider>
          <ListePage<Satir>
            baslik="Ürünler"
            aramaDegeri=""
            aramaDegisti={() => {}}
            kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
            veri={[{ id: 1, ad: "9. Sınıf Matematik" }]}
            yukleniyor={false}
            toplam={1}
            sayfa={1}
            sayfaBoyutu={20}
            sayfaDegisti={() => {}}
            bosBaslik="İlk Ürününüzü Yükleyin!"
            bosAciklama="Ürünlerinizi yükleyin ve satışa başlayın."
            rowKey={(k) => k.id}
            satirSecimi={{ selectedRowKeys: [], onChange: () => {} }}
          />
        </PanelProvider>,
      );
      // 1 "tümünü seç" (başlık) + 1 satır checkbox'ı.
      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    });
  });

  describe("alt bilgi (referans §3 — 'Satır Adedi:' + aralık/toplam)", () => {
    it("'Satır Adedi:' etiketini ve 'X - Y / Z <birim>' biçimini gösterir, varsayılan birim nötr", () => {
      kur([{ id: 1, ad: "9. Sınıf Matematik" }]);
      expect(screen.getByText("Satır Adedi:")).toBeInTheDocument();
      expect(screen.getByText("1 - 1 / 1 kayıt")).toBeInTheDocument();
    });

    it("birimEtiket verildiğinde onu kullanır", () => {
      render(
        <PanelProvider>
          <ListePage<Satir>
            baslik="Ürünler"
            aramaDegeri=""
            aramaDegisti={() => {}}
            kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
            veri={[{ id: 1, ad: "9. Sınıf Matematik" }]}
            yukleniyor={false}
            toplam={1}
            sayfa={1}
            sayfaBoyutu={20}
            sayfaDegisti={() => {}}
            bosBaslik="İlk Ürününüzü Yükleyin!"
            bosAciklama="Ürünlerinizi yükleyin ve satışa başlayın."
            rowKey={(k) => k.id}
            birimEtiket="Ürün"
          />
        </PanelProvider>,
      );
      expect(screen.getByText("1 - 1 / 1 Ürün")).toBeInTheDocument();
    });
  });

  describe("başlık yanı bilgi ipucu (referans §2 — opsiyonel, verilmezse çıkmaz)", () => {
    it("detayliBilgiIpucu verilmediğinde ikon yok", () => {
      kur([{ id: 1, ad: "9. Sınıf Matematik" }]);
      expect(screen.queryByLabelText("Detaylı Bilgi")).not.toBeInTheDocument();
    });

    it("detayliBilgiIpucu verildiğinde ikon çıkıyor", () => {
      render(
        <PanelProvider>
          <ListePage<Satir>
            baslik="Ürünler"
            aramaDegeri=""
            aramaDegisti={() => {}}
            kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
            veri={[{ id: 1, ad: "9. Sınıf Matematik" }]}
            yukleniyor={false}
            toplam={1}
            sayfa={1}
            sayfaBoyutu={20}
            sayfaDegisti={() => {}}
            bosBaslik="İlk Ürününüzü Yükleyin!"
            bosAciklama="Ürünlerinizi yükleyin ve satışa başlayın."
            rowKey={(k) => k.id}
            detayliBilgiIpucu="Ürünler hakkında detaylı bilgi"
          />
        </PanelProvider>,
      );
      expect(screen.getByLabelText("Detaylı Bilgi")).toBeInTheDocument();
    });
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

  describe("ikas liste kroması (referans §7 'Liste — İKİNCİ TUR ÖLÇÜM')", () => {
    it("panelTheme.components.Table ölçülen değerleri taşıyor", () => {
      // Değerler tahmin değil: `docs/ikas-panel-referans.md` §7'de canlı
      // ikas panelinden `getComputedStyle` ile okundu. Başlık hücresine özgü
      // fark (dolgu `0 12px`, 40px, `fontWeight 500`) burada DEĞİL —
      // `ListePage.tsx`teki `onHeaderCell` satır-içi stilinde; bu token'lar
      // başlık ve veri hücreleri arasında paylaşıldığı için veri satırına
      // göre ayarlı (bkz. dosyadaki yorum).
      expect(panelTheme.components?.Table).toMatchObject({
        headerBg: "#EEF2F6",
        headerColor: "#4B5565",
        borderColor: "transparent",
        headerBorderRadius: 0,
        cellPaddingBlock: 16,
        cellPaddingInline: 12,
      });
    });
  });
});
