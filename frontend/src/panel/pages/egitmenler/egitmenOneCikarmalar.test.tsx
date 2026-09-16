import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import {
  EgitmenOneCikarmalar,
  EN_BUYUK_SAYFA,
  PARA_DURUMU_ETIKETI,
  SAYFA_BOYUTU,
  apiDurumu,
  durumCoz,
  gorunurlukDurumu,
  iptalEdilebilir,
  paraDurumuMetni,
  sayfaCoz,
  sayfaOfseti,
  tarihMetni,
  tutarMetni,
} from "@/panel/pages/egitmenler/EgitmenOneCikarmalar";
import { GEREKCE_MAX, GEREKCE_MIN, gerekceHatasi, iptalAciklamasi, iptalDugmeMetni } from "@/panel/pages/egitmenler/OneCikarmaPenceresi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useAdminPromotions, useCancelPromotion } from "@/hooks/useAdmin";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { AdminPromotion } from "@/api/admin";

vi.mock("@/hooks/useAdmin", () => ({
  useAdminPromotions: vi.fn(),
  useCancelPromotion: vi.fn(),
}));

const iptalEt = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const SIMDI = new Date("2026-09-14T12:00:00Z").getTime();
const satis = (ek: Partial<AdminPromotion> = {}): AdminPromotion => ({
  id: 1, tutor_id: 7, tutor_name: "Ayşe Yılmaz", package_days: 30, price: "1250.50", currency: "TRY",
  payment_status: "PAID", provider: "iyzico", provider_ref: "iyz-REF-9931-gizli", paid_at: "2026-09-01T09:00:00Z",
  refunded_amount: null, starts_at: "2026-09-10T00:00:00Z", ends_at: "2026-10-10T00:00:00Z", cancelled_at: null,
  created_at: "2026-09-01T08:55:00Z", ...ek,
});
const YURURLUKTE = satis();
const BEKLEYEN = satis({ id: 2, tutor_id: 8, tutor_name: "Berk Demir", package_days: 7, price: "300", currency: "TRY", payment_status: "PENDING", provider_ref: null, paid_at: null, starts_at: null, ends_at: null });
const IPTALLI = satis({ id: 3, tutor_id: 9, tutor_name: null, payment_status: "REFUNDING", cancelled_at: "2026-09-12T10:00:00Z", refunded_amount: "1250.50" });
const LISTE = [YURURLUKTE, BEKLEYEN, IPTALLI];
const TAM_SAYFA = Array.from({ length: SAYFA_BOYUTU }, (_, i) => satis({ id: 100 + i, tutor_name: `Eğitmen ${i}` }));

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const son = (h: unknown) => vi.mocked(h as () => unknown).mock.calls.at(-1);

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}
let konum = { search: "" };
let git: (n: number) => void = () => {};
function Izci() {
  konum = { search: useLocation().search };
  git = useNavigate();
  return null;
}
function agac(girisler: string[] = [PATHS.adminNewTutorPromotions]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={girisler} initialIndex={girisler.length - 1}>
          <Izci />
          <Routes>
            <Route path={PATHS.adminNewTutorPromotions} element={<EgitmenOneCikarmalar />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (girisler?: string[]) => render(agac(girisler));
const satir = (id: number) => within(screen.getByTestId(`one-cikarma-${id}`));
const filtre = (etiket: string) => within(screen.getByLabelText("Durum filtresi")).getByRole("radio", { name: etiket });
const cekmece = () => document.querySelector(".ant-drawer-open") as HTMLElement;
const cekmeceAcikMi = () => document.querySelector(".ant-drawer-open") !== null;
const pencere = () => within(cekmece());
// AntD yükleniyor simgesi erişilebilir ada "loading" ekler; ad SONUNA göre eşlenir.
const cekmeceDugmesi = (ad: string) => within(cekmece().querySelector(".ant-drawer-footer") as HTMLElement).getByRole("button", { name: new RegExp(`${ad}$`) });
const sonuclandir = async (i: number, hata?: unknown) =>
  act(async () => {
    if (hata === undefined) sozler[i].res({});
    else sozler[i].rej(hata);
    await Promise.resolve();
  });

beforeEach(() => {
  iptalEt.mockReset().mockImplementation(ertelenmis);
  sozler.length = 0;
  vi.mocked(useAdminPromotions).mockReset().mockReturnValue(sonuc(LISTE));
  vi.mocked(useCancelPromotion).mockReturnValue({ mutateAsync: iptalEt, isPending: false } as never);
  izin("promotions.view", "promotions.manage", "users.view");
});

describe("saf kurallar", () => {
  it("URL beyaz listesi, prototip anahtarları ve sayfa ayrıştırma", () => {
    for (const [ham, beklenen] of [["active", "active"], ["PAID", "PAID"], ["PENDING", "PENDING"], ["hepsi", "hepsi"], ["paid", "hepsi"], ["FAILED", "hepsi"], ["__proto__", "hepsi"], ["constructor", "hepsi"], ["toString", "hepsi"], ["", "hepsi"], [null, "hepsi"]] as const) {
      expect(durumCoz(ham)).toBe(beklenen);
    }
    expect(apiDurumu("hepsi")).toBeUndefined();
    expect(apiDurumu("active")).toBe("active");
    for (const ham of [null, "", "0", "-1", "1.5", "abc", " 2", "1e3", String(EN_BUYUK_SAYFA + 1), "99999999999999999999"]) {
      expect(sayfaCoz(ham)).toBe(1);
    }
    expect(sayfaCoz("2")).toBe(2);
    expect(sayfaCoz(String(EN_BUYUK_SAYFA))).toBe(EN_BUYUK_SAYFA);
    expect(sayfaOfseti(1)).toBe(0);
    expect(sayfaOfseti(3)).toBe(50);
  });

  it("para durumu ile görünürlük AYRI eksenlerdir; sınır anları ve eksik tarih", () => {
    expect(Object.values(PARA_DURUMU_ETIKETI)).toEqual(["Ödeme bekliyor", "Ödendi", "Ödeme başarısız", "İade sürüyor", "İade edildi", "Elle inceleme"]);
    // Bilinmeyen ham değer nötr biçimde olduğu gibi kalır.
    expect(paraDurumuMetni("CHARGEBACK")).toBe("CHARGEBACK");
    expect(gorunurlukDurumu(IPTALLI, SIMDI).etiket).toBe("İptal edildi");
    expect(gorunurlukDurumu(BEKLEYEN, SIMDI).etiket).toBe("Yürürlükte değil");
    expect(gorunurlukDurumu(YURURLUKTE, SIMDI).etiket).toBe("Yürürlükte");
    expect(gorunurlukDurumu(satis({ starts_at: "2026-09-20T00:00:00Z" }), SIMDI).etiket).toBe("Sırada");
    expect(gorunurlukDurumu(satis({ ends_at: "2026-09-01T00:00:00Z" }), SIMDI).etiket).toBe("Süresi doldu");
    // Sınır: başlangıç tam şimdi → yürürlükte; bitiş tam şimdi → süresi doldu.
    expect(gorunurlukDurumu(satis({ starts_at: "2026-09-14T12:00:00Z" }), SIMDI).etiket).toBe("Yürürlükte");
    expect(gorunurlukDurumu(satis({ ends_at: "2026-09-14T12:00:00Z" }), SIMDI).etiket).toBe("Süresi doldu");
    // PAID ama tarih eksik/bozuk: "süresi doldu" DEMEZ.
    for (const bozuk of [satis({ starts_at: null }), satis({ ends_at: null }), satis({ starts_at: "bozuk-tarih" })]) {
      expect(gorunurlukDurumu(bozuk, SIMDI).etiket).toBe("Zaman aralığı eksik");
    }
    // İptal, para durumundan ÖNCE gelir: iade sürerken görünürlük "İptal edildi".
    expect(paraDurumuMetni(IPTALLI.payment_status)).toBe("İade sürüyor");
  });

  it("tutar kendi para birimiyle biçimlenir; geçersiz değer çökertmez", () => {
    expect(tutarMetni("1250.50", "TRY")).toMatch(/1\.250,50/);
    expect(tutarMetni("1250.50", "TRY")).toBe(new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(1250.5));
    // Başka para birimi TRY'ye çevrilmez.
    const usd = tutarMetni("99.90", "USD");
    expect(usd).toBe(new Intl.NumberFormat("tr-TR", { style: "currency", currency: "USD" }).format(99.9));
    expect(usd).not.toBe(tutarMetni("99.90", "TRY"));
    // ISO biçimli ama tanıdık olmayan kod: Intl kodu olduğu gibi yazar, uydurma TL eklenmez.
    expect(tutarMetni("100", "XYZ")).toBe(new Intl.NumberFormat("tr-TR", { style: "currency", currency: "XYZ" }).format(100));
    expect(tutarMetni("100", "XYZ")).toContain("XYZ");
    // Biçimi bozuk kod `Intl`i çökertir: sayı kaybolmadan ham kodla gösterilir.
    expect(tutarMetni("100", "TR")).toBe("100,00 TR");
    expect(tutarMetni("100", "")).toBe("100,00");
    expect(tutarMetni("100", null)).toBe("100,00");
    for (const bozuk of [null, undefined, "", "abc", NaN]) expect(tutarMetni(bozuk as never, "TRY")).toBe("-");
    expect(tarihMetni(null)).toBe("-");
    expect(tarihMetni("bozuk")).toBe("-");
    expect(tarihMetni("2026-09-10T00:00:00Z")).toContain("2026");
  });

  it("iptal edilebilirlik backend kapısıyla birebir; gerekçe ve açıklama sözleşmesi", () => {
    for (const durum of ["PAID", "PENDING", "FAILED"]) expect(iptalEdilebilir(satis({ payment_status: durum }))).toBe(true);
    for (const durum of ["REFUNDING", "REFUNDED", "MANUAL_REVIEW", "CHARGEBACK"]) expect(iptalEdilebilir(satis({ payment_status: durum }))).toBe(false);
    expect(iptalEdilebilir(satis({ cancelled_at: "2026-09-12T10:00:00Z" }))).toBe(false);
    expect(gerekceHatasi("ab")).toBe(`Gerekçe en az ${GEREKCE_MIN} karakter olmalı.`);
    expect(gerekceHatasi("   a  ")).toBe(`Gerekçe en az ${GEREKCE_MIN} karakter olmalı.`);
    expect(gerekceHatasi("abc")).toBeUndefined();
    expect(gerekceHatasi("x".repeat(GEREKCE_MAX))).toBeUndefined();
    expect(gerekceHatasi("x".repeat(GEREKCE_MAX + 1))).toBe(`En fazla ${GEREKCE_MAX} karakter yazılabilir.`);
    // Tahsilat olmayan kayıtta "iade" denmez.
    expect(iptalAciklamasi("PAID")).toContain("iade sürecine girer");
    for (const durum of ["PENDING", "FAILED"]) {
      expect(iptalAciklamasi(durum)).toContain("para iadesi başlatılmaz");
      expect(iptalAciklamasi(durum)).not.toContain("iade sürecine girer");
      expect(iptalDugmeMetni(durum)).toBe("Kaydı iptal et");
    }
    expect(iptalDugmeMetni("PAID")).toBe("İptal et ve iade başlat");
  });

  it("menü yaprağı promotions izniyle bağlı, seçili anahtar ve tembel rota", async () => {
    const yaprak = rotaIzniBul(PANEL_MENU, PATHS.adminNewTutorPromotions);
    expect(PATHS.adminNewTutorPromotions).toBe("/yonetim-yeni/egitmenler/one-cikarmalar");
    expect(ROUTES.adminNewTutorPromotions).toBe(PATHS.adminNewTutorPromotions);
    // İzin tutors DEĞİL promotions.
    expect(yaprak?.requiredPermission).toBe("promotions");
    expect(izinBeyaniniKarsilarMi(["promotions.view"], yaprak!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["tutors.manage"], yaprak!)).toBe(false);
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewTutorPromotions)).toEqual({ selectedKey: "egitmenler-one-cikarmalar", openKeys: ["egitmenler"] });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewTutorDiplomas).selectedKey).toBe("egitmenler-diploma");
    const grup = PANEL_MENU.find((g) => g.key === "egitmenler");
    expect(grup?.children?.map((c) => Boolean(c.path))).toEqual([true, true, true, true]);
    const modul = await import("@/panel/pages/egitmenler/EgitmenOneCikarmalar");
    expect(typeof modul.EgitmenOneCikarmalar).toBe("function");
  });
});

