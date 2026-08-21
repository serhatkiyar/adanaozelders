/**
 * İP-A6 · Görev 3 — rota gezinmesinde kirli form uyarısı (gerçek DOM).
 *
 * Testler "element var mı" demez: her düğümde GERÇEKTEN gezinilip
 * gezinilmediği, ekranda hangi sayfanın durduğuyla okunur.
 *
 * Kayıt modül düzeyinde yaşadığı için (bkz. `gezinmeBekcisi.tsx` → "Neden
 * bağlam değil") her testten önce sıfırlanır; aksi hâlde bir testin bıraktığı
 * kirli form sonrakini yanlış-kırmızı yapardı (kök CLAUDE.md §G).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useForm } from "react-hook-form";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { HATA_TAKIBI_YOK, useKirliFormBekcisi } from "./kirliFormBekcisi";
import {
  GezinmeBaglantisi,
  gezinmeKaydiniSifirla,
  kirliFormVarMi,
  useGezinmeKorumasi,
} from "./gezinmeBekcisi";

const ONAY_BASLIK = "Kaydedilmemiş değişiklikler var";
const AYRIL = "Sayfadan ayrıl";
const VAZGEC = "Vazgeç";

/** Kirli form bekçisini kullanan gerçek bir form — ekran hiçbir kayıt yazmaz. */
function UrunFormu() {
  const form = useForm<{ ad: string }>({ defaultValues: { ad: "" } });
  useKirliFormBekcisi({ form, sunucuHatasi: HATA_TAKIBI_YOK });
  return <input aria-label="Ad" {...form.register("ad")} />;
}

function Kabuk({ formVar = true }: { formVar?: boolean }) {
  return (
    <MemoryRouter initialEntries={["/magaza"]}>
      <nav>
        <GezinmeBaglantisi to="/siparisler">Siparişler</GezinmeBaglantisi>
      </nav>
      <Routes>
        <Route
          path="/magaza"
          element={
            <div>
              <h1>Mağaza sayfası</h1>
              {formVar && <UrunFormu />}
            </div>
          }
        />
        <Route path="/siparisler" element={<h1>Siparişler sayfası</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

async function acikOnayiKapat() {
  const pencere = document.querySelector('[role="alertdialog"]');
  if (!pencere) return;
  const dugmeler = within(pencere as HTMLElement).getAllByRole("button");
  expect(dugmeler.length).toBeGreaterThan(0);
  fireEvent.click(dugmeler[0]);
  await waitFor(() =>
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  );
}

const yaz = (deger: string) =>
  fireEvent.change(screen.getByLabelText("Ad"), { target: { value: deger } });

describe("İP-A6 · rota gezinmesi bekçisi", () => {
  beforeEach(gezinmeKaydiniSifirla);
  afterEach(acikOnayiKapat);

  it("G1 — temiz formda gezinme doğrudan gerçekleşir, onay sorulmaz", async () => {
    render(<Kabuk />);

    fireEvent.click(screen.getByText("Siparişler"));

    await screen.findByText("Siparişler sayfası");
    expect(screen.queryByText(ONAY_BASLIK)).toBeNull();
  });

  it("G2 — kirli formda gezinme DURDURULUR ve onay sorulur", async () => {
    render(<Kabuk />);
    yaz("Kurşun Kalem");

    fireEvent.click(screen.getByText("Siparişler"));

    expect(await screen.findByText(ONAY_BASLIK)).toBeTruthy();
    // Onay beklenirken sayfa DEĞİŞMEMİŞ olmalı — asıl iddia bu.
    expect(screen.getByText("Mağaza sayfası")).toBeTruthy();
    expect(screen.queryByText("Siparişler sayfası")).toBeNull();
  });

  it("G3 — 'Vazgeç' seçilirse sayfada kalınır ve yazılan veri durur", async () => {
    render(<Kabuk />);
    yaz("Kurşun Kalem");
    fireEvent.click(screen.getByText("Siparişler"));

    fireEvent.click(await screen.findByText(VAZGEC));

    await waitFor(() => expect(screen.queryByText(ONAY_BASLIK)).toBeNull());
    expect(screen.getByText("Mağaza sayfası")).toBeTruthy();
    expect((screen.getByLabelText("Ad") as HTMLInputElement).value).toBe("Kurşun Kalem");
  });

  it("G4 — 'Sayfadan ayrıl' seçilirse gezinme gerçekleşir", async () => {
    render(<Kabuk />);
    yaz("Kurşun Kalem");
    fireEvent.click(screen.getByText("Siparişler"));

    fireEvent.click(await screen.findByText(AYRIL));

    await screen.findByText("Siparişler sayfası");
  });

  it("G5 — form sökülünce koruma kalkar (kalıcı 'kirli' izi bırakmaz)", async () => {
    const { rerender } = render(<Kabuk />);
    yaz("Kurşun Kalem");
    expect(kirliFormVarMi()).toBe(true);

    rerender(<Kabuk formVar={false} />);

    await waitFor(() => expect(kirliFormVarMi()).toBe(false));
  });

  it("G6 — ekran hiçbir kayıt yazmadan korunur (kayıt form katmanında kurulur)", () => {
    // `UrunFormu` yalnız `useKirliFormBekcisi` çağırıyor; `useGezinmeKorumasi`
    // adı o dosyada HİÇ geçmiyor. Göç eden 21 ekranın yazacağı kod sıfır
    // satır olmasının kanıtı budur.
    render(<Kabuk />);
    expect(kirliFormVarMi()).toBe(false);
    yaz("x");
    expect(kirliFormVarMi()).toBe(true);
  });

  it("G7 — yeni sekmede açan tıklama (Ctrl/⌘) onay sormaz", async () => {
    render(<Kabuk />);
    yaz("Kurşun Kalem");

    // Tarayıcı bu tıklamada MEVCUT sayfayı sökmez; onay sormak gereksiz
    // sürtünmedir ve uyarıyı önemsizleştirir.
    fireEvent.click(screen.getByText("Siparişler"), { ctrlKey: true });

    await waitFor(() => expect(screen.queryByText(ONAY_BASLIK)).toBeNull());
    expect(screen.getByText("Mağaza sayfası")).toBeTruthy();
  });

  it("G8 — doğrudan `useGezinmeKorumasi` kullanan bir yüzey de korunur", async () => {
    function Yalin() {
      useGezinmeKorumasi(true);
      return <p>Yalın yüzey</p>;
    }
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <GezinmeBaglantisi to="/b">Git</GezinmeBaglantisi>
        <Routes>
          <Route path="/a" element={<Yalin />} />
          <Route path="/b" element={<h1>B sayfası</h1>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("Git"));

    expect(await screen.findByText(ONAY_BASLIK)).toBeTruthy();
    expect(screen.queryByText("B sayfası")).toBeNull();
  });
});
