import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DagitimKuryeler, MESGUL_NEDENI, kapaliGunAciklamasi, kapasiteMetni } from "@/panel/pages/dagitim/DagitimKuryeler";
import { adSoyadBol, sunucuHatasiniDagit } from "@/panel/pages/dagitim/KuryePencereleri";
import { hesapSemasi, kuryeSemasi, sifreSemasi, zodAlanHatalari } from "@/components/admin/kuryeSemalari";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import {
  useAddClosedDay,
  useCapacityOverview,
  useCloseCourierAccount,
  useClosedDays,
  useCourierAccount,
  useCouriers,
  useCreateCourier,
  useCreateCourierAccount,
  useDeleteCourier,
  useDeliveryInfo,
  useRemoveClosedDay,
  useResetCourierPassword,
  useSeedHolidays,
  useUpdateCourier,
  useUploadCourierPhoto,
} from "@/hooks/useDelivery";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { ClosedDay, Courier } from "@/types";

vi.mock("@/hooks/useDelivery", () => ({
  useAddClosedDay: vi.fn(),
  useCapacityOverview: vi.fn(),
  useCloseCourierAccount: vi.fn(),
  useClosedDays: vi.fn(),
  useCourierAccount: vi.fn(),
  useCouriers: vi.fn(),
  useCreateCourier: vi.fn(),
  useCreateCourierAccount: vi.fn(),
  useDeleteCourier: vi.fn(),
  useDeliveryInfo: vi.fn(),
  useRemoveClosedDay: vi.fn(),
  useResetCourierPassword: vi.fn(),
  useSeedHolidays: vi.fn(),
  useUpdateCourier: vi.fn(),
  useUploadCourierPhoto: vi.fn(),
}));

const m = { olustur: vi.fn(), guncelle: vi.fn(), sil: vi.fn(), foto: vi.fn(), hesapOlustur: vi.fn(), hesapKapat: vi.fn(), sifre: vi.fn(), gunEkle: vi.fn(), gunAc: vi.fn(), tatil: vi.fn() };
// Şifre taşıyan mutation'ların `reset()`i: settled sonrası çağrılmalı (observer/cache kopyası silinsin).
const sifirla = { hesapOlustur: vi.fn(), sifre: vi.fn() };
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const kurye = (ek: Partial<Courier> = {}): Courier => ({ id: 1, name: "Arif Kıyar", phone: "5398796369", photo_url: null, is_active: true, ...ek });
const KURYELER = [kurye(), kurye({ id: 2, name: "Test Kurye", phone: null, is_active: false, photo_url: "https://x/f.jpg" })];
const GUNLER: ClosedDay[] = [
  { id: 10, day: "2026-10-29", label: null, source: "holiday" },
  { id: 11, day: "2026-11-05", label: "Yıllık bakım", source: "manual" },
  { id: 12, day: "2026-11-06", label: null, source: "manual" },
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
        <MemoryRouter initialEntries={[PATHS.adminNewDeliveryCouriers]}>
          <Routes>
            <Route path={PATHS.adminNewDeliveryCouriers} element={<DagitimKuryeler />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = () => render(agac());
const cekmece = () => {
  const acik = [...document.querySelectorAll(".ant-drawer-open")];
  return acik[acik.length - 1] as HTMLElement;
};
const cekmeceAcikMi = () => document.querySelector(".ant-drawer-open") !== null;
// AntD yükleniyor simgesi jsdom'da erişilebilir ada "loading" ekler; ad sonuna göre eşlenir.
const cekmeceDugmesi = (ad: string) => within(cekmece().querySelector(".ant-drawer-footer") as HTMLElement).getByRole("button", { name: new RegExp(`${ad}$`) });
const onayGorunur = () => [...document.querySelectorAll(".ant-modal-confirm")].some((x) => !x.classList.contains("ant-zoom-leave") && (x.closest(".ant-modal-wrap") as HTMLElement | null)?.style.display !== "none");
const onayDugmesi = (ad: RegExp) => {
  const acik = [...document.querySelectorAll(".ant-modal-confirm")].filter((x) => !x.classList.contains("ant-zoom-leave"));
  return within(acik[acik.length - 1] as HTMLElement).getByRole("button", { name: ad });
};
const satir = (id: number) => within(screen.getByTestId(`kurye-${id}`));
const dugme = (ad: string, kapsam: ReturnType<typeof within> = screen) => kapsam.getByRole("button", { name: new RegExp(`${ad}$`) });

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset().mockImplementation(ertelenmis);
  sozler.length = 0;
  vi.mocked(useCouriers).mockReset().mockReturnValue(sonuc(KURYELER));
  vi.mocked(useClosedDays).mockReset().mockReturnValue(sonuc(GUNLER));
  vi.mocked(useDeliveryInfo).mockReset().mockReturnValue(sonuc({ cutoff_hour: 16, promised_date_now: "2026-09-13", districts: ["Seyhan", "Yüreğir"] }));
  vi.mocked(useCapacityOverview).mockReset().mockReturnValue(sonuc([{ day: "2026-09-13", capacity: 30, booked: 4, retry_debt: 0, is_working_day: true }]));
  vi.mocked(useCourierAccount).mockReset().mockReturnValue(sonuc(null));
  vi.mocked(useCreateCourier).mockReturnValue({ mutateAsync: m.olustur, isPending: false } as never);
  vi.mocked(useUpdateCourier).mockReturnValue({ mutateAsync: m.guncelle, isPending: false } as never);
  vi.mocked(useDeleteCourier).mockReturnValue({ mutateAsync: m.sil, isPending: false } as never);
  vi.mocked(useUploadCourierPhoto).mockReturnValue({ mutateAsync: m.foto, isPending: false } as never);
  sifirla.hesapOlustur.mockReset();
  sifirla.sifre.mockReset();
  vi.mocked(useCreateCourierAccount).mockReturnValue({ mutateAsync: m.hesapOlustur, isPending: false, reset: sifirla.hesapOlustur } as never);
  vi.mocked(useCloseCourierAccount).mockReturnValue({ mutateAsync: m.hesapKapat, isPending: false } as never);
  vi.mocked(useResetCourierPassword).mockReturnValue({ mutateAsync: m.sifre, isPending: false, reset: sifirla.sifre } as never);
  vi.mocked(useAddClosedDay).mockReturnValue({ mutateAsync: m.gunEkle, isPending: false } as never);
  vi.mocked(useRemoveClosedDay).mockReturnValue({ mutateAsync: m.gunAc, isPending: false } as never);
  vi.mocked(useSeedHolidays).mockReturnValue({ mutateAsync: m.tatil, isPending: false } as never);
  izin("delivery.view", "delivery.manage");
});

