import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DagitimAraclar, aracOzeti, baseNoktalari, noktaKonumu } from "@/panel/pages/dagitim/DagitimAraclar";
import { MESGUL_NEDENI } from "@/panel/components/varlikKilidi";
import { aracSemasi, formFrom, noktaGovdesi, noktaSemasi, payloadFrom } from "@/components/admin/aracSemalari";
import { zodAlanHatalari } from "@/components/admin/kuryeSemalari";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useCreatePickupPoint, useCreateVehicle, useDeleteVehicle, usePickupPoints, useUpdatePickupPoint, useUpdateVehicle, useVehicles } from "@/hooks/useDelivery";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { PickupPoint, Vehicle } from "@/types";

vi.mock("@/hooks/useDelivery", () => ({
  useCreatePickupPoint: vi.fn(),
  useCreateVehicle: vi.fn(),
  useDeleteVehicle: vi.fn(),
  usePickupPoints: vi.fn(),
  useUpdatePickupPoint: vi.fn(),
  useUpdateVehicle: vi.fn(),
  useVehicles: vi.fn(),
}));

const m = { olustur: vi.fn(), guncelle: vi.fn(), sil: vi.fn(), noktaOlustur: vi.fn(), noktaGuncelle: vi.fn() };
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const arac = (ek: Partial<Vehicle> = {}): Vehicle => ({ id: 1, code: "DOBLO", label: "Doblo", plate: "01 ABC 123", profile: "car", max_stops: 20, shift_start: "08:00:00", shift_end: "17:30:00", fixed_cost: 350, start_point_id: null, sort_order: 0, is_active: true, ...ek });
const ARACLAR = [arac(), arac({ id: 2, code: "MOTO", label: "Motor", plate: null, max_stops: null, shift_start: null, shift_end: null, fixed_cost: 0, sort_order: 1, is_active: false })];
const nokta = (ek: Partial<PickupPoint> = {}): PickupPoint => ({ id: 10, name: "Depo: Seyhan", kind: "BASE", address: "Atatürk Cad. 12", lat: 36.9855, lng: 35.3253, sort_order: 0, is_active: true, ...ek });
const NOKTALAR = [nokta(), nokta({ id: 11, name: "Depo: Yüreğir", address: null, lat: 37.0, lng: 35.4, sort_order: 5 }), nokta({ id: 12, name: "Tedarikçi", kind: "SUPPLIER" }), nokta({ id: 13, name: "Pasif", is_active: false })];
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
        <MemoryRouter initialEntries={[PATHS.adminNewDeliveryVehicles]}>
          <Routes>
            <Route path={PATHS.adminNewDeliveryVehicles} element={<DagitimAraclar />} />
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
const acikOnay = () => {
  const acik = [...document.querySelectorAll(".ant-modal-confirm")].filter((x) => !x.classList.contains("ant-zoom-leave"));
  return acik[acik.length - 1] as HTMLElement;
};
const onayDugmesi = (ad: RegExp) => within(acikOnay()).getByRole("button", { name: ad });
const satir = (id: number) => within(screen.getByTestId(`arac-${id}`));
const noktaSatiri = (id: number) => within(screen.getByTestId(`nokta-${id}`));
const bolum = (ad: string) => within(screen.getByRole("region", { name: ad }));
const yaz = (etiket: string | RegExp, deger: string) => fireEvent.change(screen.getByLabelText(etiket), { target: { value: deger } });

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset().mockImplementation(ertelenmis);
  sozler.length = 0;
  vi.mocked(useVehicles).mockReset().mockReturnValue(sonuc(ARACLAR));
  vi.mocked(usePickupPoints).mockReset().mockReturnValue(sonuc(NOKTALAR));
  vi.mocked(useCreateVehicle).mockReturnValue({ mutateAsync: m.olustur, isPending: false } as never);
  vi.mocked(useUpdateVehicle).mockReturnValue({ mutateAsync: m.guncelle, isPending: false } as never);
  vi.mocked(useDeleteVehicle).mockReturnValue({ mutateAsync: m.sil, isPending: false } as never);
  vi.mocked(useCreatePickupPoint).mockReturnValue({ mutateAsync: m.noktaOlustur, isPending: false } as never);
  vi.mocked(useUpdatePickupPoint).mockReturnValue({ mutateAsync: m.noktaGuncelle, isPending: false } as never);
  izin("delivery.view", "delivery.manage");
});

