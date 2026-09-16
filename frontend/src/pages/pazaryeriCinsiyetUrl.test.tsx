/**
 * Cinsiyet filtresi ile URL arasındaki İKİ YÖNLÜ sözleşme.
 *
 * ## Neden
 *
 * Filtre çalışıyordu ama URL'e YAZILMIYORDU: seçilen cinsiyet paylaşılamıyor,
 * yenilemede kayboluyor, tarayıcı geri tuşunda state ile adres ayrışıyordu.
 * `q`, `subject`, `district`, `mode`, `exam` yazılıyordu — `gender` unutulmuştu.
 *
 * ## Yazma yolu UI'a dokunmadan nasıl sınanıyor
 *
 * Ekran, state'ten **sıfırdan** bir `URLSearchParams` kurup `setSearchParams`
 * ile değiştiriyor. Yani `gender` yazılmıyorsa, adreste zaten VAR OLAN
 * `?gender=FEMALE` bile ilk efekt turunda SİLİNİR. Testin ölçtüğü şey bu:
 * çipe tıklamaya, çekmece açmaya gerek yok.
 *
 * ## Okuma yolunda doğrulama
 *
 * Elle yazılmış `?gender=abc` sunucuya ULAŞMAMALI. Bu, sihirbazın `?adim=`
 * için öğrendiği dersin aynısı: doğrulanmamış bir URL parametresi doğrudan
 * API çağrısına geçirilmez.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Marketplace from "@/pages/Marketplace";
import {
  useTutorSearch,
  useTutorPriceHistogram,
  useTutorGenderFacets,
} from "@/hooks/useTutorSearch";
import { Gender } from "@/types";

// `vi.mock` hoist edilir; DİNAMİK `import()` kullanılmaz (tembelModul nöbetçisi).
vi.mock("@/hooks/useTutorSearch", () => ({
  useTutorSearch: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useTutorPriceHistogram: vi.fn(() => ({ data: [], isLoading: false })),
  useFeaturedTutors: vi.fn(() => ({ data: [], isLoading: false })),
  useTutorGenderFacets: vi.fn(() => ({
    data: { FEMALE: 42, MALE: 61, UNSPECIFIED: 12, belirtilmemis: 75, gorunmeyen: 87 },
  })),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/components/FeaturedTutorBlock", () => ({
  FeaturedTutorBlock: () => null,
}));
// `bottom` ve `center` DE çizilmeli: filtre çubuğu (ve "Filtreler" düğmesi)
// kabuğun `bottom` prop'unda geliyor. Yalnız `children` çizen bir sahte kabuk
// onu sessizce düşürür ve test "düğme yok" der.
vi.mock("@/components/DashboardShell", () => ({
  DashboardShell: ({
    children,
    center,
    bottom,
  }: {
    children: React.ReactNode;
    center?: React.ReactNode;
    bottom?: React.ReactNode;
  }) => (
    <div>
      {center}
      {bottom}
      {children}
    </div>
  ),
}));

/** `useTutorSearch`e giden SON parametre nesnesi. */
function sonAramaParametreleri() {
  const cagrilar = vi.mocked(useTutorSearch).mock.calls;
  return cagrilar.at(-1)?.[0];
}

/** Adres çubuğunun MemoryRouter içindeki karşılığını dışarı taşır. */
let sonAdres = "";
function AdresGozcusu() {
  sonAdres = useLocation().search;
  return null;
}

function ciz(adres: string) {
  sonAdres = "";
  return render(
    <MemoryRouter initialEntries={[adres]}>
      <Marketplace />
      <AdresGozcusu />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(useTutorSearch).mockClear();
  vi.mocked(useTutorPriceHistogram).mockClear();
  vi.mocked(useTutorGenderFacets).mockClear();
});

