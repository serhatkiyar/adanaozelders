// F30 paket etiketi — baskı sözleşmesi.
//
// `LabelSheet.test.tsx`'in devamı ve aynı gerekçeyle yazıldı: F26
// doğrulamasında gerçek Chrome ile PDF'e basıldığında iki bağımsız kusur
// çıkmıştı (boş baskı + ezilen QR). jsdom yerleşim hesaplamadığı için ölçüm
// tarayıcıda yapılır, **kural burada sabitlenir**.
//
// DENETİM DÜZELTMESİ (bulgu 6): önceki sürüm `data-qr-value` / `data-qr-level`
// gibi **test-only** attribute'lara bakıyordu. Bu, bileşenin QR kütüphanesine
// ne ilettiğini değil, kendi test kancasına ne yazdığını ölçerdi — üretim
// kodunda `value` yanlış olsa bile attribute doğru kalabilirdi. Artık
// `qrcode.react` mock'lanır ve `QRCodeSVG`'ye **gerçekten iletilen prop'lar**
// gözlenir.
//
// Mock, gerçek QR matrisinin çizildiğini kanıtlamaz; o kanıt commit 8'deki
// Chrome kabul turundadır (basılı PDF'ten QR decode + hata düzeyi kontrolü,
// sözleşme §9).
//
// F30'a özel iki yeni kural:
//   1) Etiketteki QR **paket** QR'ıdır (`PKG1:` önekli), durak QR'ı DEĞİL.
//      Durak token'ı tur iptalinde kayboluyordu (G3): basılı etiket 2. teslim
//      denemesinde geçersizleşiyordu.
//   2) Etikette insan okunur paket kodu (`PKT-000077`) bulunur — QR okunamazsa
//      operasyon durmasın.
//
// (Dosya yazıldığında bileşen henüz yoktu ve bütün düğümler kırmızıydı; bugün
// bileşen var ve gerçek uca bağlı. Aşağıdaki ikinci öbek — telefon, il/ilçe,
// eksik adres uyarısı, kırpma yasağı, sessiz bölge, `canPrintLabel` — o
// bağlamayla eklendi ve MEVCUT iddiaların hiçbiri gevşetilmedi.)
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ComponentType } from "react";

// `vi.mock` hoist edilir; paylaşılan diziyi `vi.hoisted` ile önden kur.
const { qrCagrilari } = vi.hoisted(() => ({
  qrCagrilari: [] as Record<string, unknown>[],
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: Record<string, unknown>) => {
    qrCagrilari.push(props);
    return (
      <svg
        data-testid="qr"
        className={String(props.className ?? "")}
        width={Number(props.size ?? 0)}
        height={Number(props.size ?? 0)}
      />
    );
  },
}));

const UZUN_BASLIK =
  "TYT ve AYT İçin Kapsamlı Matematik Soru Bankası Video Çözümlü " +
  "Genişletilmiş 2026 Baskısı Set Halinde Toplam Dört Kitap";

// `import.meta.glob`: Vite düz dinamik import'u derleme anında çözer ve dosya
// yoksa tüm matrisi collection'da düşürür ("no tests"). Glob boş eşleşme döner.
const MODULLER = import.meta.glob("./PackageLabel.tsx");

/**
 * Glob yükleyicisinin `unknown` çıktısına verilen ad — `any` DEĞİL.
 *
 * `package` prop'u bilinçli olarak gevşek (`Record<string, unknown>`): fixture
 * üretimde HİÇ dönmeyen alanlar da taşır (`phone`, `scanned_qty`) ve testin
 * amacı tam olarak bunların kâğıda basılmadığını göstermektir. Tipi daraltmak,
 * o negatif iddiaları derleme anında imkânsız kılıp testi anlamsızlaştırırdı.
 */
interface EtiketModulu {
  PackageLabel: ComponentType<{
    package: Record<string, unknown>;
    onClose: () => void;
  }>;
  canPrintLabel: (status: string | null | undefined) => boolean;
}

async function modul(): Promise<EtiketModulu> {
  const yukle = MODULLER["./PackageLabel.tsx"];
  if (!yukle) {
    throw new Error("HENÜZ YAZILMADI: src/components/admin/packing/PackageLabel.tsx");
  }
  return (await yukle()) as unknown as EtiketModulu;
}

