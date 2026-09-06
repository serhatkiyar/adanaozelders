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
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Marketplace from "@/pages/Marketplace";
import { useTutorSearch, useTutorPriceHistogram } from "@/hooks/useTutorSearch";
import { Gender } from "@/types";

// `vi.mock` hoist edilir; DİNAMİK `import()` kullanılmaz (tembelModul nöbetçisi).
vi.mock("@/hooks/useTutorSearch", () => ({
  useTutorSearch: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useTutorPriceHistogram: vi.fn(() => ({ data: [], isLoading: false })),
  useFeaturedTutors: vi.fn(() => ({ data: [], isLoading: false })),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/components/FeaturedTutorBlock", () => ({
  FeaturedTutorBlock: () => null,
}));
vi.mock("@/components/DashboardShell", () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
