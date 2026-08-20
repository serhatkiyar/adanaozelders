/**
 * İP-A7d1 · Görev 1 — satır tıklaması ile satır aksiyonunun ÇAKIŞMASI.
 *
 * Denetim #2 gerçek tarayıcıda ölçtü: `onRowClick` verildiğinde mobil kart
 * bütünüyle tek bir `<button>`a sarılıyor. İç içe `<button>` geçersiz HTML'dir
 * — yani kartın içine ikinci bir aksiyon KONULAMIYOR. Kilitli kararımız ise
 * "satır aksiyonları açık düğme kalır, üç nokta menüye geçilmez".
 *
 * İkisi aynı anda mümkün olmadığı için bu bir kusur değil, bir ÇELİŞKİ:
 * karar verilmeli ve **ortak katmanda** çözülmelidir. Ekran başına çözülürse
 * yirmi bir ekranda yirmi bir farklı davranış doğar.
 *
 * Bu dosya kararın nöbetçisidir. Karar (gerekçesi `DataTable.tsx`te):
 * kart `<button>`a SARILMAZ; kartın üstüne, içeriğin ALTINDA duran bir
 * "satırı aç" katmanı serilir. Kartın metin kısmına tıklamak satırı açar,
 * kartın içindeki gerçek denetimler (düğme, bağlantı, alan) kendi işlerini
 * görür. Erişilebilir ad kart içeriğinden gelir — çağıran taraf yeni bir prop
 * yazmaz, dolayısıyla unutamaz.
 *
 * Masaüstü yarısı da aynı çelişkinin ikizidir ve bugün SESSİZCE yanlıştır:
 * `tr` üzerindeki `onClick` satır aksiyonuna yapılan tıklamayı da yakalar
 * (olay kabarır) — kullanıcı "Sil"e basar, hem silme penceresi açılır hem
 * satır tıklaması çalışır.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "./DataTable";
import { Button } from "@/components/admin/ui";

interface Kayit {
  id: number;
  ad: string;
}

const VERI: Kayit[] = [
  { id: 1, ad: "Birinci kayıt" },
  { id: 2, ad: "İkinci kayıt" },
];

function kur({
  satirAcildi,
  aksiyon,
}: {
  satirAcildi: (k: Kayit) => void;
  aksiyon: (k: Kayit) => void;
}) {
  const kolonlar: ColumnDef<Kayit, unknown>[] = [
    { accessorKey: "ad", header: "Ad", enableSorting: false },
    {
      id: "islem",
      header: "İşlem",
      enableSorting: false,
      cell: ({ row }) => (
        <Button size="sm" onClick={() => aksiyon(row.original)}>
          Sil {row.original.id}
        </Button>
      ),
    },
  ];
  return render(
    <DataTable
      columns={kolonlar}
      data={VERI}
      getRowId={(k) => String(k.id)}
      emptyTitle="Kayıt yok"
      onRowClick={satirAcildi}
      satirAdi={(k) => `${k.ad} — ayrıntı`}
      renderMobileRow={(k) => (
        <div>
          <p>{k.ad}</p>
          <Button size="sm" onClick={() => aksiyon(k)}>
            Sil {k.id}
          </Button>
        </div>
      )}
      page={1}
      pageSize={25}
      total={2}
      onPageChange={() => {}}
      onPageSizeChange={() => {}}
    />
  );
}

/** Mobil kart bölümü — jsdom ikisini de basar, ayırmak gerekir. */
function mobilBolum(kap: HTMLElement): HTMLElement {
  const el = kap.querySelector<HTMLElement>("[data-mobil-satirlar]");
  if (!el) throw new Error("mobil kart bölümü bulunamadı");
  return el;
}

function masaustuBolum(kap: HTMLElement): HTMLElement {
  const el = kap.querySelector<HTMLElement>("table");
  if (!el) throw new Error("masaüstü tablo bulunamadı");
  return el;
}