describe("saf kurallar", () => {
  it("kapalı gün açıklaması, kapasite metni, ad-soyad bölme, 422 dağıtımı (yalnız kendi alanları)", () => {
    expect(kapaliGunAciklamasi(GUNLER[0])).toBe("Resmî tatil");
    expect(kapaliGunAciklamasi(GUNLER[1])).toBe("Yıllık bakım");
    expect(kapaliGunAciklamasi(GUNLER[2])).toBe("Kapalı");
    expect(kapasiteMetni(30)).toBe("30 sipariş");
    expect(kapasiteMetni(0)).toBe("sınırsız");
    expect(adSoyadBol("Arif Can Kıyar")).toEqual({ first_name: "Arif Can", last_name: "Kıyar" });
    expect(adSoyadBol("Arif")).toEqual({ first_name: "Arif", last_name: "" });
    expect(sunucuHatasiniDagit({ response: { status: 422, data: { detail: [{ loc: ["body", "email"], msg: "E-posta kullanımda" }, { loc: ["body", "constructor"], msg: "x" }] } } }, "v", ["email", "password"])).toEqual({ alan: { email: "E-posta kullanımda" }, genel: "x" });
    expect(sunucuHatasiniDagit({ response: { status: 409, data: { detail: "Çakışma" } } }, "v", ["email"])).toEqual({ alan: {}, genel: "Çakışma" });
  });

  it("zod sözleşmesi eski CourierManager ile ortak: ad trim ≥2, telefon serbest, ad/soyad zorunlu, zod e-posta, şifre ≥8", () => {
    expect(zodAlanHatalari(kuryeSemasi.safeParse({ name: " A ", phone: "" }))).toEqual({ name: "İsim en az 2 karakter olmalı." });
    expect(kuryeSemasi.safeParse({ name: "  Zeynep  ", phone: " 0555 " })).toMatchObject({ success: true, data: { name: "Zeynep", phone: " 0555 " } });
    expect(zodAlanHatalari(hesapSemasi.safeParse({ first_name: " ", last_name: "", email: "arif@example", password: "1234567" }))).toEqual({
      first_name: "Ad gerekli.",
      last_name: "Soyad gerekli.",
      email: "Geçerli bir e-posta girin.",
      password: "Şifre en az 8 karakter olmalı.",
    });
    // Elle yazılmış gevşek regex'in kabul edeceği, zod'un reddettiği biçim: yaklaşık doğrulama yok.
    expect(hesapSemasi.safeParse({ first_name: "A", last_name: "B", email: "a..b@x.com", password: "12345678" }).success).toBe(false);
    expect(hesapSemasi.safeParse({ first_name: "A", last_name: "B", email: "  Arif@Example.COM ", password: "12345678" })).toMatchObject({ success: true, data: { email: "Arif@Example.COM" } });
    expect(zodAlanHatalari(sifreSemasi.safeParse({ password: "kisa" }))).toEqual({ password: "Şifre en az 8 karakter olmalı." });
  });
});

