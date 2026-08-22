/**
 * İP-B2 — liste araç çubuğunun DAVRANIŞI (gerçek DOM + gerçek URL).
 *
 * Bu dosyanın ölçtüğü tek şey var: **kullanıcının yaptığı seçim URL'e
 * gerçekten yazılıyor mu.** "Element var mı" hiçbir yerde kanıt sayılmaz —
 * bu depoda tam olarak o yalancı yeşil ölçüldü (İP-12: filtre ekranda
 * görünüyordu ama parametre sunucuya HİÇ gitmiyordu).
 *
 * URL burada sunucu isteğinin vekili değil, ASIL sözleşmedir: listeler
 * `useSearchParams`ten okuyor (kilitli karar), yani URL doğruysa istek de
 * doğrudur ve URL yanlışsa paylaşılan bağlantı da geri tuşu da bozuktur.
 * Uçtan uca istek doğrulaması ayrıca `urunListesiAnatomisi.acceptance`ta.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ListeAracCubugu } from "./aracCubugu";

/** Anlık URL'i teste sızdıran sonda — router'ın kendi durumundan okur. */
function UrlSondasi({ kap }: { kap: { arama: string } }) {
  const [params] = useSearchParams();
  kap.arama = params.toString();
  return null;
}

const FILTRELER = [
  {
    anahtar: "stok",
    etiket: "Stok durumu",
    secenekler: [
      { deger: "tukendi", etiket: "Tükendi" },
      { deger: "azalan", etiket: "Azalan", sayi: 12 },
    ],
  },
  {
    anahtar: "yayinevi",
    etiket: "Yayınevi",
    secenekler: [{ deger: "Palme", etiket: "Palme Yayınları", sayi: 3 }],
  },
];

const SIRALAMA = {
  anahtar: "sirala",
  yonAnahtari: "yon",
  varsayilan: "created_at",
  varsayilanYon: "desc" as const,
  secenekler: [
    { deger: "created_at", etiket: "Eklenme" },
    { deger: "price", etiket: "Fiyat" },
  ],
};