describe("İP-A7d1 · satır tıklaması + satır aksiyonu birlikte yaşayabilir", () => {
  it("mobil kartta iç içe <button> YOKTUR (geçersiz HTML)", () => {
    const { container } = kur({ satirAcildi: vi.fn(), aksiyon: vi.fn() });
    const icIce = mobilBolum(container).querySelectorAll("button button");
    expect(
      Array.from(icIce).map((b) => b.textContent),
      "kart bir <button>a sarıldığı için aksiyon düğmesi onun İÇİNDE kaldı"
    ).toEqual([]);
  });

  it("mobil kartta aksiyon düğmesi kendi işini görür, satırı AÇMAZ", () => {
    const satirAcildi = vi.fn();
    const aksiyon = vi.fn();
    const { container } = kur({ satirAcildi, aksiyon });

    const dugme = within(mobilBolum(container)).getByRole("button", { name: "Sil 1" });
    fireEvent.click(dugme);

    expect(aksiyon).toHaveBeenCalledWith(VERI[0]);
    expect(
      satirAcildi,
      "aksiyona basıldı ama satır da açıldı — kullanıcı iki şey birden yaptı"
    ).not.toHaveBeenCalled();
  });

  it("mobil kartın METNİNE tıklamak satırı açar", () => {
    const satirAcildi = vi.fn();
    const { container } = kur({ satirAcildi, aksiyon: vi.fn() });

    fireEvent.click(within(mobilBolum(container)).getByText("İkinci kayıt"));
    expect(satirAcildi).toHaveBeenCalledWith(VERI[1]);
  });

  it("satırı açan denetimin adı satırı TANITIR ama aksiyonları YUTMAZ (SK-5)", () => {
    // İP-A7d1'de bu ad `aria-labelledby` ile kartın TÜM içeriğinden geliyordu
    // ve gerekçesi "çağıran taraf prop yazmasın, unutulamasın" idi. İP-A7d2
    // ölçtü: A7d1'in üç ekranının hiçbirinde kartın İÇİNDE aksiyon yoktu.
    // Olduğu anda (`PackagesPage`) erişilebilir ad hesabı kartın aksiyon
    // düğmelerinin metnini de topluyor — ekran okuyucu tek düğmeyi
    // "Birinci kayıt Sil 1" diye okuyor ve "Sil 1" adlı İKİ denetim doğuyor.
    //
    // Yeni sözleşme: ad çağıran taraftan gelir ama UNUTULAMAZ —
    // `onRowClick` verildiğinde `satirAdi` tip düzeyinde zorunludur.
    const { container } = kur({ satirAcildi: vi.fn(), aksiyon: vi.fn() });
    const acici = within(mobilBolum(container)).getByRole("button", {
      name: "Birinci kayıt — ayrıntı",
    });
    expect(acici.getAttribute("aria-label")).toBe("Birinci kayıt — ayrıntı");
    // Aksiyon adı YALNIZ gerçek aksiyonda bulunur (ikiye çıkmaz).
    expect(
      within(mobilBolum(container)).getAllByRole("button", { name: "Sil 1" })
    ).toHaveLength(1);
  });

  it("masaüstünde satır aksiyonuna tıklamak satırı AÇMAZ (olay kabarması)", () => {
    const satirAcildi = vi.fn();
    const aksiyon = vi.fn();
    const { container } = kur({ satirAcildi, aksiyon });

    fireEvent.click(within(masaustuBolum(container)).getByRole("button", { name: "Sil 2" }));

    expect(aksiyon).toHaveBeenCalledWith(VERI[1]);
    expect(satirAcildi, "tr onClick aksiyon tıklamasını da yakaladı").not.toHaveBeenCalled();
  });

  it("TERS PROVA: masaüstünde satır hücresine tıklamak satırı AÇAR", () => {
    // Yukarıdaki kural "satır tıklamasını tamamen kapat" değildir.
    const satirAcildi = vi.fn();
    const { container } = kur({ satirAcildi, aksiyon: vi.fn() });
    fireEvent.click(within(masaustuBolum(container)).getByText("Birinci kayıt"));
    expect(satirAcildi).toHaveBeenCalledWith(VERI[0]);
  });

  it("satır aksiyonu OLMAYAN kartta davranış değişmez: kart tıklanabilir", () => {
    const satirAcildi = vi.fn();
    const { container } = render(
      <DataTable
        columns={[{ accessorKey: "ad", header: "Ad", enableSorting: false }]}
        data={VERI}
        getRowId={(k) => String(k.id)}
        emptyTitle="Kayıt yok"
        onRowClick={satirAcildi}
        renderMobileRow={(k) => <p>{k.ad}</p>}
        page={1}
        pageSize={25}
        total={2}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
      />
    );
    fireEvent.click(within(mobilBolum(container)).getByText("Birinci kayıt"));
    expect(satirAcildi).toHaveBeenCalledWith(VERI[0]);
  });

  it("onRowClick YOKKEN mobil kart hiç düğme üretmez", () => {
    // Ters prova: açıcı katman koşulsuz serilmiyor — tıklanamayan listede
    // ekran okuyucuya sahte bir düğme çıkmamalı.
    const { container } = render(
      <DataTable
        columns={[{ accessorKey: "ad", header: "Ad", enableSorting: false }]}
        data={VERI}
        getRowId={(k) => String(k.id)}
        emptyTitle="Kayıt yok"
        renderMobileRow={(k) => <p>{k.ad}</p>}
        page={1}
        pageSize={25}
        total={2}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
      />
    );
    expect(within(mobilBolum(container)).queryAllByRole("button")).toEqual([]);
  });
});

describe("İP-A7d1 · sayfalama düğmeleri bu değişiklikten etkilenmez", () => {
  it("Önceki/Sonraki hâlâ çalışıyor", () => {
    const sayfaDegisti = vi.fn();
    render(
      <DataTable
        columns={[{ accessorKey: "ad", header: "Ad", enableSorting: false }]}
        data={VERI}
        getRowId={(k) => String(k.id)}
        emptyTitle="Kayıt yok"
        page={1}
        pageSize={1}
        total={2}
        onPageChange={sayfaDegisti}
        onPageSizeChange={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Sonraki" }));
    expect(sayfaDegisti).toHaveBeenCalledWith(2);
  });
});
