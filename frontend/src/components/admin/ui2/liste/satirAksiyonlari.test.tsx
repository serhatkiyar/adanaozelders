/**
 * İP-B2 · Ç-2 (D) — satır aksiyonu kuralının NÖBETÇİSİ.
 *
 * Kilitlenen karar: satır başına en fazla **2 açık düğme**, fazlası üç nokta
 * menüsünde, masaüstü ve mobilde AYNI desen; açıktakilerin hiçbiri **yıkıcı**
 * olamaz; yıkıcı aksiyon her zaman menüde ve **onay adımlıdır**.
 *
 * ## Bu dosya neden davranış testi (kaynak taraması değil)
 *
 * "Kural bileşende zorlanıyor" iddiasının tek geçerli kanıtı, kuralı ihlal
 * eden bir çağrının GERÇEKTEN patlaması ve uyan bir çağrının GERÇEKTEN
 * çalışmasıdır. Bir `grep`, `throw` satırının varlığını görür; onun çalıştığını
 * görmez (İP-B1 · `Form.Control` dersinin aynısı).
 *
 * Her iddianın yanında TERS PROVASI var: patlıyor mu diye bakan her testin
 * ikizi "meşru kullanımda patlamıyor" der. Yalnız ilkini yazmak, "her şeyde
 * patlayan" bir bileşeni de yeşil geçirirdi.
 */
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACIK_AKSIYON_TAVANI,
  SatirAksiyonlari,
  aksiyonKuralIhlali,
  type SatirAksiyonu,
} from "./satirAksiyonlari";

/** Konsol gürültüsü testin çıktısını kirletmesin — ama SUSTURULMASIN: çağrıldığı doğrulanıyor. */
let konsolHatasi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  konsolHatasi = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  konsolHatasi.mockRestore();
});

const SIL_ONAYI = {
  baslik: "Kaydı sil",
  aciklama: "Bu işlem geri alınamaz.",
  onayEtiketi: "Sil",
};

function bas(aksiyonlar: SatirAksiyonu[]) {
  return render(<SatirAksiyonlari aksiyonlar={aksiyonlar} menuEtiketi="Kayıt 1 — diğer işlemler" />);
}

describe("Ç-2 · D — açık düğme TAVANI", () => {
  it("iki açık düğme MEŞRUDUR: ikisi de doğrudan görünür", () => {
    // Ters prova. Bu olmadan aşağıdaki "üçüncüde patlıyor" iddiası, her
    // koşulda patlayan bir bileşenle de geçerdi.
    bas([
      { etiket: "Düzenle", acik: true, onSec: vi.fn() },
      { etiket: "Yayınla", acik: true, onSec: vi.fn() },
    ]);
    expect(screen.getByRole("button", { name: "Düzenle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yayınla" })).toBeTruthy();
    // Menü tetikleyicisi YOK: menüye inecek aksiyon kalmadı.
    expect(screen.queryByRole("button", { name: /diğer işlemler/ })).toBeNull();
    expect(konsolHatasi).not.toHaveBeenCalled();
  });

  it("ÜÇÜNCÜ açık düğme verilince GÜRÜLTÜLÜ patlar (sessiz kabul YOK)", () => {
    const aksiyonlar: SatirAksiyonu[] = [
      { etiket: "Düzenle", acik: true, onSec: vi.fn() },
      { etiket: "Yayınla", acik: true, onSec: vi.fn() },
      { etiket: "Kopyala", acik: true, onSec: vi.fn() },
    ];
    // Saf kural fonksiyonu SEBEBİ söylüyor mu — "patladı" yetmez.
    expect(aksiyonKuralIhlali(aksiyonlar)).toMatch(/en fazla 2 açık düğme/);
    expect(aksiyonKuralIhlali(aksiyonlar)).toContain('"Kopyala"');
    // Bileşen gerçekten patlıyor mu (geliştirme/test kipinde).
    expect(() => bas(aksiyonlar)).toThrow(/Ç-2 ihlali/);
    expect(konsolHatasi).toHaveBeenCalled();
  });

  it("GİZLİ aksiyonlar tavana sayılmaz (yetkisiz kullanıcı kuralı bozmaz)", () => {
    // Yetki kapalıyken aksiyon dizisi kısalır ama çağrı yerleri koşullu
    // ifadelerle yazılıyor; `gizli` bayrağı olan bir aksiyon tavana sayılsaydı
    // yetkisiz kullanıcıda ekran patlardı.
    expect(
      aksiyonKuralIhlali([
        { etiket: "Düzenle", acik: true, onSec: vi.fn() },
        { etiket: "Yayınla", acik: true, onSec: vi.fn() },
        { etiket: "Kopyala", acik: true, gizli: true, onSec: vi.fn() },
      ])
    ).toBeNull();
  });

  it("tavan SABİTİ ikidir ve testte yazılıdır", () => {
    // Sabit sessizce üçe çıkarsa yukarıdaki testler yine geçerdi.
    expect(ACIK_AKSIYON_TAVANI).toBe(2);
  });
});