describe("EgitmenOneCikarmalar · liste", () => {
  it("promotions.view yokken AccessDenied ve sorgu kapalı (tutors izni yetmez)", () => {
    izin("tutors.manage", "users.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(useAdminPromotions)).toEqual([undefined, false, 25, 0]);
  });

  it("sunucu sırası korunur, kolonlar ve iki eksen ayrı gösterilir, toplam uydurulmaz", () => {
    kur();
    expect(screen.getAllByTestId(/^one-cikarma-/).map((d) => d.getAttribute("data-testid"))).toEqual(["one-cikarma-1", "one-cikarma-2", "one-cikarma-3"]);
    for (const baslik of ["Eğitmen", "Paket", "Yürürlük", "Tutar", "Para durumu", "Görünürlük", "İşlemler"]) {
      expect(screen.getByRole("columnheader", { name: baslik })).toBeInTheDocument();
    }
    expect(satir(1).getByText("Ödendi")).toBeInTheDocument();
    expect(satir(1).getByText("Yürürlükte")).toBeInTheDocument();
    expect(satir(2).getByText("Ödeme bekliyor")).toBeInTheDocument();
    expect(satir(2).getByText("Yürürlükte değil")).toBeInTheDocument();
    expect(satir(3).getByText("İade sürüyor")).toBeInTheDocument();
    expect(satir(3).getByText("İptal edildi")).toBeInTheDocument();
    expect(satir(1).getByText("30 gün")).toBeInTheDocument();
    expect(satir(3).getByText("Eğitmen #9")).toBeInTheDocument();
    // Toplam sayı YOK; yalnız sayfa numarası (tek sayfa dolduğunda).
    expect(screen.queryByText(/3 kayıt/)).not.toBeInTheDocument();
    expect(screen.getByText(/organik sıralamasını değiştirmez/)).toBeInTheDocument();
  });

  it("eğitmen adı users.view ile Link, izin yokken düz metin", () => {
    const a = kur();
    expect(satir(1).getByRole("link", { name: "Ayşe Yılmaz" })).toHaveAttribute("href", ROUTES.adminNewCustomer("tutor", 7));
    a.unmount();
    izin("promotions.view", "promotions.manage");
    kur();
    expect(satir(1).queryByRole("link", { name: "Ayşe Yılmaz" })).not.toBeInTheDocument();
    expect(satir(1).getByText("Ayşe Yılmaz")).toBeInTheDocument();
  });

  it("view-only: liste ve ayrıntı görünür, iptal yüzeyi DOM'da yok; açıklama dolu/boş/hata durumlarında görünür", async () => {
    izin("promotions.view", "users.view");
    const a = kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /İptal et$/ })).not.toBeInTheDocument();
    await userEvent.click(satir(1).getByRole("button", { name: "Ayşe Yılmaz İncele" }));
    expect(pencere().getByText("iyz-REF-9931-gizli")).toBeInTheDocument();
    a.unmount();
    vi.mocked(useAdminPromotions).mockReturnValue(sonuc([]));
    const b = kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    b.unmount();
    vi.mocked(useAdminPromotions).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x") }));
    kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
  });

  it("iptal aksiyonu yalnız iptal edilebilir kayıtta ve manage ile çizilir", () => {
    kur();
    expect(satir(1).getByRole("button", { name: /İptal et$/ })).toBeInTheDocument();
    expect(satir(2).getByRole("button", { name: /İptal et$/ })).toBeInTheDocument();
    // REFUNDING kayıt yeniden iptal edilemez.
    expect(satir(3).queryByRole("button", { name: /İptal et$/ })).not.toBeInTheDocument();
  });

  it("yükleniyor, ilk yükleme hatası, filtresiz boş, filtreli boş, arşiv sonu ve önbellekli tazeleme hatası ayrıdır", async () => {
    vi.mocked(useAdminPromotions).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByText("Öne çıkarma satışları yükleniyor…")).toBeInTheDocument();
    a.unmount();

    const yenile = vi.fn();
    vi.mocked(useAdminPromotions).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch: yenile }));
    const b = kur();
    expect(screen.getByText("Öne çıkarma satışları alınamadı.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(yenile).toHaveBeenCalledTimes(1);
    b.unmount();

    vi.mocked(useAdminPromotions).mockReturnValue(sonuc([]));
    const c = kur();
    expect(screen.getByText("Öne çıkarma satışı yok")).toBeInTheDocument();
    c.unmount();

    const d = kur([`${PATHS.adminNewTutorPromotions}?durum=PAID`]);
    expect(screen.getByText("Bu filtreye uyan satış yok")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tümünü göster" }));
    expect(konum.search).toBe("");
    d.unmount();

    const e = kur([`${PATHS.adminNewTutorPromotions}?sayfa=3`]);
    expect(screen.getByText("Satış arşivinin sonu")).toBeInTheDocument();
    e.unmount();

    vi.mocked(useAdminPromotions).mockReturnValue(sonuc(LISTE, { isError: true, error: new Error("x") }));
    kur();
    expect(screen.getByText(/Liste güncellenemedi/)).toBeInTheDocument();
    expect(screen.getByTestId("one-cikarma-1")).toBeInTheDocument();
  });
});

