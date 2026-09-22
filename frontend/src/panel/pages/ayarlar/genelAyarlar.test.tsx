import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { GenelAyarlar } from "@/panel/pages/ayarlar/GenelAyarlar";
import { PANEL_MENU, izinBeyaniniKarsilarMi, menuyuIzneGoreSuz, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useFeatureFlags, usePaymentBranches, useUpdateFeatureFlag } from "@/hooks/useFeatureFlags";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { FeatureFlagOut } from "@/api/featureFlags";

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: vi.fn(),
  usePaymentBranches: vi.fn(),
  useUpdateFeatureFlag: vi.fn(),
}));

const guncelle = vi.fn();
const BAYRAK: FeatureFlagOut = {
  key: "payments.store", label: "Mağaza ödemeleri", description: "Platformun kendi kitap satışı.",
  enabled: true, default: false, enforced: true, updated_at: "2026-09-01T10:00:00Z", note: "sandbox tamam", locked_reason: null,
};
const KAPALI: FeatureFlagOut = { ...BAYRAK, key: "payments.tutor", label: "Öğretmen tahsilatı", enabled: false, enforced: false, updated_at: null, note: null };
const KILITLI: FeatureFlagOut = { ...BAYRAK, key: "payments.library", label: "Kütüphane tahsilatı", enabled: false, locked_reason: "Üretimde pazaryeri sözleşmesi imzalanmadan açılamaz." };
const KOLLAR = [
  { branch: "store", label: "Mağaza", open: true, flag_enabled: true, blockers: [] },
  { branch: "tutor_marketplace", label: "Öğretmen pazaryeri", open: false, flag_enabled: false, blockers: ["flag_disabled", "provider_marketplace_support"] },
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
        <MemoryRouter initialEntries={[PATHS.adminNewGeneralSettings]}>
          <GenelAyarlar />
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

// Altbilgi düğmesi: AntD kapatma simgesi de "Kapat" adını taşıyabilir, altbilgiyle sınırlanır.
const altbilgiDugmesi = (pencere: HTMLElement, ad: RegExp) => within(pencere.querySelector(".ant-drawer-footer") as HTMLElement).getByRole("button", { name: ad });
const onay = async () => {
  const d = (await screen.findAllByRole("dialog")).at(-1)!;
  await within(d).findAllByText("Kaydedilmemiş değişiklikler var");
  return d;
};

beforeEach(() => {
  guncelle.mockReset();
  vi.mocked(useFeatureFlags).mockReset().mockReturnValue(sonuc([BAYRAK, KAPALI, KILITLI]));
  vi.mocked(usePaymentBranches).mockReset().mockReturnValue(sonuc(KOLLAR));
  vi.mocked(useUpdateFeatureFlag).mockReturnValue({ mutate: guncelle, isPending: false } as never);
  izin("settings.view", "settings.manage");
});

describe("GenelAyarlar", () => {
  it("ödeme kolları ve bayraklar eski ekranın bütün alanlarıyla basılır", () => {
    kur();
    expect(screen.getByRole("heading", { name: "Genel Ayarlar" })).toBeInTheDocument();
    expect(sonEnabled(useFeatureFlags)).toBe(true);
    expect(sonEnabled(usePaymentBranches)).toBe(true);
    const kollar = screen.getByRole("region", { name: "Ödeme kolları" });
    expect(within(kollar).getByText("Mağaza")).toBeInTheDocument();
    expect(within(kollar).getByText("store")).toBeInTheDocument();
    expect(within(kollar).getByText("Bu koldaki ödeme bayrağı kapalı.")).toBeInTheDocument();
    expect(within(kollar).getByText(/iyzico Pazaryeri entegrasyonu tamamlanmadan/)).toBeInTheDocument();
    expect(within(kollar).getAllByText("Açık")).toHaveLength(1);
    expect(within(kollar).getAllByText("Kapalı")).toHaveLength(1);

    const bayraklar = screen.getByRole("region", { name: "Özellik bayrakları" });
    expect(within(bayraklar).getByText("Mağaza ödemeleri")).toBeInTheDocument();
    expect(within(bayraklar).getByText("payments.store")).toBeInTheDocument();
    expect(within(bayraklar).getAllByText("Platformun kendi kitap satışı.")).toHaveLength(3);
    // BAYRAK ve KILITLI aynı not/tarihi taşır (fixture mirası).
    expect(within(bayraklar).getAllByText(/Varsayılan: kapalı · Son değişiklik .* · “sandbox tamam”/)).toHaveLength(2);
    expect(within(bayraklar).getByText(/Varsayılan: kapalı · hiç değiştirilmedi/)).toBeInTheDocument();
    expect(within(bayraklar).getByText("Bağlanmadı")).toBeInTheDocument();
    expect(within(bayraklar).getByText(/hiçbir kontrolde okunmuyor/)).toBeInTheDocument();
    expect(within(bayraklar).getByText("Üretimde kilitli")).toBeInTheDocument();
    expect(within(bayraklar).getByText(/pazaryeri sözleşmesi imzalanmadan/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mağaza ödemeleri bayrağını kapat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Öğretmen tahsilatı bayrağını aç" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Kütüphane tahsilatı bayrağını aç" })).toBeDisabled();
  });

  it("gerekçe penceresi: kısa gerekçe istek atmaz ve odaklanır; geçerli gerekçe eski gövdeyle gider; başarıda kapanır", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Mağaza ödemeleri bayrağını kapat" }));
    const pencere = await screen.findByRole("dialog");
    expect(within(pencere).getByText("Bayrağı kapat")).toBeInTheDocument();
    expect(within(pencere).getByText(/“Mağaza ödemeleri” bayrağı kapatılacak/)).toBeInTheDocument();
    await userEvent.type(within(pencere).getByLabelText("Gerekçe"), "kısa");
    await userEvent.click(altbilgiDugmesi(pencere, /^Kapat$/));
    expect(within(pencere).getByRole("alert")).toHaveTextContent("Gerekçe en az 5 karakter olmalı.");
    expect(within(pencere).getByLabelText("Gerekçe")).toHaveFocus();
    expect(guncelle).not.toHaveBeenCalled();

    await userEvent.clear(within(pencere).getByLabelText("Gerekçe"));
    await userEvent.type(within(pencere).getByLabelText("Gerekçe"), "  bakım için kapatıldı  ");
    await userEvent.dblClick(altbilgiDugmesi(pencere, /^Kapat$/));
    expect(guncelle).toHaveBeenCalledTimes(1);
    expect(guncelle.mock.calls[0][0]).toEqual({ key: "payments.store", enabled: false, note: "bakım için kapatıldı" });
    act(() => guncelle.mock.calls[0][1].onSuccess());
    act(() => guncelle.mock.calls[0][1].onSettled());
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
  });

  it("422 note alana düşer, genel hata Alert'te; gerekçe korunur; hata sonrası yeniden gönderim; kirli kapatma onayı", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Öğretmen tahsilatı bayrağını aç" }));
    const pencere = await screen.findByRole("dialog");
    expect(within(pencere).getByText("Bayrağı aç")).toBeInTheDocument();
    await userEvent.type(within(pencere).getByLabelText("Gerekçe"), "pazaryeri onayı geldi");
    await userEvent.click(altbilgiDugmesi(pencere, /^Aç$/));
    expect(guncelle).toHaveBeenCalledTimes(1);
    expect(guncelle.mock.calls[0][0]).toEqual({ key: "payments.tutor", enabled: true, note: "pazaryeri onayı geldi" });

    // Pending render'ı gelmeden kapatma: senkron kilit tutar
    await userEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    expect(document.querySelectorAll(".ant-modal-confirm")).toHaveLength(0);

    act(() => guncelle.mock.calls[0][1].onError({ response: { status: 422, data: { detail: [{ loc: ["body", "note"], msg: "Gerekçe çok uzun" }] } } }));
    act(() => guncelle.mock.calls[0][1].onSettled());
    expect(await within(pencere).findByRole("alert")).toHaveTextContent("Gerekçe çok uzun");
    expect(within(pencere).getByLabelText("Gerekçe")).toHaveValue("pazaryeri onayı geldi");

    await userEvent.click(altbilgiDugmesi(pencere, /^Aç$/));
    expect(guncelle).toHaveBeenCalledTimes(2);
    act(() => guncelle.mock.calls[1][1].onError({ response: { status: 409, data: { detail: "Bayrak üretimde kilitli" } } }));
    act(() => guncelle.mock.calls[1][1].onSettled());
    expect(await within(pencere).findByText("Bayrak üretimde kilitli")).toBeInTheDocument();
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();

    await userEvent.click(within(pencere).getByRole("button", { name: /Close|Kapat/ }));
    await userEvent.click(within(await onay()).getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    await userEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    await userEvent.click(within(await onay()).getByRole("button", { name: "Değişiklikleri sil" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
  });

  it("boş pencere doğrudan kapanır; pending iken kapanmaz", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Öğretmen tahsilatı bayrağını aç" }));
    const pencere = await screen.findByRole("dialog");
    await userEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    vi.mocked(useUpdateFeatureFlag).mockReturnValue({ mutate: guncelle, isPending: true } as never);
    kur();
    await userEvent.click(screen.getAllByRole("button", { name: "Öğretmen tahsilatı bayrağını aç" }).at(-1)!);
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).not.toBeNull());
    const acik = document.querySelector(".ant-drawer-open .ant-drawer-content") as HTMLElement;
    await userEvent.click(within(acik).getByRole("button", { name: "Vazgeç" }));
    await userEvent.click(within(acik).getByRole("button", { name: /Close|Kapat/ }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    expect(guncelle).not.toHaveBeenCalled();
  });

  it("yalnız settings.view: salt okunur notu, hiç Aç/Kapat yok; izinsizde AccessDenied ve enabled=false", () => {
    izin("settings.view");
    const ilk = kur();
    expect(screen.getByText(/yalnız görüntüleme yetkiniz var/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bayrağını/ })).not.toBeInTheDocument();
    expect(sonEnabled(useFeatureFlags)).toBe(true);
    ilk.unmount();

    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(sonEnabled(useFeatureFlags)).toBe(false);
    expect(sonEnabled(usePaymentBranches)).toBe(false);
  });

  it("yükleniyor, hata + Tekrar dene ve boş durum bölüm bazında ayrı", async () => {
    const refetch = vi.fn();
    vi.mocked(usePaymentBranches).mockReturnValue(sonuc(undefined, { isPending: true }));
    vi.mocked(useFeatureFlags).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch }));
    const ilk = kur();
    expect(screen.getByText("Ödeme kolları yükleniyor…")).toBeInTheDocument();
    expect(screen.getByText("Bayraklar alınamadı.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
    ilk.unmount();

    vi.mocked(usePaymentBranches).mockReturnValue(sonuc([]));
    vi.mocked(useFeatureFlags).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Ödeme kolu bulunamadı")).toBeInTheDocument();
    expect(screen.getByText("Bayrak yok")).toBeInTheDocument();
  });

  it("rota ve menü: Ayarlar → Genel settings izniyle bağlı; seçili/açık anahtarlar; diğer Ayarlar çocukları bozulmadı", () => {
    expect(PATHS.adminNewGeneralSettings).toBe("/yonetim-yeni/ayarlar/genel");
    expect(ROUTES.adminNewGeneralSettings).toBe(PATHS.adminNewGeneralSettings);
    const ayarlar = PANEL_MENU.find((m) => m.key === "ayarlar")!;
    expect(ayarlar.requiredPermission).toBeUndefined();
    expect(ayarlar.children?.map((c) => c.label)).toEqual(["Genel", "Personel & Yetkiler", "Denetim Kayıtları", "Hata Çözme"]);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewGeneralSettings)).toMatchObject({ label: "Genel", requiredPermission: "settings" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewGeneralSettings)).toEqual({ selectedKey: "ayarlar-genel", openKeys: ["ayarlar"] });
    expect(izinBeyaniniKarsilarMi(["settings.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewGeneralSettings)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["audit.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewGeneralSettings)!)).toBe(false);
    const gorunur = menuyuIzneGoreSuz(PANEL_MENU, ["audit.view"]).find((m) => m.key === "ayarlar");
    expect(gorunur?.children?.map((c) => c.key)).toEqual(["denetim-kayitlari"]);
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewAuditLogs)).toEqual({ selectedKey: "denetim-kayitlari", openKeys: ["ayarlar"] });
  });
});
