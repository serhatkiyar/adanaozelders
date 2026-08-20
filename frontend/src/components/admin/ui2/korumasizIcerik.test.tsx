/**
 * İP-A7d4 · Görev 1 — "içeriğim korumasız" dedektörünün ters provası.
 *
 * Yakalanan sınıf: pencere kullanıcı verisi tutuyor ama hiçbir kirli form
 * bekçisi kaydolmamış → ×/ESC/dış tıklama yazılanı SORMADAN siliyor.
 *
 * Bu sınıf göç boyunca İKİ KEZ üretimde canlı bulundu (SK-4 · `ProductForm`,
 * SK-7 · `ReasonDialog`) ve ikisi de ELLE arandı. Aşağıdaki testler dedektörün
 * üçüncüyü CI'da bulacağının kanıtıdır.
 *
 * ## Neden dört yönlü (üç değil)
 *
 * Görev tanımı üç yön istiyor: yakalanan / beyanlı / bekçili. Dördüncüsü
 * eklendi ve testin kendisi için kritik: **girdisiz pencere de geçmeli.**
 * O olmadan "dedektör her pencerede patlıyor" ile "dedektör doğru pencerede
 * patlıyor" ayırt edilemezdi — panelde onay penceresi (`ConfirmDialog`) çok
 * ve hepsi meşru biçimde bekçisiz.
 */
import { render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/admin/ui/Dialog";

import {
  DuzenlemePenceresi,
  DuzenlemeYuzeyi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
} from "./duzenlemeYuzeyi";
import { girdiTasiyanKontroller } from "./icerikKorumasi";
import { HATA_TAKIBI_YOK } from "./kirliFormBekcisi";

class HataSiniri extends Component<
  { children: ReactNode; yakalandi: (h: Error) => void },
  { patladi: boolean }
> {
  state = { patladi: false };
  static getDerivedStateFromError() {
    return { patladi: true };
  }
  componentDidCatch(hata: Error) {
    this.props.yakalandi(hata);
  }
  render() {
    return this.state.patladi ? <p>patladı</p> : this.props.children;
  }
}

function kur(icerik: ReactNode) {
  const hatalar: Error[] = [];
  const sessiz = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<HataSiniri yakalandi={(h) => hatalar.push(h)}>{icerik}</HataSiniri>);
  sessiz.mockRestore();
  return hatalar;
}

/** Açık bir pencereyi tek başına kuran yardımcı (yüzey katmanı YOK). */
function CiplakPencere({
  korumasiz,
  children,
  baslik = "Gerekçe",
}: {
  korumasiz?: true;
  children: ReactNode;
  baslik?: string;
}) {
  return (
    <Dialog open title={baslik} onClose={() => {}} korumasiz={korumasiz}>
      {children}
    </Dialog>
  );
}