describe("pazaryeri · cinsiyet ↔ URL", () => {
  it("DOLULUK: arama kancası gerçekten çağrılıyor", () => {
    // Bu olmadan aşağıdaki "parametre şöyle" iddiaları, ekran hiç
    // çizilmediğinde de anlamsız biçimde geçebilirdi.
    ciz("/egitmenler");
    expect(vi.mocked(useTutorSearch)).toHaveBeenCalled();
    expect(sonAramaParametreleri()).toBeTruthy();
    expect(sonAramaParametreleri()?.gender).toBeUndefined();
  });

  it("adresteki geçerli cinsiyet API çağrısına GİRER", () => {
    ciz(`/egitmenler?gender=${Gender.FEMALE}`);
    return waitFor(() => {
      expect(sonAramaParametreleri()?.gender).toBe(Gender.FEMALE);
    });
  });

  it("adresteki cinsiyet efekt turunda SİLİNMEZ (yazma yolu)", async () => {
    // Ekran state'ten sıfırdan URL kuruyor; `gender` yazılmasaydı burada
    // kaybolurdu. Paylaşılabilirliğin ve yenileme dayanıklılığının kanıtı.
    ciz(`/egitmenler?gender=${Gender.MALE}`);
    await waitFor(() => {
      expect(sonAramaParametreleri()?.gender).toBe(Gender.MALE);
    });
    // Asıl iddia ADRESTE: `gender` yazılmasaydı efekt onu URL'den silerdi.
    // (`window.location` MemoryRouter'da değişmez — gözcü bileşeni bu yüzden.)
    await waitFor(() => {
      expect(sonAdres).toContain(`gender=${Gender.MALE}`);
    });
  });

  it("ELLE YAZILMIŞ geçersiz cinsiyet API'ye ULAŞMAZ", async () => {
    ciz("/egitmenler?gender=kadin-erkek-farketmez");
    await waitFor(() => expect(vi.mocked(useTutorSearch)).toHaveBeenCalled());
    expect(sonAramaParametreleri()?.gender).toBeUndefined();
  });

  it("histogram ile arama AYNI cinsiyeti görür (yollar ayrışmaz)", async () => {
    ciz(`/egitmenler?gender=${Gender.FEMALE}`);
    await waitFor(() => {
      expect(sonAramaParametreleri()?.gender).toBe(Gender.FEMALE);
    });
    const hist = vi.mocked(useTutorPriceHistogram).mock.calls.at(-1)?.[0];
    expect(hist?.gender, "histogram başka bir küme ölçerse fiyat aralığı yanlış olur").toBe(
      Gender.FEMALE
    );
  });
});

describe("pazaryeri · faset sayıları KENDİ eksenini saymaz", () => {
  it("faset çağrısına `gender` GEÇMEZ", async () => {
    // Geçseydi kullanıcı "Kadın"ı seçtiği anda "Erkek 0" görünürdü ve
    // sayılar seçim yapmayı imkânsız kılardı. Aynı desen histogramda da var
    // (o da fiyat filtresini bilerek atlar).
    ciz(`/egitmenler?gender=${Gender.FEMALE}`);
    await waitFor(() => {
      expect(sonAramaParametreleri()?.gender).toBe(Gender.FEMALE);
    });
    const faset = vi.mocked(useTutorGenderFacets).mock.calls.at(-1)?.[0];
    expect(faset).toBeTruthy();
    expect(faset).not.toHaveProperty("gender");
  });

  it("diğer filtreler fasete GEÇER (doluluk — boş nesne göndermiyor)", async () => {
    // `gender`ı çıkarırken yanlışlıkla her şeyi çıkarmak, sayıları tüm
    // havuzun sayısına çevirirdi ve sayı yanıltıcı olurdu.
    ciz(`/egitmenler?q=matematik&gender=${Gender.MALE}`);
    await waitFor(() => {
      const faset = vi.mocked(useTutorGenderFacets).mock.calls.at(-1)?.[0];
      expect(faset?.q).toBe("matematik");
    });
  });
});

describe("pazaryeri · SESSİZ ELEME görünür kılındı", () => {
  const cekmeceyiAc = () => {
    // Çekmece açılmadan faset sorgusu da yapılmaz (maliyet deseni).
    // Duyarlı düzen aynı düğmeyi iki kez çizebiliyor (mobil + geniş);
    // ikisi de aynı state'i açar, ilki yeterli.
    fireEvent.click(screen.getAllByRole("button", { name: /Filtreler/i })[0]);
  };

  it("filtre ETKİNKEN kaç eğitmenin elendiğini SÖYLER", async () => {
    // Asıl ürün kusurunun düzeltmesi: `Tutor.gender == FEMALE` hem NULL hem
    // UNSPECIFIED satırları eliyordu ve öğrenci bunu göremiyordu.
    ciz(`/egitmenler?gender=${Gender.FEMALE}`);
    cekmeceyiAc();
    await waitFor(() => {
      expect(screen.getByText(/87 eğitmen bu\s+filtreyle görünmüyor/)).toBeTruthy();
    });
  });

  it("filtre KAPALIYKEN uyarı YOK — kimse elenmiyor", () => {
    ciz("/egitmenler");
    cekmeceyiAc();
    expect(screen.queryByText(/görünmüyor/)).toBeNull();
    // DOLULUK: çekmece gerçekten açıldı mı; açılmasaydı yukarıdaki `queryBy`
    // her koşulda null dönerdi ve iddia bedava geçerdi.
    // Bölüm başlığı 16 Eyl 2026'dan beri "Eğitmen cinsiyeti" (bölmeli seçici).
    expect(screen.getByText("Eğitmen cinsiyeti")).toBeTruthy();
  });

  it("çip başına sayı, filtre TIKLANMADAN ÖNCE görünür", () => {
    ciz("/egitmenler");
    cekmeceyiAc();
    // Sayı seçenek etiketinin içinde: "Kadın (42)" / "Erkek (61)".
    expect(screen.getByRole("button", { name: "Kadın (42)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Erkek (61)" })).toBeTruthy();
  });
});
