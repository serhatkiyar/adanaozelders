import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { HataCozme } from "@/panel/pages/ayarlar/HataCozme";
import { PANEL_MENU, izinBeyaniniKarsilarMi, menuyuIzneGoreSuz, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useFailedOutbox, useRetryOutboxEvent, useStuckEscrow } from "@/hooks/useAdminOperations";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { FailedOutboxEvent, StuckEscrowRecord } from "@/types";

vi.mock("@/hooks/useAdminOperations", () => ({
  useStuckEscrow: vi.fn(),
  useFailedOutbox: vi.fn(),
  useRetryOutboxEvent: vi.fn(),
}));

const retry = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];

const PARA: StuckEscrowRecord[] = [
  { entity: "order", entity_id: 501, order_id: 501, reason: "MANUAL_REVIEW", money_status: "REFUND_PENDING", amount: "349.90", currency: "TRY", refund_attempts: 3, refund_requested_at: "2026-09-01T09:00:00Z", provider_ref: "iyz-abc-123-very-long-provider-reference-xxxxxxxxxxxxxxxxxxxxxxxx", updated_at: "2026-09-02T10:00:00Z" },
  { entity: "order_return", entity_id: 77, order_id: 501, reason: "RETRY_EXHAUSTED", money_status: "REFUND_FAILED", amount: null, currency: null, refund_attempts: 5, refund_requested_at: null, provider_ref: null, updated_at: null },
  { entity: "gift_card" as never, entity_id: 9, order_id: null, reason: "RETRY_EXHAUSTED", money_status: "HELD", amount: "10", currency: "TRY", refund_attempts: 1, refund_requested_at: null, provider_ref: null, updated_at: null },
];
const ISLER: FailedOutboxEvent[] = [
  { id: 91, kind: "sms.order_shipped", status: "FAILED", attempts: 5, last_error: "Sağlayıcı 502 döndü", order_id: 501, next_attempt_at: null, created_at: null, updated_at: "2026-09-02T11:00:00Z" },
  { id: 92, kind: "email.receipt", status: "FAILED", attempts: 3, last_error: null, order_id: null, next_attempt_at: null, created_at: null, updated_at: null },
];

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const sonEnabled = (m: unknown) => (m as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[PATHS.adminNewOperations]}>
          <HataCozme />
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

const onayDugmesi = () => screen.getByRole("button", { name: /İşi yeniden kuyruğa al/ });
const onayGorunur = () => [...document.querySelectorAll(".ant-modal-confirm")].some((m) => {
  const wrap = m.closest(".ant-modal-wrap") as HTMLElement | null;
  // `.ant-modal-confirm` kökü aynı zamanda `.ant-modal`dır; kapanış animasyonu (zoom-leave) kapalı sayılır.
  return Boolean(wrap && wrap.style.display !== "none" && !m.classList.contains("ant-zoom-leave"));
});

beforeEach(() => {
  retry.mockReset();
  sozler.length = 0;
  retry.mockImplementation(() => new Promise((res, rej) => { sozler.push({ res, rej }); }));
  vi.mocked(useStuckEscrow).mockReset().mockReturnValue(sonuc(PARA));
  vi.mocked(useFailedOutbox).mockReset().mockReturnValue(sonuc(ISLER));
  vi.mocked(useRetryOutboxEvent).mockReturnValue({ mutateAsync: retry, isPending: false } as never);
  izin("operations.view", "operations.manage");
});