async function bilesen(): Promise<EtiketModulu["PackageLabel"]> {
  return (await modul()).PackageLabel;
}

const paket = (over: Record<string, unknown> = {}) => ({
  id: 77,
  code: "PKT-000077",
  order_id: 1922,
  status: "PACKED",
  qr_payload: "PKG1:77:UzunTokenDegeri",
  recipient: "Ayşe Yıldız",
  address: "Kurtuluş Mah. 64019 Sk. No:12 D:4, Seyhan",
  phone: "+905550001000",
  delivery_pref: "ADRESIMDEYIM",
  items: [
    {
      order_item_id: 1,
      sku: "FZK-000011",
      title: "TYT Matematik Soru Bankası",
      expected_qty: 1,
      scanned_qty: 1,
    },
  ],
  ...over,
});

beforeEach(() => {
  qrCagrilari.length = 0;
});

describe("PackageLabel baskı sözleşmesi", () => {
  it("print CSS'i etiketin GÖRÜNÜRLÜĞÜNÜ geri verir", async () => {
    // `index.css:268-286` fatura kuralı `body * { visibility: hidden }` yapıyor;
    // portal `body`'ye bastığı için etiket o kapsama giriyor. Geri verilmezse
    // baskı 1 KB'lık boş PDF olur (bir kez yaşandı).
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket()} onClose={() => {}} />);
    const style = document.querySelector("style");
    expect(style?.textContent).toContain("@media print");
    expect(style?.textContent).toMatch(
      /\.package-label\s*,\s*\.package-label\s*\*\s*\{[^}]*visibility:\s*visible/,
    );
  });

  it("QR bileşenine iletilen `value` PAKET payload'udur (durak QR'ı değil)", async () => {
    // G3'ün düzeltmesinin etiket tarafındaki kanıtı. Ölçülen şey bileşenin
    // QRCodeSVG'ye GERÇEKTEN geçirdiği prop.
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket()} onClose={() => {}} />);
    expect(qrCagrilari.length, "QRCodeSVG hiç render edilmedi").toBeGreaterThan(0);
    expect(qrCagrilari[0].value).toBe("PKG1:77:UzunTokenDegeri");
    expect(String(qrCagrilari[0].value)).toMatch(/^PKG1:/);
  });

  it("QR hata düzeltme düzeyi M'dir", async () => {
    // Varsayılan "L" %7 tolerans verir; depo ortamında etiket buruşur/lekelenir.
    // Prop olarak ölçülür — test-only attribute değil.
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket()} onClose={() => {}} />);
    expect(qrCagrilari[0].level).toBe("M");
  });

  it("QR shrink-0 taşır ve okunabilir boyutun altına inmez", async () => {
    // Ölçüm gerçek Chrome'da yapıldı: flex kardeşi uzun metin QR'ı 96→36 px'e
    // eziyordu; kare bozulunca karekod okunamaz.
    const PackageLabel = await bilesen();
    render(
      <PackageLabel
        package={paket({
          items: [
            {
              order_item_id: 1,
              sku: "FZK-000011",
              title: UZUN_BASLIK,
              expected_qty: 2,
              scanned_qty: 2,
            },
          ],
        })}
        onClose={() => {}}
      />,
    );
    expect(String(qrCagrilari[0].className ?? "")).toContain("shrink-0");
    expect(Number(qrCagrilari[0].size ?? 0)).toBeGreaterThanOrEqual(96);
  });

  it("insan okunur paket kodu ve sipariş numarası basılır", async () => {
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket()} onClose={() => {}} />);
    const text = document.querySelector(".package-label")?.textContent ?? "";
    expect(text).toContain("PKT-000077");
    expect(text).toContain("1922");
  });

  it("kalemler SKU ve adetle basılır; adet 1'de × yazılmaz", async () => {
    const PackageLabel = await bilesen();
    render(
      <PackageLabel
        package={paket({
          items: [
            {
              order_item_id: 1,
              sku: "FZK-000011",
              title: "AYT Fizik Konu Anlatımı",
              expected_qty: 1,
              scanned_qty: 1,
            },
            {
              order_item_id: 2,
              sku: "FZK-000012",
              title: "Paragraf Denemeleri",
              expected_qty: 2,
              scanned_qty: 2,
            },
          ],
        })}
        onClose={() => {}}
      />,
    );
    const text = document.querySelector(".package-label")?.textContent ?? "";
    expect(text).toContain("FZK-000011");
    expect(text).toContain("Paragraf Denemeleri × 2");
    expect(text).not.toContain("AYT Fizik Konu Anlatımı × 1");
    expect(text).toContain("3 parça");
  });

  it("kalemsiz pakette eksik-veri metni basılır (sessiz boşluk yok)", async () => {
    // F26'da etiket bomboş basılmıştı; boşluk hatayı gizler.
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket({ items: [] })} onClose={() => {}} />);
    const text = document.querySelector(".package-label")?.textContent ?? "";
    expect(text).toContain("Kalem bilgisi yok");
  });

  it("teslimat talimatı bandı basılır (kapıya/komşuya bırak)", async () => {
    const PackageLabel = await bilesen();
    render(
      <PackageLabel package={paket({ delivery_pref: "KOMSUYA_BIRAK" })} onClose={() => {}} />,
    );
    expect(document.querySelector(".package-label")?.textContent ?? "").toMatch(
      /KOMŞUYA/i,
    );
  });

  /* ══════════ Aşağıdakiler etiketin gerçek uca bağlanmasıyla eklendi ══════════ */

  it("teslimat tercihinin AÇIKLAMA notu da basılır", async () => {
    // "Komşuya bırak" tek başına kuryeye hangi komşuyu söylemez; not siparişte
    // yaşar (`orders.delivery_pref_note`) ve kâğıda düşmezse tercih işe yaramaz.
    const PackageLabel = await bilesen();
    render(
      <PackageLabel
        package={paket({
          delivery_pref: "KOMSUYA_BIRAK",
          delivery_pref_note: "3 numaralı daire, Nesrin Hanım",
        })}
        onClose={() => {}}
      />,
    );
    expect(document.querySelector(".package-label")?.textContent ?? "").toContain(
      "3 numaralı daire, Nesrin Hanım",
    );
  });

  it("TELEFON kâğıda BASILMAZ (veri minimizasyonu — uç da göndermiyor)", async () => {
    // Kâğıt teslimattan sonra da yaşar: kutunun üstünde çöpe, kapıya, komşuya
    // gider. Geri alınamayan tek kopyaya kişisel veri basılmaz; kurye numarayı
    // saha ekranından taze ve yetki denetimli alır (`DeliveryStopOut.phone`).
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket({ phone: "+905550001000" })} onClose={() => {}} />);
    const text = document.querySelector(".package-label")?.textContent ?? "";
    expect(text).not.toContain("+905550001000");
    expect(text).not.toContain("5550001000");
  });

  it("il ve ilçe ayrıca basılır (adres metninde geçmeyebilir)", async () => {
    const PackageLabel = await bilesen();
    render(
      <PackageLabel
        package={paket({ address: "Kurtuluş Mah. 64019 Sk. No:12 D:4", city: "Adana", district: "Seyhan" })}
        onClose={() => {}}
      />,
    );
    const text = document.querySelector(".package-label")?.textContent ?? "";
    expect(text).toContain("Seyhan");
    expect(text).toContain("Adana");
  });

  it("adres NULL ise '—' ile birlikte EKSİK VERİ uyarısı basılır", async () => {
    // Sunucu yer tutucu üretmez (`""` yerine `null` döner): "—" gerçekten
    // "veri yok" demektir. Yalnız tire basmak, F26'daki boş etiketin daha
    // kibar hâli olurdu — kimse fark etmezdi.
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket({ recipient: null, address: null })} onClose={() => {}} />);
    const text = document.querySelector(".package-label")?.textContent ?? "";
    expect(text).toContain("—");
    expect(text).toMatch(/eksik/i);
  });

  it("adres ve alıcı KIRPILMAZ: truncate / line-clamp yok", async () => {
    // Kesilen adres kuryeyi yanlış kapıya götürür ve kesildiğini de göstermez.
    // Ölçüm gerçek DOM'da: `.package-label` altındaki hiçbir düğüm kırpma
    // sınıfı taşımamalı.
    const PackageLabel = await bilesen();
    render(
      <PackageLabel
        package={paket({
          recipient: "Ayşe Nur Yıldız Karabulut Demirtaş Oğuzhanoğulları",
          address:
            "Kurtuluş Mahallesi 64019 Sokak Numara 12 Daire 4 Beyaz Apartman, Seyhan / Adana, kapı zili çalışmıyor lütfen arayın",
        })}
        onClose={() => {}}
      />,
    );
    const kart = document.querySelector(".package-label")!;
    expect(kart.querySelectorAll(".truncate")).toHaveLength(0);
    expect(kart.querySelectorAll('[class*="line-clamp"]')).toHaveLength(0);
    // Metin gerçekten TAM basılıyor mu (sınıf yokluğu tek başına yetmez).
    expect(kart.textContent).toContain("kapı zili çalışmıyor lütfen arayın");
  });

  it("QR sessiz bölgesi (quiet zone) en az 4 modüldür", async () => {
    // `qrcode.react@4` varsayılanı 0'dır. Sıfır sessiz bölge, etiket çerçevesi
    // ya da komşu metin ilk modüle değdiği anda okumayı bozar; ISO/IEC 18004
    // asgarisi 4 modüldür ve etiketin çerçevesi ZATEN var.
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket()} onClose={() => {}} />);
    expect(Number(qrCagrilari[0].marginSize ?? 0)).toBeGreaterThanOrEqual(4);
  });

  it("print CSS'i etiketin sayfa arasında BÖLÜNMESİNİ engeller", async () => {
    // İkiye bölünen etiketin QR'ı okunamaz; kutu kör gider.
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket()} onClose={() => {}} />);
    const style = document.querySelector("style")?.textContent ?? "";
    expect(style).toMatch(/\.package-label\s*\{[^}]*break-inside:\s*avoid/);
  });

  it("Escape kapatır (kullanıcı paketleme akışına döner)", async () => {
    const PackageLabel = await bilesen();
    let kapandi = 0;
    render(<PackageLabel package={paket()} onClose={() => (kapandi += 1)} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(kapandi).toBe(1);
  });
});

