import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { StokSayimiDetayi } from "@/panel/pages/urunler/StokSayimiDetayi";
import * as hooks from "@/hooks/useInventory";
import { useAuthStore } from "@/store/authStore";
import type { CountLineOut, CountSessionDetailOut } from "@/api/inventory";

vi.mock("@/hooks/useInventory", () => ({
  useCountSession: vi.fn(),
  useSetLineCount: vi.fn(),
  useResolveCountLine: vi.fn(),
  useCountSessionAction: vi.fn(),
  useApplyCountSession: vi.fn(),
  useCancelCountSession: vi.fn(),
  useAddCountProducts: vi.fn(),
}));
vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: () => ({ data: { items: [], total: 0 }, isFetching: false }),
}));

const m = {
  say: vi.fn(), acikla: vi.fn(), aksiyon: vi.fn(), uygula: vi.fn(), iptal: vi.fn(), urunEkle: vi.fn(),
};

function satir(ek: Partial<CountLineOut> = {}): CountLineOut {
  return {
    id: 1, product_id: 10, product_name: "9. Sınıf Matematik", product_sku: "FZK-000010", bucket: "SALEABLE",
    status: "PENDING", system_qty_snapshot: 12, reserved_qty_snapshot: 2, counted_qty: null, difference: null,
    counted_at: null, counted_by_admin_id: null, stale_reason: null, resolved_by_admin_id: null, resolved_at: null,
    resolution_note: null, note: null, applied_movement_id: null, ...ek,
  } as CountLineOut;
}

function oturum(status: CountSessionDetailOut["status"], lines: CountLineOut[] = [satir()], ek: Partial<CountSessionDetailOut> = {}): CountSessionDetailOut {
  return {
    id: 7, code: "SAY-000007", status, scope: "MANUAL", category_id: null, note: null, created_by_admin_id: 3,
    created_at: "2026-09-10T10:00:00Z", started_at: null, submitted_at: null, reviewed_by_admin_id: null, reviewed_at: null,
    applied_by_admin_id: null, applied_at: null, cancelled_by_admin_id: null, cancelled_at: null, cancel_reason: null, lines, ...ek,
  } as CountSessionDetailOut;
}

function veri(o: CountSessionDetailOut | undefined, ek: object = {}) {
  vi.mocked(hooks.useCountSession).mockReturnValue({ data: o, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek } as never);
}

function izin(...perms: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: perms } as never });
}

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={["/yonetim-yeni/urunler/stok-sayimi/7"]}>
          <Routes>
            <Route path="/yonetim-yeni/urunler/stok-sayimi/:id" element={<StokSayimiDetayi />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  vi.mocked(hooks.useSetLineCount).mockReturnValue({ mutate: m.say, isPending: false } as never);
  vi.mocked(hooks.useResolveCountLine).mockReturnValue({ mutate: m.acikla, isPending: false } as never);
  vi.mocked(hooks.useCountSessionAction).mockReturnValue({ mutate: m.aksiyon, isPending: false } as never);
  vi.mocked(hooks.useApplyCountSession).mockReturnValue({ mutate: m.uygula, isPending: false } as never);
  vi.mocked(hooks.useCancelCountSession).mockReturnValue({ mutate: m.iptal, isPending: false } as never);
  vi.mocked(hooks.useAddCountProducts).mockReturnValue({ mutate: m.urunEkle, isPending: false, error: null } as never);
  izin("inventory.view", "inventory.count", "inventory.apply");
});