function bas(baslangic = "/liste") {
  const kap = { arama: "" };
  render(
    <MemoryRouter initialEntries={[baslangic]}>
      <UrlSondasi kap={kap} />
      <ListeAracCubugu
        arama={{ etiket: "Ürün ara", ipucu: "Başlık, ISBN…" }}
        filtreler={FILTRELER}
        siralama={SIRALAMA}
      />
    </MemoryRouter>
  );
  return kap;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("İP-B2 · arama — gecikmeli ve URL'de", () => {
  it("yazmak URL'i HEMEN değiştirmez (her tuşta istek gitmesin)", () => {
    const kap = bas();
    fireEvent.change(screen.getByLabelText("Ürün ara"), { target: { value: "kalem" } });
    expect(kap.arama, "her tuş vuruşunda URL yazılıyor — gecikme yok").toBe("");
  });

  it("300 ms sonra URL'e yazılır", () => {
    const kap = bas();
    fireEvent.change(screen.getByLabelText("Ürün ara"), { target: { value: "kalem" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(kap.arama).toContain("q=kalem");
  });

  it("299 ms'te HENÜZ yazılmaz (gecikme değeri gerçekten 300)", () => {
    // Ters prova: yukarıdaki test `advanceTimersByTime(300)` ile gecikme 0
    // olsaydı da geçerdi. Sınırın nerede olduğu ayrıca ölçülüyor.
    const kap = bas();
    fireEvent.change(screen.getByLabelText("Ürün ara"), { target: { value: "kalem" } });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(kap.arama).toBe("");
  });

  it("arama değişince SAYFA numarası düşer", () => {
    // 4. sayfadayken arama yapan kullanıcı boş bir liste görür ve "kayıt yok"
    // sanır. Kural araç çubuğunda: ekran başına yazılsaydı bir yerde
    // unutulurdu.
    const kap = bas("/liste?sayfa=4");
    fireEvent.change(screen.getByLabelText("Ürün ara"), { target: { value: "kalem" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(kap.arama).not.toContain("sayfa");
  });

  it("URL'den gelen arama girdiye YANSIR (paylaşılan bağlantı çalışır)", () => {
    bas("/liste?q=geometri");
    expect((screen.getByLabelText("Ürün ara") as HTMLInputElement).value).toBe("geometri");
  });
});

describe("İP-B2 · 'Filtre ekle' — önce kriter, sonra değer", () => {
  it("menü önce KRİTERLERİ listeler", () => {
    bas();
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    expect(screen.getByRole("menuitem", { name: "Stok durumu" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Yayınevi" })).toBeTruthy();
    // Değerler HENÜZ görünmemeli: iki seviye olmasaydı menü onlarca yayınevi
    // ile dolar ve taranamaz hâle gelirdi.
    expect(screen.queryByRole("menuitem", { name: /Tükendi/ })).toBeNull();
  });

  it("kriter seçilince o kriterin DEĞERLERİ gelir", () => {
    bas();
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stok durumu" }));
    expect(screen.getByRole("menuitem", { name: "Tükendi" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Azalan/ })).toBeTruthy();
  });

  it("değer seçilince URL'e YAZILIR", () => {
    const kap = bas();
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stok durumu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tükendi" }));
    expect(kap.arama).toContain("stok=tukendi");
  });

  it("uygulanmış kriter menüde TEKRAR sunulmaz", () => {
    bas("/liste?stok=tukendi");
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    expect(screen.queryByRole("menuitem", { name: "Stok durumu" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Yayınevi" })).toBeTruthy();
  });

  it("yüz (facet) sayısı biliniyorsa menüde görünür", () => {
    bas();
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stok durumu" }));
    expect(screen.getByRole("menuitem", { name: /12 kayıt/ })).toBeTruthy();
  });
});

describe("İP-B2 · uygulanan filtre çipleri", () => {
  it("uygulanan her filtre bir ÇİP olur ve insan adını taşır", () => {
    bas("/liste?stok=tukendi&yayinevi=Palme");
    expect(screen.getByRole("button", { name: "Stok durumu filtresini kaldır: Tükendi" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Yayınevi filtresini kaldır: Palme Yayınları" })
    ).toBeTruthy();
  });

  it("çipe basmak SADECE o filtreyi kaldırır", () => {
    const kap = bas("/liste?stok=tukendi&yayinevi=Palme");
    fireEvent.click(screen.getByRole("button", { name: /Stok durumu filtresini kaldır/ }));
    expect(kap.arama).not.toContain("stok=");
    expect(kap.arama, "komşu filtre de silindi — çip 'hepsini temizle' gibi davranıyor").toContain(
      "yayinevi=Palme"
    );
  });

  it("arama da çip olarak görünür (ne temizleneceği görünür olsun)", () => {
    bas("/liste?q=kalem");
    expect(screen.getByRole("button", { name: "Arama filtresini kaldır: kalem" })).toBeTruthy();
  });

  it("'Tümünü temizle' filtreleri ve aramayı siler, SIRALAMAYI KORUR", () => {
    // "Filtreleri temizle" diyen kullanıcı listeyi genişletmek ister,
    // sıralamasını kaybetmek değil. Eski `setParams({})` ikisini birden
    // siliyordu.
    const kap = bas("/liste?q=kalem&stok=tukendi&sirala=price&yon=asc&limit=50");
    fireEvent.click(screen.getByRole("button", { name: "Tümünü temizle" }));
    expect(kap.arama).not.toContain("q=");
    expect(kap.arama).not.toContain("stok=");
    expect(kap.arama).toContain("sirala=price");
    expect(kap.arama).toContain("yon=asc");
    expect(kap.arama).toContain("limit=50");
  });

  it("hiç filtre yokken çip şeridi HİÇ basılmaz", () => {
    bas();
    expect(screen.queryByRole("button", { name: "Tümünü temizle" })).toBeNull();
  });
});

describe("İP-B2 · sıralama düğmesi", () => {
  it("tetikleyici SUANKİ sıralamayı söyler", () => {
    bas();
    expect(screen.getByRole("button", { name: /Sırala: Eklenme/ })).toBeTruthy();
  });

  it("başka bir alan seçmek URL'e alanı ve varsayılan yönü yazar", () => {
    const kap = bas();
    fireEvent.click(screen.getByRole("button", { name: /Sırala:/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Fiyat" }));
    expect(kap.arama).toContain("sirala=price");
    expect(kap.arama).toContain("yon=desc");
  });

  it("AYNI alana ikinci seçim YÖNÜ çevirir", () => {
    const kap = bas("/liste?sirala=price&yon=desc");
    fireEvent.click(screen.getByRole("button", { name: /Sırala:/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Fiyat/ }));
    expect(kap.arama).toContain("yon=asc");
  });

  it("seçili alan menüde işaretlidir", () => {
    bas("/liste?sirala=price&yon=desc");
    expect(screen.getByRole("button", { name: /Sırala: Fiyat/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sırala:/ }));
    expect(screen.getByRole("menuitem", { name: /✓ Fiyat/ })).toBeTruthy();
  });
});

describe("İP-B2 · araç çubuğu neyi YAPMAZ", () => {
  it("filtre verilmezse 'Filtre ekle' düğmesi basılmaz", () => {
    // Ekran "hangi filtreler" der; hiç filtre yoksa boş bir menü sunmak
    // kullanıcıya olmayan bir yetenek vaat ederdi.
    render(
      <MemoryRouter initialEntries={["/liste"]}>
        <ListeAracCubugu arama={{ etiket: "Ara" }} />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: "Filtre ekle" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sırala/ })).toBeNull();
  });
});
