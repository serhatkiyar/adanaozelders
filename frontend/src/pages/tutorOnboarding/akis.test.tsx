/**
 * Sihirbaz kabuğunun DAVRANIŞ sözleşmesi.
 *
 * Sessizce bozulduğunda kayıp üreten üç davranış:
 *
 *  1. "İleri" düğmesi doğrulamayla KİLİTLENMEZ. Kullanıcı basar, neyin eksik
 *     olduğunu ekranda okur. (Deponun kilitli kararı —
 *     `src/__guards__/gonderDugmesi.test.ts`.) Kilitli düğme, sebebi
 *     görünmediğinde kullanıcıyı adımda çaresiz bırakıyor.
 *  2. Doğrulama geçmeden sunucuya YAZILMAZ; geçince o adımın gövdesi yazılır.
 *     Aksi hâlde yarım veri kaydedilir ya da hiç kaydedilmez.
 *  3. Yayın kapısının eksikleri, sunucuya gitmeden önce özet ekranında
 *     görünür ve ilgili adıma bağlanır — eskiden bu bilgi yalnız 422
 *     gövdesindeydi.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import IlanSihirbazi from "./IlanSihirbazi";
import { ADIMLAR, adimIndeksi } from "./sozlesme";
import { TutorStatus } from "@/types";

// Adım SAYISI ve SIRASI sözleşmeden okunur, teste elle yazılmaz. Daha önce
// "Adım 4 / 11" gibi sabitler vardı; sözleşmeden bir adım çıkarıldığında test
// kırılıyor ama hata "adım sayısı yanlış" gibi görünüyordu — kırılan üretim
// değil, testin kendi sabitiydi.
const N = ADIMLAR.length;
const gostergeAdi = (adimNo: number) => new RegExp(`^Adım ${adimNo + 1} / ${N}`);

const guncelle = vi.fn();
const gonder = vi.fn();

vi.mock("@/api/tutors", () => ({
  fetchMyTutorProfile: vi.fn(),
  updateMyTutorProfile: (...a: unknown[]) => guncelle(...a),
  submitMyTutorProfile: () => gonder(),
  suspendMyListing: vi.fn(),
  activateMyListing: vi.fn(),
}));

// Ders kataloğu ve harita ağ/işleyici bağımlılığı taşır; bu testin konusu
// kabuğun adım geçişi, seçicinin kendisi değil (onun testi ayrı).
vi.mock("@/components/tutor/DersSecici", () => ({
  DersSecici: () => <div>ders secici</div>,
}));
vi.mock("@/components/EducationSection", () => ({
  EducationSection: () => <div>egitim bolumu</div>,
}));

const TASLAK = {
  id: 1,
  role_id: 2,
  full_name: "Ayşe Yılmaz",
  slug: "ayse-yilmaz-1",
  status: TutorStatus.DRAFT,
  subjects: [],
  subject_levels: {},
};

const KULLANICI = { id: 1, role_id: 2, full_name: "Ayşe Yılmaz" };

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: KULLANICI, isLoading: false }),
}));

vi.mock("@/hooks/useEducations", () => ({
  useMyEducations: () => ({ data: [] }),
}));

function ekran(adim = 0) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  qc.setQueryData(["tutors", "me"], TASLAK);
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/ilanini-olustur?adim=${adim}`]}>
          <IlanSihirbazi />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  guncelle.mockReset().mockResolvedValue(TASLAK);
  gonder.mockReset().mockResolvedValue({ ...TASLAK, status: TutorStatus.PENDING_APPROVAL });
});

describe("adım geçişi", () => {
  it("eksik adımda İleri BASILABİLİR ve sebebi ekranda yazar", async () => {
    ekran(0);
    // TEK birincil düğme olmalı — çubuk iki kez render edilirse ekran
    // okuyucu aynı aksiyonu iki kez duyurur. Etiket de JENERİK DEĞİL:
    // sıradaki adımı adıyla söyler.
    const ileri = await screen.findByRole("button", { name: /^Sırada:/ });
    // Kilitli düğme yasak: kullanıcı basabilmeli.
    expect((ileri as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(ileri);

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /en az bir ders seç/i,
    );
    // Doğrulama geçmediği için sunucuya HİÇBİR ŞEY yazılmadı.
    expect(guncelle).not.toHaveBeenCalled();
  });

  it("geçerli adım kendi gövdesini yazar ve ilerler", async () => {
    ekran(1);
    fireEvent.change(await screen.findByLabelText(/İlan başlığı/), {
      target: {
        value:
          "Lise ve hazırlık öğrencilerine sekiz yıldır birebir ders veren mühendislik mezunu bir eğitmenim",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Sırada:/ }));

    await waitFor(() => expect(guncelle).toHaveBeenCalledTimes(1));
    expect(guncelle.mock.calls[0][0]).toHaveProperty("headline");
    // Adım 2'ye geçildi.
    expect(
      await screen.findByRole("heading", { name: "Dersin nasıl işliyor?" }),
    ).toBeTruthy();
  });

  it("geri gitmek doğrulama çalıştırmaz ve yazma yapmaz", async () => {
    ekran(1);
    fireEvent.click(await screen.findByRole("button", { name: "Önceki adım" }));
    await screen.findByRole("heading", { name: "Hangi dersleri veriyorsun?" });
    expect(guncelle).not.toHaveBeenCalled();
  });
});

describe("mobil gezinme", () => {
  it("birincil düğme sıradaki adımı ADIYLA söyler", async () => {
    ekran(0);
    // Adım 0 → sıradaki adım "Başlığın". Jenerik "İleri" etiketi, kullanıcının
    // bastığında ne geleceğini bilmemesine ve duraksamasına yol açıyor.
    expect(
      await screen.findByRole("button", { name: "Sırada: Başlığın" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "İleri" })).toBeNull();
  });

  it("adım haritası geriye gitmeyi tek dokunuşa indirir", async () => {
    ekran(3);
    fireEvent.click(await screen.findByRole("button", { name: gostergeAdi(3) }));

    // Ulaşılmış adım açılabilir…
    fireEvent.click(await screen.findByRole("button", { name: /1\s*Derslerin/ }));
    expect(
      await screen.findByRole("heading", { name: "Hangi dersleri veriyorsun?" }),
    ).toBeTruthy();
    // …ve haritadan gezinmek KAYDETMEZ; "Geri" ile aynı sözleşme.
    expect(guncelle).not.toHaveBeenCalled();
  });

  it("harita henüz ulaşılmamış adımı KİLİTLİ gösterir", async () => {
    ekran(1);
    fireEvent.click(await screen.findByRole("button", { name: gostergeAdi(1) }));
    const ozet = await screen.findByRole("button", {
      name: new RegExp(`${N}\s*Özet`),
    });
    expect((ozet as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("yayın kapısı", () => {
  it("özet ekranı eksikleri sunucuya gitmeden gösterir", async () => {
    ekran(adimIndeksi("ozet"));
    // Boş taslakta ders seçilmemiş — yayının gerçek önkoşulu bu.
    expect(await screen.findByText(/En az bir ders seç/i)).toBeTruthy();
    expect(gonder).not.toHaveBeenCalled();
  });

  // 5 Eyl 2026: belge yayın kapısı olmaktan çıktı. Belgesiz eğitmene
  // düzeltemeyeceği bir eksik gösterilmemeli — eski metin geri gelirse
  // kullanıcı akışın sonunda yine duvara toslar.
  it("belgesiz eğitmene BELGE ENGELİ gösterilmez", async () => {
    ekran(adimIndeksi("ozet"));
    await screen.findByText(/En az bir ders seç/i);
    expect(screen.queryByText(/en az bir eğitim kaydı ve belgesi/i)).toBeNull();
  });

  it("sunucu reddederse mesajı adımda gösterir, çöküş olmaz", async () => {
    gonder.mockRejectedValue({
      response: { data: { detail: "Add at least one education document" } },
    });
    ekran(adimIndeksi("ozet"));
    fireEvent.click(await screen.findByRole("button", { name: "Yayına gönder" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    // Tebrikler ekranına GEÇİLMEDİ.
    expect(screen.queryByText(/İlanın incelemeye alındı/)).toBeNull();
  });
});

describe("dev başlık", () => {
  // `vurgu` başlıkta geçmiyorsa DevBaslik sessizce tek renk çizer — kusur
  // görünmez. Sözleşme tarafında yakalanmalı.
  it("her adımın vurgulu sözcüğü kendi başlığında GEÇER", () => {
    for (const a of ADIMLAR) {
      if (!a.vurgu) continue;
      expect(a.baslik, a.anahtar).toContain(a.vurgu);
    }
  });

  it("başlık iki renkli basılsa da tek erişilebilir ad taşır", async () => {
    ekran(adimIndeksi("baslik"));
    expect(
      await screen.findByRole("heading", { name: "İlanının başlığı ne olsun?" }),
    ).toBeTruthy();
  });
});
