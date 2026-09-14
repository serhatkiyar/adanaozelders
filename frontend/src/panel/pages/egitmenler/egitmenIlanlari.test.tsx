import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DURUM_ETIKETI, EgitmenIlanlari, ilanlariSirala } from "@/panel/pages/egitmenler/EgitmenIlanlari";
import { gerekceHatasi } from "@/panel/pages/egitmenler/EgitmenIlanPencereleri";
import { MESGUL_NEDENI } from "@/panel/components/varlikKilidi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useActivateTutor, useAdminTutors, useApproveTutor, useDeleteTutor, useRejectTutor, useSuspendTutor } from "@/hooks/useAdmin";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import { TutorStatus } from "@/types";
import type { TutorOut } from "@/types";

vi.mock("@/hooks/useAdmin", () => ({
  useActivateTutor: vi.fn(),
  useAdminTutors: vi.fn(),
  useApproveTutor: vi.fn(),
  useDeleteTutor: vi.fn(),
  useRejectTutor: vi.fn(),
  useSuspendTutor: vi.fn(),
}));

const m = { onay: vi.fn(), red: vi.fn(), pasif: vi.fn(), etkin: vi.fn(), sil: vi.fn() };
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const egitmen = (ek: Partial<TutorOut> = {}): TutorOut => ({
  id: 1, full_name: "Ayşe Yılmaz", email: "a@x.co", role_id: 2, is_active: true, created_at: "2026-01-01T00:00:00Z",
  status: TutorStatus.PENDING_APPROVAL, slug: "ayse-1", headline: "Matematik öğretmeni", hourly_rate: "250.00", avatar_url: null, ...ek,
} as TutorOut);
const LISTE: TutorOut[] = [
  egitmen({ id: 10, full_name: "Deniz Taslak", status: TutorStatus.DRAFT, headline: null, hourly_rate: null }),
  egitmen({ id: 11, full_name: "Ela Reddedilen", status: TutorStatus.REJECTED }),
  egitmen({ id: 12, full_name: "Can Pasif", status: TutorStatus.SUSPENDED }),
  egitmen({ id: 13, full_name: "Berk Yayında", status: TutorStatus.APPROVED, avatar_url: "https://x/a.jpg" }),
  egitmen({ id: 14, full_name: "Ayşe Bekleyen", status: TutorStatus.PENDING_APPROVAL }),
  egitmen({ id: 15, full_name: "Zeynep Bekleyen", status: TutorStatus.PENDING_APPROVAL }),
];
const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const son = (h: unknown) => vi.mocked(h as () => unknown).mock.calls.at(-1);

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}
function agac() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[PATHS.adminNewTutors]}>
          <Routes>
            <Route path={PATHS.adminNewTutors} element={<EgitmenIlanlari />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = () => render(agac());
const satir = (id: number) => within(screen.getByTestId(`ilan-${id}`));
const cekmece = () => [...document.querySelectorAll(".ant-drawer-open")].at(-1) as HTMLElement;
const cekmeceAcikMi = () => document.querySelector(".ant-drawer-open") !== null;
// AntD yükleniyor simgesi jsdom'da erişilebilir ada "loading" ekler; ad sonuna göre eşlenir.
const cekmeceDugmesi = (ad: string) => within(cekmece().querySelector(".ant-drawer-footer") as HTMLElement).getByRole("button", { name: new RegExp(`${ad}$`) });
const onayGorunur = () => [...document.querySelectorAll(".ant-modal-confirm")].some((x) => !x.classList.contains("ant-zoom-leave"));
const onayDugmesi = (ad: RegExp) => {
  const acik = [...document.querySelectorAll(".ant-modal-confirm")].filter((x) => !x.classList.contains("ant-zoom-leave"));
  return within(acik[acik.length - 1] as HTMLElement).getByRole("button", { name: ad });
};

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset().mockImplementation(ertelenmis);
  sozler.length = 0;
  vi.mocked(useAdminTutors).mockReset().mockReturnValue(sonuc(LISTE));
  vi.mocked(useApproveTutor).mockReturnValue({ mutateAsync: m.onay, isPending: false } as never);
  vi.mocked(useRejectTutor).mockReturnValue({ mutateAsync: m.red, isPending: false } as never);
  vi.mocked(useSuspendTutor).mockReturnValue({ mutateAsync: m.pasif, isPending: false } as never);
  vi.mocked(useActivateTutor).mockReturnValue({ mutateAsync: m.etkin, isPending: false } as never);
  vi.mocked(useDeleteTutor).mockReturnValue({ mutateAsync: m.sil, isPending: false } as never);
  izin("tutors.view", "tutors.manage", "users.view");
});