describe("HataCozme", () => {
  it("iki bölümün gerçek alanları; bilinmeyen entity ham değerle; para bölümünde hiçbir aksiyon yok", () => {
    kur();
    expect(screen.getByRole("heading", { name: "Hata Çözme" })).toBeInTheDocument();
    expect(sonEnabled(useStuckEscrow)).toBe(true);
    expect(sonEnabled(useFailedOutbox)).toBe(true);
    const para = screen.getByRole("region", { name: "Sıkışmış para" });
    expect(within(para).getByText("Manuel inceleme")).toBeInTheDocument();
    expect(within(para).getByText(/349,9 TL · durum REFUND_PENDING · 3 deneme · ilk niyet/)).toBeInTheDocument();
    expect(within(para).getByText(/Sağlayıcı referansı: iyz-abc-123/)).toBeInTheDocument();
    expect(within(para).getByText("İade talebi #77")).toBeInTheDocument();
    expect(within(para).getAllByText("Deneme tükendi")).toHaveLength(2);
    // Farklı sipariş id'si ayrıca yazılır; aynıysa yazılmaz
    expect(within(para).getAllByText("Sipariş #501")).toHaveLength(2);
    expect(within(para).getByText(/- · durum REFUND_FAILED · 5 deneme$/)).toBeInTheDocument();
    expect(within(para).getAllByText("Sağlayıcı referansı: -")).toHaveLength(2);
    expect(within(para).getByText("gift_card #9")).toBeInTheDocument();
    expect(within(para).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /iade|sil|düzelt/i })).not.toBeInTheDocument();

    const isler = screen.getByRole("region", { name: "Ölü işler" });
    expect(within(isler).getByText("sms.order_shipped")).toBeInTheDocument();
    expect(within(isler).getByText("#91")).toBeInTheDocument();
    expect(within(isler).getByText("Sipariş #501")).toBeInTheDocument();
    expect(within(isler).getByText("Sağlayıcı 502 döndü")).toBeInTheDocument();
    expect(within(isler).getByText(/5 deneme · son/)).toBeInTheDocument();
    expect(within(isler).getByText("Hata metni yok")).toBeInTheDocument();
    expect(within(isler).getByText("3 deneme")).toBeInTheDocument();
    expect(within(isler).getAllByRole("button", { name: /işini yeniden dene/ })).toHaveLength(2);
  });

  it("bölümler bağımsız: yükleniyor/hata/boş; Tekrar dene yalnız hatalı bölümü çeker", async () => {
    const paraRefetch = vi.fn();
    const isRefetch = vi.fn();
    vi.mocked(useStuckEscrow).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch: paraRefetch }));
    vi.mocked(useFailedOutbox).mockReturnValue(sonuc(ISLER, { refetch: isRefetch }));
    const ilk = kur();
    expect(screen.getByText("Sıkışmış para listesi yüklenemedi.")).toBeInTheDocument();
    expect(screen.getByText("sms.order_shipped")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(paraRefetch).toHaveBeenCalled();
    expect(isRefetch).not.toHaveBeenCalled();
    ilk.unmount();

    vi.mocked(useStuckEscrow).mockReturnValue(sonuc(undefined, { isPending: true }));
    vi.mocked(useFailedOutbox).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Sıkışmış para listesi yükleniyor…")).toBeInTheDocument();
    expect(screen.getByText("Ölü iş yok")).toBeInTheDocument();
    expect(screen.getByText("Bildirim kuyruğunda tavana çarpmış bir iş bulunmuyor.")).toBeInTheDocument();
  });

  it("boş para listesi eski metinle", () => {
    vi.mocked(useStuckEscrow).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Sıkışmış para kaydı yok")).toBeInTheDocument();
    expect(screen.getByText("Otomatik mutabakat şu an her kaydı sonuca sürebiliyor.")).toBeInTheDocument();
  });

  it("yeniden dene: onay içeriği kind+id ve bildirim uyarısı; çift onay tek istek; pending'de kapanmaz; requeued=true başarı", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "sms.order_shipped #91 işini yeniden dene" }));
    expect(await screen.findByText(/"sms\.order_shipped" işi \(#91\) yeniden gönderilmek üzere kuyruğa alınacak\. Bu işlem müşteriye giden bir bildirimi tetikleyebilir\./)).toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
    await userEvent.dblClick(onayDugmesi());
    await userEvent.click(onayDugmesi());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(91);
    // Uçuş sürerken Vazgeç ile kapanmaz (await modu, ok yükleniyor)
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(onayGorunur()).toBe(true);
    await act(async () => {
      sozler[0].res({ ...ISLER[0], requeued: true });
      await Promise.resolve();
    });
    expect(await screen.findByText("İş yeniden kuyruğa alındı.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
  });

  it("requeued=false hata değildir; 'zaten kuyrukta' mesajıyla başarı olarak kapanır", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "email.receipt #92 işini yeniden dene" }));
    await userEvent.click(await screen.findByRole("button", { name: /İşi yeniden kuyruğa al/ }));
    expect(retry).toHaveBeenCalledWith(92);
    await act(async () => {
      sozler[0].res({ ...ISLER[1], requeued: false });
      await Promise.resolve();
    });
    expect(await screen.findByText("İş zaten kuyrukta bekliyordu; yeniden kuyruğa alınmadı.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
  });

  it("409/403/500: gerçek gerekçe görünür, onay açık kalır, kilit bırakılır ve yeniden denenebilir; hedef ID sabit", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "sms.order_shipped #91 işini yeniden dene" }));
    await userEvent.click(await screen.findByRole("button", { name: /İşi yeniden kuyruğa al/ }));
    await act(async () => {
      sozler[0].rej({ response: { status: 409, data: { detail: "Bu iş yeniden kuyruğa alınamaz (durum: SENT). Gönderilmiş bir bildirim ikinci kez gönderilmez." } } });
      await Promise.resolve();
    });
    expect(await screen.findByText(/Gönderilmiş bir bildirim ikinci kez gönderilmez/)).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi()).not.toHaveClass("ant-btn-loading"));

    await userEvent.click(onayDugmesi());
    expect(retry).toHaveBeenCalledTimes(2);
    expect(retry).toHaveBeenLastCalledWith(91);
    await act(async () => {
      sozler[1].rej({ response: { status: 403, data: { detail: "Bu işlem için yetkin yok." } } });
      await Promise.resolve();
    });
    expect(await screen.findByText(/yetkin yok/)).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi()).not.toHaveClass("ant-btn-loading"));

    await userEvent.click(onayDugmesi());
    await act(async () => {
      sozler[2].rej({ response: { status: 500, data: { detail: "Sunucu hatası" } } });
      await Promise.resolve();
    });
    expect(await screen.findByText("Sunucu hatası")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    expect(retry).toHaveBeenCalledTimes(3);
    for (const c of retry.mock.calls) expect(c[0]).toBe(91);
  });

  it("yalnız operations.view: iki liste görünür, Yeniden dene yok; izinsizde AccessDenied ve iki sorgu kapalı", () => {
    izin("operations.view");
    const ilk = kur();
    expect(screen.getByText(/yalnız görüntüleme yetkiniz var/)).toBeInTheDocument();
    expect(screen.getByText("sms.order_shipped")).toBeInTheDocument();
    expect(screen.getAllByText("Sipariş #501").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /yeniden dene/i })).not.toBeInTheDocument();
    ilk.unmount();

    izin("settings.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(sonEnabled(useStuckEscrow)).toBe(false);
    expect(sonEnabled(useFailedOutbox)).toBe(false);
  });

  it("rota ve menü: Ayarlar → Hata Çözme operations izniyle; seçili/açık anahtarlar; Ayarlar sırası korunur", () => {
    expect(PATHS.adminNewOperations).toBe("/yonetim-yeni/ayarlar/hata-cozme");
    expect(ROUTES.adminNewOperations).toBe(PATHS.adminNewOperations);
    const ayarlar = PANEL_MENU.find((m) => m.key === "ayarlar")!;
    expect(ayarlar.children?.map((c) => c.label)).toEqual(["Genel", "Personel & Yetkiler", "Denetim Kayıtları", "Hata Çözme"]);
    expect(ayarlar.children?.every((c) => c.path && c.requiredPermission)).toBe(true);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewOperations)).toMatchObject({ label: "Hata Çözme", requiredPermission: "operations" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewOperations)).toEqual({ selectedKey: "hata-cozme", openKeys: ["ayarlar"] });
    expect(izinBeyaniniKarsilarMi(["operations.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewOperations)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["settings.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewOperations)!)).toBe(false);
    const gorunur = menuyuIzneGoreSuz(PANEL_MENU, ["operations.view"]).find((m) => m.key === "ayarlar");
    expect(gorunur?.children?.map((c) => c.key)).toEqual(["hata-cozme"]);
  });
});