describe("EgitmenOneCikarmalar · filtre ve sayfalama", () => {
  it("URL filtresi sunucuya geçer, geçersiz değer gitmez, ilgisiz parametre korunur ve replace kullanılır", async () => {
    const a = kur([`${PATHS.adminNewTutorPromotions}?durum=__proto__&sekme=x`]);
    expect(son(useAdminPromotions)).toEqual([undefined, true, 25, 0]);
    expect(filtre("Tümü")).toBeChecked();
    fireEvent.click(filtre("Yürürlükte"));
    await waitFor(() => expect(son(useAdminPromotions)).toEqual(["active", true, 25, 0]));
    expect(konum.search).toContain("durum=active");
    expect(konum.search).toContain("sekme=x");
    // Filtre REPLACE: yeni geçmiş kaydı doğmaz, geri tuşu filtre öncesine dönmez.
    act(() => git(-1));
    await waitFor(() => expect(konum.search).toContain("durum=active"));
    a.unmount();
  });

  it("gerçek limit/offset, sayfa gezinmesi push ve geri/ileri URL ile sorguyu eşler", async () => {
    vi.mocked(useAdminPromotions).mockReturnValue(sonuc(TAM_SAYFA));
    kur();
    expect(son(useAdminPromotions)).toEqual([undefined, true, 25, 0]);
    await userEvent.click(screen.getByRole("button", { name: "Daha eski →" }));
    await waitFor(() => expect(son(useAdminPromotions)).toEqual([undefined, true, 25, 25]));
    expect(konum.search).toContain("sayfa=2");
    expect(screen.getByText("2. sayfa")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "← Daha yeni" }));
    await waitFor(() => expect(konum.search).not.toContain("sayfa"));
    expect(son(useAdminPromotions)).toEqual([undefined, true, 25, 0]);
    // Geri/ileri: URL, kontrol ve sorgu birlikte hareket eder.
    act(() => git(-1));
    await waitFor(() => expect(konum.search).toContain("sayfa=2"));
    expect(son(useAdminPromotions)).toEqual([undefined, true, 25, 25]);
  });

  it("filtre değişince sayfa anahtarı silinir ve sorgu başa döner", async () => {
    vi.mocked(useAdminPromotions).mockReturnValue(sonuc(TAM_SAYFA));
    kur([`${PATHS.adminNewTutorPromotions}?sayfa=3`]);
    expect(son(useAdminPromotions)).toEqual([undefined, true, 25, 50]);
    fireEvent.click(filtre("Ödenmiş"));
    await waitFor(() => expect(son(useAdminPromotions)).toEqual(["PAID", true, 25, 0]));
    expect(konum.search).not.toContain("sayfa");
  });

  it("tam sayfa değilken Daha eski yok; ileri sayfa boşalınca önceki sayfaya replace ile dönülür", async () => {
    const a = kur();
    expect(screen.queryByRole("button", { name: "Daha eski →" })).not.toBeInTheDocument();
    a.unmount();

    vi.mocked(useAdminPromotions).mockReturnValue(sonuc(TAM_SAYFA));
    const b = kur([`${PATHS.adminNewTutorPromotions}?sayfa=2`]);
    expect(screen.getByText("2. sayfa")).toBeInTheDocument();
    // Sayfa doldu, sonra (iptal sonrası) boşaldı: son geçerli sayfaya çekilir.
    vi.mocked(useAdminPromotions).mockReturnValue(sonuc([]));
    b.rerender(agac([`${PATHS.adminNewTutorPromotions}?sayfa=2`]));
    await waitFor(() => expect(konum.search).not.toContain("sayfa"));
  });
});

