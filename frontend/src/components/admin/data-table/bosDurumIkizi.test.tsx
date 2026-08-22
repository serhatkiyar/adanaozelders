/**
 * İP-B2 — `DataTable` v2: iki boş durumun SEÇİMİ ve liste çerçevesi.
 *
 * Ayrımın kendisi `ui2/liste/bosDurum.test.tsx`te sınanıyor; burada sınanan
 * şey **kararın kimde olduğu**: hangi metnin basılacağına bileşen karar
 * veriyor mu, yoksa ekran mı? Ekran karar verseydi 22 liste ekranında 22 kez
 * unutulabilirdi ve unutulduğu yerde kullanıcı katalogun boşaldığını sanırdı.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "./DataTable";

interface Kayit {
  id: number;
  ad: string;
}

const KOLONLAR: ColumnDef<Kayit, unknown>[] = [
  { accessorKey: "ad", header: "Ad", enableSorting: false },
];

function bas({
  data = [] as Kayit[],
  filtreli = false,
  isLoading = false,
}: {
  data?: Kayit[];
  filtreli?: boolean;
  isLoading?: boolean;
}) {
  return render(
    <DataTable
      columns={KOLONLAR}
      data={data}
      getRowId={(k) => String(k.id)}
      isLoading={isLoading}
      bos={{
        filtreli,
        kayitYok: <p data-durum="kayit-yok">Henüz kayıt yok</p>,
        sonucYok: <p data-durum="sonuc-yok">Eşleşen kayıt yok</p>,
      }}
      page={1}
      pageSize={25}
      total={data.length}
      onPageChange={vi.fn()}
      onPageSizeChange={vi.fn()}
    />
  );
}

describe("İP-B2 · DataTable v2 — boş durum SEÇİMİ bileşenin", () => {
  it("filtre YOKKEN 'kayıt yok' basılır", () => {
    bas({ filtreli: false });
    expect(screen.getByText("Henüz kayıt yok")).toBeTruthy();
    expect(screen.queryByText("Eşleşen kayıt yok")).toBeNull();
  });

  it("filtre VARKEN 'sonuç yok' basılır", () => {
    bas({ filtreli: true });
    expect(screen.getByText("Eşleşen kayıt yok")).toBeTruthy();
    expect(screen.queryByText("Henüz kayıt yok")).toBeNull();
  });

  it("veri VARKEN hiçbiri basılmaz (ters prova)", () => {
    // Bu olmadan yukarıdaki iki iddia, boş durumu HER ZAMAN basan bir
    // bileşenle de geçerdi.
    bas({ data: [{ id: 1, ad: "Birinci" }], filtreli: true });
    expect(screen.queryByText("Eşleşen kayıt yok")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("YÜKLENİRKEN boş durum basılmaz — iskelet gelir", () => {
    // "Veri yok" ile "veri henüz gelmedi" farklı şeylerdir; ikisini
    // karıştırmak kullanıcıya olmayan bir sonuç bildirir.
    bas({ isLoading: true });
    expect(screen.queryByText("Henüz kayıt yok")).toBeNull();
    expect(screen.getByLabelText("Yükleniyor")).toBeTruthy();
  });
});

describe("İP-B2 · DataTable v2 — liste çerçevesi her hâlde durur", () => {
  it("boş listede de çerçeve basılır", () => {
    // Eski hâl `EmptyState`i tablonun YERİNE basıyordu: çerçeve kayboluyor,
    // sayfa "bir şey eksik" gibi görünüyordu.
    const { container } = bas({ filtreli: false });
    const cerceve = container.firstElementChild as HTMLElement;
    expect(cerceve.className).toContain("border-panel-border");
    expect(cerceve.contains(screen.getByText("Henüz kayıt yok"))).toBe(true);
  });

  it("boş listede SAYFALAMA basılmaz", () => {
    // "0–0 / 0 kayıt" ve iki devre dışı düğme hiçbir şey söylemez.
    bas({ filtreli: false });
    expect(screen.queryByRole("button", { name: "Sonraki" })).toBeNull();
  });

  it("dolu listede sayfalama VAR (ters prova)", () => {
    bas({ data: [{ id: 1, ad: "Birinci" }] });
    expect(screen.getByRole("button", { name: "Sonraki" })).toBeTruthy();
  });
});

describe("İP-B2 · DataTable v2 — ESKİ boş durum sözleşmesi bozulmadı", () => {
  it("`emptyTitle` veren 12 ekran aynen çalışır", () => {
    // Bu paket yalnız BİR ekranı göç ettiriyor; eski üçlüyü kullanan
    // ekranlar dokunulmadan çalışmaya devam etmeli.
    render(
      <DataTable
        columns={KOLONLAR}
        data={[]}
        getRowId={(k) => String(k.id)}
        emptyTitle="Kayıt yok"
        emptyDescription="Açıklama"
        page={1}
        pageSize={25}
        total={0}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Kayıt yok");
    expect(screen.getByText("Açıklama")).toBeTruthy();
  });
});
