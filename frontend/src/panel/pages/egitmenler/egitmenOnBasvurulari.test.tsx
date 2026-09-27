import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DURUM_ETIKETI, EgitmenOnBasvurulari, SAYFA_BOYUTU, apiDurumu, detaySatirlari, durumCoz, kvkkMetni, sayfaCoz, sayfaOfseti, sonrakiAdimlar } from "@/panel/pages/egitmenler/EgitmenOnBasvurulari";
import { MESGUL_NEDENI } from "@/panel/components/varlikKilidi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useAdminTutorPreApplications, useUpdateTutorPreApplicationStatus } from "@/hooks/useAdmin";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { AdminTutorPreApplication } from "@/api/admin";

vi.mock("@/hooks/useAdmin", () => ({
  useAdminTutorPreApplications: vi.fn(),
  useUpdateTutorPreApplicationStatus: vi.fn(),
}));

const guncelle = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const basvuru = (ek: Partial<AdminTutorPreApplication> = {}): AdminTutorPreApplication => ({
  id: 1, full_name: "Ayşe Yılmaz", phone: "05398796369", email: "ayse@example.com", subjects: "matematik, fizik",
  district: "Seyhan", experience: "3-5", note: "Akşamları müsait.", documents: null, status: "NEW",
  kvkk_accepted_at: "2026-09-10T08:30:00Z", created_at: "2026-09-12T10:00:00Z", photo_url: null, headline: null, bio: null,
  intro_video_url: null, teaching_mode: null, hourly_rate: null, availability_note: null, education_note: null,
  matched_subjects: [], unmatched_subjects: [], ...ek,
});
const YENI = basvuru({
  id: 11, status: "NEW", photo_url: "https://x/p.jpg",
  documents: [{ url: "https://imzali/belge-1?sig=abc", name: "Diploma" }, { url: "https://imzali/belge-2?sig=def", name: "Kimlik" }],
  matched_subjects: [{ id: 5, slug: "matematik", name: "Matematik", source_text: "matematik" }],
  unmatched_subjects: ["astroloji"],
});
const ARANDI = basvuru({ id: 12, full_name: "Berk Demir", status: "CONTACTED", email: null, district: null, experience: null, note: null, subjects: "kimya", matched_subjects: [], unmatched_subjects: [] });
const KAZANILDI = basvuru({
  id: 13, full_name: "Can Ak", status: "CONVERTED", headline: "Fizik öğretmeni", teaching_mode: "BOTH", hourly_rate: "450",
  education_note: "ODTÜ Fizik", availability_note: "Hafta içi 18:00 sonrası", bio: "On yıllık deneyim.", intro_video_url: "https://video/tanitim",
});
const OLUMSUZ = basvuru({ id: 14, full_name: "Deniz Su", status: "REJECTED", documents: [{ url: "https://imzali/belge-x?sig=zzz", name: "" }] });
const LISTE = [YENI, ARANDI, KAZANILDI, OLUMSUZ];
/** Tam dolu sayfa: sunucu toplam vermediği için "daha eski" yalnız bu durumda vardır. */
const TAM_SAYFA = Array.from({ length: SAYFA_BOYUTU }, (_, i) => basvuru({ id: 100 + i, full_name: `Aday ${i}` }));
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
function agac(girisler: string[] = [PATHS.adminNewTutorApplications]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={girisler} initialIndex={girisler.length - 1}>
          <Izci />
          <Routes>
            <Route path={PATHS.adminNewTutorApplications} element={<EgitmenOnBasvurulari />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (girisler?: string[]) => render(agac(girisler));
const satir = (id: number) => within(screen.getByTestId(`basvuru-${id}`));
const filtre = (etiket: string) => within(screen.getByLabelText("Durum filtresi")).getByRole("radio", { name: etiket });

beforeEach(() => {
  guncelle.mockReset().mockImplementation(ertelenmis);
  sozler.length = 0;
  vi.mocked(useAdminTutorPreApplications).mockReset().mockReturnValue(sonuc(LISTE));
  vi.mocked(useUpdateTutorPreApplicationStatus).mockReturnValue({ mutateAsync: guncelle, isPending: false } as never);
  izin("tutors.view", "tutors.manage");
});

describe("saf kurallar", () => {
  it("URL beyaz listesi, hepsi → status gönderilmez, geçişler ve ayrıntı satırları (KVKK dahil)", () => {
    for (const [ham, beklenen] of [["NEW", "NEW"], ["CONTACTED", "CONTACTED"], ["CONVERTED", "CONVERTED"], ["REJECTED", "REJECTED"], ["hepsi", "hepsi"], ["ARCHIVED", "NEW"], ["new", "NEW"], ["", "NEW"], [null, "NEW"]] as const) {
      expect(durumCoz(ham)).toBe(beklenen);
    }
    expect(apiDurumu("hepsi")).toBeUndefined();
    expect(apiDurumu("NEW")).toBe("NEW");
    expect(sonrakiAdimlar("NEW")).toEqual([{ label: "Arandı", to: "CONTACTED" }]);
    expect(sonrakiAdimlar("CONTACTED")).toEqual([{ label: "Kazanıldı", to: "CONVERTED" }, { label: "Olumsuz", to: "REJECTED" }]);
    expect(sonrakiAdimlar("CONVERTED")).toEqual([{ label: "Geri aç", to: "CONTACTED" }]);
    expect(sonrakiAdimlar("REJECTED")).toEqual([{ label: "Geri aç", to: "CONTACTED" }]);
    expect(Object.values(DURUM_ETIKETI)).toEqual(["Yeni", "Arandı", "Kazanıldı", "Olumsuz"]);
    expect(detaySatirlari(KAZANILDI).map((s) => s.etiket)).toEqual(["Başlık", "Ders biçimi", "Saatlik ücret", "Eğitim", "Müsaitlik"]);
    expect(detaySatirlari(KAZANILDI).find((s) => s.etiket === "Ders biçimi")?.deger).toBe("Online + yüz yüze");
    expect(detaySatirlari(KAZANILDI).find((s) => s.etiket === "Saatlik ücret")?.deger).toBe("450 ₺");
    // Boş alanlar satır üretmez; KVKK ayrı gösterilir ki "doldurmadı" mesajı ulaşılabilir kalsın.
    expect(detaySatirlari(ARANDI)).toEqual([]);
    expect(kvkkMetni(ARANDI)).toBe(new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date("2026-09-10T08:30:00Z")));
  });
});

describe("EgitmenOnBasvurulari", () => {
  it("tutors.view yokken AccessDenied ve sorgu kapalı", () => {
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(useAdminTutorPreApplications)).toEqual(["NEW", false, 25, 0]);
  });

  it("view-only: iletişim ve ayrıntı görünür, durum aksiyonları DOM'da yok; salt okunur açıklaması boş ve hata durumunda da görünür", async () => {
    izin("tutors.view");
    const a = kur();
    expect(son(useAdminTutorPreApplications)).toEqual(["NEW", true, 25, 0]);
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(satir(11).getByRole("link", { name: "05398796369" })).toBeInTheDocument();
    for (const ad of [/Arandı/, /Kazanıldı/, /Olumsuz/, /Geri aç/]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    // Detay düğmesi okuma yüzeyidir: salt okunurda da açılır.
    await userEvent.click(satir(13).getByRole("button", { name: "Can Ak Detay" }));
    expect(screen.getByText("ODTÜ Fizik")).toBeInTheDocument();
    a.unmount();
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc([]));
    const b = kur();
    expect(screen.getByText("Aranacak yeni başvuru yok")).toBeInTheDocument();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    b.unmount();
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x") }));
    kur();
    expect(screen.getByText("Ön başvurular alınamadı.")).toBeInTheDocument();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
  });

  it("filtre: NEW varsayılanı URL'ye yazılmaz, geçersiz değer NEW'e düşer ve sunucuya gitmez, hepsi status göndermez, ilgisiz parametre korunur, replace", () => {
    const a = kur([`${PATHS.adminNewTutorApplications}?durum=ARCHIVED&sekme=x`]);
    expect(son(useAdminTutorPreApplications)).toEqual(["NEW", true, 25, 0]);
    expect(filtre("Yeni")).toBeChecked();
    fireEvent.click(filtre("Tümü"));
    expect(son(useAdminTutorPreApplications)).toEqual([undefined, true, 25, 0]);
    expect(konum.search).toBe("?durum=hepsi&sekme=x");
    fireEvent.click(filtre("Kazanıldı"));
    expect(son(useAdminTutorPreApplications)).toEqual(["CONVERTED", true, 25, 0]);
    fireEvent.click(filtre("Yeni"));
    expect(konum.search).toBe("?sekme=x");
    expect(son(useAdminTutorPreApplications)).toEqual(["NEW", true, 25, 0]);
    // Sunucuya hiçbir turda beyaz liste dışı değer gitmedi.
    expect(vi.mocked(useAdminTutorPreApplications).mock.calls.every((c) => c[0] === undefined || ["NEW", "CONTACTED", "CONVERTED", "REJECTED"].includes(c[0] as string))).toBe(true);
    expect(vi.mocked(useAdminTutorPreApplications).mock.calls.every((c) => c[2] === 25 && Number.isSafeInteger(c[3]) && (c[3] as number) >= 0)).toBe(true);
    a.unmount();
    kur([`${PATHS.adminNewTutorApplications}?durum=REJECTED`]);
    expect(son(useAdminTutorPreApplications)).toEqual(["REJECTED", true, 25, 0]);
    expect(filtre("Olumsuz")).toBeChecked();
  });

  it("filtre: geri/ileri URL, kontrol ve sorguyu eşler", async () => {
    kur([`${PATHS.adminNewTutorApplications}?durum=CONTACTED`, `${PATHS.adminNewTutorApplications}?durum=CONVERTED`]);
    expect(filtre("Kazanıldı")).toBeChecked();
    await act(async () => { git(-1); });
    expect(konum.search).toBe("?durum=CONTACTED");
    expect(filtre("Arandı")).toBeChecked();
    expect(son(useAdminTutorPreApplications)).toEqual(["CONTACTED", true, 25, 0]);
    await act(async () => { git(1); });
    expect(filtre("Kazanıldı")).toBeChecked();
    expect(son(useAdminTutorPreApplications)).toEqual(["CONVERTED", true, 25, 0]);
  });

  it("satır alanları: ad, fotoğraf, tel/mailto, belgeler (güvenli dış bağlantı, URL metin değil), not, ilçe/deneyim/tarih, durum etiketi, ders eşleşmeleri", () => {
    kur();
    const s = satir(11);
    expect(s.getByText("Ayşe Yılmaz")).toBeInTheDocument();
    // Fotoğraf dekoratiftir (ad yanında): alt="" ile sunum rolünde.
    expect(screen.getByTestId("basvuru-11").querySelector("img")).toHaveAttribute("src", "https://x/p.jpg");
    expect(s.getByRole("link", { name: "05398796369" })).toHaveAttribute("href", "tel:05398796369");
    expect(s.getByRole("link", { name: "ayse@example.com" })).toHaveAttribute("href", "mailto:ayse@example.com");
    expect(s.getByText(/Seyhan · 3–5 yıl ·/)).toBeInTheDocument();
    expect(s.getByText("Akşamları müsait.")).toBeInTheDocument();
    expect(s.getByText("Yeni")).toBeInTheDocument();
    // Eşleşen ders adı + eşleşmeyen değer "eşleşmedi" uyarısıyla; ham metin yalnız ikisi de boşken.
    expect(s.getByText("Matematik")).toBeInTheDocument();
    expect(s.getByText("astroloji · eşleşmedi")).toBeInTheDocument();
    expect(s.queryByText("matematik, fizik")).not.toBeInTheDocument();
    // Belgeler: gerçek dış bağlantı, URL metin olarak basılmaz.
    // Dosya adı GÖRÜNÜR metinde (ayırt edilebilir); imzalı adres metne ya da özniteliğe basılmaz.
    const belgeler = [s.getByRole("link", { name: "Diploma" }), s.getByRole("link", { name: "Kimlik" })];
    expect(belgeler).toHaveLength(2);
    for (const b of belgeler) {
      expect(b).not.toHaveAttribute("title");
      expect(b).toHaveAttribute("target", "_blank");
      expect(b).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(b).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    }
    expect(belgeler[0]).toHaveAttribute("href", "https://imzali/belge-1?sig=abc");
    expect(document.body.textContent).not.toContain("sig=abc");
    // Fallback'ler: eşleşme yoksa ham subjects; ilçe/deneyim yoksa açık metin.
    const s2 = satir(12);
    expect(s2.getByText("kimya")).toBeInTheDocument();
    expect(s2.getByText(/İlçe belirtilmedi · Deneyim belirtilmedi/)).toBeInTheDocument();
    expect(s2.queryByRole("link", { name: /@/ })).not.toBeInTheDocument();
    // Dosya adı boşsa sıralı yedek etiket.
    expect(within(screen.getByTestId("basvuru-14")).getByRole("link", { name: "Belge 1" })).toBeInTheDocument();
  });

  it("detay: aria-expanded/controls bağı, alanlar ve video güvenli bağlantı; boş ayrıntıda operasyonel metin; filtre değişince açık detay kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    const dugme = satir(13).getByRole("button", { name: "Can Ak Detay" });
    expect(dugme).toHaveAttribute("aria-expanded", "false");
    expect(dugme).toHaveAttribute("aria-controls", "basvuru-detay-13");
    // Erişilebilir ad `aria-labelledby` ile kurulur: ham ad öznitelikte durmaz (telemetri sızıntısı yok).
    expect(dugme).not.toHaveAttribute("aria-label");
    expect(document.querySelectorAll('[aria-label*="Can Ak"], [title*="Can Ak"]')).toHaveLength(0);
    await u.click(dugme);
    expect(satir(13).getByRole("button", { name: "Can Ak Kapat" })).toHaveAttribute("aria-expanded", "true");
    const detay = document.getElementById("basvuru-detay-13")!;
    expect(within(detay).getByText("Fizik öğretmeni")).toBeInTheDocument();
    expect(within(detay).getByText("Online + yüz yüze")).toBeInTheDocument();
    expect(within(detay).getByText("450 ₺")).toBeInTheDocument();
    expect(within(detay).getByText("ODTÜ Fizik")).toBeInTheDocument();
    expect(within(detay).getByText("Hafta içi 18:00 sonrası")).toBeInTheDocument();
    expect(within(detay).getByText("On yıllık deneyim.")).toBeInTheDocument();
    expect(within(detay).getByText("KVKK kabulü")).toBeInTheDocument();
    expect(within(detay).getByText(kvkkMetni(KAZANILDI)!)).toBeInTheDocument();
    const video = within(detay).getByRole("link", { name: "Tanıtım videosunu aç" });
    expect(video).toHaveAttribute("href", "https://video/tanitim");
    expect(video).toHaveAttribute("target", "_blank");
    expect(video).toHaveAttribute("rel", expect.stringContaining("noopener"));
    // Boş ayrıntı: operasyonel metin.
    await u.click(satir(12).getByRole("button", { name: "Berk Demir Detay" }));
    const bosDetay = within(document.getElementById("basvuru-detay-12")!);
    expect(bosDetay.getByText(/Aday isteğe bağlı bölümleri doldurmadı/)).toBeInTheDocument();
    // KVKK tarihi yine görünür (backend'den gelir).
    expect(bosDetay.getByText("KVKK kabulü")).toBeInTheDocument();
    expect(document.getElementById("basvuru-detay-13")).toBeNull();
    // Filtre değişince açık detay kapanır (yanlış kayda kaymaz).
    fireEvent.click(filtre("Tümü"));
    expect(document.getElementById("basvuru-detay-12")).toBeNull();
  });

  it("durum geçişleri: her statüde doğru düğmeler ve gerçek payload; başarı mesajı hedefe uygun; gerekçe alanı yok", async () => {
    kur();
    expect(satir(11).getAllByRole("button").map((b) => b.textContent)).toEqual(["Arandı", "Detay"]);
    expect(satir(12).getAllByRole("button").map((b) => b.textContent)).toEqual(["Kazanıldı", "Olumsuz", "Detay"]);
    expect(satir(13).getAllByRole("button").map((b) => b.textContent)).toEqual(["Geri aç", "Detay"]);
    expect(satir(14).getAllByRole("button").map((b) => b.textContent)).toEqual(["Geri aç", "Detay"]);
    fireEvent.click(satir(11).getByRole("button", { name: "Ayşe Yılmaz Arandı" }));
    expect(guncelle).toHaveBeenCalledWith({ id: 11, status: "CONTACTED" });
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText('Başvuru "Arandı" olarak işaretlendi.')).toBeInTheDocument();
    fireEvent.click(satir(12).getByRole("button", { name: "Berk Demir Kazanıldı" }));
    expect(guncelle).toHaveBeenLastCalledWith({ id: 12, status: "CONVERTED" });
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText('Başvuru "Kazanıldı" olarak işaretlendi.')).toBeInTheDocument();
    fireEvent.click(satir(13).getByRole("button", { name: "Can Ak Geri aç" }));
    expect(guncelle).toHaveBeenLastCalledWith({ id: 13, status: "CONTACTED" });
    // Backend gerekçe almıyor: pencere ya da gerekçe alanı yok.
    expect(document.querySelector(".ant-drawer-open")).toBeNull();
    expect(screen.queryByLabelText(/gerekçe/i)).not.toBeInTheDocument();
  });

  it("kilit: aynı tick çift tık tek istek, aynı kayıtta diğer aksiyon kapalı ve nedenli, farklı kayıtlar paralel; hata satırda kalır, diğer satırı silmez, yeniden denenebilir", async () => {
    kur();
    fireEvent.click(satir(12).getByRole("button", { name: /Kazanıldı$/ }));
    fireEvent.click(satir(12).getByRole("button", { name: /Kazanıldı$/ }));
    expect(guncelle).toHaveBeenCalledTimes(1);
    const olumsuz = satir(12).getByRole("button", { name: /Olumsuz$/ });
    expect(olumsuz).toBeDisabled();
    expect(olumsuz).toHaveAttribute("title", MESGUL_NEDENI);
    // Farklı kayıt paralel.
    fireEvent.click(satir(11).getByRole("button", { name: /Arandı$/ }));
    expect(guncelle).toHaveBeenCalledTimes(2);
    expect(guncelle).toHaveBeenLastCalledWith({ id: 11, status: "CONTACTED" });
    // 12 hata alır, 11 başarır: hatalar satır bazlı.
    await act(async () => { sozler.shift()!.rej({ response: { status: 409, data: { detail: "Durum zaten güncel" } } }); await Promise.resolve(); });
    expect(await within(screen.getByTestId("basvuru-12")).findByText("Durum zaten güncel")).toBeInTheDocument();
    await act(async () => { sozler.shift()!.res(undefined); await Promise.resolve(); });
    expect(within(screen.getByTestId("basvuru-12")).getByText("Durum zaten güncel")).toBeInTheDocument();
    expect(within(screen.getByTestId("basvuru-11")).queryByText("Durum zaten güncel")).not.toBeInTheDocument();
    // Kilit bırakıldı: yeniden denenebilir ve kendi hatası temizlenir.
    await waitFor(() => expect(satir(12).getByRole("button", { name: /Olumsuz$/ })).toBeEnabled());
    fireEvent.click(satir(12).getByRole("button", { name: /Kazanıldı$/ }));
    expect(guncelle).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(within(screen.getByTestId("basvuru-12")).queryByText("Durum zaten güncel")).not.toBeInTheDocument());
  });

  it("yükleniyor / hata + yalnız kendi refetch'i / boş ayrımı; önbellekli veri tazeleme hatasında gizlenmez", async () => {
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByText("Ön başvurular yükleniyor…")).toBeInTheDocument();
    a.unmount();
    const refetch = vi.fn();
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Lead servisi çöktü" } } }, refetch }));
    const b = kur();
    expect(screen.getByText("Lead servisi çöktü")).toBeInTheDocument();
    expect(screen.queryByText("Aranacak yeni başvuru yok")).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Lead servisi çöktü").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    b.unmount();
    // Önbellekli veri + tazeleme hatası: liste durur, uyarı + yeniden dene.
    const refetch2 = vi.fn();
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc(LISTE, { isError: true, error: new Error("ağ"), refetch: refetch2 }));
    const c = kur();
    expect(screen.getByTestId("basvuru-11")).toBeInTheDocument();
    expect(screen.getByText(/Liste güncellenemedi/)).toBeInTheDocument();
    await userEvent.click(within(screen.getByText(/Liste güncellenemedi/).closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(refetch2).toHaveBeenCalledTimes(1);
    c.unmount();
    // Boş: varsayılanda operasyonel metin, diğer filtrede dönüş aksiyonu.
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc([]));
    kur([`${PATHS.adminNewTutorApplications}?durum=REJECTED`]);
    expect(screen.getByText("Bu durumda ön başvuru yok")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yeni başvurulara dön" }));
    expect(screen.getByText("Aranacak yeni başvuru yok")).toBeInTheDocument();
    expect(konum.search).toBe("");
  });

  it("sayfalama: ?sayfa= beyaz listesi, offset hesabı, filtre sayfayı sıfırlar, ilgisiz parametre korunur", () => {
    // Saf kurallar: yalnız düz pozitif güvenli tam sayı.
    for (const [ham, beklenen] of [["1", 1], ["2", 2], ["10", 10], ["1e3", 1], ["-2", 1], ["0", 1], ["2.5", 1], [" 2", 1], ["abc", 1], ["", 1], [null, 1], [String(Number.MAX_SAFE_INTEGER) + "0", 1]] as const) {
      expect(sayfaCoz(ham)).toBe(beklenen);
    }
    // Üst sınır: derin offset taraması engellenir.
    expect(sayfaCoz("10000")).toBe(10_000);
    expect(sayfaCoz("10001")).toBe(1);
    expect(sayfaOfseti(1)).toBe(0);
    expect(sayfaOfseti(2)).toBe(25);
    expect(sayfaOfseti(4)).toBe(75);
    // Sayfa 2: limit 25, offset 25.
    const a = kur([`${PATHS.adminNewTutorApplications}?sayfa=2&sekme=x`]);
    expect(son(useAdminTutorPreApplications)).toEqual(["NEW", true, 25, 25]);
    // Filtre değişince sayfa 1'e döner; ilgisiz parametre korunur.
    fireEvent.click(filtre("Kazanıldı"));
    expect(son(useAdminTutorPreApplications)).toEqual(["CONVERTED", true, 25, 0]);
    expect(new URLSearchParams(konum.search).get("sayfa")).toBeNull();
    expect(new URLSearchParams(konum.search).get("sekme")).toBe("x");
    a.unmount();
    // Geçersiz sayfa değeri sunucuya gitmez.
    kur([`${PATHS.adminNewTutorApplications}?sayfa=1e3`]);
    expect(son(useAdminTutorPreApplications)).toEqual(["NEW", true, 25, 0]);
    expect(vi.mocked(useAdminTutorPreApplications).mock.calls.every((c) => c[3] === 0 || Number.isSafeInteger(c[3]))).toBe(true);
  });

  it("sayfalama: tam 25 satırda Daha eski, sayfa > 1'de Daha yeni; gezinme push ve geri/ileri sorguyu eşler; eksik sayfada Daha eski yok", async () => {
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc(TAM_SAYFA));
    const a = kur();
    expect(screen.queryByRole("button", { name: /Daha yeni/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Daha eski/ }));
    expect(konum.search).toBe("?sayfa=2");
    expect(son(useAdminTutorPreApplications)).toEqual(["NEW", true, 25, 25]);
    expect(screen.getByText("2. sayfa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Daha yeni/ })).toBeInTheDocument();
    // Gezinme PUSH: geri tuşu 1. sayfaya döner.
    await act(async () => { git(-1); });
    expect(konum.search).toBe("");
    expect(son(useAdminTutorPreApplications)).toEqual(["NEW", true, 25, 0]);
    await act(async () => { git(1); });
    expect(konum.search).toBe("?sayfa=2");
    expect(son(useAdminTutorPreApplications)).toEqual(["NEW", true, 25, 25]);
    a.unmount();
    // Eksik sayfa: daha eski yok.
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc(TAM_SAYFA.slice(0, 24)));
    kur();
    expect(screen.queryByRole("button", { name: /Daha eski/ })).not.toBeInTheDocument();
  });

  it("sayfalama: baştan boş ileri sayfa arşiv sonu metnini gösterir; veri azalınca önceki sayfaya replace ile çekilir", async () => {
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc([]));
    const a = kur([`${PATHS.adminNewTutorApplications}?sayfa=3`]);
    expect(screen.getByText("Başvuru arşivinin sonu")).toBeInTheDocument();
    // Baştan boş açıldığı için geri ÇEKİLME yok; kullanıcı kendi döner.
    expect(konum.search).toBe("?sayfa=3");
    await userEvent.click(screen.getByRole("button", { name: /Daha yeni/ }));
    expect(konum.search).toBe("?sayfa=2");
    a.unmount();
    // Dolu 2. sayfa mutasyon/refetch sonrası boşalırsa önceki sayfaya replace ile çekilir.
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc(TAM_SAYFA));
    const b = kur([`${PATHS.adminNewTutorApplications}?sayfa=2`]);
    expect(konum.search).toBe("?sayfa=2");
    vi.mocked(useAdminTutorPreApplications).mockReturnValue(sonuc([]));
    await act(async () => { b.rerender(agac([`${PATHS.adminNewTutorApplications}?sayfa=2`])); });
    await waitFor(() => expect(konum.search).toBe(""));
    expect(son(useAdminTutorPreApplications)).toEqual(["NEW", true, 25, 0]);
    // Replace: geri tuşu boş 2. sayfaya dönmez.
    expect(screen.queryByText("Başvuru arşivinin sonu")).not.toBeInTheDocument();
  });

  it("rota, menü yaprağı ve kardeş yer tutucular, izin, selectedKey/openKeys", () => {
    expect(PATHS.adminNewTutorApplications).toBe("/yonetim-yeni/egitmenler/on-basvurular");
    expect(ROUTES.adminNewTutorApplications).toBe(PATHS.adminNewTutorApplications);
    const grup = PANEL_MENU.find((g) => g.key === "egitmenler");
    expect(grup?.children?.map((c) => c.label)).toEqual(["İlanlar", "Ön Başvurular", "Diploma Doğrulama", "Video Onayı", "Öne Çıkarmalar"]);
    // Eğitmenler grubunun beş yaprağının da gerçek rotası var; yer tutucu kalmadı.
    expect(grup?.children?.map((c) => Boolean(c.path))).toEqual([true, true, true, true, true]);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewTutorApplications)).toMatchObject({ label: "Ön Başvurular", requiredPermission: "tutors" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewTutorApplications)).toEqual({ selectedKey: "egitmenler-basvurular", openKeys: ["egitmenler"] });
    expect(izinBeyaniniKarsilarMi(["tutors.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewTutorApplications)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewTutorApplications)!)).toBe(false);
  });
});