describe("canPrintLabel — basılabilirlik kapalı kümesi", () => {
  it("YALNIZ elde olan ve içeriği doğrulanmış kutuda etiket basılır", async () => {
    const { canPrintLabel } = await modul();

    // Kutu elde + kalemler tek tek okutulmuş.
    expect(canPrintLabel("PACKED")).toBe(true);
    // Depoya dönmüş kutu: elde, içeriği bir kez doğrulanmış (yeniden dağıtıma
    // verilecek ve etiketi yırtılmış olabilir).
    expect(canPrintLabel("RETURNED")).toBe(true);

    // Açık paket: içerik HENÜZ doğrulanmadı. "Kutu bunları içerir" diyen bir
    // beyanı yarım kutuya yapıştırmak F26 hatasının kalbidir.
    expect(canPrintLabel("OPEN")).toBe(false);
    // Araçta/müşteride: kâğıt yapıştırılacak kutu ortada yok; basılan ikinci
    // etiket ancak YANLIŞ bir kutunun üstüne gidebilir.
    expect(canPrintLabel("HANDED_OVER")).toBe(false);
    expect(canPrintLabel("RETURN_PENDING")).toBe(false);
    expect(canPrintLabel("DELIVERED")).toBe(false);
    // Paket dağılmış, QR'ı geçersiz (`packing_rules.TERMINAL_STATUSES`).
    expect(canPrintLabel("VOID")).toBe(false);
  });

  it("tanınmayan durum FAIL-CLOSED: basılmaz", async () => {
    // Backend yarın yeni bir durum eklerse etiket basımı KENDİLİĞİNDEN
    // açılmamalı; küme bu yüzden `isOnPremise`'ten türetilmiyor.
    const { canPrintLabel } = await modul();
    expect(canPrintLabel("YARIN_EKLENEN_DURUM")).toBe(false);
    expect(canPrintLabel(null)).toBe(false);
    expect(canPrintLabel(undefined)).toBe(false);
    expect(canPrintLabel("")).toBe(false);
  });
});