describe("DagitimKuryeler", () => {
  it("delivery.view yokken AccessDenied ve bütün GET'ler kapalı; hesap sorgusu hiç çıkmaz", () => {
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(useCouriers)).toEqual([false]);
    expect(son(useClosedDays)).toEqual([false]);
    expect(son(useDeliveryInfo)).toEqual([false]);
    expect(son(useCapacityOverview)).toEqual([14, false]);
    expect(vi.mocked(useCourierAccount)).not.toHaveBeenCalled();
  });

  it("view-only: üç bölüm görünür; yazma/hesap/fotoğraf/takvim yazma yüzeyleri yok; hesap sorgusu çıkmaz", () => {
    izin("delivery.view");
    kur();
    expect(screen.getByRole("heading", { name: "Kuryeler" })).toBeInTheDocument();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByText("Arif Kıyar")).toBeInTheDocument();
    expect(screen.getByText("5398796369")).toBeInTheDocument();
    expect(screen.getByText("pasif")).toBeInTheDocument();
    expect(screen.getByText(/29 Ekim 2026/)).toBeInTheDocument();
    expect(screen.getByText("16:00")).toBeInTheDocument();
    for (const ad of ["Kurye ekle", "Fotoğraf", "Hesap", "Düzenle", "Pasifleştir", "Aktifleştir", "Sil", "Resmî tatilleri yükle", "Günü kapat", /Yeniden aç/]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Kapatılacak gün")).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
    expect(vi.mocked(useCourierAccount)).not.toHaveBeenCalled();
    expect(son(useCouriers)).toEqual([true]);
  });

  it("kurye listesi: yükleniyor, hata + yalnız kendi refetch'i, boş (manage'de Kurye ekle), dolu satır alanları; iç içe a/button yok", async () => {
    vi.mocked(useCouriers).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByText("Kuryeler yükleniyor…")).toBeInTheDocument();
    a.unmount();
    const refetch = vi.fn();
    vi.mocked(useCouriers).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Kurye servisi çöktü" } } }, refetch }));
    const b = kur();
    expect(screen.getByText("Kurye servisi çöktü")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Kurye servisi çöktü").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useClosedDays).mock.results.at(-1)?.value.refetch).not.toHaveBeenCalled();
    b.unmount();
    vi.mocked(useCouriers).mockReturnValue(sonuc([]));
    const c = kur();
    expect(screen.getByText("Henüz kurye yok")).toBeInTheDocument();
    // Boş listede tek aksiyon: yalnız boş durumun içinde; başlıkta düğme yok.
    const bosDugmeler = screen.getAllByRole("button", { name: "Kurye ekle" });
    expect(bosDugmeler).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Kurye profilleri" })).getByRole("button", { name: "Kurye ekle" })).toBe(bosDugmeler[0]);
    await userEvent.click(bosDugmeler[0]);
    expect(await screen.findByText("Kurye ekle", { selector: ".ant-drawer-title" })).toBeInTheDocument();
    c.unmount();
    vi.mocked(useCouriers).mockReturnValue(sonuc(KURYELER));
    kur();
    // Dolu listede tek aksiyon: yalnız başlıkta; aynı çekmeceyi açar.
    const doluDugmeler = screen.getAllByRole("button", { name: "Kurye ekle" });
    expect(doluDugmeler).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Kurye profilleri" })).queryByRole("button", { name: "Kurye ekle" })).not.toBeInTheDocument();
    await userEvent.click(doluDugmeler[0]);
    expect(await screen.findByText("Kurye ekle", { selector: ".ant-drawer-title" })).toBeInTheDocument();
    const s1 = satir(1);
    expect(s1.getByText("Arif Kıyar")).toBeInTheDocument();
    expect(s1.getByText("5398796369")).toBeInTheDocument();
    expect(s1.getByText("A")).toBeInTheDocument();
    for (const ad of ["Fotoğraf", "Hesap", "Düzenle", "Pasifleştir", "Sil"]) expect(s1.getByRole("button", { name: ad })).toBeInTheDocument();
    const s2 = satir(2);
    expect(s2.getByText("-")).toBeInTheDocument();
    expect(s2.getByText("pasif")).toBeInTheDocument();
    expect(s2.getByRole("img", { name: "Test Kurye" })).toHaveAttribute("src", "https://x/f.jpg");
    expect(s2.getByRole("button", { name: "Aktifleştir" })).toBeInTheDocument();
    expect(screen.getByLabelText("Arif Kıyar için vesikalık dosyası")).toBeInTheDocument();
    expect(document.querySelectorAll("a button, button a, a a, button button")).toHaveLength(0);
    // Hesap sorgusu satır başına otomatik çıkmaz.
    expect(vi.mocked(useCourierAccount)).not.toHaveBeenCalled();
  });

  it("kurye oluşturma: doğrulama (ad ≥2, ilk hatalı alana odak), payload (telefon boş → null), aynı tick tek istek, 422 alan/genel ayrımı, girdi korunur, başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(screen.getByRole("button", { name: "Kurye ekle" }));
    expect(await screen.findByText("Kurye ekle", { selector: ".ant-drawer-title" })).toBeInTheDocument();
    await u.click(cekmeceDugmesi("Ekle"));
    expect(m.olustur).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("İsim en az 2 karakter olmalı.");
    expect(screen.getByLabelText("Kurye adı")).toHaveFocus();
    await u.type(screen.getByLabelText("Kurye adı"), "  Zeynep Kaya  ");
    await u.dblClick(cekmeceDugmesi("Ekle"));
    expect(m.olustur).toHaveBeenCalledTimes(1);
    // BİLİNÇLİ FARK: eski satır içi form yalnız `{ name }` gönderiyordu; backend CourierCreate.phone desteklediği için
    // yeni pencere oluşturmada telefonu da alır (`phone: null` boş demektir).
    expect(m.olustur).toHaveBeenCalledWith({ name: "Zeynep Kaya", phone: null });
    // Pending'de kapatma yutulur.
    await u.click(cekmeceDugmesi("Vazgeç"));
    expect(cekmeceAcikMi()).toBe(true);
    await act(async () => { sozler.pop()!.rej({ response: { status: 422, data: { detail: [{ loc: ["body", "name"], msg: "Bu isim zaten var" }, { loc: ["body", "role"], msg: "Rol geçersiz" }] } } }); await Promise.resolve(); });
    expect(await screen.findByText("Bu isim zaten var")).toBeInTheDocument();
    expect(screen.getByText("Rol geçersiz")).toBeInTheDocument();
    expect(screen.getByLabelText("Kurye adı")).toHaveValue("  Zeynep Kaya  ");
    expect(screen.getByLabelText("Kurye adı")).toHaveFocus();
    // Alanı değiştirince yalnız o alanın sunucu hatası silinir; genel hata yeni gönderime kadar kalır.
    await u.type(screen.getByLabelText("Kurye adı"), "!");
    expect(screen.queryByText("Bu isim zaten var")).not.toBeInTheDocument();
    expect(screen.getByText("Rol geçersiz")).toBeInTheDocument();
    await u.type(screen.getByLabelText("Telefon (isteğe bağlı)"), " 0555 ");
    await u.click(cekmeceDugmesi("Ekle"));
    expect(m.olustur).toHaveBeenLastCalledWith({ name: "Zeynep Kaya  !", phone: "0555" });
    // Yeni gönderim başlarken genel hata silinir; bayat 422 geri gelmez.
    expect(screen.queryByText("Rol geçersiz")).not.toBeInTheDocument();
    expect(screen.queryByText("Bu isim zaten var")).not.toBeInTheDocument();
    await act(async () => { sozler.pop()!.res(kurye({ id: 9 })); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Kurye eklendi.")).toBeInTheDocument();
  });

  it("kurye düzenleme: pencere mevcut değerlerle açılır, temiz kapanır, kirli kapatma onay ister, payload sabit hedefe gider, 409 pencerede kalır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(satir(1).getByRole("button", { name: "Düzenle" }));
    expect(await screen.findByText("Kuryeyi düzenle")).toBeInTheDocument();
    expect(screen.getByLabelText("Kurye adı")).toHaveValue("Arif Kıyar");
    expect(screen.getByLabelText("Telefon (isteğe bağlı)")).toHaveValue("5398796369");
    await u.click(cekmeceDugmesi("Vazgeç"));
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    await u.click(satir(1).getByRole("button", { name: "Düzenle" }));
    await u.clear(await screen.findByLabelText("Telefon (isteğe bağlı)"));
    await u.click(cekmeceDugmesi("Vazgeç"));
    expect((await screen.findAllByText("Kaydedilmemiş değişiklikler var")).length).toBeGreaterThan(0);
    await u.click(screen.getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(cekmeceAcikMi()).toBe(true);
    await u.click(cekmeceDugmesi("Kaydet"));
    expect(m.guncelle).toHaveBeenCalledWith({ courierId: 1, payload: { name: "Arif Kıyar", phone: null } });
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Kurye şu an turda" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Kurye şu an turda")).toBeInTheDocument();
    expect(cekmeceAcikMi()).toBe(true);
    await u.click(cekmeceDugmesi("Kaydet"));
    expect(m.guncelle).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(kurye()); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
  });

  it("aktif/pasif, silme onayı (sabit hedef, çift onay tek istek, hata açık kalır) ve fotoğraf yükleme birbirinden bağımsız", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    fireEvent.click(satir(1).getByRole("button", { name: "Pasifleştir" }));
    fireEvent.click(satir(1).getByRole("button", { name: /Pasifleştir/ }));
    expect(m.guncelle).toHaveBeenCalledTimes(1);
    expect(m.guncelle).toHaveBeenCalledWith({ courierId: 1, payload: { is_active: false } });
    // Diğer satırın aktifleştirmesi kilitlenmez.
    fireEvent.click(satir(2).getByRole("button", { name: "Aktifleştir" }));
    expect(m.guncelle).toHaveBeenLastCalledWith({ courierId: 2, payload: { is_active: true } });
    // Aynı kuryede aktif/pasif sürerken fotoğraf yüklemesi çıkmaz (varlık meşgul, neden görünür); bitince çıkar.
    const dosya = new File(["x"], "foto.png", { type: "image/png" });
    await u.upload(screen.getByLabelText("Arif Kıyar için vesikalık dosyası"), dosya);
    expect(m.foto).not.toHaveBeenCalled();
    expect(await screen.findByText(MESGUL_NEDENI)).toBeInTheDocument();
    await act(async () => { sozler.shift()!.res(kurye({ is_active: false })); await Promise.resolve(); });
    await waitFor(() => expect(satir(1).getByRole("button", { name: "Sil" })).toBeEnabled());
    await u.upload(screen.getByLabelText("Arif Kıyar için vesikalık dosyası"), dosya);
    await waitFor(() => expect(m.foto).toHaveBeenCalledWith({ courierId: 1, file: dosya }));
    // Silme onayı: 2. kuryenin aktifleştirmesi bitince Sil açılır.
    await act(async () => { sozler.shift()!.res(kurye({ id: 2, is_active: true })); await Promise.resolve(); });
    await waitFor(() => expect(satir(2).getByRole("button", { name: "Sil" })).toBeEnabled());
    await u.click(satir(2).getByRole("button", { name: "Sil" }));
    expect(await screen.findByText("Test Kurye kurye profili silinecek.")).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/Kuryeyi sil/));
    expect(m.sil).toHaveBeenCalledTimes(1);
    expect(m.sil).toHaveBeenCalledWith(2);
    await u.click(onayDugmesi(/Vazgeç/));
    expect(onayGorunur()).toBe(true);
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Kuryenin açık turu var" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Kuryenin açık turu var")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/Kuryeyi sil/)).not.toHaveClass("ant-btn-loading"));
    await u.click(onayDugmesi(/Kuryeyi sil/));
    expect(m.sil).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText("Kurye silindi.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
  });

  it("varlık kilidi: aynı kuryede fotoğraf sürerken düzenle/pasif/sil/hesap oluştur kapalı (görünür neden) ve dosya seçici açılmaz; başka kurye paralel; bitince bırakılır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    const tikla = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    kur();
    await u.click(satir(1).getByRole("button", { name: "Hesap" }));
    fireEvent.click(satir(1).getByRole("button", { name: "Fotoğraf" }));
    expect(tikla).toHaveBeenCalledTimes(1);
    const dosya = new File(["x"], "foto.png", { type: "image/png" });
    await u.upload(screen.getByLabelText("Arif Kıyar için vesikalık dosyası"), dosya);
    await waitFor(() => expect(m.foto).toHaveBeenCalledTimes(1));
    // Kendi düğmesi loading; aynı kuryenin diğer yazma düğmeleri kapalı ve nedenli.
    expect(satir(1).getByRole("button", { name: /Fotoğraf$/ })).toHaveClass("ant-btn-loading");
    for (const ad of ["Düzenle", "Pasifleştir", "Sil", "Hesap oluştur"]) {
      const d = satir(1).getByRole("button", { name: ad });
      expect(d).toBeDisabled();
      expect(d).toHaveAttribute("title", MESGUL_NEDENI);
    }
    // Hesap yüzeyini açıp kapamak okuma işlemidir: kilitten bağımsız.
    expect(satir(1).getByRole("button", { name: "Hesap" })).toBeEnabled();
    // Kilitliyken dosya seçici yeniden açılmaz.
    fireEvent.click(satir(1).getByRole("button", { name: /Fotoğraf$/ }));
    expect(tikla).toHaveBeenCalledTimes(1);
    // Farklı kurye bloklanmaz: paralel istek çıkar.
    expect(satir(2).getByRole("button", { name: "Sil" })).toBeEnabled();
    fireEvent.click(satir(2).getByRole("button", { name: "Aktifleştir" }));
    expect(m.guncelle).toHaveBeenCalledWith({ courierId: 2, payload: { is_active: true } });
    expect(satir(2).getByRole("button", { name: /Aktifleştir/ })).toHaveClass("ant-btn-loading");
    expect(satir(2).getByRole("button", { name: "Düzenle" })).toBeDisabled();
    // Fotoğraf hatayla bitince kurye 1 kilidi kesin bırakılır; kurye 2 hâlâ meşgul.
    await act(async () => { sozler.shift()!.rej({ response: { status: 413, data: { detail: "Dosya çok büyük" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Dosya çok büyük")).toBeInTheDocument();
    await waitFor(() => expect(satir(1).getByRole("button", { name: "Sil" })).toBeEnabled());
    expect(satir(1).getByRole("button", { name: "Düzenle" })).not.toHaveAttribute("title");
    expect(satir(2).getByRole("button", { name: "Düzenle" })).toBeDisabled();
    await act(async () => { sozler.shift()!.res(kurye({ id: 2, is_active: true })); await Promise.resolve(); });
    await waitFor(() => expect(satir(2).getByRole("button", { name: "Düzenle" })).toBeEnabled());
    tikla.mockRestore();
  });

  it("varlık kilidi: düzenleme gönderimi sürerken aynı kuryede sil/pasif kapalı; bitince açılır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(satir(1).getByRole("button", { name: "Düzenle" }));
    await u.type(await screen.findByLabelText("Kurye adı"), "!");
    await u.click(cekmeceDugmesi("Kaydet"));
    expect(m.guncelle).toHaveBeenCalledTimes(1);
    expect(satir(1).getByRole("button", { name: "Sil" })).toBeDisabled();
    expect(satir(1).getByRole("button", { name: /Düzenle$/ })).toHaveClass("ant-btn-loading");
    await act(async () => { sozler.shift()!.res(kurye()); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    await waitFor(() => expect(satir(1).getByRole("button", { name: "Sil" })).toBeEnabled());
  });

  it("varlık kilidi: aynı hesapta şifre sıfırlama sürerken hesabı kapat kapalı, ters yönde de; kurye profili düğmeleri etkilenmez", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    vi.mocked(useCourierAccount).mockReturnValue(sonuc({ id: 50, email: "arif@example.com", first_name: "Arif", last_name: "Kıyar", is_active: true, courier_id: 1, created_at: "" }));
    kur();
    await u.click(satir(1).getByRole("button", { name: "Hesap" }));
    await u.click(satir(1).getByRole("button", { name: "Şifre sıfırla" }));
    await u.type(await screen.findByLabelText("Yeni şifre"), "yeniSifre99");
    await u.click(cekmeceDugmesi("Şifreyi kaydet"));
    expect(m.sifre).toHaveBeenCalledTimes(1);
    expect(satir(1).getByRole("button", { name: "Hesabı kapat" })).toBeDisabled();
    expect(satir(1).getByRole("button", { name: "Hesabı kapat" })).toHaveAttribute("title", MESGUL_NEDENI);
    expect(satir(1).getByRole("button", { name: /Şifre sıfırla$/ })).toHaveClass("ant-btn-loading");
    // Kurye profili ayrı varlık: düzenle/sil açık kalır.
    expect(satir(1).getByRole("button", { name: "Sil" })).toBeEnabled();
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    await waitFor(() => expect(satir(1).getByRole("button", { name: "Hesabı kapat" })).toBeEnabled());
    // Ters yön: kapatma onayı sürerken şifre sıfırla kapalı; hata sonrası bırakılır, onay açık kalır.
    await u.click(satir(1).getByRole("button", { name: "Hesabı kapat" }));
    await u.click(onayDugmesi(/Hesabı kapat/));
    expect(m.hesapKapat).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(satir(1).getByRole("button", { name: /Şifre sıfırla$/ })).toBeDisabled());
    expect(satir(1).getByRole("button", { name: /Şifre sıfırla$/ })).toHaveAttribute("title", MESGUL_NEDENI);
    await act(async () => { sozler.pop()!.rej({ response: { status: 500, data: { detail: "Sunucu hatası" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Sunucu hatası")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(satir(1).getByRole("button", { name: /Şifre sıfırla$/ })).toBeEnabled());
  });

  it("hesap sorgusu yalnız açık satırda ve manage ile; hesap yok → oluşturma penceresi (ad/soyad türetilir, e-posta trim+lowercase, şifre ≥8, autoComplete=new-password); 422 e-posta alanda; başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    expect(vi.mocked(useCourierAccount)).not.toHaveBeenCalled();
    await u.click(satir(1).getByRole("button", { name: "Hesap" }));
    expect(son(useCourierAccount)).toEqual([1, true]);
    expect(vi.mocked(useCourierAccount).mock.calls.every((c) => c[0] === 1)).toBe(true);
    expect(satir(1).getByText(/Giriş hesabı yok/)).toBeInTheDocument();
    await u.click(satir(1).getByRole("button", { name: "Hesap oluştur" }));
    expect(await screen.findByText("Giriş hesabı oluştur")).toBeInTheDocument();
    expect(screen.getByLabelText("Ad")).toHaveValue("Arif");
    expect(screen.getByLabelText("Soyad")).toHaveValue("Kıyar");
    const sifre = screen.getByLabelText("Şifre") as HTMLInputElement;
    expect(sifre).toHaveAttribute("type", "password");
    expect(sifre).toHaveAttribute("autocomplete", "new-password");
    expect(sifre).toHaveValue("");
    await u.click(cekmeceDugmesi("Hesap oluştur"));
    expect(m.hesapOlustur).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Geçerli bir e-posta girin.", "Şifre en az 8 karakter olmalı."]);
    expect(screen.getByLabelText("E-posta")).toHaveFocus();
    await u.type(screen.getByLabelText("E-posta"), "  Arif@Example.COM ");
    await u.type(sifre, "gizli1234");
    await u.dblClick(cekmeceDugmesi("Hesap oluştur"));
    expect(m.hesapOlustur).toHaveBeenCalledTimes(1);
    expect(m.hesapOlustur).toHaveBeenCalledWith({ courierId: 1, first_name: "Arif", last_name: "Kıyar", email: "arif@example.com", password: "gizli1234" });
    await act(async () => { sozler.pop()!.rej({ response: { status: 422, data: { detail: [{ loc: ["body", "email"], msg: "E-posta zaten kayıtlı" }] } } }); await Promise.resolve(); });
    expect(await screen.findByText("E-posta zaten kayıtlı")).toBeInTheDocument();
    expect(screen.getByLabelText("E-posta")).toHaveFocus();
    expect(cekmeceAcikMi()).toBe(true);
    // Hata yerel state'e aktarıldıktan sonra mutation reset edilir; görünür şifre alanı korunur.
    await waitFor(() => expect(sifirla.hesapOlustur).toHaveBeenCalledTimes(1));
    expect(sifre).toHaveValue("gizli1234");
    // E-postayı değiştirince yalnız e-posta hatası silinir, diğer değerler korunur; yeniden gönderilebilir.
    await u.clear(screen.getByLabelText("E-posta"));
    expect(screen.queryByText("E-posta zaten kayıtlı")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ad")).toHaveValue("Arif");
    await u.type(screen.getByLabelText("E-posta"), "arif2@example.com");
    await u.click(cekmeceDugmesi("Hesap oluştur"));
    expect(m.hesapOlustur).toHaveBeenCalledTimes(2);
    expect(m.hesapOlustur).toHaveBeenLastCalledWith(expect.objectContaining({ email: "arif2@example.com", password: "gizli1234" }));
  });

  it("hesap oluşturma: 422 şifre hatası alanda, alan değişince silinir, yeniden gönderim başarır; mutation her settled'da reset; yeniden açılınca şifre boş", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(satir(1).getByRole("button", { name: "Hesap" }));
    await u.click(satir(1).getByRole("button", { name: "Hesap oluştur" }));
    const sifre = (await screen.findByLabelText("Şifre")) as HTMLInputElement;
    await u.type(screen.getByLabelText("E-posta"), "arif@example.com");
    await u.type(sifre, "gizli1234");
    await u.click(cekmeceDugmesi("Hesap oluştur"));
    expect(m.hesapOlustur).toHaveBeenCalledTimes(1);
    await act(async () => { sozler.pop()!.rej({ response: { status: 422, data: { detail: [{ loc: ["body", "password"], msg: "Şifre çok yaygın" }] } } }); await Promise.resolve(); });
    expect(await screen.findByText("Şifre çok yaygın")).toBeInTheDocument();
    expect(sifre).toHaveFocus();
    await waitFor(() => expect(sifirla.hesapOlustur).toHaveBeenCalledTimes(1));
    // Görünür şifre alanı korunur; yalnız mutation kopyası silinir.
    expect(sifre).toHaveValue("gizli1234");
    await u.type(sifre, "!");
    expect(screen.queryByText("Şifre çok yaygın")).not.toBeInTheDocument();
    await u.click(cekmeceDugmesi("Hesap oluştur"));
    expect(m.hesapOlustur).toHaveBeenCalledTimes(2);
    expect(m.hesapOlustur).toHaveBeenLastCalledWith(expect.objectContaining({ password: "gizli1234!" }));
    await act(async () => { sozler.pop()!.res({ id: 50, email: "arif@example.com", is_active: true }); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Giriş hesabı oluşturuldu.")).toBeInTheDocument();
    await waitFor(() => expect(sifirla.hesapOlustur).toHaveBeenCalledTimes(2));
    // Yeniden açılınca şifre ön doldurulmaz.
    await u.click(satir(1).getByRole("button", { name: /Hesap oluştur$/ }));
    expect((await screen.findByLabelText("Şifre")) as HTMLInputElement).toHaveValue("");
  });

  it("aktif hesap: e-posta gösterilir; şifre sıfırlama penceresi (boş ön doldurma, ≥8, payload, başarıda temizlenir); hesabı kapatma onayı uyarısıyla ve hata açık kalır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    vi.mocked(useCourierAccount).mockReturnValue(sonuc({ id: 50, email: "arif@example.com", first_name: "Arif", last_name: "Kıyar", is_active: true, courier_id: 1, created_at: "" }));
    kur();
    await u.click(satir(1).getByRole("button", { name: "Hesap" }));
    expect(satir(1).getByText("arif@example.com")).toBeInTheDocument();
    await u.click(satir(1).getByRole("button", { name: "Şifre sıfırla" }));
    expect(await screen.findByText("Şifre sıfırla", { selector: ".ant-drawer-title" })).toBeInTheDocument();
    const alan = screen.getByLabelText("Yeni şifre") as HTMLInputElement;
    expect(alan).toHaveValue("");
    expect(alan).toHaveAttribute("type", "password");
    expect(alan).toHaveAttribute("autocomplete", "new-password");
    await u.click(cekmeceDugmesi("Şifreyi kaydet"));
    expect(m.sifre).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Şifre en az 8 karakter olmalı.");
    expect(alan).toHaveFocus();
    await u.type(alan, "yeniSifre99");
    await u.dblClick(cekmeceDugmesi("Şifreyi kaydet"));
    expect(m.sifre).toHaveBeenCalledTimes(1);
    expect(m.sifre).toHaveBeenCalledWith({ accountId: 50, newPassword: "yeniSifre99" });
    await act(async () => { sozler.pop()!.rej({ response: { status: 422, data: { detail: [{ loc: ["body", "new_password"], msg: "Eski şifreyle aynı" }, { loc: ["body", "password"], msg: "Şifre çok zayıf" }] } } }); await Promise.resolve(); });
    expect(await screen.findByText("Şifre çok zayıf")).toBeInTheDocument();
    expect(screen.getByText("Eski şifreyle aynı")).toBeInTheDocument();
    expect(alan).toHaveFocus();
    await waitFor(() => expect(sifirla.sifre).toHaveBeenCalledTimes(1));
    expect(alan).toHaveValue("yeniSifre99");
    await u.type(alan, "!");
    expect(screen.queryByText("Şifre çok zayıf")).not.toBeInTheDocument();
    await u.click(cekmeceDugmesi("Şifreyi kaydet"));
    expect(m.sifre).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Eski şifreyle aynı")).not.toBeInTheDocument();
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Şifre güncellendi.")).toBeInTheDocument();
    await waitFor(() => expect(sifirla.sifre).toHaveBeenCalledTimes(2));
    await u.click(satir(1).getByRole("button", { name: /Şifre sıfırla$/ }));
    expect((await screen.findByLabelText("Yeni şifre")) as HTMLInputElement).toHaveValue("");
    await u.click(cekmeceDugmesi("Vazgeç"));
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    // Hesabı kapat.
    await u.click(satir(1).getByRole("button", { name: "Hesabı kapat" }));
    expect(await screen.findByText("Arif Kıyar için açık oturumlar anında sonlandırılacak.")).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/Hesabı kapat/));
    expect(m.hesapKapat).toHaveBeenCalledTimes(1);
    expect(m.hesapKapat).toHaveBeenCalledWith(50);
    await act(async () => { sozler.pop()!.rej({ response: { status: 403, data: { detail: "Yetkin yok" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Yetkin yok")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/Hesabı kapat/)).not.toHaveClass("ant-btn-loading"));
    await u.click(onayDugmesi(/Hesabı kapat/));
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText("Hesap kapatıldı: oturumları sonlandırıldı.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
  });

  it("takvim: satır açıklamaları ve Türkçe uzun tarih; gün kapatma doğrulaması (gün zorunlu, açıklama ≤120), payload, 422 alanda, başarıda form temizlenir; yeniden açma onayı; tatil yükleme onayı ve sayaç mesajı", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    expect(within(screen.getByTestId("gun-10")).getByText(/29 Ekim 2026 Perşembe/)).toBeInTheDocument();
    expect(within(screen.getByTestId("gun-10")).getByText("Resmî tatil")).toBeInTheDocument();
    expect(within(screen.getByTestId("gun-11")).getByText("Yıllık bakım")).toBeInTheDocument();
    expect(within(screen.getByTestId("gun-12")).getByText("Kapalı")).toBeInTheDocument();
    fireEvent.click(dugme("Günü kapat"));
    expect(m.gunEkle).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Kapatılacak günü seçin.");
    // Hata ilgili kontrolün hemen altında (aynı sarmalayıcıda), ortak satır altında değil.
    expect(screen.getByLabelText("Kapatılacak gün").closest("label")!.parentElement).toContainElement(screen.getByRole("alert"));
    expect(screen.getByLabelText("Kapatılacak gün")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Kapatılacak gün"), { target: { value: "2026-12-24" } });
    fireEvent.change(screen.getByLabelText("Açıklama (isteğe bağlı)"), { target: { value: "  Yıl sonu  " } });
    fireEvent.click(dugme("Günü kapat"));
    fireEvent.click(dugme("Günü kapat"));
    expect(m.gunEkle).toHaveBeenCalledTimes(1);
    expect(m.gunEkle).toHaveBeenCalledWith({ day: "2026-12-24", label: "Yıl sonu" });
    await act(async () => { sozler.pop()!.rej({ response: { status: 422, data: { detail: [{ loc: ["body", "day"], msg: "Geçmiş gün kapatılamaz" }] } } }); await Promise.resolve(); });
    expect(await screen.findByText("Geçmiş gün kapatılamaz")).toBeInTheDocument();
    expect(screen.getByLabelText("Kapatılacak gün").closest("label")!.parentElement).toContainElement(screen.getByText("Geçmiş gün kapatılamaz"));
    expect(screen.getByLabelText("Kapatılacak gün")).toHaveValue("2026-12-24");
    // Açıklamayı değiştirmek gün hatasını silmez; günü değiştirmek yalnız gün hatasını siler.
    fireEvent.change(screen.getByLabelText("Açıklama (isteğe bağlı)"), { target: { value: "Yıl sonu 2" } });
    expect(screen.getByText("Geçmiş gün kapatılamaz")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Kapatılacak gün"), { target: { value: "2026-12-25" } });
    expect(screen.queryByText("Geçmiş gün kapatılamaz")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Kapatılacak gün"), { target: { value: "2026-12-24" } });
    fireEvent.change(screen.getByLabelText("Açıklama (isteğe bağlı)"), { target: { value: "" } });
    fireEvent.click(dugme("Günü kapat"));
    expect(m.gunEkle).toHaveBeenLastCalledWith({ day: "2026-12-24", label: undefined });
    await act(async () => { sozler.pop()!.res(GUNLER[0]); await Promise.resolve(); });
    expect(await screen.findByText("Gün teslimata kapatıldı.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Kapatılacak gün")).toHaveValue(""));
    // Yeniden aç onayı (sabit hedef, çift onay tek istek).
    await u.click(screen.getByRole("button", { name: /29 Ekim 2026 Perşembe gününü yeniden aç/ }));
    expect(await screen.findByText(/teslimata yeniden açılacak/)).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/Yeniden aç/));
    expect(m.gunAc).toHaveBeenCalledTimes(1);
    expect(m.gunAc).toHaveBeenCalledWith(10);
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText("Gün yeniden açıldı.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
    // Resmî tatilleri yükle.
    await u.click(dugme("Resmî tatilleri yükle"));
    expect(await screen.findByText(/yinelenenler atlanır/)).toBeInTheDocument();
    expect(screen.getByText(/yalnız 2026 için tanımlı/)).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/Yükle/));
    expect(m.tatil).toHaveBeenCalledTimes(1);
    expect(m.tatil).toHaveBeenCalledWith(new Date().getFullYear());
    await act(async () => { sozler.pop()!.res([GUNLER[0], GUNLER[1]]); await Promise.resolve(); });
    expect(await screen.findByText("2 resmî tatil yüklendi.")).toBeInTheDocument();
  });

  it("takvim hata/yükleniyor/boş; yapılandırma değerleri, kapasite 0 → sınırsız, bilgi hatası kendi Tekrar dene'siyle", async () => {
    vi.mocked(useClosedDays).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByText("Takvim yükleniyor…")).toBeInTheDocument();
    a.unmount();
    const takvimRefetch = vi.fn();
    vi.mocked(useClosedDays).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Takvim çöktü" } } }, refetch: takvimRefetch }));
    vi.mocked(useCapacityOverview).mockReturnValue(sonuc([{ day: "2026-09-13", capacity: 0, booked: 0, retry_debt: 0, is_working_day: true }]));
    const b = kur();
    expect(screen.getByText("Takvim çöktü")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Takvim çöktü").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(takvimRefetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("16:00")).toBeInTheDocument();
    expect(screen.getByText("Seyhan, Yüreğir")).toBeInTheDocument();
    expect(within(screen.getByTestId("yapilandirma-kapasite")).getByText("sınırsız")).toBeInTheDocument();
    expect(screen.getByText("kapasite kontrolü kapalı")).toBeInTheDocument();
    // Yapılandırma salt okunur: sahte Düzenle/Kaydet düğmesi yok.
    expect(within(screen.getByRole("region", { name: "Teslimat yapılandırması" })).queryByRole("button", { name: /Düzenle|Kaydet/ })).not.toBeInTheDocument();
    b.unmount();
    vi.mocked(useClosedDays).mockReturnValue(sonuc([]));
    const bilgiRefetch = vi.fn();
    vi.mocked(useDeliveryInfo).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch: bilgiRefetch }));
    kur();
    expect(screen.getByText("Yaklaşan kapalı gün yok")).toBeInTheDocument();
    expect(screen.getByText("Teslimat bilgisi alınamadı.")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Teslimat bilgisi alınamadı.").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(bilgiRefetch).toHaveBeenCalledTimes(1);
  });

  it("rota, menü yaprağı, izin, selectedKey/openKeys", () => {
    expect(PATHS.adminNewDeliveryCouriers).toBe("/yonetim-yeni/dagitim/kuryeler");
    expect(ROUTES.adminNewDeliveryCouriers).toBe(PATHS.adminNewDeliveryCouriers);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryCouriers)).toMatchObject({ label: "Kuryeler", requiredPermission: "delivery" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewDeliveryCouriers)).toEqual({ selectedKey: "dagitim-kuryeler", openKeys: ["dagitim"] });
    expect(izinBeyaniniKarsilarMi(["delivery.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryCouriers)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryCouriers)!)).toBe(false);
  });
});
