/**
 * Ders kutusu: SEÇİM ile YAZILAN METİN birbirini ezmez.
 *
 * ## Ölçtüğü kusur sınıfı
 *
 * Kutu 9 Eyl 2026'da kontrollü bileşene çevrildi — ham metin de yukarı çıktı,
 * çünkü eskiden yerel state'te kalıyor ve dışarı hiç sızmıyordu: kullanıcı
 * "matematik" yazıp listeden SEÇMEDEN Ara'ya bastığında adres parametresiz
 * `/egitmenler` oluyor, yazdığı şey hiçbir yere gitmiyordu.
 *
 * O dönüşüm sırasında `setText` "seçimi boşalt" anlamına geldi
 * (`onDersChange("", v)`). Öneri tıklaması ise iki satırdı:
 *
 *     onDersChange(s.name, s.name);   // seçimi yaz
 *     setText(s.name);                // ← seçimi HEMEN geri sildi
 *
 * Sonuç: listeden ders seçen kullanıcı `?subject=` yerine `?q=` ile aranıyordu.
 * Yapısal filtre yerine serbest metin — sonuç kümesi değişir, üstelik hata
 * vermeden. Kusur GERÇEK TARAYICI TURUNDA yakalandı; saf `dersSorgusu` birim
 * testi kaçırmıştı, çünkü o fonksiyona doğru argümanlar gitmiyordu.
 *
 * ## Bu nöbetçinin iddiası
 *
 * Öneriye tıklamak seçimi bırakır: son `onDersChange` çağrısı BOŞ olmayan bir
 * `q` taşır. Yazmak ise seçimi bozar ama metni korur.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek DOM (jsdom + gerçek `DersArama`). Adresin kendisini ölçmez — onu
 * `lib/aramaUrl.test.ts` yapar; buradaki iddia iki katmanın ARASINDAKİ
 * sözleşmedir ve kusur tam orada doğmuştu.
 */
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DersArama } from "@/components/HeroSearch";
import { dersSorgusu } from "@/lib/aramaUrl";

/*
 * Ders kataloğu sunucudan gelir; öneri paneli onsuz hiç doğmaz. Testin konusu
 * katalog DEĞİL, seçim ile metnin birbirini ezmemesi — o yüzden katalog tek
 * kalemle sabitlenir. (Katalogla ilgili sözleşme `lib/dersArama` testlerinde.)
 */
vi.mock("@/hooks/useSubjects", () => ({
  useSubjects: () => ({
    data: [
      {
        id: 1,
        slug: "matematik",
        name: "Matematik",
        parent_id: null,
        group_code: "OKUL",
        sort_order: 1,
        scales: [],
        aliases: [],
      },
    ],
  }),
  useLevelScales: () => ({ data: [] }),
}));

afterEach(() => cleanup());

/**
 * Gerçek kullanımı taklit eden kap: kutu KONTROLLÜ, yani metni ve seçimi
 * dışarıda tutan bir state olmadan çalışmaz (`Landing` de böyle kullanıyor).
 * Sabit prop'la render etmek kutunun yazıyı hiç göstermemesine yol açar.
 */
function Kap({ bildir }: { bildir: (q: string, label: string) => void }) {
  const [ders, setDers] = useState("");
  const [etiket, setEtiket] = useState("");
  return (
    <DersArama
      ders={ders}
      dersEtiket={etiket}
      onDersChange={(q, label) => {
        setDers(q);
        setEtiket(label);
        bildir(q, label);
      }}
      sekil=""
      setSekil={() => {}}
      yer={null}
      setYer={() => {}}
      onSubmit={(e) => e.preventDefault()}
    />
  );
}

function kur() {
  const onDersChange = vi.fn();
  // Ders kataloğu React Query'den geliyor; öneri paneli onsuz doğmaz.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <Kap bildir={onDersChange} />
    </QueryClientProvider>
  );
  return { onDersChange, kutu: screen.getByLabelText("Ders") };
}

describe("ders kutusu · seçim ve metin birbirini ezmez", () => {
  it("DOLULUK: yazmak `onDersChange`i metinle çağırır", () => {
    // Bu olmadan aşağıdaki iddia, hiç çağrılmayan bir geri bildirimle de
    // "geçer" görünebilirdi.
    const { onDersChange, kutu } = kur();
    fireEvent.change(kutu, { target: { value: "matemat" } });
    expect(onDersChange).toHaveBeenCalledWith("", "matemat");
  });

  it("öneriye tıklamak SEÇİMİ BIRAKIR (sonrasında boşa çekilmez)", () => {
    const { onDersChange, kutu } = kur();
    fireEvent.focus(kutu);
    fireEvent.change(kutu, { target: { value: "matemat" } });

    const oneri = screen.getAllByRole("button").find((b) => b.textContent?.trim() === "Matematik");
    expect(oneri, "öneri paneli 'Matematik' göstermiyor").toBeTruthy();
    onDersChange.mockClear();
    fireEvent.click(oneri!);

    // ASIL İDDİA: son çağrı seçimi TAŞIR. Regresyonda son çağrı
    // `("", "Matematik")` oluyordu — yani seçim yazılıp hemen siliniyordu.
    const son = onDersChange.mock.calls.at(-1);
    expect(son, "öneri tıklaması hiç bildirim üretmedi").toBeTruthy();
    expect(
      son![0],
      `öneri seçildi ama seçim boşa çekilmiş — arama ?ders= yerine ?q= ile gider`
    ).toBe("Matematik");
  });

  it("seçim → `ders`, serbest metin → `q` (iki katman birlikte)", () => {
    // Kutunun ürettiği değerin şemada ne olduğunu bağlar: bu düğüm kırılırsa
    // ya kutu ya şema tarafı sapmıştır.
    expect(dersSorgusu("Matematik", "Matematik")).toEqual({
      ders: ["Matematik"],
      q: "",
    });
    expect(dersSorgusu("", "matemat")).toEqual({ ders: [], q: "matemat" });
  });
});