describe("saf kurallar", () => {
  it("durum sırası PENDING_APPROVAL → APPROVED → SUSPENDED → REJECTED → DRAFT; eşitlikte sunucu sırası korunur; etiketler ve gerekçe kuralı", () => {
    expect(ilanlariSirala(LISTE).map((t) => t.id)).toEqual([14, 15, 13, 12, 11, 10]);
    expect(Object.values(DURUM_ETIKETI)).toEqual(["Taslak", "Onay Bekliyor", "Yayında", "Reddedildi", "Pasif"]);
    expect(gerekceHatasi("")).toBe("Gerekçe en az 3 karakter olmalı.");
    expect(gerekceHatasi("   ")).toBe("Gerekçe en az 3 karakter olmalı.");
    expect(gerekceHatasi("ab")).toBe("Gerekçe en az 3 karakter olmalı.");
    expect(gerekceHatasi("abc")).toBeUndefined();
    expect(gerekceHatasi("a".repeat(500))).toBeUndefined();
    expect(gerekceHatasi("a".repeat(501))).toBe("En fazla 500 karakter yazılabilir.");
  });
});

describe("EgitmenIlanlari", () => {
  it("tutors.view yokken AccessDenied ve sorgu kapalı", () => {
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(useAdminTutors)).toEqual([false]);
  });

  it("view-only: liste görünür, salt okunur açıklaması var, yazma yüzeyleri DOM'da yok; boş ve hata durumunda da açıklama görünür", () => {
    izin("tutors.view");
    const a = kur();
    expect(son(useAdminTutors)).toEqual([true]);
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(satir(14).getByText("Ayşe Bekleyen")).toBeInTheDocument();
    for (const ad of [/Onayla/, /Reddet/, /Pasife al/, /Yayına al/, /Sil$/]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    a.unmount();
    vi.mocked(useAdminTutors).mockReturnValue(sonuc([]));
    const b = kur();
    expect(screen.getByText("Henüz ilan yok")).toBeInTheDocument();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    b.unmount();
    vi.mocked(useAdminTutors).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x") }));
    kur();
    expect(screen.getByText("İlanlar yüklenemedi.")).toBeInTheDocument();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
  });

  it("iki bölüm: onay kuyruğu önce ve sayaçlı, diğer ilanlar sonra; kuyruk boşsa başlık hiç basılmaz", () => {
    const a = kur();
    const bolumler = [...document.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"));
    expect(bolumler).toEqual(["Onay bekleyen eğitmenler", "Diğer ilanlar"]);
    const kuyruk = within(screen.getByRole("region", { name: "Onay bekleyen eğitmenler" }));
    expect(kuyruk.getByText("2")).toBeInTheDocument();
    expect(kuyruk.getByText(/Onay ilanı yayına alır; red gerekçesi denetim izine yazılır/)).toBeInTheDocument();
    expect(kuyruk.getByTestId("ilan-14")).toBeInTheDocument();
    expect(kuyruk.getByTestId("ilan-15")).toBeInTheDocument();
    expect(kuyruk.queryByTestId("ilan-13")).not.toBeInTheDocument();
    const digerleri = within(screen.getByRole("region", { name: "Diğer ilanlar" }));
    expect(digerleri.getByText(/^4 ilan ·/)).toBeInTheDocument();
    // Satır sırası: kuyruk + durum önceliği.
    expect([...document.querySelectorAll('[data-testid^="ilan-"]')].map((e) => e.getAttribute("data-testid"))).toEqual(["ilan-14", "ilan-15", "ilan-13", "ilan-12", "ilan-11", "ilan-10"]);
    a.unmount();
    vi.mocked(useAdminTutors).mockReturnValue(sonuc(LISTE.filter((t) => t.status !== TutorStatus.PENDING_APPROVAL)));
    kur();
    expect(screen.queryByRole("region", { name: "Onay bekleyen eğitmenler" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Diğer ilanlar" })).toBeInTheDocument();
  });

  it("satır alanları: ad gerçek tutor detay bağlantısı, avatar, başlık, saatlik ücret, durum etiketi; iç içe a/button yok", () => {
    kur();
    const s = satir(14);
    const link = s.getByRole("link", { name: "Ayşe Bekleyen" });
    expect(link).toHaveAttribute("href", ROUTES.adminNewCustomer("tutor", 14));
    expect(link.closest("button")).toBeNull();
    expect(within(screen.getByTestId("ilan-14")).getByText("Ayşe Bekleyen")).toBeInTheDocument();
    expect(s.getByText("Onay Bekliyor")).toBeInTheDocument();
    expect(s.getByText("Matematik öğretmeni")).toBeInTheDocument();
    expect(s.getByText("250 TL / saat")).toBeInTheDocument();
    expect(satir(13).getByRole("img", { name: "Berk Yayında" })).toHaveAttribute("src", "https://x/a.jpg");
    const taslak = satir(10);
    expect(taslak.getByText("Taslak")).toBeInTheDocument();
    expect(taslak.getByText("Ücret belirtilmemiş")).toBeInTheDocument();
    expect(document.querySelectorAll("a button, button a, a a, button button")).toHaveLength(0);
  });

  it("ad bağlantısı users.view iznine bağlı: izin varsa gerçek Link, yoksa aynı stille düz metin (ölü bağlantı yok)", () => {
    const a = kur();
    expect(satir(14).getByRole("link", { name: "Ayşe Bekleyen" })).toHaveAttribute("href", ROUTES.adminNewCustomer("tutor", 14));
    a.unmount();
    // tutors okuması sürüyor ama kullanıcı detayı izni yok: ad düz metin.
    izin("tutors.view", "tutors.manage");
    kur();
    expect(son(useAdminTutors)).toEqual([true]);
    expect(satir(14).queryByRole("link")).not.toBeInTheDocument();
    expect(satir(14).getByText("Ayşe Bekleyen")).toBeInTheDocument();
    expect(satir(14).getByRole("button", { name: /Onayla$/ })).toBeInTheDocument();
  });

  it("her statüde doğru aksiyonlar: bekleyen Onayla+Reddet, yayında Pasife al, pasif Yeniden etkinleştir; hepsinde Sil; reddedilen/taslakta yalnız Sil", () => {
    kur();
    const adlar = (id: number) => satir(id).getAllByRole("button").map((b) => b.textContent);
    expect(adlar(14)).toEqual(["Onayla", "Reddet", "Sil"]);
    expect(adlar(13)).toEqual(["Pasife al", "Sil"]);
    expect(adlar(12)).toEqual(["Yayına al", "Sil"]);
    expect(adlar(11)).toEqual(["Sil"]);
    expect(adlar(10)).toEqual(["Sil"]);
  });

  it("onay/pasif/etkinleştir gerçek payload; aynı tick çift tık tek istek; başarı ve hata mesajları; hata sonrası yeniden denenebilir", async () => {
    kur();
    fireEvent.click(satir(14).getByRole("button", { name: "Ayşe Bekleyen · Onayla" }));
    fireEvent.click(satir(14).getByRole("button", { name: /Onayla$/ }));
    expect(m.onay).toHaveBeenCalledTimes(1);
    expect(m.onay).toHaveBeenCalledWith(14);
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText("Ayşe Bekleyen onaylandı.")).toBeInTheDocument();
    fireEvent.click(satir(13).getByRole("button", { name: "Berk Yayında · Pasife al" }));
    expect(m.pasif).toHaveBeenCalledWith(13);
    await act(async () => { sozler.pop()!.rej({ response: { status: 500, data: { detail: "Sunucu hatası" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Sunucu hatası")).toBeInTheDocument();
    // Kilit bırakıldı: yeniden denenebilir.
    await waitFor(() => expect(satir(13).getByRole("button", { name: /Pasife al$/ })).toBeEnabled());
    fireEvent.click(satir(13).getByRole("button", { name: /Pasife al$/ }));
    expect(m.pasif).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText("İlan yayından kaldırıldı.")).toBeInTheDocument();
    fireEvent.click(satir(12).getByRole("button", { name: "Can Pasif · Yayına al" }));
    expect(m.etkin).toHaveBeenCalledWith(12);
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText("İlan yeniden yayında.")).toBeInTheDocument();
  });

  it("silme onayı: sabit hedef, çift onay tek istek, pending'de Vazgeç kapatmaz, hata modalı açık bırakır, yeniden deneme başarır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(satir(11).getByRole("button", { name: "Ela Reddedilen · Sil" }));
    expect(await screen.findByText("Ela Reddedilen ilanı kalıcı olarak silinecek.")).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/İlanı sil/));
    expect(m.sil).toHaveBeenCalledTimes(1);
    expect(m.sil).toHaveBeenCalledWith(11);
    await u.click(onayDugmesi(/Vazgeç/));
    expect(onayGorunur()).toBe(true);
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Aktif dersi var" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Aktif dersi var")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/İlanı sil/)).not.toHaveClass("ant-btn-loading"));
    await u.click(onayDugmesi(/İlanı sil/));
    expect(m.sil).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText("İlan silindi.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
  });

  it("varlık kilidi: aynı eğitmende onay sürerken red/sil kapalı ve nedenli; farklı eğitmenler paralel; bitince bırakılır", async () => {
    kur();
    fireEvent.click(satir(14).getByRole("button", { name: /Onayla$/ }));
    expect(satir(14).getByRole("button", { name: /Onayla$/ })).toHaveClass("ant-btn-loading");
    for (const ad of [/Reddet$/, /Sil$/]) {
      const d = satir(14).getByRole("button", { name: ad });
      expect(d).toBeDisabled();
      expect(d).toHaveAttribute("title", MESGUL_NEDENI);
    }
    // Farklı eğitmen bloklanmaz.
    expect(satir(15).getByRole("button", { name: /Onayla$/ })).toBeEnabled();
    fireEvent.click(satir(15).getByRole("button", { name: /Onayla$/ }));
    expect(m.onay).toHaveBeenCalledTimes(2);
    expect(m.onay).toHaveBeenLastCalledWith(15);
    await act(async () => { sozler.shift()!.res(undefined); await Promise.resolve(); });
    await waitFor(() => expect(satir(14).getByRole("button", { name: /Sil$/ })).toBeEnabled());
    expect(satir(15).getByRole("button", { name: /Sil$/ })).toBeDisabled();
    await act(async () => { sozler.shift()!.res(undefined); await Promise.resolve(); });
    await waitFor(() => expect(satir(15).getByRole("button", { name: /Sil$/ })).toBeEnabled());
  });

  it("red penceresi: doğrulama alanda ve düğme kapanmaz, payload, temiz/kirli/pending kapanış, 422 alan hatası, genel hata, gerekçe korunur", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(satir(14).getByRole("button", { name: /Reddet$/ }));
    expect(await screen.findByText("Başvuruyu reddet", { selector: ".ant-drawer-title" })).toBeInTheDocument();
    expect(screen.getByText(/Ayşe Bekleyen başvurusu reddedilecek/)).toBeInTheDocument();
    // Temiz kapanış doğrudan.
    await u.click(cekmeceDugmesi("Vazgeç"));
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(onayGorunur()).toBe(false);
    await u.click(satir(14).getByRole("button", { name: /Reddet$/ }));
    await u.click(cekmeceDugmesi("Başvuruyu reddet"));
    expect(m.red).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Gerekçe en az 3 karakter olmalı.");
    expect(cekmeceDugmesi("Başvuruyu reddet")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Red gerekçesi"), { target: { value: "  ab  " } });
    await u.click(cekmeceDugmesi("Başvuruyu reddet"));
    expect(m.red).not.toHaveBeenCalled();
    // Kirli kapanış onay ister.
    await u.click(cekmeceDugmesi("Vazgeç"));
    expect((await screen.findAllByText("Kaydedilmemiş değişiklikler var")).length).toBeGreaterThan(0);
    await u.click(screen.getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(cekmeceAcikMi()).toBe(true);
  });

  it("red penceresi: payload trim'li, aynı tick tek istek, pending'de kapanmaz, 422 alanda + genel hata, gerekçe korunur, başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(satir(14).getByRole("button", { name: /Reddet$/ }));
    await screen.findByText("Başvuruyu reddet", { selector: ".ant-drawer-title" });
    fireEvent.change(screen.getByLabelText("Red gerekçesi"), { target: { value: "  Diploma doğrulanamadı  " } });
    await u.dblClick(cekmeceDugmesi("Başvuruyu reddet"));
    expect(m.red).toHaveBeenCalledTimes(1);
    expect(m.red).toHaveBeenCalledWith({ id: 14, reason: "Diploma doğrulanamadı" });
    // Pending'de kapanmaz.
    await u.click(cekmeceDugmesi("Vazgeç"));
    expect(cekmeceAcikMi()).toBe(true);
    await act(async () => { sozler.pop()!.rej({ response: { status: 422, data: { detail: [{ loc: ["body", "reason"], msg: "Gerekçe çok kısa" }, { loc: ["body", "status"], msg: "Durum uygun değil" }] } } }); await Promise.resolve(); });
    expect(await screen.findByText("Gerekçe çok kısa")).toBeInTheDocument();
    expect(screen.getByText("Durum uygun değil")).toBeInTheDocument();
    // Hata sonrası gerekçe korunur; alan değişince yalnız o alanın bayat hatası silinir.
    expect(screen.getByLabelText("Red gerekçesi")).toHaveValue("  Diploma doğrulanamadı  ");
    fireEvent.change(screen.getByLabelText("Red gerekçesi"), { target: { value: "Diploma doğrulanamadı 2" } });
    expect(screen.queryByText("Gerekçe çok kısa")).not.toBeInTheDocument();
    expect(screen.getByText("Durum uygun değil")).toBeInTheDocument();
    await u.click(cekmeceDugmesi("Başvuruyu reddet"));
    expect(m.red).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Durum uygun değil")).not.toBeInTheDocument();
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Ayşe Bekleyen reddedildi.")).toBeInTheDocument();
  });

  it("red: 422 dışı hata pencerede genel Alert olarak kalır ve yeniden denenebilir", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(satir(15).getByRole("button", { name: /Reddet$/ }));
    fireEvent.change(await screen.findByLabelText("Red gerekçesi"), { target: { value: "Belge eksik" } });
    await u.click(cekmeceDugmesi("Başvuruyu reddet"));
    expect(m.red).toHaveBeenCalledWith({ id: 15, reason: "Belge eksik" });
    await act(async () => { sozler.pop()!.rej({ response: { status: 403, data: { detail: "Yetkin yok" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Yetkin yok")).toBeInTheDocument();
    expect(cekmeceAcikMi()).toBe(true);
    expect(screen.getByLabelText("Red gerekçesi")).toHaveValue("Belge eksik");
    await u.click(cekmeceDugmesi("Başvuruyu reddet"));
    expect(m.red).toHaveBeenCalledTimes(2);
  });

  it("yükleniyor / hata + yalnız kendi refetch'i / boş durum ayrı; boşta uydurma aksiyon yok", async () => {
    vi.mocked(useAdminTutors).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByText("İlanlar yükleniyor…")).toBeInTheDocument();
    a.unmount();
    const refetch = vi.fn();
    vi.mocked(useAdminTutors).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Liste çöktü" } } }, refetch }));
    const b = kur();
    expect(screen.getByText("Liste çöktü")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Eğitmen ilanları" })).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Liste çöktü").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    b.unmount();
    vi.mocked(useAdminTutors).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Henüz ilan yok")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ekle/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Onay bekleyen eğitmenler" })).not.toBeInTheDocument();
    // Üç durum da aynı kart iskeletinde: veri gelince çerçeve birden belirmez.
    expect(screen.getByRole("region", { name: "Eğitmen ilanları" })).toBeInTheDocument();
  });

  it("rota, menü grubu ve yer tutucular, izin, selectedKey/openKeys", () => {
    expect(PATHS.adminNewTutors).toBe("/yonetim-yeni/egitmenler");
    expect(ROUTES.adminNewTutors).toBe(PATHS.adminNewTutors);
    const grup = PANEL_MENU.find((g) => g.key === "egitmenler");
    expect(grup?.requiredPermission).toBeUndefined();
    expect(grup?.children?.map((c) => c.label)).toEqual(["İlanlar", "Ön Başvurular", "Diploma Doğrulama", "Öne Çıkarmalar"]);
    // Eğitmenler grubunun dört yaprağının da gerçek rotası var; yer tutucu kalmadı.
    expect(grup?.children?.map((c) => Boolean(c.path))).toEqual([true, true, true, true]);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewTutors)).toMatchObject({ label: "İlanlar", requiredPermission: "tutors" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewTutors)).toEqual({ selectedKey: "egitmenler-ilanlar", openKeys: ["egitmenler"] });
    expect(izinBeyaniniKarsilarMi(["tutors.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewTutors)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewTutors)!)).toBe(false);
  });
});