describe("Ç-2 · D — açıkta YIKICI aksiyon olamaz", () => {
  it("açıktaki yıkıcı aksiyon REDDEDİLİR", () => {
    const aksiyonlar = [
      { etiket: "Düzenle", acik: true, onSec: vi.fn() },
      // Tip düzeyinde de yasak (`acik?: never`); burada çalışma zamanı yolu
      // sınanıyor çünkü diziler koşullu ifadelerden üretiliyor.
      { etiket: "Sil", acik: true, yikici: true, onay: SIL_ONAYI, onSec: vi.fn() },
    ] as unknown as SatirAksiyonu[];
    expect(aksiyonKuralIhlali(aksiyonlar)).toMatch(/yıkıcı aksiyon açıkta olamaz/);
    expect(() => bas(aksiyonlar)).toThrow(/Ç-2 ihlali/);
  });

  it("onay metni OLMAYAN yıkıcı aksiyon reddedilir", () => {
    const aksiyonlar = [
      { etiket: "Sil", yikici: true, onSec: vi.fn() },
    ] as unknown as SatirAksiyonu[];
    expect(aksiyonKuralIhlali(aksiyonlar)).toMatch(/onay metni zorunludur/);
  });

  it("TERS PROVA: menüdeki yıkıcı aksiyon + onay metni MEŞRUDUR", () => {
    expect(
      aksiyonKuralIhlali([
        { etiket: "Düzenle", acik: true, onSec: vi.fn() },
        { etiket: "Sil", yikici: true, onay: SIL_ONAYI, onSec: vi.fn() },
      ])
    ).toBeNull();
  });
});