describe("İP-A7d4 · korumasız içerik dedektörü · dört yön", () => {
  it("(1) girdi taşıyan + beyansız + bekçisiz pencere YAKALANIR", () => {
    const hatalar = kur(
      <CiplakPencere>
        <label>
          İptal gerekçesi
          <textarea name="gerekce" />
        </label>
      </CiplakPencere>
    );
    expect(screen.getByText("patladı")).toBeTruthy();
    expect(hatalar).toHaveLength(1);
    // Mesaj TEŞHİS değil TALİMAT vermeli: üç çıkış yolunu da adıyla saysın.
    expect(hatalar[0].message).toContain("kirli form bekçisi kaydolmadı");
    expect(hatalar[0].message).toContain("useYuzeyKirliFormBekcisi");
    expect(hatalar[0].message).toContain("DuzenlemeYuzeyi");
    expect(hatalar[0].message).toContain("korumasiz");
    // Pencereyi adıyla söylesin: on üç çağrı yerli bir bileşende "hangi
    // pencere" sorusunun cevabı yığın izinden okunamıyordu (SK-7).
    expect(hatalar[0].message).toContain("Gerekçe");
  });

  it("(2) AYNI pencere `korumasiz` beyanıyla GEÇER", () => {
    const hatalar = kur(
      <CiplakPencere korumasiz>
        <label>
          İptal gerekçesi
          <textarea name="gerekce" />
        </label>
      </CiplakPencere>
    );
    expect(screen.queryByText("patladı")).toBeNull();
    expect(hatalar).toEqual([]);
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("(3) bekçili pencere beyansız GEÇER", () => {
    function Icerik() {
      const form = useForm<{ deger: string }>({ defaultValues: { deger: "" } });
      useYuzeyKirliFormBekcisi({ form, sunucuHatasi: HATA_TAKIBI_YOK });
      return <input aria-label="Değer" {...form.register("deger")} />;
    }
    function Ekran() {
      const yuzey = useDuzenlemeYuzeyi<{ id: number }, void>();
      // Açık kur: kapalı pencere hiçbir şey render etmez ve dedektör de
      // ölçemez — bu test o boşluğu değil, gerçek açık pencereyi sınıyor.
      if (!yuzey.acik) yuzey.ac({ id: 1 });
      return (
        <DuzenlemePenceresi yuzey={yuzey} baslik="Düzenle">
          <Icerik />
        </DuzenlemePenceresi>
      );
    }
    const hatalar = kur(<Ekran />);
    expect(hatalar).toEqual([]);
    expect(screen.getByLabelText("Değer")).toBeTruthy();
  });

  it("(4) girdisiz pencere beyansız GEÇER (onay penceresi meşrudur)", () => {
    const hatalar = kur(
      <CiplakPencere baslik="Turu iptal et">
        <p>Bu turu iptal etmek istediğinize emin misiniz?</p>
        <button type="button">Vazgeç</button>
        <button type="submit">İptal et</button>
      </CiplakPencere>
    );
    expect(hatalar).toEqual([]);
    expect(screen.getByText(/emin misiniz/)).toBeTruthy();
  });

  it("(4b) yalnız devre dışı/salt-okunur kontrol taşıyan pencere GEÇER", () => {
    // Kullanıcı bunlara bir şey yazamaz; kapatınca kaybedeceği bir şey yok.
    // Dedektör "form etiketi gördüm" diye patlasaydı bu da kırmızı olurdu.
    const hatalar = kur(
      <CiplakPencere baslik="Sipariş özeti">
        <input aria-label="Sipariş kodu" readOnly value="SIP-1" onChange={() => {}} />
        <input aria-label="Tutar" disabled value="120" onChange={() => {}} />
      </CiplakPencere>
    );
    expect(hatalar).toEqual([]);
  });

  it("`DuzenlemeYuzeyi` (formu dışarıdan alan yüzey) bekçiyi kendi bağlar", () => {
    function Ekran() {
      const yuzey = useDuzenlemeYuzeyi<{ id: number }, void>();
      const form = useForm<{ deger: string }>({ defaultValues: { deger: "" } });
      if (!yuzey.acik) yuzey.ac({ id: 1 });
      return (
        <DuzenlemeYuzeyi
          yuzey={yuzey}
          baslik="Hasar"
          form={form}
          sunucuHatasi={HATA_TAKIBI_YOK}
          aksiyonlar={<button type="submit">Kaydet</button>}
        >
          <input aria-label="Adet" {...form.register("deger")} />
        </DuzenlemeYuzeyi>
      );
    }
    expect(kur(<Ekran />)).toEqual([]);
    expect(screen.getByLabelText("Adet")).toBeTruthy();
  });
});

/* ═════ Geriye dönük sınama: SK-4 ve SK-7 (düzeltilmeden ÖNCEKİ hâlleriyle) ═════ */

/**
 * İkisi de sentetiktir ve BİLEREK öyle: gerçek dosyalar düzeltildi, geri
 * almak bu paketin dışındaki testleri kırardı. Sentetik yeniden üretim
 * kusurun ŞEKLİNİ taşır — dedektörün gördüğü şey de zaten şekildir
 * (pencere + girdi + kayıtsızlık), dosya adı değil.
 */
describe("İP-A7d4 · dedektör geriye dönük sınama", () => {
  it("SK-7 (A7d3 · `ReasonDialog` düzeltilmeden önce) YAKALANIR", () => {
    // Düzeltmeden önceki yazım birebir: kendi `Dialog`ını kurar, 2000
    // karakterlik `textarea` taşır, hiçbir bekçi çağırmaz, gönder düğmesi
    // geçerlilikle kapanır. On üç çağrı yerinde canlıydı.
    function EskiReasonDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
      const deger = "";
      return (
        <Dialog open={open} title="Sipariş iptali" onClose={onClose}>
          <label>
            <span>İptal gerekçesi</span>
            <textarea maxLength={2000} defaultValue={deger} />
            <span>{deger.length}/2000</span>
          </label>
          <button type="button" disabled={deger.length < 10}>
            Onayla
          </button>
        </Dialog>
      );
    }
    const hatalar = kur(<EskiReasonDialog open onClose={() => {}} />);
    expect(hatalar).toHaveLength(1);
    expect(hatalar[0].message).toContain("Sipariş iptali");
  });

  it("SK-4 (A7d2 · `ProductForm` düzeltilmeden önce) YAKALANIR — kusur ÇAPRAZ DOSYALI", () => {
    // Pencere bir dosyada, alanlar başka bir dosyada: pencere "içimde alan
    // yok" der, form "pencerede miyim bilmiyorum" der. Tek dosyaya bakan bir
    // kaynak taraması bu ikisini birleştiremez; çalışma zamanı birleştirir.
    function EskiProductForm() {
      const form = useForm<{ ad: string; sku: string }>({
        defaultValues: { ad: "", sku: "" },
      });
      // Bekçi çağrısı YOK. A7d2'nin `pencereSiz` throw'u da bu yüzden susar:
      // olmayan çağrının beyanı olmaz.
      return (
        <div>
          <input aria-label="Ürün adı" {...form.register("ad")} />
          <input aria-label="Stok kodu" {...form.register("sku")} />
        </div>
      );
    }
    function EskiEditProductModal() {
      const yuzey = useDuzenlemeYuzeyi<{ id: number }, void>();
      if (!yuzey.acik) yuzey.ac({ id: 7 });
      return (
        <DuzenlemePenceresi yuzey={yuzey} baslik="Ürünü düzenle">
          <EskiProductForm />
        </DuzenlemePenceresi>
      );
    }
    const hatalar = kur(<EskiEditProductModal />);
    expect(hatalar).toHaveLength(1);
    expect(hatalar[0].message).toContain("Ürünü düzenle");
    // Kaç alan olduğunu da söylesin: 25 alanlık bir formda "25" yazar ve
    // etkinin büyüklüğünü gösterir.
    expect(hatalar[0].message).toContain("2 düzenlenebilir kontrol");
  });
});

describe("İP-A7d4 · girdi sondasının kendisi", () => {
  it("veri taşımayan öğeleri saymaz, taşıyanları sayar", () => {
    const kok = document.createElement("div");
    kok.innerHTML = [
      '<input type="hidden" name="csrf" />',
      '<input type="submit" value="Gonder" />',
      '<input type="button" value="Ara" />',
      "<button type=\"button\">Kapat</button>",
      '<input type="text" name="ad" />',
      '<input type="checkbox" name="izin" />',
      '<select name="rol"></select>',
      '<textarea name="not"></textarea>',
      '<div contenteditable="true"></div>',
      '<input type="text" name="kilitli" readonly />',
    ].join("");
    expect(girdiTasiyanKontroller(kok).map((e) => e.getAttribute("name"))).toEqual([
      "ad",
      "izin",
      "rol",
      "not",
      null,
    ]);
  });
});
