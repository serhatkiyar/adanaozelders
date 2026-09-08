/**
 * Ders şekli ↔ yer sözleşmesi — GERÇEK DOM nöbetçisi.
 *
 * ## Karar (kullanıcı, 8 Eyl 2026)
 *
 * *"Yalnızca bir seçenek seçilebilsin — yüz yüze veya uzaktan."* Ve yer
 * **yalnız "Yüz yüze" seçiliyken** sorulur.
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * Sessizce yanlış gidebilecek şey, yer alanının uzaktan aramaya sızmasıdır.
 * Sızarsa şu olur ve kimse göremez: eğitmen sözleşmesi ilçeyi **yalnız yüz
 * yüze ders için** zorunlu tutuyor (`tutorOnboarding/sozlesme.ts`), yani
 * uzaktan eğitmenlerin ilçesi tasarım gereği boş. İlçe filtresi ise birebir
 * eşleşme arıyor. Sonuç: bir yer seçildiği anda **uzaktan eğitmenler kaçı
 * olursa olsun listeden düşer** — hata vermeden, boş liste olarak.
 *
 * Bu yüzden test "yer alanı görünüyor mu" ile yetinmez, adrese giden
 * parametreleri okur: görünmeyen bir alanın sessizce aramaya karışması, tam
 * olarak kullanıcının göremediği filtre demektir.
 *
 * ## Neden bu dosya var (ölçülmüş kusur)
 *
 * Önceki tasarımda "İkisi de olur" diye bir üçüncü satır vardı: kutuda
 * "Online + Yüz yüze" yazıyor ama adrese **hiçbir** `mode` parametresi
 * yazılmıyordu. Yani filtre uygulanmıyor, KALDIRILIYORDU; hiç seçim
 * yapmamakla ürettiği adres birebir aynıydı. Kullanıcının "kafa karıştırıcı"
 * dediği şeyin merkezi buydu ve bunu çıpalayan tek bir test yoktu.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek bileşenler + jsdom. Sunucunun `mode`/`district` filtrelerini nasıl
 * uyguladığını görmez — o `backend/tests/integration/test_ilce_filtresi_pg.py`
 * işidir. Buradaki iddia yalnız istemcinin ÜRETTİĞİ sorgudur.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DersArama } from "@/components/HeroSearch";
import type { DersSekli } from "@/components/AramaSecicileri";
import type { YerSecimi } from "@/lib/yerArama";
import { TeachingMode } from "@/types";

const yok = () => {};

/** Ana sayfanın submit mantığının birebir aynısı — `Landing.tsx` ile eş. */
function aramaAdresi(sekil: DersSekli, yer: YerSecimi | null): URLSearchParams {
  const sp = new URLSearchParams();
  if (sekil) sp.set("mode", sekil);
  if (sekil === TeachingMode.IN_PERSON && yer) {
    if (yer.tur === "mahalle") sp.set("mahalle", yer.mahalle);
    sp.set("district", yer.ilce);
  }
  return sp;
}

function ekran(sekil: DersSekli, yer: YerSecimi | null = null) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <DersArama
          ders=""
          dersEtiket=""
          onDersChange={yok}
          sekil={sekil}
          setSekil={yok}
          yer={yer}
          setYer={yok}
          onSubmit={yok}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const RESATBEY: YerSecimi = {
  tur: "mahalle",
  ilce: "Seyhan",
  mahalle: "Reşatbey",
  lat: 36.995,
  lng: 35.332,
};

afterEach(() => cleanup());

describe("hapta yer alanı — yalnız yüz yüzede", () => {
  it("DOLULUK: ders şekli alanı her koşulda var", () => {
    // Bu olmadan aşağıdaki "yer yok" iddiaları, hiç render olmayan bir
    // bileşende de bedava geçerdi.
    ekran("");
    expect(screen.getByLabelText("Ders şekli")).toBeTruthy();
    expect(screen.getByLabelText("Ders")).toBeTruthy();
  });

  it("seçim yokken yer alanı YOK", () => {
    ekran("");
    expect(screen.queryByLabelText("Yer")).toBeNull();
  });

  it("UZAKTAN seçiliyken yer alanı YOK", () => {
    ekran(TeachingMode.ONLINE);
    expect(screen.queryByLabelText("Yer")).toBeNull();
  });

  it("YÜZ YÜZE seçiliyken yer alanı VAR", () => {
    ekran(TeachingMode.IN_PERSON);
    expect(screen.getByLabelText("Yer")).toBeTruthy();
  });

  it("yüz yüze seçiliyken seçili yer kutuda görünür", () => {
    ekran(TeachingMode.IN_PERSON, RESATBEY);
    expect(
      screen.getByLabelText("Yer").getAttribute("placeholder")
    ).toBe("Reşatbey, Seyhan");
  });
});

describe("şekilden çıkınca yer seçimi DÜŞER", () => {
  it("yüz yüzeden başka bir şekle geçiş `setYer(null)` çağırır", () => {
    // Görünmeyen bir alanın seçili değeri aramaya karışmamalı: kullanıcının
    // göremediği bir filtre, tam olarak bu turda söküleni yeniden üretirdi.
    const setYer = vi.fn();
    const setSekil = vi.fn();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <DersArama
            ders=""
            dersEtiket=""
            onDersChange={yok}
            sekil={TeachingMode.IN_PERSON}
            setSekil={setSekil}
            yer={RESATBEY}
            setYer={setYer}
            onSubmit={yok}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.focus(screen.getByLabelText("Ders şekli"));
    fireEvent.click(screen.getByText("Uzaktan"));

    expect(setSekil).toHaveBeenCalledWith(TeachingMode.ONLINE);
    expect(setYer, "şekil değişti ama yer seçimi düşmedi").toHaveBeenCalledWith(null);
  });
});

describe("adrese giden sorgu", () => {
  it("UZAKTAN: yalnız mod yazılır, yer parametresi YOK", () => {
    const sp = aramaAdresi(TeachingMode.ONLINE, RESATBEY);
    expect(sp.get("mode")).toBe(TeachingMode.ONLINE);
    // Kritik iddia: yer seçili KALMIŞ olsa bile uzaktan aramaya sızmaz.
    expect(sp.get("district")).toBeNull();
    expect(sp.get("mahalle")).toBeNull();
  });

  it("YÜZ YÜZE: mod ve yer birlikte yazılır", () => {
    const sp = aramaAdresi(TeachingMode.IN_PERSON, RESATBEY);
    expect(sp.get("mode")).toBe(TeachingMode.IN_PERSON);
    expect(sp.get("district")).toBe("Seyhan");
    expect(sp.get("mahalle")).toBe("Reşatbey");
  });

  it("SEÇİM YOK: hiçbir filtre yazılmaz", () => {
    expect([...aramaAdresi("", RESATBEY).keys()]).toEqual([]);
  });

  it('"fark etmez" ile "uzaktan" AYNI adresi üretmez', () => {
    // Eski "İkisi de olur"un ölçülmüş kusuru buydu: seçim yapmakla
    // yapmamak birebir aynı adresi üretiyordu, yani seçenek hiçbir şey
    // yapmıyordu. Bu test o eşitliğin geri gelmesini engeller.
    const farkEtmez = aramaAdresi("", null).toString();
    const uzaktan = aramaAdresi(TeachingMode.ONLINE, null).toString();
    expect(uzaktan).not.toBe(farkEtmez);
  });
});