describe("EgitmenOneCikarmalar · ayrıntı penceresi", () => {
  it("sağlayıcı referansı kapalı listede yok, açık pencerede var, kapanınca DOM'dan kalkar", async () => {
    kur();
    expect(document.body.innerHTML).not.toContain("iyz-REF-9931-gizli");
    await userEvent.click(satir(1).getByRole("button", { name: "Ayşe Yılmaz İncele" }));
    const p = pencere();
    expect(p.getByText("iyz-REF-9931-gizli")).toBeInTheDocument();
    expect(p.getByText("iyzico")).toBeInTheDocument();
    expect(p.getByText("30 gün")).toBeInTheDocument();
    // Referans yalnız görünür metinde: öznitelik ya da test kimliğinde kopyası yok.
    expect(cekmece().querySelector('[title*="iyz-REF"]')).toBeNull();
    expect(cekmece().querySelector('[aria-label*="iyz-REF"]')).toBeNull();
    await userEvent.click(document.querySelector(".ant-drawer-open .ant-drawer-close") as HTMLElement);
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(document.body.innerHTML).not.toContain("iyz-REF-9931-gizli");
  });

  it("boş alanlar tek dille ve ikincil tonda; görünürlük ekseni ayrıntıda da var", async () => {
    kur();
    await userEvent.click(satir(2).getByRole("button", { name: "Berk Demir İncele" }));
    const p = pencere();
    // Referans, sağlayıcı tarihi ve iade tutarı boş: hepsi AYNI yer tutucu diliyle.
    expect(p.getAllByText("Belirtilmemiş").length).toBeGreaterThan(1);
    expect(p.queryByText("Yok")).not.toBeInTheDocument();
    // Tarih etiketleri durum değeriyle karışmaz.
    expect(p.getByText("Ödeme tarihi")).toBeInTheDocument();
    expect(p.getByText("İptal tarihi")).toBeInTheDocument();
    // İkinci eksen ayrıntıda da okunur.
    expect(p.getByText("Görünürlük")).toBeInTheDocument();
    expect(p.getByText("Yürürlükte değil")).toBeInTheDocument();
  });

  it("kayıt listeden düşse de açık ayrıntı penceresi ani kaybolmaz", async () => {
    const a = kur();
    await userEvent.click(satir(1).getByRole("button", { name: "Ayşe Yılmaz İncele" }));
    expect(pencere().getByText("iyz-REF-9931-gizli")).toBeInTheDocument();
    // Arka plan tazelemesi kaydı listeden düşürür (başka yönetici iptal etti / filtreden çıktı).
    vi.mocked(useAdminPromotions).mockReturnValue(sonuc([BEKLEYEN]));
    a.rerender(agac());
    expect(cekmeceAcikMi()).toBe(true);
    expect(pencere().getByText("iyz-REF-9931-gizli")).toBeInTheDocument();
  });
});