describe("saf kurallar", () => {
  it("araç özeti, nokta konumu (adres yoksa 5 basamak), BASE filtresi (sunucu sırası, ilki varsayılan)", () => {
    expect(aracOzeti(ARACLAR[0])).toEqual(["20 durak", "vardiya 08:00–17:30", "₺350/gün sabit"]);
    // null → sunucu varsayılanı ("sınırsız" değil: backend `_arac_tavani`); pozitif → "N durak"; 0 sözleşmede yok (backend ge=1).
    expect(aracOzeti(ARACLAR[1])).toEqual(["varsayılan durak tavanı", "vardiya tanımsız", "₺0/gün sabit"]);
    expect(aracOzeti(arac({ max_stops: 1 }))[0]).toBe("1 durak");
    expect(noktaKonumu(NOKTALAR[0])).toBe("Atatürk Cad. 12");
    expect(noktaKonumu(NOKTALAR[1])).toBe("37.00000, 35.40000");
    expect(baseNoktalari(NOKTALAR).map((p) => p.id)).toEqual([10, 11]);
  });

  it("ortak zod sözleşmesi ve payload dönüşümleri eski DeliveryVehiclesPage ile aynı: null/0/sayı/time/plaka/kod", () => {
    expect(zodAlanHatalari(aracSemasi(true).safeParse({ ...formFrom(), code: "dob lo" }))).toEqual({ label: "Araç adı (etiket) gerekli.", code: "Kod yalnız BÜYÜK harf, rakam, _ ve - içerebilir (örn. DOBLO)." });
    expect(zodAlanHatalari(aracSemasi(false).safeParse({ ...formFrom(), label: "x", code: "", maxStops: "0", fixedCost: "-1", sortOrder: "a" }))).toEqual({ maxStops: "Durak tavanı en az 1 olmalı.", fixedCost: "Sabit maliyet en az 0 olmalı.", sortOrder: "Sıra bir sayı olmalı." });
    expect(payloadFrom({ label: " Doblo ", code: "DOBLO", plate: "  ", maxStops: "", shiftStart: "", shiftEnd: "", fixedCost: "", sortOrder: "" })).toEqual({ label: "Doblo", plate: null, max_stops: null, shift_start: null, shift_end: null, fixed_cost: 0, sort_order: 0 });
    expect(payloadFrom({ label: "Doblo", code: "", plate: "01 ABC 123", maxStops: "20", shiftStart: "08:00", shiftEnd: "17:30", fixedCost: "350", sortOrder: "2" })).toEqual({ label: "Doblo", plate: "01 ABC 123", max_stops: 20, shift_start: "08:00", shift_end: "17:30", fixed_cost: 350, sort_order: 2 });
    expect(formFrom(ARACLAR[0])).toMatchObject({ shiftStart: "08:00", shiftEnd: "17:30", maxStops: "20", fixedCost: "350" });
    expect(zodAlanHatalari(noktaSemasi.safeParse({ name: " ", address: "", lat: "91", lng: "abc", sortOrder: "" }))).toEqual({ name: "Nokta adı gerekli.", lat: "Enlem ±90 aralığında olmalı.", lng: "Boylam sayı olmalı (örn. 36.98550)." });
    expect(zodAlanHatalari(noktaSemasi.safeParse({ name: "D", address: "", lat: "", lng: "181", sortOrder: "" }))).toEqual({ lat: "Enlem gerekli.", lng: "Boylam ±180 aralığında olmalı." });
    expect(noktaGovdesi({ name: " Depo ", address: " ", lat: "36.98550", lng: "35.32530", sortOrder: "" })).toEqual({ name: "Depo", address: null, lat: 36.9855, lng: 35.3253, sort_order: 0 });
  });
});