describe("StokSayimiDetayi", () => {
  it("DRAFT: ürün ekleme, Sayımı başlat ve iptal var; sayma alanı yok", async () => {
    veri(oturum("DRAFT", []));
    kur();
    expect(screen.getByRole("heading", { name: "SAY-000007" })).toBeInTheDocument();
    expect(screen.getByText("Taslak")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Ürünler" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Oturumu iptal et" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İncelemeye gönder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kaydet" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ekle" }));
    expect(screen.getByText("En az bir ürün seçin.")).toBeInTheDocument();
    expect(m.urunEkle).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Sayımı başlat" }));
    expect(m.aksiyon).toHaveBeenCalledWith("start", expect.anything());
  });

  it("IN_PROGRESS: satır sayımı doğrulanır ve gerçek hook'a gider; incelemeye gönderilir", async () => {
    veri(oturum("IN_PROGRESS"));
    kur();
    const kutu = screen.getByRole("spinbutton", { name: /Sayılan miktar/ });
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(screen.getByText("Sayılan miktarı yazın.")).toBeInTheDocument();
    expect(m.say).not.toHaveBeenCalled();

    await userEvent.type(kutu, "9");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(m.say).toHaveBeenCalledWith({ lineId: 1, countedQty: 9 }, expect.anything());

    await userEvent.click(screen.getByRole("button", { name: "İncelemeye gönder" }));
    expect(m.aksiyon).toHaveBeenCalledWith("submit", expect.anything());
    expect(screen.queryByRole("button", { name: "Sayımı başlat" })).not.toBeInTheDocument();
  });

  it("IN_PROGRESS: STALE satırda 'Açıklama ekle' pencereyi açar, gerekçe zorunludur", async () => {
    veri(oturum("IN_PROGRESS", [satir({ status: "STALE", stale_reason: "SALE", counted_qty: 5 })]));
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Açıklama ekle" }));
    const pencere = await screen.findByRole("dialog");
    await userEvent.click(within(pencere).getByRole("button", { name: "Açıklamayı kaydet" }));
    expect(within(pencere).getByText("En az 3 karakter yazın.")).toBeInTheDocument();
    await userEvent.type(within(pencere).getByLabelText("Açıklama"), "Raf yeniden dizildi");
    await userEvent.click(within(pencere).getByRole("button", { name: "Açıklamayı kaydet" }));
    expect(m.acikla).toHaveBeenCalledWith({ lineId: 1, note: "Raf yeniden dizildi" }, expect.anything());
  });

  it("REVIEW: engel varken Farkları uygula kapalı ve engeller listelenir; İncelemeyi geri al çalışır", async () => {
    veri(oturum("REVIEW", [satir({ status: "PENDING" })]));
    kur();
    expect(screen.getByRole("button", { name: "Farkları uygula" })).toBeDisabled();
    expect(screen.getByText("Farklar henüz uygulanamaz")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "İncelemeyi geri al" }));
    expect(m.aksiyon).toHaveBeenCalledWith("reopen", expect.anything());
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("REVIEW: engel yokken Farkları uygula pencereyi açar ve tek idempotency anahtarıyla gönderir", async () => {
    veri(oturum("REVIEW", [satir({ status: "COUNTED", counted_qty: 9, counted_at: "2026-09-10T11:00:00Z", counted_by_admin_id: 3 })]));
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Farkları uygula" }));
    const pencere = await screen.findByRole("dialog");
    const onay = within(pencere).getByRole("button", { name: "Farkları uygula" });
    await userEvent.click(onay);
    await userEvent.click(onay);
    expect(m.uygula).toHaveBeenCalledTimes(1);
    expect(typeof m.uygula.mock.calls[0][0]).toBe("string");
    // Hata cevabında kilit açılmaz: yeniden tıklama ikinci isteği göndermez.
    act(() => m.uygula.mock.calls[0][1].onError(new Error("x")));
    expect(await within(pencere).findByText("Farklar uygulanamadı.")).toBeInTheDocument();
    await userEvent.click(onay);
    expect(m.uygula).toHaveBeenCalledTimes(1);
  });

  it("gerekçe penceresi kirliyken kapatma onay ister; devam et açık bırakır, sil kapatır", async () => {
    veri(oturum("DRAFT", []));
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Oturumu iptal et" }));
    await screen.findByRole("dialog");
    // Boşken doğrudan kapanır.
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    // Kapalı çekmece DOM'da kalır; başlık şeridindeki (ilk) düğme tıklanır.
    await userEvent.click(screen.getAllByRole("button", { name: "Oturumu iptal et" })[0]);
    await userEvent.type(await screen.findByLabelText("İptal gerekçesi"), "Yanlış raf");
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect((await screen.findAllByText("Yazdıklarınız kaybolacak")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole("button", { name: "Düzenlemeye devam et" }).at(-1) as HTMLElement);
    expect(screen.getByLabelText("İptal gerekçesi")).toHaveValue("Yanlış raf");
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await userEvent.click((await screen.findAllByRole("button", { name: "Değişiklikleri sil" })).at(-1) as HTMLElement);
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    expect(m.iptal).not.toHaveBeenCalled();
  });

  const YAZMA_AKSIYONLARI = ["Sayımı başlat", "İncelemeye gönder", "İncelemeyi geri al", "Farkları uygula", "Oturumu iptal et", "Kaydet", "Ekle", "Açıklama ekle"];

  it("CANCELLED salt okunur: hiçbir aksiyon veya sayma alanı yok, iptal gerekçesi görünür", () => {
    veri(oturum("CANCELLED", [satir({ status: "COUNTED", counted_qty: 9 })], { cancel_reason: "Yanlış raf" }));
    kur();
    for (const ad of YAZMA_AKSIYONLARI) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByText("İptal gerekçesi: Yanlış raf")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("APPLIED salt okunur: sayma alanı, ürün ekleme ve yazma aksiyonu yok; uygulayan özette görünür", () => {
    veri(
      oturum("APPLIED", [satir({ status: "COUNTED", counted_qty: 9, applied_movement_id: 44 })], {
        applied_by_admin_id: 5, applied_at: "2026-09-11T09:00:00Z", reviewed_by_admin_id: 4, reviewed_at: "2026-09-11T08:00:00Z",
      }),
    );
    kur();
    expect(screen.getByText("Uygulandı")).toBeInTheDocument();
    for (const ad of YAZMA_AKSIYONLARI) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Ürünler" })).not.toBeInTheDocument();
    expect(screen.getByText(/^#5 · /)).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("izinler: yalnız inventory.view ile hiçbir aksiyon yok; yalnız count ile REVIEW'de apply/reopen yok", () => {
    izin("inventory.view");
    veri(oturum("IN_PROGRESS"));
    const ilk = kur();
    expect(screen.queryByRole("button", { name: "İncelemeye gönder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    ilk.unmount();

    izin("inventory.view", "inventory.count");
    veri(oturum("REVIEW", [satir({ status: "COUNTED", counted_qty: 9 })]));
    kur();
    expect(screen.queryByRole("button", { name: "Farkları uygula" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İncelemeyi geri al" })).not.toBeInTheDocument();
  });

  it("yüklenme ve hata: Tekrar dene refetch çağırır", async () => {
    veri(undefined, { isPending: true });
    const ilk = kur();
    expect(screen.getByText("Sayım oturumu yükleniyor…")).toBeInTheDocument();
    ilk.unmount();

    const refetch = vi.fn();
    veri(undefined, { isError: true, error: new Error("x"), refetch });
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