describe("Ç-2 · D — taşan aksiyonlar menüde", () => {
  it("açık olmayan aksiyon menüde yaşar, doğrudan görünmez", () => {
    bas([
      { etiket: "Düzenle", acik: true, onSec: vi.fn() },
      { etiket: "Kopyala", onSec: vi.fn() },
    ]);
    // Menü KAPALIYKEN öğe DOM'da olmamalı: kapalı menünün içeriği ekran
    // okuyucuya ve otomasyona görünürse "gizli" iddiası yalan olur.
    expect(screen.queryByRole("button", { name: "Kopyala" })).toBeNull();
    expect(screen.getByRole("button", { name: "Kayıt 1 — diğer işlemler" })).toBeTruthy();
  });

  it("menü açılınca öğe GÖRÜNÜR ve tıklanınca aksiyon çalışır", () => {
    const kopyala = vi.fn();
    bas([
      { etiket: "Düzenle", acik: true, onSec: vi.fn() },
      { etiket: "Kopyala", onSec: kopyala },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Kayıt 1 — diğer işlemler" }));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Kopyala" }));
    expect(kopyala).toHaveBeenCalledTimes(1);
    // Seçim menüyü KAPATIR.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("menü tetikleyicisinin adı SATIRI tanıtır (aynı adlı N düğme doğmaz)", () => {
    // İP-A7d2 · SK-5'in aynısı: bir tabloda otuz tane "İşlemler" adlı düğme
    // olursa ekran okuyucu ve otomasyon hangisinin hangi satır olduğunu
    // ayırt edemez.
    bas([
      { etiket: "Düzenle", acik: true, onSec: vi.fn() },
      { etiket: "Kopyala", onSec: vi.fn() },
    ]);
    const tetikleyici = screen.getByRole("button", { name: "Kayıt 1 — diğer işlemler" });
    expect(tetikleyici.getAttribute("aria-haspopup")).toBe("menu");
    expect(tetikleyici.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Ç-2 · D — yıkıcı aksiyon ONAY adımlıdır", () => {
  it("menüden 'Sil' seçmek DOĞRUDAN silmez: önce onay penceresi açılır", () => {
    const sil = vi.fn();
    bas([
      { etiket: "Düzenle", acik: true, onSec: vi.fn() },
      { etiket: "Sil", yikici: true, onay: SIL_ONAYI, onSec: sil },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Kayıt 1 — diğer işlemler" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sil" }));

    expect(
      sil,
      "menüden seçmek doğrudan sildi — yanlış satıra dokunmak geri alınamaz " +
        "bir sonuç üretiyor"
    ).not.toHaveBeenCalled();
    expect(screen.getByText("Kaydı sil")).toBeTruthy();
    expect(screen.getByText("Bu işlem geri alınamaz.")).toBeTruthy();
  });

  it("onay penceresinde onaylayınca aksiyon ÇALIŞIR", () => {
    // Ters prova: onay adımı yalnız geciktirmiyor, gerçekten geçiriyor.
    const sil = vi.fn();
    bas([
      { etiket: "Düzenle", acik: true, onSec: vi.fn() },
      { etiket: "Sil", yikici: true, onay: SIL_ONAYI, onSec: sil },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Kayıt 1 — diğer işlemler" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sil" }));
    fireEvent.click(screen.getByRole("button", { name: "Sil", hidden: false }));
    expect(sil).toHaveBeenCalledTimes(1);
  });

  /**
   * ── ÇİFT TIKLAMA KORUMASI — regresyon nöbetçisi ──
   *
   * Bu üç düğüm, bu paketin ürettiği GERÇEK BİR REGRESYONDAN sonra yazıldı.
   * İlk yazımda `onConfirm` önce pencereyi kapatıyor, sonra aksiyonu
   * çalıştırıyordu; pencere anında kalkınca onay düğmesi DOM'dan çıkıyor ve
   * `isPending` ile sağlanan **çift tıklama koruması yok oluyordu** — istek
   * uçarken ikinci bir DELETE gönderilebilirdi.
   *
   * Kusuru bu dosya DEĞİL, mevcut bir kabul testi yakaladı
   * (`adminSafetyStates.acceptance` · C-2). Yani ortak bileşenin sözleşmesi
   * yalnız ekran testlerinde korunuyordu; buraya taşındı.
   */
  it("onay penceresi aksiyon boyunca AÇIK kalır (çift tıklama koruması)", () => {
    // `bekliyor` GERÇEK bir mutasyon gibi davranmalı: onaydan SONRA true olur.
    // Sabit `bekliyor: true` ile kurmak testi yanlış yapardı — menü öğesi de
    // devre dışı olur ve pencere hiç açılmazdı (ilk yazımda tam olarak bu oldu).
    const sil = vi.fn();
    function Kosum() {
      const [ucuyor, setUcuyor] = useState(false);
      return (
        <SatirAksiyonlari
          menuEtiketi="Kayıt 1 — diğer işlemler"
          aksiyonlar={[
            { etiket: "Düzenle", acik: true, onSec: vi.fn() },
            {
              etiket: "Sil",
              yikici: true,
              bekliyor: ucuyor,
              onay: SIL_ONAYI,
              onSec: () => {
                sil();
                setUcuyor(true); // istek uçmaya başladı, yanıt HENÜZ yok
              },
            },
          ]}
        />
      );
    }
    render(<Kosum />);
    fireEvent.click(screen.getByRole("button", { name: "Kayıt 1 — diğer işlemler" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sil" }));

    const onay = screen.getByRole("button", { name: "Sil" }) as HTMLButtonElement;
    fireEvent.click(onay);
    expect(sil).toHaveBeenCalledTimes(1);

    // Pencere HÂLÂ açık ve düğme devre dışı.
    expect(screen.getByText("Kaydı sil")).toBeTruthy();
    expect(onay.disabled, "istek uçarken onay düğmesi devre dışı değil").toBe(true);

    // İkinci tıklama ikinci çağrı üretmez.
    fireEvent.click(onay);
    expect(sil).toHaveBeenCalledTimes(1);
  });

  it("kapatmayı ÇAĞIRAN yapar — `onSec`e `kapat` verilir", () => {
    // Sözleşmenin diğer yarısı: pencere kendiliğinden kapanmıyorsa, çağıranın
    // onu kapatabildiği kanıtlanmalı; yoksa pencere sonsuza dek açık kalırdı.
    let kapatildi = false;
    render(
      <SatirAksiyonlari
        menuEtiketi="Kayıt 1 — diğer işlemler"
        aksiyonlar={[
          { etiket: "Düzenle", acik: true, onSec: vi.fn() },
          {
            etiket: "Sil",
            yikici: true,
            onay: SIL_ONAYI,
            onSec: (kapat) => {
              kapatildi = true;
              kapat();
            },
          },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Kayıt 1 — diğer işlemler" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sil" }));
    fireEvent.click(screen.getByRole("button", { name: "Sil" }));

    expect(kapatildi).toBe(true);
    expect(screen.queryByText("Kaydı sil")).toBeNull();
  });

  it("vazgeçince aksiyon ÇALIŞMAZ", () => {
    const sil = vi.fn();
    bas([
      { etiket: "Düzenle", acik: true, onSec: vi.fn() },
      { etiket: "Sil", yikici: true, onay: SIL_ONAYI, onSec: sil },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Kayıt 1 — diğer işlemler" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sil" }));
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(sil).not.toHaveBeenCalled();
  });
});

describe("Ç-2 · D — güvenli bozunma", () => {
  it("hiç görünür aksiyon yoksa HİÇBİR ŞEY basılmaz (boş menü düğmesi doğmaz)", () => {
    const { container } = bas([{ etiket: "Sil", gizli: true, onSec: vi.fn() }]);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("açık düğme tıklanınca aksiyon DOĞRUDAN çalışır (onay yok)", () => {
    // Yıkıcı olmayan aksiyonda onay adımı olsaydı her yayınlama iki dokunuş
    // olurdu; kuralın kapsamı yalnız yıkıcı aksiyonlardır.
    const yayinla = vi.fn();
    bas([{ etiket: "Yayınla", acik: true, onSec: yayinla }]);
    fireEvent.click(screen.getByRole("button", { name: "Yayınla" }));
    expect(yayinla).toHaveBeenCalledTimes(1);
  });
});