describe("DagitimAraclar", () => {
  it("delivery.view yokken AccessDenied ve iki sorgu da kapalı", () => {
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(useVehicles)).toEqual([false]);
    expect(son(usePickupPoints)).toEqual([false]);
  });

  it("view-only: dolu/boş/hata durumlarında salt okunur notu var, yazma yüzeyi yok", () => {
    izin("delivery.view");
    const a = kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByText("Doblo")).toBeInTheDocument();
    expect(screen.getByText("Depo: Seyhan")).toBeInTheDocument();
    for (const ad of [/Araç ekle/, /Nokta ekle/, /Düzenle/, /Pasifleştir/, /Aktifleştir/, /Sil$/]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    expect(son(useVehicles)).toEqual([true]);
    a.unmount();
    vi.mocked(useVehicles).mockReturnValue(sonuc([]));
    vi.mocked(usePickupPoints).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x") }));
    kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByText("Filoda araç yok")).toBeInTheDocument();
    expect(screen.getByText("Başlangıç noktaları yüklenemedi.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ekle/ })).not.toBeInTheDocument();
  });

  it("iki bölüm bağımsız: yükleniyor/hata + kendi refetch'i/boş/dolu; bir bölümün hatası diğerini bloklamaz; boş/dolu tek ekleme düğmesi", async () => {
    const aracRefetch = vi.fn();
    vi.mocked(useVehicles).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Filo çöktü" } } }, refetch: aracRefetch }));
    vi.mocked(usePickupPoints).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByText("Filo çöktü")).toBeInTheDocument();
    expect(screen.getByText("Başlangıç noktaları yükleniyor…")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Filo çöktü").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(aracRefetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(usePickupPoints).mock.results.at(-1)?.value.refetch).not.toHaveBeenCalled();
    a.unmount();
    const noktaRefetch = vi.fn();
    vi.mocked(useVehicles).mockReturnValue(sonuc(undefined, { isPending: true }));
    vi.mocked(usePickupPoints).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch: noktaRefetch }));
    const b = kur();
    expect(screen.getByText("Araçlar yükleniyor…")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Başlangıç noktaları yüklenemedi.").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(noktaRefetch).toHaveBeenCalledTimes(1);
  });

  it("boş/dolu tek ekleme düğmesi: boşta yalnız boş durumda, doluda yalnız başlıkta; ikisi de aynı çekmeceyi açar", async () => {
    // Boş: başlıkta düğme yok, boş durumda tam 1 düğme (her bölüm).
    vi.mocked(useVehicles).mockReturnValue(sonuc([]));
    vi.mocked(usePickupPoints).mockReturnValue(sonuc([nokta({ kind: "SUPPLIER" })]));
    const c = kur();
    expect(screen.getByText("Filoda araç yok")).toBeInTheDocument();
    expect(screen.getByText("Tanımlı başlangıç noktası yok")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Araç ekle" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Nokta ekle" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Araç ekle" }));
    expect(await screen.findByText("Araç ekle", { selector: ".ant-drawer-title" })).toBeInTheDocument();
    c.unmount();
    // Dolu: yalnız başlıkta tam 1 düğme.
    vi.mocked(useVehicles).mockReturnValue(sonuc(ARACLAR));
    vi.mocked(usePickupPoints).mockReturnValue(sonuc(NOKTALAR));
    kur();
    expect(screen.getAllByRole("button", { name: "Araç ekle" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Nokta ekle" })).toHaveLength(1);
    expect(screen.queryByText("Filoda araç yok")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nokta ekle" }));
    expect(await screen.findByText("Başlangıç noktası ekle", { selector: ".ant-drawer-title" })).toBeInTheDocument();
  });

  it("araç satırı bütün alanları: ad, kod, plaka, durak tavanı, vardiya, sabit maliyet, pasif; nokta: yalnız aktif BASE, varsayılan rozeti, adres/koordinat, sıra; iç içe a/button yok", () => {
    kur();
    const s1 = satir(1);
    expect(s1.getByText("Doblo")).toBeInTheDocument();
    expect(s1.getByText("DOBLO")).toBeInTheDocument();
    expect(s1.getByText("01 ABC 123")).toBeInTheDocument();
    expect(s1.getByText("20 durak · vardiya 08:00–17:30 · ₺350/gün sabit")).toBeInTheDocument();
    expect(s1.queryByText("pasif")).not.toBeInTheDocument();
    const s2 = satir(2);
    expect(s2.getByText("plaka yok")).toBeInTheDocument();
    expect(s2.getByText("varsayılan durak tavanı · vardiya tanımsız · ₺0/gün sabit")).toBeInTheDocument();
    expect(s2.getByText("pasif")).toBeInTheDocument();
    expect(s2.getByRole("button", { name: "Motor · Aktifleştir" })).toBeInTheDocument();
    for (const ad of ["Doblo · Düzenle", "Doblo · Pasifleştir", "Doblo · Sil"]) expect(s1.getByRole("button", { name: ad })).toBeInTheDocument();
    expect(screen.queryByTestId("nokta-12")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nokta-13")).not.toBeInTheDocument();
    expect(noktaSatiri(10).getByText("varsayılan")).toBeInTheDocument();
    expect(noktaSatiri(10).getByText("Atatürk Cad. 12")).toBeInTheDocument();
    expect(noktaSatiri(11).queryByText("varsayılan")).not.toBeInTheDocument();
    expect(noktaSatiri(11).getByText("37.00000, 35.40000")).toBeInTheDocument();
    expect(noktaSatiri(11).getByText("sıra 5")).toBeInTheDocument();
    expect(noktaSatiri(11).getByRole("button", { name: "Depo: Yüreğir · Düzenle" })).toBeInTheDocument();
    expect(document.querySelectorAll("a button, button a, a a, button button")).toHaveLength(0);
  });

  it("araç oluşturma: 8 alan, zod doğrulaması + ilk hatalı alan odağı, kod büyük harf/boşluksuz, plaka Türkçe büyük harf, payload (null/0/sayı/time), aynı tick tek istek, 422 alan/genel, alan değişince temizlik, başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(screen.getByRole("button", { name: "Araç ekle" }));
    expect(await screen.findByText("Araç ekle", { selector: ".ant-drawer-title" })).toBeInTheDocument();
    const etiketler = ["Araç adı", "Kod (değişmez)", "Plaka (isteğe bağlı)", "Durak tavanı (isteğe bağlı)", "Sabit maliyet (₺/gün)", "Vardiya başlangıç (isteğe bağlı)", "Vardiya bitiş (isteğe bağlı)", "Sıra"];
    for (const e of etiketler) expect(screen.getByLabelText(e)).toBeInTheDocument();
    expect(cekmece().querySelectorAll("input")).toHaveLength(8);
    yaz("Kod (değişmez)", "dob lo");
    expect(screen.getByLabelText("Kod (değişmez)")).toHaveValue("DOBLO");
    yaz("Plaka (isteğe bağlı)", "01 abc ıi");
    expect(screen.getByLabelText("Plaka (isteğe bağlı)")).toHaveValue("01 ABC Iİ");
    yaz("Durak tavanı (isteğe bağlı)", "0");
    await u.click(cekmeceDugmesi("Ekle"));
    expect(m.olustur).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Araç adı (etiket) gerekli.", "Durak tavanı en az 1 olmalı."]);
    expect(screen.getByLabelText("Araç adı")).toHaveFocus();
    yaz("Araç adı", "  Yeni Araç ");
    expect(screen.queryByText("Araç adı (etiket) gerekli.")).not.toBeInTheDocument();
    expect(screen.getByText("Durak tavanı en az 1 olmalı.")).toBeInTheDocument();
    yaz("Durak tavanı (isteğe bağlı)", "");
    yaz("Plaka (isteğe bağlı)", "  ");
    yaz("Vardiya başlangıç (isteğe bağlı)", "08:00");
    yaz("Sabit maliyet (₺/gün)", "");
    yaz("Sıra", "3");
    await u.dblClick(cekmeceDugmesi("Ekle"));
    expect(m.olustur).toHaveBeenCalledTimes(1);
    expect(m.olustur).toHaveBeenCalledWith({ code: "DOBLO", label: "Yeni Araç", plate: null, max_stops: null, shift_start: "08:00", shift_end: null, fixed_cost: 0, sort_order: 3 });
    // Pending'de kapatma yutulur.
    await u.click(cekmeceDugmesi("Vazgeç"));
    expect(cekmeceAcikMi()).toBe(true);
  });

  it("araç oluşturma: 422 alan/genel ayrımı, alan değişince yalnız o alanın hatası silinir, girdi korunur, yeniden gönderim, başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(screen.getByRole("button", { name: "Araç ekle" }));
    await screen.findByText("Araç ekle", { selector: ".ant-drawer-title" });
    yaz("Araç adı", "  Yeni Araç ");
    yaz("Kod (değişmez)", "DOBLO");
    await u.click(cekmeceDugmesi("Ekle"));
    expect(m.olustur).toHaveBeenCalledTimes(1);
    await act(async () => { sozler.pop()!.rej({ response: { status: 422, data: { detail: [{ loc: ["body", "code"], msg: "Bu kod zaten var" }, { loc: ["body", "max_stops"], msg: "Tavan çok yüksek" }, { loc: ["body", "profile"], msg: "Profil geçersiz" }] } } }); await Promise.resolve(); });
    expect(await screen.findByText("Bu kod zaten var")).toBeInTheDocument();
    expect(screen.getByText("Tavan çok yüksek")).toBeInTheDocument();
    expect(screen.getByText("Profil geçersiz")).toBeInTheDocument();
    expect(screen.getByLabelText("Kod (değişmez)")).toHaveFocus();
    expect(screen.getByLabelText("Araç adı")).toHaveValue("  Yeni Araç ");
    // Alan değişince yalnız o alanın sunucu hatası silinir.
    yaz("Kod (değişmez)", "DOBLO2");
    expect(screen.queryByText("Bu kod zaten var")).not.toBeInTheDocument();
    expect(screen.getByText("Tavan çok yüksek")).toBeInTheDocument();
    await u.click(cekmeceDugmesi("Ekle"));
    expect(m.olustur).toHaveBeenCalledTimes(2);
    expect(m.olustur).toHaveBeenLastCalledWith(expect.objectContaining({ code: "DOBLO2" }));
    expect(screen.queryByText("Profil geçersiz")).not.toBeInTheDocument();
    await act(async () => { sozler.pop()!.res(arac({ id: 9 })); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Araç eklendi.")).toBeInTheDocument();
  });

  it("araç düzenleme: 7 alan ve kod yok, mevcut değerler (time HH:MM), temiz kapanır, kirli kapatma onayı, PATCH payload'ında kod yok, 409 pencerede kalır ve yeniden denenir", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(satir(1).getByRole("button", { name: /Düzenle$/ }));
    expect(await screen.findByText("Aracı düzenle")).toBeInTheDocument();
    expect(cekmece().querySelectorAll("input")).toHaveLength(7);
    expect(screen.queryByLabelText("Kod (değişmez)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Araç adı")).toHaveValue("Doblo");
    expect(screen.getByLabelText("Vardiya başlangıç (isteğe bağlı)")).toHaveValue("08:00");
    expect(screen.getByLabelText("Vardiya bitiş (isteğe bağlı)")).toHaveValue("17:30");
    expect(screen.getByLabelText("Durak tavanı (isteğe bağlı)")).toHaveValue(20);
    expect(screen.getByLabelText("Durak tavanı (isteğe bağlı)")).toHaveAttribute("placeholder", "boş: varsayılan");
    expect(screen.getByLabelText("Sabit maliyet (₺/gün)")).toHaveValue(350);
    await u.click(cekmeceDugmesi("Vazgeç"));
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    await u.click(satir(1).getByRole("button", { name: /Düzenle$/ }));
    yaz("Plaka (isteğe bağlı)", "");
    await u.click(cekmeceDugmesi("Vazgeç"));
    expect((await screen.findAllByText("Kaydedilmemiş değişiklikler var")).length).toBeGreaterThan(0);
    await u.click(screen.getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(cekmeceAcikMi()).toBe(true);
  });

  it("araç düzenleme: PATCH payload'ında kod yok (sabit hedef), 409 pencerede kalır ve yeniden denenir, başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(satir(1).getByRole("button", { name: /Düzenle$/ }));
    await screen.findByText("Aracı düzenle");
    yaz("Plaka (isteğe bağlı)", "");
    await u.click(cekmeceDugmesi("Kaydet"));
    expect(m.guncelle).toHaveBeenCalledWith({ vehicleId: 1, payload: { label: "Doblo", plate: null, max_stops: 20, shift_start: "08:00", shift_end: "17:30", fixed_cost: 350, sort_order: 0 } });
    expect(m.guncelle.mock.calls[0][0].payload).not.toHaveProperty("code");
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Araç şu an turda" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Araç şu an turda")).toBeInTheDocument();
    expect(cekmeceAcikMi()).toBe(true);
    await u.click(cekmeceDugmesi("Kaydet"));
    expect(m.guncelle).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(arac()); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Araç güncellendi.")).toBeInTheDocument();
  });

  it("aktif/pasif (aynı tick tek istek) ve silme onayı: açıklama, sabit hedef, çift onay tek istek, 409 mesajı onayda görünür + açık kalır + Vazgeç engeli, yeniden deneme başarır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    fireEvent.click(satir(1).getByRole("button", { name: /Pasifleştir$/ }));
    fireEvent.click(satir(1).getByRole("button", { name: /Pasifleştir/ }));
    expect(m.guncelle).toHaveBeenCalledTimes(1);
    expect(m.guncelle).toHaveBeenCalledWith({ vehicleId: 1, payload: { is_active: false } });
    await act(async () => { sozler.pop()!.res(arac({ is_active: false })); await Promise.resolve(); });
    expect(await screen.findByText("Araç pasifleştirildi.")).toBeInTheDocument();
    await u.click(satir(2).getByRole("button", { name: /Sil$/ }));
    expect(await screen.findByText("Motor filodan kaldırılacak. Geçmiş turların kaydı bozulmaz.")).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/Aracı sil/));
    expect(m.sil).toHaveBeenCalledTimes(1);
    expect(m.sil).toHaveBeenCalledWith(2);
    await u.click(onayDugmesi(/Vazgeç/));
    expect(onayGorunur()).toBe(true);
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Aracın açık PLANNED turu var" } } }); await Promise.resolve(); });
    expect(await within(acikOnay()).findByText("Aracın açık PLANNED turu var")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/Aracı sil/)).not.toHaveClass("ant-btn-loading"));
    await u.click(onayDugmesi(/Aracı sil/));
    expect(m.sil).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText("Araç silindi.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
  });

  it("varlık kilidi: aynı araçta aktiflik sürerken düzenle/sil kapalı (görünür neden); farklı araç paralel; hata sonrası kilit bırakılır; düzenleme gönderimi sürerken satır düğmeleri kapalı", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    fireEvent.click(satir(1).getByRole("button", { name: /Pasifleştir$/ }));
    expect(satir(1).getByRole("button", { name: /Pasifleştir$/ })).toHaveClass("ant-btn-loading");
    for (const ad of [/Düzenle$/, /Sil$/]) {
      expect(satir(1).getByRole("button", { name: ad })).toBeDisabled();
      expect(satir(1).getByRole("button", { name: ad })).toHaveAttribute("title", MESGUL_NEDENI);
    }
    expect(satir(2).getByRole("button", { name: /Düzenle$/ })).toBeEnabled();
    fireEvent.click(satir(2).getByRole("button", { name: /Aktifleştir$/ }));
    expect(m.guncelle).toHaveBeenCalledTimes(2);
    expect(m.guncelle).toHaveBeenLastCalledWith({ vehicleId: 2, payload: { is_active: true } });
    await act(async () => { sozler.shift()!.rej({ response: { status: 500, data: { detail: "Sunucu hatası" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Sunucu hatası")).toBeInTheDocument();
    await waitFor(() => expect(satir(1).getByRole("button", { name: /Sil$/ })).toBeEnabled());
    expect(satir(1).getByRole("button", { name: /Düzenle$/ })).not.toHaveAttribute("title");
    expect(satir(2).getByRole("button", { name: /Sil$/ })).toBeDisabled();
    await act(async () => { sozler.shift()!.res(arac({ id: 2, is_active: true })); await Promise.resolve(); });
    await waitFor(() => expect(satir(2).getByRole("button", { name: /Sil$/ })).toBeEnabled());
    // Düzenleme gönderimi: aynı araçta sil/pasif kapalı; bitince açılır. Nokta bölümü etkilenmez.
    await u.click(satir(1).getByRole("button", { name: /Düzenle$/ }));
    yaz("Araç adı", "Doblo 2");
    await u.click(cekmeceDugmesi("Kaydet"));
    expect(m.guncelle).toHaveBeenCalledTimes(3);
    expect(satir(1).getByRole("button", { name: /Sil$/ })).toBeDisabled();
    expect(satir(1).getByRole("button", { name: /Düzenle$/ })).toHaveClass("ant-btn-loading");
    expect(noktaSatiri(10).getByRole("button", { name: /Düzenle$/ })).toBeEnabled();
    await act(async () => { sozler.shift()!.res(arac()); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    await waitFor(() => expect(satir(1).getByRole("button", { name: /Sil$/ })).toBeEnabled());
  });

  it("nokta oluşturma: 5 alan, koordinat hataları ilgili alanın altında + ilk hatalı alan odaklı, alan değişince temizlik, POST kind BASE ve sayısal number, 422 lat alanda; başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(screen.getByRole("button", { name: "Nokta ekle" }));
    expect(await screen.findByText("Başlangıç noktası ekle", { selector: ".ant-drawer-title" })).toBeInTheDocument();
    expect(cekmece().querySelectorAll("input")).toHaveLength(5);
    yaz("Enlem", "95");
    yaz("Boylam", "abc");
    await u.click(cekmeceDugmesi("Ekle"));
    expect(m.noktaOlustur).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Nokta adı gerekli.", "Enlem ±90 aralığında olmalı.", "Boylam sayı olmalı (örn. 36.98550)."]);
    expect(screen.getByLabelText("Nokta adı")).toHaveFocus();
    // Koordinat hatası kendi kontrolünün hemen altında.
    expect(screen.getByLabelText("Enlem").closest("label")!.parentElement).toContainElement(screen.getByText("Enlem ±90 aralığında olmalı."));
    yaz("Nokta adı", " Depo ");
    await u.click(cekmeceDugmesi("Ekle"));
    expect(screen.getByLabelText("Enlem")).toHaveFocus();
    yaz("Enlem", "36.98550");
    expect(screen.queryByText("Enlem ±90 aralığında olmalı.")).not.toBeInTheDocument();
    expect(screen.getByText("Boylam sayı olmalı (örn. 36.98550).")).toBeInTheDocument();
    yaz("Boylam", "35.32530");
    yaz("Adres (isteğe bağlı)", "  ");
    yaz("Sıra", "");
    await u.dblClick(cekmeceDugmesi("Ekle"));
    expect(m.noktaOlustur).toHaveBeenCalledTimes(1);
    expect(m.noktaOlustur).toHaveBeenCalledWith({ kind: "BASE", name: "Depo", address: null, lat: 36.9855, lng: 35.3253, sort_order: 0 });
    await act(async () => { sozler.pop()!.rej({ response: { status: 422, data: { detail: [{ loc: ["body", "lat"], msg: "Enlem şehir dışında" }] } } }); await Promise.resolve(); });
    expect(await screen.findByText("Enlem şehir dışında")).toBeInTheDocument();
    expect(screen.getByLabelText("Enlem")).toHaveFocus();
    expect(screen.getByLabelText("Nokta adı")).toHaveValue(" Depo ");
    yaz("Enlem", "36.9");
    expect(screen.queryByText("Enlem şehir dışında")).not.toBeInTheDocument();
    await u.click(cekmeceDugmesi("Ekle"));
    expect(m.noktaOlustur).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(nokta({ id: 20 })); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Başlangıç noktası eklendi.")).toBeInTheDocument();
  });

  it("nokta düzenleme: mevcut değerler, PATCH payload'ında kind yok, sabit hedef, kilit aynı noktada; temiz kapanış", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(noktaSatiri(11).getByRole("button", { name: /Düzenle$/ }));
    expect(await screen.findByText("Başlangıç noktasını düzenle")).toBeInTheDocument();
    expect(screen.getByLabelText("Nokta adı")).toHaveValue("Depo: Yüreğir");
    expect(screen.getByLabelText("Enlem")).toHaveValue("37");
    expect(screen.getByLabelText("Sıra")).toHaveValue(5);
    yaz("Adres (isteğe bağlı)", "Yeni adres");
    await u.dblClick(cekmeceDugmesi("Kaydet"));
    expect(m.noktaGuncelle).toHaveBeenCalledTimes(1);
    expect(m.noktaGuncelle).toHaveBeenCalledWith({ pointId: 11, payload: { name: "Depo: Yüreğir", address: "Yeni adres", lat: 37, lng: 35.4, sort_order: 5 } });
    expect(m.noktaGuncelle.mock.calls[0][0].payload).not.toHaveProperty("kind");
    expect(noktaSatiri(11).getByRole("button", { name: /Düzenle$/ })).toHaveClass("ant-btn-loading");
    expect(noktaSatiri(10).getByRole("button", { name: /Düzenle$/ })).toBeEnabled();
    await act(async () => { sozler.pop()!.res(nokta({ id: 11 })); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Başlangıç noktası güncellendi.")).toBeInTheDocument();
    await u.click(noktaSatiri(10).getByRole("button", { name: /Düzenle$/ }));
    await u.click(cekmeceDugmesi("Vazgeç"));
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(onayGorunur()).toBe(false);
  });

  it("rota, menü yaprağı (sıra korunur), izin, selectedKey/openKeys", () => {
    expect(PATHS.adminNewDeliveryVehicles).toBe("/yonetim-yeni/dagitim/araclar");
    expect(ROUTES.adminNewDeliveryVehicles).toBe(PATHS.adminNewDeliveryVehicles);
    const grup = PANEL_MENU.find((g) => g.key === "dagitim");
    expect(grup?.children?.map((c) => c.label)).toEqual(["Bugün", "Siparişler", "Turlar", "Performans", "Kuryeler", "Tahta", "Araçlar"]);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryVehicles)).toMatchObject({ label: "Araçlar", requiredPermission: "delivery" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewDeliveryVehicles)).toEqual({ selectedKey: "dagitim-araclar", openKeys: ["dagitim"] });
    expect(izinBeyaniniKarsilarMi(["delivery.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryVehicles)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryVehicles)!)).toBe(false);
    expect(bolum).toBeDefined();
  });
});