describe("EgitmenOneCikarmalar · iptal", () => {
  const iptalAc = async (id = 1, ad = "Ayşe Yılmaz") => userEvent.click(satir(id).getByRole("button", { name: `${ad} İptal et` }));

  it("PAID ve tahsilatsız kayıt farklı açıklama ve düğme metni gösterir", async () => {
    const a = kur();
    await iptalAc();
    expect(pencere().getByText(/iade sürecine girer/)).toBeInTheDocument();
    expect(cekmeceDugmesi("İptal et ve iade başlat")).toBeInTheDocument();
    // Başlık önce EYLEMİ söyler (ekran okuyucu pencereyi bu adla duyar), sonra bağlamı.
    expect(screen.getByText(/^Öne çıkarmayı iptal et · Ayşe Yılmaz · 30 günlük paket$/)).toBeInTheDocument();
    a.unmount();

    kur();
    await iptalAc(2, "Berk Demir");
    expect(pencere().getByText(/para iadesi başlatılmaz/)).toBeInTheDocument();
    expect(pencere().queryByText(/iade sürecine girer/)).not.toBeInTheDocument();
    expect(cekmeceDugmesi("Kaydı iptal et")).toBeInTheDocument();
  });

  it("boş gönderim alan hatası verir, düğme kapanmaz; trim ve sınırlar sözleşmeye uyar", async () => {
    kur();
    await iptalAc();
    await userEvent.click(cekmeceDugmesi("İptal et ve iade başlat"));
    expect(pencere().getByRole("alert")).toHaveTextContent(`Gerekçe en az ${GEREKCE_MIN} karakter olmalı.`);
    expect(cekmeceDugmesi("İptal et ve iade başlat")).toBeEnabled();
    expect(iptalEt).not.toHaveBeenCalled();
    const alan = pencere().getByLabelText(/İptal gerekçesi/);
    expect(alan).toHaveAttribute("maxLength", String(GEREKCE_MAX));
    fireEvent.change(alan, { target: { value: "  ab  " } });
    await userEvent.click(cekmeceDugmesi("İptal et ve iade başlat"));
    expect(iptalEt).not.toHaveBeenCalled();
    fireEvent.change(alan, { target: { value: "  yanlış satın alma  " } });
    expect(pencere().getByText(`En az ${GEREKCE_MIN}, en fazla ${GEREKCE_MAX} karakter (21/${GEREKCE_MAX}).`)).toBeInTheDocument();
    await userEvent.click(cekmeceDugmesi("İptal et ve iade başlat"));
    await waitFor(() => expect(iptalEt).toHaveBeenCalledWith({ id: 1, reason: "yanlış satın alma" }));
  });

  it("aynı tick çift gönderim TEK istek; başarıda pencere kapanır ve mesaj verilir", async () => {
    kur();
    await iptalAc();
    fireEvent.change(pencere().getByLabelText(/İptal gerekçesi/), { target: { value: "eğitmen talebi" } });
    const dugme = cekmeceDugmesi("İptal et ve iade başlat");
    fireEvent.click(dugme);
    fireEvent.click(dugme);
    await waitFor(() => expect(iptalEt).toHaveBeenCalledTimes(1));
    await sonuclandir(0);
    expect(await screen.findByText("Öne çıkarma iptal edildi.")).toBeInTheDocument();
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
  });

  it("422 gerekçe alanında, 409 Alert'te; gerekçe ve pencere korunur, yeniden denenebilir", async () => {
    kur();
    await iptalAc();
    fireEvent.change(pencere().getByLabelText(/İptal gerekçesi/), { target: { value: "gerekçe metni" } });
    await userEvent.click(cekmeceDugmesi("İptal et ve iade başlat"));
    await waitFor(() => expect(iptalEt).toHaveBeenCalledTimes(1));
    await sonuclandir(0, { response: { status: 422, data: { detail: [{ loc: ["body", "reason"], msg: "String should have at least 3 characters" }] } } });
    expect(await pencere().findByRole("alert")).toHaveTextContent("String should have at least 3 characters");
    expect(pencere().getByLabelText(/İptal gerekçesi/)).toHaveValue("gerekçe metni");
    await waitFor(() => expect(cekmeceDugmesi("İptal et ve iade başlat")).toBeEnabled());
    await userEvent.click(cekmeceDugmesi("İptal et ve iade başlat"));
    await waitFor(() => expect(iptalEt).toHaveBeenCalledTimes(2));
    await sonuclandir(1, { response: { status: 409, data: { detail: "Bu kayıt zaten iptal edilmiş." } } });
    expect(await screen.findByText("Bu kayıt zaten iptal edilmiş.")).toBeInTheDocument();
    expect(cekmeceAcikMi()).toBe(true);
    // Sağlayıcı referansı hata bağlamına sızmaz.
    expect(document.body.innerHTML).not.toContain("iyz-REF-9931-gizli");
  });

  it("temiz kapanış doğrudan, kirli kapanış onaylı, pending'de hiçbir yol kapatmaz", async () => {
    const a = kur();
    await iptalAc();
    await userEvent.click(cekmeceDugmesi("Vazgeç"));
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    await iptalAc();
    fireEvent.change(pencere().getByLabelText(/İptal gerekçesi/), { target: { value: "yazdım" } });
    await userEvent.click(cekmeceDugmesi("Vazgeç"));
    expect((await screen.findAllByText("Kaydedilmemiş değişiklikler var")).length).toBeGreaterThan(0);
    expect(cekmeceAcikMi()).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(cekmeceAcikMi()).toBe(true);
    a.unmount();

    iptalEt.mockClear();
    kur();
    await iptalAc();
    fireEvent.change(pencere().getByLabelText(/İptal gerekçesi/), { target: { value: "gerekçe" } });
    await userEvent.click(cekmeceDugmesi("İptal et ve iade başlat"));
    await waitFor(() => expect(iptalEt).toHaveBeenCalledTimes(1));
    await userEvent.click(document.querySelector(".ant-drawer-open .ant-drawer-close") as HTMLElement);
    expect(cekmeceAcikMi()).toBe(true);
    fireEvent.keyDown(cekmece(), { key: "Escape", keyCode: 27 });
    expect(cekmeceAcikMi()).toBe(true);
    expect(iptalEt).toHaveBeenCalledTimes(1);
  });
});
